#!/usr/bin/env node
/**
 * check-binding.js
 *
 * CLI that holds the *inherited* corpus to this fork's one substantive product
 * change: a planning artifact belongs on a Flowly issue, never in a file on
 * disk. Upstream's skills tell an agent to write `SPEC.md`, `tasks/plan.md`,
 * `tasks/todo.md`, `docs/ideas/…`; this distribution has none of those, so a
 * line that still names one sends the agent to write a file nothing will ever
 * read — and no test, lint or build notices.
 *
 * It asserts the following, and reports each separately:
 *
 *   1. Every configured scan root contributed at least one file. This runs
 *      FIRST and on its own, because it is the only check that can tell a
 *      genuinely clean tree apart from a glob that resolved to nothing. The
 *      task this script verifies calls out `docs/` and `evals/` by name
 *      precisely because an earlier count missed them; a silent zero there
 *      would reproduce the miss and report success.
 *   2. No file under the shipped tree names a forbidden planning destination,
 *      except at the exact lines listed in ALLOWED_MENTIONS. Those exist
 *      because two of this fork's own files name the paths in order to forbid
 *      them, and a check that could not tell prohibition from instruction would
 *      have to be switched off for the files that matter most.
 *   3. Every file whose destination was rebound names the Flowly capability
 *      that replaced it. Deleting a path is half the job: "do not write a plan
 *      file" with no successor leaves the agent with nowhere to put the plan,
 *      which is how a rebinding turns into a silent capability loss.
 *   4. The two conditional cases defer to the project's own convention before
 *      proposing Flowly. Both are skills about recording something in whatever
 *      form a project already uses — an ADR directory, a performance log — and
 *      a fork that answers "put it in Flowly" first is wrong for every reader
 *      who is not us.
 *
 * WHAT THIS PROVES AND DOES NOT PROVE
 * -----------------------------------
 * It proves that no shipped byte still points at a destination this
 * distribution does not have, and that every rebound line names a successor.
 *
 * It proves nothing about whether a model follows the successor. That is a
 * behavioural property and it is measured by `evals/`, not by reading text off
 * disk. Both are needed; neither substitutes for the other.
 *
 * It also proves nothing about whether the capability tokens below are real
 * Flowly tools. They were checked against a live `tools/list` when written,
 * and holding them there is a separate, later job — this script has no server.
 *
 * Usage:   node scripts/check-binding.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// The shipped tree. `scripts/` is deliberately absent: this file names every
// forbidden token by construction, and so does check-commands.js.
const SCAN_ROOTS = ['skills', 'references', 'agents', 'commands', 'docs', 'evals', 'hooks'];

// Root prose, scanned as its own pseudo-root. These are not a tree, so the walk
// above cannot reach them, and they were outside every check here until a
// mutation put `Save the plan to \`tasks/plan.md\`` into each of the five and
// this script stayed green for all of them.
//
// The two that matter most are CLAUDE.md and AGENTS.md: agent harnesses load
// them automatically, so an unbound destination there is read by an agent
// before it reads anything else — the highest-leverage place in the repository
// for exactly the instruction this check exists to forbid. README.md is the
// third, because it states the product claim ("rather than to a local file")
// that the rest of the corpus is held to, and nothing was holding it.
//
// The same five files as check-command-refs.js ROOT_PROSE, deliberately: one
// list of what counts as this repository's front matter, read by both sweeps.
const ROOT_PROSE = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'NOTICE.md'];
const ROOT_PROSE_LABEL = '<root>';

const SCAN_EXTS = ['.md', '.json', '.sh', '.txt', '.yml', '.yaml'];

/**
 * Destinations no file may name.
 *
 * Each token is matched as a plain substring, and each was chosen so that the
 * near-misses already in this tree do NOT fire. Those near-misses are real and
 * were enumerated before this list was written:
 *
 *   `/api/tasks/:id`      — an HTTP route, in five skills
 *   `src/tasks/`          — a source directory in a context-engineering example
 *   `GET /v1/tasks`       — a deprecation example
 *   `<a href="/tasks/123">` — an accessibility example
 *   `.claude/sdd-cache/`  — a hook's cache directory, not a command directory
 *
 * This is why the bare-directory token carries its backticks: every real
 * instruction writes it as `tasks/`, and none of the near-misses is backticked.
 * Widening it to a bare `tasks/` matches all five.
 */
