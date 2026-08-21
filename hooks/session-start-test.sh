#!/bin/bash
# session-start-test.sh - Tests for the SessionStart hook JSON payload
#
# Run this from the repository root:
#
#   bash hooks/session-start-test.sh
#
# The hook under test must depend on nothing but bash: no jq, no node, no
# coreutils. This harness is allowed to use node (a dev dependency) to parse
# and compare what the hook emits.

set -euo pipefail

HOOK="hooks/session-start.sh"
SKILL="skills/flowly-catalog/SKILL.md"

if [ ! -f "$HOOK" ] || [ ! -f "$SKILL" ]; then
  echo "run this from the repository root: bash hooks/session-start-test.sh" >&2
  exit 1
fi

# Absolute path to this bash, so the hook can still be launched once PATH has
# been emptied for the no-jq case below.
bash_bin="${BASH:-}"
case "$bash_bin" in
  /*) ;;
  *) bash_bin="$(command -v bash)" ;;
esac

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

# Drops a copy of the hook into a throwaway tree, so a case can control what
# the hook finds next to itself. $1 is the tree root.
install_hook_at() {
  mkdir -p "$1/hooks"
  cp "$HOOK" "$1/hooks/session-start.sh"
}

# --- Case 1: the hook as installed -----------------------------------------
"$bash_bin" "$HOOK" > "$work_dir/default.json"

# --- Case 2: the same hook with jq (and everything else) off PATH ----------
# PATH points at an empty directory, so no external command is reachable at
# all. That is a stricter version of "jq is not installed" and it fails loudly
# if the hook ever grows a dependency on cat/dirname/sed/node/....
empty_bin="$work_dir/empty-bin"
mkdir -p "$empty_bin"

# Positive control: prove the absence is real before asserting behaviour over
# it, otherwise this case passes for the wrong reason on a machine where the
# stripped PATH leaks.
if ( PATH="$empty_bin"; export PATH; command -v jq >/dev/null 2>&1 ); then
  echo "FAIL: no-jq case is vacuous - jq is still reachable on the stripped PATH" >&2
  exit 1
fi

( PATH="$empty_bin"; export PATH; "$bash_bin" "$HOOK" ) > "$work_dir/no-path.json"

# --- Case 3: the catalog file is missing ------------------------------------
# A tree with no skills/ directory next to the hook. A non-zero exit here fails
# the run under `set -e`, which is the assertion that the hook still exits 0
# when it cannot find the catalog.
orphan="$work_dir/orphan"
install_hook_at "$orphan"
"$bash_bin" "$orphan/hooks/session-start.sh" > "$work_dir/missing.json"

# --- Case 4: a catalog full of characters that break naive escaping ---------
# The shipped SKILL.md contains no backslashes and no control characters, so a
# round trip against it cannot see a broken backslash or \u00xx rule. This
# fixture supplies both, plus quotes, tabs, a CRLF and multi-byte box drawing,
# and deliberately ends WITHOUT a trailing newline (the real catalog covers the
# with-newline case).
hostile="$work_dir/hostile"
install_hook_at "$hostile"
fixture="$hostile/skills/flowly-catalog/SKILL.md"
mkdir -p "$hostile/skills/flowly-catalog"
printf '%s' \
'# Flowly Skill Catalog

Backslashes: one\two, a double\\here, and one before the newline\
Escaped already: \\n and \" and \\\\
Quotes: "double" and '"'"'single'"'"' and `backticks`
Box drawing: ├── │ └─→ ✓
Tab:	after a tab
CRLF ends this line:' > "$fixture"
printf '\r\nControl characters: ESC[\x1b] VT[\x0b] BS[\x08] FF[\x0c]\nNo trailing newline here.' >> "$fixture"

"$bash_bin" "$hostile/hooks/session-start.sh" > "$work_dir/hostile.json"

# --- Case 5: the catalog exists but cannot be read --------------------------
# This one passes an existence check and then fails at the read, which is how a
# payload ends up injecting "agent-skills loaded." with no catalog behind it.
unreadable="$work_dir/unreadable"
install_hook_at "$unreadable"
mkdir -p "$unreadable/skills/flowly-catalog"
cp "$SKILL" "$unreadable/skills/flowly-catalog/SKILL.md"
chmod 000 "$unreadable/skills/flowly-catalog/SKILL.md"

payload_unreadable=""
if [ -r "$unreadable/skills/flowly-catalog/SKILL.md" ]; then
  # Positive control: root reads a chmod 000 file, so the state this case is
  # about does not exist here. Skip it rather than assert over an absence that
  # was never built.
  echo "SKIP: unreadable-catalog case - this user can read a chmod 000 file" >&2
else
  "$bash_bin" "$unreadable/hooks/session-start.sh" > "$work_dir/unreadable.json"
  payload_unreadable="$work_dir/unreadable.json"
fi

# --- Case 6: invoked by bare filename, so $0 has no directory part ----------
# `${0%/*}` returns $0 unchanged when there is no slash in it, which is a
# different branch from every case above.
( cd "${HOOK%/*}" && "$bash_bin" "${HOOK##*/}" ) > "$work_dir/bare-name.json"

