#!/usr/bin/env node
/**
 * Tests for check-no-hosts.js.
 *
 * This is the only guard on an irreversible mistake — a hostname in a public
 * commit cannot be withdrawn — and it was the largest untested script in the
 * repo. The reason was structural, not neglect: it had no `--root` seam, so
 * there was no way to point it at a tree containing a deliberate leak. Adding
 * the seam every sibling check already had is what made this file possible.
 *
 * Every assertion is paired: a leak shape that must be REFUSED and, beside it,
 * the near-miss that must stay clean. A one-way-door check that reports
 * everything is as useless as one that reports nothing, because the first false
 * positive is when somebody deletes it from CI.
 *
 * NOTE ON FIXTURES. The checker scans this file too, and its header sets the
 * standard: a check that needs its own escape hatch to pass is a check nobody
 * trusts. So every host- and path-shaped fixture below is ASSEMBLED at runtime
 * rather than written as a literal. The checker still sees a real host — that
 * is the point — but this file stays clean under the rule it tests instead of
 * being excused from it by thirteen inline markers.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CHECKER = path.join(__dirname, 'check-no-hosts.js');

// ── assembled fixtures — see the note above ────────────────────────────────
const dot = (...labels) => labels.join('.');
const abs = (...segs) => `/${segs.join('/')}`;

const INSTANCE = dot('flowly', 'acmecorp', 'io');
const OTHER = dot('other', 'acmecorp', 'io');
const USER = 'somebody';
const internalHost = tld => dot('flowly', 'acmecorp', tld);
// Even with the host assembled, interpolating it straight after a literal
// scheme leaves a scheme-shaped string in THIS file's source, which the checker
// scans. So the scheme is concatenated too. (This comment was itself the last
// violation in the repo, which is the joke and also the point.)
const url = host => 'https' + '://' + host;

function sandbox(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-no-hosts-test-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [CHECKER, '--root', root], { encoding: 'utf8' });
}

/** Assert one document is refused, and say what should have caught it. */
function refuses(body, why, file = 'docs/guide.md') {
  const result = run(sandbox({ [file]: body }));
  assert.equal(result.status, 1, `${why}\n--- output ---\n${result.stdout}`);
  return result.stdout;
}

/** Assert one document is clean. The other half of every pair below. */
function allows(body, why, file = 'docs/guide.md') {
  const result = run(sandbox({ [file]: body }));
  assert.equal(result.status, 0, `${why}\n--- output ---\n${result.stdout}`);
  return result.stdout;
}

// ── positive controls ──────────────────────────────────────────────────────

test('the repository as checked in is clean, including this file', () => {
  const result = run(ROOT);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /0 violation\(s\) — PASSED/);
});

test('a sandbox with nothing host-shaped is clean', () => {
  allows('Just some ordinary prose about planning docs.\n', 'nothing here is a host');
});

test('fails rather than passing vacuously when no file is scanned', () => {
  const result = run(sandbox({}));
  assert.notEqual(result.status, 0, 'an empty tree must not report a clean bill of health');
});

// ── the scheme'd, port and bare forms ──────────────────────────────────────

test('refuses a scheme-qualified instance host', () => {
  const out = refuses(`Endpoint: ${url(INSTANCE)}/mcp\n`, 'a scheme names a host');
  assert.match(out, /acmecorp/);
});

test('refuses a host:port', () => {
  refuses(`Connect to ${INSTANCE}:8000 for MCP.\n`, 'host:port is a host');
});

test('refuses a bare host in prose', () => {
  refuses(`Your instance lives at ${INSTANCE} today.\n`, 'a bare token on a network TLD');
});

test('allows loopback, which names the reader machine and not ours', () => {
  allows('Run it at http://localhost:8000/mcp/ and open 127.0.0.1:3000.\n', 'RFC 6761 loopback');
});

test('allows the IETF reserved example names and their subdomains', () => {
  allows('See https://example.com and hooks.example.org and a.test.\n', 'RFC 2606 / 6761');
});

// ── internal-network TLDs ──────────────────────────────────────────────────

test('refuses an internal-network suffix, which is where a real instance lives', () => {
  for (const tld of ['internal', 'local', 'lan', 'intranet', 'corp', 'private']) {
    refuses(`Your instance is at ${internalHost(tld)} on the VPN.\n`, `${tld} is a host suffix`);
  }
});

