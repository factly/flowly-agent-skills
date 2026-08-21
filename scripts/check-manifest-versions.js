#!/usr/bin/env node
/**
 * check-manifest-versions.js — the two shipped manifests declare one version.
 *
 * This fork ships two manifests that both carry a version, and a reader of
 * either one is entitled to believe it. `.claude-plugin/plugin.json` is what
 * the installed plugin reports; `.claude-plugin/marketplace.json` is what the
 * marketplace listing advertises before anyone installs anything. When they
 * disagree, nothing fails: the plugin installs, the listing renders, and the
 * two numbers are simply different in two places nobody diffs.
 *
 * WHY THIS DOES NOT ASK GIT WHAT THE VERSION IS
 * ---------------------------------------------
 * Upstream shipped `validate-versions.js` to do this job and it pinned every
 * manifest to `git describe --tags --abbrev=0`. That is the obvious design and
 * it is why this file exists instead of that one. Two failures, both measured
 * on this repository before it was deleted (see NOTICE.md § Removed at import):
 *
 *   - `git describe --tags` exits non-zero on a clone with no tags, and the
 *     call was unguarded, so the script threw before reading a manifest. Our
 *     origin carried no tags at all.
 *   - `actions/checkout` clones shallow by default. Even with tags published, a
 *     depth-limited clone can fail to reach the most recent one, so the check's
 *     answer depends on CI's fetch depth rather than on the repository.
 *
 * A gate whose result depends on tagging discipline and clone depth is a gate
 * that goes red for reasons unrelated to what it checks. So this compares the
 * files this repository ships, to each other, and needs no git at all.
 *
 * WHAT THAT BUYS AND WHAT IT DOES NOT
 * -----------------------------------
 * Be honest about the limit: two sources agreeing is one source. This catches
 * drift between the manifests and nothing else — both wrong in the same way
 * passes, because from inside the tree there is nothing to disagree with.
 *
 * The independent third source is a tag, and the one place it is safe to read
 * one is a release job, where a tag is guaranteed to exist because publishing
 * it is what triggered the run. `--tag <ref>` is that mode: it asserts the
 * manifests match the ref a release is publishing under, accepting a leading
 * `v`. It is deliberately not wired into CI, for the same reason
 * `validate-standard.sh --reference` is not — a mode that cannot run on an
 * ordinary push does not belong on the critical path of one.
 *
 * VACUOUS PASSES ARE FAILURES HERE
 * --------------------------------
 * The checker this replaces printed `4 files checked — 0 error(s) — PASSED`
 * having verified nothing, because it skipped absent files rather than failing
 * on them. So every way of finding nothing to compare is an error below: a
 * missing manifest, a missing `plugins` array, no entry matching the plugin's
 * own name, and a version key that is absent rather than merely different.
 *
 * Usage:  node scripts/check-manifest-versions.js [--root <dir>] [--tag <ref>]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_REL = '.claude-plugin/plugin.json';
const MARKET_REL = '.claude-plugin/marketplace.json';

// A version this fork could actually ship: major.minor.patch, with an optional
// prerelease/build tail. Deliberately not a full semver grammar — the job is to
// reject `latest`, `0.1` and an empty string, not to adjudicate edge cases.
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function rootFrom(argv) {
  const i = argv.indexOf('--root');
  return i === -1 ? path.resolve(__dirname, '..') : path.resolve(argv[i + 1]);
}

function tagFrom(argv) {
  const i = argv.indexOf('--tag');
  return i === -1 ? null : argv[i + 1];
}

/** Reads and parses one JSON file. Returns {error} rather than throwing. */
function readJson(root, rel) {
  const abs = path.join(root, rel);
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch {
    return { error: `${rel} is missing — this fork ships it, so its absence is a broken build` };
  }
  try {
    return { value: JSON.parse(raw) };
  } catch (err) {
    return { error: `${rel} is not valid JSON — ${err.message}` };
  }
}

/**
 * The version the marketplace advertises for the plugin `plugin.json` names.
 *
 * Matched by name rather than by position: `plugins[0]` would keep answering
 * after a second entry was added, and would answer about the wrong one.
 */
