#!/usr/bin/env node
/**
 * check-deletions.js — assert that every inherited file this fork deleted is
 * recorded in NOTICE.md § Removed at import.
 *
 * WHY THIS EXISTS
 * ---------------
 * docs/sync.md states the rule and NOTICE.md repeats it twice in its own prose:
 * a merge cannot tell "an inherited file is gone" apart from "an inherited file
 * was never here". Upstream offers every deletion back on the next sync as a
 * modify/delete conflict, and a resolver with no record of why the file went has
 * no basis to answer no. The default answer to a conflict you do not understand
 * is to keep the file, so an unrecorded deletion is a deletion that silently
 * undoes itself.
 *
 * The rule was written down and then nothing enforced it. Eight deletions had
 * accumulated with no record — the five setup guides for the doors this fork
 * does not ship, a superseded workflow, and the eval case and fixture belonging
 * to the meta-skill that NOTICE.md discusses at length everywhere except in the
 * one section a resolver reads.
 *
 * TWO WAYS THE ENUMERATION LIES
 * -----------------------------
 * Both were hit while writing this, and both look like a clean result.
 *
 * `git diff --diff-filter=D` alone under-reports. Git reclassifies a delete plus
 * a similar add as a RENAME, so replacing an inherited file with a Flowly-native
 * one at a new name drops out of the deletion list entirely — which is exactly
 * what happened to `evals/cases/using-agent-skills.json`. `--no-renames` is not
 * a style preference here; without it this check cannot see the deletions most
 * worth recording.
 *
 * Matching a path against NOTICE.md with a plain substring search over-reports
 * as covered. A row naming `docs/` would silently absolve every deletion under
 * `docs/`. So coverage is decided against the § Removed at import table only,
 * and a directory row covers a path only when it is written with its trailing
 * slash.
 *
 * WHY THE TABLE AND NOT THE SECTION
 * ---------------------------------
 * Scoping to the section was the mitigation above, and reading the section's
 * PROSE defeated it. The section explains its removals at length, and prose
 * about a removal names paths that were not removed: `skills/` appeared inside
 * "opencode symlink into `skills/`" — a description of what a deleted symlink
 * pointed AT — and `scripts/` inside "Its `scripts/` directory was empty
 * afterwards". Harvested as records, each became a blanket over a whole
 * subtree, and between them they absolved every validator and every skill in
 * the repository. The gate stayed green over its own deletion.
 *
 * A removal record is therefore the FIRST COLUMN of the table, and nothing
 * else. The second column describes and the surrounding prose argues; only the
 * first column claims "this path is gone". That is also what makes the reported
 * count mean something: a shell assignment written in the prose
 * (`IDEAS_DIR="docs/ideas"`) is no longer counted as a path.
 *
 * The consequence is that a removal recorded only in prose does not count, so
 * the records that lived there were moved into the table. That is the right
 * direction: the table is what a merge resolver reads.
 *
 * Usage:  node scripts/check-deletions.js [--root <dir>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const NOTICE_FILE = 'NOTICE.md';
const REMOVED_HEADING = '## Removed at import';

function parseRoot(argv) {
  const i = argv.indexOf('--root');
  return i === -1 ? path.resolve(__dirname, '..') : path.resolve(argv[i + 1]);
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The § Removed at import section body, or null when the heading is absent. */
function removedSection(notice) {
  const start = notice.indexOf(REMOVED_HEADING);
  if (start === -1) return null;
  const rest = notice.slice(start + REMOVED_HEADING.length);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Paths recorded as removed: the backticked tokens in the FIRST COLUMN of the
 * section's table, and nothing else. See the header — the section's prose names
 * paths that are still here, and reading them absolves whole subtrees.
 *
 * The header row (`| Removed | Was |`) and the delimiter (`|---|---|`) carry no
 * backticks, so neither needs a special case.
 */
function recordedPaths(section) {
  const paths = [];
  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const firstCell = trimmed.slice(1).split('|')[0];
    for (const m of firstCell.matchAll(/`([^`]+)`/g)) paths.push(m[1]);
  }
  return paths;
}

function isCovered(file, recorded) {
  return recorded.some((r) => r === file || (r.endsWith('/') && file.startsWith(r)));
}

/** Base SHA out of the § Base table, so this check and check-register agree. */
function baseSha(notice) {
  const m = /\|\s*Base SHA\s*\|\s*`([0-9a-f]{40})`\s*\|/.exec(notice);
  return m ? m[1] : null;
}

/** The exit footer, in one place: five preconditions and the result share it. */
function finish(errors) {
  console.log(`\n${errors} error(s) — ${errors ? 'FAILED' : 'PASSED'}`);
  return errors ? 1 : 0;
}

/** A precondition that could not be met: report it, then exit as one error. */
function fail(...lines) {
  for (const line of lines) console.log(line);
  return finish(1);
}

function main(argv = process.argv.slice(2)) {
  const root = parseRoot(argv);
  const noticePath = path.join(root, NOTICE_FILE);

  if (!fs.existsSync(noticePath)) {
    return fail(`✗  ${NOTICE_FILE} not found`);
  }

  const notice = fs.readFileSync(noticePath, 'utf8');
  const sha = baseSha(notice);
  if (!sha) {
    return fail(`✗  no \`Base SHA\` row in ${NOTICE_FILE} — deletions cannot be enumerated`);
  }

  const section = removedSection(notice);
  if (section === null) {
    return fail(`✗  ${NOTICE_FILE} has no \`${REMOVED_HEADING}\` section`);
  }

  let deleted;
  try {
    // --no-renames: see the header. A rename is a deletion as far as the next
    // merge is concerned, and it is the case most worth recording.
    deleted = git(root, ['diff', '--no-renames', '--diff-filter=D', '--name-only', sha, 'HEAD'])
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    return fail(
      `✗  cannot diff against the base SHA ${sha} — ${err.message.split('\n')[0]}`,
      '   (a shallow clone has no base commit; fetch with fetch-depth: 0)',
    );
  }

  const recorded = recordedPaths(section);
  if (recorded.length === 0) {
    return fail(`✗  \`${REMOVED_HEADING}\` records no paths — nothing could fail this check`);
  }

  const missing = deleted.filter((f) => !isCovered(f, recorded));
  for (const file of missing) {
    console.log(`✗  ${file} was deleted since the base but is not recorded in \`${REMOVED_HEADING}\``);
  }

  // The mirror claim — a recorded path that is present again, meaning a merge
  // reinstated something the record says is gone — is deliberately NOT checked
  // here. `check-register.js` already fails on a resurrected inherited file
  // through its bidirectional completeness assertion, and `check-catalog.js`
  // fails on a resurrected skill. Asserting it a third time from this section
  // would need the section's prose to distinguish paths it names as REMOVED
  // from paths it names as KEPT (`.codex-plugin/plugin.json`) or as the
  // replacement (`skills/flowly-catalog/SKILL.md`) — a distinction the prose
  // does not draw, and inventing one here would trade a real check for four
  // false positives.
  if (missing.length === 0) {
    console.log(`✓  every deletion is recorded — ${deleted.length} file(s) deleted since the base, ${recorded.length} path(s) recorded`);
  }

  return finish(missing.length);
}

module.exports = { main, removedSection, recordedPaths, isCovered, baseSha };

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`\nERROR: check-deletions failed unexpectedly: ${err.message}`);
    process.exit(1);
  }
}