const FORBIDDEN = [
  {
    token: 'SPEC.md',
    reason: 'a specification is a planning doc on the issue — put_planning_doc(kind="research")',
  },
  {
    token: 'tasks/plan.md',
    reason: 'the plan is a planning doc on the issue — put_planning_doc(kind="plan")',
  },
  {
    token: 'tasks/todo.md',
    reason: 'the task list is submitted structurally — put_todo_tasks',
  },
  {
    token: '`tasks/`',
    reason: 'nothing in this workflow creates a tasks directory',
  },
  {
    token: 'docs/ideas',
    reason: 'a refined idea becomes a Flowly issue — create_issue',
  },
  {
    token: 'docs/intent',
    reason: 'captured intent becomes a Flowly issue — create_issue',
  },
  {
    token: 'PERF.md',
    reason: 'a measurement result belongs on the issue — add_comment',
  },
  {
    token: '.claude/commands/',
    reason: 'this fork ships its commands at commands/; .claude/commands/ was removed',
  },
];

/**
 * The exact lines permitted to name a forbidden destination, because naming it
 * is how they forbid it.
 *
 * Matched on the trimmed line, so re-indenting is free and a reword is not —
 * the point is that a *new* occurrence in one of these files still fails.
 *
 * Asserted in both directions: an entry that matches nothing on disk is an
 * error, so the exemption cannot outlive the line that justified it.
 */
const ALLOWED_MENTIONS = [
  {
    file: 'commands/research.md',
    line: 'Nothing is written to the local filesystem — no `research.md`, no scratch file, no `tasks/`',
    reason: 'the command telling the agent not to write these',
  },
  {
    file: 'skills/flowly-plan/SKILL.md',
    line: '- A plan document written into the working tree — `tasks/plan.md`, `tasks/todo.md`, or anything like them',
    reason: 'a red flag naming what a red flag looks like',
  },
  {
    file: 'docs/sync.md',
    line: 'Upstream\'s side restored *"Save the plan to `tasks/plan.md` … Create the `tasks/` directory"*',
    reason:
      'the sync rehearsal record quoting the upstream hunk it rejected — a resolver has to be able to recognise the reverting text on sight, and this check is the reason it was caught',
  },
  // NOTICE.md § Removed at import exists to NAME the paths this fork deleted,
  // and the forbidden list below is largely made of those same paths. The
  // collision is structural, not accidental: the record of a removal and the
  // prohibition on the thing removed must both spell it. A record that cannot
  // name what it records is not a record, and NOTICE.md instructs nobody — it
  // is read by a human resolving a merge, never by an agent mid-run.
  {
    file: 'NOTICE.md',
    line: '`.claude/commands/` — upstream\'s eight Claude Code slash commands — went later, not at import, when',
    reason: 'the deletion record naming the command directory it records as deleted',
  },
  {
    file: 'NOTICE.md',
    line: '`.claude/commands/`, which is gone too — so nothing here descends from anything upstream ships, and a',
    reason: 'the same deletion, in the paragraph explaining what replaced it',
  },
  {
    file: 'NOTICE.md',
    line: 'Its entire body was `IDEAS_DIR="docs/ideas"` and a `mkdir -p`: it existed to create the directory',
    reason:
      'the deletion record quoting the deleted script\'s body — the quotation is the evidence that the script had no job left, which is the whole reason it went',
  },
  {
    file: 'NOTICE.md',
    line: "| `.claude/commands/` | Upstream's eight Claude Code slash commands, replaced by this fork's own six at `commands/` — see below |",
    reason:
      'the same deletion, now as a table row rather than prose. check-deletions.js reads the § Removed at import table\'s FIRST COLUMN only — reading the whole section as prose let a descriptive mention of `skills/` absolve every inherited skill — so the eight files under this path have no other spelling that records them',
  },
];

