#!/usr/bin/env node
/**
 * check-catalog-test.js — unit tests for scripts/check-catalog.js.
 *
 * The gate under test is bidirectional, and a bidirectional gate is exactly the
 * shape that passes vacuously in one direction while nobody notices: if the
 * catalog is parsed into an empty list, "every named skill resolves" is true of
 * nothing and stays green forever. So every case below builds a tree that is
 * consistent, asserts green, and then breaks ONE thing — which is also how the
 * two directions were mutation-tested by hand against the real repository.
 *
 * Each case runs the real script in a throwaway tree, the way
 * run-evals-test.js does: the script resolves its roots from `__dirname/..`, so
 * a copy under `<sandbox>/scripts/` sees `<sandbox>/skills/` as the corpus.
 *
 * Run: node --test scripts/check-catalog-test.js
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const CHECKER = path.join(__dirname, 'check-catalog.js');
const CATALOG = 'flowly-catalog';

// Must match REQUIRED_CONVENTIONS in check-catalog.js. Restated here rather
// than imported: the script is a CLI with no exports, and a test that borrowed
// the constant could not tell a renamed heading from a renamed requirement.
const CONVENTIONS = [
  '### Priority is inverted',
  '### `null` means two different things',
  '### There is no pagination',
  '### Every list is capped',
  '### Unknown arguments are ignored, unknown values are refused',
];

// One skill per phase plus the catalog itself, which is the smallest tree the
// script can pass: all six phases must be routed to, and direction B sees the
// catalog's own directory.
const BASE_ROWS = [
  ['Define', 'alpha-define'],
  ['Plan', 'alpha-plan'],
  ['Build', 'alpha-build'],
  ['Verify', 'alpha-verify'],
  ['Review', 'alpha-review'],
  ['Ship', 'alpha-ship'],
  ['All', CATALOG],
];

function writeSkill(root, name) {
  const dir = path.join(root, 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Does ${name} things. Use when doing ${name} things.\n---\n\n# ${name}\n`,
  );
}

/** Render a catalog SKILL.md from a row list and a conventions list. */
function catalogMarkdown(rows, conventions = CONVENTIONS, indexHeading = '## Skill Index') {
  return [
    '---',
    `name: ${CATALOG}`,
    'description: Routes work to a skill. Use when deciding which skill applies.',
    '---',
    '',
    '# Catalog',
    '',
    indexHeading,
    '',
    '| Phase | Skill | What it does |',
    '|---|---|---|',
    ...rows.map(([phase, skill]) => `| ${phase} | \`${skill}\` | does things |`),
    '',
    '## Flowly Conventions',
    '',
    ...conventions.flatMap(h => [h, '', 'Prose about the rule.', '']),
  ].join('\n');
}

/**
 * A sandbox whose skills tree exactly matches the catalog it is given.
 * `rows` doubles as the directory list unless `dirs` overrides it, so the
 * default state of every case is consistent and green.
 */
function makeSandbox({ rows = BASE_ROWS, dirs = null, catalog = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-check-catalog-test-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(CHECKER, path.join(root, 'scripts', 'check-catalog.js'));
  for (const name of dirs === null ? rows.map(r => r[1]) : dirs) writeSkill(root, name);
  const body = catalog === null ? catalogMarkdown(rows) : catalog;
  fs.mkdirSync(path.join(root, 'skills', CATALOG), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', CATALOG, 'SKILL.md'), `${body}\n`);
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'check-catalog.js')], {
    cwd: root,
    encoding: 'utf8',
  });
}

// ─── The positive control ────────────────────────────────────────────────────
//
// Every case below is "green tree, break one thing". Without this, a mutation
// that made the script fail unconditionally would still turn them all green.

test('passes when the catalog and the tree name the same set', () => {
  const root = makeSandbox();

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /0 error\(s\) — PASSED/);
  assert.match(result.stdout, /7 skill\(s\) named, 7 on disk/);
});

// ─── Direction A: named in the catalog, absent from the tree ─────────────────

test('direction A: fails when the catalog names a skill with no directory', () => {
  const root = makeSandbox({
    rows: [...BASE_ROWS, ['Build', 'alpha-invented']],
    dirs: BASE_ROWS.map(r => r[1]),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /named in the catalog, no `skills\/alpha-invented\/SKILL\.md`/);
});

test('direction A: a directory with no SKILL.md does not resolve', () => {
  const root = makeSandbox();
  fs.rmSync(path.join(root, 'skills', 'alpha-build', 'SKILL.md'));

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /named in the catalog, no `skills\/alpha-build\/SKILL\.md`/);
});

