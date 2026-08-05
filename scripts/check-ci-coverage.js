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
 * Usage:  node scripts/check-ci-coverage.js [--root <dir>]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOW_REL = '.github/workflows/ci.yml';

// The aggregate job branch protection is meant to require. It reports on the
// others, so it is the one job that is not expected to list itself.
const AGGREGATE_JOB = 'gates';

function parseRoot(argv) {
  const i = argv.indexOf('--root');
  return i === -1 ? path.resolve(__dirname, '..') : path.resolve(argv[i + 1]);
}

/**
 * Job names and the aggregate's `needs:` list.
 *
 * This reads the workflow as text rather than parsing YAML. The repo has no
 * dependencies and Node ships no parser, and the two shapes needed here are
 * fixed by GitHub's own schema: job keys sit at exactly two spaces under
 * `jobs:`, and a `needs:` sequence sits at six. A hand-rolled parser for the
 * whole format would be a liability; recognising two indents is not.
 */
function parseWorkflow(text) {
  const lines = text.split('\n');
  const jobs = [];
  const needs = [];

  let inJobs = false;
  let inNeeds = false;
  let currentJob = null;

  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;

    const job = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (job) {
      currentJob = job[1];
      jobs.push(currentJob);
      inNeeds = false;
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

  return { jobs, needs };
}

/** Executables CI is expected to invoke, as repo-relative paths. */
function shippedExecutables(root) {
  const found = [];

  const scriptsDir = path.join(root, 'scripts');
  for (const entry of fs.readdirSync(scriptsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue; // skips scripts/lib/ — see the header
    if (entry.name.endsWith('.js') || entry.name.endsWith('.sh')) {
      found.push(`scripts/${entry.name}`);
    }
  }

  const hooksDir = path.join(root, 'hooks');
  for (const entry of fs.readdirSync(hooksDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('-test.sh')) {
      found.push(`hooks/${entry.name}`);
    }
  }

  return found.sort();
}

function main(argv = process.argv.slice(2)) {
  const root = parseRoot(argv);
  const workflowPath = path.join(root, WORKFLOW_REL);

  if (!fs.existsSync(workflowPath)) {
    console.log(`✗  ${WORKFLOW_REL} not found — nothing runs any gate`);
    console.log('\n1 error(s) — FAILED');
    return 1;
  }

  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const executables = shippedExecutables(root);

  // A repository with no gates would pass every assertion below without making
  // one. Say so instead.
  if (executables.length === 0) {
    console.log('✗  found no scripts or hook tests to check — the walk is broken');
    console.log('\n1 error(s) — FAILED');
    return 1;
  }

  let errors = 0;
  for (const rel of executables) {
    if (workflow.includes(rel)) continue;
    console.log(`✗  ${rel} is never invoked by ${WORKFLOW_REL}`);
    errors += 1;
  }

  if (errors === 0) {
    console.log(`✓  every shipped gate runs in CI — ${executables.length} executable(s) checked`);
  }

  // A job that runs but is absent from the aggregate's `needs:` is a gate that
  // reports without gating: it goes red in the job list while the one status
  // branch protection requires stays green.
  const { jobs, needs } = parseWorkflow(workflow);

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

  console.log(`\n${errors} error(s) — ${errors ? 'FAILED' : 'PASSED'}`);
  return errors ? 1 : 0;
}

module.exports = { main, shippedExecutables, parseWorkflow };

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`\nERROR: check-ci-coverage failed unexpectedly: ${err.message}`);
    process.exit(1);
  }
}
