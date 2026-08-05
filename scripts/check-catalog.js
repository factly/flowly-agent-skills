#!/usr/bin/env node
/**
 * check-catalog.js
 *
 * CLI that holds the skill catalog — `skills/flowly-catalog/SKILL.md` — to the
 * skills tree it claims to route across. The catalog is the one document whose
 * whole job is to be a list of other things, which makes it the one document
 * that is wrong the moment anything else moves, and the one whose wrongness
 * nothing else can see.
 *
 * The two ways it goes wrong are not symmetrical, and both are silent:
 *
 *   - A skill NAMED in the catalog that does not exist sends an agent to open
 *     nothing. Having been told a skill governs this task, it does not conclude
 *     the catalog is stale; it improvises the workflow — which is the exact
 *     failure a skill distribution exists to prevent. This is the direction the
 *     upstream meta-skill was already failing when it was inherited: its
 *     flowchart enumerated a catalog that is no longer ours.
 *   - A skill PRESENT in the tree that the catalog does not name is worse in a
 *     quieter way. It ships, it validates, it has eval cases, and nothing ever
 *     routes to it, so no user reports it missing and no check reports it
 *     absent. It is dead weight that reads as coverage.
 *
 * Nothing else in this repository can catch either one. `validate-skills.js`
 * reads each SKILL.md alone. `check-register.js` compares NOTICE.md to git.
 * The evals score descriptions against prompts and never open the catalog. The
 * catalog's claim about the corpus had no reader at all until this file.
 *
 * It asserts the following, and reports each separately:
 *
 *   1. The catalog exists and carries exactly one `| Phase | Skill | … |` table
 *      under `## Skill Index`. Scoping the parse to that section is what keeps
 *      it off the other tables in the file — the conventions, the
 *      rationalizations — which also carry backticked names in a first column.
 *   2. Direction A — every skill named in the catalog resolves to a real
 *      `skills/<name>/SKILL.md`.
 *   3. Direction B — every directory under `skills/` is named in the catalog.
 *   4. Every row's phase is one of the six this distribution ships, or the
 *      cross-cutting label, and all six phases appear. "Routes across the six
 *      phases" is otherwise a claim about a document nobody re-reads.
 *   5. The catalog still states the Flowly conventions every other skill relies
 *      on. Each is a rule that makes a wrong call look like a right one, so a
 *      rewrite that drops one costs nothing visible until an agent silently
 *      clears a priority or believes it filtered a list it did not.
 *
 * THE CATALOG NAMES ITSELF, DELIBERATELY
 * --------------------------------------
 * `flowly-catalog` is a directory under `skills/`, so direction B forces the
 * question: name itself, or carry an exemption. It names itself. An exemption
 * list is a second place to register a skill, and the one entry it would hold
 * is the entry most likely to be copied by the next person who finds direction
 * B inconvenient. Naming itself costs one row and leaves the rule absolute:
 * the table and the tree are the same set, with nothing excused from either
 * direction.
 *
 * Usage:   node scripts/check-catalog.js
 * Exit codes: 0 = all clear, 1 = one or more errors
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────

const REPO_ROOT  = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');

const CATALOG_SKILL = 'flowly-catalog';
const CATALOG_FILE  = `skills/${CATALOG_SKILL}/SKILL.md`;
const CATALOG_PATH  = path.join(REPO_ROOT, CATALOG_FILE);

const INDEX_HEADING       = 'Skill Index';
const CONVENTIONS_HEADING = 'Flowly Conventions';

// The six lifecycle phases, in order. Same list, same order as the six commands
// in check-commands.js and the phase map in CLAUDE.md — this is the shape the
// distribution is organised around, and the catalog is where a reader meets it.
const PHASES = ['Define', 'Plan', 'Build', 'Verify', 'Review', 'Ship'];

// The label for a skill that sits under all six rather than in one of them.
// Three do: the door every Flowly skill assumes is open, the run that spans two
// phases, and this catalog.
const CROSS_PHASE = 'All';

// The conventions the catalog owes every other skill, by the exact heading each
// is written under. Owned here rather than in the catalog for the reason
// check-commands.js owns its canonical blocks: a rule with no reader outside
// the file it lives in is a rule one rewrite deletes.
//
// Each of these decides whether a correct-looking tool call did what it said.
// An agent that reads `priority: 1` as "low", or passes `null` to `update_issue`
// expecting a field to clear, or trusts a list that was silently capped, or
// misspells a filter name and receives the whole instance back, gets no error
// from Flowly in any of the four cases.
const REQUIRED_CONVENTIONS = [
  '### Priority is inverted',
  '### `null` means two different things',
  '### There is no pagination',
  '### Every list is capped',
  '### Unknown arguments are ignored, unknown values are refused',
];

const HEADING_RE = /^##\s+(.*?)\s*$/;

// ─── Markdown parsing ────────────────────────────────────────────────────────
//
// The same three primitives check-register.js uses to read NOTICE.md. They are
// re-stated rather than shared because the two scripts are each meant to be
// readable end to end by whoever a red run wakes up, and a lib/ hop for
// twenty lines of string handling buys nothing.

/** Lines of the `## <name>` section, up to the next `## ` heading or EOF. */
function sectionLines(lines, name) {
  const start = lines.findIndex(l => {
    const m = HEADING_RE.exec(l);
    return m !== null && m[1] === name;
  });
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end);
}

