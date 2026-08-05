#!/usr/bin/env node
/**
 * check-round-trip-case.js — hold `evals/flowly-round-trip/case.yaml` to the
 * schema and to the corpus it quotes.
 *
 * WHY THIS EXISTS
 * ---------------
 * The round-trip case is read by `claude plugin eval`, which is in early access
 * and runs neither here nor in CI. So the one artifact in this repository that
 * measures the product claim is also the one artifact nothing exercises. A case
 * file nothing validates is a file that rots: a renamed Flowly tool, a reworded
 * sentence in the command it quotes, or a stray key the CLI's strict schema
 * rejects would all sit there looking correct until the day someone finally
 * runs it and cannot tell a real failure from a stale file.
 *
 * This does not run the case. It checks the things that go wrong while nobody
 * is looking.
 *
 * WHAT IT PROVES AND DOES NOT PROVE
 * ---------------------------------
 * It proves the file parses, conforms to the recovered schema, names only tools
 * the instance actually has, quotes only sentences the command actually
 * contains, and still grants the file-writing tools that make its central
 * assertion falsifiable.
 *
 * It proves nothing about whether a model passes the case. That needs the
 * runner, a live instance and tokens.
 *
 * THE YAML PARSE
 * --------------
 * This repository is plain Node with no dependencies and no build step, and
 * Node ships no YAML parser. Hand-rolling one to validate a file whose real
 * parser is the CLI's would be a liability with no reader, so the structural
 * pass shells out to `ruby -ryaml` — present on macOS and on the standard CI
 * images — and reports plainly when it is unavailable rather than pretending it
 * ran. The text checks below need no parser and always run.
 *
 * Usage:  node scripts/check-round-trip-case.js [--root <dir>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CASE_REL = 'evals/flowly-round-trip/case.yaml';
const SNAPSHOT_REL = 'scripts/tool-snapshot.json';
const COMMANDS_REL = 'commands';

// The MCP server the case's own .mcp.json declares. Every Flowly tool a grader
// names carries this prefix, and renaming the server there renames them all.
const TOOL_PREFIX = 'mcp__flowly__';

// The `plugin eval` case schema, as recovered from the shipped CLI's zod
// definitions (claude 2.1.220). Every grader object is `.strict()` there, so an
// unknown key is a hard load failure rather than something ignored — which is
// exactly the kind of mistake that is invisible until the day you run it.
const SCHEMA_MAJOR_MAX = 1;

const TOP_LEVEL_KEYS = new Set([
  'schema_version', 'name', 'description', 'tags', 'plugins',
  'context', 'execution', 'runs', 'graders', 'expected_outcome',
]);
const CONTEXT_KEYS = new Set(['scaffold_script', 'history_file', 'add_dirs']);
const EXECUTION_KEYS = new Set([
  'prompt', 'max_turns', 'timeout_seconds', 'model',
  'allowed_tools', 'append_system_prompt', 'env',
]);
const GRADER_COMMON = ['name', 'type', 'weight', 'arm'];
const GRADER_KEYS = new Map([
  ['regex', new Set([...GRADER_COMMON, 'target', 'pattern', 'flags', 'match'])],
  ['tool_order', new Set([...GRADER_COMMON, 'before', 'after'])],
  ['tool_used', new Set([...GRADER_COMMON, 'tool', 'input_match', 'min', 'max'])],
  ['file_exists', new Set([...GRADER_COMMON, 'path', 'exists'])],
  ['llm', new Set([...GRADER_COMMON, 'criteria', 'focus'])],
  ['baseline', new Set([...GRADER_COMMON, 'baseline_file', 'criteria'])],
]);
const ARMS = new Set(['with-only', 'both']);
const FOCI = new Set(['trace', 'last_message', 'files']);
const MATCH_MODES = /^(contains|not_contains|count:\d+)$/;
const REGEXP_FLAGS = /^[dgimsuvy]*$/;

// The tools that make the case's central assertion falsifiable. An agent that
// cannot write a file cannot write a local plan, so every `exists: false`
// grader would pass regardless of what the corpus said. Tightening this list is
// the single most plausible way to void the case while leaving it green.
const REACHABILITY_TOOLS = ['Write', 'Edit', 'Bash'];

// A `pattern:` made only of these characters is prose, not a regular
// expression, and prose in a grader is a quotation from the corpus. Deliberately
// narrow: anything with a metacharacter is left alone, because a real pattern
// has no source file to be checked against.
const PROSE_PATTERN = /^[A-Za-z0-9 ,.'’—–-]+$/;

// ---------------------------------------------------------------------------

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

/** Strip one layer of YAML scalar quoting, if present. */
function unquote(value) {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

// ── text checks — no parser needed, always run ─────────────────────────────

/**
 * Every Flowly tool a grader names must exist on the instance.
 *
 * Checked against the same snapshot `check-tool-drift.js` holds the prose to.
 * That script scans `skills/`, `references/`, `agents/` and `commands/` for
 * `.md`; it does not read `evals/` and it does not read `.yaml`, so without
 * this the case is the one place a renamed tool could hide.
 */
function checkToolNames(text, snapshot, report) {
  const named = [...new Set([...text.matchAll(/mcp__flowly__([a-z0-9_]+)/g)].map((m) => m[1]))].sort();
  if (named.length === 0) {
    report.error(`${CASE_REL} names no ${TOOL_PREFIX}* tool — the case cannot be reaching Flowly`);
    return 1;
  }
  const unknown = named.filter((t) => !snapshot.includes(t));
  for (const t of unknown) {
    report.error(`${CASE_REL} names ${TOOL_PREFIX}${t}, which is not in ${SNAPSHOT_REL}`);
  }
  if (unknown.length === 0) report.pass(`${named.length} Flowly tool(s) named, all present in ${SNAPSHOT_REL}`);
  return unknown.length;
}

/**
 * A grader that quotes the corpus must quote something that is still there.
 *
 * The command under test is read out of the case rather than hardcoded: the
 * prompt invokes `/flowly:<name>`, so that is the file a prose pattern has to
 * be found in. Hardcoding it here would put a third copy of the sentence in the
 * tree, and scanning all six commands would be worse than useless — the
 * resolution block is byte-identical in every one of them, so deleting the
 * refusal from the command actually under test would still find it in the other
 * five and report success.
 */
function checkQuotedPatterns(text, root, report) {
  const commands = [...new Set([...text.matchAll(/\/flowly:([a-z][a-z0-9-]*)/g)].map((m) => m[1]))];
  if (commands.length === 0) {
    report.error(`${CASE_REL} invokes no /flowly:<command>, so a quoted pattern has no source to be checked against`);
    return 1;
  }

  const bodies = new Map();
  let errors = 0;
  for (const name of commands) {
    const file = path.join(root, COMMANDS_REL, `${name}.md`);
    if (!fs.existsSync(file)) {
      report.error(`${CASE_REL} invokes /flowly:${name} but ${COMMANDS_REL}/${name}.md does not exist`);
      errors += 1;
      continue;
    }
    bodies.set(name, readText(file));
  }

  const quoted = [];
  for (const m of text.matchAll(/^[ \t-]*pattern:[ \t]*(.+)$/gm)) {
    const value = unquote(m[1]);
    if (PROSE_PATTERN.test(value)) quoted.push(value);
  }
  if (quoted.length === 0) {
    report.error(`${CASE_REL} quotes no sentence from ${[...bodies.keys()].map((n) => `/flowly:${n}`).join(', ')} — nothing holds the case to the command it drives`);
    return errors + 1;
  }
  for (const value of quoted) {
    const found = [...bodies.entries()].filter(([, body]) => body.includes(value)).map(([n]) => n);
    if (found.length === 0) {
      report.error(`${CASE_REL} quotes a sentence no invoked command contains:`);
      report.detail(`"${value}"`);
      report.detail(`searched ${[...bodies.keys()].map((n) => `${COMMANDS_REL}/${n}.md`).join(', ')}`);
      // Compared literally, and deliberately so: the grader matches the trace
      // the same way, and the trace carries the command body with its hard
      // wraps intact. A quotation that reads correctly but spans two source
      // lines can never match at run time, so it must not pass here either.
      report.detail('the match is literal — check the quotation does not span a line wrap in the command');
      errors += 1;
    }
  }
  if (errors === 0) {
    report.pass(`${quoted.length} quoted sentence(s) still present in ${[...bodies.keys()].map((n) => `${COMMANDS_REL}/${n}.md`).join(', ')}`);
  }
  return errors;
}

// ── structural check — needs a YAML parser ─────────────────────────────────

function parseYaml(file) {
  const probe = spawnSync('ruby', ['-e', 'require "yaml"; require "json"; print JSON.generate(YAML.safe_load(STDIN.read))'], {
    input: readText(file),
    encoding: 'utf8',
  });
  if (probe.error || probe.status !== 0) {
    return { available: probe.error === undefined, error: (probe.stderr || String(probe.error)).trim() };
  }
  return { available: true, data: JSON.parse(probe.stdout) };
}

function checkKeys(obj, allowed, where, report) {
  const unknown = Object.keys(obj).filter((k) => !allowed.has(k));
  for (const k of unknown) report.error(`${where}: unknown key "${k}" — the CLI's schema is strict and rejects the file`);
  return unknown.length;
}

function checkStructure(c, report) {
  let errors = 0;

  if (typeof c.schema_version !== 'string') {
    report.error('schema_version is missing — the CLI refuses the file without it');
    errors += 1;
  } else if (Number(c.schema_version.split('.')[0]) > SCHEMA_MAJOR_MAX) {
    report.error(`schema_version "${c.schema_version}" is beyond the ${SCHEMA_MAJOR_MAX}.x this schema was recovered from`);
    errors += 1;
  }
  if (typeof c.name !== 'string' || c.name.length === 0) {
    report.error('name is missing or empty');
    errors += 1;
  }
  errors += checkKeys(c, TOP_LEVEL_KEYS, 'case', report);
  if (c.context) errors += checkKeys(c.context, CONTEXT_KEYS, 'context', report);
  if (c.execution) errors += checkKeys(c.execution, EXECUTION_KEYS, 'execution', report);

  const prompt = c.execution && c.execution.prompt;
  if (!prompt && !(c.context && c.context.history_file)) {
    report.error('either execution.prompt or context.history_file is required');
    errors += 1;
  }
  const bounded = [
    ['execution.max_turns', c.execution && c.execution.max_turns, 1, 200],
    ['execution.timeout_seconds', c.execution && c.execution.timeout_seconds, 1, 3600],
    ['runs', c.runs, 1, 50],
  ];
  for (const [where, value, lo, hi] of bounded) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < lo || value > hi) {
      report.error(`${where} must be an integer in ${lo}..${hi} (got ${JSON.stringify(value)})`);
      errors += 1;
    }
  }

  // The absence has to stay reachable — see REACHABILITY_TOOLS.
  const allowedTools = (c.execution && c.execution.allowed_tools) || [];
  const ungranted = REACHABILITY_TOOLS.filter((t) => !allowedTools.includes(t));
  if (ungranted.length) {
    report.error(
      `execution.allowed_tools no longer grants ${ungranted.join(', ')} — ` +
        'an agent that cannot write a file passes every "exists: false" grader for free',
    );
    errors += 1;
  }

  const graders = Array.isArray(c.graders) ? c.graders : [];
  if (graders.length === 0) {
    report.error('graders must be a non-empty array');
    return errors + 1;
  }
  const seen = new Set();
  let negatives = 0;
  for (const g of graders) {
    const where = `grader "${g.name}"`;
    if (typeof g.name !== 'string' || g.name.length === 0) {
      report.error('a grader has no name');
      errors += 1;
      continue;
    }
    if (seen.has(g.name)) {
      report.error(`${where}: duplicate grader name`);
      errors += 1;
    }
    seen.add(g.name);
    const keys = GRADER_KEYS.get(g.type);
    if (!keys) {
      report.error(`${where}: unknown type "${g.type}" (regex | tool_order | tool_used | file_exists | llm | baseline)`);
      errors += 1;
      continue;
    }
    errors += checkKeys(g, keys, where, report);
    if (g.arm !== undefined && !ARMS.has(g.arm)) {
      report.error(`${where}: arm must be with-only or both (got ${JSON.stringify(g.arm)})`);
      errors += 1;
    }
    if (g.type === 'regex') {
      if (g.flags !== undefined && !REGEXP_FLAGS.test(g.flags)) {
        report.error(`${where}: flags must be JS RegExp flags (got ${JSON.stringify(g.flags)})`);
        errors += 1;
      }
      if (g.match !== undefined && !MATCH_MODES.test(g.match)) {
        report.error(`${where}: match must be contains | not_contains | count:N (got ${JSON.stringify(g.match)})`);
        errors += 1;
      }
      if (typeof g.target === 'string' && !FOCI.has(g.target)) {
        report.error(`${where}: target must be trace | last_message | files, or {source: file, path}`);
        errors += 1;
      }
    }
    if (g.type === 'llm' && typeof g.focus === 'string' && !FOCI.has(g.focus)) {
      report.error(`${where}: focus must be trace | last_message | files, or {source: file, path}`);
      errors += 1;
    }
    if (g.type === 'file_exists') {
      // This case only ever asserts absence. A grader flipped to `exists: true`
      // — or one that simply forgot the key, which defaults to true — would
      // assert the opposite of the product claim while still looking like a
      // guard against local files.
      if (g.exists !== false) {
        report.error(`${where}: file_exists must carry "exists: false"; this case asserts absence, and the key defaults to true`);
        errors += 1;
      } else {
        negatives += 1;
      }
    }
    if (g.type === 'regex' && g.match === 'not_contains') negatives += 1;
  }
  if (negatives === 0) {
    report.error('no grader asserts that a planning artifact was NOT created — half the claim is unmeasured');
    errors += 1;
  }

  if (errors === 0) {
    report.pass(`${graders.length} grader(s) conform to the plugin-eval schema; ${negatives} assert absence`);
  }
  return errors;
}

