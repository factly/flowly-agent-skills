#!/usr/bin/env node
/**
 * check-ci-coverage.js — assert that every gate this repository ships is a gate
 * CI actually runs.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every other check here defends a property of the corpus. This one defends a
 * property of the checks: that they run at all.
 *
 * The failure it was written for was real and silent. `check-round-trip-case.js`
 * and its twenty-one tests were written, watched to pass locally, and never
 * wired into `.github/workflows/ci.yml`. For as long as that held, the one
 * artifact measuring the product's central claim — `evals/flowly-round-trip/
 * case.yaml` — could be replaced with two lines of nonsense and all ten gates CI
 * did run stayed green. The check that caught it was the check nothing ran.
 *
 * A gate nobody runs is worse than no gate. No gate is an absence you can see;
 * an unrun gate is a green checkmark that means nothing, and it accrues trust
 * for exactly as long as it takes for someone to depend on it.
 *
 * WHY IT CANNOT EXEMPT ITSELF
 * ---------------------------
 * This file is discovered by the same walk it performs, so it fails unless CI
 * runs it too. That is deliberate: a coverage check that could quietly drop out
 * of CI would reintroduce the class of bug it exists to close.
 *
 * WHAT IS IN SCOPE
 * ----------------
 * `scripts/*.js` and `scripts/*.sh` — every validator and every test suite. The
 * walk is deliberately NOT recursive: `scripts/lib/` holds modules that CI never
 * invokes directly because a validator requires them, and a library reached
 * through its caller is already covered by its caller's job.
 *
 * `hooks/*-test.sh` — the hook test suites. The hooks themselves are run by the
 * agent harness at session start, not by CI, so only their tests are in scope.
 *
 * There is deliberately no exemption list. A script that genuinely should not
 * run in CI is a decision worth making in the open, at the moment it is added,
 * rather than a row in an allowlist that outlives the reason someone wrote it.
 *
 * WHAT COUNTS AS BEING RUN
 * ------------------------
 * A `run:` step, and only a `run:` step. Matching the workflow's raw text gave
 * a COMMENT full credit: `ci.yml` carries a commented example naming
 * `scripts/validate-skills.js`, and deleting the real invocation left this
 * check green — the exact bug it was written to catch, surviving inside the
 * commit that added it. So comment lines are dropped, and the path has to sit
 * on a line that also carries `run:`.
 *
 * That is strict on purpose. A path inside a multi-line `run: |` block is NOT
 * credited, so moving an invocation into one turns this red. Red is the safe
 * direction: the author sees it immediately and the fix is obvious, whereas the
 * looser rule that would accept it also accepts a path named in an `::error::`
 * message — and a wrong green here is invisible for as long as anyone trusts it.
 *
 * The match is against the full repo-relative path. A basename comparison
 * passes every test in this file's suite while accepting `node check-alpha.js`
 * for `scripts/check-alpha.js`, so `a bare basename does not satisfy a shipped
 * path` is what pins the precision.
 *
 * WHY THE COUNT IS PINNED
 * -----------------------
 * "Every gate present is wired" is a claim that ABSENCE satisfies. Deleting
 * `check-binding.js`, its job and its `gates.needs` entry left a smaller,
 * perfectly self-consistent repository and this check reported success — the
 * cheapest way past a coverage gate is to delete the subject.
 *
 * So the count is pinned to a literal here. It is not an exemption list: no
 * entry is excused anything, and the pin cannot grant coverage to a script that
 * is not run. It is the one fact about this repository that does not move when
 * the tree does, which is exactly what an absence needs in order to be visible.
 * Adding or removing a gate means editing this number in the same commit, in
 * the open, where a reviewer sees it — which is the whole point.
 *
 * The converse assertion is cheap and rides along: every `scripts/` or `hooks/`
 * path the workflow names on a `run:` step must exist on disk. That catches the
 * half-done removal — script deleted, job left behind — at check time rather
 * than as a confusing "file not found" mid-run.
 *
 * `--expect <n>` overrides the pin so the fixtures can state their own size.
 * CI passes no such flag, so CI is always measured against the literal.
 *
 * Usage:  node scripts/check-ci-coverage.js [--root <dir>] [--expect <n>]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOW_REL = '.github/workflows/ci.yml';

// The aggregate job branch protection is meant to require. It reports on the
// others, so it is the one job that is not expected to list itself.
const AGGREGATE_JOB = 'gates';

// The number of executables this repository ships. See the header: this is the
// fixed point that makes a DELETED gate visible. Changing it is a deliberate
// act and belongs in the same commit as the gate it accounts for.
const EXPECTED_EXECUTABLES = 26;

function parseRoot(argv) {
  const i = argv.indexOf('--root');
  return i === -1 ? path.resolve(__dirname, '..') : path.resolve(argv[i + 1]);
}

/** The pinned count, or the fixture's own size when `--expect` is given. */
function parseExpected(argv) {
  const i = argv.indexOf('--expect');
  if (i === -1) return EXPECTED_EXECUTABLES;
  const n = Number(argv[i + 1]);
  // A malformed override must not silently fall back to the pin — that would
  // measure the fixture against the wrong tree and report a green for it.
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Lines on which the workflow actually invokes something.
 *
 * Comments are dropped first, then a line has to carry `run:` — see the header
 * for why a mention is not an invocation, and why this is deliberately strict
 * about multi-line `run: |` blocks.
 */
function invocationLines(text) {
  return text.split('\n').filter((line) => !/^\s*#/.test(line) && line.includes('run:'));
}

/** The `scripts/` and `hooks/` paths the workflow invokes, deduplicated. */
function invokedPaths(text) {
  const found = new Set();
  for (const line of invocationLines(text)) {
    for (const m of line.matchAll(/(?:scripts|hooks)\/[A-Za-z0-9_.-]+\.(?:js|sh)/g)) {
      found.add(m[0]);
    }
  }
  return [...found].sort();
}

/**
 * Job names, the aggregate's `needs:` list, and any line under `jobs:` that
 * could not be read as either.
 *
 * This reads the workflow as text rather than parsing YAML. The repo has no
 * dependencies and Node ships no parser, and the two shapes needed here are
 * fixed by GitHub's own schema: job keys sit at exactly two spaces under
 * `jobs:`, and a `needs:` sequence sits at six. A hand-rolled parser for the
 * whole format would be a liability; recognising two indents is not.
 *
 * `malformed` exists because every other shape this reader met failed loudly
 * except one. A QUOTED key — `"flaky":`, legal YAML and a legal job id — matched
 * nothing, so the job vanished from the job list AND from the ungated
 * computation, and a job that ran without gating the required status passed in
 * silence. Quotes and a trailing comment are now read; anything still unread is
 * reported rather than skipped, so the silent direction is closed for shapes
 * nobody has thought of yet.
 */
function parseWorkflow(text) {
  const lines = text.split('\n');
  const jobs = [];
  const needs = [];
  const malformed = [];

  let inJobs = false;
  let inNeeds = false;
  let currentJob = null;

  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;

    // A key back at column zero ends the block. `jobs:` is last in this
    // workflow today, but a later top-level key must not make its children
    // look like malformed jobs.
    if (/^\S/.test(line)) {
      inJobs = false;
      continue;
    }

    if (/^ {2}\S/.test(line)) {
      const job = line.match(/^ {2}["']?([A-Za-z0-9_-]+)["']?:[ \t]*(?:#.*)?$/);
      if (job) {
        currentJob = job[1];
        jobs.push(currentJob);
        inNeeds = false;
      } else if (!/^\s*#/.test(line)) {
        malformed.push(line);
      }
      continue;
    }

    if (currentJob === AGGREGATE_JOB) {
      if (/^ {4}needs:\s*$/.test(line)) {
        inNeeds = true;
        continue;
      }
      if (inNeeds) {
        const item = line.match(/^ {6}- ([A-Za-z0-9_-]+)\s*$/);
        if (item) {
          needs.push(item[1]);
          continue;
        }
        inNeeds = false;
      }
    }
  }

  return { jobs, needs, malformed };
}

/**
 * The two directories in scope and what counts as an executable in each. See
 * the header: `scripts/` ships validators and test suites alike, while only the
 * hook TEST suites are CI's to run — the hooks themselves are run by the agent
 * harness at session start.
 *
 * Neither walk recurses, which is what keeps `scripts/lib/` out: a library
 * reached through its caller is already covered by its caller's job.
 */
const EXECUTABLE_DIRS = [
  { dir: 'scripts', counts: (name) => name.endsWith('.js') || name.endsWith('.sh') },
  { dir: 'hooks', counts: (name) => name.endsWith('-test.sh') },
];

/** Executables CI is expected to invoke, as repo-relative paths. */
function shippedExecutables(root) {
  const found = [];
  for (const { dir, counts } of EXECUTABLE_DIRS) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (entry.isFile() && counts(entry.name)) found.push(`${dir}/${entry.name}`);
    }
  }
  return found.sort();
}

/** The exit footer, in one place: three preconditions and the result share it. */
function finish(errors) {
  console.log(`\n${errors} error(s) — ${errors ? 'FAILED' : 'PASSED'}`);
  return errors ? 1 : 0;
}

/** A precondition that could not be met: report it, then exit as one error. */
function fail(...lines) {
  for (const line of lines) console.log(line);
  return finish(1);
}

function main(argv = process.argv.slice(2)) {
  const root = parseRoot(argv);
  const expected = parseExpected(argv);
  const workflowPath = path.join(root, WORKFLOW_REL);

  if (expected === null) {
    return fail('✗  --expect needs a non-negative integer');
  }

  if (!fs.existsSync(workflowPath)) {
    return fail(`✗  ${WORKFLOW_REL} not found — nothing runs any gate`);
  }

  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const executables = shippedExecutables(root);

  // A repository with no gates would pass every assertion below without making
  // one. Say so instead.
  if (executables.length === 0) {
    return fail('✗  found no scripts or hook tests to check — the walk is broken');
  }

  let errors = 0;
  const invocations = invocationLines(workflow);
  for (const rel of executables) {
    if (invocations.some((line) => line.includes(rel))) continue;
    console.log(`✗  ${rel} is never invoked by a \`run:\` step in ${WORKFLOW_REL}`);
    errors += 1;
  }

  if (errors === 0) {
    console.log(`✓  every shipped gate runs in CI — ${executables.length} executable(s) checked`);
  }

  // The converse: a job pointing at a script that is no longer here.
  for (const rel of invokedPaths(workflow)) {
    if (fs.existsSync(path.join(root, rel))) continue;
    console.log(`✗  ${WORKFLOW_REL} runs ${rel}, which does not exist`);
    errors += 1;
  }

  // The pin. See the header — this is what makes a DELETED gate visible, and
  // it is the only assertion here that a shrinking tree cannot satisfy.
  if (executables.length !== expected) {
    console.log(
      `✗  expected ${expected} executable(s), found ${executables.length} — ` +
      'a gate was added or removed, so update the pin in this file deliberately',
    );
    errors += 1;
  }

  // A job that runs but is absent from the aggregate's `needs:` is a gate that
  // reports without gating: it goes red in the job list while the one status
  // branch protection requires stays green.
  const { jobs, needs, malformed } = parseWorkflow(workflow);

  // A line the reader could not classify is a job it may have dropped, and a
  // dropped job is one that runs without gating anything.
  for (const line of malformed) {
    console.log(`✗  line under \`jobs:\` cannot be read as a job: ${JSON.stringify(line)}`);
    errors += 1;
  }

  if (!jobs.includes(AGGREGATE_JOB)) {
    console.log(`✗  no \`${AGGREGATE_JOB}\` job found — the aggregate status is missing`);
    errors += 1;
  } else if (needs.length === 0) {
    console.log(`✗  \`${AGGREGATE_JOB}\` lists no \`needs:\` — it aggregates nothing`);
    errors += 1;
  } else {
    const ungated = jobs.filter((j) => j !== AGGREGATE_JOB && !needs.includes(j));
    for (const job of ungated) {
      console.log(`✗  job \`${job}\` runs but is not in \`${AGGREGATE_JOB}.needs\` — it cannot fail the required status`);
      errors += 1;
    }
    // The list can also name a job that no longer exists, which GitHub treats as
    // an error at load time — but only once someone pushes.
    for (const dep of needs) {
      if (jobs.includes(dep)) continue;
      console.log(`✗  \`${AGGREGATE_JOB}.needs\` names \`${dep}\`, which is not a job in this workflow`);
      errors += 1;
    }
    if (ungated.length === 0) {
      console.log(`✓  every job gates the required status — ${needs.length} job(s) in \`${AGGREGATE_JOB}.needs\``);
    }
  }

  return finish(errors);
}

module.exports = { main, shippedExecutables, parseWorkflow, invocationLines, invokedPaths };

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`\nERROR: check-ci-coverage failed unexpectedly: ${err.message}`);
    process.exit(1);
  }
}
