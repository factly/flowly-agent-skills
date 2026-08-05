#!/usr/bin/env node
/**
 * check-no-hosts.js — refuse to ship a hostname or an absolute workspace path.
 *
 * WHY THIS IS A ONE-WAY DOOR
 * --------------------------
 * This repository is public from its first push. A hostname that reaches a
 * public commit cannot be withdrawn: rewriting history does not scrub forks,
 * caches or archives, and making a repository private later does not unpublish
 * what was already fetched. GitHub's push protection does not help — it matches
 * *credential* patterns, so an instance hostname of the form
 * <instance>.<company>.<tld> sails straight through it. This check is the only
 * thing between an instance hostname and a permanent public commit.
 *
 * Everything else about this fork is recoverable. This is not. That asymmetry
 * is why the PERMISSION model is an allowlist: once a string is recognised as a
 * host, it is refused unless it appears in ALLOWED_HOSTS, so a hostname nobody
 * anticipated is refused by default.
 *
 * Be precise about what that does and does not buy, because it is easy to
 * over-trust. The allowlist decides which RECOGNISED hosts are permitted. What
 * counts as recognised is decided separately, by the matchers below, and those
 * are a curated denylist of shapes: a fixed set of schemes, a curated TLD list,
 * IP literals, `host:port`. A host in a shape nobody anticipated is not refused
 * by default — it is not seen at all, and the run goes green. Every miss this
 * check has ever had has been of that second kind, so when you extend it,
 * extend the RECOGNIZER; adding to ALLOWED_HOSTS never closes a hole.
 *
 * Also refused: absolute workspace paths — the macOS, Linux and Windows
 * per-user home prefixes, each followed by a username. Same one-way door, and
 * it is the likelier accident, because the agent authoring these files is
 * itself running from such a path. (The acceptance names hostnames; workspace
 * paths are a deliberate addition on the same rationale.)
 *
 * NOTE: this file must stay clean under its own rules — the check that needs
 * its own escape hatch to pass is a check nobody trusts. That is why the
 * examples in these comments use <angle-bracket> placeholders instead of
 * host-shaped literals.
 *
 * SCOPE
 * -----
 * Every file in the repo, walked from the filesystem, minus:
 *   - `.git/`
 *   - anything matching `.gitignore` (a deliberately simple matcher — see
 *     `loadGitignore`; it covers the pattern forms this repo actually uses)
 *   - binary files (detected by a NUL byte in the first 8 KiB)
 *
 * ESCAPE HATCH — AND WHEN IT IS LEGITIMATE
 * ----------------------------------------
 * Put the marker `check-no-hosts-allow` in a comment on the offending line and
 * that line is skipped.
 *
 * This exists because an un-escapable check is a check that gets deleted. The
 * first time someone hits a false positive on a deadline, they either reach for
 * a documented one-line escape or they delete the check from CI — and the
 * second outcome silently removes the only guard on an irreversible mistake.
 * A visible, greppable marker keeps the exception in the diff where a reviewer
 * sees it.
 *
 * Legitimate uses: a genuinely public documentation host that belongs in one
 * file only and is not worth a global allowlist entry; a regex or test fixture
 * that must contain a host-shaped string in order to test host handling.
 *
 * NOT legitimate: silencing a real instance hostname. If the marker is being
 * added next to something that identifies a deployment, the fix is to remove
 * the hostname, not to annotate it. Prefer adding to ALLOWED_HOSTS over the
 * inline marker when the host is public documentation used in several places —
 * the allowlist is reviewable in one screen, scattered markers are not.
 *
 * Exit codes: 0 = clean, 1 = one or more violations (all are reported, not
 * just the first — whoever fixes this needs the full list from one run).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// `--root <dir>` scans another tree. Every sibling check here has this seam;
// this one did not, and that is the whole reason it was the largest untested
// script in the repo — there was no way to point it at a tree containing a
// deliberate leak. A guard on a one-way door that cannot be exercised is a
// guard nobody has watched work.
function parseRoot(argv) {
  const i = argv.indexOf('--root');
  return i === -1 ? REPO_ROOT : path.resolve(argv[i + 1]);
}

// ─── Allowlist ───────────────────────────────────────────────────────────────
//
// Every entry is a host that is safe in a public commit. Grouped by WHY it is
// allowed, because the reason is what a future reader needs in order to decide
// whether a new entry belongs. Compared case-insensitively.
//
// Adding an entry is a deliberate act: it must fall into one of these classes.
// A host that identifies a Flowly deployment falls into none of them.

const ALLOWED_HOSTS = new Set([
  // ── Class 1: public documentation and vendor sites ────────────────────────
  // Stable, publicly-resolvable documentation that the skills cite as sources.
  // These identify a vendor's docs, never a deployment of ours.
  'github.com',              // also required by MIT attribution — NOTICE.md names the upstream repo
  'docs.github.com',
  'google.github.io',
  'react.dev',
  'developer.chrome.com',
  'code.visualstudio.com',
  'docs.cursor.com',
  'modelcontextprotocol.io',
  'json.schemastore.org',
  'docs.npmjs.com',
  'pnpm.io',
  'yarnpkg.com',
  'abseil.io',
  'genai.owasp.org',
  'claude.ai',
  'developer.mozilla.org',
  'docs.djangoproject.com',
  'html.spec.whatwg.org',
  'caniuse.com',
  'nextjs.org',
  'symfony.com',
  'web.dev',
  'pagespeedonline.googleapis.com',
  'agentskills.io',          // the Agent Skills open standard, cited by validate-standard.sh

  // ── Class 2: RFC 2606 / RFC 6761 reserved example names ───────────────────
  // Reserved by the IETF precisely so documentation can use them. They can
  // never belong to a real deployment, so they carry no disclosure risk.
  // Subdomains of these are allowed too — see isAllowedHost.
  'example.com',
  'example.net',
  'example.org',

  // ── Class 3: documentation placeholders ───────────────────────────────────
  // Obvious non-hosts that exist to be substituted by the reader. They are
  // allowed for the same reason as Class 2 — they name nothing real — but they
  // are listed apart because they are conventions, not standards.
  'yourdomain.com',
  'app.yourdomain.com',

  // ── Class 4: loopback ─────────────────────────────────────────────────────
  // Not instance-specific by construction: they resolve to whatever machine
  // runs the command. A skill that teaches connecting to a locally-running
  // Flowly needs to name them, and naming them discloses nothing.
  'localhost',
  '127.0.0.1',
  '::1',
  '::',
  '0.0.0.0',

  // ── Class 5: generic infrastructure names ─────────────────────────────────
  // Same argument as Class 4, one level out: these are fixed names defined by a
  // tool or an orchestrator, identical on every installation, and they resolve
  // to whatever machine or cluster runs the command. They identify no
  // deployment of ours.
  //
  // They earn an entry rather than a rule because the internal-network TLDs are
  // exactly where a real leak lives, and each of these sits one keystroke from
  // that shape. An entry is reviewable in one screen; a rule broad enough to
  // cover them would be broad enough to cover `flowly.<company>.internal`.
  'host.docker.internal',    // Docker Desktop's documented name for the host
  'gateway.docker.internal', // and its documented name for the gateway
  'kubernetes.default.svc',  // the in-cluster API server, identical everywhere
]);

// Suffixes under which ANY subdomain is allowed. Only IETF-reserved names
// belong here: RFC 2606 sets these aside so documentation can use them, and
// RFC 6761 does the same for `.localhost` and `.test`. They cannot be
// registered, so no subdomain of them can identify a real deployment —
// `hooks.example.com` in an example snippet is as safe as `example.com`.
const ALLOWED_HOST_SUFFIXES = [
  '.example.com',
  '.example.net',
  '.example.org',
  '.example',
  '.test',
  '.invalid',
  '.localhost',
  // Class 5 (see above), as a suffix because the part that varies is the part
  // that names no deployment of ours: Kubernetes service DNS is
  // `<service>.<namespace>.svc.cluster.local` on EVERY cluster, so the whole
  // name is a function of names the reader chose, not of where we run. The
  // narrower `.svc.cluster.local` is deliberate — plain `.cluster.local` would
  // also cover node and pod records, which do carry cluster-specific detail.
  '.svc.cluster.local',
];

// Paths (relative to the repo root) excluded wholesale. Empty today, and it
// should stay that way: an excluded path is an unguarded path. Prefer the
// inline marker so the exception sits on the line it excuses.
const EXCLUDED_PATHS = [];

/**
 * Addresses that name no machine of ours. Recognising bare IP literals without
 * this turns the repo red on content that is not merely harmless but correct —
 * and a gate that cries wolf is a gate that gets bypassed, which on a one-way
 * door costs more than the misses it was widened to catch.
 *
 * Note what is NOT here: the RFC 1918 private ranges. A private address is
 * still a machine somebody can reach, and `10.x` in an internal setup note is
 * the likelier spelling of exactly the leak this check exists to stop.
 */
