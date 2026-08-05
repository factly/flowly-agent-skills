#!/usr/bin/env node
/**
 * Tests for check-tool-drift.js.
 *
 * Two of these carry the Verify clause of the task that authored the check, and
 * they are the reason the test seams (`--tools`, `--root`, `--snapshot`) exist:
 *
 *   - "a rename must turn it red" — no tool can be renamed in a real instance,
 *     so the rename is simulated by driving the check against a doctored copy
 *     of the real list with one name changed. See `renames a tool …`.
 *   - "a corpus naming no tools must FAIL" — see `fails on a corpus that names
 *     no tools`, and the positive control immediately after it, which proves
 *     the sandbox can reach the passing state too. Without that control the
 *     failing assertion could be passing for the wrong reason.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  extractToolNames,
  isToolShaped,
  scanCorpus,
  toolNamesFrom,
  NON_TOOL_IDENTIFIERS,
  STALE_AFTER_DAYS,
} = require('./check-tool-drift');

const REPO_ROOT = path.resolve(__dirname, '..');
const CHECK     = path.join(__dirname, 'check-tool-drift.js');
const SNAPSHOT  = path.join(__dirname, 'tool-snapshot.json');

// The corpus is expected to name most of Flowly's tools. This floor is what
// turns a silently narrowing extractor into a red run: a regex that stops
// matching one form would drop recall without failing any other assertion here,
// because every other check is satisfied by whatever it does still find.
// Measured at 37 of 46 when this was written.
const MIN_TOOL_NAMES_IN_CORPUS = 30;

function run(args = []) {
  return spawnSync(process.execPath, [CHECK, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
}

function snapshotTools() {
  return JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')).tools;
}

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flowly-tool-drift-test-'));
}

/** A corpus root with one skill whose body is `text`. */
function corpusWith(text) {
  const root = sandbox();
  const dir = path.join(root, 'skills', 'sample-skill');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: sample-skill\ndescription: A sample.\n---\n\n# sample-skill\n\n${text}\n`,
  );
  return root;
}

/** A tool list file with `mutate` applied to the real snapshot's names. */
function toolListFile(mutate) {
  const file = path.join(sandbox(), 'tools.json');
  fs.writeFileSync(file, JSON.stringify({ tools: mutate(snapshotTools()) }, null, 2));
  return file;
}

/** A snapshot file dated `daysAgo`, otherwise identical to the real one. */
function snapshotFile(daysAgo, tools = snapshotTools()) {
  const file = path.join(sandbox(), 'snapshot.json');
  const at = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
  fs.writeFileSync(file, JSON.stringify({ captured_at: at, tools }, null, 2));
  return file;
}

// ─── Extraction ──────────────────────────────────────────────────────────────

test('extracts a tool named as a whole code span', () => {
  assert.deepEqual([...extractToolNames('Call `create_issue` to open one.')], ['create_issue']);
});

test('extracts the call but not its arguments', () => {
  // The corpus writes tools this way in tables, and `mark_all` is an argument
  // that begins with the `mark_` verb — so the call/argument distinction is
  // load-bearing rather than decorative.
  const found = extractToolNames('| `mark_notification_read(notification_id, mark_all)` | clears one |');

  assert.deepEqual([...found], ['mark_notification_read']);
});

test('extracts a tool quoted inside a fenced JSON example', () => {
  const text = '```json\n{ "name": "put_planning_doc", "arguments": {} }\n```';

  assert.deepEqual([...extractToolNames(text)], ['put_planning_doc']);
});

test('only code spans count, and the same name in a span does count', () => {
  // A negative assertion on its own can pass for any reason at all, including
  // the extractor being broken. The positive control is the same identifier in
  // the form that IS meant to match, so this pair fails if either half moves.
  assert.deepEqual([...extractToolNames('Prose that mentions create_issue plainly.')], []);
  assert.deepEqual([...extractToolNames('Prose that mentions `create_issue` plainly.')], ['create_issue']);
});

