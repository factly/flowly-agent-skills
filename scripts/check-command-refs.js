#!/usr/bin/env node
/**
 * check-command-refs.js
 *
 * CLI that holds every `/command` this distribution WRITES to the commands it
 * actually SHIPS — resolved against `commands/` on disk, under the namespace a
 * user has to type.
 *
 * THE REGRESSION THIS CATCHES, AND WHY NOTHING ELSE COULD
 * -------------------------------------------------------
 * `check-commands.js` reads `commands/` and validates each command against the
 * skills it names. It looks outward from the command layer. Nothing looked the
 * other way: at the rest of the corpus, which tells a reader which command to
 * type. Four shipped agent personas carried an `Invoke via:` line naming
 * `/review`, `/ship`, `/test` and `/webperf`; `references/orchestration-patterns.md`
 * carried about fifteen more. Not one of them resolved. Three of the four names
 * exist here only under the `flowly:` namespace, so a user typing what the file
 * said got nothing; `/webperf` names no command in this distribution at all.
 *
 * That is not prose drift, and the cause is the ownership register. Every one of
 * those files was recorded `unchanged` — inherited and byte-identical to
 * upstream — which is the register saying no binding has ever been made to them.
 * Upstream ships those command names because upstream ships those commands. So
 * every monthly merge would have reinstated them, cleanly, with nothing to
 * report it.
 *
 * The failure is silent at the point of use in the same way a dead tool name is:
 * a user who types a command that does not exist gets no error from this
 * repository, just a harness shrug, and an agent reading the persona file gets a
 * confident instruction to do something impossible.
 *
 * WHY A SWEEP AND NOT ROWS IN check-binding.js
 * --------------------------------------------
 * The obvious cheaper home for this was `check-binding.js`, whose last three
 * `REQUIRED_BINDINGS` rows already handle exactly this class — a binding that
 * replaces a *convention* rather than a path, invisible to a grep for a
 * filesystem destination. It is the right instinct and it does not work here,
 * for one reason: those rows assert PRESENCE. `file X contains token Y`. A merge
 * that re-adds `/review` beside an existing `/flowly:review` satisfies every
 * such row and reinstates the dead pointer anyway.
 *
 * What this needs is an assertion about ABSENCE — that no unresolvable command
 * name appears anywhere — and absence cannot be listed file by file. It has to
 * be swept, with a rule for what resolves. That is `check-tool-drift.js`'s
 * shape, so this is `check-tool-drift.js`'s shape: sweep a corpus, extract names
 * by SHAPE, resolve each against what exists, and refuse to pass on an empty
 * extraction.
 *
 * WHAT COUNTS AS A COMMAND REFERENCE — THE TWO PLACES, AND WHY ONLY THOSE
 * ----------------------------------------------------------------------
 * A `/word` is a shape this corpus uses for several unrelated things: HTTP
 * routes (`/api/tasks/:id`), URL path segments, file-path fragments
 * (`docs/skill-anatomy.md`), JavaScript regex literals (`/log in/i`), and closing
 * HTML tags. Measured over the shipped trees, a naive `/[a-z-]+` sweep returns
 * dozens of these and two real bugs, and the tempting fix — a large allowlist —
 * grows forever and buries what it was written to find.
 *
 * The discriminator that works is the one `check-tool-drift.js` already uses:
 * the WHOLE code span, not a substring of one.
 *
 *   1. An inline code span whose entire content is the command:
 *      `` `/flowly:review` ``. `` `docs/skill-anatomy.md` `` is not, because the
 *      token is part of a longer span. This kills the entire false-positive
 *      class above in one rule.
 *   2. A whitespace-delimited token inside an UNTAGGED fenced block. Untagged
 *      fences in this corpus are diagrams and shell transcripts — the lifecycle
 *      arrow chain, the fan-out diagram, README's install block — and they name
 *      commands as bare text with no backticks available to them. A fence with a
 *      language tag is code, and the four false positives measured in this
 *      corpus (`/log`, `/new`, `/buy`, `/complete`, all fragments of regex
 *      literals in `references/testing-patterns.md`) are all inside ```typescript
 *      blocks. So the tag is the discriminator, and it costs nothing in recall.
 *
 * Plain prose outside a span is deliberately NOT scanned. This corpus writes
 * every command it means as code, and admitting bare prose would re-open the
 * false-positive class the span rule just closed.
 *
 * THE RESOLUTION RULE, AND WHY THE ALLOWLIST IS LOAD-BEARING
 * ----------------------------------------------------------
 * Every extracted reference is one of exactly four things:
 *
 *   - `/flowly:<name>` where `commands/<name>.md` exists     → resolves.
 *   - `/flowly:<name>` with no such file                     → dead pointer.
 *   - `/<name>` bare, where `<name>` IS one of ours          → a NAMESPACE error.
 *       This is the `/review`, `/ship`, `/test` case. The command exists; the
 *       spelling does not. A user types `/flowly:review`.
 *   - `/<name>` bare, naming nothing we ship                 → dead pointer,
 *       unless it is in EXTERNAL_COMMANDS below.
 *
 * That last clause is what makes the allowlist honest rather than a hiding
 * place: it is the ONLY way a bare non-flowly name passes, so every entry is
 * load-bearing and visible, and `checkExternalAllowlist` asserts it in both
 * directions — an entry that names one of our own commands is an error (that is
 * the guard being switched off in the shape of a bug fix), and an entry no
 * longer found anywhere in the corpus is an error (an exemption must not outlive
 * the text it excused).
 *
 * WHY AN EMPTY EXTRACTION IS AN ERROR
 * -----------------------------------
 * Every assertion here is about the references the extractor found, and every
 * one of them is trivially true of the empty set. So a corpus that names no
 * commands is an error rather than a pass — a sweep that has silently stopped
 * matching is a failure mode this repository has been bitten by before, and it
 * reads as coverage.
 *
 * THE SECOND DIRECTION, AND WHAT IT IS ACTUALLY WORTH
 * ---------------------------------------------------
 * The acceptance also asks for a shipped command that nothing references to be
 * an error, and it is — but it is a weaker rule than the first direction, and
 * the argument usually offered for it does not survive being measured.
 *
 * That argument is that it guards against PARTIAL extraction: a regex that stops
 * seeing one of the two forms drops recall without emptying the set, so the
 * vacuity guard above stays green over whatever is left. True in general, and
 * false here, which was established rather than assumed. Disarming the
 * inline-span branch of `extractCommandRefs`, and separately the fenced-block
 * branch, each turned this script red — but on the ALLOWLIST's second direction,
 * not on this check. `/plugin` occurs in this corpus only inside a fence and
 * `/loop` only inside an inline span, so between them the two exemptions happen
 * to be a canary for one form each; meanwhile all six commands are named in BOTH
 * forms, so losing either one leaves all six referenced and this check green.
 *
 * What it does catch, and what keeps it: a command the corpus never names at
 * all. The likeliest way to get one is to add a seventh command —
 * `check-commands.js` would accept it as long as its own list is widened,
 * `check-catalog.js` has no opinion about commands, and a command that no
 * persona, reference or root file points at is one users do not discover. It
 * also reports a total extraction failure one command at a time, which is a more
 * actionable page than the vacuity line by itself.
 *
 * That is a real but modest job, and it is written down at its real size,
 * because a check credited with more than it does is how the thing it does not
 * do stops being anybody's.
 *
 * WHAT IS SCANNED, AND THE GAP THAT IS LEFT OPEN ON PURPOSE
 * ---------------------------------------------------------
 * The four shipped trees — `skills/`, `references/`, `agents/`, `commands/` —
 * plus the root prose files. The four trees are exactly the ownership register's
 * scope, so "shipped" has one definition in this repository rather than two, and
 * they are what an agent reads mid-run. The root files are what a human reads
 * before typing anything.
 *
 * `docs/` IS scanned, via PROSE_TREES. It was not, when this header was first
 * written: the gap was recorded here as a known bug for a different task, and
 * then that task closed it. The paragraph outlived its own subject by a phase,
 * which is the failure mode the scan itself exists to catch — a claim about the
 * corpus that nothing re-checks. It is rewritten rather than deleted so the next
 * reader can see that the split was considered and then abandoned: a stale
 * command in `docs/` misleads a human at a calmer moment than one in a shipped
 * skill misleads an agent mid-run, but both are wrong and neither is expensive
 * to check.
 *
 * Usage:
 *   node scripts/check-command-refs.js
 *   node scripts/check-command-refs.js --root <dir>   # scan another corpus
 *
 * Exit codes: 0 = all clear, 1 = one or more errors
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..');

// The four trees this distribution ships, and the register's exact scope.
const SHIPPED_TREES = ['skills', 'references', 'agents', 'commands'];

// The prose trees. Not part of the register (see NOTICE.md § Scope), and
// deliberately in scope anyway.
//
// `check-tool-drift.js` stops at the register's four trees and says so: a tool
// name in a guide is "prose for humans, a lesser and different harm". That
// reasoning does not transfer here, and the difference is worth stating rather
// than inheriting. A tool name is something an agent emits; a command name is
// something a *human types*, so prose is not a lesser harm for it — prose is
// where the harm lands. `docs/agents.md` is the case that settles it: all four
// agent personas end with "See docs/agents.md", so a reader who follows the
// rebound `Invoke via:` line arrives at the page that still said `/webperf`.
// Fixing the persona and not the page it points at moves a dead pointer one hop
// and calls it repaired.
const PROSE_TREES = ['docs'];

// The root prose. Same argument: it is where a human is told what to type, so a
// dead pointer here reaches a user before any skill does.
const ROOT_PROSE = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'NOTICE.md'];

const SCANNED_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);

// The directory the commands live in, and the namespace they are addressed
// through — `name` in `.claude-plugin/plugin.json`. The command SET is read off
// disk rather than listed here: `check-commands.js` owns the claim that it is
// exactly six, and duplicating that list would give this check a second opinion
// about it.
const COMMANDS_DIR       = 'commands';
const COMMAND_NAMESPACE  = 'flowly';

/**
 * Commands that are real but are not ours — the harness's, or another plugin's.
 *
 * Keep this small. Every entry is the one route by which a bare, un-namespaced
 * name passes this check, so each is a hole, and the bar is that the command
 * genuinely exists outside this distribution and genuinely appears in the
 * corpus. A dead pointer must never be parked here: the fix for a dead pointer
 * is to say what the reader should do instead.
 *
 * Asserted in both directions by `checkExternalAllowlist`.
 */
