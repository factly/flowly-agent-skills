#!/usr/bin/env node
/**
 * Tests for check-deletions.js.
 *
 * The interesting assertions here are the two ways the enumeration lies, both
 * of which produce a confident green while being wrong:
 *
 *   - `renames count as deletions` fails if `--no-renames` is ever dropped from
 *     the diff. Git pairs a delete with a similar add and reports R, and the
 *     deletions most worth recording are exactly the replaced ones.
 *   - `a directory row without its trailing slash covers nothing` fails if
 *     coverage is ever loosened to a plain substring search, which would let a
 *     row naming `docs/` absolve every deletion under it.
 *
 * Each git fixture is a real repository built in a temp dir, because the thing
 * under test is a `git diff` and a fake one would test nothing.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CHECKER = path.join(__dirname, 'check-deletions.js');
const { recordedPaths, removedSection, isCovered, baseSha } = require('./check-deletions.js');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function notice(sha, removedBody) {
  return [
    '# NOTICE',
    '',
    '## Base',
    '',
    '| Field | Value |',
    '|---|---|',
    `| Base SHA | \`${sha}\` |`,
    '',
    '## Removed at import',
    '',
    removedBody,
    '',
    '## Statuses',
    '',
    'Nothing here names a removed path: `never/removed.md`.',
    '',
  ].join('\n');
}

/**
 * A repo whose base commit holds `files`, then a second commit that deletes
 * `remove` and adds `add`. Returns the root and the base SHA.
 */
function makeRepo({ files, remove = [], add = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-deletions-test-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'user.name', 'Test']);

  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  const sha = git(root, ['rev-parse', 'HEAD']).trim();

  for (const rel of remove) fs.rmSync(path.join(root, rel));
  for (const [rel, body] of Object.entries(add)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  git(root, ['add', '-A']);
  // --allow-empty: several cases below deliberately delete nothing, because the
  // precondition failures must be reachable on a tree with no deletions at all.
  git(root, ['commit', '-q', '--allow-empty', '-m', 'fork']);

  return { root, sha };
}

function writeNotice(root, sha, body) {
  fs.writeFileSync(path.join(root, 'NOTICE.md'), notice(sha, body));
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

test('passes when every deletion is recorded', () => {
  const { root, sha } = makeRepo({ files: { 'a.md': 'a\n', 'docs/gone.md': 'x\n' }, remove: ['docs/gone.md'] });
  writeNotice(root, sha, 'Removed: `docs/gone.md`.');
  const result = run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('passes when nothing was deleted at all', () => {
  const { root, sha } = makeRepo({ files: { 'a.md': 'a\n' }, add: { 'b.md': 'b\n' } });
  writeNotice(root, sha, 'Removed: `placeholder/none.md`.');
  const result = run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// ── the claim ──────────────────────────────────────────────────────────────

test('fails when a deletion is not recorded', () => {
  const { root, sha } = makeRepo({ files: { 'a.md': 'a\n', 'docs/gone.md': 'x\n' }, remove: ['docs/gone.md'] });
  writeNotice(root, sha, 'Removed: `something/else.md`.');
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /docs\/gone\.md was deleted since the base but is not recorded/);
});

test('renames count as deletions', () => {
  // The trap this check was written for. `old.md` and `new.md` are identical,
  // so git reports a rename and the deletion vanishes from the default diff.
  const body = 'identical content, so rename detection pairs these two\n'.repeat(5);
  const { root, sha } = makeRepo({
    files: { 'a.md': 'a\n', 'evals/old.md': body },
    remove: ['evals/old.md'],
    add: { 'evals/new.md': body },
  });
  writeNotice(root, sha, 'Removed: `nothing/here.md`.');
  const result = run(root);
  assert.equal(result.status, 1, 'a renamed-away file must still count as deleted');
  assert.match(result.stdout, /evals\/old\.md was deleted/);
});

test('a directory row with its trailing slash covers files beneath it', () => {
  const { root, sha } = makeRepo({
    files: { 'a.md': 'a\n', 'gone/one.md': '1\n', 'gone/two.md': '2\n' },
    remove: ['gone/one.md', 'gone/two.md'],
  });
  writeNotice(root, sha, 'Removed the whole directory: `gone/`.');
  const result = run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('a directory row without its trailing slash covers nothing', () => {
  // Loosening this to a substring match is the over-report failure: a row
  // naming `gone/sub` would silently absolve every deletion beneath it.
  //
  // The row has to be a NESTED path. A bare `gone` never reaches the coverage
  // test at all — `recordedPaths` drops tokens with no slash and no file
  // extension, because the section's prose is full of backticked field names.
  const { root, sha } = makeRepo({
    files: { 'a.md': 'a\n', 'gone/sub/one.md': '1\n' },
    remove: ['gone/sub/one.md'],
  });
  writeNotice(root, sha, 'Removed: `gone/sub`.');
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /gone\/sub\/one\.md was deleted/);
});

test('only the Removed section counts, not the rest of NOTICE.md', () => {
  // `never/removed.md` is named in the § Statuses section by the fixture.
  const { root, sha } = makeRepo({ files: { 'a.md': 'a\n', 'never/removed.md': 'x\n' }, remove: ['never/removed.md'] });
  writeNotice(root, sha, 'Removed: `unrelated/path.md`.');
  const result = run(root);
  assert.equal(result.status, 1, 'a path recorded in another section must not count');
  assert.match(result.stdout, /never\/removed\.md was deleted/);
});

test('reports how many deletions and records it compared', () => {
  const { root, sha } = makeRepo({ files: { 'a.md': 'a\n', 'docs/gone.md': 'x\n' }, remove: ['docs/gone.md'] });
  writeNotice(root, sha, 'Removed: `docs/gone.md`.');
  const result = run(root);
  assert.match(result.stdout, /1 file\(s\) deleted since the base/);
});

// ── the preconditions fail loudly rather than passing ──────────────────────

test('fails when NOTICE.md is absent', () => {
  const { root } = makeRepo({ files: { 'a.md': 'a\n' } });
  fs.rmSync(path.join(root, 'NOTICE.md'), { force: true });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /NOTICE\.md not found/);
});

test('fails when there is no Base SHA row', () => {
  const { root } = makeRepo({ files: { 'a.md': 'a\n' } });
  fs.writeFileSync(path.join(root, 'NOTICE.md'), '# NOTICE\n\n## Removed at import\n\n`x/y.md`\n');
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no `Base SHA` row/);
});

test('fails when the Removed section is missing entirely', () => {
  const { root, sha } = makeRepo({ files: { 'a.md': 'a\n' } });
  fs.writeFileSync(
    path.join(root, 'NOTICE.md'),
    `# NOTICE\n\n## Base\n\n| Base SHA | \`${sha}\` |\n`,
  );
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /has no `## Removed at import` section/);
});

test('fails rather than passing vacuously when the section records no paths', () => {
  const { root, sha } = makeRepo({ files: { 'a.md': 'a\n' } });
  writeNotice(root, sha, 'Nothing was removed and no path is named here.');
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /records no paths — nothing could fail/);
});

test('fails with a usable message when the base commit is unreachable', () => {
  // What a shallow clone looks like from inside the check.
  const { root } = makeRepo({ files: { 'a.md': 'a\n' } });
  writeNotice(root, 'a'.repeat(40), 'Removed: `x/y.md`.');
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /cannot diff against the base SHA/);
  assert.match(result.stdout, /fetch-depth: 0/);
});

