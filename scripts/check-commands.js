#!/usr/bin/env node
/**
 * check-commands.js
 *
 * CLI that holds the six lifecycle commands in `commands/` to the rules that
 * make them work on every door this fork ships through. Nearly everything it
 * asserts fails SILENTLY in production — a command is skipped, truncated or
 * points at nothing, with no warning anywhere — which is why the rules live in
 * a check rather than in a comment somebody is supposed to remember.
 *
 * It asserts the following, and reports each separately:
 *
 *   1. The command set is exactly six — research, plan, build, test, review,
 *      ship — each at `commands/<name>.md`. A missing one is a command users
 *      never receive; an extra `.md` anywhere under `commands/` is a slash
 *      command nobody decided to ship, because Claude Code's default scan turns
 *      every markdown file there into one.
 *   2. Frontmatter carries a non-empty `description` and an `argument-hint`.
 *      The `description` requirement is not cosmetic: Codex refuses to migrate
 *      a command whose frontmatter description is missing or empty, and it does
 *      so silently (`command_skill_name_if_supported`, command_migration.rs
 *      ~line 344, alongside a sibling skip for a `README` file stem). A
 *      description-less command simply does not exist on that door.
 *   3. No substitution token in the body. See the long note on
 *      `findUnsupportedTokens` below — this is the rule the whole command layer
 *      is shaped around.
 *   4. The migrated skill Codex would render stays under its size cap. Codex
 *      renders each command into a skill and drops it — `continue`, no warning
 *      — when the rendered bytes exceed MAX_MIGRATED_COMMAND_SKILL_BYTES
 *      (4000; `command_migration.rs:18`, enforced in `import_command_sources`
 *      at `command_migration.rs:166`).
 *   5. The canonical `## Resolve the issue` block is present verbatim in all
 *      six. This script owns the exact string.
 *   6. commands/build.md carries the canonical `## Select the mode` block, and
 *      no other command carries one. Upstream tested its whole argument against
 *      the mode words, so a mode plus an identifier selected single-task mode —
 *      silently, on the one invocation that asked for the opposite.
 *   7. No command names a local planning destination. The narrow, early version
 *      of the binding rule: this is the layer where those paths were enforced
 *      rather than merely suggested, including as a clean-baseline whitelist.
 *   8. Every `flowly:<skill>` a command names resolves to a directory under
 *      `skills/`, or is declared in PLANNED_SKILLS with a reason. That map is
 *      self-retiring: an entry whose skill now exists on disk is an error, so
 *      the exemption cannot outlive the absence that justified it.
 *
 * WHAT CHECKS 5 AND 6 DO AND DO NOT PROVE
 * ---------------------------------------
 * They prove two instructions are present, identically, where they belong: that
 * no command has quietly lost the sentence telling the agent to stop and ask
 * rather than guess an issue or write a local file, and that the build command
 * has not quietly gone back to reading its mode from the whole argument.
 *
 * They prove nothing about whether a model obeys either one. Obedience is a
 * behavioural property, measured by the evals in `evals/`, not by reading bytes
 * off disk. Both are needed; neither substitutes for the other. Saying so
 * plainly matters, because "a check asserts none of the six can complete
 * without an identifier" reads as a guarantee about runtime, and this is a
 * guarantee about text.
 *
 * Usage:   node scripts/check-commands.js
 * Exit codes: 0 = all clear, 1 = one or more errors
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────

const REPO_ROOT    = path.resolve(__dirname, '..');
const COMMANDS_DIR = path.join(REPO_ROOT, 'commands');
const SKILLS_DIR   = path.join(REPO_ROOT, 'skills');

// The six lifecycle phases, in order. This list is the specification: the
// directory is checked against it in both directions.
const COMMANDS = ['research', 'plan', 'build', 'test', 'review', 'ship'];

// Required frontmatter keys. `argument-hint` is what shows the caller that the
// command takes an issue identifier; without it the whole premise of this
// distribution is invisible at the point of invocation.
const REQUIRED_FRONTMATTER = ['description', 'argument-hint'];

// `MAX_MIGRATED_COMMAND_SKILL_BYTES` — codex-rs/core-plugins/src/command_migration.rs:18
const MAX_MIGRATED_BYTES = 4000;

// Skills a command may name before they exist on disk, each with the reason it
// is not there yet. Anything not in `skills/` and not listed here is a typo or
// a dead reference, and either way the agent following that command finds
// nothing.
//
// This map is self-retiring, and that is the point of check 8's second
// direction: when one of these skills lands, the check goes red asking for the
// entry to be deleted. An exemption that can only be removed by a human who
// happens to remember it is an exemption that becomes permanent.
const PLANNED_SKILLS = new Map([
  ['flowly-verify',    'the Verify phase skill, authored in the Flowly-native skills phase'],
  ['flowly-review',    'the Review phase skill, authored in the Flowly-native skills phase'],
  ['flowly-ship',      'the Ship phase skill, authored in the Flowly-native skills phase'],
]);

// The plugin namespace skills are addressed through, from `.claude-plugin/plugin.json`.
const SKILL_NAMESPACE = 'flowly';

// ─── The canonical resolution block ──────────────────────────────────────────
//
// Byte-identical in all six commands, and owned here rather than in any one of
// them: six copies with no reader is six chances for one to drift, and the
// clause most likely to be trimmed as boilerplate is the refusal — the one
// clause that stops the agent writing a plan to a local file when it cannot
// work out which issue it is on. That fallback is the exact failure this
// distribution exists to prevent, so it is the clause that gets a check.
//
// It also has to stay clean under check 3: it appears in every body, so a
// forbidden token here would close the Codex door for all six at once.
const CANONICAL_BLOCK = [
  '## Resolve the issue',
  '',
  'This command works on exactly one Flowly issue, and resolving which one comes first — before',
  'reading code, before calling any other tool, before writing anything.',
  '',
  '1. **From the invocation arguments, if present.** Claude Code appends them to the end of this body',
  '   automatically, precisely because this body names no substitution token.',
  '2. **Otherwise from the conversation**, and only when exactly one issue is unambiguously under',
  '   discussion. Two candidates, or an issue mentioned in passing, is not unambiguous.',
  '3. **`FLO-1234`, `flo-1234` and the bare `1234` are all accepted.** Flowly\'s tools match an',
  '   identifier case-insensitively and take the bare number, so pass through the form the human used',
  '   rather than reformatting it.',
  '',
  '**If exactly one identifier cannot be resolved, stop and ask for it.** Do not guess. Do not pick the',
  'most recent issue. And do not fall back to writing a plan, a spec, a todo list, a checklist or notes',
  'to a local file — every artifact belongs to the issue, and a local file is the exact failure this',
  'distribution exists to prevent.',
].join('\n');

// ─── The canonical mode block (build only) ───────────────────────────────────
//
// Owned here for the same reason as the block above, but guarding a different
// mistake. Upstream's build command tested its *whole* argument against the
// mode words, which works only while the argument is nothing but a mode word.
// Give this command what it is for — a mode and an issue in one argument — and
// the whole-string test fails to match, and the command silently selects
// single-task mode on the one invocation that explicitly asked for the
// opposite. Silently: there is no error, the run just quietly does a sixth of
// the work.
//
// So the contract is that the two are read out independently and in any order,
// and it is asserted rather than described, because the failure it prevents
// looks exactly like success.
const CANONICAL_MODE_BLOCK = [
  '## Select the mode',
  '',
  'The arguments carry two independent things and they may arrive in either order: the identifier you',
  'just resolved, and optionally a mode word. Read each out of the argument text separately. Do not',
  'test the whole argument against the mode words — `auto FLO-1234` is both, and matching the whole',
  'string selects single-task mode on the very invocation that asked for the opposite.',
  '',
  '- **`auto`, or `all`** — autonomous: work every remaining child to done without stopping between',
  '  them.',
  '- **anything else, or nothing** — the default: work the next child, then stop.',
].join('\n');

// The command this block belongs to. Only one command has a mode.
const MODE_COMMAND = 'build';

// ─── Forbidden planning destinations ─────────────────────────────────────────
//
// The paths upstream's autonomous mode listed as *expected* uncommitted changes
// — the whitelist that told the agent a working tree containing `tasks/plan.md`
// was a clean baseline. Every one of them is a planning artifact that belongs
// to a Flowly issue here, so there is nothing legitimate to whitelist and the
// whitelist itself had to go.
//
// Scoped to `commands/` deliberately: the tree-wide version of this rule is the
// binding check, which arrives with the task that rebinds the inherited corpus.
// This is the narrow version, held early, because the command layer is where
// those paths were *enforced* rather than merely suggested.
const FORBIDDEN_DESTINATIONS = ['SPEC.md', 'spec/', 'tasks/plan.md', 'tasks/todo.md'];

// ─── Reading a command file ──────────────────────────────────────────────────

/**
 * Split a command file into its frontmatter block and its body.
 *
 * The split has to match Codex's, because checks 3 and 4 are about what Codex
 * sees: there, `template` is `document.body`, which is everything after the
 * closing delimiter. So a token inside frontmatter is not a violation and a
 * token one line below it is — the boundary is load-bearing, not tidiness.
 *
 * `bodyStartLine` is the 1-based file line the body begins on, so every error
 * this script prints can be jumped to directly.
 */
