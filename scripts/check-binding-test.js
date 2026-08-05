#!/usr/bin/env node
/**
 * Tests for check-binding.js.
 *
 * This checker had no suite at all, which mattered more than the usual coverage
 * argument: it is the gate on this fork's one substantive product change, and
 * the whole design of its exemption list is a claim nothing was checking.
 *
 * The assertions that carry weight here:
 *
 *   - `an exemption whose line changed reports exactly two errors` pins the
 *     SELF-RETIRING property. ALLOWED_MENTIONS is asserted in both directions,
 *     so editing an exempted line must produce a violation AND an unused
 *     exemption. One error would mean the exemption had silently widened into a
 *     blanket over the next occurrence of that token in the same file.
 *   - `every near-miss already in the tree stays quiet` pins the precision the
 *     FORBIDDEN header claims. `\`tasks/\`` carries its backticks precisely so
 *     that `/api/tasks/:id` and friends do not fire; widening it to a bare
 *     `tasks/` matches all five, and nothing said so.
 *   - `every forbidden token is reachable` stops a token that can never fire
 *     from being counted as a defence.
 *
 * The checks are driven directly with synthetic file lists rather than through
 * a temp-dir fixture, because they already take their corpus as an argument.
 * The rule tables are the REAL ones in every test — a fixture rule table would
 * test the loop and leave the rules, which are the part that rots, unread.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const CHECKER = path.join(__dirname, 'check-binding.js');
const {
  collect,
  checkScanCoverage,
  checkForbiddenDestinations,
  checkRequiredBindings,
  checkConventionFirst,
  ALL_ROOTS,
  FORBIDDEN,
  ALLOWED_MENTIONS,
  REQUIRED_BINDINGS,
  CONVENTION_FIRST,
  CONVENTION_FIRST_MARKER,
} = require('./check-binding.js');

/** A report that records instead of printing, so assertions can read it back. */
function collector() {
  const passes = [];
  const errors = [];
  const details = [];
  return {
    passes,
    errors,
    details,
    pass: (m) => passes.push(m),
    error: (m) => errors.push(m),
    detail: (m) => details.push(m),
  };
}

/** A byRoot map where every scan root contributed one file. */
function fullRoots() {
  return new Map(ALL_ROOTS.map((r) => [r, [{ rel: `${r}/x.md`, text: 'clean\n' }]]));
}

// ── positive control ───────────────────────────────────────────────────────

test('passes on the repository as it is checked in', () => {
  const result = spawnSync(process.execPath, [CHECKER], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASSED/);
});

// ── check 1: scan coverage ─────────────────────────────────────────────────

test('every scan root non-empty passes and prints the counts', () => {
  const report = collector();
  assert.equal(checkScanCoverage(fullRoots(), report), 0);
  assert.equal(report.errors.length, 0);
  assert.match(report.passes[0], /all \d+ scan roots non-empty/);
});

test('a scan root that matched nothing is an error, not a silent pass', () => {
  // The failure this check exists for: a glob that resolves to nothing makes
  // every check below vacuously green for that whole subtree.
  const byRoot = fullRoots();
  byRoot.set('docs', []);
  const report = collector();
  assert.equal(checkScanCoverage(byRoot, report), 1);
  assert.match(report.errors[0], /scan root docs\/ matched no files/);
  assert.equal(report.passes.length, 0, 'a failing check must not also report a pass');
});

test('every empty root is reported, not just the first', () => {
  const byRoot = fullRoots();
  byRoot.set('docs', []);
  byRoot.set('evals', []);
  const report = collector();
  // docs/ and evals/ are the two the task called out by name.
  assert.equal(checkScanCoverage(byRoot, report), 2);
});

test('the real sweep reads every root it is configured to read', () => {
  // ALL_ROOTS is derived from the same list collect() walks; this is what goes
  // red if the two ever drift apart.
  const byRoot = collect();
  for (const root of ALL_ROOTS) {
    assert.ok(byRoot.has(root), `collect() produced no entry for ${root}`);
    assert.ok(byRoot.get(root).length > 0, `${root} contributed no files`);
  }
});