/** Split a markdown table row into trimmed cells, or null if it is not one. */
function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.split('|');
  if (cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map(c => c.trim());
}

const isSeparatorRow = cells => cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));

/** Strip the wrapping backticks from a cell, or return null if it has none. */
function unticked(cell) {
  const m = /^`([^`]+)`$/.exec(cell);
  return m === null ? null : m[1];
}

/**
 * Read the index table: the one table in § Skill Index whose header row is
 * `| Phase | Skill | … |`. A row is `{ phase, skill }`.
 *
 * The Skill cell must be a backticked bare name. A link, a bare word or a
 * sentence is rejected rather than pattern-matched out, because every form this
 * parser silently accepts is a form the catalog can drift into while both
 * directions below keep passing.
 */
function parseIndex(lines) {
  const section = sectionLines(lines, INDEX_HEADING);
  if (section === null) {
    return { rows: [], errors: [`no \`## ${INDEX_HEADING}\` section in ${CATALOG_FILE}`] };
  }

  const errors = [];
  const rows   = [];
  let tablesFound = 0;
  let inTable     = false;

  for (const line of section) {
    const cells = tableCells(line);

    if (cells === null) { inTable = false; continue; }
    if (isSeparatorRow(cells)) continue;

    const isHeader = cells.length >= 2
      && cells[0].toLowerCase() === 'phase'
      && cells[1].toLowerCase() === 'skill';

    if (isHeader) { inTable = true; tablesFound++; continue; }
    if (!inTable) continue;

    if (cells.length < 2) {
      errors.push(`malformed index row (needs a Phase and a Skill cell): ${line.trim()}`);
      continue;
    }
    const skill = unticked(cells[1]);
    if (skill === null) {
      errors.push(`index row's Skill cell is not a backticked skill name: ${line.trim()}`);
      continue;
    }
    rows.push({ phase: cells[0], skill });
  }

  if (tablesFound === 0) {
    errors.push(`no \`| Phase | Skill |\` table under \`## ${INDEX_HEADING}\` in ${CATALOG_FILE}`);
  } else if (tablesFound > 1) {
    errors.push(`${tablesFound} \`| Phase | Skill |\` tables under \`## ${INDEX_HEADING}\` — there must be exactly one`);
  }

  return { rows, errors };
}

/** Every directory directly under `skills/`, sorted. Dotfiles are not skills. */
function skillDirectories(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)
    .sort();
}

// ─── Checks ──────────────────────────────────────────────────────────────────

/**
 * Each check accumulates two kinds of line in one array: a failure, and a `↳`
 * hint explaining how to fix it. `report` tells them apart by prefix when it
 * prints; the count returned to the summary must not, or three failing skills
 * are reported as nine errors and the number a reader trusts most is the one
 * number that is wrong. Count failures; hints are formatting.
 */
const HINT_PREFIX = '  ↳';

function countFailures(errors) {
  return errors.filter(e => !e.startsWith(HINT_PREFIX)).length;
}

/** Direction A: every skill named in the catalog resolves to a real skill. */
function checkNamedResolve(rows, report) {
  const errors  = [];
  const counted = new Map();

  for (const { skill } of rows) counted.set(skill, (counted.get(skill) || 0) + 1);

  for (const [skill, n] of counted) {
    if (n > 1) {
      errors.push(`named ${n} times in the catalog, must appear exactly once: ${skill}`);
    }
  }

  const unresolved = [...counted.keys()].filter(
    s => !fs.existsSync(path.join(SKILLS_DIR, s, 'SKILL.md')),
  );
  for (const skill of unresolved) {
    errors.push(`named in the catalog, no \`skills/${skill}/SKILL.md\`: ${skill}`);
  }
  if (unresolved.length > 0) {
    errors.push('  ↳ fix the name, or delete the row. An agent routed to a skill that does not exist does not stop — it improvises the workflow the skill was there to supply.');
  }

  report(
    errors,
    'every skill named in the catalog resolves',
    `${counted.size} skill(s) named, each once, each with a SKILL.md on disk`,
  );
  return countFailures(errors);
}

/** Direction B: every skill directory in the tree is named in the catalog. */
function checkTreeIsNamed(rows, dirs, report) {
  const errors = [];
  const named  = new Set(rows.map(r => r.skill));

  const unlisted = dirs.filter(d => !named.has(d));
  for (const dir of unlisted) {
    errors.push(`in the tree, missing from the catalog: skills/${dir}`);
  }
  if (unlisted.length > 0) {
    errors.push(`  ↳ add a row to \`## ${INDEX_HEADING}\` naming it under one of: ${PHASES.join(', ')}, ${CROSS_PHASE}.`);
    errors.push('  ↳ a skill nothing routes to is never invoked, and every other check in this repository passes over it happily.');
  }

  report(
    errors,
    'every skill directory is named in the catalog',
    `${dirs.length} director(y/ies) under skills/, all present in the index`,
  );
  return countFailures(errors);
}

