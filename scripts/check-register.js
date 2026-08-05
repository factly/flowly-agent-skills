#!/usr/bin/env node
/**
 * check-register.js
 *
 * CLI that holds the ownership register in NOTICE.md to the tree it describes.
 * The register is what a monthly upstream merge is resolved against, so it is
 * only worth having if it is true: this script is its reader.
 *
 * It asserts the following, and reports each separately:
 *
 *   1. Bidirectional completeness — every tracked file in the four in-scope
 *      trees has exactly one register row, and every register row names a
 *      tracked file. The two directions get different messages: a file in the
 *      tree but not the register is an addition nobody registered; a row with
 *      no file is a stale row.
 *   2. Status validity — every status is one of the four defined words.
 *   2a. Skill directory naming — a skill the register calls ours (`new` or
 *      `owned`) carries the `flowly-` prefix, and one it calls inherited
 *      (`unchanged` or `bound`) does not. The register is the only thing that
 *      knows which is which; the directory name is what is being checked.
 *   3. The base SHA recorded in the § Base table is a real commit and an
 *      ancestor of HEAD. Nothing else in the repository reads that SHA, so
 *      without this it is a claim rather than a fact.
 *   4. `unchanged` means unchanged — every file marked `unchanged` is
 *      byte-identical to its blob at the base SHA. Without this, `unchanged`
 *      is a label a human typed, and the register's whole purpose (knowing
 *      what a merge may safely overwrite) rests on it.
 *   5. `bound` means bound — every file marked `bound` exists at the base and
 *      DIFFERS from it. This is check 4 run the other way, and it is the one
 *      that keeps the register honest in the direction that costs money:
 *      `bound` is the status that says "review this hunk by eye on every
 *      merge", so a row that carries it without an edit behind it buys
 *      permanent review effort for nothing — and, worse, a file that was
 *      *meant* to be rebound but never was reads as done forever. Only
 *      check 4 existed until the first rebinding landed, at which point
 *      every `bound` row in the table was an unverified claim.
 *   6. `new` is ours and `owned` was theirs — a row marked `new` has no blob at
 *      the base, and one marked `owned` has one. Checks 4 and 5 only look at
 *      the other two statuses, which left relabelling as a silent way out of
 *      both: measured, moving any row to `new` or `owned` made this script exit
 *      0 without a word, and seventeen of fifty-four rows carried a status
 *      nothing read.
 *
 * The base SHA and the upstream URL are parsed out of NOTICE.md rather than
 * hardcoded here. The register is the source of truth; this file is its reader.
 * A constant would be a second place to update and would drift on the first sync.
 *
 * Running git here is fine and deliberate: checks 3 and 4 cannot be answered
 * from the working tree alone. Every invocation is read-only.
 *
 * Usage:   node scripts/check-register.js
 * Exit codes: 0 = all clear, 1 = one or more errors
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ─── Configuration ───────────────────────────────────────────────────────────

const REPO_ROOT   = path.resolve(__dirname, '..');
const NOTICE_FILE = 'NOTICE.md';
const NOTICE_PATH = path.join(REPO_ROOT, NOTICE_FILE);

// The trees the register covers, and the only ones. Everything else —
// scripts/, docs/, evals/, hooks/, .github/, .claude/ and the root files — is
// fork infrastructure, deliberately out of scope, and the register says so in
// its own prose. Keeping this list exactly as narrow as the register's stated
// scope is what stops the check going red when unrelated tooling grows a file.
const SCOPED_TREES = ['skills', 'references', 'agents', 'commands'];

const STATUSES = ['unchanged', 'bound', 'owned', 'new'];

const HEADING_RE  = /^##\s+(.*?)\s*$/;
const REGISTER_HEADING = 'Ownership register';
const BASE_HEADING     = 'Base';

// ─── git (read-only) ─────────────────────────────────────────────────────────

/**
 * Run git and return stdout. `encoding: 'buffer'` is used where bytes matter —
 * the `unchanged` comparison is byte-for-byte on purpose, so it must not go
 * through a string decode.
 */
function git(args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitOk(args) {
  try {
    git(args);
    return true;
  } catch (err) {
    return false;
  }
}

// ─── NOTICE.md parsing ───────────────────────────────────────────────────────

/** Lines of the `## <name>` section, up to the next `## ` heading or EOF. */
function sectionLines(lines, name) {
  const start = lines.findIndex(l => {
    const m = HEADING_RE.exec(l);
    return m !== null && m[1] === name;
  });
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end);
}

