#!/usr/bin/env node
/**
 * check-tool-drift.js
 *
 * CLI that holds the Flowly tool names this corpus tells agents to call to the
 * tool names a Flowly instance actually serves.
 *
 * THE REGRESSION THIS CATCHES, AND WHY NO OTHER CHECK CAN
 * -------------------------------------------------------
 * Every other check under `scripts/` reads this tree and only this tree, so
 * every regression they can see is one a commit here caused. This one is
 * different: nothing in this repository has to change for it to break. Flowly
 * renames `advance_loop_run`, or drops `attach_evidence`, or splits
 * `put_todo_tasks` in two — and the skills go on instructing agents to call a
 * name that no longer resolves. The corpus is still internally consistent, the
 * register still balances, every eval still passes, and the distribution is
 * broken for every user at once.
 *
 * The failure is also quiet at the point of use. An agent that calls a
 * nonexistent tool does not get a clean stop; it gets a refusal it was never
 * told to expect, and the documented behaviour of these skills is to keep going
 * with what they can reach. A rename therefore turns a skill into confidently
 * wrong instructions rather than into an error message.
 *
 * That is why this check exists at all, and why it is the only detection for a
 * risk that comes from outside the repository.
 *
 * LIVE VERSUS SNAPSHOT — BOTH, BECAUSE NEITHER ALONE IS HONEST
 * ------------------------------------------------------------
 * The acceptance asks for the corpus to be asserted against "a live tools
 * list". CI has no Flowly instance and cannot be given one: the instance is
 * private and its token cannot be committed to a public repository. Two
 * one-sided readings of that are both wrong.
 *
 *   - Live only. The check cannot run in CI, so it runs when somebody
 *     remembers, which is never. A guard nobody runs guards nothing.
 *   - Snapshot only. The check compares the corpus against a file in the same
 *     commit as the corpus. It can catch a typo, and it can never catch the
 *     upstream rename it was written for, because the snapshot moves only when
 *     a human moves it.
 *
 * So this ships both, and says plainly which one answers which question:
 *
 *   default   Compare the corpus against `scripts/tool-snapshot.json`. This is
 *             the CI mode. It answers "does every tool name in the corpus name
 *             something that existed the last time anyone looked?" — which
 *             catches typos, catches a name invented in prose, and catches a
 *             corpus that never caught up with a refresh.
 *   --live    Fetch `tools/list` from a real instance and compare the corpus
 *             AND the snapshot against it. This is the mode that detects an
 *             upstream rename. A human or a scheduled job runs it.
 *   --refresh Fetch, rewrite the snapshot, then run the full check against the
 *             new list — so a refresh that invalidates the corpus says so in
 *             the same breath rather than landing a green-looking snapshot.
 *
 * The endpoint and the token come from the environment (FLOWLY_MCP_URL,
 * FLOWLY_MCP_TOKEN) and are never read from, or written to, a file in this
 * repository. The snapshot deliberately records the tool names and nothing
 * else: no endpoint, no instance name, no token. See `check-no-hosts.js` for
 * why that is a one-way door.
 *
 * STALENESS IS A WARNING, NOT AN ERROR — AND HERE IS THE ARGUMENT
 * ---------------------------------------------------------------
 * The snapshot carries the date it was taken and this check prints its age on
 * every run, so staleness is never invisible. Past STALE_AFTER_DAYS it becomes
 * a `⚠` line and is counted in the summary. It does not fail the build, and
 * that is a deliberate choice rather than a softening.
 *
 * An error would fail on a clock rather than on a fact. The only action that
 * clears it is `--refresh` against a live instance, which CI cannot reach and
 * most contributors cannot reach either. A red that its audience has no way to
 * turn green is a red that gets the check deleted from CI, or the threshold
 * bumped forever — and then the guard against the irreversible thing is gone
 * to buy a reminder. The same reasoning is written out at length in
 * `check-no-hosts.js`'s escape-hatch header.
 *
 * The thing staleness endangers is not left uncovered by that choice: an
 * upstream rename is detected by `--live`, which sees reality directly and does
 * not care how old the snapshot is. Staleness is loud here; detection lives
 * where it can actually happen.
 *
 * WHY AN EMPTY EXTRACTION IS AN ERROR
 * -----------------------------------
 * If the extractor finds no Flowly tool names, this check exits non-zero.
 *
 * That is not defensive coding, it is the whole reason this check waited for
 * the skills to be written. Run against a corpus that names no tools, the
 * assertion "every extracted name is live" is true of the empty set: it prints
 * a ✓, it exits 0, and it carries exactly no information while reading as
 * coverage. A guard that cannot distinguish "nothing is wrong" from "there is
 * nothing here" is worse than no guard, because it is believed.
 *
 * THE EXTRACTOR, AND ITS TWO FAILURE DIRECTIONS
 * ---------------------------------------------
 * The corpus is prose. Tool names appear as snake_case identifiers in code
 * spans — `create_issue`, `put_planning_doc` — and so do plenty of things that
 * are not tools: argument names, column names, enum values, JSON keys.
 *
 * A tool name is recognised by SHAPE, from a vocabulary held in this file
 * (TOOL_NAME_PREFIXES and ATOMIC_TOOL_NAMES) — never by membership of the tool
 * list. Recognising them by membership would be circular in exactly the way
 * that matters: when Flowly renames `create_issue`, the corpus's now-dead
 * `create_issue` would stop being recognised as a tool, drop out of the
 * extraction set, and the check would go green on the one event it exists to
 * catch.
 *
 * The two directions the extractor can be wrong are not symmetrical:
 *
 *   - A false positive (a field name mistaken for a tool) makes this check go
 *     red on something harmless. It is loud, and it is fixed by adding one
 *     documented line to NON_TOOL_IDENTIFIERS.
 *   - A false negative (a tool mention the extractor does not see) is silent,
 *     and it means the guard has quietly stopped watching a tool. That is the
 *     expensive direction, so `checkVocabularyCovers` asserts the vocabulary
 *     can recognise EVERY name in the tool list. A tool whose shape is
 *     unknown — a new verb, a new single-word name — fails the check asking
 *     for the vocabulary to be widened, instead of being skipped in silence.
 *
 * Measured against this corpus at authoring time: 37 of Flowly's 46 tools are
 * named by it, and the two false positives below are the entire cost. The
 * looser rule (any occurrence anywhere in the text, not just inside a code
 * span) finds the same 37 and adds a third false positive — so the code-span
 * gate costs nothing in recall and is kept.
 *
 * WHAT IT ASSERTS, EACH REPORTED SEPARATELY
 * -----------------------------------------
 *   1. The corpus names at least one Flowly tool. See above.
 *   2. Every tool name the corpus uses is in the tool list. This is the
 *      acceptance, and it is the clause a rename breaks.
 *   3. The extractor's vocabulary can recognise every name in the tool list.
 *   4. NON_TOOL_IDENTIFIERS is honest in both directions: no entry names a real
 *      tool, and no entry has outlived the corpus text that justified it.
 *   5. The snapshot is present, well-formed, and its age is reported.
 *   6. Under --live only: the snapshot still matches the live list.
 *
 * Usage:
 *   node scripts/check-tool-drift.js
 *   node scripts/check-tool-drift.js --live
 *   node scripts/check-tool-drift.js --refresh
 *   node scripts/check-tool-drift.js --tools <file>    # drive from a JSON list
 *   node scripts/check-tool-drift.js --root <dir>      # scan another corpus
 *   node scripts/check-tool-drift.js --snapshot <file> # read another snapshot
 *
 *   FLOWLY_MCP_URL=https://flowly.example.com/mcp/ FLOWLY_MCP_TOKEN=… \
 *     node scripts/check-tool-drift.js --live
 *
 * Exit codes: 0 = all clear, 1 = one or more errors
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────

const REPO_ROOT     = path.resolve(__dirname, '..');
const SNAPSHOT_REL  = 'scripts/tool-snapshot.json';
const SNAPSHOT_PATH = path.join(REPO_ROOT, SNAPSHOT_REL);

// The trees scanned, and the reason it is these four: they are everything this
// distribution SHIPS. A stale tool name in one of them is read by an agent
// mid-run and acted on. `docs/`, `README.md` and the other root files are
// prose about the fork for humans — a stale name there misleads a reader, which
// is a real but lesser harm and a different check's job. These four are also
// exactly the trees the ownership register covers, so "shipped" has one
// definition in this repository rather than two.
const SCANNED_TREES = ['skills', 'references', 'agents', 'commands'];

const SCANNED_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);

// How old a snapshot may be before its age is called out. Thirty days is one
// monthly upstream-merge cycle: a snapshot older than that has not been looked
// at since before the last time this fork was touched wholesale.
const STALE_AFTER_DAYS = 30;

const ENV_URL   = 'FLOWLY_MCP_URL';
const ENV_TOKEN = 'FLOWLY_MCP_TOKEN';

// ─── The tool-name vocabulary ────────────────────────────────────────────────
//
// What a Flowly tool name LOOKS like, held here and never derived from the tool
// list itself — see the header for why that circularity would disarm the whole
// check.
//
// Every Flowly tool is `<verb>_<object>` bar one, and these are the verbs.
// Widening this list is a one-line change that `checkVocabularyCovers` asks for
// by name the moment a tool arrives that none of them match.
const TOOL_NAME_PREFIXES = [
  'add_', 'advance_', 'assign_', 'attach_', 'convert_', 'create_', 'get_',
  'link_', 'list_', 'mark_', 'put_', 'remove_', 'run_', 'set_', 'submit_',
  'triage_', 'update_',
];

// Tool names with no verb-underscore shape at all. `whoami` is the identity
// call and the only one today.
const ATOMIC_TOOL_NAMES = new Set(['whoami']);

// Identifiers that are tool-SHAPED but are not tools, each with the reason.
// Keep this small: every entry is a hole in the guard, so the bar is that the
// identifier is genuinely not a tool and genuinely appears in the corpus.
//
// This map is honest in both directions, and `checkAllowlist` enforces both:
//
//   - An entry that names a real tool in the list is an error. Otherwise a
//     rename could be "fixed" by exempting the tool, which is the guard being
//     switched off in the shape of a bug fix.
//   - An entry no longer found anywhere in the corpus is an error. An exemption
//     whose text has been deleted or reworded is a permanent hole kept open by
//     nobody remembering to close it, and the next false positive it swallows
//     will be a real one. This is the self-retiring shape PLANNED_SKILLS uses
//     in check-commands.js, for the same reason.
const NON_TOOL_IDENTIFIERS = new Map([
  ['run_awaiting_review',
   'a notification kind (an enum value on a list_notifications item), not a call — collides with the `run_` verb'],
  ['run_id',
   'the argument attach_evidence takes to identify a loop run — collides with the `run_` verb'],
]);

// ─── Report plumbing (the shape check-register.js prints) ────────────────────

const HINT_PREFIX = '  ↳';

/**
 * A check accumulates two kinds of line in one array: a failure, and a `↳` hint
 * explaining how to fix it. The summary line must count the failures only —
 * counting hints once reported three failing files as nine, and the number a
 * reader trusts most was the one number that was wrong.
 */