// ── check 2: forbidden destinations ────────────────────────────────────────

test('a forbidden destination in a shipped file is an error', () => {
  const report = collector();
  const files = [{ rel: 'skills/x/SKILL.md', text: 'Write the plan to tasks/plan.md when done.\n' }];
  const errors = checkForbiddenDestinations(files, report);
  assert.ok(errors > 0);
  assert.match(report.errors[0], /skills\/x\/SKILL\.md:1 names tasks\/plan\.md/);
});

test('the reported line number is the line the token is on', () => {
  const report = collector();
  const files = [{ rel: 'docs/x.md', text: 'one\ntwo\nSee SPEC.md for details\n' }];
  checkForbiddenDestinations(files, report);
  assert.match(report.errors[0], /docs\/x\.md:3 names SPEC\.md/);
});

test('every forbidden token is reachable', () => {
  // A token that can never fire is a defence that does not exist. Each is fed a
  // line containing it, and each must produce its own error.
  for (const { token } of FORBIDDEN) {
    const report = collector();
    const files = [{ rel: 'skills/probe/SKILL.md', text: `Save it to ${token} please\n` }];
    checkForbiddenDestinations(files, report);
    const hit = report.errors.some((e) => e.includes(`names ${token}`));
    assert.ok(hit, `FORBIDDEN token ${JSON.stringify(token)} matched nothing it was given`);
  }
});

test('every near-miss already in the tree stays quiet', () => {
  // Enumerated in the FORBIDDEN header as the reason `tasks/` carries its
  // backticks. Widening that token to a bare `tasks/` fires on all of these,
  // and until now nothing said so.
  const nearMisses = [
    'A route: /api/tasks/:id returns the task',
    'The example lives in src/tasks/ alongside the rest',
    'Deprecate GET /v1/tasks in favour of the new one',
    'Markup: <a href="/tasks/123">open</a>',
    'The hook writes to .claude/sdd-cache/ between runs',
  ];
  for (const line of nearMisses) {
    const report = collector();
    checkForbiddenDestinations([{ rel: 'skills/n/SKILL.md', text: `${line}\n` }], report);
    const violations = report.errors.filter((e) => e.includes('names'));
    assert.deepEqual(violations, [], `near-miss fired: ${line}`);
  }
});

test('an exempted line is waved past', () => {
  const exempt = ALLOWED_MENTIONS[0];
  const report = collector();
  const files = [{ rel: exempt.file, text: `${exempt.line}\n` }];
  const violations = report.errors.filter((e) => e.includes('names'));
  checkForbiddenDestinations(files, report);
  assert.deepEqual(violations, [], 'the line that forbids the token must not be a violation');
});

test('an exemption is matched on the trimmed line, so re-indenting is free', () => {
  const exempt = ALLOWED_MENTIONS[0];
  const report = collector();
  const files = [{ rel: exempt.file, text: `        ${exempt.line}\n` }];
  checkForbiddenDestinations(files, report);
  const violations = report.errors.filter((e) => e.includes('names'));
  assert.deepEqual(violations, [], 're-indenting an exempted line must not break the exemption');
});

test('an exemption does not cover the same token elsewhere in the same file', () => {
  // The whole point of pinning the exact line: the exemption is for one line,
  // not for the file. A NEW occurrence in an exempted file still fails.
  const exempt = ALLOWED_MENTIONS[0];
  const report = collector();
  const files = [{ rel: exempt.file, text: `${exempt.line}\nNow go and write tasks/plan.md\n` }];
  checkForbiddenDestinations(files, report);
  const violations = report.errors.filter((e) => e.includes('names'));
  assert.equal(violations.length, 1, 'a new occurrence in an exempted file must still fail');
  assert.match(violations[0], /:2 names tasks\/plan\.md/);
});

test('an exemption that matches nothing on disk is an error', () => {
  // The reverse direction. An exemption whose line is gone would otherwise sit
  // there waving past the next occurrence of that token in that file.
  const report = collector();
  const errors = checkForbiddenDestinations([], report);
  assert.equal(errors, ALLOWED_MENTIONS.length, 'every unused exemption must be reported');
  assert.match(report.errors[0], /matches no line — delete it/);
});