/** Split a markdown table row into trimmed cells, or null if it is not one. */
function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.split('|');
  if (cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map(c => c.trim());
}

const isSeparatorRow = cells => cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));

/** Strip the wrapping backticks from a cell, or return null if it has none. */
function unticked(cell) {
  const m = /^`([^`]+)`$/.exec(cell);
  return m === null ? null : m[1];
}

/**
 * Read a labelled row out of the § Base table, e.g. `| Base SHA | \`abc…\` |`.
 * Scoped to that section so a same-named row elsewhere cannot answer for it.
 */
function baseField(lines, label) {
  const section = sectionLines(lines, BASE_HEADING);
  if (section === null) return null;
  for (const line of section) {
    const cells = tableCells(line);
    if (cells === null || cells.length < 2) continue;
    if (cells[0] !== label) continue;
    return unticked(cells[1]) || cells[1];
  }
  return null;
}

/**
 * Read the register table: the one table in § Ownership register whose header
 * row is `| File | Status |`. Requiring that header is what keeps the parser
 * off the other tables in the section (the status definitions) and off the
 * other tables in the file (§ Base, § Removed at import), which also carry
 * backticked paths in their first column.
 */
function parseRegister(lines) {
  const section = sectionLines(lines, REGISTER_HEADING);
  if (section === null) {
    return { rows: [], errors: [`no \`## ${REGISTER_HEADING}\` section in ${NOTICE_FILE}`] };
  }

  const errors = [];
  const rows   = [];
  let tablesFound = 0;
  let inTable     = false;

  for (const line of section) {
    const cells = tableCells(line);

    if (cells === null) { inTable = false; continue; }
    if (isSeparatorRow(cells)) continue;

    const isHeader = cells.length >= 2
      && cells[0].toLowerCase() === 'file'
      && cells[1].toLowerCase() === 'status';

    if (isHeader) { inTable = true; tablesFound++; continue; }
    if (!inTable) continue;

    if (cells.length < 2) {
      errors.push(`malformed register row (needs a File and a Status cell): ${line.trim()}`);
      continue;
    }
    const file = unticked(cells[0]);
    if (file === null) {
      errors.push(`register row's File cell is not a backticked path: ${line.trim()}`);
      continue;
    }
    rows.push({ file, status: unticked(cells[1]) || cells[1] });
  }

  if (tablesFound === 0) {
    errors.push(`no \`| File | Status |\` table under \`## ${REGISTER_HEADING}\` in ${NOTICE_FILE}`);
  } else if (tablesFound > 1) {
    errors.push(`${tablesFound} \`| File | Status |\` tables under \`## ${REGISTER_HEADING}\` — there must be exactly one`);
  }

  return { rows, errors };
}

// ─── Checks ──────────────────────────────────────────────────────────────────

/** Every tracked file under the in-scope trees, in git's own order. */
function trackedInScope() {
  const out = git(['ls-files', '-z', '--'].concat(SCOPED_TREES));
  return out.split('\0').filter(p => p !== '');
}

/**
 * Each check accumulates two kinds of line in one array: a failure, and a `↳`
 * hint explaining how to fix it. `report` tells them apart by prefix when it
 * prints, but the count returned to the summary line did not — so three failing
 * files reported as nine errors, and the number a reader trusts most was the
 * one number that was wrong. Count failures; hints are formatting.
 */
const HINT_PREFIX = '  \u21b3';

function countFailures(errors) {
  return errors.filter(e => !e.startsWith(HINT_PREFIX)).length;
}

function checkCompleteness(rows, tracked, report) {
  const errors  = [];
  const inTree  = new Set(tracked);
  const counted = new Map();

  for (const { file } of rows) counted.set(file, (counted.get(file) || 0) + 1);

  for (const [file, n] of counted) {
    if (n > 1) errors.push(`listed ${n} times in the register, must appear exactly once: ${file}`);
  }

  const missingRows = tracked.filter(f => !counted.has(f));
  for (const file of missingRows) {
    errors.push(`in the tree, missing from the register: ${file}`);
  }
  if (missingRows.length > 0) {
    errors.push('  ↳ a file was added (by an upstream merge, or by us) and never registered. Add a row with its status.');
  }

  const staleRows = [...counted.keys()].filter(f => !inTree.has(f));
  for (const file of staleRows) {
    errors.push(`in the register, missing from the tree: ${file}`);
  }
  if (staleRows.length > 0) {
    errors.push('  ↳ a stale row: the file was deleted or renamed and the register was not updated.');
  }

  report(
    errors,
    'bidirectional completeness',
    `${tracked.length} tracked file(s) in scope, ${rows.length} register row(s), matched exactly`,
  );
  return countFailures(errors);
}