function splitFrontmatter(text) {
  const lines = text.split('\n');

  if (lines[0] !== '---') {
    return { ok: false, error: 'does not open with a `---` frontmatter delimiter on line 1' };
  }

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) {
    return { ok: false, error: 'frontmatter block is never closed by a second `---`' };
  }

  return {
    ok: true,
    frontmatter: lines.slice(1, close),
    body: lines.slice(close + 1).join('\n'),
    bodyStartLine: close + 2,
  };
}

/**
 * Read the frontmatter as flat `key: value` pairs. Deliberately not a YAML
 * parser: command frontmatter is a handful of scalars, and a real parser would
 * accept nested shapes this check has no opinion about.
 */
function frontmatterFields(lines) {
  const fields = new Map();
  for (const line of lines) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (m === null) continue;
    fields.set(m[1], m[2].trim());
  }
  return fields;
}

/** Every `.md` file under `commands/`, at any depth, repo-relative. */
function walkMarkdown(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { walkMarkdown(abs, out); continue; }
    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== '.md') continue;
    out.push(path.relative(REPO_ROOT, abs).split(path.sep).join('/'));
  }
  return out;
}

// ─── Check 3: substitution tokens ────────────────────────────────────────────

/**
 * Reimplementation of Codex's `has_unsupported_command_template_features`
 * (codex-rs/core-plugins/src/command_migration.rs:419-435). A command body that
 * trips any one of these is skipped during migration — silently, with no
 * warning on either side — so on that door the command does not exist.
 *
 * The rule this produces looks backwards until you see both doors at once:
 * Claude Code appends the invocation arguments as an arguments line at the end
 * of a body *when the body contains no substitution token*. So writing the
 * token buys nothing on the primary door — the arguments arrive either way —
 * and costs the command entirely on the other. A body that names no token is
 * the only shape that works everywhere, which is why the six commands resolve
 * their identifier in prose instead.
 *
 * Returns [{ token, line }] with 1-based line numbers relative to the body.
 */