function isAllowedAddress(host) {
  // ── IPv6 ──
  // RFC 3849 reserves 2001:db8::/32 for documentation, the IPv6 twin of the
  // RFC 5737 blocks below. Both spellings of the second group are accepted.
  if (/^2001:0?db8:/.test(host) || /^2001:0?db8::/.test(host)) return true;

  // ── IPv4 ──
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const octets = host.split('.').map(Number);
  if (octets.some(n => n > 255)) return false;

  // A quad of only 0s and 255s is a mask, a wildcard bind or a broadcast
  // address — a shape, not a machine. This generalises the `0.0.0.0` entry in
  // Class 4 to the netmasks that appear beside it in networking documentation.
  if (octets.every(n => n === 0 || n === 255)) return true;

  // Loopback is the whole 127.0.0.0/8, not just the one canonical address:
  // it resolves to whatever machine runs the command (Class 4's argument).
  if (octets[0] === 127) return true;

  // RFC 5737 — reserved for documentation, so they can never be a deployment.
  const [a, b, c] = octets;
  if (a === 192 && b === 0 && c === 2) return true;        // 192.0.2.0/24
  if (a === 198 && b === 51 && c === 100) return true;     // 198.51.100.0/24
  if (a === 203 && b === 0 && c === 113) return true;      // 203.0.113.0/24

  // The cloud instance-metadata address. Identical on every cloud provider and
  // every instance, so it identifies nothing — and naming it IS the security
  // advice, because it is the canonical SSRF target that must be blocked.
  // Verified present and correct in skills/security-and-hardening/SKILL.md.
  if (host === '169.254.169.254') return true;

  // The rest of link-local (169.254.0.0/16) is deliberately NOT allowed: only
  // the fixed metadata address is generic, the others are per-machine.
  return false;
}

