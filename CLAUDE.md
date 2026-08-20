# flowly-agent-skills

This is the flowly-agent-skills project — a collection of production-grade engineering skills for AI coding agents.

> **Scope:** This file configures agents working on the [`factly/flowly-agent-skills`](https://github.com/factly/flowly-agent-skills) repository itself, not other projects. Don't copy it into another project or a global agent configuration; the reusable assets are the skills in `skills/`.
>
> This repository is a fork. Pull requests belong to `factly/flowly-agent-skills`, not to the project it was forked from; see [NOTICE.md](NOTICE.md) for the attribution and the upstream base.

## Project Structure

```
skills/       → Core skills (SKILL.md per directory)
agents/       → Reusable agent personas (code-reviewer, test-engineer, security-auditor, web-performance-auditor)
hooks/        → Session lifecycle hooks
commands/     → The six lifecycle commands, each taking a Flowly issue identifier (/flowly:research, /flowly:plan, /flowly:build, /flowly:test, /flowly:review, /flowly:ship)
.claude/rules/ → Repo-scoped rules for agents working here
references/   → Supplementary checklists (testing, performance, security, accessibility, observability)
scripts/      → Validators and the eval harness (plain Node, no build step)
evals/        → Skill eval cases + framework (see evals/README.md)
docs/         → Repo and setup guides
```

Claude Code is the only door this fork ships and tests. Slash commands read `/flowly:<command>` and skills read `flowly:<skill>` once the plugin is installed.

## Skills by Phase

**Under all six:** flowly-catalog (the router, and the one place the shared Flowly conventions are written down), flowly-connect (the door every other Flowly skill assumes is open), flowly-loop-runs (a run spans plan and build)
**Define:** flowly-define, interview-me, idea-refine, spec-driven-development
**Plan:** flowly-plan, flowly-plan-gate, planning-and-task-breakdown
**Build:** flowly-build, flowly-batch, incremental-implementation, test-driven-development, context-engineering, source-driven-development, doubt-driven-development, frontend-ui-engineering, api-and-interface-design
**Verify:** flowly-verify, browser-testing-with-devtools, debugging-and-error-recovery
**Review:** flowly-review, code-review-and-quality, code-simplification, security-and-hardening, performance-optimization
**Ship:** flowly-ship, git-workflow-and-versioning, ci-cd-and-automation, deprecation-and-migration, documentation-and-adrs, observability-and-instrumentation, shipping-and-launch

This list and `skills/flowly-catalog/SKILL.md` must agree; `scripts/check-catalog.js` holds the catalog to the skills tree in both directions, so a skill added here without a catalog row turns it red.

The `flowly-` skills bind a phase to the tracker; the inherited one beside each still governs the craft. Where they share a name they are not alternatives — `flowly-review` is where a run's verdict lives, `code-review-and-quality` is how to form one; `flowly-ship` is the release record, `shipping-and-launch` is launch readiness.

## Conventions

- Every skill lives in `skills/<name>/SKILL.md`
- YAML frontmatter with `name` and `description` fields
- Description starts with what the skill does (third person), followed by trigger conditions ("Use when...")
- Every skill has: Overview, When to Use, Process, Common Rationalizations, Red Flags, Verification
- Shared references are in the root `references/` directory; the emerging convention for self-contained, distributable skills keeps a skill's own references inside `skills/<name>/references/`
- Supporting files only created when content exceeds 100 lines

## Contributing

Before adding a new skill or significantly reworking an existing one, run the pre-flight checks in [CONTRIBUTING.md](CONTRIBUTING.md#before-proposing-a-new-skill): search the catalog, check open PRs, confirm the idea fits [docs/skill-anatomy.md](docs/skill-anatomy.md), and justify the gap. Prefer extending an existing skill over adding a near-duplicate. CONTRIBUTING.md is the single source of truth for this workflow; do not restate its checklist here or elsewhere, link to it.

## Commands

- `npm test` — Not applicable (this is a documentation project)
- Validate: Check that all SKILL.md files have valid YAML frontmatter with name and description
- Evals: `node scripts/run-evals.js` — trigger/routing evals for every skill (CI); `--behavioral <skill>` for graded runs

## Pull Requests

PRs target this repository's default branch — `factly/flowly-agent-skills`, never the project it was forked from. Bugs found here are ours; do not report them upstream.

- Before opening a PR, search this repository's open PRs and issues for work that touches the same files or rules. If any overlaps, coordinate (build on it, align your rules with it, or rebase after it merges) instead of opening a conflicting PR.
- Prefer small, focused PRs over large refactors of widely shared files (for example, files under `scripts/`), which are more likely to collide with in-flight work.

## Boundaries

- Always: Run the CONTRIBUTING.md pre-flight checks before creating a new skill directory
- Always: Follow the skill-anatomy.md format for new skills
- Always: Check this repo's open PRs and issues for overlap before opening a new PR
- Never: Add skills that are vague advice instead of actionable processes
- Never: Duplicate content between skills — reference other skills instead
