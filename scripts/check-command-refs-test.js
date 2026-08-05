#!/usr/bin/env node
/**
 * Tests for check-command-refs.js.
 *
 * The Verify clause of the task that authored the check asks for both
 * directions to be shown red, and neither can be reached by running the check
 * against this repository — a green tree has no dead pointer in it and names
 * every command. That is what `--root` is for: each direction is driven against
 * a sandbox corpus built to have the defect, and every one of those is paired
 * with a positive control built the same way *without* it. The control is not
 * decoration. "A corpus with a dead pointer fails" is also satisfied by a
 * sandbox that can never pass at all, and that failure mode looks identical
 * from the assertion's side.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  extractCommandRefs,
  parseCommandRef,
  commandsOnDisk,
  scanCorpus,
  COMMAND_NAMESPACE,
  EXTERNAL_COMMANDS,
} = require('./check-command-refs');

const REPO_ROOT = path.resolve(__dirname, '..');
const CHECK     = path.join(__dirname, 'check-command-refs.js');

// The corpus is expected to keep naming commands. This floor is what turns a
// silently narrowing extractor into a red run here as well as in the check: a
// regex that stopped matching one of the two forms would drop recall without
// failing any assertion that only asks whether the set is non-empty.
const MIN_REFS_IN_CORPUS = 6;

function run(args = []) {
  return spawnSync(process.execPath, [CHECK, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
}

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-command-refs-test-'));
}

const refs = text => extractCommandRefs(text).map(r => r.ref);

/**
 * A corpus root with the six commands on disk and one skill whose body is
 * `text`. Built to mirror the real tree closely enough that the only difference
 * between a passing sandbox and a failing one is the body.
 */
function corpusWith(text, commands = ['research', 'plan', 'build', 'test', 'review', 'ship']) {
  const root = sandbox();

  const commandsDir = path.join(root, 'commands');
  fs.mkdirSync(commandsDir, { recursive: true });
  for (const name of commands) {
    fs.writeFileSync(path.join(commandsDir, `${name}.md`), `---\nname: ${name}\n---\n\nbody\n`);
  }

  const skillDir = path.join(root, 'skills', 'sample-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: sample-skill\ndescription: A sample.\n---\n\n# sample-skill\n\n${text}\n`,
  );

  return root;
}

/** The body of a corpus that names all six commands correctly. */
const ALL_SIX = [
  'Run `/flowly:research`, then `/flowly:plan`, then `/flowly:build`.',
  'Then `/flowly:test`, `/flowly:review` and `/flowly:ship`.',
].join('\n');

// ─── Extraction: the inline-span form ────────────────────────────────────────

test('extracts a command that is the whole code span', () => {
  assert.deepEqual(refs('Run `/flowly:review` when the work is done.'), ['/flowly:review']);
});

test('extracts a bare command, because that is the bug being hunted', () => {
  // The namespace error is the whole point. If the extractor only saw
  // namespaced references it would be blind to the exact line an upstream merge
  // reinstates.
  assert.deepEqual(refs('Run `/review` when the work is done.'), ['/review']);
});

test('a path fragment inside a longer span is not a command', () => {
  // The discriminator, stated as a pair. The negative alone would pass for any
  // reason at all, including an extractor that has stopped working.
  assert.deepEqual(refs('See `docs/skill-anatomy.md` for the format.'), []);
  assert.deepEqual(refs('See `/flowly:plan` for the format.'), ['/flowly:plan']);
});

test('an HTTP route is not a command, and neither is a settings path', () => {
  assert.deepEqual(refs('`/api/tasks/:id` and `/settings/tokens` and `/mcp/`'), []);
});

test('a slash between two spans is not a command', () => {
  // `` `any`/`unknown` `` puts a `/` immediately after a closing backtick.
  // Scanning only span *contents* is what keeps this out.
  assert.deepEqual(refs('Question gratuitous `any`/`unknown`/optional casts.'), []);
});

test('command references in prose outside a span are not extracted', () => {
  // Deliberate, and stated so it is a decision rather than an accident: this
  // corpus writes every command it means as code, and admitting bare prose
  // re-opens the false-positive class the span rule closes.
  assert.deepEqual(refs('Just type /flowly:review and wait.'), []);
  assert.deepEqual(refs('Just type `/flowly:review` and wait.'), ['/flowly:review']);
});

// ─── Extraction: the fenced form ─────────────────────────────────────────────

test('extracts commands from an untagged fence, where diagrams live', () => {
  const text = ['```', 'user runs:  /flowly:plan  →  /flowly:build', '```'].join('\n');

  assert.deepEqual(refs(text), ['/flowly:plan', '/flowly:build']);
});