/**
 * Files whose binding must name the Flowly capability that carries it.
 *
 * `tokens` is any-of: one of them present satisfies the row. `all` is every-of:
 * each must be present. Tokens are Flowly MCP tool names, verified against a
 * live tools/list, except where the row's successor is a command or a phrase
 * this script owns.
 *
 * Two shapes of row live here, and the difference is worth naming because it is
 * why one of them needed its own task. Most rows below replace a *path*: the
 * file said "write it to tasks/plan.md" and now says "put_planning_doc". Those
 * are found by grepping for the path, and the row exists to prove a successor
 * was named rather than the instruction merely deleted.
 *
 * The last three rows replace a *convention* — a commit-message shape, a
 * release mapping, where a review verdict lives. Those files contain no path at
 * all, so no grep finds them, and nothing would ever have reported them as
 * unbound. They are here because a sweep can only find the vocabulary it
 * already knows, and an inherited file whose binding is a convention is
 * invisible to the sweep that found all the others.
 */
const REQUIRED_BINDINGS = [
  {
    file: 'skills/spec-driven-development/SKILL.md',
    tokens: ['put_planning_doc'],
    reason: 'the spec it used to write to disk is a planning doc on the issue',
  },
  {
    file: 'skills/planning-and-task-breakdown/SKILL.md',
    tokens: ['put_todo_tasks'],
    reason: 'the task list it used to write to disk is submitted structurally',
  },
  {
    file: 'skills/idea-refine/SKILL.md',
    tokens: ['create_issue'],
    reason: 'the one-pager it used to save becomes an issue',
  },
  {
    file: 'skills/interview-me/SKILL.md',
    tokens: ['create_issue'],
    reason: 'the captured intent it used to save becomes an issue',
  },
  {
    file: 'skills/performance-optimization/SKILL.md',
    tokens: ['add_comment'],
    reason: 'the result log it used to keep in the repo belongs on the issue',
  },
  {
    file: 'skills/documentation-and-adrs/SKILL.md',
    tokens: ['put_planning_doc'],
    reason: 'a decision record with no project convention to match belongs on the issue',
  },
  {
    file: 'skills/context-engineering/SKILL.md',
    tokens: ['list_planning_docs', 'get_project_assets'],
    reason: 'the spec sections it loads are read from the issue, not from a file',
  },
  {
    file: 'docs/adoption-guide.md',
    tokens: ['/flowly:plan'],
    reason: 'the command-to-artifact table it prints must name the commands this fork ships',
  },
  {
    file: 'docs/getting-started.md',
    tokens: ['/flowly:plan'],
    reason: 'the artifact section it prints must name the commands this fork ships',
  },
  {
    file: 'evals/cases/spec-driven-development.json',
    tokens: ['planning doc'],
    reason: 'the expected output it grades against must be the artifact this fork produces',
  },
  {
    file: 'evals/cases/planning-and-task-breakdown.json',
    tokens: ['planning doc'],
    reason: 'the expected output it grades against must be the artifact this fork produces',
  },

  // --- bindings that are a convention rather than a path ---

  {
    file: 'skills/git-workflow-and-versioning/SKILL.md',
    all: ['FLO-', 'link_pull_request'],
    reason:
      'the commit convention names the issue, and the PR is recorded against it — link_pull_request ' +
      'moves no status and attaches no evidence, so saying so is part of the binding',
  },
  {
    file: 'skills/shipping-and-launch/SKILL.md',
    all: ['create_release', 'add_issue_to_release', 'ships nothing by itself'],
    reason:
      'a release is a Flowly object that groups issues and carries a status; creating one deploys ' +
      'nothing, and a reader who assumes otherwise ships by filling in a form',
  },
  {
    file: 'skills/code-review-and-quality/SKILL.md',
    all: ['get_loop_run', 'advance_loop_run'],
    reason:
      "the verdict on built work lives on the run, not on the issue — the issue's review_state is " +
      'the plan gate, a different gate at a different time',
  },
];

/**
 * The conditional cases.
 *
 * Both of these skills are about recording something in whatever form the
 * project already uses. Proposing Flowly first is wrong for every reader who is
 * not us, so the deference must come first *in the file*, not merely somewhere
 * in it. This script owns the marker string; the ordering is the assertion.
 */