function countFailures(errors) {
  return errors.filter(e => !e.startsWith(HINT_PREFIX)).length;
}

// ─── Extraction ──────────────────────────────────────────────────────────────

function isToolShaped(identifier) {
  if (ATOMIC_TOOL_NAMES.has(identifier)) return true;
  return TOOL_NAME_PREFIXES.some(prefix => identifier.startsWith(prefix));
}

// A run of backticks, its contents, and a matching run to close it. This covers
// both markdown forms at once: an inline span (`create_issue`) and a fenced
// block, whose opening and closing fences pair the same way. Tool names inside
// a JSON example are as much a claim as ones in prose, so both are in scope.
const CODE_SPAN_RE = /(`+)([^`]+)\1/g;

// A lowercase snake_case identifier, not preceded or followed by a character
// that would make it part of something larger (`obj.create_issue`,
// `create_issue_v2`).
const IDENTIFIER_RE = /(?<![\w.$-])([a-z][a-z0-9]*(?:_[a-z0-9]+)*)(?![\w-])/g;

/**
 * Every Flowly tool name claimed by one file's text.
 *
 * Inside a code span, an identifier counts as naming a tool when it is one of:
 *
 *   - the whole span            `create_issue`
 *   - immediately called        `mark_notification_read(notification_id, …)`
 *   - a quoted string           {"name": "create_issue"}
 *
 * and does not count when it merely appears inside one — which is what an
 * argument does. That single distinction is what separates the tool from its
 * arguments in `mark_notification_read(notification_id, mark_all)`: the name
 * before the parenthesis is the call, the names inside it are not.
 */