function checkStatuses(rows, report) {
  const errors = [];
  const tally  = new Map(STATUSES.map(s => [s, 0]));

  for (const { file, status } of rows) {
    if (!tally.has(status)) {
      errors.push(`invalid status "${status}" for ${file} — must be one of: ${STATUSES.join(', ')}`);
      continue;
    }
    tally.set(status, tally.get(status) + 1);
  }

  const summary = STATUSES.map(s => `${s} ${tally.get(s)}`).join(', ');
  report(errors, 'status validity', `${rows.length} status(es) valid — ${summary}`);
  return countFailures(errors);
}

function checkBaseSha(sha, report) {
  const errors = [];

  if (sha === null) {
    errors.push(`no \`Base SHA\` row in the \`## ${BASE_HEADING}\` table of ${NOTICE_FILE}`);
  } else if (!/^[0-9a-f]{40}$/.test(sha)) {
    errors.push(`Base SHA is not a 40-character hex object name: "${sha}"`);
  } else if (!gitOk(['rev-parse', '--verify', `${sha}^{commit}`])) {
    errors.push(`Base SHA is not a commit in this repository: ${sha}`);
  } else if (!gitOk(['merge-base', '--is-ancestor', sha, 'HEAD'])) {
    errors.push(`Base SHA is a commit but not an ancestor of HEAD: ${sha}`);
    errors.push('  ↳ upstream history is not preserved, or NOTICE.md records the wrong base.');
  }

  report(errors, 'base SHA', `${sha} is a commit and an ancestor of HEAD`);
  return countFailures(errors);
}

/**
 * Flowly-native skill directories carry the `flowly-` prefix; inherited ones
 * keep upstream's names. The register is what says which is which — `new` and
 * `owned` are ours, `unchanged` and `bound` came from upstream — so this rule
 * has to be read from the register rather than guessed from the directory name,
 * which is the thing being checked.
 *
 * Only the native side is prefixed, deliberately. The open standard ties
 * frontmatter `name` to the directory name, so prefixing every inherited
 * skill would edit each SKILL.md before any content change and put every
 * future merge on a renamed path — taxing the exact property that made a fork
 * cheaper than a generator. The collision that would prevent is a user
 * receiving our near-identical fork of a file they asked for.
 *
 * This runs before the native skills exist, on purpose: standing the gate up
 * after the thing it governs is how a naming rule gets fitted to whatever was
 * already typed.
 */
function checkSkillPrefix(rows, report) {
  const PREFIX = 'flowly-';
  const NATIVE = new Set(['new', 'owned']);
  const errors  = [];
  const skills  = new Map();

  for (const { file, status } of rows) {
    const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(file);
    if (m !== null) skills.set(m[1], status);
  }

  for (const [dir, status] of skills) {
    const prefixed = dir.startsWith(PREFIX);
    const native   = NATIVE.has(status);

    if (native && !prefixed) {
      errors.push(`registered \`${status}\` (ours) but not prefixed \`${PREFIX}\`: skills/${dir}`);
      errors.push('  ↳ rename the directory and its frontmatter `name` together — the standard requires they match.');
    } else if (!native && prefixed) {
      errors.push(`prefixed \`${PREFIX}\` but registered \`${status}\` (inherited): skills/${dir}`);
      errors.push('  ↳ an inherited directory keeps upstream\'s name, or every future merge lands on a renamed path.');
    }
  }

  const nativeCount = [...skills.values()].filter(s => NATIVE.has(s)).length;
  report(
    errors,
    'skill directory naming',
    `${skills.size} skill(s) — ${nativeCount} ours (prefixed \`${PREFIX}\`), ${skills.size - nativeCount} inherited (upstream names)`,
  );
  return countFailures(errors);
}

