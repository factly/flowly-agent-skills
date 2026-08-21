#!/usr/bin/env node
/**
 * Tests for check-manifest-versions.js.
 *
 * The gate this replaces passed on this repository having verified nothing,
 * because it skipped what it could not find. So the assertions that matter here
 * are the ones about finding nothing: a missing manifest, an empty `plugins`
 * array, an entry under a different name, and an absent `version` key each have
 * to FAIL rather than quietly report success over an empty comparison.
 *
 * The drift case is the easy one and is covered too, in both directions, so the
 * check cannot be satisfied by only ever reading one of the two files.
 *
 * Each case is a real pair of files in a temp dir driven through `--root`,
 * because the thing under test is what happens when a file on disk is wrong.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CHECKER = path.join(__dirname, 'check-manifest-versions.js');

/** Builds a throwaway tree. `plugin`/`market` of null omit that file entirely. */
function sandbox(plugin, market) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-versions-'));
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  if (plugin !== null) {
    fs.writeFileSync(
      path.join(dir, '.claude-plugin/plugin.json'),
      typeof plugin === 'string' ? plugin : JSON.stringify(plugin, null, 2)
    );
  }
  if (market !== null) {
    fs.writeFileSync(
      path.join(dir, '.claude-plugin/marketplace.json'),
      typeof market === 'string' ? market : JSON.stringify(market, null, 2)
    );
  }
  return dir;
}

function run(dir, extra = []) {
  const r = spawnSync(process.execPath, [CHECKER, '--root', dir, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const pluginAt = (version) => ({ name: 'flowly', version });
const marketAt = (version, name = 'flowly') => ({ name: 'flowly-agent-skills', plugins: [{ name, version }] });

// --- the happy path, and the repository itself ------------------------------

test('passes when both manifests declare the same version', () => {
  const { code, out } = run(sandbox(pluginAt('0.1.0'), marketAt('0.1.0')));
  assert.equal(code, 0, out);
  assert.match(out, /both manifests declare 0\.1\.0/);
});

test('passes on the repository as it is checked in', () => {
  const { code, out } = run(ROOT);
  assert.equal(code, 0, out);
});

// --- drift, in both directions ----------------------------------------------

test('fails when the marketplace advertises a different version', () => {
  const { code, out } = run(sandbox(pluginAt('0.1.0'), marketAt('0.6.7')));
  assert.equal(code, 1, out);
  assert.match(out, /disagree/);
  assert.match(out, /0\.6\.7/);
});

test('fails when the plugin manifest is the one that drifted', () => {
  const { code, out } = run(sandbox(pluginAt('9.9.9'), marketAt('0.1.0')));
  assert.equal(code, 1, out);
  assert.match(out, /disagree/);
});

// --- every way of finding nothing to compare --------------------------------
// Each of these is a way the replaced checker would have reported success.

test('fails when the plugin manifest is missing entirely', () => {
  const { code, out } = run(sandbox(null, marketAt('0.1.0')));
  assert.equal(code, 1, out);
  assert.match(out, /plugin\.json is missing/);
});

test('fails when the marketplace manifest is missing entirely', () => {
  const { code, out } = run(sandbox(pluginAt('0.1.0'), null));
  assert.equal(code, 1, out);
  assert.match(out, /marketplace\.json is missing/);
});

test('fails when the marketplace has no plugins array', () => {
  const { code, out } = run(sandbox(pluginAt('0.1.0'), { name: 'flowly-agent-skills' }));
  assert.equal(code, 1, out);
  assert.match(out, /no `plugins` array/);
});

test('fails when the marketplace lists no plugins at all', () => {
  const { code, out } = run(sandbox(pluginAt('0.1.0'), { name: 'x', plugins: [] }));
  assert.equal(code, 1, out);
  assert.match(out, /lists no plugins/);
});

test('fails when no marketplace entry matches the plugin name', () => {
  const { code, out } = run(sandbox(pluginAt('0.1.0'), marketAt('0.1.0', 'something-else')));
  assert.equal(code, 1, out);
  assert.match(out, /no entry named "flowly"/);
  // The message has to name what it did find, or the fix is a guessing game.
  assert.match(out, /something-else/);
});

test('fails when the plugin manifest declares no version', () => {
  const { code, out } = run(sandbox({ name: 'flowly' }, marketAt('0.1.0')));
  assert.equal(code, 1, out);
  assert.match(out, /declares no `version`/);
});

test('fails when the marketplace entry declares no version', () => {
  const { code, out } = run(sandbox(pluginAt('0.1.0'), { name: 'x', plugins: [{ name: 'flowly' }] }));
  assert.equal(code, 1, out);
  assert.match(out, /declares no `version`/);
});

test('fails when the plugin manifest has no name to match on', () => {
  const { code, out } = run(sandbox({ version: '0.1.0' }, marketAt('0.1.0')));
  assert.equal(code, 1, out);
  assert.match(out, /no `name`/);
});

// --- the version has to look like a version ---------------------------------

test('fails on a version that is not major.minor.patch', () => {
  const { code, out } = run(sandbox(pluginAt('0.1'), marketAt('0.1')));
  assert.equal(code, 1, out);
  assert.match(out, /not major\.minor\.patch/);
});

test('fails on a non-numeric version even when both agree', () => {
  const { code, out } = run(sandbox(pluginAt('latest'), marketAt('latest')));
  assert.equal(code, 1, out);
  assert.match(out, /not major\.minor\.patch/);
});

test('accepts a prerelease tail', () => {
  const { code, out } = run(sandbox(pluginAt('0.2.0-rc.1'), marketAt('0.2.0-rc.1')));
  assert.equal(code, 0, out);
});

test('fails on malformed JSON rather than throwing', () => {
  const { code, out } = run(sandbox('{ not json', marketAt('0.1.0')));
  assert.equal(code, 1, out);
  assert.match(out, /not valid JSON/);
  assert.doesNotMatch(out, /failed unexpectedly/);
});

// --- the release-job mode, which is the only independent source --------------

test('--tag passes when the ref matches the manifests', () => {
  const { code, out } = run(sandbox(pluginAt('0.1.0'), marketAt('0.1.0')), ['--tag', 'v0.1.0']);
  assert.equal(code, 0, out);
  assert.match(out, /matches the manifests/);
});

test('--tag accepts a ref without the leading v', () => {
  const { code } = run(sandbox(pluginAt('0.1.0'), marketAt('0.1.0')), ['--tag', '0.1.0']);
  assert.equal(code, 0);
});

test('--tag fails when a release would publish a ref the manifests do not claim', () => {
  const { code, out } = run(sandbox(pluginAt('0.1.0'), marketAt('0.1.0')), ['--tag', 'v0.2.0']);
  assert.equal(code, 1, out);
  assert.match(out, /does not match/);
});

// --- the default mode must not silently behave like --tag --------------------

test('the default run says how to get the independent check', () => {
  const { out } = run(sandbox(pluginAt('0.1.0'), marketAt('0.1.0')));
  assert.match(out, /--tag/);
  assert.match(out, /Two agreeing sources are one source/);
});