function findUnsupportedTokens(body) {
  const findings = [];
  const lines = body.split('\n');

  const pushAll = (re, label) => {
    for (let i = 0; i < lines.length; i++) {
      let m;
      const rx = new RegExp(re.source, re.flags);
      while ((m = rx.exec(lines[i])) !== null) {
        findings.push({ token: `${label} (\`${m[0]}\`)`, line: i + 1 });
        if (m[0].length === 0) rx.lastIndex++;
      }
    }
  };

  // `template.contains("$ARGUMENTS")`
  pushAll(/\$ARGUMENTS/g, 'the arguments substitution token');

  // `contains_numbered_argument_placeholder` — any '$' immediately followed by
  // an ASCII digit. Broader than the positional tokens it is named for, and
  // deliberately reproduced at that width: matching only the tokens someone
  // meant to write would pass bodies Codex rejects.
  pushAll(/\$[0-9]/g, 'a numbered argument placeholder');

  // `template.contains("!`")` and `template.contains("! `")` — the bash
  // pre-execution form.
  pushAll(/! ?`/g, 'a shell pre-execution marker');

  // `token.strip_prefix('@').is_some_and(|rest| !rest.is_empty())` over
  // `split_whitespace` — any whitespace-delimited word starting with `@`.
  for (let i = 0; i < lines.length; i++) {
    for (const token of lines[i].split(/\s+/)) {
      if (token.startsWith('@') && token.length > 1) {
        findings.push({ token: `a file-reference token (\`${token}\`)`, line: i + 1 });
      }
    }
  }

  // `template.contains("{{") && template.contains("}}")` — a whole-body
  // condition, not a per-line one: the two halves may be lines apart and Codex
  // still refuses the command. Reported at both offending lines.
  const openLine  = lines.findIndex(l => l.includes('{{'));
  const closeLine = lines.findIndex(l => l.includes('}}'));
  if (openLine !== -1 && closeLine !== -1) {
    findings.push({ token: 'a template placeholder (`{{`)', line: openLine + 1 });
    findings.push({ token: 'a template placeholder (`}}`)', line: closeLine + 1 });
  }

  return findings;
}

