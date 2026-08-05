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
  for (const [rel, contents] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), contents);
  }
  return root;
}

/**
 * Run a real `git` inside a fixture repository. Every call here is scoped to a
 * freshly-created temp directory by `cwd`, so nothing can reach a working tree
 * that matters.
 */
function git(root, ...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/**
 * A fixture that is a real repository.
 *
 * Gap 1 is a claim about ENUMERATION — that what the checker reads is what git
 * will publish — and no scratch directory can test it, because the whole point
 * is that git's answer differs from the filesystem's. So these fixtures are
 * `git init`ed for real. Nothing is committed: `git add` writes the index, and
 * the index is what `git ls-files --cached` reads, so no identity is needed.
 */
function gitSandbox(files, { symlinks = {}, force = [] } = {}) {
  const root = sandbox(files);
  git(root, 'init', '-q');
  for (const [rel, target] of Object.entries(symlinks)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.symlinkSync(target, path.join(root, rel));
  }
  git(root, 'add', '-A');
  for (const p of force) git(root, 'add', '-f', p);
  return root;
}

/**
 * `CI` is cleared by default. The sandboxes below are deliberately NOT
 * repositories — they exist to exercise the matchers, one document at a time —
 * and under CI the checker refuses to scan a non-repository at all, because a
 * silent fall back to the filesystem walk is how this gate would come to report
 * PASSED over a smaller set than the one that ships. The two tests that are
 * about that refusal set `CI` back explicitly.
 */
function run(root, env = {}) {
  return spawnSync(process.execPath, [CHECKER, '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, CI: '', ...env },
  });
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
  // Pinned to the FINDING line, not the word. A bare /unclosed fence/ is
  // satisfied by the remedy paragraph the checker prints after ANY violation —
  // so it stayed green when the closer's character check was deleted, which is
  // the one mutation this test exists to catch.
  assert.match(out, reportedAs(`${FENCE}bash`, 'unclosed fence'));
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
  assert.match(out, reportedAs(`${FENCE}typescript`, 'unclosed fence'));
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

test('a host that merely STARTS with an address is not that address', () => {
  // The address allowlist compares a WHOLE host. `127.0.0.1.<attacker>` only
  // begins with one, and an unanchored shape test hands it the loopback
  // allowance — an allowlist bypass wearing a trusted prefix, and the leak it
  // hides is a real host on somebody else's domain.
  //
  // Surfaced by mutation: dropping the `^…$` from the shared IPv4 shape
  // constant killed no test in this file and no probe in a 40k-line corpus.
  // Both call sites of that constant depend on the anchoring, so it needs a
  // reader of its own.
  refuses(`See ${url(dot(ip4(127, 0, 0, 1), 'evil', 'io'))}/mcp here.\n`, 'loopback-prefixed domain');
  refuses(`See ${url(dot(ip4(10, 0, 0, 1), 'attacker', 'io'))}/x here.\n`, 'and a private-range twin');
  allows(`Bind ${ip4(127, 0, 0, 1)} locally.\n`, 'while the address itself stays allowed');
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

// ── enumeration: what is scanned must be what ships ───────────────────────
//
// Every test above this line is about what the checker RECOGNISES. These are
// about what it READS, which is a different question and was answered by the
// filesystem: `readdirSync`, minus gitignored paths, minus symlinks. Each of
// those subtractions is a hole, because git's idea of what ships is not the
// filesystem's — and a hole here is invisible in the report, which says PASSED
// either way.

test('the enumeration mode is named in the output, in both directions', () => {
  // A silent fall back to the walk is the failure this whole section exists to
  // prevent: the gate would report PASSED while scanning a smaller set than the
  // one that ships. So the mode is printed, and both spellings are pinned —
  // asserting only the absence of the other would go green if the line vanished.
  const plain = run(sandbox({ 'docs/guide.md': 'ordinary prose\n' }));
  assert.match(plain.stdout, /^enumeration: filesystem-walk\b/m);
  assert.doesNotMatch(plain.stdout, /^enumeration: git ls-files\b/m);

  const repo = run(gitSandbox({ 'docs/guide.md': 'ordinary prose\n' }));
  assert.match(repo.stdout, /^enumeration: git ls-files\b/m);
  assert.doesNotMatch(repo.stdout, /^enumeration: filesystem-walk\b/m);
});

test('a gitignored file that is tracked anyway is scanned, because it ships', () => {
  // `git add -f .env.production` publishes the file. So does a tracked path
  // that a later `.gitignore` pattern starts matching. Under the filesystem
  // walk both were skipped unread, and the run reported them as `gitignored`
  // in the same breath as PASSED.
  const root = gitSandbox(
    {
      '.gitignore': 'secrets.md\n',
      'docs/guide.md': 'ordinary prose\n',
      'secrets.md': `Endpoint: ${url(INSTANCE)}/mcp\n`,
    },
    { force: ['secrets.md'] },
  );
  const out = run(root);
  assert.equal(out.status, 1, `a force-added file is public\n--- output ---\n${out.stdout}`);
  assert.match(out.stdout, /secrets\.md:1/);
});

test('and a gitignored file that is NOT tracked stays out of scope', () => {
  // The other half, and the reason the answer has to come from git rather than
  // from widening the walk. An ignored, untracked file does not ship; reporting
  // it would be the false positive that gets the gate switched off.
  const root = gitSandbox({ '.gitignore': 'secrets.md\n', 'docs/guide.md': 'prose\n' });
  fs.writeFileSync(path.join(root, 'secrets.md'), `Endpoint: ${url(INSTANCE)}/mcp\n`);
  const out = run(root);
  assert.equal(out.status, 0, `an untracked ignored file publishes nothing\n${out.stdout}`);
});

test('a symlink is read as its target text, which is what git stores', () => {
  // Git stores a symlink as a blob whose CONTENT is the target path. A link to
  // a home directory therefore publishes that path verbatim, in plain text, in
  // the object database. Following the link reads the wrong bytes; skipping it
  // — which is what the walk did — reads none at all.
  const target = abs('Users', USER, 'Projects', 'flowly', 'notes.md');
  const root = gitSandbox({ 'docs/guide.md': 'prose\n' }, { symlinks: { 'docs/notes.md': target } });
  const out = run(root);
  assert.equal(out.status, 1, `the target path IS the blob\n--- output ---\n${out.stdout}`);
  assert.match(out.stdout, new RegExp(`docs/notes\\.md:1`));
  assert.match(out.stdout, new RegExp(USER));
});

test('and an ordinary relative symlink is still clean', () => {
  const root = gitSandbox(
    { 'docs/guide.md': 'prose\n' },
    { symlinks: { 'docs/alias.md': '../docs/guide.md' } },
  );
  const out = run(root);
  assert.equal(out.status, 0, `a relative target discloses nothing\n${out.stdout}`);
});

test('CI cannot silently degrade to the filesystem walk', () => {
  // The sharp edge of switching enumerations. A fall back that reports PASSED
  // over a different, smaller set is worse than no check: it is the same green
  // with none of the coverage. In CI there is always a work tree, so a missing
  // one means the checkout or the working directory is wrong, and the only
  // safe answer is to refuse.
  const out = run(sandbox({ 'docs/guide.md': 'ordinary prose\n' }), { CI: 'true' });
  assert.equal(out.status, 1, `a non-repository under CI must not report PASSED\n${out.stdout}`);
  assert.match(out.stdout + out.stderr, /not a git work tree/i);
});

test('and a real repository under CI passes, on the git enumeration', () => {
  // The control. Without it the test above is satisfied by a checker that
  // refuses everything under CI.
  const out = run(gitSandbox({ 'docs/guide.md': 'ordinary prose\n' }), { CI: 'true' });
  assert.equal(out.status, 0, out.stdout);
  assert.match(out.stdout, /^enumeration: git ls-files\b/m);
});

test('--require-git says the same thing without an environment variable', () => {
  // CI is detected from the environment so that no workflow file has to change
  // for the guarantee to hold. The flag is the explicit form, for a wrapper
  // that wants the guarantee without pretending to be CI.
  const plain = spawnSync(
    process.execPath, [CHECKER, '--root', sandbox({ 'docs/guide.md': 'prose\n' }), '--require-git'],
    { encoding: 'utf8', env: { ...process.env, CI: '' } },
  );
  assert.equal(plain.status, 1, plain.stdout);
  assert.match(plain.stdout + plain.stderr, /not a git work tree/i);
});

// ── credentials ───────────────────────────────────────────────────────────
//
// The checker had no concept of a secret, and GitHub's push protection does not
// know Flowly's own token prefix. Same one-way door: a credential in a public
// commit is spent the moment it lands, and the only real remedy is rotation.
//
// FIXTURES — the same rule as the hosts above, one notch tighter. No literal
// token-shaped string appears in this file: a prefix is spelled as its parts
// and the body is GENERATED, so nothing written here is a string the rule it
// tests would refuse.
const pfx = (...parts) => parts.join('');
/**
 * A high-entropy body of `n` characters, built rather than typed. The step of 7
 * is coprime with the 36-character alphabet, so the result walks every
 * character before repeating any — which is what keeps these fixtures clear of
 * the low-entropy placeholder shapes the checker deliberately allows.
 */
const entropy = (n, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789') =>
  Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 5) % alphabet.length]).join('');
const upperEntropy = n => entropy(n, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');

test('refuses a credential of every shape the door hands out', () => {
  const tokens = [
    // Flowly's own two, which no third-party scanner has ever heard of.
    pfx('flo', '_', 'pat', '_') + entropy(32),
    pfx('flo', '_', 'oat', '_') + entropy(32),
    // GitHub: the four classic prefixes and the fine-grained form.
    pfx('ghp', '_') + entropy(36),
    pfx('gho', '_') + entropy(36),
    pfx('ghu', '_') + entropy(36),
    pfx('ghs', '_') + entropy(36),
    pfx('github', '_', 'pat', '_') + entropy(22) + '_' + entropy(59),
    // Anthropic and the OpenAI-style generic.
    pfx('sk', '-', 'ant', '-') + 'api03' + '-' + entropy(40),
    pfx('sk', '-') + entropy(48),
    // AWS long-term and temporary access key ids.
    pfx('AKIA') + upperEntropy(16),
    pfx('ASIA') + upperEntropy(16),
    // Slack, Google, GitLab, npm.
    ...['b', 'a', 'p', 'r', 's'].map(c => pfx('xox', c, '-') + entropy(12) + '-' + entropy(24)),
    pfx('AIza') + entropy(35),
    pfx('glpat', '-') + entropy(20),
    pfx('npm', '_') + entropy(36),
  ];
  for (const token of tokens) {
    const out = refuses(`Set the token to ${token} in your config.\n`, `${token.slice(0, 8)}… is a credential`);
    assert.match(out, /\[credential\]/);
  }
});

test('refuses a JWT, and allows the dotted things that are not one', () => {
  const jwt = [pfx('eyJ') + entropy(30), entropy(40), entropy(43)].join('.');
  refuses(`Authorization: Bearer ${jwt}\n`, 'a compact JWS is a bearer credential');
  allows('Upgrade to 4.17.21 and pin 1.2.3 in the lockfile.\n', 'a semver is three dotted segments');
  allows('Import org.springframework.boot.autoconfigure here.\n', 'so is a package name');
});

test('refuses a PEM private key block, and allows the public one', () => {
  const pem = key => ['-'.repeat(5), 'BEGIN ', key, 'PRIVATE KEY', '-'.repeat(5)].join('');
  for (const kind of ['', 'RSA ', 'EC ', 'DSA ', 'OPENSSH ', 'PGP ']) {
    refuses(`${pem(kind)}\n`, `a ${kind || 'bare'} private key header`);
  }
  const pub = ['-'.repeat(5), 'BEGIN ', 'PUBLIC KEY', '-'.repeat(5)].join('');
  allows(`${pub}\n`, 'a public key is published on purpose');
});

test('still allows a bare prefix written as teaching material', () => {
  // This is not hypothetical: this repository is a corpus of security skills,
  // and `skills/flowly-connect/SKILL.md` names both Flowly prefixes in a table
  // so a reader can tell which of three credentials they are holding. A rule
  // that fires on a prefix with no token behind it turns the repo red on its
  // own correct documentation, and a gate that cries wolf gets deleted.
  allows(`| A | OAuth | \`${pfx('flo', '_', 'oat', '_')}\` | nothing is copied |\n`, 'the shipped table');
  allows(`| B | issued by hand | \`${pfx('flo', '_', 'pat', '_')}\` | it is scoped |\n`, 'and its twin');
  allows(`A GitHub token starts with \`${pfx('ghp', '_')}\` today.\n`, 'a prefix is not a token');
  allows(`Access key ids begin ${pfx('AKIA')} or ${pfx('ASIA')} in AWS.\n`, 'same, uppercase');
  allows(`Anthropic keys carry the ${pfx('sk', '-', 'ant', '-')} prefix.\n`, 'same, hyphenated');
});

test('and still allows the ordinary words a prefix hides inside', () => {
  // `sk-` is the sharpest of these: it is a substring of thirty-odd real lines
  // in this tree — `planning-and-task-breakdown`, `risk-based`, `disk-backed`.
  // The left boundary and the entropy requirement both have to hold.
  allows('See planning-and-task-breakdown for the risk-based split.\n', 'sk- inside a word');
  allows('The disk-backed cache and the task-scoped context window.\n', 'and inside two more');
});

test('the entropy floor is a gate, not decoration', () => {
  // Surfaced by mutation: dropping each floor to one character killed no test,
  // because every control above happened to be either a BARE prefix (nothing
  // follows, so no floor is consulted) or a low-entropy placeholder (a
  // different rule catches it first). Neither reaches the floor.
  //
  // These do. `pipeline`, `prefix` and `token` all have more than four distinct
  // characters, so the placeholder rule does not apply to them, and each is a
  // perfectly ordinary identifier that a config file or a scanner rule would
  // contain. The only thing keeping them out of the report is LENGTH — so each
  // pair is the same prefix taken to both sides of its own floor.
  allows(`Name it "${pfx('sk', '-')}pipeline" in the config.\n`, 'eight characters is not a key');
  refuses(`Name it "${pfx('sk', '-')}${entropy(20)}" in the config.\n`, 'twenty of them is');

  allows(`The ${pfx('flo', '_', 'pat', '_')}prefix constant holds it.\n`, 'six is not a token');
  refuses(`The token is ${pfx('flo', '_', 'pat', '_')}${entropy(16)} here.\n`, 'sixteen is');

  allows(`Match the ${pfx('ghp', '_')}token variable in your scanner.\n`, 'five is not a token');
  refuses(`Match the ${pfx('ghp', '_')}${entropy(36)} value instead.\n`, 'thirty-six is');
});

test('and the left boundary is a second gate the floor does not subsume', () => {
  // Also surfaced by mutation: removing the boundary killed nothing, because
  // every `sk-`-inside-a-word fixture above is short enough that the floor
  // stops it anyway. That is an accident of those words. Kebab-case carries
  // long unbroken segments all the time — this repo's own directory names are
  // made of them — and once the tail passes twenty characters the floor has
  // nothing left to say. The boundary is what distinguishes a word from a
  // prefix, and it needs its own reader.
  allows('See the risk-basedprioritisationmatrix section.\n', 'a word that ends in sk-');
  refuses(`See ${pfx('sk', '-')}basedprioritisationmatrix instead.\n`, 'the same tail, at a boundary');
});

test('allows the placeholder spellings documentation actually uses', () => {
  // The other half of the entropy rule. A token-shaped string with no entropy
  // is a teaching device, not a credential, and every security guide is full of
  // them. `AKIAIOSFODNN7EXAMPLE` is AWS's own published example key.
  allows(`Set GITHUB_TOKEN=${pfx('ghp', '_')}${'x'.repeat(36)} in your shell.\n`, 'x-filled');
  allows(`AWS documents ${pfx('AKIA')}IOSFODNN7EXAMPLE as its example.\n`, 'the published example');
  allows(`Use ${pfx('flo', '_', 'pat', '_')}${'0'.repeat(32)} as a stand-in.\n`, 'zero-filled');
});

test('the report names the credential without reprinting it', () => {
  // A CI log is the one place a leaked secret is hardest to scrub, and this
  // check's whole output goes there. So the finding has to be actionable
  // without being a second copy: the prefix locates it, the length identifies
  // it, and the body stays out of the log.
  const body = entropy(36);
  const out = refuses(`token = ${pfx('ghp', '_')}${body}\n`, 'a real-shaped token');
  assert.match(out, /\[credential\]/);
  assert.match(out, new RegExp(esc(pfx('ghp', '_'))));
  assert.ok(!out.includes(body), `the body must not be echoed into the log\n${out}`);
});

test('a credential is refused wherever it lands, fence or source file', () => {
  // Unlike the bare-token rule, this one has no prose gate to earn. A secret in
  // a masked TypeScript fence, or in a `.ts` file, is exactly as published.
  const token = pfx('ghp', '_') + entropy(36);
  refuses(`${FENCE}typescript\nconst t = "${token}";\n${FENCE}\n`, 'a masked fence is not a shelter');
  refuses(`const t = "${token}";\n`, 'nor is a program-source extension', 'src/config.ts');
});
