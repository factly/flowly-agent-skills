# NOTICE

This repository is a **hard fork** of [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills),
used under the MIT licence. It is **not affiliated with, endorsed by, or published by** that project
or its author. Bugs here are ours; do not report them upstream.

The original MIT copyright is preserved verbatim in [`LICENSE`](LICENSE) alongside our own.

## Base

| | |
|---|---|
| Upstream | `https://github.com/addyosmani/agent-skills` |
| Base SHA | `bdf76c7c6b7b3b3e01bb15c9fdc42ac5351855c1` |
| Base tag | `upstream-base-bdf76c7` |
| Upstream commit date | 2026-08-03 |
| Imported | 2026-08-04 |

Upstream history is preserved: the base SHA is an ancestor of every commit on `main`. The permalink
to any inherited file at the base is
`https://github.com/addyosmani/agent-skills/blob/bdf76c7c6b7b3b3e01bb15c9fdc42ac5351855c1/<path>`.

## Syncing

```sh
git remote add upstream https://github.com/addyosmani/agent-skills   # once
git fetch upstream
git merge upstream/main
```

Merges are resolved by eye against the ownership register below. On the day of the fork
`git merge upstream/main` is a no-op — that is what makes the register's starting point reviewable.

## Removed at import

These are the doors this fork does not ship. They were deleted in the import commit rather than left
to rot, because each one is a manifest or a command set that would have to be kept in sync by hand:

| Removed | Was |
|---|---|
| `.gemini/commands/` | Gemini CLI slash commands (TOML) |
| `commands/` | Antigravity CLI slash commands (TOML) — the path is reused for this fork's own Claude Code commands |
| `.agents/plugins/marketplace.json` | Antigravity marketplace manifest |
| `.opencode/skills` | opencode symlink into `skills/` |
| `scripts/validate-commands.js`, `scripts/validate-commands-test.js` | The three-way parity checker that held the Claude, Gemini and Antigravity command directories in sync |

`.codex-plugin/plugin.json` is **kept**. The Codex door is not shipped and not tested, but it is held
openable by two authoring rules that cost nothing: no substitution token in any command body, and
skill frontmatter limited to `name` and `description`.

`plugin.json` at the repository root was Antigravity's plugin manifest — the counterpart to the
marketplace manifest above — and was removed with it.

`.claude/commands/` — upstream's eight Claude Code slash commands — went later, not at import, when
this fork's own six were authored at `commands/`. It is recorded here anyway, because this is the
section a reader checks to find out what became of upstream's commands: they were replaced, not
migrated. Nothing was carried across. The plugin had already stopped declaring that directory, so the
files reached no user; what they still did was load as *project* commands for anyone working in this
repository, under names that collided with ours and pointing at a plugin namespace that no longer
exists.

`skills/idea-refine/scripts/idea-refine.sh` went later still, when the inherited corpus was rebound.
Its entire body was `IDEAS_DIR="docs/ideas"` and a `mkdir -p`: it existed to create the directory
that skill saved its one-pager into. Under the binding a refined idea becomes a Flowly issue, so the
directory never exists and the script has no job left to do. It is recorded here rather than merely
dropped from the register, because "an inherited file is gone" is the one change a merge cannot tell
apart from "an inherited file was never here" — upstream will offer it back on the next sync, and the
answer is no. Its `scripts/` directory was empty afterwards and went with it.

## Surviving references to upstream

Upstream's *identity* is stripped: no hero image, no badge, no maintainer table, no install line
pointing at upstream's repo, and no manifest naming upstream as author or owner. What remains is
this file, `LICENSE`, and three links to upstream's **issue tracker**. Those are not identity
artifacts and are deliberately kept:

| Where | What | Why it stays |
|---|---|---|
| `scripts/lib/skill-lint.js` | Upstream issue link inside a lint exemption's rationale | The linter is inherited **unmodified** on purpose — it is validated on every merge, and an edit here is a cost paid forever. It is also registered as byte-identical to the base. |
| `docs/skill-anatomy.md` | Upstream issue #361 — a per-skill install leaves the repo-root `references/` behind | The limitation is upstream's and the issue is upstream's. Repointing it at our tracker would claim work we are not doing. |
| `evals/README.md` | Upstream issue #351 — description-vocabulary gaps the evals surface | Same: an upstream finding about upstream's own eval corpus. |

A grep for the upstream owner therefore returns hits in `LICENSE`, in this file, and in exactly those
three places. Anything beyond them is a regression — most likely a merge reintroducing an install
line or an author field — and should be removed rather than added to this table.

## Ownership register

Every file this fork ships from upstream's content trees is listed below with a status that says what
an upstream merge may do to it. This table is what a merge is resolved against, so it is only worth
having if it is true: `scripts/check-register.js` reads it and asserts that the tree and the table
describe the same set of files, that every status is one of the four words defined below, that the
base SHA above is a real commit and an ancestor of `HEAD`, that every file marked `unchanged` is
byte-identical to its blob at that SHA, and that every file marked `bound` exists at that SHA and
differs from it.

### Scope