// ─── Check 4: the size Codex would render ────────────────────────────────────

/**
 * An upper bound on the bytes a YAML-quoted scalar occupies once Codex's
 * `yaml_string` has had it: two delimiters plus, worst case, a backslash for
 * every character. The real output is almost always the raw string with two
 * quotes, so this over-counts — on purpose. Over-counting means a pass here is
 * a guaranteed pass there, while an exact model of somebody else's quoting
 * function would have to be right to be worth anything.
 */
function yamlUpperBoundBytes(value) {
  return 2 + 2 * Buffer.byteLength(value, 'utf8');
}

/**
 * The byte size of the skill Codex renders from a command, per the format
 * string in `command_migration.rs`. Over MAX_MIGRATED_BYTES the migration hits
 * `continue` at command_migration.rs:166 and the command is dropped with no
 * warning, so the only way to learn about it is a check like this one.
 *
 * `source_name` is modelled as the generated skill name, which is longer than
 * the real one: for a command directory Codex derives the source name from the
 * path with the extension stripped (`research`), while the generated name
 * prepends `source-command-`. Same over-count discipline as above.
 *
 * Not modelled: Codex passes the body and the description through a term
 * rewrite before rendering. The plugin profile carries an empty variant list,
 * so the only substitution available to it is a documentation file name, and
 * none of the six bodies names one. Should that change, the rewrite swaps one
 * short file name for another and the headroom this check reports absorbs it.
 */
function renderedBytes(stem, description, body) {
  const name = `source-command-${stem}`;
  const rendered =
    '---\n' +
    'name: ' + 'x'.repeat(yamlUpperBoundBytes(name)) + '\n' +
    'description: ' + 'x'.repeat(yamlUpperBoundBytes(description)) + '\n' +
    '---\n\n' +
    `# ${name}\n\n` +
    `Use this skill when the user asks to run the migrated source command \`${name}\`.\n\n` +
    '## Command Template\n\n' +
    body.trim() + '\n';
  return Buffer.byteLength(rendered, 'utf8');
}

// ─── Check 6: skill references ───────────────────────────────────────────────

