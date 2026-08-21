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

Every path this fork deleted is in the table below, and the table is the record: `scripts/check-deletions.js`
reads its **first column** and fails on any deletion missing from it. The prose after the table explains
the entries that need explaining — it does not record them, because prose about a removal names paths
that were *not* removed, and reading those as records absolved whole subtrees.

The first nine rows are the doors this fork does not ship, deleted in the import commit rather than
left to rot, because each one is a manifest or a command set that would have to be kept in sync by
hand. The rest went later, as this fork's own replacements were authored.

| Removed | Was |
|---|---|
| `.gemini/commands/` | Gemini CLI slash commands (TOML) |
| `commands/` | Antigravity CLI slash commands (TOML) — the path is reused for this fork's own Claude Code commands |
| `.agents/plugins/marketplace.json` | Antigravity marketplace manifest |
| `.opencode/skills` | opencode symlink into `skills/` |
| `scripts/validate-commands.js`, `scripts/validate-commands-test.js` | The three-way parity checker that held the Claude, Gemini and Antigravity command directories in sync |
| `docs/antigravity-setup.md`, `docs/gemini-cli-setup.md`, `docs/opencode-setup.md` | Install guides for three of the doors removed above. A guide to a door this fork does not ship is a guide to a broken install |
| `docs/codex-setup.md` | The Codex install guide — see the paragraph below, where the manifest is kept and the guide is not |
| `docs/comparison.md` | Upstream's honest map of how it differs from two other skills collections. It compares *upstream* to them, and this fork is a third thing again; keeping it would have meant maintaining a comparison of a project we are not |
| `.github/workflows/test-plugin-install.yml` | Upstream's standalone install smoke test. Superseded, not dropped: the `install` job in `.github/workflows/ci.yml` does the same thing and is one of the jobs `gates` requires, so the coverage moved rather than went. It left later than the rest, when CI was wired |
| `plugin.json` | Antigravity's plugin manifest at the repository root — the counterpart to the marketplace manifest above, and removed with it |
| `.claude/commands/` | Upstream's eight Claude Code slash commands, replaced by this fork's own six at `commands/` — see below |
| `skills/using-agent-skills/SKILL.md` | Upstream's meta-skill, replaced by `skills/flowly-catalog/SKILL.md` — see below |
| `evals/cases/using-agent-skills.json` | The meta-skill's eval case. Rename detection pairs it with its replacement, so it is a deletion only `--no-renames` can see — see below |
| `evals/fixtures/using-agent-skills/incident.md` | The meta-skill's eval fixture, paired with its replacement the same way |
| `skills/idea-refine/scripts/idea-refine.sh` | Created the ideas directory that skill wrote its one-pager into. Under the binding a refined idea becomes a Flowly issue instead — see below |
| `.codex-plugin/` | The Codex plugin manifest. Kept at import as a door held openable, removed at the v0.6.7 merge when upstream began shipping branded interface metadata inside it — see below |
| `docs/commandcode-setup.md` | Upstream's Command Code install guide, new in v0.6.7. A fifth door, arriving after this fork had settled on one; a guide to a door we do not ship is a guide to a broken install, same as the four above |

`.codex-plugin/` was **kept at import and removed at the v0.6.7 merge**. The reasoning that kept it was
that the manifest cost nothing and held a door openable by two authoring rules this fork follows anyway:
no substitution token in any command body, and skill frontmatter limited to `name` and `description`.
Its setup guide went at import even then, on the asymmetry that a manifest holds a door openable while a
published guide promises the door is tested — openable and supported being different claims.

What ended it was upstream filling that manifest with its own interface metadata, including a
`developerName` and a skill count. Keeping the file would have meant either shipping upstream's identity
from our manifest or hand-maintaining a divergence inside it at every future merge, and neither is worth
a door nothing here tests. `CLAUDE.md` states that Claude Code is the only door this fork ships and
tests; with the manifest gone that sentence is true rather than nearly true. If Codex support is ever
wanted it is a deliberate project with CI behind it, not an inherited file that survived because nobody
deleted it.

`plugin.json` at the repository root was Antigravity's plugin manifest — the counterpart to the
marketplace manifest above — and was removed with it.

`.claude/commands/` — upstream's eight Claude Code slash commands — went later, not at import, when
this fork's own six were authored at `commands/`. It is recorded here anyway, because this is the
section a reader checks to find out what became of upstream's commands: they were replaced, not
migrated. Nothing was carried across. The plugin had already stopped declaring that directory, so the
files reached no user; what they still did was load as *project* commands for anyone working in this
repository, under names that collided with ours and pointing at a plugin namespace that no longer
exists.

`skills/using-agent-skills/SKILL.md` — upstream's meta-skill — went later too, when this fork's own
catalog was written at `skills/flowly-catalog/SKILL.md`. It is recorded here for the same reason as
the two entries above: a merge cannot tell "an inherited file is gone" apart from "an inherited file
was never here", so upstream will offer it back on the next sync, and the answer is no.