function extractToolNames(text) {
  const found = new Set();

  for (const span of text.matchAll(CODE_SPAN_RE)) {
    const body = span[2];
    const whole = body.trim();

    for (const m of body.matchAll(IDENTIFIER_RE)) {
      const identifier = m[1];
      if (!isToolShaped(identifier)) continue;
      if (NON_TOOL_IDENTIFIERS.has(identifier)) continue;

      const before = m.index > 0 ? body[m.index - 1] : '';
      const after  = body[m.index + identifier.length] || '';

      const isWholeSpan = whole === identifier;
      const isCall      = after === '(';
      const isQuoted    = (before === '"' || before === "'") && before === after;

      if (isWholeSpan || isCall || isQuoted) found.add(identifier);
    }
  }

  return found;
}

/** Every scannable file under the in-scope trees of `root`, repo-relative. */
function corpusFiles(root) {
  const files = [];

  const walk = dir => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!SCANNED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      files.push(abs);
    }
  };

  for (const tree of SCANNED_TREES) walk(path.join(root, tree));
  return files;
}

/**
 * Scan a corpus root. Returns the tool names it claims, each mapped to the
 * files that claim it — an error message that names a tool without naming the
 * file that has to be edited is an error message somebody has to grep for.
 */
function scanCorpus(root) {
  const files = corpusFiles(root);
  const names = new Map();
  const allowlistSightings = new Map();

  for (const abs of files) {
    const rel  = path.relative(root, abs).split(path.sep).join('/');
    const text = fs.readFileSync(abs, 'utf8');

    for (const name of extractToolNames(text)) {
      if (!names.has(name)) names.set(name, []);
      names.get(name).push(rel);
    }

    // Sightings of the allowlisted identifiers, for the self-retiring half of
    // checkAllowlist. Extraction has already dropped them, so they have to be
    // counted separately — a plain substring search is right here, because the
    // question is whether the text that justified the exemption still exists.
    for (const identifier of NON_TOOL_IDENTIFIERS.keys()) {
      if (!text.includes(identifier)) continue;
      if (!allowlistSightings.has(identifier)) allowlistSightings.set(identifier, []);
      allowlistSightings.get(identifier).push(rel);
    }
  }

  return { files, names, allowlistSightings };
}