// ---------------------------------------------------------------------------

function main(argv = process.argv.slice(2)) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx === -1 ? path.resolve(__dirname, '..') : path.resolve(argv[rootIdx + 1]);
  const caseFile = path.join(root, CASE_REL);

  const report = {
    pass: (m) => console.log(`  ✓ ${m}`),
    error: (m) => console.log(`  ✗ ${m}`),
    detail: (m) => console.log(`      ${m}`),
    note: (m) => console.log(`  ℹ ${m}`),
  };

  console.log('\nRound-trip case check — the one file that measures the claim, and nothing runs it\n');

  if (!fs.existsSync(caseFile)) {
    console.log(`  ✗ ${CASE_REL} does not exist`);
    console.log('\n1 error(s) — FAILED');
    return 1;
  }
  const text = readText(caseFile);
  const snapshot = JSON.parse(readText(path.join(root, SNAPSHOT_REL))).tools;

  let errors = 0;
  errors += checkToolNames(text, snapshot, report);
  errors += checkQuotedPatterns(text, root, report);

  const parsed = parseYaml(caseFile);
  if (!parsed.available) {
    report.note('no ruby on PATH — the YAML parse and schema conformance were SKIPPED, not passed');
  } else if (parsed.error) {
    report.error(`${CASE_REL} is not valid YAML — ${parsed.error.split('\n')[0]}`);
    errors += 1;
  } else {
    report.pass(`${CASE_REL} parses as YAML`);
    errors += checkStructure(parsed.data, report);
  }

  console.log(`\n${errors} error(s) — ${errors ? 'FAILED' : 'PASSED'}`);
  return errors ? 1 : 0;
}

module.exports = { main };

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`\nERROR: check-round-trip-case failed unexpectedly: ${err.message}`);
    process.exit(1);
  }
}