/** The phase labels are the six the distribution ships, and all six are used. */
function checkPhases(rows, report) {
  const errors = [];
  const legal  = new Set([...PHASES, CROSS_PHASE]);
  const tally  = new Map(PHASES.map(p => [p, 0]));

  for (const { phase, skill } of rows) {
    if (!legal.has(phase)) {
      errors.push(`unknown phase "${phase}" for ${skill} — must be one of: ${[...legal].join(', ')}`);
      continue;
    }
    if (tally.has(phase)) tally.set(phase, tally.get(phase) + 1);
  }

  const empty = PHASES.filter(p => tally.get(p) === 0);
  for (const phase of empty) {
    errors.push(`no skill is routed to the ${phase} phase`);
  }
  if (empty.length > 0) {
    errors.push('  ↳ the catalog routes across six phases; one with nothing in it is a phase a reader cannot reach from here.');
  }

  const summary = PHASES.map(p => `${p} ${tally.get(p)}`).join(', ');
  report(errors, 'the six phases are all routed to', `${summary}, ${CROSS_PHASE} ${rows.length - [...tally.values()].reduce((a, b) => a + b, 0)}`);
  return countFailures(errors);
}

/** The conventions section still states each rule an agent gets no error for breaking. */
function checkConventions(lines, report) {
  const errors  = [];
  const section = sectionLines(lines, CONVENTIONS_HEADING);

  if (section === null) {
    errors.push(`no \`## ${CONVENTIONS_HEADING}\` section in ${CATALOG_FILE}`);
    errors.push('  ↳ this is where the rules that have no other home live. Every other skill assumes they were read.');
    report(errors, 'the Flowly conventions are stated', '');
    return countFailures(errors);
  }

  const present = new Set(section.map(l => l.trim()));
  for (const heading of REQUIRED_CONVENTIONS) {
    if (!present.has(heading)) {
      errors.push(`\`## ${CONVENTIONS_HEADING}\` has no \`${heading}\` subsection`);
    }
  }
  if (errors.length > 0) {
    errors.push('  ↳ the headings are owned by REQUIRED_CONVENTIONS in this script. Each names a rule Flowly does not enforce at the door: break it and the call succeeds, wrongly.');
  }

  report(
    errors,
    'the Flowly conventions are stated',
    `${REQUIRED_CONVENTIONS.length} convention(s) present under \`## ${CONVENTIONS_HEADING}\``,
  );
  return countFailures(errors);
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  let errorCount = 0;

  /** One ✓/✗ block per check, in the shape validate-skills.js prints. */
  const report = (errors, name, okMessage) => {
    if (errors.length === 0) {
      console.log(`  ✓  ${name} — ${okMessage}`);
      return;
    }
    console.log(`  ✗  ${name}`);
    for (const msg of errors) {
      console.log(msg.startsWith(HINT_PREFIX) ? `       ${msg}` : `       ERROR: ${msg}`);
    }
  };

  console.log(`Skill catalog — ${CATALOG_FILE} § ${INDEX_HEADING}\n`);

  const dirs = skillDirectories(SKILLS_DIR);

  console.log(`  Catalog:  ${CATALOG_FILE}`);
  console.log(`  Tree:     skills/ — ${dirs.length} director(y/ies)`);
  console.log(`  Phases:   ${PHASES.join(', ')} (+ ${CROSS_PHASE})\n`);

  if (!fs.existsSync(CATALOG_PATH)) {
    console.log('  ✗  the catalog exists');
    console.log(`       ERROR: no catalog at ${CATALOG_FILE}`);
    console.log('       ↳ every skill in this distribution is reached through it; without the file there is no router at all.');
    console.log(`\n0 skill(s) named, ${dirs.length} on disk — 1 error(s) — FAILED`);
    process.exit(1);
  }

  const lines = fs.readFileSync(CATALOG_PATH, 'utf8').split('\n');

  const { rows, errors: parseErrors } = parseIndex(lines);
  if (parseErrors.length > 0) {
    console.log('  ✗  index table');
    for (const msg of parseErrors) console.log(`       ERROR: ${msg}`);
    errorCount += parseErrors.length;
  }

  errorCount += checkNamedResolve(rows, report);
  errorCount += checkTreeIsNamed(rows, dirs, report);
  errorCount += checkPhases(rows, report);
  errorCount += checkConventions(lines, report);

  const status = errorCount > 0 ? 'FAILED' : 'PASSED';
  console.log(`\n${rows.length} skill(s) named, ${dirs.length} on disk — ${errorCount} error(s) — ${status}`);

  if (errorCount > 0) process.exit(1);
}

// Surface unexpected failures (fs errors, an unreadable file, …) as a
// structured one-line CI error instead of an uncaught stack trace.
try {
  main();
} catch (err) {
  console.error(`\nERROR: check-catalog failed unexpectedly: ${err.message}`);
  process.exit(1);
}