function checkUnchanged(rows, sha, upstream, report) {
  const errors = [];
  const marked = rows.filter(r => r.status === 'unchanged');

  for (const { file } of marked) {
    let base;
    try {
      base = git(['show', `${sha}:${file}`], 'buffer');
    } catch (err) {
      errors.push(`marked unchanged but does not exist at the base: ${file}`);
      continue;
    }

    const working = fs.readFileSync(path.join(REPO_ROOT, file));
    if (!working.equals(base)) {
      errors.push(`marked unchanged but differs from the base: ${file}`);
      if (upstream !== null) {
        errors.push(`  ↳ compare: ${upstream}/blob/${sha}/${file}`);
      }
      errors.push('  ↳ either restore it, or change its status to `bound`, `owned` or `new`.');
    }
  }

  report(
    errors,
    '`unchanged` really is unchanged',
    `${marked.length} file(s) marked unchanged are byte-identical to the base`,
  );
  return countFailures(errors);
}

function checkBound(rows, sha, upstream, report) {
  const errors = [];
  const marked = rows.filter(r => r.status === 'bound');

  for (const { file } of marked) {
    let base;
    try {
      base = git(['show', `${sha}:${file}`], 'buffer');
    } catch (err) {
      // `bound` is defined as inherited-then-edited. A file with no blob at the
      // base was never inherited, so the row is the wrong word rather than a
      // missing edit — say which word it wants.
      errors.push(`marked bound but does not exist at the base: ${file}`);
      errors.push('  ↳ nothing upstream to be bound to — this is `new`.');
      continue;
    }

    const working = fs.readFileSync(path.join(REPO_ROOT, file));
    if (working.equals(base)) {
      errors.push(`marked bound but is byte-identical to the base: ${file}`);
      if (upstream !== null) {
        errors.push(`  ↳ compare: ${upstream}/blob/${sha}/${file}`);
      }
      errors.push('  ↳ either make the binding edit, or set its status back to `unchanged`.');
    }
  }

  report(
    errors,
    '`bound` really is bound',
    `${marked.length} file(s) marked bound are inherited and do differ from the base`,
  );
  return countFailures(errors);
}

/**
 * `new` and `owned` — the two statuses that were never verified.
 *
 * WHY THIS EXISTS
 * ---------------
 * The two comparisons above only look at rows marked `unchanged` or `bound`.
 * That left relabelling as a silent escape hatch out of both: measured, moving
 * any row to `new` or `owned` made this script exit 0 with no output about it,
 * whichever status it came from. Seventeen of fifty-four rows carried a status
 * nothing checked, and the loudest way to defeat the register was also the
 * quietest — a one-word edit.
 *
 * NOTICE.md's own definitions are directly testable and are what is enforced:
 *
 *   `new`   — "Ours outright, with no upstream counterpart."  → must NOT exist
 *             at the base SHA.
 *   `owned` — "An inherited path we have taken over."         → MUST exist at
 *             the base SHA.
 *
 * A useful side effect: `new` rows now pin the base SHA far harder than the
 * ancestor test alone does. A SHA drifted forward past the commit that created
 * our own files makes them exist at the base, and this check says so.
 *
 * WHAT IT STILL CANNOT SEE, AND WHY THAT IS NOT A BUG
 * ---------------------------------------------------
 * `bound` → `owned` on a non-skill path survives, and no git question can catch
 * it. Both statuses describe a file that exists at the base and differs from it;
 * they are distinguished only by intent — whether we still take upstream's
 * updates — which leaves no trace in the object store.
 *
 * For skills the prefix rule closes it: check 2a already fails a `bound` skill
 * relabelled `owned`, because `owned` demands the `flowly-` prefix. For
 * `references/`, `agents/` and `commands/` there is no equivalent, and inventing
 * one would mean inventing a naming convention purely so a checker could have
 * something to read. The gap is named here rather than papered over.
 */
