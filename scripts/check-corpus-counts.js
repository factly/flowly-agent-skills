#!/usr/bin/env node
/**
 * check-corpus-counts.js — hold the totals this distribution ADVERTISES to the
 * tree it actually ships.
 *
 * WHY THIS EXISTS
 * ---------------
 * `README.md` says "34 skills". `skills/` holds 34 directories. Nothing connected
 * those two facts — they agreed only because somebody typed the right number, and
 * every gate stayed green the three times somebody did not:
 *
 *   - `flowly-batch` landed:  33 skills became 34, six commands became seven.
 *   - FLO-305 added `implementer`:      four agent personas became five.
 *   - FLO-305 added `agent-delegation.md`: seven references became eight.
 *
 * The third was still wrong an hour after the first two were corrected by hand,
 * in a block the corrector had open at the time. That is the argument for this
 * file: a number in prose is a claim nobody re-derives, and a reader deciding
 * whether to adopt this pack reads exactly these numbers.
 *
 * WHY NO EXISTING GATE COULD CATCH IT
 * -----------------------------------
 * `check-command-refs.js` comes closest and is looking at a different thing: it
 * asserts every command NAMED by the corpus resolves to a file that exists. A
 * total being wrong names nothing, resolves nothing, and breaks no link.
 * `check-catalog.js` holds the catalog index to the skills tree in both
 * directions, but its subject is a LIST — a claim of the form "these are the
 * skills" — and a count is not a list. Both stayed green through all three.
 *
 * VACUOUS PASSES ARE FAILURES HERE
 * --------------------------------
 * The obvious implementation greps for a pattern and checks the number it finds.
 * That check dies silently the first time someone rewords the sentence: the
 * pattern matches nothing, there is nothing to disagree with, and it reports
 * success over an empty comparison — which is precisely the failure
 * `check-manifest-versions.js` was written to replace.
 *
 * So a claim whose pattern matches ZERO times is an error, and so is one that
 * matches more than once, because two matches mean the pattern is not pinned to
 * the sentence it was written for. Rewording a claim is meant to be a decision
 * made here, in `CLAIMS`, rather than a way to switch a check off.
 *
 * WHAT IS DELIBERATELY NOT PINNED
 * -------------------------------
 * "The six lifecycle commands" in `README.md` and `docs/install.md`. Six is the
 * number of lifecycle PHASES, and `/flowly:batch` is deliberately not one — see
 * the comment above `COMMANDS` in `check-commands.js`. Phase-ness is a decision
 * recorded in that file, not a property of the filesystem, so deriving it here
 * would mean copying the decision to a second place. Both sentences name
 * `/flowly:batch` separately in the paragraph that follows, which is what keeps
 * them true.
 *
 * Usage:  node scripts/check-corpus-counts.js [--root <dir>]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

/** Numerals appear in this corpus as digits and as English words. Both are read. */
const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty',
];

/** `"34"` or `"Eleven"` as a number, or NaN when it is neither. */
function asNumber(token) {
  if (/^\d+$/.test(token)) return Number(token);
  const i = WORDS.indexOf(token.toLowerCase());
  return i === -1 ? NaN : i;
}

/**
 * A capture group matching either spelling, so CLAIMS entries stay readable.
 *
 * The placeholder is `%N%` and not `#`, which was the first version and was
 * wrong: `#` opens a markdown heading, so `'## All # Skills'` substituted three
 * times and matched nothing. A placeholder has to be a token the corpus being
 * matched cannot contain.
 */
const NUM = `(\\d+|${WORDS.join('|')})`;
const numIn = (pattern) => new RegExp(pattern.replaceAll('%N%', NUM), 'gi');

function dirsWithSkill(root) {
  const dir = path.join(root, 'skills');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
    .map((e) => e.name);
}

