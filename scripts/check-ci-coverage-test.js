#!/usr/bin/env node
/**
 * Tests for check-ci-coverage.js.
 *
 * This checker asserts a property of the workflow file, so its sandbox is a
 * minimal tree of the three places it reads: `scripts/`, `hooks/` and
 * `.github/workflows/ci.yml`. Every sandbox starts from a tree that PASSES and
 * breaks exactly one thing, and `passes on an unmutated sandbox` below is what
 * stops the fixture drifting into a shape that would pass no matter what.
 *
 * The first test runs against the real repository. A checker that errored on
 * everything would satisfy every red-path assertion here, so the green path has
 * to be pinned against the actual tree, not only against a fixture.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CHECKER = path.join(__dirname, 'check-ci-coverage.js');
const { parseWorkflow } = require('./check-ci-coverage.js');

/** A workflow that runs everything `makeSandbox` plants, and gates on it all. */
const PASSING_WORKFLOW = `name: CI

on: [push]

jobs:
  alpha:
    name: Alpha
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-alpha.js
      - run: bash scripts/verify-alpha.sh

  beta:
    name: Beta
    runs-on: ubuntu-latest
    steps:
      - run: node --test scripts/check-alpha-test.js
      - run: bash hooks/beta-test.sh

  gates:
    name: All gates green
    runs-on: ubuntu-latest
    if: always()
    needs:
      - alpha
      - beta
    steps:
      - run: echo done
`;

function makeSandbox({ workflow = PASSING_WORKFLOW, scripts, hooks, omitWorkflow = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-coverage-test-'));
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });

  const scriptFiles = scripts ?? ['check-alpha.js', 'check-alpha-test.js', 'verify-alpha.sh'];
  for (const name of scriptFiles) {
    fs.writeFileSync(path.join(root, 'scripts', name), '// fixture\n');
  }
  // A module reached through its caller, never invoked by CI directly. The
  // non-recursive walk must not see it.
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'helper.js'), '// fixture\n');

  const hookFiles = hooks ?? ['beta-test.sh', 'beta.sh'];
  for (const name of hookFiles) {
    fs.writeFileSync(path.join(root, 'hooks', name), '# fixture\n');
  }

  if (!omitWorkflow) {
    fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), workflow);
  }
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [CHECKER, '--root', root], { encoding: 'utf8' });
}

// ── positive controls ──────────────────────────────────────────────────────

test('passes on the repository as it is checked in', () => {
  const result = run(ROOT);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASSED/);
});

test('passes on an unmutated sandbox', () => {
  const result = run(makeSandbox());
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// ── half one: every shipped executable is invoked ──────────────────────────

test('fails when a validator is never invoked by the workflow', () => {
  const root = makeSandbox({
    scripts: ['check-alpha.js', 'check-alpha-test.js', 'verify-alpha.sh', 'check-orphan.js'],
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /scripts\/check-orphan\.js is never invoked/);
});

test('fails when a test suite is never invoked by the workflow', () => {
  const root = makeSandbox({
    scripts: ['check-alpha.js', 'check-alpha-test.js', 'verify-alpha.sh', 'check-beta-test.js'],
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /scripts\/check-beta-test\.js is never invoked/);
});

test('fails when a shell validator is never invoked by the workflow', () => {
  const root = makeSandbox({
    scripts: ['check-alpha.js', 'check-alpha-test.js', 'verify-alpha.sh', 'verify-orphan.sh'],
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /scripts\/verify-orphan\.sh is never invoked/);
});

test('fails when a hook test suite is never invoked by the workflow', () => {
  const root = makeSandbox({ hooks: ['beta-test.sh', 'beta.sh', 'gamma-test.sh'] });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /hooks\/gamma-test\.sh is never invoked/);
});

test('does not require the hooks themselves, only their test suites', () => {
  // `hooks/beta.sh` is planted in every sandbox and named by no job. The hooks
  // run at session start, not in CI, so demanding them would be wrong — and
  // this is the assertion that would go red if the filter were widened.
  const result = run(makeSandbox());
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /hooks\/beta\.sh/);
});

test('does not descend into scripts/lib, whose modules CI never invokes directly', () => {
  const result = run(makeSandbox());
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /helper\.js/);
});

test('counts every executable it checked, so a broken walk is visible', () => {
  const result = run(makeSandbox());
  // 3 scripts + 1 hook test. If the walk silently stopped early the number
  // would drop while the run stayed green.
  assert.match(result.stdout, /4 executable\(s\) checked/);
});

test('fails rather than passes vacuously when the walk finds nothing', () => {
  const root = makeSandbox({ scripts: [], hooks: [] });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /found no scripts or hook tests/);
});

test('fails when there is no workflow at all', () => {
  const result = run(makeSandbox({ omitWorkflow: true }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /not found — nothing runs any gate/);
});

// ── half two: every job gates the required status ──────────────────────────

test('fails when a job runs but is absent from gates.needs', () => {
  const workflow = PASSING_WORKFLOW.replace('      - beta\n', '');
  const result = run(makeSandbox({ workflow }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /job `beta` runs but is not in `gates\.needs`/);
});

test('fails when gates.needs names a job that does not exist', () => {
  const workflow = PASSING_WORKFLOW.replace('      - beta\n', '      - beta\n      - ghost\n');
  const result = run(makeSandbox({ workflow }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /names `ghost`, which is not a job/);
});

test('fails when the aggregate job is missing entirely', () => {
  const workflow = PASSING_WORKFLOW.slice(0, PASSING_WORKFLOW.indexOf('  gates:'));
  const result = run(makeSandbox({ workflow }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no `gates` job found/);
});

test('fails when the aggregate job lists no needs', () => {
  const workflow = PASSING_WORKFLOW.replace(/    needs:\n      - alpha\n      - beta\n/, '');
  const result = run(makeSandbox({ workflow }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /lists no `needs:`/);
});

test('does not demand that the aggregate job list itself', () => {
  const result = run(makeSandbox());
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /job `gates` runs but is not/);
});

// ── the workflow reader ────────────────────────────────────────────────────

test('parseWorkflow finds every job and the aggregate deps', () => {
  const { jobs, needs } = parseWorkflow(PASSING_WORKFLOW);
  assert.deepEqual(jobs, ['alpha', 'beta', 'gates']);
  assert.deepEqual(needs, ['alpha', 'beta']);
});

test('parseWorkflow does not mistake a step key for a job', () => {
  // `steps:`, `with:` and `env:` all sit under a job. Only two-space keys
  // directly under `jobs:` are jobs, and nothing deeper may be counted.
  const { jobs } = parseWorkflow(PASSING_WORKFLOW);
  assert.ok(!jobs.includes('steps'));
  assert.ok(!jobs.includes('name'));
});

test('parseWorkflow stops reading needs at the end of the list', () => {
  // `steps:` follows `needs:` in the aggregate. If the reader kept going it
  // would collect step entries as dependencies and the ghost-job assertion
  // would fire on the real workflow.
  const { needs } = parseWorkflow(PASSING_WORKFLOW);
  assert.equal(needs.length, 2);
});

test('parseWorkflow reads the real workflow, not just the fixture', () => {
  const real = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const { jobs, needs } = parseWorkflow(real);
  assert.ok(jobs.length > 10, `expected the real workflow's jobs, got ${jobs.length}`);
  assert.ok(jobs.includes('gates'));
  assert.ok(needs.includes('install'));
});