const CONVENTION_FIRST_MARKER = 'If the project already has';

const CONVENTION_FIRST = [
  {
    file: 'skills/documentation-and-adrs/SKILL.md',
    token: 'put_planning_doc',
    reason: 'a project with an ADR directory keeps it',
  },
  {
    file: 'skills/performance-optimization/SKILL.md',
    token: 'add_comment',
    reason: 'a project with a performance log keeps it',
  },
];

// ---------------------------------------------------------------------------

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(abs, out);
    } else if (SCAN_EXTS.includes(path.extname(entry.name))) {
      out.push(abs);
    }
  }
  return out;
}

function collect() {
  const byRoot = new Map();
  for (const root of SCAN_ROOTS) {
    const abs = path.join(REPO_ROOT, root);
    const files = walk(abs, []).map((f) => ({
      rel: path.relative(REPO_ROOT, f).split(path.sep).join('/'),
      text: fs.readFileSync(f, 'utf8'),
    }));
    byRoot.set(root, files);
  }

  const rootFiles = ROOT_PROSE
    .map((rel) => ({ rel, abs: path.join(REPO_ROOT, rel) }))
    .filter(({ abs }) => fs.existsSync(abs))
    .map(({ rel, abs }) => ({ rel, text: fs.readFileSync(abs, 'utf8') }));
  byRoot.set(ROOT_PROSE_LABEL, rootFiles);

  return byRoot;
}

// Every key of the map collect() returns, so the coverage check below cannot
// silently stop counting a root that the sweep is still reading.
const ALL_ROOTS = [...SCAN_ROOTS, ROOT_PROSE_LABEL];

// Check 1 — a root that contributed nothing means the sweep never ran there,
// and every downstream check is vacuously green for that whole subtree.
function checkScanCoverage(byRoot, report) {
  let errors = 0;
  const empty = [];
  for (const root of ALL_ROOTS) {
    if (byRoot.get(root).length === 0) empty.push(root);
  }
  for (const root of empty) {
    report.error(`scan root ${root}/ matched no files — every check below is vacuous for it`);
    errors += 1;
  }
  if (errors === 0) {
    const counts = ALL_ROOTS.map((r) => `${r}/ ${byRoot.get(r).length}`).join(', ');
    report.pass(`all ${ALL_ROOTS.length} scan roots non-empty — ${counts}`);
  }
  return errors;
}

// Check 2 — forbidden destinations, with the two-directional exemption.
function checkForbiddenDestinations(files, report) {
  let errors = 0;
  const hits = [];

  for (const { rel, text } of files) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      for (const { token, reason } of FORBIDDEN) {
        if (!lines[i].includes(token)) continue;
        hits.push({ rel, lineNo: i + 1, line: lines[i].trim(), token, reason });
      }
    }
  }

  const used = new Set();
  for (const hit of hits) {
    const idx = ALLOWED_MENTIONS.findIndex((a) => a.file === hit.rel && a.line === hit.line);
    if (idx !== -1) {
      used.add(idx);
      continue;
    }
    report.error(`${hit.rel}:${hit.lineNo} names ${hit.token} — ${hit.reason}`);
    report.detail(hit.line);
    errors += 1;
  }

  // Reverse direction: an exemption whose line is gone is an exemption that
  // now waves past the next occurrence of the same token in that file.
  ALLOWED_MENTIONS.forEach((allowed, idx) => {
    if (used.has(idx)) return;
    report.error(
      `ALLOWED_MENTIONS entry for ${allowed.file} matches no line — delete it (was: ${allowed.reason})`
    );
    errors += 1;
  });

  if (errors === 0) {
    report.pass(
      `no forbidden destination in ${files.length} file(s) — ` +
        `${ALLOWED_MENTIONS.length} prohibition line(s) exempted and all still present`
    );
  }
  return errors;
}