function markdownIn(root, sub) {
  const dir = path.join(root, sub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
}

/**
 * Every total, derived from the tree rather than stated.
 *
 * `lifecycle` excludes `flowly-catalog`, which routes to the others rather than
 * covering a phase — the distinction the README itself draws. `ours` is the
 * `flowly-` prefixed set and `inherited` is the remainder, so the two always sum
 * to the total and cannot drift apart.
 */
function derive(root) {
  const skills = dirsWithSkill(root);
  const ours = skills.filter((n) => n.startsWith('flowly-'));
  return {
    skills: skills.length,
    lifecycle: skills.length - (skills.includes('flowly-catalog') ? 1 : 0),
    ours: ours.length,
    inherited: skills.length - ours.length,
    commands: markdownIn(root, 'commands').length,
    agents: markdownIn(root, 'agents').length,
    references: markdownIn(root, 'references').length,
  };
}

/**
 * Each claim is one sentence this distribution makes about its own size.
 *
 * `%N%` in a pattern is the numeral. Patterns are anchored on enough surrounding
 * words to match one sentence and no other — a loose pattern that matched twice
 * is an error rather than a coin toss about which one it checked.
 */
const CLAIMS = [
  ['README.md', 'skills', '## All %N% Skills', 'skills heading'],
  ['README.md', 'skills', 'pack includes %N% skills total', 'skills total'],
  ['README.md', 'lifecycle', '— %N% lifecycle skills plus', 'lifecycle skills'],
  ['README.md', 'ours', '%N% of them are ours', 'skills that are ours'],
  ['README.md', 'inherited', 'the other %N% are inherited', 'inherited skills'],
  ['README.md', 'skills', '%N% skills \\(%N% lifecycle \\+ the catalog', 'tree diagram'],
  ['README.md', 'agents', '%N% specialist personas', 'agent personas'],
  ['README.md', 'references', '%N% supplementary checklists', 'references'],
  ['docs/install.md', 'skills', 'gives you %N% skills', 'install headline'],
  ['docs/install.md', 'commands', 'skills, %N% commands', 'commands offered'],
  ['docs/install.md', 'agents', 'and %N% agent personas', 'personas offered'],
];

function rootFrom(argv) {
  const i = argv.indexOf('--root');
  return i === -1 ? REPO_ROOT : path.resolve(argv[i + 1]);
}

function check(root, report) {
  const counts = derive(root);
  let errors = 0;

  // A tree with nothing in it would make every claim vacuously checkable against
  // zero. Refuse it: this gate has no meaning without a corpus to count.
  if (counts.skills === 0) {
    report.error(`no skills found under ${path.join(root, 'skills')} — nothing to count`);
    return 1;
  }

  const files = new Map();
  for (const [file] of CLAIMS) {
    if (files.has(file)) continue;
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) {
      report.error(`${file} is missing — a claim cannot be checked against a file that is not there`);
      errors += 1;
      continue;
    }
    files.set(file, fs.readFileSync(abs, 'utf8'));
  }
  if (errors > 0) return errors;

  for (const [file, key, pattern, label] of CLAIMS) {
    const found = [...files.get(file).matchAll(numIn(pattern))];
    if (found.length === 0) {
      report.error(`${file}: no sentence matches the ${label} claim`);
      report.detail(`pattern: /${pattern.replaceAll('%N%', '<number>')}/i — reword it here, not there`);
      errors += 1;
      continue;
    }
    if (found.length > 1) {
      report.error(`${file}: the ${label} pattern matches ${found.length} places, so it pins none`);
      errors += 1;
      continue;
    }
    // Every capture in the match, so a sentence stating two numbers is checked on
    // both — the tree diagram says "34 skills (33 lifecycle + …)" in one line.
    const captures = found[0].slice(1).filter((c) => c !== undefined);
    const keys = key === 'skills' && captures.length === 2 ? ['skills', 'lifecycle'] : [key];
    for (let i = 0; i < keys.length; i += 1) {
      const claimed = asNumber(captures[i]);
      const actual = counts[keys[i]];
      if (claimed !== actual) {
        report.error(`${file}: ${label} says ${captures[i]}, the tree has ${actual}`);
        errors += 1;
      }
    }
  }

  if (errors === 0) {
    report.pass(
      `${CLAIMS.length} claim(s) match the tree — ` +
        `${counts.skills} skills (${counts.ours} ours, ${counts.inherited} inherited), ` +
        `${counts.commands} commands, ${counts.agents} agents, ${counts.references} references`
    );
  }
  return errors;
}

function main(argv) {
  const root = rootFrom(argv);
  const report = {
    pass: (m) => console.log(`  ✓  ${m}`),
    error: (m) => console.log(`  ✗  ${m}`),
    detail: (m) => console.log(`       ↳ ${m}`),
  };

  console.log('\nCorpus counts — the totals the docs advertise against the tree that ships\n');
  const errors = check(root, report);
  console.log(
    `\n${CLAIMS.length} claim(s) checked — ${errors} error(s) — ${errors ? 'FAILED' : 'PASSED'}\n`
  );
  return errors === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { derive, asNumber, CLAIMS };
