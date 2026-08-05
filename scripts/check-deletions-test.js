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

/** The § Removed at import table, which is the only thing that records. */
function table(rows) {
  return ['| Removed | Was |', '|---|---|', ...rows].join('\n');
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
    // A TABLE in the next section, not prose. The section-scoping assertion is
    // only load-bearing if the other section is the same shape this one reads.
    table(['| `never/removed.md` | still here, recorded in the wrong section |']),
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
  writeNotice(root, sha, table(['| `docs/gone.md` | a guide |']));
  const result = run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('passes when nothing was deleted at all', () => {
  const { root, sha } = makeRepo({ files: { 'a.md': 'a\n' }, add: { 'b.md': 'b\n' } });
  writeNotice(root, sha, table(['| `placeholder/none.md` | a guide |']));
  const result = run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// ── the claim ──────────────────────────────────────────────────────────────

test('fails when a deletion is not recorded', () => {
  const { root, sha } = makeRepo({ files: { 'a.md': 'a\n', 'docs/gone.md': 'x\n' }, remove: ['docs/gone.md'] });
  writeNotice(root, sha, table(['| `something/else.md` | a guide |']));
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
  writeNotice(root, sha, table(['| `nothing/here.md` | a guide |']));
  const result = run(root);
  assert.equal(result.status, 1, 'a renamed-away file must still count as deleted');
  assert.match(result.stdout, /evals\/old\.md was deleted/);
});

test('a directory row with its trailing slash covers files beneath it', () => {
  const { root, sha } = makeRepo({
    files: { 'a.md': 'a\n', 'gone/one.md': '1\n', 'gone/two.md': '2\n' },
    remove: ['gone/one.md', 'gone/two.md'],
  });
  writeNotice(root, sha, table(['| `gone/` | the whole directory |']));
  const result = run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('a directory row without its trailing slash covers nothing', () => {
  // Loosening this to a substring match is the over-report failure: a row
  // naming `gone/sub` would silently absolve every deletion beneath it.
  const { root, sha } = makeRepo({
    files: { 'a.md': 'a\n', 'gone/sub/one.md': '1\n' },
    remove: ['gone/sub/one.md'],
  });
  writeNotice(root, sha, table(['| `gone/sub` | written without its trailing slash |']));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /gone\/sub\/one\.md was deleted/);
});

test('only the Removed section counts, not the rest of NOTICE.md', () => {
  // `never/removed.md` is named in the § Statuses section by the fixture.
  const { root, sha } = makeRepo({ files: { 'a.md': 'a\n', 'never/removed.md': 'x\n' }, remove: ['never/removed.md'] });
  writeNotice(root, sha, table(['| `unrelated/path.md` | a guide |']));
  const result = run(root);
  assert.equal(result.status, 1, 'a path recorded in another section must not count');
  assert.match(result.stdout, /never\/removed\.md was deleted/);
});

test('reports how many deletions and records it compared', () => {
  const { root, sha } = makeRepo({ files: { 'a.md': 'a\n', 'docs/gone.md': 'x\n' }, remove: ['docs/gone.md'] });
  writeNotice(root, sha, table(['| `docs/gone.md` | a guide |']));
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
  writeNotice(root, 'a'.repeat(40), table(['| `x/y.md` | a guide |']));
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

test('recordedPaths takes the table first column and ignores surrounding prose', () => {
  const section = [
    'Removed at import, for reasons about docs and evals:',
    '',
    table(['| `docs/a.md` | a guide |', '| `evals/` | the whole directory |']),
    '',
    'None of `docs/`, `evals/x.json` or `--strict` below is a record.',
  ].join('\n');
  assert.deepEqual(recordedPaths(section), ['docs/a.md', 'evals/']);
});

test('recordedPaths ignores the table header and delimiter rows', () => {
  // Neither carries backticks, which is why neither needs a special case — and
  // this is what goes red if that ever stops being true.
  assert.deepEqual(recordedPaths(table([])), []);
  assert.deepEqual(recordedPaths(table(['| `docs/a.md` | a guide |'])), ['docs/a.md']);
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

// ── the record is the table, not the section ───────────────────────────────

/** The § Removed at import table, which is the only thing that records. */
function table(rows) {
  return ['| Removed | Was |', '|---|---|', ...rows].join('\n');
}

test('a directory named only in the section prose records nothing', () => {
  // Measured on the real NOTICE.md: `skills/` was harvested out of the phrase
  // "opencode symlink into `skills/`" and became a blanket over every skill in
  // the fork. Prose explains a removal; it does not record one.
  const { root, sha } = makeRepo({
    files: { 'a.md': 'a\n', 'skills/kept/SKILL.md': 'x\n' },
    remove: ['skills/kept/SKILL.md'],
  });
  writeNotice(root, sha, [
    table(['| `docs/gone.md` | an install guide |']),
    '',
    'The opencode symlink pointed into `skills/`, which is not a removal record.',
  ].join('\n'));
  const result = run(root);
  assert.equal(result.status, 1, 'prose naming a directory must not absolve its subtree');
  assert.match(result.stdout, /skills\/kept\/SKILL\.md was deleted/);
});

test('a directory named in the table description column records nothing', () => {
  // The second measured case: `scripts/` came from "Its `scripts/` directory
  // was empty afterwards". The second column describes; the first records.
  const { root, sha } = makeRepo({
    files: { 'a.md': 'a\n', 'scripts/validator.js': 'x\n' },
    remove: ['scripts/validator.js'],
  });
  writeNotice(root, sha, table(['| `docs/gone.md` | the guide that lived beside `scripts/` |']));
  const result = run(root);
  assert.equal(result.status, 1, 'the description column must not record a removal');
  assert.match(result.stdout, /scripts\/validator\.js was deleted/);
});

test('the real NOTICE.md does not absolve this fork\'s own files', () => {
  // The defect in one assertion. With the section's prose harvested, `skills/`
  // and `scripts/` were blanket rows and every validator in the repository
  // could be deleted with this gate still green — including the linter that
  // § Surviving references singles out as deliberately unmodified.
  const real = fs.readFileSync(path.join(ROOT, 'NOTICE.md'), 'utf8');
  const recorded = recordedPaths(removedSection(real));
  for (const survivor of [
    'scripts/lib/skill-lint.js',
    'scripts/validate-skills.js',
    'scripts/check-deletions.js',
    'scripts/check-ci-coverage.js',
    'skills/test-driven-development/SKILL.md',
    'skills/flowly-catalog/SKILL.md',
  ]) {
    assert.equal(isCovered(survivor, recorded), false, `${survivor} must not be absolved`);
  }
});

test('the real NOTICE.md still records every path it is supposed to', () => {
  // The other direction, so the fix above cannot be "record nothing". These
  // are real deletions and each one must stay covered.
  const real = fs.readFileSync(path.join(ROOT, 'NOTICE.md'), 'utf8');
  const recorded = recordedPaths(removedSection(real));
  for (const gone of [
    'commands/build.toml',
    '.gemini/commands/spec.toml',
    '.claude/commands/webperf.md',
    'docs/comparison.md',
    'plugin.json',
    'skills/using-agent-skills/SKILL.md',
    'evals/cases/using-agent-skills.json',
    'evals/fixtures/using-agent-skills/incident.md',
    'skills/idea-refine/scripts/idea-refine.sh',
  ]) {
    assert.equal(isCovered(gone, recorded), true, `${gone} must stay recorded`);
  }
});

test('recordedPaths counts only what the table records', () => {
  // The count is printed as a result, so it has to mean something. A shell
  // assignment in the prose (`IDEAS_DIR="docs/ideas"`) was being counted.
  const section = [
    table(['| `skills/x/scripts/run.sh` | a helper |']),
    '',
    'Its entire body was `IDEAS_DIR="docs/ideas"` and a `mkdir -p`.',
  ].join('\n');
  assert.deepEqual(recordedPaths(section), ['skills/x/scripts/run.sh']);
});

test('recordedPaths reads every path in a multi-path table cell', () => {
  const section = table(['| `scripts/a.js`, `scripts/a-test.js` | a pair |']);
  assert.deepEqual(recordedPaths(section), ['scripts/a.js', 'scripts/a-test.js']);
});

test('baseSha agrees with the register check on the real NOTICE.md', () => {
  const real = fs.readFileSync(path.join(ROOT, 'NOTICE.md'), 'utf8');
  const sha = baseSha(real);
  assert.ok(sha, 'the real NOTICE.md must carry a base SHA');
  // It has to be a commit here, or every deletion enumeration is meaningless.
  const type = git(ROOT, ['cat-file', '-t', sha]).trim();
  assert.equal(type, 'commit');
});