/** Every `flowly:<skill>` named in a body, in order of appearance. */
function skillReferences(body) {
  const re = new RegExp(`\\b${SKILL_NAMESPACE}:([A-Za-z0-9][A-Za-z0-9._-]*)`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

function skillsOnDisk() {
  if (!fs.existsSync(SKILLS_DIR)) return new Set();
  return new Set(
    fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
  );
}

// ─── Checks ──────────────────────────────────────────────────────────────────

function checkCommandSet(present, report) {
  const errors = [];
  const expected = new Set(COMMANDS.map(n => `commands/${n}.md`));

  for (const name of COMMANDS) {
    if (!present.includes(`commands/${name}.md`)) {
      errors.push(`missing: commands/${name}.md`);
    }
  }
  if (errors.length > 0) {
    errors.push('  ↳ the six lifecycle commands are the distribution; a missing one is a phase users cannot reach.');
  }

  const extras = present.filter(p => !expected.has(p));
  for (const p of extras) {
    errors.push(`not one of the six: ${p}`);
  }
  if (extras.length > 0) {
    errors.push('  ↳ every markdown file under `commands/` becomes a slash command — the plugin declares no `commands` key, so Claude Code\'s default scan picks up the whole directory.');
  }

  report(errors, 'the command set is exactly six', `${COMMANDS.join(', ')} — nothing missing, nothing extra`);
  return errors.length;
}

function checkFrontmatter(files, report) {
  const errors = [];
  const bad    = new Set();

  for (const { rel, parsed } of files) {
    if (!parsed.ok) {
      errors.push(`${rel}: ${parsed.error}`);
      bad.add('block');
      continue;
    }
    const fields = frontmatterFields(parsed.frontmatter);
    for (const key of REQUIRED_FRONTMATTER) {
      if (!fields.has(key)) {
        errors.push(`${rel}: frontmatter has no \`${key}\``);
        bad.add(key);
      } else if (fields.get(key) === '') {
        errors.push(`${rel}: frontmatter \`${key}\` is empty`);
        bad.add(key);
      }
    }
  }

  // Each hint is scoped to the failure that earned it. A hint about the wrong
  // field is worse than none: it sends the reader to look at something correct.
  if (bad.has('block')) {
    errors.push('  ↳ Codex reads the body as everything after the closing delimiter, so an unclosed block makes the whole file the frontmatter and the command has no template at all.');
  }
  if (bad.has('description')) {
    errors.push('  ↳ a missing or empty `description` is not cosmetic: Codex skips such a command during migration, silently, and it never reaches the user on that door.');
  }
  if (bad.has('argument-hint')) {
    errors.push('  ↳ `argument-hint` is what shows the caller at the prompt that the command takes an issue identifier. Without it, the premise of this distribution is invisible at the point of invocation.');
  }

  report(errors, 'frontmatter', `${files.length} command(s) carry a non-empty ${REQUIRED_FRONTMATTER.map(k => `\`${k}\``).join(' and ')}`);
  return errors.length;
}

function checkNoTokens(files, report) {
  const errors = [];

  for (const { rel, parsed } of files) {
    if (!parsed.ok) continue;
    for (const { token, line } of findUnsupportedTokens(parsed.body)) {
      errors.push(`${rel}:${parsed.bodyStartLine + line - 1}: ${token}`);
    }
  }
  if (errors.length > 0) {
    errors.push('  ↳ Codex skips any command whose body trips `has_unsupported_command_template_features` (codex-rs/core-plugins/src/command_migration.rs:419-435), with no warning on either side.');
    errors.push('  ↳ the token buys nothing anyway: Claude Code appends the invocation arguments precisely when the body names none. Resolve the identifier in prose instead.');
  }

  report(errors, 'no substitution token in any body', `${files.length} body/bodies name no token, so the arguments are appended and the other doors stay open`);
  return errors.length;
}

function checkRenderedSize(files, report) {
  const errors = [];
  const sizes  = [];

  for (const { rel, stem, parsed } of files) {
    if (!parsed.ok) continue;
    const description = frontmatterFields(parsed.frontmatter).get('description') || '';
    const bytes = renderedBytes(stem, description, parsed.body);
    sizes.push({ rel, bytes });
    if (bytes > MAX_MIGRATED_BYTES) {
      errors.push(`${rel}: renders to ${bytes} bytes, over the ${MAX_MIGRATED_BYTES}-byte cap by ${bytes - MAX_MIGRATED_BYTES}`);
    }
  }
  if (errors.length > 0) {
    errors.push(`  ↳ MAX_MIGRATED_COMMAND_SKILL_BYTES is ${MAX_MIGRATED_BYTES} (command_migration.rs:18) and an over-size render is dropped by the \`continue\` at command_migration.rs:166 — no warning, the command simply is not there.`);
    errors.push('  ↳ a command body is instructions to an agent, not documentation. Move the explanation into the skill it invokes.');
  }

  const worst = sizes.reduce((a, b) => (b.bytes > a.bytes ? b : a), { rel: '(none)', bytes: 0 });
  report(
    errors,
    'rendered size under the migration cap',
    `largest is ${worst.rel} at ${worst.bytes} bytes — ${MAX_MIGRATED_BYTES - worst.bytes} bytes of headroom`,
  );
  return errors.length;
}

