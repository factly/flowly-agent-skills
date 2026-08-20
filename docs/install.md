# Install

Claude Code is the door this distribution ships, and the only one it tests. Everything below is
written for it.

Installing the plugin gives you 33 skills, six lifecycle commands and four agent personas. It does
**not** give you a Flowly instance and it does not give you a credential for one. Those are separate,
they come from whoever runs your instance, and without them the Flowly skills install cleanly and
then fail at the first tool call. Get them first.

---

## Before you start

| You need | Where it comes from | Without it |
|---|---|---|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | nothing to install the plugin into |
| A Flowly instance URL | whoever operates your instance — it is per-installation and cannot be derived | the agent has no tracker to reach |
| A credential for that instance | your instance's `/settings/tokens`, or OAuth on first connect | every Flowly tool call is refused with `401` |

**No hostname appears anywhere in this repository, and none should appear in anything you write into
it.** Placeholders below use `https://flowly.example.com`; substitute your own instance URL, and keep
it in client configuration where it belongs.

---

## 1. Install the plugin

Two steps, in a Claude Code session:

```
/plugin marketplace add factly/flowly-agent-skills
/plugin install flowly@flowly-agent-skills
```

The first names the marketplace this repository publishes (`flowly-agent-skills`); the second
installs the one plugin in it (`flowly`). Both names come from `.claude-plugin/marketplace.json`, so
`flowly@flowly-agent-skills` is the id to use everywhere — including when checking afterwards that
the install took.

The same two steps from a shell, which is what CI runs:

```bash
claude plugin marketplace add factly/flowly-agent-skills
claude plugin install flowly@flowly-agent-skills --scope user
```

### On a machine with no GitHub SSH key

The marketplace clones over SSH by default. A machine that holds no SSH key for GitHub — which
includes a new teammate's laptop, and a teammate outside our GitHub org — gets
`Permission denied (publickey)` at the first step. This repository is public, so HTTPS needs no
credential at all; force it by giving the full URL:

```
/plugin marketplace add https://github.com/factly/flowly-agent-skills.git
/plugin install flowly@flowly-agent-skills
```

If the install itself still fails on the same error, configure git once to rewrite GitHub SSH URLs
for the clones it runs as subprocesses:

```bash
git config --global url."https://github.com/".insteadOf git@github.com:
```

### Confirm it installed

```bash
claude plugin list                              # flowly@flowly-agent-skills should appear
claude plugin details flowly@flowly-agent-skills # its component inventory
```

Skills become available as `flowly:<skill>` and the six lifecycle commands as `/flowly:research`,
`/flowly:plan`, `/flowly:build`, `/flowly:test`, `/flowly:review` and `/flowly:ship`. Each command
takes a Flowly issue identifier and refuses to proceed without one.

`/flowly:batch` ships alongside them and is the exception: it takes a set of identifiers rather than
one, and works them to done in a single run.

---

## 2. Point Claude Code at your instance

The plugin ships no instance configuration — it cannot, because the URL is yours and a hostname in a
public commit cannot be withdrawn. Add the MCP server yourself. The door is at `/mcp/` on your
instance's own URL, **with the trailing slash**.

**OAuth — preferred.** Nothing secret is copied between windows, and the client ends up as its own
actor on the board:

```bash
claude mcp add --transport http flowly https://flowly.example.com/mcp/
```

The first call answers `401` with a pointer to the authorization server; Claude Code follows it and
sends you to a consent screen where you sign in, pick which agent actor this client acts as, and
approve scopes.

**A scoped credential — when the client cannot do OAuth.** A human issues one at `/settings/tokens`,
choosing the agent it acts as and the scopes it carries. The secret is shown once:

```bash
claude mcp add --transport http flowly https://flowly.example.com/mcp/ \
  --header "Authorization: Bearer <your-token>"
```

There is a third way in — a legacy shared static credential — and it is last on purpose: one secret,
one actor, all six scopes, so every agent using it writes under the same byline. The full preference
order, the six scopes, and what each refusal signal means (`401`, `503`, `307`, `421`, a scope
refusal that arrives inside a `200`) are the `flowly-connect` skill's subject, in
[`skills/flowly-connect/SKILL.md`](../skills/flowly-connect/SKILL.md). Read that before changing a
credential in response to a refusal — four of the six signals are not credential problems.

---

## 3. Prove it with the identity call

Installation is not proof. Ask the session for an identity call:

> Call Flowly's `whoami` and tell me which actor I am.

A success returns an actor — id, slug and display name. That single answer rules out three failures
at once: the agent door is switched on, your credential resolved to an actor, and it holds
`issues:read`. It writes nothing, so it is safe to repeat.