function checkNewAndOwned(rows, sha, report) {
  const errors = [];
  const isNew = rows.filter(r => r.status === 'new');
  const owned = rows.filter(r => r.status === 'owned');

  const existsAtBase = file => {
    try {
      git(['cat-file', '-e', `${sha}:${file}`], 'buffer');
      return true;
    } catch {
      return false;
    }
  };

  for (const { file } of isNew) {
    if (!existsAtBase(file)) continue;
    errors.push(`marked new but exists at the base: ${file}`);
    errors.push('  ↳ it has an upstream counterpart, so it is `owned` or `bound`, not `new`.');
  }

  for (const { file } of owned) {
    if (existsAtBase(file)) continue;
    errors.push(`marked owned but does not exist at the base: ${file}`);
    errors.push('  ↳ there was no inherited path to take over — this is `new`.');
  }

  report(
    errors,
    '`new` is ours and `owned` was theirs',
    `${isNew.length} new + ${owned.length} owned file(s) match their definition at the base`,
  );
  return countFailures(errors);
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  let errorCount = 0;

  /** One ✓/✗ block per check, in the shape validate-skills.js prints. */
  const report = (errors, name, okMessage) => {
    if (errors.length === 0) {
      console.log(`  ✓  ${name} — ${okMessage}`);
      return;
    }
    console.log(`  ✗  ${name}`);
    for (const msg of errors) {
      console.log(msg.startsWith(HINT_PREFIX) ? `       ${msg}` : `       ERROR: ${msg}`);
    }
  };

  console.log(`Ownership register — ${NOTICE_FILE} § ${REGISTER_HEADING}\n`);

  if (!fs.existsSync(NOTICE_PATH)) {
    console.error(`ERROR: ${NOTICE_FILE} not found at ${NOTICE_PATH}`);
    process.exit(1);
  }

  // Checks 3 and 4 are the reason git is here; without it there is nothing to
  // compare against, so this is an error and never a quiet skip.
  if (!gitOk(['rev-parse', '--git-dir'])) {
    console.error('ERROR: git is unavailable, or this is not a git repository.');
    console.error('       The base SHA and the `unchanged` comparison cannot be verified without it.');
    process.exit(1);
  }
  if (!gitOk(['rev-parse', '--verify', 'HEAD'])) {
    console.error('ERROR: the repository has no commits, so nothing can be compared to the base SHA.');
    process.exit(1);
  }

  const lines    = fs.readFileSync(NOTICE_PATH, 'utf8').split('\n');
  const sha      = baseField(lines, 'Base SHA');
  const upstream = baseField(lines, 'Upstream');

  console.log(`  Upstream:  ${upstream === null ? '(not recorded)' : upstream}`);
  console.log(`  Base SHA:  ${sha === null ? '(not recorded)' : sha}`);
  console.log(`  In scope:  ${SCOPED_TREES.map(t => `${t}/`).join(' ')}\n`);

  if (upstream === null || !/^https:\/\/\S+$/.test(upstream)) {
    console.log('  ✗  upstream URL');
    console.log(`       ERROR: no usable \`Upstream\` https URL in the \`## ${BASE_HEADING}\` table of ${NOTICE_FILE}`);
    errorCount++;
  }

  const { rows, errors: parseErrors } = parseRegister(lines);
  if (parseErrors.length > 0) {
    console.log('  ✗  register table');
    for (const msg of parseErrors) console.log(`       ERROR: ${msg}`);
    errorCount += parseErrors.length;
  }

  const tracked = trackedInScope();

  errorCount += checkCompleteness(rows, tracked, report);
  errorCount += checkStatuses(rows, report);
  errorCount += checkSkillPrefix(rows, report);
  errorCount += checkBaseSha(sha, report);

  // Only meaningful once the base SHA is known good; a bad SHA would report
  // all 39 files as differing and bury the one error that matters.
  if (sha !== null && /^[0-9a-f]{40}$/.test(sha) && gitOk(['rev-parse', '--verify', `${sha}^{commit}`])) {
    errorCount += checkUnchanged(rows, sha, upstream, report);
    errorCount += checkBound(rows, sha, upstream, report);
    errorCount += checkNewAndOwned(rows, sha, report);
  } else {
    console.log('  –  `unchanged` really is unchanged — skipped, the base SHA above is unusable');
    console.log('  –  `bound` really is bound — skipped, the base SHA above is unusable');
    console.log('  –  `new` is ours and `owned` was theirs — skipped, the base SHA above is unusable');
  }

  const status = errorCount > 0 ? 'FAILED' : 'PASSED';
  console.log(`\n${tracked.length} file(s) in scope, ${rows.length} register row(s) — ${errorCount} error(s) — ${status}`);

  if (errorCount > 0) process.exit(1);
}

// Surface unexpected failures (fs errors, a git that dies mid-run, …) as a
// structured one-line CI error instead of an uncaught stack trace.
try {
  main();
} catch (err) {
  console.error(`\nERROR: check-register failed unexpectedly: ${err.message}`);
  process.exit(1);
}