function isAllowedHost(host) {
  if (ALLOWED_HOSTS.has(host)) return true;
  if (ALLOWED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))) return true;
  return isAllowedAddress(host);
}

// The inline escape hatch. See the header for when it is legitimate.
const ALLOW_MARKER = 'check-no-hosts-allow';

// ─── Host grammar ────────────────────────────────────────────────────────────

// Schemes whose authority component is, by definition, a network host. For
// these, a single-label authority is still a host and must be checked —
// internal hostnames are frequently a single label with no dot at all, and
// skipping them would open the exact hole this check exists to close.
const NETWORK_SCHEMES = new Set([
  'http', 'https', 'ws', 'wss', 'ftp', 'ftps', 'sftp', 'ssh', 'git',
  'postgres', 'postgresql', 'mysql', 'mariadb', 'redis', 'rediss', 'mongodb',
  'amqp', 'amqps', 'smtp', 'imap', 'ldap', 'ldaps', 'grpc', 'rtsp',
]);

/**
 * The internal-network suffixes, and how many labels must precede one before
 * the token is treated as a host.
 *
 * These are the canonical names for exactly the host this check exists to stop:
 * a Flowly instance on a company network is far likelier to be
 * `flowly.<company>.internal` than anything on a public TLD. But unlike every
 * public TLD, they are also ordinary English words that appear as the last
 * segment of a property access or a filename — all of which are already in this
 * tree as correct content:
 *
 *     options.internal   fields.private   config.corp   ← property access
 *     .env.local         settings.local   raspberrypi.local
 *
 * One label in front of `.internal` is a property or a dotfile. A deployment has
 * a name AND an organisation, so it has at least two: `flowly.<company>.
 * internal` survives this gate and `options.internal` does not.
 *
 * Note how the collision surfaced. Six near-misses in this tree (`.env.local`,
 * `.claude/settings.local.json`) were passing only because the leading boundary
 * refused to start after a dot — an accident, not a rule, and one that stopped
 * protecting them the moment the boundary was fixed to see `*.<host>` and
 * `.<host>`. The same string written WITHOUT the leading dot was already being
 * refused, which is the tell: whatever was keeping them quiet, it was not a
 * judgement about what they are.
 */
const INTERNAL_TLDS = new Set(['internal', 'local', 'lan', 'intranet', 'corp', 'private']);
const MIN_LABELS_BEFORE_INTERNAL_TLD = 2;

function isHostShapedForTld(host, tld) {
  if (!INTERNAL_TLDS.has(tld)) return true;
  return host.split('.').length > MIN_LABELS_BEFORE_INTERNAL_TLD;
}