// ─── Tool lists ──────────────────────────────────────────────────────────────

/**
 * Accept the three shapes a tool list arrives in: the `tools/list` result, this
 * repository's snapshot, and a bare array of names. Tests drive the check
 * through `--tools`, so this is also the seam that makes a rename simulable
 * without a disposable instance to rename anything in.
 */
function toolNamesFrom(value, source) {
  let list = value;
  if (list && !Array.isArray(list) && typeof list === 'object') {
    if (Array.isArray(list.tools)) list = list.tools;
    else if (list.result && Array.isArray(list.result.tools)) list = list.result.tools;
  }
  if (!Array.isArray(list)) {
    throw new Error(`${source}: expected an array of tools, or an object with a \`tools\` array`);
  }

  const names = list.map(entry => (typeof entry === 'string' ? entry : entry && entry.name));
  const bad = names.findIndex(n => typeof n !== 'string' || n === '');
  if (bad !== -1) throw new Error(`${source}: entry ${bad} has no usable \`name\``);

  return names;
}

function readSnapshot(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `${label} not found. Take one with: ${ENV_URL}=… ${ENV_TOKEN}=… ` +
      'node scripts/check-tool-drift.js --refresh'
    );
  }
  const raw = fs.readFileSync(file, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err.message}`);
  }
  return {
    capturedAt: typeof parsed.captured_at === 'string' ? parsed.captured_at : null,
    tools: toolNamesFrom(parsed, label),
  };
}

function writeSnapshot(names, file) {
  const body = {
    // Read by checkSnapshotAge. Written as a plain date because the hour a
    // snapshot was taken has never mattered and a timestamp invites a diff on
    // every refresh.
    captured_at: new Date().toISOString().slice(0, 10),
    source: 'MCP tools/list',
    note:
      'Tool names only. No endpoint, no instance identity, no credential — ' +
      'this file is public. Refresh with: node scripts/check-tool-drift.js --refresh',
    tool_count: names.length,
    tools: [...names].sort(),
  };
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
}

/**
 * `tools/list` over the MCP door. Plain JSON-RPC; the server may answer with
 * either a JSON body or an SSE stream, so both are handled — the last `data: `
 * frame is the result in the streaming case.
 */
async function fetchLiveTools() {
  const url   = process.env[ENV_URL];
  const token = process.env[ENV_TOKEN];

  if (!url) {
    throw new Error(
      `${ENV_URL} is not set. The endpoint is deliberately not stored in this ` +
      'repository; export it for this command only.'
    );
  }
  if (!token) throw new Error(`${ENV_TOKEN} is not set.`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`tools/list returned HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    const frames = text.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6));
    if (frames.length === 0) throw new Error('tools/list returned neither JSON nor an SSE frame');
    payload = JSON.parse(frames[frames.length - 1]);
  }

  if (payload.error) {
    throw new Error(`tools/list was refused: ${JSON.stringify(payload.error)}`);
  }
  return toolNamesFrom(payload, 'the live tools/list response');
}