**This is the install test.** A plugin that installed and a door that opens are two different claims,
and only the second one means you can work. If `whoami` is refused, take the signal to the refusal
table in `flowly-connect` rather than reaching for a new credential.

Note the actor you get back. It is who every write from this session will be attributed to, and it is
also what the sentinel `"me"` means in `assign_issue` and `list_issues`.

---

## One Flowly instance per trusting group — a requirement, not a suggestion

Everyone who shares a credential shares a tracker. That is a requirement of this distribution, not
advice about tidiness, and it is worth being blunt about why.

**No skill in this corpus selects an instance.** Every one of them writes to whatever instance the
configured credential points at. There is no per-project routing, no workspace argument, no "which
tracker?" prompt. So the credential *is* the routing decision, and it is made once, in client
configuration, by whoever set the client up.

Three consequences follow, and all three are silent:

- **Cross-writing.** Point two groups at one instance and each group's agents create issues, write
  comments, submit planning docs and start loop runs in the other group's tracker. Nothing refuses
  it; it is a legitimate write from a credential that is allowed to make it.
- **A byline that is not yours.** A credential resolves to exactly one actor. Two groups sharing one
  credential are one actor on the board, so no one can tell from a row who did the work — and the
  legacy shared credential makes this the default rather than an accident.
- **The other group's backlog in your agent's context.** Reads are capped at 250 rows with no
  pagination, and a caller that hits the cap is **not told**. On a shared instance an agent asking
  for "the issues" gets a truncated mixture of both groups' work and treats it as the whole picture.

So: one instance per group of people who already trust each other with all of their work. If two
groups need separate trackers, they need separate instances and separate credentials — not separate
projects inside one instance, and not two scopes on one token.

---

## Doors kept openable — and what actually holds them open

This fork ships one door and keeps two others openable. "Openable" means an authoring rule is
enforced so the door would work if someone shipped it; it does **not** mean it has been tried.
Neither of the kept doors is installed, exercised or tested anywhere, including in CI.

| Door | Status | What holds it open | The check that enforces it |
|---|---|---|---|
| Claude Code plugin | **shipped and tested** | — | `claude plugin validate --strict` and a real install, both in `.github/workflows/ci.yml` |
| Codex's native plugin format (`.codex-plugin/plugin.json`) | kept, not shipped, not tested | no substitution token in any command body; every command carries a non-empty frontmatter `description` | `scripts/check-commands.js` |
| Flat install via the `skills` CLI | kept, not shipped, not tested | skill frontmatter limited to exactly `name` and `description` | `scripts/validate-standard.sh` |

Why each rule, rather than the promise it is attached to:

- **No substitution token in a command body.** Codex renders each command into a skill at import
  time. A body written around a substitution token renders into a skill that has lost the thing it
  was written around, and nothing warns. The same import silently skips a command whose frontmatter
  `description` is missing or empty — so the description requirement is not cosmetic either. Both are
  assertions in `check-commands.js`, which also caps the rendered size at the limit Codex drops a
  command over.
- **Two frontmatter fields.** The Agent Skills open standard closes its frontmatter field set, so a
  vendor-specific key makes a skill invalid there even while it loads fine in one vendor's agent.
  The standard permits six fields; `validate-standard.sh` allows two, because two is the intersection
  that loads on every door. Holding the intersection from the first commit is cheaper than finding
  out at flat-install time which door drops a field it does not recognise.

Both checks run on every push. If either door is ever actually shipped, that is the point at which it
needs a test, because nothing above is evidence that it works — only evidence that the rules it
depends on have not been broken.

---

## Local development

To run the skills from a working copy instead of an installed plugin:

```bash
git clone https://github.com/factly/flowly-agent-skills.git
claude --plugin-dir /path/to/flowly-agent-skills
```

`/plugin` is unnecessary in this mode, and edits take effect on the next session.

---

## Uninstall

```bash
claude plugin uninstall flowly@flowly-agent-skills
claude plugin marketplace remove flowly-agent-skills
```

Removing the plugin does not touch your MCP server configuration; remove that separately with
`claude mcp remove flowly` if you no longer want the door open.

---

## See also

- [`skills/flowly-connect/SKILL.md`](../skills/flowly-connect/SKILL.md) — the credential preference
  order, the six scopes, and what every refusal signal means. The first place to go when a Flowly
  call is turned away.
- [`docs/adoption-guide.md`](adoption-guide.md) — installed and wondering what to roll out first.
- [`docs/sync.md`](sync.md) — for maintainers: the monthly merge from upstream.
- [`NOTICE.md`](../NOTICE.md) — what this fork inherited, what it changed, and what it removed.