The register covers **every tracked file** under `skills/`, `references/`, `agents/` and `commands/` —
not only `SKILL.md`. Everything else in the repository is deliberately outside it, and its absence
here is not an oversight: `scripts/`, `docs/`, `evals/`, `hooks/`, `.github/`, `.claude/`,
`.claude-plugin/`, `.codex-plugin/`, and the root files (`README.md`, `CLAUDE.md`, `AGENTS.md`,
`CONTRIBUTING.md`, `LICENSE`, `NOTICE.md`, `plugin.json`, `.gitignore`, `.gitattributes`). Those are
fork infrastructure — tooling, CI and prose we maintain outright — and tracking them row by row would
make the register churn on work that has nothing to do with a merge.

`commands/` holds this fork's own lifecycle commands, all `new`. Upstream's Antigravity commands were
removed from that path at import (above) and upstream's Claude Code commands lived at
`.claude/commands/`, which is gone too — so nothing here descends from anything upstream ships, and a
merge conflict in this directory means upstream has started using a path we took over.

### Statuses

| Status | Meaning |
|---|---|
| `unchanged` | Inherited from upstream and byte-identical to the base SHA. Merges freely; a conflict here means upstream moved and we did not. |
| `bound` | Inherited, then edited to point at Flowly — instead of at the filesystem, or instead of at a convention that assumed no tracker. Every merge that touches one of these needs review by eye, because upstream reverting a binding is the one failure that is silent. |
| `owned` | An inherited path we have taken over. Never merged from upstream. |
| `new` | Ours outright, with no upstream counterpart. |

At the fork every file was `unchanged` — the correct starting state, and what makes the first monthly
merge reviewable. Rows leave that state one at a time, and each departure is a claim a check can
test: `new` and `owned` skill directories must carry the `flowly-` prefix, `unchanged` ones must
still be byte-identical to the base.

`bound` is the status that costs money, so it is asserted in both directions. A file marked `bound`
must exist at the base **and differ from it** — the first because there is nothing to be bound to
otherwise, the second because `bound` is what tells a reviewer to read a hunk by eye on every merge.
A row carrying it with no edit behind it buys that effort forever and gets nothing; worse, a file
that was *meant* to be rebound and never was reads as finished. Until the first rebinding landed
there were no `bound` rows, and the reverse assertion did not exist — every row that word could have
carried would have been an unverified claim.

### Files

| File | Status |
|---|---|
| `agents/code-reviewer.md` | `unchanged` |
| `agents/security-auditor.md` | `unchanged` |
| `agents/test-engineer.md` | `unchanged` |
| `agents/web-performance-auditor.md` | `unchanged` |
| `commands/build.md` | `new` |
| `commands/plan.md` | `new` |
| `commands/research.md` | `new` |
| `commands/review.md` | `new` |
| `commands/ship.md` | `new` |
| `commands/test.md` | `new` |
| `references/accessibility-checklist.md` | `unchanged` |
| `references/definition-of-done.md` | `unchanged` |
| `references/observability-checklist.md` | `unchanged` |
| `references/orchestration-patterns.md` | `unchanged` |
| `references/performance-checklist.md` | `unchanged` |
| `references/security-checklist.md` | `unchanged` |
| `references/testing-patterns.md` | `unchanged` |
| `skills/api-and-interface-design/SKILL.md` | `unchanged` |
| `skills/browser-testing-with-devtools/SKILL.md` | `unchanged` |
| `skills/ci-cd-and-automation/SKILL.md` | `unchanged` |
| `skills/code-review-and-quality/SKILL.md` | `bound` |
| `skills/code-simplification/SKILL.md` | `unchanged` |
| `skills/context-engineering/SKILL.md` | `bound` |
| `skills/debugging-and-error-recovery/SKILL.md` | `unchanged` |
| `skills/deprecation-and-migration/SKILL.md` | `unchanged` |
| `skills/documentation-and-adrs/SKILL.md` | `bound` |
| `skills/doubt-driven-development/SKILL.md` | `unchanged` |
| `skills/flowly-build/SKILL.md` | `new` |
| `skills/flowly-plan/SKILL.md` | `new` |
| `skills/flowly-plan/references/planning-docs.md` | `new` |
| `skills/frontend-ui-engineering/SKILL.md` | `unchanged` |
| `skills/git-workflow-and-versioning/SKILL.md` | `bound` |
| `skills/idea-refine/SKILL.md` | `bound` |
| `skills/idea-refine/examples.md` | `unchanged` |
| `skills/idea-refine/frameworks.md` | `unchanged` |
| `skills/idea-refine/refinement-criteria.md` | `unchanged` |
| `skills/incremental-implementation/SKILL.md` | `unchanged` |
| `skills/interview-me/SKILL.md` | `bound` |
| `skills/observability-and-instrumentation/SKILL.md` | `unchanged` |
| `skills/performance-optimization/SKILL.md` | `bound` |
| `skills/planning-and-task-breakdown/SKILL.md` | `bound` |
| `skills/security-and-hardening/SKILL.md` | `unchanged` |
| `skills/shipping-and-launch/SKILL.md` | `bound` |
| `skills/source-driven-development/SKILL.md` | `unchanged` |
| `skills/spec-driven-development/SKILL.md` | `bound` |
| `skills/test-driven-development/SKILL.md` | `unchanged` |
| `skills/using-agent-skills/SKILL.md` | `unchanged` |
