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
];

/**
 * Files whose destination was rebound, and the successor each must name.
 *
 * Any one token satisfies the row. Tokens are Flowly MCP tool names, verified
 * against a live tools/list, except where the row's successor is a command.
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
  return byRoot;
}

// Check 1 — a root that contributed nothing means the sweep never ran there,
// and every downstream check is vacuously green for that whole subtree.
function checkScanCoverage(byRoot, report) {
  let errors = 0;
  const empty = [];
  for (const root of SCAN_ROOTS) {
    if (byRoot.get(root).length === 0) empty.push(root);
  }
  for (const root of empty) {
    report.error(`scan root ${root}/ matched no files — every check below is vacuous for it`);
    errors += 1;
  }
  if (errors === 0) {
    const counts = SCAN_ROOTS.map((r) => `${r}/ ${byRoot.get(r).length}`).join(', ');
    report.pass(`all ${SCAN_ROOTS.length} scan roots non-empty — ${counts}`);
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
  for (const { file, tokens, reason } of REQUIRED_BINDINGS) {
    const text = byRel.get(file);
    if (text === undefined) {
      report.error(`${file} is in REQUIRED_BINDINGS but is not in the scanned tree`);
      errors += 1;
      continue;
    }
    if (tokens.some((t) => text.includes(t))) continue;
    report.error(`${file} names none of ${tokens.join(', ')} — ${reason}`);
    errors += 1;
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
  const files = SCAN_ROOTS.flatMap((r) => byRoot.get(r));
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

// Surface unexpected failures (fs errors, an unreadable file, …) as a
// structured one-line CI error instead of an uncaught stack trace.
try {
  main();
} catch (err) {
  console.error(`\nERROR: check-binding failed unexpectedly: ${err.message}`);
  process.exit(1);
}