The answer is no because the file's entire content was a claim about a catalog that is not ours. It
enumerated 24 skills in a routing flowchart, a lifecycle sequence and a quick-reference table; this
fork ships 33, ten of them Flowly-native, arranged around six phases and a tracker upstream knows
nothing about. Merging its updates would import a router that sends agents to skills this
distribution does not have — the one failure a router is there to prevent — and the merge would look
clean while doing it. So the path is not `owned` and re-bound; it is gone, and the replacement is
`new` at a name of ours. `scripts/check-catalog.js` is what makes that replacement true, holding the
catalog to the skills tree in both directions.

Its eval case and fixture went with it, at `evals/cases/using-agent-skills.json` and
`evals/fixtures/using-agent-skills/incident.md`. Both are recorded here for a reason the two entries
above do not have: git does not see them as deletions at all. Their replacements are close enough to
the originals that rename detection pairs them — 74% and 100% similar to
`evals/cases/flowly-catalog.json` and `evals/fixtures/flowly-catalog/incident.md` — so any
enumeration of what this fork deleted will omit them unless it passes `--no-renames`, and the
deletions most worth recording are exactly the ones that were replaced rather than dropped.
`scripts/check-deletions.js` passes it.

One inherited artifact outlives it: `scripts/lib/skill-lint.js` still carries a section exemption
keyed to the literal name `using-agent-skills`, which now matches nothing. That is deliberate and it
is left alone. The linter is registered `unchanged` for the reason in the table above — an edit there
is a cost paid on every merge forever — and the exemption's practical effect is that
`flowly-catalog` gets no exemption at all: it carries the full skill anatomy (Overview, When to Use,
Common Rationalizations, Red Flags, Verification) and is validated like every other skill.

`skills/idea-refine/scripts/idea-refine.sh` went later still, when the inherited corpus was rebound.
Its entire body was `IDEAS_DIR="docs/ideas"` and a `mkdir -p`: it existed to create the directory
that skill saved its one-pager into. Under the binding a refined idea becomes a Flowly issue, so the
directory never exists and the script has no job left to do. It is recorded here rather than merely
dropped from the register, because "an inherited file is gone" is the one change a merge cannot tell
apart from "an inherited file was never here" — upstream will offer it back on the next sync, and the
answer is no. Its own `skills/idea-refine/scripts/` directory was empty afterwards and went with it;
git tracks no directories, so the file above is the whole record.

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

Some of that cost is bought back by a check, and it is worth saying which. Six of the rows below
were bound because they named a *command*: they told a reader to type `review`, `ship`, `test` —
bare, without the `flowly:` namespace a user actually has to type — or `webperf`, which this
distribution does not ship in any spelling. Upstream writes those names because upstream ships those
commands, so every merge would have offered them back, and there was no reader to notice.
`scripts/check-command-refs.js` is that reader: it resolves every command written anywhere in the
four trees above or in the root prose against `commands/` on disk, and it fails on a bare name as
loudly as on a missing one. So for these six, a merge that reverts the binding is now an automated
red rather than something a human has to catch. `bound` still means read the hunk — the check knows
about command names and nothing else — but the binding no longer rests entirely on the reading.

### Files

| File | Status |
|---|---|
| `agents/code-reviewer.md` | `bound` |
| `agents/security-auditor.md` | `bound` |
| `agents/test-engineer.md` | `bound` |
| `agents/web-performance-auditor.md` | `bound` |
| `commands/batch.md` | `new` |
| `commands/build.md` | `new` |
| `commands/plan.md` | `new` |
| `commands/research.md` | `new` |
| `commands/review.md` | `new` |
| `commands/ship.md` | `new` |
| `commands/test.md` | `new` |
| `references/accessibility-checklist.md` | `unchanged` |
| `references/definition-of-done.md` | `unchanged` |
| `references/observability-checklist.md` | `unchanged` |
| `references/orchestration-patterns.md` | `bound` |
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
| `skills/doubt-driven-development/SKILL.md` | `bound` |
| `skills/flowly-batch/SKILL.md` | `new` |
| `skills/flowly-build/SKILL.md` | `new` |
| `skills/flowly-catalog/SKILL.md` | `new` |
| `skills/flowly-connect/SKILL.md` | `new` |
| `skills/flowly-define/SKILL.md` | `new` |
| `skills/flowly-loop-runs/SKILL.md` | `new` |
| `skills/flowly-plan/SKILL.md` | `new` |
| `skills/flowly-plan/references/planning-docs.md` | `new` |
| `skills/flowly-plan-gate/SKILL.md` | `new` |
| `skills/flowly-review/SKILL.md` | `new` |
| `skills/flowly-ship/SKILL.md` | `new` |
| `skills/flowly-verify/SKILL.md` | `new` |
| `skills/frontend-ui-engineering/SKILL.md` | `unchanged` |
| `skills/git-workflow-and-versioning/SKILL.md` | `bound` |
| `skills/idea-refine/SKILL.md` | `bound` |
| `skills/idea-refine/examples.md` | `bound` |
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