// Check 3 — a removed destination with no named successor is a capability loss.
function checkRequiredBindings(byRel, report) {
  let errors = 0;
  for (const { file, tokens, all, reason } of REQUIRED_BINDINGS) {
    const text = byRel.get(file);
    if (text === undefined) {
      report.error(`${file} is in REQUIRED_BINDINGS but is not in the scanned tree`);
      errors += 1;
      continue;
    }
    if (tokens !== undefined && !tokens.some((t) => text.includes(t))) {
      report.error(`${file} names none of ${tokens.join(', ')} — ${reason}`);
      errors += 1;
      continue;
    }
    // Report every missing token, not just the first: these rows carry three
    // separate claims, and fixing them one round-trip at a time is how a
    // convention binding ends up half made.
    if (all !== undefined) {
      const missing = all.filter((t) => !text.includes(t));
      if (missing.length > 0) {
        report.error(`${file} is missing ${missing.map((m) => `"${m}"`).join(', ')} — ${reason}`);
        errors += 1;
      }
    }
  }
  if (errors === 0) {
    report.pass(`${REQUIRED_BINDINGS.length} rebound file(s) each name their successor capability`);
  }
  return errors;
}

// Check 4 — deference must come first in the file, not merely be present.
function checkConventionFirst(byRel, report) {
  let errors = 0;
  for (const { file, token, reason } of CONVENTION_FIRST) {
    const text = byRel.get(file);
    if (text === undefined) {
      report.error(`${file} is in CONVENTION_FIRST but is not in the scanned tree`);
      errors += 1;
      continue;
    }
    const marker = text.indexOf(CONVENTION_FIRST_MARKER);
    const capability = text.indexOf(token);
    if (marker === -1) {
      report.error(`${file} is missing the deference marker "${CONVENTION_FIRST_MARKER}" — ${reason}`);
      errors += 1;
      continue;
    }
    if (capability === -1) continue; // check 3 owns this failure
    if (marker > capability) {
      report.error(
        `${file} proposes ${token} at offset ${capability} before deferring at offset ${marker} — ${reason}`
      );
      errors += 1;
    }
  }
  if (errors === 0) {
    report.pass(`${CONVENTION_FIRST.length} conditional case(s) defer to the project's convention first`);
  }
  return errors;
}

// ---------------------------------------------------------------------------

function main() {
  const report = {
    pass: (m) => console.log(`  ✓ ${m}`),
    error: (m) => console.log(`  ✗ ${m}`),
    detail: (m) => console.log(`      ${m}`),
  };

  console.log('\nBinding check — planning artifacts belong on the issue, not on disk\n');

  const byRoot = collect();
  const files = ALL_ROOTS.flatMap((r) => byRoot.get(r));
  const byRel = new Map(files.map((f) => [f.rel, f.text]));

  let errorCount = 0;
  errorCount += checkScanCoverage(byRoot, report);
  errorCount += checkForbiddenDestinations(files, report);
  errorCount += checkRequiredBindings(byRel, report);
  errorCount += checkConventionFirst(byRel, report);

  const status = errorCount > 0 ? 'FAILED' : 'PASSED';
  console.log(`\n${files.length} file(s) checked — ${errorCount} error(s) — ${status}`);

  if (errorCount > 0) process.exit(1);
}

// The rule tables and the four checks, so a test can drive each check against a
// synthetic file list. The checks already take their corpus as an argument —
// `files`, `byRoot`, `byRel` — so nothing here needed reshaping to be testable;
// what was missing was only a way to require this file without running it.
module.exports = {
  main,
  collect,
  walk,
  checkScanCoverage,
  checkForbiddenDestinations,
  checkRequiredBindings,
  checkConventionFirst,
  ALL_ROOTS,
  SCAN_ROOTS,
  ROOT_PROSE,
  ROOT_PROSE_LABEL,
  FORBIDDEN,
  ALLOWED_MENTIONS,
  REQUIRED_BINDINGS,
  CONVENTION_FIRST,
  CONVENTION_FIRST_MARKER,
};

// Surface unexpected failures (fs errors, an unreadable file, …) as a
// structured one-line CI error instead of an uncaught stack trace.
if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`\nERROR: check-binding failed unexpectedly: ${err.message}`);
    process.exit(1);
  }
}