test('a dotted member access is not a Flowly tool call', () => {
  // `client.create_issue` is somebody's SDK in an illustrative snippet, not a
  // name Flowly serves. Measured: the shipped corpus contains no dotted form of
  // any Flowly tool, so nothing real is lost by excluding them.
  assert.deepEqual([...extractToolNames('`client.create_issue(…)`')], []);
  assert.deepEqual([...extractToolNames('`create_issue(…)`')], ['create_issue']);
});

test('a tool-shaped name that is not a tool is extracted, not skipped', () => {
  // `create_issue_v2` is a whole name in its own right and it is tool-shaped,
  // so it is extracted and check 2 then reports it as unresolvable. That is the
  // guard working: shape decides what gets watched, and the tool list decides
  // what passes. Skipping it here because it is "obviously" not real is exactly
  // how a renamed tool would be skipped too.
  assert.deepEqual([...extractToolNames('`create_issue_v2`')], ['create_issue_v2']);
});

test('the allowlisted identifiers are tool-shaped but never extracted', () => {
  // Both halves matter: if they stopped being tool-shaped the exemption would
  // be dead weight, and if they were extracted the check would go red on prose.
  for (const identifier of NON_TOOL_IDENTIFIERS.keys()) {
    assert.equal(isToolShaped(identifier), true, `${identifier} should be tool-shaped`);
    assert.deepEqual([...extractToolNames(`\`${identifier}\``)], [], `${identifier} should be exempt`);
  }
});

test('the shipped corpus names most of Flowly\'s tools', () => {
  const { names, files } = scanCorpus(REPO_ROOT);
  const live = new Set(snapshotTools());

  assert.ok(files.length > 0, 'no corpus files were scanned');
  assert.ok(
    names.size >= MIN_TOOL_NAMES_IN_CORPUS,
    `extracted ${names.size} tool names, expected at least ${MIN_TOOL_NAMES_IN_CORPUS}`,
  );
  for (const name of names.keys()) {
    assert.ok(live.has(name), `${name} was extracted but is not a real tool`);
  }
});

// ─── Tool-list parsing ───────────────────────────────────────────────────────

test('accepts the three shapes a tool list arrives in', () => {
  const expected = ['whoami'];

  assert.deepEqual(toolNamesFrom(['whoami'], 'x'), expected);
  assert.deepEqual(toolNamesFrom({ tools: [{ name: 'whoami' }] }, 'x'), expected);
  assert.deepEqual(toolNamesFrom({ result: { tools: [{ name: 'whoami' }] } }, 'x'), expected);
});

test('rejects a tool list entry with no name', () => {
  assert.throws(() => toolNamesFrom({ tools: [{ title: 'whoami' }] }, 'x'), /no usable `name`/);
});

// ─── The Verify clause ───────────────────────────────────────────────────────

test('renames a tool in the list and the check goes red naming it', () => {
  const doctored = toolListFile(tools => tools.map(n => (n === 'advance_loop_run' ? 'advance_run' : n)));

  const result = run(['--tools', doctored]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /`advance_loop_run` is not in the tool list/);
  assert.match(result.stdout, /closest live name is `advance_run`/);
  // The files that have to be edited are named, not left to a grep.
  assert.match(result.stdout, /skills\/flowly-verify\/SKILL\.md/);
  assert.match(result.stdout, /1 error\(s\), 0 warning\(s\) — FAILED/);
});

test('the same list unrenamed passes — the rename is what turned it red', () => {
  const untouched = toolListFile(tools => tools);

  const result = run(['--tools', untouched]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /0 error\(s\), 0 warning\(s\) — PASSED/);
});

test('fails on a corpus that names no tools', () => {
  const root = corpusWith('It discusses `project_id` and `review_state` and calls nothing.');

  const result = run(['--root', root]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /not one Flowly tool name found/);
  assert.match(result.stdout, /0 tool name\(s\) in the corpus/);
});

test('fails on an empty corpus root', () => {
  const result = run(['--root', sandbox()]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /no files scanned/);
});