PAYLOAD_DEFAULT="$work_dir/default.json" \
PAYLOAD_BARE_NAME="$work_dir/bare-name.json" \
PAYLOAD_NO_PATH="$work_dir/no-path.json" \
PAYLOAD_MISSING="$work_dir/missing.json" \
PAYLOAD_HOSTILE="$work_dir/hostile.json" \
PAYLOAD_UNREADABLE="$payload_unreadable" \
SKILL_FILE="$SKILL" \
FIXTURE_FILE="$fixture" \
node <<'NODE'
const fs = require('fs');

// Must match the preface the hook prepends to the catalog, byte for byte.
const PREFACE =
  'agent-skills loaded. Use the flowly-catalog phase tree and skill index to find the right skill for your task.\n\n';

// The envelope every SessionStart hook must emit, quoted from Claude Code's
// hook reference - the consumer's specification, not ours:
//
//   https://code.claude.com/docs/en/hooks#sessionstart
//
//   {
//     "hookSpecificOutput": {
//       "hookEventName": "SessionStart",
//       "additionalContext": "..."
//     }
//   }
//
// Do not re-derive this from what the hook prints. An expected value copied
// out of the code under test can only ever catch a regression, never a
// contract that was wrong from the first commit - which is exactly how this
// suite stayed green over a payload Claude Code was silently discarding. The
// URL is here so the next reader can re-check the source rather than trust
// this literal.
//
// Silent is the operative word: Claude Code parses any stdout beginning with
// `{` as JSON and injects nothing but additionalContext. An object carrying
// other keys parses fine, injects nothing, and reports nothing back to the
// hook. There is no local signal to assert on, so the shape is the assertion.
const DOCUMENTED_ENVELOPE =
  '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}';

function fail(message) {
  throw new Error(message);
}

// Every leaf key path in an object, sorted - so the emitted payload can be
// compared against the documented shape by structure rather than by eyeball.
// An extra key fails this, which is the case that matters: an unrecognised
// key is not rejected by the host, it is ignored by it.
function keyPaths(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.keys(value)
    .sort()
    .flatMap((key) => keyPaths(value[key], prefix ? `${prefix}.${key}` : key));
}

const EXPECTED_KEY_PATHS = keyPaths(JSON.parse(DOCUMENTED_ENVELOPE)).join(', ');

function parsePayload(label, file) {
  const raw = fs.readFileSync(file, 'utf8');

  if (raw.replace(/\n$/, '').includes('\n')) {
    fail(`${label}: payload is not a single line - a control character was emitted raw`);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    fail(`${label}: output is not valid JSON (${error.message})\n--- raw ---\n${raw.slice(0, 400)}`);
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    fail(`${label}: expected a JSON object, got ${JSON.stringify(payload)}`);
  }

  const actualKeyPaths = keyPaths(payload).join(', ');
  if (actualKeyPaths !== EXPECTED_KEY_PATHS) {
    fail(
      `${label}: envelope is [${actualKeyPaths}], but Claude Code documents ` +
        `[${EXPECTED_KEY_PATHS}]\n` +
        `  see https://code.claude.com/docs/en/hooks#sessionstart\n` +
        `  a payload with the wrong keys is injected nowhere and reports nothing`
    );
  }
  if (payload.hookSpecificOutput.hookEventName !== 'SessionStart') {
    fail(
      `${label}: hookEventName must be "SessionStart", got ` +
        JSON.stringify(payload.hookSpecificOutput.hookEventName)
    );
  }
  if (typeof payload.hookSpecificOutput.additionalContext !== 'string') {
    fail(
      `${label}: additionalContext is not a string, got ` +
        JSON.stringify(payload.hookSpecificOutput.additionalContext)
    );
  }
  if (/\bjq\b/i.test(contextOf(payload))) {
    fail(`${label}: context still talks about jq, which is no longer a dependency`);
  }
  return payload;
}

// The only part of the envelope Claude Code actually injects.
function contextOf(payload) {
  return payload.hookSpecificOutput.additionalContext;
}

