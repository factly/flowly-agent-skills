#!/usr/bin/env node
/**
 * check-catalog.js
 *
 * CLI that holds this repository's hand-maintained lists of skills to the
 * skills tree they claim to cover. There are two, and they have the same
 * relationship to `skills/`: they are documents whose whole job is to be a list
 * of other things, which makes them the documents that are wrong the moment
 * anything else moves, and the ones whose wrongness nothing else can see.
 *
 *   - `skills/flowly-catalog/SKILL.md` § Skill Index — the router an agent is
 *     meant to arrive through.
 *   - `.github/ISSUE_TEMPLATE/skill-gap.yml` § the `id: skill` dropdown — the
 *     one route a user has to report that a skill's guidance was wrong.
 *
 * The two ways the catalog goes wrong are not symmetrical, and both are silent:
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
 *   3a. The gap template's dropdown offers exactly the same set, both ways: a
 *      skill on disk it cannot name has no route to a bug report, and an entry
 *      naming no skill routes a report at nothing.
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
 * WHY AN ISSUE TEMPLATE IS CHECKED BY A FILE CALLED check-catalog
 * ---------------------------------------------------------------
 * Because it is the same assertion about the same tree, and the alternative was
 * a second script that would have to re-derive `skills/`, re-state the two
 * directions and re-state the counting discipline below. The dropdown drifted
 * for the exact reason the catalog would have: nine skills shipped and nobody
 * hand-edited a list that nothing read. One reader for both lists is one place
 * to look when a skill is added.
 *
 * What this file is is the reader for every hand-maintained enumeration of the
 * skills tree. If a third one appears, it belongs here too — and if that stops
 * being true, this header is the thing to fix first.
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

const GAP_FILE = '.github/ISSUE_TEMPLATE/skill-gap.yml';
const GAP_PATH = path.join(REPO_ROOT, GAP_FILE);

// The dropdown this reads, by its `id`. GitHub's issue-form schema allows any
// number of dropdowns in one body, each with its own `options:`; naming the id
// is what stops this parser answering with some other list — a severity, an
// ecosystem, whatever the form grows next.
const GAP_DROPDOWN_ID = 'skill';

// The one option that is deliberately not a skill. The dropdown is `required`,
// so a form with no escape hatch makes a user whose gap is not in any single
// skill — a command, a hook, the install path — name one at random, and a report
// filed against the wrong skill is worse than one filed against none.
//
// It is an exemption, so it is asserted in both directions: an option that is
// not this string must resolve to a skill, AND this string must still be
// offered. An exemption whose subject has been deleted is a hole in a rule that
// nothing else reads.
const GAP_ESCAPE_HATCH = 'other / not sure';

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

// ─── Issue-form parsing ──────────────────────────────────────────────────────
//
// Line-based and scoped, for the reason the markdown above is: this repository
// is plain Node with no dependencies and no build step, and a YAML parser would
// be the first one — bought to read twenty lines of a file whose shape is fixed
// by GitHub's own schema. What is read is narrow on purpose: the `options:` of
// ONE dropdown, found by its `id`, with everything outside that item invisible.

const YAML_ITEM_RE  = /^(\s*)-\s+type:\s*(\S+)\s*$/;
const YAML_KEY_RE   = /^(\s*)([A-Za-z_][\w-]*):\s*(.*?)\s*$/;
const YAML_ENTRY_RE = /^(\s*)-\s+(.*?)\s*$/;

/** Strip one wrapping pair of quotes from a scalar; both forms mean the same. */
function unquoted(value) {
  const m = /^(["'])(.*)\1$/.exec(value);
  return m === null ? value : m[2];
}

/**
 * The template's body items, each running from its `- type:` line to the next
 * one at the same indent. `fieldIndent` is the column the item's own keys sit
 * at, so `id` can be read from the item rather than from anything nested under
 * it.
 */
function bodyItems(lines) {
  const starts = [];
  let indent = null;

  for (let i = 0; i < lines.length; i++) {
    const m = YAML_ITEM_RE.exec(lines[i]);
    if (m === null) continue;
    if (indent === null) indent = m[1];
    if (m[1] === indent) starts.push({ at: i, type: m[2], fieldIndent: m[1].length + 2 });
  }

  return starts.map((s, n) => ({
    type: s.type,
    fieldIndent: s.fieldIndent,
    lines: lines.slice(s.at + 1, n + 1 < starts.length ? starts[n + 1].at : lines.length),
  }));
}

/**
 * The `options:` of the `id: <GAP_DROPDOWN_ID>` dropdown, in file order.
 *
 * Only the block form (`- one entry per line`) is read. A flow list is rejected
 * loudly rather than parsed, because the alternative is reading nothing and
 * reporting every skill on disk as missing — a red run that blames 33 skills
 * for one line's syntax.
 */
function parseGapOptions(lines) {
  const errors = [];

  const dropdowns = bodyItems(lines).filter(item => item.type === 'dropdown' && item.lines.some(l => {
    const m = YAML_KEY_RE.exec(l);
    return m !== null && m[1].length === item.fieldIndent && m[2] === 'id' && unquoted(m[3]) === GAP_DROPDOWN_ID;
  }));

  if (dropdowns.length === 0) {
    errors.push(`no \`- type: dropdown\` with \`id: ${GAP_DROPDOWN_ID}\` in ${GAP_FILE}`);
    errors.push('  ↳ the id is what this check finds the list by. Renaming it does not remove the list, it removes its reader.');
    return { options: [], errors };
  }
  if (dropdowns.length > 1) {
    errors.push(`${dropdowns.length} dropdowns with \`id: ${GAP_DROPDOWN_ID}\` in ${GAP_FILE} — there must be exactly one`);
  }

  const item = dropdowns[0];
  let optionsAt     = -1;
  let optionsIndent = 0;

  for (let i = 0; i < item.lines.length; i++) {
    const m = YAML_KEY_RE.exec(item.lines[i]);
    if (m === null || m[2] !== 'options') continue;
    if (m[3] !== '') {
      errors.push(`the \`id: ${GAP_DROPDOWN_ID}\` dropdown's \`options:\` is not a block list: ${item.lines[i].trim()}`);
      errors.push('  ↳ one `- <skill>` per line, alphabetical — the form this check reads and the form a diff of it is reviewable in.');
      return { options: [], errors };
    }
    optionsAt     = i;
    optionsIndent = m[1].length;
    break;
  }

  if (optionsAt === -1) {
    errors.push(`the \`id: ${GAP_DROPDOWN_ID}\` dropdown in ${GAP_FILE} has no \`options:\` list`);
    return { options: [], errors };
  }

  const options = [];
  for (let i = optionsAt + 1; i < item.lines.length; i++) {
    const trimmed = item.lines[i].trim();
    // A blank line or a comment inside the list is not the end of it. Treating
    // either as a terminator would drop every entry below it, and the report
    // would blame those skills rather than the line that stopped the read.
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const m = YAML_ENTRY_RE.exec(item.lines[i]);
    if (m === null || m[1].length <= optionsIndent) break;
    options.push(unquoted(m[2]));
  }

  if (options.length === 0) {
    errors.push(`the \`id: ${GAP_DROPDOWN_ID}\` dropdown's \`options:\` list is empty`);
  }

  return { options, errors };
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

/**
 * The gap template's dropdown offers exactly the skills tree, plus the escape
 * hatch.
 *
 * ONE BLOCK, NOT TWO. The catalog's directions get a block each because their
 * consequences are different enough to want separate messages a reader can act
 * on alone. Here they are one failure with two faces — the dropdown and the
 * tree disagree — and splitting them would put two blocks in the report for a
 * list that is edited in one place. The two messages still say which way round
 * it is; the fix is the same file either way.
 */
function checkGapTemplate(dirs, report) {
  const errors = [];

  if (!fs.existsSync(GAP_PATH)) {
    errors.push(`no gap report template at ${GAP_FILE}`);
    errors.push('  ↳ it is the only route a user has to tell us a skill was wrong. Without it the report arrives as free text against nothing, or not at all.');
    report(errors, 'every skill is offered by the gap report template', '');
    return countFailures(errors);
  }

  const { options, errors: parseErrors } = parseGapOptions(fs.readFileSync(GAP_PATH, 'utf8').split('\n'));
  errors.push(...parseErrors);

  const counted = new Map();
  for (const option of options) counted.set(option, (counted.get(option) || 0) + 1);

  for (const [option, n] of counted) {
    if (n > 1) {
      errors.push(`offered ${n} times by the gap template, must appear exactly once: ${option}`);
    }
  }

  // Guarded on a list that was actually read: an unparseable `options:` has
  // already reported why, and "no escape hatch" on top of it points at the
  // wrong line.
  if (options.length > 0 && !counted.has(GAP_ESCAPE_HATCH)) {
    errors.push(`the gap template offers no \`${GAP_ESCAPE_HATCH}\` option`);
    errors.push('  ↳ this check excuses that entry from naming a skill, so deleting it retires an exemption in silence — and leaves a required dropdown that forces a wrong answer.');
  }

  // Everything else must be a skill. The escape hatch is the only string in the
  // list that is allowed not to be one.
  const named = [...counted.keys()].filter(o => o !== GAP_ESCAPE_HATCH);

  const unresolved = named.filter(o => !fs.existsSync(path.join(SKILLS_DIR, o, 'SKILL.md')));
  for (const option of unresolved) {
    errors.push(`offered by the gap template, no \`skills/${option}/SKILL.md\`: ${option}`);
  }
  if (unresolved.length > 0) {
    errors.push('  ↳ fix the entry, or delete it. A report filed against a skill that does not exist is triaged against nothing, by a user who did everything the form asked.');
  }

  const offered = new Set(named);
  const unlisted = dirs.filter(d => !offered.has(d));
  for (const dir of unlisted) {
    errors.push(`in the tree, missing from the gap template dropdown: skills/${dir}`);
  }
  if (unlisted.length > 0) {
    errors.push(`  ↳ add it to the \`options:\` of the \`id: ${GAP_DROPDOWN_ID}\` dropdown in ${GAP_FILE}, in alphabetical order.`);
    errors.push('  ↳ a gap in a skill the form cannot name is filed against something else or not filed at all — either way the skill it belongs to is never told.');
  }

  // The list is maintained by hand and read as one. Sorted is what makes a
  // missing entry visible to a reviewer, and unsorted is what an append at the
  // bottom — the way the nine `flowly-` skills would have been added — looks
  // like.
  const sorted = [...named].sort();
  const outOfPlace = named.find((o, i) => o !== sorted[i]);
  if (outOfPlace !== undefined) {
    errors.push(`the gap template's skill options are not in alphabetical order — \`${outOfPlace}\` is out of place`);
    errors.push(`  ↳ \`${GAP_ESCAPE_HATCH}\` is not part of this order — it is filtered out first, and sits last in the form. Everything else sorts.`);
  }

  report(
    errors,
    'every skill is offered by the gap report template',
    `${named.length} skill(s) offered, ${dirs.length} on disk, alphabetical, plus \`${GAP_ESCAPE_HATCH}\``,
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

  console.log('Skill lists — the catalog index and the gap report dropdown\n');

  const dirs = skillDirectories(SKILLS_DIR);

  console.log(`  Catalog:  ${CATALOG_FILE} § ${INDEX_HEADING}`);
  console.log(`  Template: ${GAP_FILE} § the \`id: ${GAP_DROPDOWN_ID}\` dropdown`);
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
  errorCount += checkGapTemplate(dirs, report);
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