function checkCanonicalBlock(files, report) {
  const errors = [];

  for (const { rel, parsed } of files) {
    if (!parsed.ok) continue;
    if (!parsed.body.includes(CANONICAL_BLOCK)) {
      errors.push(`${rel}: does not contain the canonical \`## Resolve the issue\` block verbatim`);
    }
  }
  if (errors.length > 0) {
    errors.push('  ↳ the block is owned by CANONICAL_BLOCK in this script. Copy it back byte for byte; do not edit one command\'s copy.');
    errors.push('  ↳ the sentence most likely to be trimmed as boilerplate is the refusal, and it is the one that stops an unresolved identifier turning into a plan written to a local file.');
  }

  report(errors, 'canonical resolution block present verbatim', `identical in all ${files.length} command(s)`);
  return errors.length;
}

function checkModeBlock(files, report) {
  const errors = [];
  const target = files.find(f => f.stem === MODE_COMMAND);

  if (target === undefined) {
    // Check 1 has already reported the missing file; do not report it twice.
    report([], 'the autonomous-mode contract', `skipped — commands/${MODE_COMMAND}.md is absent`);
    return 0;
  }
  if (!target.parsed.ok) {
    report([], 'the autonomous-mode contract', 'skipped — the frontmatter check reported this file');
    return 0;
  }

  if (!target.parsed.body.includes(CANONICAL_MODE_BLOCK)) {
    errors.push(`${target.rel}: does not contain the canonical \`## Select the mode\` block verbatim`);
    errors.push('  ↳ the block is owned by CANONICAL_MODE_BLOCK in this script. Copy it back byte for byte.');
    errors.push('  ↳ what it guards: reading the mode by testing the whole argument makes `auto FLO-1234` select single-task mode, with no error and no sign that it happened.');
  }

  // Only this command may carry a mode. A second one would mean two argument
  // grammars for one distribution, and the second is the one nobody checks.
  for (const { rel, stem, parsed } of files) {
    if (stem === MODE_COMMAND || !parsed.ok) continue;
    if (parsed.body.includes('## Select the mode')) {
      errors.push(`${rel}: carries a \`## Select the mode\` section, but only commands/${MODE_COMMAND}.md has a mode`);
    }
  }

  report(errors, 'the autonomous-mode contract', `commands/${MODE_COMMAND}.md reads the mode word and the identifier independently`);
  return errors.length;
}

function checkForbiddenDestinations(files, report) {
  const errors = [];

  for (const { rel, parsed } of files) {
    if (!parsed.ok) continue;
    const lines = parsed.body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const dest of FORBIDDEN_DESTINATIONS) {
        if (lines[i].includes(dest)) {
          errors.push(`${rel}:${parsed.bodyStartLine + i}: names the planning destination \`${dest}\``);
        }
      }
    }
  }
  if (errors.length > 0) {
    errors.push('  ↳ a planning artifact belongs to a Flowly issue. Naming one of these paths — even to whitelist it as an expected uncommitted change — is how the local file came back.');
  }

  report(errors, 'no local planning destination', `${files.length} command(s) name none of: ${FORBIDDEN_DESTINATIONS.join(', ')}`);
  return errors.length;
}