function assertCatalogInjected(label, payload) {
  if (!contextOf(payload).includes('agent-skills loaded.')) {
    fail(`${label}: context is missing the startup preface`);
  }
  if (!contextOf(payload).includes('# Flowly Skill Catalog')) {
    fail(`${label}: context is missing flowly-catalog content`);
  }
}

// JSON.parse succeeding proves nothing about whether the markdown survived.
// Compare the decoded context against the file on disk byte for byte, so a
// mangled backslash, quote, control character or box-drawing glyph fails here.
function assertRoundTrip(label, payload, sourceFile) {
  const expected = Buffer.concat([Buffer.from(PREFACE, 'utf8'), fs.readFileSync(sourceFile)]);
  const actual = Buffer.from(contextOf(payload), 'utf8');
  if (actual.equals(expected)) return;

  let at = 0;
  while (at < expected.length && at < actual.length && expected[at] === actual[at]) at += 1;
  const window = (buffer) =>
    JSON.stringify(buffer.slice(Math.max(0, at - 40), at + 40).toString('utf8'));
  fail(
    `${label}: context does not round-trip ${sourceFile}\n` +
      `  expected ${expected.length} bytes, got ${actual.length}\n` +
      `  first difference at byte ${at}\n` +
      `  expected: ${window(expected)}\n` +
      `  actual:   ${window(actual)}`
  );
}

const defaultPayload = parsePayload('default', process.env.PAYLOAD_DEFAULT);
assertCatalogInjected('default', defaultPayload);
assertRoundTrip('default', defaultPayload, process.env.SKILL_FILE);

const barePayload = parsePayload('bare-name', process.env.PAYLOAD_BARE_NAME);
assertCatalogInjected('bare-name', barePayload);
assertRoundTrip('bare-name', barePayload, process.env.SKILL_FILE);

const noPathPayload = parsePayload('no-jq', process.env.PAYLOAD_NO_PATH);
assertCatalogInjected('no-jq', noPathPayload);

// The payload must not depend on what happens to be installed on the machine.
const defaultRaw = fs.readFileSync(process.env.PAYLOAD_DEFAULT);
const noPathRaw = fs.readFileSync(process.env.PAYLOAD_NO_PATH);
if (!defaultRaw.equals(noPathRaw)) {
  fail('no-jq: output differs from the default run - the hook is PATH-sensitive');
}

const hostilePayload = parsePayload('hostile-catalog', process.env.PAYLOAD_HOSTILE);
assertCatalogInjected('hostile-catalog', hostilePayload);
assertRoundTrip('hostile-catalog', hostilePayload, process.env.FIXTURE_FILE);

// Positive control for the fixture: if it ever loses the characters it exists
// to carry, the round trip above passes for the wrong reason.
const fixture = fs.readFileSync(process.env.FIXTURE_FILE, 'utf8');
for (const [name, needle] of [
  ['backslash', '\\'],
  ['double quote', '"'],
  ['tab', '\t'],
  ['carriage return', '\r'],
  ['ESC', '\u001b'],
  ['multi-byte glyph', '│'],
]) {
  if (!fixture.includes(needle)) {
    fail(`hostile-catalog: fixture no longer contains a ${name} - the case is vacuous`);
  }
}
if (fixture.endsWith('\n')) {
  fail('hostile-catalog: fixture must not end with a newline - that case is what it covers');
}

// The envelope has no severity channel, so this branch is told apart from an
// injected catalog by its context alone. The old "must not claim IMPORTANT"
// assertion went with the key it read; it is not missing by oversight.
function assertUnavailableCatalog(label, payload) {
  if (contextOf(payload).includes('# Flowly Skill Catalog')) {
    fail(`${label}: context should not contain catalog content`);
  }
  if (contextOf(payload).includes('agent-skills loaded.')) {
    fail(`${label}: context claims the catalog loaded when nothing was injected`);
  }
  if (!/not found/i.test(contextOf(payload))) {
    fail(`${label}: context does not say the catalog was unavailable: ${JSON.stringify(contextOf(payload))}`);
  }
  if (!contextOf(payload).includes('flowly-catalog')) {
    fail(`${label}: context does not name the missing catalog: ${JSON.stringify(contextOf(payload))}`);
  }
}

assertUnavailableCatalog('missing-catalog', parsePayload('missing-catalog', process.env.PAYLOAD_MISSING));

// Skipped when the harness runs as a user who can read a chmod 000 file; the
// bash side prints a SKIP line in that case.
if (process.env.PAYLOAD_UNREADABLE) {
  assertUnavailableCatalog(
    'unreadable-catalog',
    parsePayload('unreadable-catalog', process.env.PAYLOAD_UNREADABLE)
  );
}

console.log('session-start JSON payload OK');
NODE