const EXTERNAL_COMMANDS = new Map([
  ['plugin',
   "Claude Code's built-in plugin manager — README's install block is a transcript of `/plugin marketplace add` and `/plugin install`"],
  ['loop',
   'a harness-provided command, named by two inherited skills as an example of a non-interactive context an interview must not run in'],
  ['compact',
   "Claude Code's built-in context compaction — `references/agent-delegation.md` measures where a real run's compaction boundaries fell, and each one was invoked by typing this"],
]);

// ─── Report plumbing (the shape check-tool-drift.js prints) ──────────────────

const HINT_PREFIX = '  ↳';

/**
 * A check accumulates two kinds of line in one array: a failure, and a `↳` hint
 * explaining how to fix it. The summary must count the failures only — counting
 * hints once reported three failing files as nine.
 */
function countFailures(errors) {
  return errors.filter(e => !e.startsWith(HINT_PREFIX)).length;
}

// ─── Extraction ──────────────────────────────────────────────────────────────

// A slash command: a leading `/`, a lowercase kebab name, optionally namespaced.
// Anchored, because the whole point is that the token is the WHOLE thing being
// looked at rather than a substring of a longer path.
const COMMAND_REF_RE = /^\/([a-z][a-z0-9-]*)(?::([a-z][a-z0-9-]*))?$/;