function marketplaceEntry(market, pluginName) {
  if (!Array.isArray(market.plugins)) {
    return { error: `${MARKET_REL} has no \`plugins\` array — nothing to compare` };
  }
  if (market.plugins.length === 0) {
    return { error: `${MARKET_REL} lists no plugins — nothing to compare` };
  }
  const entry = market.plugins.find((p) => p && p.name === pluginName);
  if (!entry) {
    const seen = market.plugins.map((p) => (p && p.name) || '<unnamed>').join(', ');
    return {
      error:
        `${MARKET_REL} has no entry named "${pluginName}" — ` +
        `${PLUGIN_REL} names that plugin, the marketplace lists: ${seen}`,
    };
  }
  return { value: entry };
}

function checkVersions(root, tag, report) {
  let errors = 0;

  const plugin = readJson(root, PLUGIN_REL);
  const market = readJson(root, MARKET_REL);
  for (const r of [plugin, market]) {
    if (r.error) {
      report.error(r.error);
      errors += 1;
    }
  }
  if (errors > 0) return errors;

  const pluginName = plugin.value.name;
  if (typeof pluginName !== 'string' || pluginName === '') {
    report.error(`${PLUGIN_REL} has no \`name\` — the marketplace entry cannot be identified`);
    return errors + 1;
  }

  const entry = marketplaceEntry(market.value, pluginName);
  if (entry.error) {
    report.error(entry.error);
    return errors + 1;
  }

  const pluginVersion = plugin.value.version;
  const marketVersion = entry.value.version;

  for (const [rel, version] of [
    [PLUGIN_REL, pluginVersion],
    [`${MARKET_REL} → plugins["${pluginName}"]`, marketVersion],
  ]) {
    if (version === undefined) {
      report.error(`${rel} declares no \`version\` — a version nobody states cannot be checked`);
      errors += 1;
    } else if (typeof version !== 'string' || !VERSION_RE.test(version)) {
      report.error(`${rel} version is not major.minor.patch — got ${JSON.stringify(version)}`);
      errors += 1;
    }
  }
  if (errors > 0) return errors;

  if (pluginVersion !== marketVersion) {
    report.error(
      `the two manifests disagree — ${PLUGIN_REL} says ${pluginVersion}, ` +
        `${MARKET_REL} advertises ${marketVersion}`
    );
    report.detail('a reader of either file is entitled to believe it; only one of them can be right');
    return errors + 1;
  }

  report.pass(`both manifests declare ${pluginVersion} for "${pluginName}"`);

  if (tag !== null) {
    const wanted = tag.replace(/^v/, '');
    if (wanted !== pluginVersion) {
      report.error(`release ref ${tag} does not match the manifests' ${pluginVersion}`);
      return errors + 1;
    }
    report.pass(`release ref ${tag} matches the manifests`);
  }

  return errors;
}

function main(argv) {
  const root = rootFrom(argv);
  const tag = tagFrom(argv);

  const report = {
    pass: (m) => console.log(`  ✓  ${m}`),
    error: (m) => console.log(`  ✗  ${m}`),
    detail: (m) => console.log(`       ${m}`),
  };

  console.log('\nManifest versions — the two shipped manifests declare one version\n');

  const errors = checkVersions(root, tag, report);

  const status = errors > 0 ? 'FAILED' : 'PASSED';
  console.log(`\n2 manifest(s) checked — ${errors} error(s) — ${status}`);

  if (tag === null) {
    console.log('\nTwo agreeing sources are one source. The independent check is a tag, and a');
    console.log('release job is the only place one is guaranteed: node scripts/check-manifest-versions.js --tag "$REF"');
  }

  if (errors > 0) process.exit(1);
}

module.exports = { main, checkVersions, marketplaceEntry, readJson, rootFrom, tagFrom, VERSION_RE };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`\nERROR: check-manifest-versions failed unexpectedly: ${err.message}`);
    process.exit(1);
  }
}