test('direction A: fails when a skill is named twice', () => {
  const root = makeSandbox({
    rows: [...BASE_ROWS, ['Build', 'alpha-build']],
    dirs: BASE_ROWS.map(r => r[1]),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /named 2 times in the catalog/);
});

// ─── Direction B: present in the tree, absent from the catalog ───────────────

test('direction B: fails when a skill directory is not named', () => {
  const root = makeSandbox({ dirs: [...BASE_ROWS.map(r => r[1]), 'alpha-stowaway'] });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /in the tree, missing from the catalog: skills\/alpha-stowaway/);
});

test('direction B: the catalog is not excused from naming itself', () => {
  const root = makeSandbox({ rows: BASE_ROWS.filter(([, s]) => s !== CATALOG) });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`in the tree, missing from the catalog: skills/${CATALOG}`));
});

test('direction B: a dotted directory is not a skill', () => {
  const root = makeSandbox();
  fs.mkdirSync(path.join(root, 'skills', '.scratch'), { recursive: true });

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// ─── Phases ──────────────────────────────────────────────────────────────────

test('fails on a phase outside the six plus the cross-cutting label', () => {
  const root = makeSandbox({
    rows: BASE_ROWS.map(([phase, skill]) => (skill === 'alpha-ship' ? ['Deploy', skill] : [phase, skill])),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /unknown phase "Deploy" for alpha-ship/);
});

test('fails when one of the six phases routes to nothing', () => {
  const root = makeSandbox({
    rows: BASE_ROWS.map(([phase, skill]) => (phase === 'Review' ? ['All', skill] : [phase, skill])),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /no skill is routed to the Review phase/);
});

// ─── Parsing ─────────────────────────────────────────────────────────────────

test('fails when there is no catalog at all', () => {
  const root = makeSandbox();
  fs.rmSync(path.join(root, 'skills', CATALOG), { recursive: true, force: true });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /no catalog at skills\/flowly-catalog\/SKILL\.md/);
});

test('fails when the index section is missing', () => {
  const root = makeSandbox({ catalog: catalogMarkdown(BASE_ROWS, CONVENTIONS, '## Skills') });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /no `## Skill Index` section/);
});

test('fails when a second index table appears under the same heading', () => {
  const doubled = catalogMarkdown(BASE_ROWS).replace(
    '## Flowly Conventions',
    ['| Phase | Skill | What it does |', '|---|---|---|', '| Build | `alpha-build` | again |', '', '## Flowly Conventions'].join('\n'),
  );
  const root = makeSandbox({ catalog: doubled });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /2 `\| Phase \| Skill \|` tables/);
});

test('fails when a Skill cell is not a backticked name', () => {
  const root = makeSandbox({
    catalog: catalogMarkdown(BASE_ROWS).replace('| `alpha-build` |', '| [alpha-build](../alpha-build/SKILL.md) |'),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Skill cell is not a backticked skill name/);
});

test('a table outside the index section does not feed the parser', () => {
  // The conventions section carries its own tables in the real catalog. If the
  // parse were file-wide rather than section-scoped, one of them would add rows
  // and both directions would report on skills nobody listed.
  const extra = catalogMarkdown(BASE_ROWS).replace(
    'Prose about the rule.',
    ['| Phase | Skill | What it does |', '|---|---|---|', '| Build | `alpha-ghost` | not a skill |'].join('\n'),
  );
  const root = makeSandbox({ catalog: extra });

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
});

// ─── Conventions ─────────────────────────────────────────────────────────────

test('fails when a convention subsection is dropped', () => {
  const root = makeSandbox({
    catalog: catalogMarkdown(BASE_ROWS, CONVENTIONS.filter(h => h !== '### There is no pagination')),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /has no `### There is no pagination` subsection/);
});

test('fails when the conventions section is absent entirely', () => {
  const root = makeSandbox({
    catalog: catalogMarkdown(BASE_ROWS).replace('## Flowly Conventions', '## Notes'),
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /no `## Flowly Conventions` section/);
});

test('a convention named outside its own section does not satisfy the check', () => {
  const root = makeSandbox({
    catalog: catalogMarkdown(BASE_ROWS, CONVENTIONS.filter(h => h !== '### Every list is capped'))
      + '\n\n## Appendix\n\n### Every list is capped\n',
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /has no `### Every list is capped` subsection/);
});

// ─── Error counting ──────────────────────────────────────────────────────────

test('counts failures, not the hint lines printed beside them', () => {
  // Three unlisted directories produce three failures and two `↳` hints. An
  // earlier version of this reporting shape in check-register.js counted both
  // and reported three failures as nine.
  const root = makeSandbox({
    dirs: [...BASE_ROWS.map(r => r[1]), 'alpha-one', 'alpha-two', 'alpha-three'],
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /— 3 error\(s\) — FAILED/);
});