// ─── Checks ──────────────────────────────────────────────────────────────────

/**
 * Check 1 — the vacuity guard.
 *
 * Everything below this is an assertion about the tool names the corpus uses.
 * Every one of them is trivially true when there are none, so this is what
 * separates a green run that means something from a green run that means the
 * extractor found nothing.
 */
function checkCorpusNamesTools(names, files, report) {
  const errors = [];

  if (files.length === 0) {
    errors.push(`no files scanned under ${SCANNED_TREES.map(t => `${t}/`).join(', ')}`);
    errors.push(`${HINT_PREFIX} the corpus root is wrong, or the shipped trees are missing.`);
  } else if (names.size === 0) {
    errors.push(`${files.length} file(s) scanned and not one Flowly tool name found`);
    errors.push(`${HINT_PREFIX} every check below is vacuously true over an empty set, so this is`);
    errors.push(`${HINT_PREFIX} an error and not a pass. Either the skills stopped naming tools, or`);
    errors.push(`${HINT_PREFIX} the extractor stopped seeing them — the second is the dangerous one.`);
  }

  report(errors, 'the corpus names Flowly tools', `${names.size} distinct tool name(s) across ${files.length} file(s)`);
  return countFailures(errors);
}

/** Levenshtein distance, capped work — only ever run over ~46 short names. */
function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = prev[j];
      prev[j] = next;
    }
  }
  return prev[b.length];
}

/** The live name a vanished corpus name most plausibly became, if any. */
function nearest(name, candidates) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = distance(name, candidate);
    if (d < bestDistance) { bestDistance = d; best = candidate; }
  }
  // Beyond a third of the name changed, "did you mean" is a guess dressed as a
  // finding, and a wrong suggestion is worse than none on a check like this.
  return bestDistance <= Math.max(3, Math.floor(name.length / 3)) ? best : null;
}