test('a tagged fence is code, and its regex literals are not commands', () => {
  // Measured against references/testing-patterns.md, whose ```typescript block
  // contains `{ name: /log in/i }` — four such fragments were the entire
  // false-positive set the tag rule removes.
  const code = ['```typescript', 'await page.getByRole("button", { name: /log in/i }).click();', '```'].join('\n');
  const plain = ['```', 'await page.getByRole("button", { name: /log in/i }).click();', '```'].join('\n');

  assert.deepEqual(refs(code), []);
  // The positive control for the rule itself: the same line in an untagged
  // fence IS extracted, so the tag is doing the work and not the line's shape.
  assert.deepEqual(refs(plain), ['/log']);
});

test('a fence closes, and text after it is read as prose again', () => {
  const text = ['```typescript', 'const x = 1;', '```', 'Then run `/flowly:ship`.'].join('\n');

  assert.deepEqual(refs(text), ['/flowly:ship']);
});

// ─── Parsing ─────────────────────────────────────────────────────────────────

test('splits a namespaced reference and a bare one', () => {
  assert.deepEqual(parseCommandRef('/flowly:review'), { namespace: 'flowly', name: 'review' });
  assert.deepEqual(parseCommandRef('/review'), { namespace: null, name: 'review' });
  assert.equal(parseCommandRef('/api/tasks'), null);
  assert.equal(parseCommandRef('/Review'), null);
});

// ─── Direction 1: a reference that resolves to nothing ───────────────────────

test('a bare form of a shipped command is a namespace error, not a dead pointer', () => {
  const root = corpusWith(`${ALL_SIX}\n\nAlso mentions \`/review\`.`);

  const result = run(['--root', root]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /`\/review` is written bare, but a user has to type `\/flowly:review`/);
  // The two are reported differently because the fixes differ: a namespace
  // error repaired as though it were a dead pointer deletes a real instruction.
  assert.doesNotMatch(result.stdout, /`\/review` names no command this distribution ships/);
  assert.match(result.stdout, /1 error\(s\) — FAILED/);
});

test('a command this fork does not ship in any spelling is a dead pointer', () => {
  const root = corpusWith(`${ALL_SIX}\n\nRun \`/webperf\` for a performance pass.`);

  const result = run(['--root', root]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /`\/webperf` names no command this distribution ships/);
  assert.match(result.stdout, /do not rename it to another command that also does not exist/);
});

test('a namespaced command with no file behind it is reported as missing', () => {
  const root = corpusWith(`${ALL_SIX}\n\nRun \`/flowly:webperf\`.`);

  const result = run(['--root', root]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /`\/flowly:webperf` names no command — there is no commands\/webperf\.md/);
});

test('another plugin\'s namespace is reported as the wrong namespace', () => {
  const root = corpusWith(`${ALL_SIX}\n\nRun \`/other:review\`.`);

  const result = run(['--root', root]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /is in the `other:` namespace, and this plugin is `flowly:`/);
});

test('the same corpus without the defect passes — the defect is what turned it red', () => {
  // The positive control for the four tests above. Same builder, same commands
  // on disk, only the offending sentence removed.
  const result = run(['--root', corpusWith(ALL_SIX)]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /0 error\(s\) — PASSED/);
});

test('the error names the file and line to edit, not just the command', () => {
  const root = corpusWith(`${ALL_SIX}\n\nRun \`/webperf\`.`);

  const result = run(['--root', root]);

  assert.match(result.stdout, /skills\/sample-skill\/SKILL\.md:\d+/);
});

// ─── Direction 2: a shipped command nothing references ───────────────────────

test('a shipped command nothing references is an error', () => {
  // The weaker direction, kept at the size the check's header argues for: it
  // catches a command the corpus never names, most plausibly a newly added one
  // nothing points at. Measured against this repository it does NOT catch a
  // half-disarmed extractor — see the header — so this sandbox is the only
  // place it can be shown red, and that is why the sandbox exists.
  const root = corpusWith(ALL_SIX.replace('`/flowly:ship`', 'the ship step'));

  const result = run(['--root', root]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /`\/flowly:ship` is shipped at commands\/ship\.md but nothing references it/);
  assert.match(result.stdout, /1 error\(s\) — FAILED/);
});