test('still allows a dotted token whose suffix is not a network TLD', () => {
  // The TLD gate is what keeps the bare rule usable. These are the property
  // accesses the gate was measured against.
  // `.name` and `.click` are themselves real TLDs and correctly refused, so
  // the fixture uses suffixes that are not: the gate is a curated list, not a
  // guess about what looks like a property.
  allows('Read config.length and call handler.push on the element.\n', 'not network TLDs');
});

// ── fenced blocks: the shape a setup guide is made of ──────────────────────

test('refuses a bare host inside a shell or config fence', () => {
  const fences = [
    ['bash', `export FLOWLY_HOST=${INSTANCE}`],
    ['sh', `curl ${INSTANCE}/health`],
    ['yaml', `host: ${INSTANCE}`],
    ['toml', `endpoint = "${INSTANCE}"`],
    ['env', `FLOWLY_MCP_URL=${INSTANCE}`],
    ['json', `{"host": "${INSTANCE}"}`],
  ];
  for (const [lang, body] of fences) {
    refuses(`\`\`\`${lang}\n${body}\n\`\`\`\n`, `a bare host in a ${lang} fence`);
  }
});

test('still masks a program-source fence, where dotted identifiers are the idiom', () => {
  // The measured false positives that justified masking fences in the first
  // place. Narrowing the mask must not reintroduce them.
  const body = [
    '```typescript',
    "await page.getByRole('button', { name: /log in/i }).click();",
    'const label = element.name;',
    'logger.info("done");',
    '```',
  ].join('\n');
  allows(`${body}\n`, 'property access in a code fence is not a host');
});

test('a scheme inside a masked fence is still refused', () => {
  // Gate 1 only ever limited the BARE rule. The scheme'd matcher runs
  // everywhere, and that is what makes masking affordable.
  refuses(
    `\`\`\`typescript\nconst u = "${url(INSTANCE)}/mcp";\n\`\`\`\n`,
    'a scheme is checked in every fence',
  );
});

// ── workspace paths: the username is the disclosure ────────────────────────

test('refuses every prefix that precedes a username', () => {
  const paths = [
    abs('Users', USER, 'flowly'),
    abs('home', USER, 'flowly'),
    abs('root', USER, 'flowly'),
    abs('Volumes', 'Work', USER, 'flowly'),
    ['C:', 'Users', USER, 'flowly'].join('\\'),
  ];
  for (const p of paths) refuses(`The checkout lives at ${p} here.\n`, `${p} names a user`);
});

test('refuses the mangled hyphen form an agent harness produces', () => {
  // Scratch directories are named by flattening a path's slashes to hyphens,
  // so a pasted log path carries the username in a shape no slash-based
  // pattern can see. The agent writing these files runs from such a path.
  const mangled = ['', 'Users', USER, 'Projects', 'flowly'].join('-');
  const out = refuses(`Logs: /private/tmp/x/${mangled}/run.log\n`, 'the flattened form discloses it');
  assert.match(out, new RegExp(USER));
});

test('allows a repo-relative path and a root-level system path', () => {
  allows(
    'Edit scripts/check-no-hosts.js and see /usr/local/bin and /etc/hosts.\n',
    'no username in any of these',
  );
});

// ── the escape hatch ───────────────────────────────────────────────────────

test('the inline marker excuses exactly its own line', () => {
  const marker = ['check', 'no', 'hosts', 'allow'].join('-');
  allows(`Example host: ${INSTANCE} <!-- ${marker} -->\n`, 'the documented escape');
  refuses(
    [`Example host: ${INSTANCE} <!-- ${marker} -->`, `And another at ${OTHER} with none.`].join('\n'),
    'the marker must not excuse the next line too',
  );
});

// ── scope ──────────────────────────────────────────────────────────────────

test('scans every tree, not a chosen few', () => {
  // A leak is a leak wherever it lands. This goes red if someone narrows the
  // walk to the shipped skill trees.
  for (const rel of [
    'README.md',
    'docs/guide.md',
    'skills/x/SKILL.md',
    '.github/workflows/ci.yml',
    'evals/cases/x.json',
  ]) {
    refuses(`Instance: ${url(INSTANCE)}/mcp\n`, `${rel} is in scope`, rel);
  }
});

test('reports every violation in one run, not just the first', () => {
  const out = refuses(
    [
      `One at ${url(INSTANCE)}/mcp`,
      `Two at ${url(OTHER)}/mcp`,
      `Three under ${abs('Users', USER, 'flowly')}`,
    ].join('\n'),
    'whoever fixes this needs the full list',
  );
  assert.match(out, /3 violation\(s\)/);
});
