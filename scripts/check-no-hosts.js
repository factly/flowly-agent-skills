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
 * is why the check is an ALLOWLIST, not a denylist: a denylist only refuses
 * the hostnames someone already thought of, which is precisely the set that was
 * never going to leak. The rule enforced here is "no host except these", so a
 * hostname nobody anticipated fails by default.
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
  '0.0.0.0',
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
];

// Paths (relative to the repo root) excluded wholesale. Empty today, and it
// should stay that way: an excluded path is an unguarded path. Prefer the
// inline marker so the exception sits on the line it excuses.
const EXCLUDED_PATHS = [];

function isAllowedHost(host) {
  if (ALLOWED_HOSTS.has(host)) return true;
  return ALLOWED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
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
  // internal-network suffixes. These are the canonical names for exactly the
  // host this check exists to stop — a Flowly instance on a company network is
  // far likelier to be `flowly.<company>.internal` than anything on a public
  // TLD. They were missing while every public TLD was present, which inverted
  // the list's own priority. None collides with a source-file extension, so
  // the documented reason for the exclusions above does not reach them.
  'internal', 'local', 'lan', 'intranet', 'corp', 'private',
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

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
 * Fence languages where the bare-token rule KEEPS applying.
 *
 * Gate 1 masks fenced blocks because the false positives it was measured
 * against were property accesses in program source — `<obj>.name`, `<logger>.
 * info`. That reasoning is about a language, not about a fence: in a shell
 * transcript or a config snippet, a dotted token ending in a network TLD is a
 * hostname essentially every time, and dotted property access is not the idiom.
 *
 * It matters because these are the fences a setup guide is MADE of. The shape a
 * real leak takes here is `export FLOWLY_HOST=…` or `host: …` in an install
 * doc, and masking the whole block put the likeliest leak in the only place the
 * bare rule could not see. Gate 2 still applies inside these blocks, so a token
 * must still end in a curated network TLD to be reported at all.
 */
const SCANNED_FENCE_LANGUAGES = new Set([
  'bash', 'sh', 'shell', 'zsh', 'console', 'shell-session', 'terminal',
  'env', 'dotenv', 'properties',
  'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'json', 'jsonc',
  'http', 'nginx', 'docker', 'dockerfile', 'compose', 'makefile', 'make',
]);

function fencedLineSet(lines) {
  const fenced = new Set();
  let open = null;
  let scanning = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)/);
    if (open === null) {
      if (m) {
        open = m[1][0].repeat(m[1].length);
        // A config or shell block stays in scope for the bare rule; every
        // other block, tagged or not, is masked as before.
        scanning = SCANNED_FENCE_LANGUAGES.has(m[2].toLowerCase());
        fenced.add(i);
      }
    } else {
      if (!scanning) fenced.add(i);
      if (m && m[1][0] === open[0] && m[1].length >= open.length) {
        fenced.add(i);
        open = null;
        scanning = false;
      }
    }
  }
  return fenced;
}

// ─── Matchers ────────────────────────────────────────────────────────────────

/**
 * Normalise an authority component (`user:pass@host:port`) down to a bare
 * lowercase host. Userinfo is stripped rather than reported: a connection
 * string such as `postgresql://ci_user:${SECRET}@localhost:5432/db` has the
 * host `localhost`, and reporting `ci_user` as a host would be noise that
 * trains readers to ignore this check.
 */
function authorityToHost(authority) {
  let host = authority;
  const at = host.lastIndexOf('@');
  if (at !== -1) host = host.slice(at + 1);
  // Bracketed IPv6 literal.
  const v6 = host.match(/^\[([^\]]+)\]/);
  if (v6) return v6[1].toLowerCase();
  host = host.replace(/:\d*$/, '');
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
  const relRe = /(^|[\s"'`(\[<,;=])\/\/((?:[A-Za-z0-9_-]+\.)+[A-Za-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d{1,5})?(?=[/\s"'`)\]>,;]|$)/g;
  while ((m = relRe.exec(line)) !== null) {
    found.push({ text: `//${m[2]}${m[3] || ''}`, host: m[2].toLowerCase(), kind: 'scheme-relative' });
  }

  // ── 3. Bare `host:port` ───────────────────────────────────────────────────
  // Gated on the same TLD list as the bare-token rule, plus `localhost` and IP
  // literals. Without that gate this fires on source references like
  // `UserService.ts:42`, which is a real string in this tree.
  const hostPortRe = /(^|[^A-Za-z0-9._/@:-])((?:[A-Za-z0-9_-]+\.)+([A-Za-z]{2,})|localhost|\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\b/g;
  while ((m = hostPortRe.exec(line)) !== null) {
    const host = m[2].toLowerCase();
    const tld = (m[3] || '').toLowerCase();
    if (tld && !BARE_TOKEN_TLDS.has(tld)) continue;
    found.push({ text: `${m[2]}:${m[4]}`, host, kind: 'host:port' });
  }

  // ── 4. Bare dotted token (no scheme, no port) ─────────────────────────────
  // Prose only — see the BARE_TOKEN_TLDS header for the two gates and why.
  if (applyBareRule) {
    const bareRe = /(^|[^A-Za-z0-9._/:@-])((?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+([A-Za-z]{2,}))(?![A-Za-z0-9._-])/g;
    while ((m = bareRe.exec(line)) !== null) {
      const tld = m[3].toLowerCase();
      if (!BARE_TOKEN_TLDS.has(tld)) continue;
      found.push({ text: m[2], host: m[2].toLowerCase(), kind: 'bare host' });
    }
  }

  // ── 5. Absolute workspace paths ───────────────────────────────────────────
  //
  // What leaks here is the USERNAME, so every prefix that precedes one belongs
  // in the pattern, not just the two obvious ones:
  //
  //   /root/<dir>               the root account's tree
  //   /Volumes/<vol>/<user>/    an external disk on macOS, where a checkout
  //                             very plausibly lives
  //   -Users-<user>-            the MANGLED form. Agent harnesses name their
  //                             scratch directories by flattening a path's
  //                             slashes to hyphens, so a pasted log line or
  //                             temp path carries the username in a shape the
  //                             slash-based patterns cannot see. This is the
  //                             likeliest of the three to be produced by an
  //                             agent writing docs, which is who writes here.
  const pathRe = new RegExp(
    [
      '\\/Users\\/[A-Za-z0-9._-]+',
      '\\/home\\/[A-Za-z0-9._-]+',
      '\\/root\\/[A-Za-z0-9._-]+',
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
    const fenced = sourceFile ? null : fencedLineSet(lines);

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
      `reaching for the marker.`
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