// TLDs used to recognise a BARE dotted token (no scheme, no port) as a host.
//
// THE BARE-TOKEN RULE — TWO GATES, BOTH MEASURED
// -----------------------------------------------
// `react.dev` appears in prose with no scheme, so a check that only understood
// URLs would miss the plainest way to type a hostname. But "any dotted word is
// a host" is unusable: it fires on `package.json`, `.env.local`, `README.md`
// and every filename in the tree. That false-positive load is not a cosmetic
// problem — it is how a check gets switched off, which costs far more than the
// misses. Two gates keep it usable.
//
// GATE 1 — prose only. Measured against this tree, the split is clean: every
// false positive was a property access inside a fenced code block
// (`<obj>.name`, `<obj>.click`, `<logger>.info`), and every true positive was a
// host in prose (`<vendor-docs-host>`, `<framework-site>`). So the bare rule is
// applied to prose only: fenced code blocks in Markdown are masked out, and
// program-source files are skipped entirely (see BARE_RULE_SKIP_EXTENSIONS).
// This gate costs nothing in coverage that matters, because a hostname inside
// code is essentially always reached through a scheme or a port, and layers
// 1-3 below cover those in every file with no TLD restriction at all.
//
// GATE 2 — a curated TLD list. A bare token is a host only when its final label
// is in this list of network TLDs. The list deliberately EXCLUDES every TLD
// that is also a common source-file extension, even though each exclusion is a
// real coverage gap:
//
//     .md (Moldova)   → README.md          .sh (St Helena) → *.sh scripts
//     .py (Paraguay)  → Python             .rs (Serbia)    → Rust
//     .pl (Poland)    → Perl               .ml (Mali)      → OCaml
//     .tf (Fr. S. T.) → Terraform          .cc (Cocos Is.) → C++
//     .so (Somalia)   → shared objects     .mm (Myanmar)   → ObjC++
//     .config, .zip, .mov                  → config dirs, archives, video
//
// Those gaps are bounded and acceptable because they are gaps in the BARE form
// only. The scheme'd, scheme-relative and host:port matchers below accept ANY
// TLD, so all three of those forms are still caught on an excluded TLD. Only a
// bare token on an excluded TLD, typed into prose, slips through — and the
// hostnames this check exists to stop (a deployed Flowly instance) do not live
// on file-extension TLDs.
const BARE_TOKEN_TLDS = new Set([
  // generic
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'name',
  'pro', 'mobi', 'asia', 'jobs', 'travel',
  // modern generic — where a hosted product most plausibly lives
  'io', 'ai', 'co', 'dev', 'app', 'cloud', 'tech', 'site', 'online', 'xyz',
  'store', 'shop', 'blog', 'wiki', 'news', 'live', 'life', 'world', 'today',
  'space', 'website', 'digital', 'systems', 'solutions', 'network', 'host',
  'press', 'click', 'link', 'one', 'top', 'page', 'run', 'team', 'works',
  'zone', 'agency', 'studio', 'design', 'software', 'computer', 'services',
  // country-code, common in hosting, minus every file-extension collision
  'uk', 'us', 'ca', 'au', 'de', 'fr', 'jp', 'cn', 'in', 'ru', 'br', 'nl',
  'se', 'no', 'fi', 'dk', 'es', 'ch', 'at', 'be', 'nz', 'za', 'kr', 'ar',
  'cl', 'ie', 'pt', 'gr', 'cz', 'hu', 'ro', 'il', 'sg', 'hk', 'tw', 'th',
  'my', 'ph', 'vn', 'tr', 'ua', 'eu', 'tv', 'me', 'gg', 'fm', 'im', 'ws',
  // internal-network suffixes — see INTERNAL_TLDS above for why these need a
  // label-count gate that the public TLDs do not. Spread rather than repeated,
  // so the gate and the TLD list can never disagree about which six they are.
  ...INTERNAL_TLDS,
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

// An IPv4 literal with every octet in range. The range check is what keeps
// `999.1.1.1` and most version-shaped quads out; a four-part version string is
// genuinely indistinguishable from an address, and this errs toward reporting.
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_LITERAL = `${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}`;

/**
 * Is this token an IPv6 literal?
 *
 * Matched in two stages — a coarse hex-and-colon regex, then this — because the
 * one-regex version is unreadable and the interesting judgement is not a shape
 * question. `dead::beef` is a valid IPv6 literal AND a C++/Rust path, and the
 * hex alphabet is exactly the letters those words are made of. The tiebreak
 * that works on real corpora: every documented address contains a DIGIT
 * (`fd00::`, `fe80::`, `2001:db8::`), while an all-alpha hex word is a
 * namespace far more often than an address.
 */
function isIpv6Literal(token) {
  if (!/^[0-9a-f:]+$/.test(token)) return false;
  if (!/[0-9]/.test(token)) return false;
  const elisions = token.split('::').length - 1;
  if (elisions > 1) return false;
  const groupsAreHex = gs => gs.every(g => /^[0-9a-f]{1,4}$/.test(g));
  if (elisions === 0) {
    const groups = token.split(':');
    return groups.length === 8 && groupsAreHex(groups);
  }
  const [head, tail] = token.split('::');
  const groups = [...(head ? head.split(':') : []), ...(tail ? tail.split(':') : [])];
  return groups.length <= 7 && groupsAreHex(groups);
}

// Program-source extensions where the bare-token rule is skipped: dotted
// identifiers (`<obj>.name`) are the norm there and would drown the report.
// Config and data formats are deliberately NOT in this list — a bare host in a
// workflow file or a JSON config is a real leak vector and stays in scope.
const BARE_RULE_SKIP_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.java',
  '.rs', '.php', '.c', '.h', '.cc', '.cpp', '.cs', '.swift', '.kt',
]);

/**
 * Line indices (0-based) that fall inside a fenced code block, so the
 * bare-token rule can be limited to prose. The fence line itself is included:
 * an info string such as ```bash is not prose either.
 */