function checkSkillReferences(files, report) {
  const errors  = [];
  const onDisk  = skillsOnDisk();
  const named   = new Map();

  for (const { rel, parsed } of files) {
    if (!parsed.ok) continue;
    for (const skill of skillReferences(parsed.body)) {
      if (!named.has(skill)) named.set(skill, []);
      if (!named.get(skill).includes(rel)) named.get(skill).push(rel);
    }
  }

  let resolved = 0;
  let planned  = 0;
  for (const [skill, files_] of named) {
    if (onDisk.has(skill)) { resolved++; continue; }
    if (PLANNED_SKILLS.has(skill)) { planned++; continue; }
    errors.push(`${SKILL_NAMESPACE}:${skill} — no \`skills/${skill}/\` and no PLANNED_SKILLS entry (named by ${files_.join(', ')})`);
  }
  if (errors.length > 0) {
    errors.push('  ↳ fix the name, or add it to PLANNED_SKILLS in this script with the reason it does not exist yet. An agent following a dead reference finds nothing and improvises.');
  }

  // The other direction. Without it, PLANNED_SKILLS is a comment, and a comment
  // about an absence outlives the absence.
  const retired = [...PLANNED_SKILLS.keys()].filter(s => onDisk.has(s));
  for (const skill of retired) {
    errors.push(`${skill} now exists at skills/${skill}/ — delete its PLANNED_SKILLS entry`);
  }
  if (retired.length > 0) {
    errors.push('  ↳ the exemption has outlived the absence it excused. Removing it is what makes the next dead reference visible.');
  }

  report(
    errors,
    'every named skill resolves',
    `${named.size} skill(s) named — ${resolved} on disk, ${planned} declared planned`,
  );
  return errors.length;
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
      console.log(msg.startsWith('  ↳') ? `       ${msg}` : `       ERROR: ${msg}`);
    }
  };

  console.log('Lifecycle commands — commands/\n');

  if (!fs.existsSync(COMMANDS_DIR)) {
    console.error(`ERROR: no commands directory at ${COMMANDS_DIR}`);
    console.error('       Claude Code\'s default scan looks there, and the plugin manifest declares no `commands` key precisely so that scan is what registers them.');
    process.exit(1);
  }

  const present = walkMarkdown(COMMANDS_DIR, []);

  console.log(`  Namespace:  /${SKILL_NAMESPACE}:<command>`);
  console.log(`  Expected:   ${COMMANDS.length} command(s) — ${COMMANDS.join(', ')}`);
  console.log(`  Found:      ${present.length} markdown file(s) under commands/\n`);

  errorCount += checkCommandSet(present, report);

  // The remaining checks read the six the set is *supposed* to contain, so a
  // missing file is reported once by check 1 rather than again by every check
  // downstream of it.
  const files = [];
  for (const stem of COMMANDS) {
    const rel = `commands/${stem}.md`;
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    files.push({ rel, stem, parsed: splitFrontmatter(fs.readFileSync(abs, 'utf8')) });
  }

  errorCount += checkFrontmatter(files, report);
  errorCount += checkNoTokens(files, report);
  errorCount += checkRenderedSize(files, report);
  errorCount += checkCanonicalBlock(files, report);
  errorCount += checkModeBlock(files, report);
  errorCount += checkForbiddenDestinations(files, report);
  errorCount += checkSkillReferences(files, report);

  const status = errorCount > 0 ? 'FAILED' : 'PASSED';
  console.log(`\n${files.length} command(s) checked — ${errorCount} error(s) — ${status}`);

  if (errorCount > 0) process.exit(1);
}

// Surface unexpected failures (fs errors, an unreadable file, …) as a
// structured one-line CI error instead of an uncaught stack trace.
try {
  main();
} catch (err) {
  console.error(`\nERROR: check-commands failed unexpectedly: ${err.message}`);
  process.exit(1);
}