/** Check 2 — the acceptance. Every name the corpus uses must be in the list. */
function checkNamesResolve(names, live, listLabel, report) {
  const errors = [];
  const known  = new Set(live);

  for (const [name, files] of [...names].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (known.has(name)) continue;
    errors.push(`\`${name}\` is not in ${listLabel} — named by ${files.join(', ')}`);
    const guess = nearest(name, live);
    if (guess !== null) {
      errors.push(`${HINT_PREFIX} closest live name is \`${guess}\` — if that is the rename, update every file above.`);
    } else {
      errors.push(`${HINT_PREFIX} the tool was renamed or removed upstream, or this is a typo. Nothing in this repo caused it.`);
    }
  }

  report(
    errors,
    'every tool name in the corpus resolves',
    `${names.size} name(s) all present in ${listLabel}`,
  );
  return countFailures(errors);
}

/**
 * Check 3 — the false-negative direction.
 *
 * A tool the vocabulary cannot recognise is a tool this guard silently stops
 * watching: the corpus can name it, misname it, or go on naming it after it is
 * gone, and nothing here will notice. The cost of the fix is one line.
 */
function checkVocabularyCovers(live, listLabel, report) {
  const errors = [];
  const unrecognised = live.filter(name => !isToolShaped(name)).sort();

  for (const name of unrecognised) {
    errors.push(`\`${name}\` in ${listLabel} matches no known tool-name shape`);
  }
  if (unrecognised.length > 0) {
    errors.push(`${HINT_PREFIX} add its verb to TOOL_NAME_PREFIXES (or the name to ATOMIC_TOOL_NAMES) in this script.`);
    errors.push(`${HINT_PREFIX} until then the corpus can name it, or misname it, and this check cannot tell.`);
  }

  report(
    errors,
    'the extractor can recognise every live tool',
    `${live.length} name(s) matched by ${TOOL_NAME_PREFIXES.length} verb prefix(es) + ${ATOMIC_TOOL_NAMES.size} atomic name(s)`,
  );
  return countFailures(errors);
}

/**
 * Check 4 — the allowlist is honest in both directions.
 *
 * The second direction is a claim about THIS repository's prose — "the sentence
 * that made this exemption necessary is still there" — so it is only asked of
 * this repository's corpus. Under `--root` it is skipped and the report says
 * so, because asserting our exemptions against somebody else's tree would fail
 * for a reason that has nothing to do with either.
 */
function checkAllowlist(live, sightings, listLabel, isOwnCorpus, report) {
  const errors = [];
  const known  = new Set(live);

  for (const [identifier, reason] of NON_TOOL_IDENTIFIERS) {
    if (known.has(identifier)) {
      errors.push(`\`${identifier}\` is exempted as a non-tool but IS a tool in ${listLabel}`);
      errors.push(`${HINT_PREFIX} delete the entry. Exempting a real tool is this guard being switched off for it.`);
      continue;
    }
    if (isOwnCorpus && !sightings.has(identifier)) {
      errors.push(`\`${identifier}\` is exempted but no longer appears anywhere in the corpus`);
      errors.push(`${HINT_PREFIX} the exemption has outlived the text it excused ("${reason}") — delete it.`);
    }
  }

  const earned = isOwnCorpus
    ? 'each a non-tool and each still in the corpus'
    : 'each a non-tool (the still-in-the-corpus half needs this repo\'s own corpus, skipped under --root)';

  report(
    errors,
    'the non-tool allowlist is still earned',
    NON_TOOL_IDENTIFIERS.size === 0
      ? 'empty — no identifier needs an exemption'
      : `${NON_TOOL_IDENTIFIERS.size} exemption(s), ${earned}`,
  );
  return countFailures(errors);
}