// An inline code span: a run of backticks, its contents, and a matching run.
const INLINE_SPAN_RE = /(`+)([^`]+)\1/g;

// A fence line, capturing the info string. An empty capture is an untagged
// fence — a diagram or a transcript — and those are the only ones scanned.
const FENCE_RE = /^\s*(?:`{3,}|~{3,})\s*(\S*)\s*$/;

/** Split a reference into `{ namespace, name }`; `null` if it is not one. */
function parseCommandRef(token) {
  const m = COMMAND_REF_RE.exec(token);
  if (m === null) return null;
  return m[2] === undefined
    ? { namespace: null, name: m[1] }
    : { namespace: m[1], name: m[2] };
}

/**
 * Every command reference in one file's text, as `{ ref, line }` with 1-based
 * line numbers. See the header for the two forms and why plain prose is not one.
 */
function extractCommandRefs(text) {
  const found = [];
  const lines = text.split('\n');
  let fence = null;

  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = FENCE_RE.exec(lines[i]);
    if (fenceMatch !== null) {
      // A closing fence ends whatever was open; an opening one records whether
      // it carries a language tag, which is what decides if it is scanned.
      fence = fence === null ? (fenceMatch[1] === '' ? 'plain' : 'code') : null;
      continue;
    }

    if (fence === 'code') continue;

    if (fence === 'plain') {
      for (const token of lines[i].split(/[\s,;]+/)) {
        if (COMMAND_REF_RE.test(token)) found.push({ ref: token, line: i + 1 });
      }
      continue;
    }

    for (const span of lines[i].matchAll(INLINE_SPAN_RE)) {
      // Tokenised, not tested whole. Matching the entire span body against an
      // anchored pattern meant a span held at most one reference, and the two
      // shapes that escaped are the two this corpus writes most:
      //
      //     `/flowly:plan FLO-1234`        a command with its argument — and
      //                                    taking an argument is this product
      //     `/spec → /plan → /build`       a lifecycle sequence
      //
      // Both read as command references to every human and were invisible here,
      // which is how two dead commands survived a check written to find them.
      // Splitting on the same delimiters as the untagged-fence branch above
      // keeps one definition of "a token" for both.
      for (const token of span[2].trim().split(/[\s,;]+/)) {
        if (COMMAND_REF_RE.test(token)) found.push({ ref: token, line: i + 1 });
      }
    }
  }

  return found;
}

/** Every scannable file under `root`, repo-relative, trees then root prose. */
function corpusFiles(root) {
  const files = [];

  const walk = dir => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!SCANNED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      files.push(abs);
    }
  };

  for (const tree of SHIPPED_TREES) walk(path.join(root, tree));
  for (const tree of PROSE_TREES) walk(path.join(root, tree));
  for (const name of ROOT_PROSE) {
    const abs = path.join(root, name);
    if (fs.existsSync(abs)) files.push(abs);
  }
  return files;
}

/** The commands this distribution ships, read off disk. */
function commandsOnDisk(root) {
  const dir = path.join(root, COMMANDS_DIR);
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && path.extname(e.name).toLowerCase() === '.md')
      .map(e => path.basename(e.name, path.extname(e.name)))
  );
}

/**
 * Scan a corpus root. Returns each distinct reference mapped to every
 * `file:line` that writes it — an error that names a command without naming the
 * line to edit is an error somebody has to grep for.
 */
function scanCorpus(root) {
  const files = corpusFiles(root);
  const refs = new Map();
  const externalSightings = new Map();

  for (const abs of files) {
    const rel  = path.relative(root, abs).split(path.sep).join('/');
    const text = fs.readFileSync(abs, 'utf8');

    for (const { ref, line } of extractCommandRefs(text)) {
      if (!refs.has(ref)) refs.set(ref, []);
      refs.get(ref).push(`${rel}:${line}`);

      const parsed = parseCommandRef(ref);
      if (parsed.namespace === null && EXTERNAL_COMMANDS.has(parsed.name)) {
        if (!externalSightings.has(parsed.name)) externalSightings.set(parsed.name, []);
        externalSightings.get(parsed.name).push(`${rel}:${line}`);
      }
    }
  }

  return { files, refs, externalSightings };
}

// ─── Checks ──────────────────────────────────────────────────────────────────

/**
 * Check 1 — the vacuity guard.
 *
 * Every assertion below is about the references the extractor found, and all of
 * them are true of the empty set. This is what separates a green run that means
 * something from a green run that means the sweep found nothing.
 */
function checkCorpusNamesCommands(refs, files, shipped, report) {
  const errors = [];

  if (files.length === 0) {
    errors.push(`no files scanned under ${[...SHIPPED_TREES, ...PROSE_TREES].map(t => `${t}/`).join(', ')} or the root prose`);
    errors.push(`${HINT_PREFIX} the corpus root is wrong, or the shipped trees are missing.`);
  } else if (shipped.size === 0) {
    errors.push(`no command found at ${COMMANDS_DIR}/*.md — there is nothing to resolve against`);
    errors.push(`${HINT_PREFIX} every reference below would be reported as dead for the same wrong reason.`);
  } else if (refs.size === 0) {
    errors.push(`${files.length} file(s) scanned and not one command reference found`);
    errors.push(`${HINT_PREFIX} every check below is vacuously true over an empty set, so this is an error`);
    errors.push(`${HINT_PREFIX} and not a pass. Either the corpus stopped naming commands, or the extractor`);
    errors.push(`${HINT_PREFIX} stopped seeing them — the second is the dangerous one.`);
  }

  report(
    errors,
    'the corpus names commands',
    `${refs.size} distinct reference(s) across ${files.length} file(s), ${shipped.size} command(s) on disk`,
  );
  return countFailures(errors);
}

/**
 * Check 2 — the acceptance.
 *
 * Every reference resolves to a command on disk, under the namespace a user
 * actually types. The four outcomes and the reason each is separate are in the
 * header; the messages differ because the fixes differ, and a namespace error
 * repaired as though it were a dead pointer deletes a working instruction.
 */
function checkRefsResolve(refs, shipped, report) {
  const errors = [];

  for (const [ref, places] of [...refs].sort((a, b) => a[0].localeCompare(b[0]))) {
    const { namespace, name } = parseCommandRef(ref);
    const where = places.join(', ');

    if (namespace === COMMAND_NAMESPACE) {
      if (shipped.has(name)) continue;
      errors.push(`\`${ref}\` names no command — there is no ${COMMANDS_DIR}/${name}.md (at ${where})`);
      errors.push(`${HINT_PREFIX} either the command was renamed or removed, or this is a typo.`);
      continue;
    }

    if (namespace !== null) {
      errors.push(`\`${ref}\` is in the \`${namespace}:\` namespace, and this plugin is \`${COMMAND_NAMESPACE}:\` (at ${where})`);
      errors.push(`${HINT_PREFIX} the namespace comes from \`name\` in .claude-plugin/plugin.json.`);
      continue;
    }

    if (shipped.has(name)) {
      errors.push(`\`${ref}\` is written bare, but a user has to type \`/${COMMAND_NAMESPACE}:${name}\` (at ${where})`);
      errors.push(`${HINT_PREFIX} the command exists; the spelling does not. This is the exact line an upstream`);
      errors.push(`${HINT_PREFIX} merge reinstates, because upstream ships this command un-namespaced.`);
      continue;
    }

    if (EXTERNAL_COMMANDS.has(name)) continue;

    errors.push(`\`${ref}\` names no command this distribution ships (at ${where})`);
    errors.push(`${HINT_PREFIX} the six are ${[...shipped].sort().map(c => `/${COMMAND_NAMESPACE}:${c}`).join(', ')}.`);
    errors.push(`${HINT_PREFIX} do not rename it to another command that also does not exist — say what the`);
    errors.push(`${HINT_PREFIX} reader should do instead, or add it to EXTERNAL_COMMANDS if it is the harness's.`);
  }

  report(
    errors,
    'every command reference resolves',
    `${refs.size} reference(s), each a shipped command or a declared external one`,
  );
  return countFailures(errors);
}

/**
 * Check 3 — the second direction.
 *
 * The weaker of the two, deliberately kept, and the header says at what size:
 * it catches a command the corpus never names — most plausibly a seventh one
 * added with nothing pointing at it — and it does NOT catch the partial
 * extraction it is often credited with, which was measured.
 */
function checkEveryCommandIsReferenced(refs, shipped, report) {
  const errors = [];
  const referenced = new Set();

  for (const ref of refs.keys()) {
    const { namespace, name } = parseCommandRef(ref);
    if (namespace === COMMAND_NAMESPACE && shipped.has(name)) referenced.add(name);
  }

  const orphans = [...shipped].filter(c => !referenced.has(c)).sort();
  for (const name of orphans) {
    errors.push(`\`/${COMMAND_NAMESPACE}:${name}\` is shipped at ${COMMANDS_DIR}/${name}.md but nothing references it`);
  }
  if (orphans.length > 0) {
    errors.push(`${HINT_PREFIX} nothing a user types is broken by this. What it catches is a command nothing`);
    errors.push(`${HINT_PREFIX} points at — most likely one just added — which is a command users never find.`);
    errors.push(`${HINT_PREFIX} Name it where a reader would look, or remove it. See this script's header for`);
    errors.push(`${HINT_PREFIX} the partial-extraction case this check does NOT cover.`);
  }

  report(
    errors,
    'every shipped command is referenced',
    `${referenced.size} of ${shipped.size} command(s) named by the corpus`,
  );
  return countFailures(errors);
}

/**
 * Check 4 — the false-negative direction.
 *
 * A command whose name the extractor cannot recognise is a command this guard
 * silently stops watching: the corpus could name it, misname it, or go on naming
 * it after it is gone, and nothing here would notice. Today the shapes agree
 * trivially; a command file named with an underscore or a capital would break it
 * and this is what says so.
 */
function checkExtractorCanSeeEveryCommand(shipped, report) {
  const errors = [];
  const invisible = [...shipped]
    .filter(name => parseCommandRef(`/${COMMAND_NAMESPACE}:${name}`) === null)
    .sort();

  for (const name of invisible) {
    errors.push(`\`/${COMMAND_NAMESPACE}:${name}\` cannot be recognised by the extractor's shape`);
  }
  if (invisible.length > 0) {
    errors.push(`${HINT_PREFIX} rename the file to lowercase kebab-case, or widen COMMAND_REF_RE in this script.`);
    errors.push(`${HINT_PREFIX} until then the corpus can name it, or misname it, and this check cannot tell.`);
  }

  report(
    errors,
    'the extractor can recognise every shipped command',
    `${shipped.size} command name(s) match the reference shape`,
  );
  return countFailures(errors);
}

/**
 * Check 5 — the external allowlist is honest in both directions.
 *
 * The second direction is a claim about THIS repository's prose — "the text that
 * made this exemption necessary is still there" — so it is only asked of this
 * repository's corpus. Under `--root` it is skipped and the report says so.
 */
function checkExternalAllowlist(shipped, sightings, isOwnCorpus, report) {
  const errors = [];

  for (const [name, reason] of EXTERNAL_COMMANDS) {
    if (shipped.has(name)) {
      errors.push(`\`/${name}\` is exempted as an external command but IS shipped at ${COMMANDS_DIR}/${name}.md`);
      errors.push(`${HINT_PREFIX} delete the entry. Exempting our own command is this guard being switched off`);
      errors.push(`${HINT_PREFIX} for the one name a merge is most likely to un-namespace.`);
      continue;
    }
    if (isOwnCorpus && !sightings.has(name)) {
      errors.push(`\`/${name}\` is exempted but no longer appears anywhere in the corpus`);
      errors.push(`${HINT_PREFIX} the exemption has outlived the text it excused ("${reason}") — delete it.`);
    }
  }

  const earned = isOwnCorpus
    ? 'each external and each still in the corpus'
    : "each external (the still-in-the-corpus half needs this repo's own corpus, skipped under --root)";

  report(
    errors,
    'the external-command allowlist is still earned',
    EXTERNAL_COMMANDS.size === 0
      ? 'empty — no bare command name needs an exemption'
      : `${EXTERNAL_COMMANDS.size} exemption(s), ${earned}`,
  );
  return countFailures(errors);
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * `--root` exists so the checks above have readers. The vacuity guard needs a
 * corpus that names no commands and the resolution rule needs a corpus that
 * names a wrong one, and neither state can be reached without either editing the
 * repository or asserting nothing. It is a test seam and it changes nothing
 * about the default invocation.
 */
function parseArgs(argv) {
  const options = { root: REPO_ROOT };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      const value = argv[++i];
      if (!value) throw new Error('--root needs a directory path');
      options.root = path.resolve(value);
      continue;
    }
    throw new Error(`unknown argument: ${argv[i]}`);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  let errorCount = 0;

  const report = (errors, name, okMessage) => {
    if (errors.length === 0) {
      console.log(`  ✓  ${name}${okMessage ? ` — ${okMessage}` : ''}`);
      return;
    }
    console.log(`  ✗  ${name}`);
    for (const msg of errors) {
      console.log(msg.startsWith(HINT_PREFIX) ? `       ${msg}` : `       ERROR: ${msg}`);
    }
  };

  console.log('Command references — the corpus against the commands on disk\n');

  const shipped = commandsOnDisk(options.root);
  const { files, refs, externalSightings } = scanCorpus(options.root);

  console.log(`  Corpus:    ${[...SHIPPED_TREES, ...PROSE_TREES].map(t => `${t}/`).join(' ')} + ${ROOT_PROSE.length} root file(s)`);
  console.log(`  Namespace: /${COMMAND_NAMESPACE}:<command>`);
  console.log(`  Commands:  ${shipped.size === 0 ? '(none)' : [...shipped].sort().join(', ')}\n`);

  errorCount += checkCorpusNamesCommands(refs, files, shipped, report);
  errorCount += checkRefsResolve(refs, shipped, report);
  errorCount += checkEveryCommandIsReferenced(refs, shipped, report);
  errorCount += checkExtractorCanSeeEveryCommand(shipped, report);
  errorCount += checkExternalAllowlist(shipped, externalSightings, options.root === REPO_ROOT, report);

  const status = errorCount > 0 ? 'FAILED' : 'PASSED';
  console.log(
    `\n${files.length} file(s) scanned, ${refs.size} command reference(s), ` +
    `${shipped.size} command(s) on disk — ${errorCount} error(s) — ${status}`
  );

  if (errorCount > 0) process.exit(1);
}

module.exports = {
  extractCommandRefs,
  parseCommandRef,
  commandsOnDisk,
  scanCorpus,
  COMMAND_NAMESPACE,
  EXTERNAL_COMMANDS,
  SHIPPED_TREES,
  PROSE_TREES,
  ROOT_PROSE,
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`\nERROR: check-command-refs failed: ${err.message}`);
    process.exit(1);
  }
}