test('a bare mention does not count as referencing the command it names', () => {
  // Otherwise the two directions would cancel: a corpus full of un-namespaced
  // references would satisfy direction 2 while failing direction 1, and a later
  // "fix" that only silenced direction 1 could quietly leave nothing behind.
  const root = corpusWith(ALL_SIX.replace('`/flowly:ship`', '`/ship`'));

  const result = run(['--root', root]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /`\/flowly:ship` is shipped at commands\/ship\.md but nothing references it/);
  assert.match(result.stdout, /`\/ship` is written bare/);
  assert.match(result.stdout, /2 error\(s\) — FAILED/);
});

test('the same corpus naming all six passes — direction 2 is reachable', () => {
  const result = run(['--root', corpusWith(ALL_SIX)]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /6 of 6 command\(s\) named by the corpus/);
});

// ─── The vacuity guard ───────────────────────────────────────────────────────

test('fails on a corpus that names no command at all', () => {
  const root = corpusWith('It discusses `docs/skill-anatomy.md` and `/api/tasks/:id` and nothing else.');

  const result = run(['--root', root]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /not one command reference found/);
  assert.match(result.stdout, /vacuously true over an empty set/);
});

test('fails on an empty corpus root', () => {
  const result = run(['--root', sandbox()]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /no files scanned/);
});

test('fails when there is no command on disk to resolve against', () => {
  const root = corpusWith(ALL_SIX, []);

  const result = run(['--root', root]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /no command found at commands\/\*\.md/);
});

// ─── The allowlist, in both directions ───────────────────────────────────────

test('an allowlisted external command passes where a bare unknown one fails', () => {
  const [external] = [...EXTERNAL_COMMANDS.keys()];

  const allowed = run(['--root', corpusWith(`${ALL_SIX}\n\nRun \`/${external}\`.`)]);
  const unknown = run(['--root', corpusWith(`${ALL_SIX}\n\nRun \`/not-a-real-command\`.`)]);

  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
  assert.equal(unknown.status, 1, unknown.stdout + unknown.stderr);
  assert.match(unknown.stdout, /`\/not-a-real-command` names no command this distribution ships/);
});

test('no allowlisted name collides with a command this fork ships', () => {
  // The direction the check enforces at runtime, asserted here against the real
  // command set too: an exemption for one of our own names is the guard being
  // switched off for the name a merge is most likely to un-namespace.
  const shipped = commandsOnDisk(REPO_ROOT);

  for (const name of EXTERNAL_COMMANDS.keys()) {
    assert.equal(shipped.has(name), false, `/${name} is exempted but is a shipped command`);
  }
});

test('every allowlisted name still appears in the corpus', () => {
  // The self-retiring half. An exemption whose text has been reworded away is a
  // permanent hole held open by nobody remembering to close it, and the next
  // false positive it swallows will be a real one.
  const { externalSightings } = scanCorpus(REPO_ROOT);

  for (const name of EXTERNAL_COMMANDS.keys()) {
    assert.ok(externalSightings.has(name), `/${name} is exempted but appears nowhere`);
  }
});

// ─── The shipped corpus ──────────────────────────────────────────────────────

test('the shipped corpus keeps naming commands, and every one resolves', () => {
  const shipped = commandsOnDisk(REPO_ROOT);
  const { files, refs: found } = scanCorpus(REPO_ROOT);

  assert.ok(files.length > 0, 'no corpus files were scanned');
  assert.ok(
    found.size >= MIN_REFS_IN_CORPUS,
    `extracted ${found.size} references, expected at least ${MIN_REFS_IN_CORPUS}`,
  );

  for (const ref of found.keys()) {
    const { namespace, name } = parseCommandRef(ref);
    const ok = namespace === COMMAND_NAMESPACE
      ? shipped.has(name)
      : namespace === null && EXTERNAL_COMMANDS.has(name);
    assert.ok(ok, `${ref} is written by the corpus but resolves to nothing`);
  }
});

test('the four shipped personas name only namespaced commands', () => {
  // The regression this check was written for, pinned to the files it was found
  // in. A merge that reverts one of these four `Invoke via:` lines fails here
  // with the persona named, not only in the aggregate.
  for (const persona of fs.readdirSync(path.join(REPO_ROOT, 'agents'))) {
    if (!persona.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(REPO_ROOT, 'agents', persona), 'utf8');
    for (const ref of refs(text)) {
      assert.match(ref, /^\/flowly:/, `agents/${persona} names ${ref}`);
    }
  }
});

test('the default invocation passes against the shipped corpus', () => {
  const result = run();

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /0 error\(s\) — PASSED/);
});

test('rejects an unknown argument rather than ignoring it', () => {
  const result = run(['--no-such-flag']);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /unknown argument/);
});

test('--root without a path says so rather than scanning the repo', () => {
  const result = run(['--root']);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /--root needs a directory path/);
});