/** Check 5 — the snapshot's age. A warning by design; see the header. */
function checkSnapshotAge(capturedAt, label, report, warn) {
  const errors = [];

  if (capturedAt === null || !/^\d{4}-\d{2}-\d{2}$/.test(capturedAt || '')) {
    errors.push(`${label} has no usable \`captured_at\` date`);
    errors.push(`${HINT_PREFIX} without it, staleness is unmeasurable and the snapshot is an undated claim.`);
    report(errors, 'the snapshot is dated', '');
    return { errors: countFailures(errors), warnings: 0 };
  }

  const taken = Date.parse(`${capturedAt}T00:00:00Z`);
  const days  = Math.floor((Date.now() - taken) / 86400000);

  if (days > STALE_AFTER_DAYS) {
    warn(
      'the snapshot is fresh',
      `taken ${capturedAt}, ${days} day(s) ago — older than ${STALE_AFTER_DAYS}`,
      [
        'a snapshot this old may already disagree with the instance, and this mode cannot tell.',
        `refresh it (${ENV_URL}=… ${ENV_TOKEN}=… node scripts/check-tool-drift.js --refresh),`,
        'or run --live, which is the mode that actually sees a rename.',
      ],
    );
    return { errors: 0, warnings: 1 };
  }

  report(errors, 'the snapshot is fresh', `taken ${capturedAt}, ${days} day(s) ago`);
  return { errors: 0, warnings: 0 };
}