test('an exemption whose line changed reports exactly two errors', () => {
  // THE self-retiring property, driven against the real corpus and the real
  // ALLOWED_MENTIONS. Typo one exempted line and you must get both halves:
  // the violation that line no longer excuses, and the exemption that now
  // matches nothing. Exactly one error would mean the exemption had widened
  // into a blanket over the file.
  const byRoot = collect();
  const files = ALL_ROOTS.flatMap((r) => byRoot.get(r));

  const target = ALLOWED_MENTIONS.find((a) => a.file === 'NOTICE.md' && a.line.startsWith('|'));
  assert.ok(target, 'expected the NOTICE.md table-row exemption to exist');

  const mutated = files.map((f) =>
    f.rel !== target.file ? f : { ...f, text: f.text.replace(target.line, `${target.line} typo`) }
  );
  assert.notEqual(
    mutated.find((f) => f.rel === target.file).text,
    files.find((f) => f.rel === target.file).text,
    'the mutation must actually change the file, or this test proves nothing'
  );

  const report = collector();
  const errors = checkForbiddenDestinations(mutated, report);
  assert.equal(errors, 2, `expected violation + unused exemption, got:\n${report.errors.join('\n')}`);
  assert.ok(report.errors.some((e) => e.includes('names .claude/commands/')), 'missing the violation');
  assert.ok(report.errors.some((e) => e.includes('matches no line')), 'missing the unused exemption');
});

test('the real corpus has no forbidden destination and no stale exemption', () => {
  const byRoot = collect();
  const files = ALL_ROOTS.flatMap((r) => byRoot.get(r));
  const report = collector();
  assert.equal(checkForbiddenDestinations(files, report), 0, report.errors.join('\n'));
});

// ── check 3: required bindings ─────────────────────────────────────────────

test('a corpus where every rebound file names its successor passes', () => {
  // The synthetic positive control, so the red-path assertions below cannot be
  // satisfied by a checker that fails unconditionally. Each row is fed the
  // minimum that should satisfy it: one token for an any-of row, all of them
  // for an every-of row.
  const byRel = new Map(
    REQUIRED_BINDINGS.map((r) => [r.file, [...(r.tokens ? [r.tokens[0]] : []), ...(r.all ?? [])].join(' ')])
  );
  const report = collector();
  assert.equal(checkRequiredBindings(byRel, report), 0, report.errors.join('\n'));
  assert.match(report.passes[0], /rebound file\(s\) each name their successor/);
});

test('a file in REQUIRED_BINDINGS that is not in the tree is an error', () => {
  const report = collector();
  checkRequiredBindings(new Map(), report);
  assert.ok(report.errors.every((e) => e.includes('is not in the scanned tree')));
  assert.equal(report.errors.length, REQUIRED_BINDINGS.length);
});

test('an any-of row is satisfied by a single token', () => {
  const row = REQUIRED_BINDINGS.find((r) => r.tokens && r.tokens.length > 1);
  assert.ok(row, 'expected a multi-token any-of row');
  for (const token of row.tokens) {
    const report = collector();
    checkRequiredBindings(new Map([[row.file, `text mentioning ${token}`]]), report);
    assert.ok(
      !report.errors.some((e) => e.includes(`${row.file} names none`)),
      `${token} alone should satisfy the any-of row`
    );
  }
});

test('an any-of row naming none of its tokens is an error', () => {
  const row = REQUIRED_BINDINGS.find((r) => r.tokens);
  const report = collector();
  checkRequiredBindings(new Map([[row.file, 'no successor named at all']]), report);
  assert.ok(report.errors.some((e) => e.includes(`${row.file} names none of`)));
});