/**
 * Fence languages where the bare-token rule STOPS applying.
 *
 * This is a denylist, and the inversion is the point. Gate 1 masks fenced
 * blocks because the false positives it was measured against were property
 * accesses in program source — `<obj>.name`, `<logger>.info`. That reasoning is
 * about a LANGUAGE, not about a fence: in a shell transcript, a config snippet
 * or a plain-text block, a dotted token ending in a network TLD is a hostname
 * essentially every time, and dotted property access is not the idiom.
 *
 * Listing the languages to SCAN got this backwards, and did so in exactly the
 * way the header warns about one level up: a name nobody anticipated — an
 * unknown tag, or no tag at all — was masked by default. Measured against the
 * `.md` files in this tree, the untagged fence is the single commonest form
 * (150 of 322 openers) and was entirely outside the bare rule, along with every
 * `text`, `output`, `log`, `terraform`, `sql`, `diff` and `powershell` block.
 * Those are what a setup guide is MADE of, and `export FLOWLY_HOST=…` inside
 * one is the likeliest shape a real leak takes here.
 *
 * So: mask the program-source languages and scan everything else, so an unknown
 * or absent tag is SCANNED. The set is derived from BARE_RULE_SKIP_EXTENSIONS
 * rather than written out, because that is the set Gate 1 was actually measured
 * against and the two must not drift apart. The aliases beside it are the names
 * those same languages go by in a fence info string, which is the only reason
 * the list is not simply the extensions.
 *
 * Gate 2 still applies inside every scanned block, so a token must still end in
 * a curated network TLD to be reported at all.
 */
const MASKED_FENCE_LANGUAGES = new Set([
  ...[...BARE_RULE_SKIP_EXTENSIONS].map(ext => ext.slice(1)),
  'javascript', 'typescript', 'python', 'ruby', 'rust', 'golang',
  'csharp', 'c#', 'cpp', 'c++', 'objective-c', 'objc', 'kotlin',
]);

/**
 * Which lines are masked from the bare-token rule, and whether a fence was left
 * open at end of file.
 *
 * An unmatched opener masks every line after it to EOF, silently: nothing in
 * the report distinguishes that file from a clean one. In a corpus of hundreds
 * of fences an unclosed fence is an ordinary editing accident, so the caller
 * reports it as a violation. That is what makes the accident survivable — the
 * run goes red for the fence, the author closes it, and the next run can see
 * whatever the mask was hiding.
 *
 * The mask is deliberately still applied over the unclosed region. Scanning it
 * instead would be the other fail-safe choice, but it would unleash the exact
 * property-access false positives Gate 1 exists to suppress, on a file whose
 * only real problem is a missing line. Refusing the file gets to the same
 * place in one more round, without teaching anyone to ignore the output.
 */
function fencedLineSet(lines) {
  const fenced = new Set();
  let open = null;
  let openedAt = -1;
  let scanning = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)/);
    if (open === null) {
      if (m) {
        open = m[1][0].repeat(m[1].length);
        openedAt = i;
        // A program-source block is masked; every other block, tagged or not,
        // stays in scope for the bare rule.
        scanning = !MASKED_FENCE_LANGUAGES.has(m[2].toLowerCase());
        fenced.add(i);
      }
    } else {
      if (!scanning) fenced.add(i);
      if (m && m[1][0] === open[0] && m[1].length >= open.length) {
        fenced.add(i);
        open = null;
        openedAt = -1;
        scanning = false;
      }
    }
  }
  return { fenced, unclosedAt: open === null ? -1 : openedAt };
}

// ─── Matchers ────────────────────────────────────────────────────────────────

/**
 * Normalise an authority component (`user:pass@host:port`) down to a bare
 * lowercase host. Userinfo is stripped rather than reported: a connection
 * string such as `postgresql://ci_user:${SECRET}@localhost:5432/db` has the
 * host `localhost`, and reporting `ci_user` as a host would be noise that
 * trains readers to ignore this check.
 */
/**
 * A `<userinfo>@` prefix, as a source fragment so matchers 3 and 4 share one
 * definition. It cannot span whitespace, so it can never reach across a line to
 * swallow a host that is not actually behind it.
 */
const USERINFO = '[\\w.%+-]+@';

function authorityToHost(authority) {
  let host = authority;
  const at = host.lastIndexOf('@');
  if (at !== -1) host = host.slice(at + 1);
  // Bracketed IPv6 literal.
  const v6 = host.match(/^\[([^\]]+)\]/);
  if (v6) return v6[1].toLowerCase();
  host = host.replace(/:\d*$/, '');
  // A trailing dot is the DNS root label, not part of the name: `<host>.` and
  // `<host>` are the same host. Normalising it away here is what lets a host at
  // the END OF A SENTENCE be compared against ALLOWED_HOSTS at all — without
  // it, `https://<reserved-example-host>.` produced the host `<…>.`, matched no
  // allowlist entry, and got reported. That is the worst kind of false
  // positive: the check firing on the most correct content in the tree.
  host = host.replace(/\.$/, '');
  return host.toLowerCase();
}