/** Check 6 (--live only) — the snapshot still describes the instance. */
function checkSnapshotMatchesLive(snapshot, live, report) {
  const errors    = [];
  const inLive    = new Set(live);
  const inSnap    = new Set(snapshot);
  const vanished  = snapshot.filter(n => !inLive.has(n)).sort();
  const appeared  = live.filter(n => !inSnap.has(n)).sort();

  for (const name of vanished) {
    errors.push(`\`${name}\` is in the snapshot but NOT on the instance — renamed or removed upstream`);
  }
  for (const name of appeared) {
    errors.push(`\`${name}\` is on the instance but not in the snapshot — added upstream`);
  }
  if (errors.length > 0) {
    errors.push(`${HINT_PREFIX} this is the drift the snapshot cannot see by itself. Run --refresh, then fix whatever check 2 then reports.`);
  }

  report(
    errors,
    'the snapshot matches the instance',
    `${live.length} live tool(s), snapshot identical`,
  );
  return countFailures(errors);
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * `--root` and `--snapshot` exist so the checks below have readers. A branch
 * that can only be reached by editing the repository or waiting a month is a
 * branch nothing asserts, and this file has two of them: the vacuity guard
 * needs a corpus that names no tools, and the staleness warning needs a
 * snapshot with an old date. Both are test seams and neither changes what the
 * default invocation does.
 */
function parseArgs(argv) {
  const options = {
    live: false,
    refresh: false,
    toolsFile: null,
    root: REPO_ROOT,
    snapshot: SNAPSHOT_PATH,
    snapshotLabel: SNAPSHOT_REL,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--live')     { options.live = true; continue; }
    if (arg === '--refresh')  { options.refresh = true; continue; }
    if (arg === '--tools')    { options.toolsFile = argv[++i]; continue; }
    if (arg === '--root')     { options.root = path.resolve(argv[++i] || '.'); continue; }
    if (arg === '--snapshot') {
      const value = argv[++i];
      if (!value) throw new Error('--snapshot needs a file path');
      options.snapshot = path.resolve(value);
      options.snapshotLabel = value;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (options.toolsFile !== null && (options.live || options.refresh)) {
    throw new Error('--tools supplies the list itself; it cannot be combined with --live or --refresh');
  }
  if (options.toolsFile === '' || options.toolsFile === undefined) {
    throw new Error('--tools needs a file path');
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);

  let errorCount   = 0;
  let warningCount = 0;

  const report = (errors, name, okMessage) => {
    if (errors.length === 0) {
      console.log(`  ✓  ${name}${okMessage ? ` — ${okMessage}` : ''}`);
      return;
    }
    console.log(`  ✗  ${name}`);
    for (const msg of errors) {
      console.log(msg.startsWith(HINT_PREFIX) ? `       ${msg}` : `       ERROR: ${msg}`);
    }
  };

  const warn = (name, message, hints) => {
    console.log(`  ⚠  ${name} — ${message}`);
    for (const hint of hints) console.log(`       ${HINT_PREFIX} ${hint}`);
  };

  console.log('Flowly tool-name drift — the corpus against the tool list\n');

  // ── The tool list, from whichever source was asked for ───────────────────
  let live;
  let listLabel;
  let snapshot = null;

  if (options.toolsFile !== null) {
    const raw = fs.readFileSync(path.resolve(options.toolsFile), 'utf8');
    live = toolNamesFrom(JSON.parse(raw), options.toolsFile);
    listLabel = `the tool list in ${options.toolsFile}`;
    console.log(`  Source:    ${options.toolsFile} (supplied)`);
  } else if (options.live || options.refresh) {
    live = await fetchLiveTools();
    listLabel = 'the live tool list';
    console.log(`  Source:    live tools/list via $${ENV_URL}`);
    if (fs.existsSync(options.snapshot)) snapshot = readSnapshot(options.snapshot, options.snapshotLabel);
    if (options.refresh) {
      // Report what the refresh changed BEFORE overwriting, and report it as
      // news rather than as a failure: a refresh that finds drift is the tool
      // working, and exiting 1 on it would make the fix look like the fault.
      // Check 6 is skipped below for the same reason — after the write it would
      // be comparing the new snapshot against the list it was just built from.
      const before = snapshot === null ? null : new Set(snapshot.tools);
      writeSnapshot(live, options.snapshot);
      console.log(`  Wrote:     ${options.snapshotLabel} (${live.length} tool(s))`);
      if (before !== null) {
        const gone  = [...before].filter(n => !live.includes(n)).sort();
        const added = live.filter(n => !before.has(n)).sort();
        console.log(
          `  Changed:   ${gone.length === 0 && added.length === 0 ? 'nothing' : ''}` +
          `${gone.length > 0 ? `-${gone.join(' -')} ` : ''}${added.length > 0 ? `+${added.join(' +')}` : ''}`
        );
      }
      snapshot = readSnapshot(options.snapshot, options.snapshotLabel);
    }
  } else {
    snapshot = readSnapshot(options.snapshot, options.snapshotLabel);
    live = snapshot.tools;
    listLabel = `the snapshot (${options.snapshotLabel})`;
    console.log(`  Source:    ${options.snapshotLabel}, taken ${snapshot.capturedAt || '(undated)'}`);
  }

  console.log(`  Corpus:    ${SCANNED_TREES.map(t => `${t}/`).join(' ')}`);
  console.log(`  Tools:     ${live.length}\n`);

  const { files, names, allowlistSightings } = scanCorpus(options.root);

  errorCount += checkCorpusNamesTools(names, files, report);
  errorCount += checkNamesResolve(names, live, listLabel, report);
  errorCount += checkVocabularyCovers(live, listLabel, report);
  errorCount += checkAllowlist(live, allowlistSightings, listLabel, options.root === REPO_ROOT, report);

  // Only meaningful when the snapshot is the thing being trusted. Under
  // --tools the list came from the caller, and under --live reality is in hand.
  if (options.toolsFile === null && !options.live && !options.refresh) {
    const age = checkSnapshotAge(snapshot.capturedAt, options.snapshotLabel, report, warn);
    errorCount   += age.errors;
    warningCount += age.warnings;
  }

  if (options.live && snapshot !== null) {
    errorCount += checkSnapshotMatchesLive(snapshot.tools, live, report);
  }

  const status = errorCount > 0 ? 'FAILED' : 'PASSED';
  console.log(
    `\n${files.length} file(s) scanned, ${names.size} tool name(s) in the corpus, ` +
    `${live.length} in the tool list — ${errorCount} error(s), ${warningCount} warning(s) — ${status}`
  );

  if (errorCount > 0) process.exit(1);
}

module.exports = {
  extractToolNames,
  isToolShaped,
  scanCorpus,
  toolNamesFrom,
  TOOL_NAME_PREFIXES,
  ATOMIC_TOOL_NAMES,
  NON_TOOL_IDENTIFIERS,
  SCANNED_TREES,
  SNAPSHOT_REL,
  STALE_AFTER_DAYS,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch(err => {
    console.error(`\nERROR: check-tool-drift failed: ${err.message}`);
    process.exit(1);
  });
}