// ── the readers ────────────────────────────────────────────────────────────

test('removedSection stops at the next heading', () => {
  const body = removedSection(notice('b'.repeat(40), 'Removed: `a/b.md`.'));
  assert.match(body, /a\/b\.md/);
  assert.ok(!body.includes('never/removed.md'), 'must not spill into the next section');
});

test('removedSection returns null when the heading is absent', () => {
  assert.equal(removedSection('# NOTICE\n\n## Base\n'), null);
});

test('recordedPaths takes backticked paths and ignores surrounding prose', () => {
  const found = recordedPaths('Removed `docs/a.md` and `evals/` because reasons about docs and evals.');
  assert.deepEqual(found, ['docs/a.md', 'evals/']);
});

test('recordedPaths ignores backticked tokens that are not paths', () => {
  const found = recordedPaths('The `--strict` flag and `name` field, plus `docs/a.md`.');
  assert.deepEqual(found, ['docs/a.md']);
});

test('isCovered matches an exact path and a trailing-slash prefix only', () => {
  assert.equal(isCovered('docs/a.md', ['docs/a.md']), true);
  assert.equal(isCovered('docs/a.md', ['docs/']), true);
  assert.equal(isCovered('docs/a.md', ['docs']), false);
  assert.equal(isCovered('docsy/a.md', ['docs/']), false);
  assert.equal(isCovered('docs/a.md', ['docs/a.md.bak']), false);
});

test('baseSha reads the row and rejects a malformed one', () => {
  assert.equal(baseSha('| Base SHA | `' + 'c'.repeat(40) + '` |'), 'c'.repeat(40));
  assert.equal(baseSha('| Base SHA | `deadbeef` |'), null);
});

test('baseSha agrees with the register check on the real NOTICE.md', () => {
  const real = fs.readFileSync(path.join(ROOT, 'NOTICE.md'), 'utf8');
  const sha = baseSha(real);
  assert.ok(sha, 'the real NOTICE.md must carry a base SHA');
  // It has to be a commit here, or every deletion enumeration is meaningless.
  const type = git(ROOT, ['cat-file', '-t', sha]).trim();
  assert.equal(type, 'commit');
});