function looksLikeHost(token) {
  if (token === 'localhost' || IPV4.test(token)) return true;
  return token.includes('.');
}

/**
 * Find every host-shaped and workspace-path-shaped string on one line.
 * Returns [{ text, host, kind }]. `host` is null for path findings.
 */
function findCandidates(line, applyBareRule) {
  const found = [];

  // ── 1. Any scheme: `scheme://authority` ────────────────────────────────────
  // The authority alternation accepts `${...}` / `${{ ... }}` interpolations,
  // including the spaces inside them, so a templated connection string keeps
  // its real host visible. Without this, a GitHub Actions secret reference in
  // the userinfo truncates the match before the `@` and the host is missed.
  const schemeRe = /\b([a-zA-Z][a-zA-Z0-9+.-]*):\/\/((?:\$\{\{[^}]*\}\}|\$\{[^}]*\}|[^\s/?#'"`<>)\]}{\\,;|])+)/g;
  let m;
  while ((m = schemeRe.exec(line)) !== null) {
    const scheme = m[1].toLowerCase();
    const host = authorityToHost(m[2]);
    if (!host) continue;
    // For non-network schemes (`chrome://inspect`, `vscode://…`, `file://…`)
    // the authority is an opaque target, not a host. Only flag it when it is
    // actually host-shaped, so `chrome://inspect` stays quiet while the same
    // scheme followed by a dotted host does not.
    if (!NETWORK_SCHEMES.has(scheme) && !looksLikeHost(host)) continue;
    found.push({ text: m[0], host, kind: 'url' });
  }

  // ── 2. Scheme-relative: `//host/` ─────────────────────────────────────────
  // The preceding character must not be `:` (that would be a scheme URL,
  // already handled) and must not be part of a word.
  //
  // `.` is a TERMINATOR in the lookahead for the same reason matcher 4's
  // trailing boundary had to stop excluding it: a host at the end of a sentence
  // is followed by a full stop, and a terminator list without one cannot match
  // it. The dot stays outside the capture, so the host is already normalised.
  const relRe = /(^|[\s"'`(\[<,;=])\/\/((?:[A-Za-z0-9_-]+\.)+[A-Za-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d{1,5})?(?=[./\s"'`)\]>,;]|$)/g;
  while ((m = relRe.exec(line)) !== null) {
    found.push({ text: `//${m[2]}${m[3] || ''}`, host: m[2].toLowerCase(), kind: 'scheme-relative' });
  }

  // ── 3. Bare `host:port` ───────────────────────────────────────────────────
  // Gated on the same TLD list as the bare-token rule, plus `localhost` and IP
  // literals. Without that gate this fires on source references like
  // `UserService.ts:42`, which is a real string in this tree.
  //
  // USERINFO. `ssh deploy@<host>:2222` was invisible because the boundary class
  // excluded `@` on the left, so the match could neither start at the host nor
  // reach it. The fix is to consume `<userinfo>@` as part of the match and hand
  // the whole authority to authorityToHost, which already knows to strip it —
  // it just never got the chance from here. Consuming it also stops the userinfo
  // being reported as a host in its own right: `user.name@<host>` used to report
  // `user.name` (`.name` is a real TLD) beside the host, which is precisely the
  // noise that trains a reader to ignore this check.
  const hostPortRe = new RegExp(
    `(^|[^A-Za-z0-9._/@:-])(${USERINFO})?` +
    `((?:[A-Za-z0-9_-]+\\.)+([A-Za-z]{2,})|localhost|\\d{1,3}(?:\\.\\d{1,3}){3}):(\\d{2,5})\\b`,
    'g',
  );
  while ((m = hostPortRe.exec(line)) !== null) {
    const host = authorityToHost(`${m[2] || ''}${m[3]}`);
    const tld = (m[4] || '').toLowerCase();
    if (tld && !BARE_TOKEN_TLDS.has(tld)) continue;
    found.push({ text: `${m[3]}:${m[5]}`, host, kind: 'host:port' });
  }

  // ── 4. Bare dotted token, and bare IP literals (no scheme, no port) ───────
  // Prose only — see the BARE_TOKEN_TLDS header for the two gates and why.
  if (applyBareRule) {
    // BOUNDARIES. Three characters decide what this can see, and each one was
    // wrong in a way that cost a whole shape:
    //
    //   trailing `.`  a lookahead excluding `.` can NEVER match a host at the
    //                 end of a sentence, and no amount of backtracking rescues
    //                 it — every shorter candidate ends on an excluded
    //                 character too. Prose ends in full stops, so this was the
    //                 likeliest single miss in the file. The lookahead is now
    //                 `[A-Za-z0-9_-]`, and the optional `\.?` after the capture
    //                 swallows an FQDN root dot rather than reading it as a
    //                 continuation, so `<host>.` is reported as `<host>`.
    //   leading `*.`  a wildcard certificate discloses the apex exactly as the
    //   leading `.`   bare form does, and so does a cookie domain. Both are
    //                 admitted as a PREFIX after a real boundary, not by adding
    //                 `.` to the boundary class itself — that would also start a
    //                 match inside `path/to/<file>.<ext>`, which is a different
    //                 and much noisier change.
    //   leading `@`   see matcher 3 above; same fix, same reason.
    const bareRe = new RegExp(
      `(^|[^A-Za-z0-9._/:@-])(${USERINFO})?\\*?\\.?` +
      '((?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+([A-Za-z]{2,}))\\.?(?![A-Za-z0-9_-])',
      'g',
    );
    while ((m = bareRe.exec(line)) !== null) {
      const tld = m[4].toLowerCase();
      if (!BARE_TOKEN_TLDS.has(tld)) continue;
      const host = authorityToHost(`${m[2] || ''}${m[3]}`);
      if (!isHostShapedForTld(host, tld)) continue;
      found.push({ text: m[3], host, kind: 'bare host' });
    }

    // IP LITERALS. An address is a host with no name, and matchers 1-3 only
    // ever saw one behind a scheme, a `//` or a port. `The box is at <addr> on
    // the VPN` — the plainest way to write one down — reached neither.
    const ipv4Re = new RegExp(`(^|[^A-Za-z0-9._:-])(${IPV4_LITERAL})(?![A-Za-z0-9._-])`, 'g');
    while ((m = ipv4Re.exec(line)) !== null) {
      found.push({ text: m[2], host: m[2], kind: 'bare host' });
    }

    // Coarse first, then isIpv6Literal — see its header for why the judgement
    // is not a shape question. The trailing class omits `.` for the same
    // end-of-sentence reason as the bare rule; it keeps `.` on the LEFT so a
    // match can never start inside a dotted quad.
    const ipv6Re = /(^|[^0-9A-Za-z:._-])([0-9A-Fa-f:]{3,45})(?![0-9A-Za-z:_-])/g;
    while ((m = ipv6Re.exec(line)) !== null) {
      const token = m[2].toLowerCase();
      if (!isIpv6Literal(token)) continue;
      found.push({ text: m[2], host: token, kind: 'bare host' });
    }
  }

  // ── 5. Absolute workspace paths ───────────────────────────────────────────
  //
  // What leaks here is the USERNAME, so every prefix that precedes one belongs
  // in the pattern, not just the two obvious ones:
  //
  //   /Volumes/<vol>/<user>/    an external disk on macOS, where a checkout
  //                             very plausibly lives
  //   -Users-<user>-            the MANGLED form. Agent harnesses name their
  //                             scratch directories by flattening a path's
  //                             slashes to hyphens, so a pasted log line or
  //                             temp path carries the username in a shape the
  //                             slash-based patterns cannot see. This is the
  //                             likeliest of the three to be produced by an
  //                             agent writing docs, which is who writes here.
  //
  // `/root/` is deliberately ABSENT, and it was here once. It fails this
  // paragraph's own test: `root` is the same account on every machine, so
  // `/root/<dir>` discloses no username — there is no per-user segment to
  // disclose, because root's home has no user directory under it. What it did
  // instead was refuse `/root/.cache` and `/root/.cargo`, which are standard in
  // the CI documentation this repo ships in `ci-cd-and-automation`.
  const pathRe = new RegExp(
    [
      '\\/Users\\/[A-Za-z0-9._-]+',
      '\\/home\\/[A-Za-z0-9._-]+',
      '\\/Volumes\\/[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+',
      '[A-Za-z]:\\\\Users\\\\[A-Za-z0-9._-]+',
      '-(?:Users|home)-[A-Za-z0-9._-]+-',
    ].join('|'),
    'g',
  );
  while ((m = pathRe.exec(line)) !== null) {
    found.push({ text: m[0], host: null, kind: 'workspace path' });
  }

  return found;
}

// ─── Filesystem walk ─────────────────────────────────────────────────────────

/**
 * Parse `.gitignore` into matcher predicates.
 *
 * Deliberately simple: it supports comments, blank lines, a leading `/`
 * (root-anchored), a trailing `/` (directory-only) and `*` wildcards, which is
 * every form this repo's `.gitignore` actually uses. It does NOT implement
 * negation (`!`) or `**`. If those appear later, this under-matches — which
 * fails SAFE for this check, because under-matching an ignore rule means
 * scanning MORE files, never fewer.
 */
function loadGitignore(root) {
  const file = path.join(root, '.gitignore');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('!'))
    .map(pattern => {
      const dirOnly = pattern.endsWith('/');
      const anchored = pattern.startsWith('/');
      const core = pattern.replace(/^\//, '').replace(/\/$/, '');
      const rx = new RegExp(
        '^' + core.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$'
      );
      return { rx, dirOnly, anchored, core };
    });
}

function isIgnored(relPath, isDir, rules) {
  const segments = relPath.split('/');
  for (const rule of rules) {
    if (rule.dirOnly && !isDir && !rule.core.includes('/')) {
      // A directory-only rule still excludes files *inside* that directory;
      // that is handled by pruning the directory during the walk.
    }
    if (rule.anchored || rule.core.includes('/')) {
      if (rule.rx.test(relPath)) return true;
      continue;
    }
    // Unanchored patterns match any path segment (git's behaviour).
    for (const seg of segments) {
      if (rule.rx.test(seg)) return true;
    }
  }
  return false;
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function walk(dir, rules, out, skipped, root) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).split(path.sep).join('/');

    if (entry.isSymbolicLink()) { skipped.symlinks.push(rel); continue; }

    if (entry.isDirectory()) {
      if (entry.name === '.git') { skipped.git = true; continue; }
      if (isIgnored(rel, true, rules)) { skipped.ignored.push(rel + '/'); continue; }
      walk(abs, rules, out, skipped, root);
      continue;
    }

    if (isIgnored(rel, false, rules)) { skipped.ignored.push(rel); continue; }
    if (EXCLUDED_PATHS.includes(rel)) { skipped.excluded.push(rel); continue; }
    out.push({ abs, rel });
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(argv = process.argv.slice(2)) {
  const root = parseRoot(argv);
  const rules = loadGitignore(root);
  const files = [];
  const skipped = { git: false, ignored: [], excluded: [], symlinks: [], binary: [] };

  walk(root, rules, files, skipped, root);
  files.sort((a, b) => a.rel.localeCompare(b.rel));

  const violations = [];
  let scanned = 0;

  // A walk that finds nothing satisfies every assertion below without making
  // one. On a one-way door that is the worst possible way to report success,
  // so say it plainly instead.
  if (files.length === 0) {
    console.log('✗  no files to scan — the walk found nothing, which is not the same as clean');
    console.log('\n1 violation(s) — FAILED');
    // process.exit, not `return`: main() is invoked bare at the bottom of this
    // file and sets the failing status itself. A `return 1` here printed FAILED
    // and exited 0 — a check that reports a violation and passes anyway.
    process.exit(1);
  }

  for (const { abs, rel } of files) {
    const buf = fs.readFileSync(abs);
    if (isBinary(buf)) { skipped.binary.push(rel); continue; }
    scanned++;

    const lines = buf.toString('utf8').split('\n');
    const ext = path.extname(rel).toLowerCase();
    const sourceFile = BARE_RULE_SKIP_EXTENSIONS.has(ext);
    const fences = sourceFile ? null : fencedLineSet(lines);
    const fenced = fences && fences.fenced;

    // Reported before the line findings for this file, because it is the reason
    // the line findings below it may be short: everything after an unmatched
    // opener is masked from the bare rule, silently, to end of file.
    if (fences && fences.unclosedAt !== -1 && !lines[fences.unclosedAt].includes(ALLOW_MARKER)) {
      violations.push({
        rel,
        line: fences.unclosedAt + 1,
        text: lines[fences.unclosedAt].trim().slice(0, 40),
        kind: 'unclosed fence',
      });
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(ALLOW_MARKER)) continue;

      const applyBareRule = !sourceFile && !fenced.has(i);

      const seen = new Set();
      for (const c of findCandidates(line, applyBareRule)) {
        if (c.host !== null && isAllowedHost(c.host)) continue;
        const key = `${c.kind}:${c.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push({ rel, line: i + 1, text: c.text, kind: c.kind });
      }
    }
  }

  for (const v of violations) {
    console.log(`${v.rel}:${v.line}: ${v.text}   [${v.kind}]`);
  }

  console.log(
    `\n${scanned} file(s) scanned — ${violations.length} violation(s) — ` +
    `${violations.length === 0 ? 'PASSED' : 'FAILED'}`
  );
  console.log(
    `skipped: .git${skipped.git ? '' : ' (absent)'}, ` +
    `${skipped.ignored.length} gitignored, ${skipped.binary.length} binary, ` +
    `${skipped.symlinks.length} symlink(s), ${skipped.excluded.length} path-excluded`
  );

  if (violations.length > 0) {
    console.log(
      `\nA hostname in a public commit is permanent. Remove it, add it to ` +
      `ALLOWED_HOSTS in scripts/check-no-hosts.js if it is genuinely public ` +
      `documentation, or mark the line with '${ALLOW_MARKER}' if it is a ` +
      `deliberate host-shaped fixture. See this script's header before ` +
      `reaching for the marker.\n` +
      `An [unclosed fence] is not a hostname: close the fence. Until you do, ` +
      `every line after it is masked from the bare-token rule, so this run ` +
      `cannot tell you whether that region is clean.`
    );
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(`\nERROR: check-no-hosts failed unexpectedly: ${err.message}`);
  process.exit(1);
}
