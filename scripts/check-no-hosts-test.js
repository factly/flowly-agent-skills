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
const ip4 = (...octets) => octets.join('.');
// `ip6('fd00', '', '42', '1')` → the `::`-elided form. An empty group is what
// produces the double colon, so the literal never appears in this source.
const ip6 = (...groups) => groups.join(':');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FENCE = '`'.repeat(3);

const INSTANCE = dot('flowly', 'acmecorp', 'io');
const OTHER = dot('other', 'acmecorp', 'io');
const APEX = dot('acmecorp', 'io');
const USER = 'somebody';
const internalHost = tld => dot('flowly', 'acmecorp', tld);
/** The exact report line the checker prints, so a test can pin what it named. */
const reportedAs = (text, kind) => new RegExp(`: ${esc(text)} {3}\\[${esc(kind)}\\]`);
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
  // `/root/` was on this list and is not any more — see the paired allow test
  // at the bottom of this file. It is the one prefix here with no per-user
  // segment to disclose, so it never met the rule these five are here for.
  const paths = [
    abs('Users', USER, 'flowly'),
    abs('home', USER, 'flowly'),
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

// ── boundaries: the characters a host is allowed to end and begin on ───────
//
// Each pair below is one shape that reached a public commit unseen, beside the
// near-miss that must stay clean. The misses share one cause: a boundary class
// written to keep the bare rule quiet was doing it by refusing to look.

test('refuses a bare host at the end of a sentence', () => {
  // The likeliest single miss in the file: prose ends in a full stop, and a
  // trailing boundary class containing `.` can never match a host followed by
  // one. Backtracking cannot rescue it — there is no shorter host to fall back
  // to whose next character is not also excluded.
  refuses(`Your instance is at ${INSTANCE}.\n`, 'a sentence ends in a period');
  refuses(`Your instance is at ${INSTANCE}. Ask ops for access.\n`, 'and mid-paragraph');
  refuses(`Your instance is at ${INSTANCE}.`, 'and with no trailing newline');
  refuses(`Is the instance ${INSTANCE}?\n`, 'and a question mark');
});

test('refuses the FQDN root form and reports it normalised', () => {
  // A trailing dot is the DNS root, not a continuation. It must be recognised
  // and then normalised away, so the report names a host a reader can grep for
  // rather than one with a stray dot no other line spells the same way.
  const out = refuses(`Resolve ${INSTANCE}. from the resolver.\n`, 'the root form is a host');
  assert.match(out, reportedAs(INSTANCE, 'bare host'));
});

test('a trailing dot is the DNS root in every matcher, not part of the host', () => {
  // Matcher 4 learns this above. Matchers 1 and 2 had the same bug, one in
  // each direction, and an adversarial sweep of legitimate prose is what
  // surfaced them:
  //
  //   scheme'd          captured the root dot INTO the authority, so the host
  //                     no longer equalled its allowlist entry and the checker
  //                     reported a reserved documentation name. A gate that
  //                     cries wolf on the most correct content there is gets
  //                     bypassed, which costs more than the miss it replaces.
  //   scheme-relative   excluded `.` from its terminator, so a real host at
  //                     the end of a sentence terminated nothing and vanished.
  //
  // Both directions are asserted, because fixing either one alone reads green.
  allows(`See ${url(dot('example', 'com'))}. It is reserved.\n`, 'allowlist survives the root dot');
  refuses(`Endpoint: ${url(INSTANCE)}.\n`, 'and a real host is still refused');
  allows(`See //${dot('example', 'com')}. It is reserved.\n`, 'scheme-relative, allowed twin');
  refuses(`Endpoint: //${INSTANCE}.\n`, 'scheme-relative, real host');
});

test('still allows a non-host dotted token at the end of a sentence', () => {
  // The other half. Narrowing the trailing boundary must not turn every
  // sentence-final word into a candidate; the TLD gate is what still holds.
  allows('Read config.length. Then call handler.push.\n', 'not network TLDs');
  allows(`See ${dot('example', 'com')}. It is reserved for documentation.\n`, 'still allowed');
});

test('refuses the wildcard-cert and cookie-domain spellings of a host', () => {
  // `*.<host>` on a certificate and `.<host>` in a Set-Cookie both disclose the
  // apex exactly as the bare form does. The leading boundary class excluded
  // both characters, so both were invisible.
  refuses(`The wildcard cert covers *.${APEX} today.\n`, 'a wildcard prefix is still a host');
  refuses(`Set the cookie domain to .${APEX} for all subdomains.\n`, 'a leading dot too');
});

test('still allows the dotfiles a leading dot used to protect by accident', () => {
  // These passed only because the boundary class refused to start after a dot.
  // Once it does, the label-count rule below is what has to keep them clean —
  // and `env.local` WITHOUT the leading dot proves the old protection was
  // never the real reason, because that spelling was already being refused.
  allows('Add .env.local and .claude/settings.local.json to .gitignore.\n', 'dotfiles');
  allows('Never commit secrets to env.local in the repo.\n', 'the same file, unprefixed');
});

// ── userinfo: `user@host` hid the host behind the boundary class ───────────

test('refuses a host reached through userinfo', () => {
  refuses(`Run: ssh deploy@${INSTANCE}\n`, 'ssh user@host names a host');
  refuses(`Mail ops@${internalHost('internal')} for access.\n`, 'an address at an internal TLD');
  refuses(`Run: ssh deploy@${INSTANCE}:2222\n`, 'userinfo in front of host:port');
  refuses(`Run: git clone git@${INSTANCE}:factly/flowly.git\n`, 'the scp-style git remote');
});

test('the userinfo is stripped from the report rather than named as a host', () => {
  // The checker already documents this policy for scheme'd URLs — reporting
  // `ci_user` as a host is noise that trains readers to ignore the check. The
  // bare and host:port matchers must reach the same conclusion.
  const bare = refuses(`Run: ssh deploy@${INSTANCE}\n`, 'still refused');
  assert.match(bare, reportedAs(INSTANCE, 'bare host'));
  const port = refuses(`Run: ssh deploy@${INSTANCE}:2222\n`, 'still refused');
  assert.match(port, reportedAs(`${INSTANCE}:2222`, 'host:port'));
});

test('still allows userinfo in front of an allowed host, and package scopes', () => {
  allows(`Mail someone@${dot('example', 'com')} for access.\n`, 'the host is what matters');
  allows('Install @types/node and @flowly/skills from the registry.\n', 'a scope is not a host');
});

// ── fences: the mask was an allowlist, so silence was the default ─────────

test('scans a fence whose tag is absent or is not a program source language', () => {
  // An untagged fence is the commonest form in this corpus and was entirely
  // outside the bare rule. So were every plain-text, infrastructure and
  // transcript tag — which is to say, most of what a setup guide is made of.
  const tags = [
    '', 'text', 'plaintext', 'txt', 'output', 'log', 'console-output',
    'terraform', 'hcl', 'docker-compose', 'powershell', 'apache', 'caddy',
    'kubernetes', 'helm', 'sql', 'curl', 'diff', 'ansible', 'systemd',
  ];
  for (const tag of tags) {
    refuses(
      `${FENCE}${tag}\nexport FLOWLY_HOST=${internalHost('internal')}\n${FENCE}\n`,
      `a bare host in a ${tag || '(untagged)'} fence`,
    );
  }
});

test('still masks a fence tagged with a program-source language', () => {
  // The measured false positives that justified the mask in the first place.
  // Inverting the list must not reintroduce them, and `.name` is a real TLD,
  // so this fixture is refused the moment the mask stops applying.
  const langs = [
    'typescript', 'ts', 'tsx', 'javascript', 'js', 'jsx', 'python', 'py',
    'ruby', 'rb', 'rust', 'rs', 'go', 'golang', 'java', 'php', 'c', 'cpp',
    'c++', 'csharp', 'cs', 'swift', 'kotlin', 'kt',
  ];
  for (const lang of langs) {
    allows(
      `${FENCE}${lang}\nconst label = element.name;\n${FENCE}\n`,
      `property access in a ${lang} fence is not a host`,
    );
  }
});

test('the program-source mask is what allows that, and nothing else', () => {
  // The pair above is vacuous unless the SAME fixture is refused when the mask
  // does not apply. `.name` is a real TLD, so this fixture is a host to the
  // bare rule; the only thing standing between it and a violation is the fence
  // tag. Assert both directions or the mask could be a no-op and read as green.
  const body = `${FENCE}%TAG%\nconst label = element.name;\n${FENCE}\n`;
  allows(body.replace('%TAG%', 'typescript'), 'program source is masked');
  refuses(body.replace('%TAG%', ''), 'an untagged fence is not');
  refuses(body.replace('%TAG%', 'text'), 'and neither is a plain-text one');
});

test('refuses a host:port reached through userinfo where only that matcher can see it', () => {
  // Inside a masked fence the bare rule is off, so matchers 1-3 are the only
  // thing left. Without this the userinfo fix for `host:port` is untested:
  // in prose the bare matcher catches the same line and hides the gap.
  const out = refuses(
    `${FENCE}typescript\nconst cmd = "ssh deploy@${INSTANCE}:2222";\n${FENCE}\n`,
    'host:port runs in every fence',
  );
  assert.match(out, reportedAs(`${INSTANCE}:2222`, 'host:port'));
});

test('refuses a fence closed with the other fence character', () => {
  // CommonMark says a fence closes only on its own character, so this block is
  // genuinely unclosed and masks everything after it. The fix is to report it,
  // not to loosen the closer rule — accepting `~~~` as a closer for ``` would
  // make the checker disagree with every Markdown renderer about where the
  // block ends, which is a worse kind of wrong on a masking decision.
  const out = refuses(
    [`${FENCE}bash`, 'echo hi', '~~~', `And the instance is at ${INSTANCE}.`, ''].join('\n'),
    'a mismatched closer leaves the fence open',
  );
  assert.match(out, /unclosed fence/);
});

test('refuses an unclosed fence, which silently masks the rest of the file', () => {
  // An opener with no closer masks every line after it to end of file. In a
  // corpus of hundreds of fences that is an ordinary editing accident, and it
  // is indistinguishable from a clean file in the report. Naming it is what
  // makes the accident survivable: the run goes red for the fence, the author
  // closes it, and the next run can see whatever the mask was hiding.
  const out = refuses(
    [`${FENCE}typescript`, 'const a = 1;', ''].join('\n'),
    'a fence that never closes',
  );
  assert.match(out, /unclosed fence/);
});

test('a properly closed fence is not a violation, in either fence character', () => {
  allows([`${FENCE}typescript`, 'const a = 1;', FENCE, ''].join('\n'), 'backtick fence');
  allows(['~~~typescript', 'const a = 1;', '~~~', ''].join('\n'), 'tilde fence');
  allows(
    ['`'.repeat(4) + 'markdown', `${FENCE}bash`, 'echo hi', FENCE, '`'.repeat(4), ''].join('\n'),
    'a longer fence legitimately wraps a shorter one',
  );
});

// ── IP literals: an address is a host with no name ────────────────────────

test('refuses a bare IP literal in prose', () => {
  // A private address is not less of a disclosure than a public one: it names
  // a machine on a network someone can reach, and it is the likelier spelling
  // in an internal setup note.
  refuses(`The box is at ${ip4(10, 42, 7, 19)} on the VPN.\n`, 'RFC 1918 is a deployment');
  refuses(`The box is at ${ip4(172, 20, 5, 8)} on the VPN.\n`, 'the 172.16/12 block');
  refuses(`The box is at ${ip4(192, 168, 1, 50)} behind the router.\n`, 'the 192.168/16 block');
  refuses(`The API is at ${ip4(52, 91, 14, 203)} in the region.\n`, 'a routable address');
  refuses(`Reach ${ip6('fd00', '', '42', '1')} over the tunnel.\n`, 'a unique-local IPv6');
  refuses(`Reach ${ip6('fe80', '', '1', '2')} over the link.\n`, 'a link-local IPv6');
});

test('still allows the documentation, loopback and metadata addresses', () => {
  // Widening to IP literals without these turns the repo red on correct
  // content, and a gate that cries wolf gets bypassed rather than fixed.
  allows(
    `Use ${ip4(192, 0, 2, 10)}, ${ip4(198, 51, 100, 4)} and ${ip4(203, 0, 113, 9)} in docs.\n`,
    'RFC 5737 exists so documentation can name an address',
  );
  allows(`Use ${ip6('2001', 'db8', '', '1')} in documentation.\n`, 'RFC 3849, the IPv6 twin');
  allows(`Bind ${ip4(127, 0, 0, 1)} and ${ip6('', '', '1')} locally.\n`, 'loopback names the reader');
  allows(
    `Block ${ip4(169, 254, 169, 254)} to stop SSRF against cloud metadata.\n`,
    'the canonical metadata address — naming it IS the security advice',
  );
  allows(
    `Netmask ${ip4(255, 255, 255, 0)}, wildcard ${ip4(0, 0, 0, 0)}.\n`,
    'an all-0/all-255 quad is a mask, not a machine',
  );
  allows('Upgrade to 4.17.21 and pin 1.2.3 in the lockfile.\n', 'a semver is not an address');
});

// ── internal-network suffixes: usable, or it gets switched off ────────────

test('still allows a single label in front of an internal-network suffix', () => {
  // These are the shapes the internal TLDs collide with, all already in this
  // tree as correct security advice. One label in front of `.internal` is a
  // property access or a dotfile; a deployment has a name AND a company.
  allows('Read options.internal and fields.private from the payload.\n', 'property access');
  allows('Reach raspberrypi.local over mDNS.\n', 'a bare machine name is not a deployment');
  allows('Set config.corp and state.lan on the object.\n', 'more property access');
});

test('generic infrastructure names that identify no deployment are allowed', () => {
  // A new allowlist class, on the same argument as loopback: these resolve to
  // whatever machine or cluster runs the command, so naming them discloses
  // nothing about ours.
  allows(`Use ${dot('host', 'docker', 'internal')} from inside the container.\n`, 'Docker Desktop');
  allows(`Call ${dot('api', 'default', 'svc', 'cluster', 'local')} for the service.\n`, 'k8s DNS');
  allows(`Call ${dot('flowly', 'prod', 'svc', 'cluster', 'local')} too.\n`, 'any k8s service name');
});

test('and that allowance is exact, not a licence for the whole suffix', () => {
  // Without this pair the entry above is a hole shaped like a hostname.
  refuses(`Use ${dot('flowly', 'acmecorp', 'docker', 'internal')} today.\n`, 'not the Docker name');
  refuses(`Use ${dot('flowly', 'acmecorp', 'cluster', 'local')} today.\n`, 'not the service form');
});

// ── /root/ names no user, so it is not a disclosure ──────────────────────

test('allows a path under /root, which contains no username', () => {
  // The pattern's own rationale is that what leaks is the USERNAME. `root` is
  // identical on every machine, and these paths are standard in the CI
  // documentation this repo ships.
  allows(`Mount ${abs('root', '.cache')} for the build cache.\n`, 'root is not a username');
  allows(`Mount ${abs('root', '.cargo', 'registry')} in CI.\n`, 'standard CI documentation');
});