test('the same sandbox passes once one tool is named — the absence is reachable', () => {
  // The positive control for the two tests above. Without it, "an empty corpus
  // fails" could be true because the sandbox can never pass at all, which would
  // make the vacuity guard untested and the assertion above meaningless.
  const root = corpusWith('It discusses `project_id` and then calls `whoami`.');

  const result = run(['--root', root]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /1 distinct tool name\(s\)/);
});

// ─── The extractor's blind spots are themselves checked ──────────────────────

test('fails when the tool list holds a name the extractor cannot recognise', () => {
  // A tool whose verb is in no prefix the extractor knows. This is what an
  // upstream addition looks like before anyone widens the vocabulary, and the
  // check has to ask rather than quietly stop watching it.
  const doctored = toolListFile(tools => [...tools, 'archive_issue']);

  const result = run(['--tools', doctored]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /matches no known tool-name shape/);
  assert.match(result.stdout, /TOOL_NAME_PREFIXES/);
});

test('fails when an allowlisted identifier turns out to be a real tool', () => {
  const [exempt] = [...NON_TOOL_IDENTIFIERS.keys()];
  const doctored = toolListFile(tools => [...tools, exempt]);

  const result = run(['--tools', doctored]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`\`${exempt}\` is exempted as a non-tool but IS a tool`));
});

// ─── Snapshot handling ───────────────────────────────────────────────────────

test('a stale snapshot warns but does not fail', () => {
  const stale = snapshotFile(STALE_AFTER_DAYS + 5);

  const result = run(['--snapshot', stale]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /⚠ {2}the snapshot is fresh/);
  assert.match(result.stdout, new RegExp(`older than ${STALE_AFTER_DAYS}`));
  assert.match(result.stdout, /0 error\(s\), 1 warning\(s\) — PASSED/);
});

test('a snapshot inside the window neither warns nor fails', () => {
  const fresh = snapshotFile(1);

  const result = run(['--snapshot', fresh]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /✓ {2}the snapshot is fresh/);
  assert.match(result.stdout, /0 error\(s\), 0 warning\(s\) — PASSED/);
});

test('an undated snapshot is an error, not a warning', () => {
  // Staleness is forgiving because a clock is not a fact. A missing date is a
  // fact — it makes staleness unmeasurable — so it is on the other side.
  const file = path.join(sandbox(), 'undated.json');
  fs.writeFileSync(file, JSON.stringify({ tools: snapshotTools() }, null, 2));

  const result = run(['--snapshot', file]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /no usable `captured_at` date/);
});

test('a missing snapshot says how to take one', () => {
  const result = run(['--snapshot', path.join(sandbox(), 'absent.json')]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /not found/);
  assert.match(result.stderr, /--refresh/);
});

// ─── The committed snapshot and the default invocation ───────────────────────

test('the committed snapshot carries no endpoint, instance name or credential', () => {
  const raw = fs.readFileSync(SNAPSHOT, 'utf8');
  const parsed = JSON.parse(raw);

  assert.equal(Array.isArray(parsed.tools), true);
  assert.doesNotMatch(raw, /:\/\//, 'the snapshot must not contain a URL');
  for (const name of parsed.tools) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, `${name} is not a bare tool name`);
  }
});

test('the default invocation passes against the shipped corpus', () => {
  const result = run();

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /0 error\(s\)/);
  assert.match(result.stdout, /PASSED/);
});

test('rejects an unknown argument rather than ignoring it', () => {
  const result = run(['--no-such-flag']);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /unknown argument/);
});

test('refuses --tools together with --live', () => {
  const result = run(['--tools', 'x.json', '--live']);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /cannot be combined/);
});

test('--live without an endpoint says which variable is missing', () => {
  const result = spawnSync(process.execPath, [CHECK, '--live'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, FLOWLY_MCP_URL: '', FLOWLY_MCP_TOKEN: '' },
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /FLOWLY_MCP_URL is not set/);
});