test('an every-of row reports every missing token, not just the first', () => {
  // These rows carry three separate claims. Reporting one at a time is how a
  // convention binding ends up half made.
  //
  // The row is the WIDEST every-of row and the text names NONE of its tokens,
  // both deliberately. Picking any row with two tokens and supplying one of
  // them leaves exactly one missing, and then reporting "every missing token"
  // and "only the first" are the same output — the assertion passes over a
  // checker that truncates. Measured: a `.slice(0, 1)` mutant survived that
  // shape and is killed by this one.
  const row = REQUIRED_BINDINGS.filter((r) => r.all).sort((a, b) => b.all.length - a.all.length)[0];
  assert.ok(row && row.all.length >= 3, `need a 3+ token every-of row, widest is ${row && row.all.length}`);

  const report = collector();
  checkRequiredBindings(new Map([[row.file, 'this file names no successor at all']]), report);
  const line = report.errors.find((e) => e.startsWith(`${row.file} is missing`));
  assert.ok(line, `expected a missing-token error, got ${report.errors.join(' | ')}`);
  for (const missing of row.all) {
    assert.ok(line.includes(missing), `${missing} is missing but was not reported`);
  }
});

test('a present token is not reported missing', () => {
  // The other direction, so the assertion above cannot be satisfied by a
  // checker that simply lists every token in the row.
  const row = REQUIRED_BINDINGS.filter((r) => r.all).sort((a, b) => b.all.length - a.all.length)[0];
  const report = collector();
  checkRequiredBindings(new Map([[row.file, `present: ${row.all[0]}`]]), report);
  const line = report.errors.find((e) => e.startsWith(`${row.file} is missing`));
  assert.ok(line, 'the other tokens are still missing, so there must be an error');
  assert.ok(!line.includes(`"${row.all[0]}"`), `${row.all[0]} is present but was reported missing`);
});

test('the real corpus satisfies every required binding', () => {
  const byRoot = collect();
  const byRel = new Map(ALL_ROOTS.flatMap((r) => byRoot.get(r)).map((f) => [f.rel, f.text]));
  const report = collector();
  assert.equal(checkRequiredBindings(byRel, report), 0, report.errors.join('\n'));
});

// ── check 4: convention first ──────────────────────────────────────────────

test('deference before the capability passes', () => {
  const byRel = new Map(
    CONVENTION_FIRST.map((c) => [c.file, `${CONVENTION_FIRST_MARKER} one, keep it. Otherwise ${c.token}.`])
  );
  const report = collector();
  assert.equal(checkConventionFirst(byRel, report), 0, report.errors.join('\n'));
});

test('proposing the capability before deferring is an error', () => {
  // The ordering IS the assertion — presence alone is not enough, because a
  // fork that answers "put it in Flowly" first is wrong for every reader who
  // is not us.
  const byRel = new Map(
    CONVENTION_FIRST.map((c) => [c.file, `Use ${c.token}. ${CONVENTION_FIRST_MARKER} one, keep it.`])
  );
  const report = collector();
  assert.equal(checkConventionFirst(byRel, report), CONVENTION_FIRST.length);
  assert.match(report.errors[0], /before deferring at offset/);
});

test('a missing deference marker is an error', () => {
  const byRel = new Map(CONVENTION_FIRST.map((c) => [c.file, `Just use ${c.token}.`]));
  const report = collector();
  assert.equal(checkConventionFirst(byRel, report), CONVENTION_FIRST.length);
  assert.match(report.errors[0], /missing the deference marker/);
});

test('an absent capability is left to check 3, not double-reported', () => {
  const byRel = new Map(CONVENTION_FIRST.map((c) => [c.file, `${CONVENTION_FIRST_MARKER} one, keep it.`]));
  const report = collector();
  assert.equal(checkConventionFirst(byRel, report), 0, 'check 3 owns the missing-capability failure');
});

test('a file in CONVENTION_FIRST that is not in the tree is an error', () => {
  const report = collector();
  assert.equal(checkConventionFirst(new Map(), report), CONVENTION_FIRST.length);
  assert.ok(report.errors.every((e) => e.includes('is not in the scanned tree')));
});

test('the real corpus defers before proposing', () => {
  const byRoot = collect();
  const byRel = new Map(ALL_ROOTS.flatMap((r) => byRoot.get(r)).map((f) => [f.rel, f.text]));
  const report = collector();
  assert.equal(checkConventionFirst(byRel, report), 0, report.errors.join('\n'));
});
