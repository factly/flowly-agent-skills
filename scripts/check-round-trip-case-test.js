#!/usr/bin/env node
/**
 * Tests for check-round-trip-case.js.
 *
 * The round-trip case cannot be executed — `claude plugin eval` is in early
 * access — so this checker is the only thing standing between that file and
 * silent rot. Every assertion it makes is exercised here against a hand-built
 * tree that breaks exactly one thing, because an assertion nobody has watched
 * fail is not an assertion.
 *
 * Each sandbox starts from the REAL case file and the REAL command bodies and
 * mutates one thing. Building a synthetic case instead would test the checker
 * against a fixture written to satisfy it, which is the failure mode this file
 * exists to avoid.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CHECKER = path.join(__dirname, 'check-round-trip-case.js');
const CASE_REL = path.join('evals', 'flowly-round-trip', 'case.yaml');
const SNAPSHOT_REL = path.join('scripts', 'tool-snapshot.json');
const COMMANDS = ['plan', 'research', 'build', 'test', 'review', 'ship'];

const REAL_CASE = fs.readFileSync(path.join(ROOT, CASE_REL), 'utf8');

// The clause the case quotes, read out of the case rather than restated, so
// this file does not become yet another copy of the sentence.
const QUOTED = REAL_CASE.match(/^\s*pattern: (do not fall back.*)$/m)[1];

function makeSandbox({ mutateCase = (t) => t, mutateCommand = (t) => t } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'round-trip-case-test-'));
  fs.mkdirSync(path.join(root, 'evals', 'flowly-round-trip'), { recursive: true });
  fs.mkdirSync(path.join(root, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, CASE_REL), mutateCase(REAL_CASE));
  for (const name of COMMANDS) {
    const src = fs.readFileSync(path.join(ROOT, 'commands', `${name}.md`), 'utf8');
    fs.writeFileSync(path.join(root, 'commands', `${name}.md`), mutateCommand(src, name));
  }
  fs.copyFileSync(path.join(ROOT, SNAPSHOT_REL), path.join(root, SNAPSHOT_REL));
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [CHECKER, '--root', root], { encoding: 'utf8' });
}

// ── positive control ───────────────────────────────────────────────────────
// Without this, every test below could be passing because the checker reports
// an error on absolutely everything.

test('passes on the case as it is checked in', () => {
  const result = run(ROOT);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASSED/);
});

test('passes on an unmutated sandbox', () => {
  const result = run(makeSandbox());
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// ── the Verify clause: the binding sentence ────────────────────────────────

test('fails when the quoted refusal is deleted from the command it drives', () => {
  const root = makeSandbox({
    mutateCommand: (src, name) => (name === 'plan' ? src.replace(QUOTED, 'stop and ask') : src),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /quotes a sentence no invoked command contains/);
});

test('the copy of the refusal in the other five commands does not rescue it', () => {
  // The resolution block is byte-identical in all six commands. A checker that
  // searched the whole directory would find the sentence in research.md and
  // report success while the command actually under test had lost it.
  const root = makeSandbox({
    mutateCommand: (src, name) => (name === 'plan' ? src.replace(QUOTED, 'stop and ask') : src),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /searched commands\/plan\.md/);
  assert.doesNotMatch(result.stdout, /searched .*research\.md/);
});

test('fails when a quoted pattern spans a line wrap in the command', () => {
  // The first draft of the case quoted the tail of the refusal, which crosses a
  // hard wrap. It reads correctly and can never match the trace.
  const wrapped = 'a local file is the exact failure this distribution exists to prevent';
  const root = makeSandbox({ mutateCase: (t) => t.replace(QUOTED, wrapped) });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /does not span a line wrap/);
});

test('fails when the case quotes nothing from the command at all', () => {
  const root = makeSandbox({
    mutateCase: (t) => t.replace(`pattern: ${QUOTED}`, 'pattern: "^.*$"'),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /quotes no sentence/);
});

// ── the Flowly door ────────────────────────────────────────────────────────

test('fails when a grader names a tool the instance does not have', () => {
  const root = makeSandbox({
    mutateCase: (t) => t.replace('mcp__flowly__put_todo_tasks', 'mcp__flowly__put_todo_list'),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /put_todo_list, which is not in/);
});

test('fails when the case reaches no Flowly tool at all', () => {
  const root = makeSandbox({ mutateCase: (t) => t.replace(/mcp__flowly__/g, 'mcp__other__') });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /names no mcp__flowly__\* tool/);
});

test('fails when the invoked command file does not exist', () => {
  const root = makeSandbox({ mutateCase: (t) => t.replace('/flowly:plan', '/flowly:planning') });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /commands\/planning\.md does not exist/);
});

// ── the reachable absence ──────────────────────────────────────────────────

test('fails when the file-writing tools are taken away', () => {
  // The trap this guards: an agent denied Write cannot write a local plan, so
  // every `exists: false` grader passes for free and the case still looks green.
  const root = makeSandbox({ mutateCase: (t) => t.replace('\n    - Write\n', '\n') });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /no longer grants Write/);
  assert.match(result.stdout, /passes every "exists: false" grader for free/);
});

// ── the absence assertions themselves ──────────────────────────────────────

test('fails when a file_exists grader is flipped to assert presence', () => {
  const root = makeSandbox({
    mutateCase: (t) => t.replace('    path: "**/*plan*"\n    exists: false', '    path: "**/*plan*"\n    exists: true'),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /must carry "exists: false"/);
});

test('fails when a file_exists grader simply forgets exists, which defaults to true', () => {
  const root = makeSandbox({
    mutateCase: (t) => t.replace('    path: "**/*spec*"\n    exists: false\n', '    path: "**/*spec*"\n'),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /must carry "exists: false"/);
});

test('fails when every absence grader is removed', () => {
  const root = makeSandbox({
    mutateCase: (t) => t.replace(/\n  - name: no-[\s\S]*?(?=\nexpected_outcome:)/, '\n').replace('    match: not_contains', '    match: contains'),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /half the claim is unmeasured/);
});

// ── schema conformance ─────────────────────────────────────────────────────

test('fails on a grader key the strict schema would reject', () => {
  const root = makeSandbox({
    mutateCase: (t) => t.replace('    min: 2\n', '    min: 2\n    minimum: 2\n'),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /unknown key "minimum"/);
});

test('fails on a duplicate grader name', () => {
  const root = makeSandbox({ mutateCase: (t) => t.replace('name: no-spec-file', 'name: no-plan-file') });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /duplicate grader name/);
});

test('fails on an arm outside the enum', () => {
  const root = makeSandbox({ mutateCase: (t) => t.replace('arm: with-only', 'arm: without-only') });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /arm must be with-only or both/);
});

test('fails on an unknown grader type', () => {
  const root = makeSandbox({ mutateCase: (t) => t.replace('    type: tool_order', '    type: tool_sequence') });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /unknown type "tool_sequence"/);
});

test('fails when max_turns is outside the bounds the CLI accepts', () => {
  const root = makeSandbox({ mutateCase: (t) => t.replace('max_turns: 60', 'max_turns: 600') });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /execution\.max_turns must be an integer in 1\.\.200/);
});

test('fails when schema_version is missing', () => {
  const root = makeSandbox({ mutateCase: (t) => t.replace(/^schema_version:.*\n/m, '') });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /schema_version is missing/);
});

test('fails when the file is not valid YAML', () => {
  // An unterminated flow sequence, rather than trailing junk: `expected_outcome`
  // ends in a folded block scalar, so anything appended is swallowed as more of
  // its text and the file stays valid. The first version of this test did that
  // and passed against a perfectly parseable file.
  const root = makeSandbox({ mutateCase: (t) => t.replace('\nruns: 1\n', '\nruns: [1\n') });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /is not valid YAML/);
});

test('fails when the case file is missing entirely', () => {
  const root = makeSandbox();
  fs.rmSync(path.join(root, CASE_REL));

  const result = run(root);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /does not exist/);
});
