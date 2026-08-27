#!/usr/bin/env node
/**
 * Tests for check-corpus-counts.js.
 *
 * The assertions that matter here are the ones about finding NOTHING. A count
 * checker is a grep, and a grep whose pattern stops matching reports success over
 * an empty comparison — which is how the gate this repository replaced passed
 * having verified nothing. So a claim that matches zero times must fail, a claim
 * that matches twice must fail, and an empty tree must fail.
 *
 * Each case is a real tree in a temp dir driven through `--root`, because the
 * thing under test is what happens when files on disk disagree.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const CHECKER = path.join(__dirname, 'check-corpus-counts.js');

/**
 * A tree with `skills` skill directories (the first named `flowly-catalog`, the
 * next `ours` of them `flowly-`-prefixed), plus commands, agents and references.
 */
function tree({ skills = 4, ours = 2, commands = 3, agents = 2, references = 2 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-counts-'));
  const names = [];
  for (let i = 0; i < skills; i += 1) {
    names.push(i === 0 ? 'flowly-catalog' : i < ours ? `flowly-s${i}` : `inherited-s${i}`);
  }
  for (const name of names) {
    fs.mkdirSync(path.join(dir, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', name, 'SKILL.md'), '# s\n');
  }
  for (const [sub, n] of [['commands', commands], ['agents', agents], ['references', references]]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
    for (let i = 0; i < n; i += 1) fs.writeFileSync(path.join(dir, sub, `f${i}.md`), '# f\n');
  }
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  return dir;
}

/** Docs stating every claim. Defaults are the truth for `tree()`'s defaults. */
function docs(dir, over = {}) {
  const v = {
    heading: 4, total: 4, lifecycle: 3, ours: 2, inherited: 2,
    treeSkills: 4, treeLifecycle: 3, agents: 2, references: 2,
    installSkills: 4, installCommands: 3, installAgents: 2,
    ...over,
  };
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    [
      `## All ${v.heading} Skills`,
      '',
      `The pack includes ${v.total} skills total — ${v.lifecycle} lifecycle skills plus the router.`,
      `${v.ours} of them are ours; the other ${v.inherited} are inherited.`,
      '',
      '```',
      `├── skills/     # ${v.treeSkills} skills (${v.treeLifecycle} lifecycle + the catalog that routes to them)`,
      `├── agents/     # ${v.agents} specialist personas`,
      `├── references/ # ${v.references} supplementary checklists`,
      '```',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(dir, 'docs/install.md'),
    `Installing gives you ${v.installSkills} skills, ${v.installCommands} commands ` +
      `and ${v.installAgents} agent personas.\n`
  );
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [CHECKER, '--root', dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// --- the happy path ---------------------------------------------------------

test('passes when every claim matches the tree', () => {
  const { code, out } = run(docs(tree()));
  assert.equal(code, 0, out);
  assert.match(out, /11 claim\(s\) match the tree/);
});

test('the repository itself passes', () => {
  const r = spawnSync(process.execPath, [CHECKER], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

// --- vacuous passes, which are the whole point ------------------------------

test('a claim whose sentence was reworded FAILS rather than passing silently', () => {
  // The failure mode this file exists for. Deleting the sentence leaves nothing
  // to disagree with, and a naive implementation reports success.
  const dir = docs(tree());
  const readme = path.join(dir, 'README.md');
  fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace(/## All \d+ Skills/, '## Skills'));

  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /no sentence matches the skills heading claim/);
});

test('the refusal says to reword the pattern, not the prose', () => {
  const dir = docs(tree());
  const readme = path.join(dir, 'README.md');
  fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace(/## All \d+ Skills/, '## Skills'));
  assert.match(run(dir).out, /reword it here, not there/);
});

test('a pattern matching two places FAILS, because it then pins neither', () => {
  const dir = docs(tree());
  const readme = path.join(dir, 'README.md');
  fs.appendFileSync(readme, '\n\n## All 4 Skills\n');

  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /matches 2 places, so it pins none/);
});

test('an empty tree FAILS rather than checking every claim against zero', () => {
  const dir = docs(tree({ skills: 0 }));
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /nothing to count/);
});

test('a missing docs file FAILS rather than skipping its claims', () => {
  const dir = docs(tree());
  fs.rmSync(path.join(dir, 'docs/install.md'));
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /is missing/);
});

// --- drift, one key at a time ------------------------------------------------

test('a stale skills total is caught', () => {
  const { code, out } = run(docs(tree(), { total: 99 }));
  assert.equal(code, 1, out);
  assert.match(out, /skills total says 99, the tree has 4/);
});

test('a stale agent-persona count is caught', () => {
  // The FLO-305 case: a persona was added and the README was not touched.
  const { code, out } = run(docs(tree({ agents: 3 }), { agents: 2 }));
  assert.equal(code, 1, out);
  assert.match(out, /agent personas says 2, the tree has 3/);
});

test('a stale references count is caught', () => {
  // The case this gate found on its first run against the real repository.
  const { code, out } = run(docs(tree({ references: 8 }), { references: 7 }));
  assert.equal(code, 1, out);
  assert.match(out, /references says 7, the tree has 8/);
});

test('a stale command count is caught, from the install doc', () => {
  const { code, out } = run(docs(tree({ commands: 7 }), { installCommands: 6 }));
  assert.equal(code, 1, out);
  assert.match(out, /commands offered says 6, the tree has 7/);
});

test('BOTH numbers in the tree-diagram line are checked, not just the first', () => {
  // One sentence, two claims. An implementation reading only the first capture
  // passes this while the parenthesised half is wrong.
  const { code, out } = run(docs(tree(), { treeLifecycle: 99 }));
  assert.equal(code, 1, out);
  assert.match(out, /tree diagram says 99, the tree has 3/);
});

// --- spelling ----------------------------------------------------------------

test('a number spelled as an English word is read, not skipped', () => {
  const dir = tree({ commands: 7 });
  docs(dir);
  const install = path.join(dir, 'docs/install.md');
  fs.writeFileSync(install, 'Installing gives you 4 skills, seven commands and two agent personas.\n');
  const { code, out } = run(dir);
  assert.equal(code, 0, out);
});

test('a word-spelled number that is WRONG is still caught', () => {
  // Otherwise "read the word" could be implemented as "ignore the word".
  const dir = tree({ commands: 7 });
  docs(dir);
  const install = path.join(dir, 'docs/install.md');
  fs.writeFileSync(install, 'Installing gives you 4 skills, six commands and two agent personas.\n');
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /commands offered says six, the tree has 7/);
});

// --- what the derivation means ----------------------------------------------

test('ours and inherited always sum to the total', () => {
  const { derive } = require('./check-corpus-counts.js');
  const c = derive(tree({ skills: 9, ours: 4 }));
  assert.equal(c.ours + c.inherited, c.skills);
});

test('lifecycle excludes the catalog router', () => {
  const { derive } = require('./check-corpus-counts.js');
  const c = derive(tree({ skills: 6 }));
  assert.equal(c.lifecycle, c.skills - 1);
});

test('a directory without a SKILL.md is not a skill', () => {
  // Otherwise a stray folder under skills/ silently inflates every total.
  const { derive } = require('./check-corpus-counts.js');
  const dir = tree({ skills: 4 });
  fs.mkdirSync(path.join(dir, 'skills', 'not-a-skill'));
  assert.equal(derive(dir).skills, 4);
});
