# Flowly Agent Skills

**Production-grade engineering skills for AI coding agents, packaged for teams that run their software lifecycle in [Flowly](https://github.com/factly/flowly).**

Skills encode the workflows, quality gates, and best practices that senior engineers use when building software. These ones are packaged so AI agents follow them consistently across every phase of development.

```
  DEFINE          PLAN           BUILD          VERIFY         REVIEW          SHIP
 ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐
 │ Idea │ ───▶ │ Spec │ ───▶ │ Code │ ───▶ │ Test │ ───▶ │  QA  │ ───▶ │  Go  │
 │Refine│      │  PRD │      │ Impl │      │Debug │      │ Gate │      │ Live │
 └──────┘      └──────┘      └──────┘      └──────┘      └──────┘      └──────┘
```

Skills activate automatically based on what you're doing — designing an API triggers `api-and-interface-design`, building UI triggers `frontend-ui-engineering`, and so on.

---

## Status

This distribution is **under construction and not yet announced**. What is here today is the
inherited corpus — 24 skills, 4 agent personas, 7 reference checklists — plus the structural gates
that everything authored afterwards has to pass.

**The six lifecycle commands ship.** `/flowly:research`, `/flowly:plan`, `/flowly:build`,
`/flowly:test`, `/flowly:review` and `/flowly:ship` each take a Flowly issue identifier, so that
`/flowly:plan FLO-1234` writes that issue's planning docs through Flowly's MCP surface rather than
to a local file. Each resolves the identifier before it does anything else, and refuses to proceed
without one instead of falling back to a local file. The Flowly-native skills they invoke are still
landing: `scripts/check-commands.js` holds the list of the ones that do not exist yet, and goes red
when one of them does.

There is no semver contract. The manifests carry `0.1.0` because the plugin validator requires a
version, not because anything is promised about compatibility.

---

## Install

Claude Code is the shipped door.

```
/plugin marketplace add factly/flowly-agent-skills
/plugin install flowly@flowly-agent-skills
```

> **SSH errors?** The marketplace clones repos via SSH. If you don't have SSH keys set up on GitHub, either [add your SSH key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account) or use the full HTTPS URL to force HTTPS cloning during the marketplace-add step:
> ```bash
> /plugin marketplace add https://github.com/factly/flowly-agent-skills.git
> /plugin install flowly@flowly-agent-skills
> ```
>
> If `/plugin install` still fails with a `Permission denied (publickey)` error on Windows or macOS, the recommended workaround is to configure Git once to rewrite GitHub SSH URLs to HTTPS for subprocess clones:
> ```bash
> git config --global url."https://github.com/".insteadOf git@github.com:
> ```

**Local / development:**

```bash
git clone https://github.com/factly/flowly-agent-skills.git
claude --plugin-dir /path/to/flowly-agent-skills
```

Other doors — the `skills` CLI for a flat install, and Codex's native plugin format — are kept
*openable* but are not shipped, not tested, and deliberately not documented here. Two authoring rules
hold them open at no cost: skill frontmatter carries exactly `name` and `description`, and no command
body contains a substitution token. Both are enforced by checks in `scripts/`.

---

## Adoption

Already installed? How you roll the pack out depends on your codebase. The **[Adoption Guide](docs/adoption-guide.md)** covers two paths: the full lifecycle from day one for a greenfield project, or an incremental, verification-first rollout for an established codebase.

---

## All 33 Skills

The pack includes 33 skills total — 32 lifecycle skills plus the `using-agent-skills` meta-skill. Nine of them are ours, the `flowly-` prefixed set; the other 24 are inherited. Each skill is a structured workflow with steps, verification gates, and anti-rationalization tables. You can also reference any skill directly.

The Flowly set covers each of the six phases, plus two that sit under all of them: `flowly-connect`, because every other one assumes the door is open, and `flowly-loop-runs`, because a run spans the plan and build phases rather than sitting in either.

### Meta - Discover which skill applies

| Skill | What It Does | Use When |
|-------|-------------|----------|
| [using-agent-skills](skills/using-agent-skills/SKILL.md) | Maps incoming work to the right skill workflow and defines shared operating rules | Starting a session or deciding which skill applies |

### Flowly - Reach the tracker and drive a run

Neither of these is a lifecycle phase. The first is the precondition for every Flowly skill below; the second spans the plan and build phases rather than belonging to either.

| Skill | What It Does | Use When |
|-------|-------------|----------|
| [flowly-connect](skills/flowly-connect/SKILL.md) | Reach an instance over its MCP door, prove it with an identity call, and tell the ways in apart from the ways a call is turned away | Flowly's tools are missing from a session, or a Flowly call is refused |
| [flowly-loop-runs](skills/flowly-loop-runs/SKILL.md) | Drive a loop run through its three gates — pick an autonomy level the agent can actually move, and stop where a human's verdict is required | Creating a loop or starting a run, or a run will not start or will not leave its plan phase |

### Define - Clarify what to build

| Skill | What It Does | Use When |
|-------|-------------|----------|
| [flowly-define](skills/flowly-define/SKILL.md) | Open work on an issue — find it or file it, accept or decline what sits in triage, read the project's assets, and record the research doc | A request has no Flowly issue behind it yet, or nothing has been investigated against one |
| [interview-me](skills/interview-me/SKILL.md) | One-question-at-a-time interview that extracts what the user actually wants instead of what they think they should want, until ~95% confidence | The ask is underspecified, or the user invokes "interview me" / "grill me" |
| [idea-refine](skills/idea-refine/SKILL.md) | Structured divergent/convergent thinking to turn vague ideas into concrete proposals | You have a rough concept that needs exploration |
| [spec-driven-development](skills/spec-driven-development/SKILL.md) | Write a PRD covering objectives, commands, structure, code style, testing, and boundaries before any code | Starting a new project, feature, or significant change |

### Plan - Break it down

| Skill | What It Does | Use When |
|-------|-------------|----------|
| [flowly-plan](skills/flowly-plan/SKILL.md) | Write an issue's four planning docs and its task list through Flowly's tools, then hand the plan to the human gate | You have a Flowly issue identifier and work under it that needs breaking down |
| [flowly-plan-gate](skills/flowly-plan-gate/SKILL.md) | Carry an issue across its plan gate — submit, watch the notification inbox for the verdict, and convert the todo doc into child issues exactly once | The docs are written and a human must now decide, or a verdict has landed |
| [planning-and-task-breakdown](skills/planning-and-task-breakdown/SKILL.md) | Decompose specs into small, verifiable tasks with acceptance criteria and dependency ordering | You have a spec and need implementable units |

### Build - Write the code

| Skill | What It Does | Use When |
|-------|-------------|----------|
| [flowly-build](skills/flowly-build/SKILL.md) | Walk an approved plan's child issues one at a time — derive the queue from the tracker, order it, move each through the statuses, commit once per child | A parent issue's plan gate reports approved and its children exist |
| [incremental-implementation](skills/incremental-implementation/SKILL.md) | Thin vertical slices - implement, test, verify, commit. Feature flags, safe defaults, rollback-friendly changes | Any change touching more than one file |
| [test-driven-development](skills/test-driven-development/SKILL.md) | Red-Green-Refactor, test pyramid (80/15/5), test sizes, DAMP over DRY, Beyonce Rule, browser testing | Implementing logic, fixing bugs, or changing behavior |
| [context-engineering](skills/context-engineering/SKILL.md) | Feed agents the right information at the right time - rules files, context packing, MCP integrations | Starting a session, switching tasks, or when output quality drops |
| [source-driven-development](skills/source-driven-development/SKILL.md) | Ground every framework decision in official documentation - verify, cite sources, flag what's unverified | You want authoritative, source-cited code for any framework or library |
| [doubt-driven-development](skills/doubt-driven-development/SKILL.md) | Adversarial fresh-context review of every non-trivial decision in-flight - CLAIM → EXTRACT → DOUBT → RECONCILE → STOP, with optional user-authorized cross-model escalation | Stakes are high (production, security, irreversible), working in unfamiliar code, or a confident output is cheaper to verify now than to debug later |
| [frontend-ui-engineering](skills/frontend-ui-engineering/SKILL.md) | Component architecture, design systems, state management, responsive design, WCAG 2.1 AA accessibility | Building or modifying user-facing interfaces |
| [api-and-interface-design](skills/api-and-interface-design/SKILL.md) | Contract-first design, Hyrum's Law, One-Version Rule, error semantics, boundary validation | Designing APIs, module boundaries, or public interfaces |

### Verify - Prove it works

| Skill | What It Does | Use When |
|-------|-------------|----------|
| [flowly-verify](skills/flowly-verify/SKILL.md) | Attach a loop run's evidence packet as few substantial items — the packet caps at item count, not size, and reports its own truncation | A child issue's work is committed and its verification has been run |
| [browser-testing-with-devtools](skills/browser-testing-with-devtools/SKILL.md) | Chrome DevTools MCP for live runtime data - DOM inspection, console logs, network traces, performance profiling | Building or debugging anything that runs in a browser |
| [debugging-and-error-recovery](skills/debugging-and-error-recovery/SKILL.md) | Five-step triage: reproduce, localize, reduce, fix, guard. Stop-the-line rule, safe fallbacks | Tests fail, builds break, or behavior is unexpected |

### Review - Quality gates before merge

| Skill | What It Does | Use When |
|-------|-------------|----------|
| [flowly-review](skills/flowly-review/SKILL.md) | Hand a loop run to its human gate at `awaiting_review` and pick the work back up once a person has ruled — the verdict lives on the run, not the issue | A loop run has built something and a human has to rule on it |
| [code-review-and-quality](skills/code-review-and-quality/SKILL.md) | Five-axis review, change sizing (~100 lines), severity labels (Nit/Optional/FYI), review speed norms, splitting strategies | Before merging any change |
| [code-simplification](skills/code-simplification/SKILL.md) | Chesterton's Fence, Rule of 500, reduce complexity while preserving exact behavior | Code works but is harder to read or maintain than it should be |
| [security-and-hardening](skills/security-and-hardening/SKILL.md) | OWASP Top 10 prevention, auth patterns, secrets management, dependency auditing, three-tier boundary system | Handling user input, auth, data storage, or external integrations |
| [performance-optimization](skills/performance-optimization/SKILL.md) | Measure-first approach - Core Web Vitals targets, profiling workflows, bundle analysis, anti-pattern detection | Performance requirements exist or you suspect regressions |

### Ship - Deploy with confidence

| Skill | What It Does | Use When |
|-------|-------------|----------|
| [flowly-ship](skills/flowly-ship/SKILL.md) | Record what a set of finished issues amounts to, as a dated release bundle — which ships nothing by itself | Finished work has to be grouped into a Flowly release |
| [git-workflow-and-versioning](skills/git-workflow-and-versioning/SKILL.md) | Trunk-based development, atomic commits, change sizing (~100 lines), the commit-as-save-point pattern | Making any code change (always) |
| [ci-cd-and-automation](skills/ci-cd-and-automation/SKILL.md) | Shift Left, Faster is Safer, feature flags, quality gate pipelines, failure feedback loops | Setting up or modifying build and deploy pipelines |
| [deprecation-and-migration](skills/deprecation-and-migration/SKILL.md) | Code-as-liability mindset, compulsory vs advisory deprecation, migration patterns, zombie code removal | Removing old systems, migrating users, or sunsetting features |
| [documentation-and-adrs](skills/documentation-and-adrs/SKILL.md) | Architecture Decision Records, API docs, inline documentation standards - document the *why* | Making architectural decisions, changing APIs, or shipping features |
| [observability-and-instrumentation](skills/observability-and-instrumentation/SKILL.md) | Structured logging, RED metrics, OpenTelemetry tracing, symptom-based alerting - instrument as you build | Adding telemetry, or shipping anything that runs in production |
| [shipping-and-launch](skills/shipping-and-launch/SKILL.md) | Pre-launch checklists, feature flag lifecycle, staged rollouts, rollback procedures, monitoring setup | Preparing to deploy to production |

---

## Agent Personas

Pre-configured specialist personas for targeted reviews:

| Agent | Role | Perspective |
|-------|------|-------------|
| [code-reviewer](agents/code-reviewer.md) | Senior Staff Engineer | Five-axis code review with "would a staff engineer approve this?" standard |
| [test-engineer](agents/test-engineer.md) | QA Specialist | Test strategy, coverage analysis, and the Prove-It pattern |
| [security-auditor](agents/security-auditor.md) | Security Engineer | Vulnerability detection, threat modeling, OWASP assessment |
| [web-performance-auditor](agents/web-performance-auditor.md) | Web Performance Engineer | Core Web Vitals audit with Quick/Deep modes and a metric-honesty rule |

See [docs/agents.md](docs/agents.md) for the decision matrix, orchestration rules, and how personas compose with skills.

---

## Reference Checklists

Quick-reference material that skills pull in when needed:

| Reference | Covers |
|-----------|--------|
| [definition-of-done.md](references/definition-of-done.md) | Project-wide standing bar every change clears, contrasted with per-task acceptance criteria |
| [testing-patterns.md](references/testing-patterns.md) | Test structure, naming, mocking, React/API/E2E examples, anti-patterns (JavaScript/TypeScript) |
| [security-checklist.md](references/security-checklist.md) | Pre-commit checks, auth, input validation, headers, CORS, OWASP Top 10 |
| [performance-checklist.md](references/performance-checklist.md) | Core Web Vitals targets, frontend/backend checklists, measurement commands |
| [accessibility-checklist.md](references/accessibility-checklist.md) | Keyboard nav, screen readers, visual design, ARIA, testing tools |
| [observability-checklist.md](references/observability-checklist.md) | On-call questions, structured logging, RED/USE metrics, tracing, symptom-based alerting, pre-launch gate |
| [orchestration-patterns.md](references/orchestration-patterns.md) | Endorsed multi-persona orchestration patterns, anti-patterns, and the "personas don't invoke personas" rule |

---

## How Skills Work

Every skill follows a consistent anatomy:

```
┌─────────────────────────────────────────────────┐
│  SKILL.md                                       │
│                                                 │
│  ┌─ Frontmatter ─────────────────────────────┐  │
│  │ name: lowercase-hyphen-name               │  │
│  │ description: Guides agents through [task].│  │
│  │              Use when…                    │  │
│  └───────────────────────────────────────────┘  │
│  Overview         → What this skill does        │
│  When to Use      → Triggering conditions       │
│  Process          → Step-by-step workflow       │
│  Rationalizations → Excuses + rebuttals         │
│  Red Flags        → Signs something's wrong     │
│  Verification     → Evidence requirements       │
└─────────────────────────────────────────────────┘
```

**Key design choices:**

- **Process, not prose.** Skills are workflows agents follow, not reference docs they read. Each has steps, checkpoints, and exit criteria.
- **Anti-rationalization.** Every skill includes a table of common excuses agents use to skip steps (e.g., "I'll add tests later") with documented counter-arguments.
- **Verification is non-negotiable.** Every skill ends with evidence requirements - tests passing, build output, runtime data. "Seems right" is never sufficient.
- **Progressive disclosure.** The `SKILL.md` is the entry point. Supporting references load only when needed, keeping token usage minimal.
- **Frontmatter is two fields.** `name` and `description`, nothing else — the intersection that loads on every door. Enforced by `scripts/validate-standard.sh`.

---

## Project Structure

```
flowly-agent-skills/
├── skills/                            # 33 skills (32 lifecycle + 1 meta)
├── agents/                            # 4 specialist personas
├── references/                        # 7 supplementary checklists
├── commands/                          # the 6 lifecycle commands, each taking an issue identifier
├── hooks/                             # session lifecycle hooks
├── evals/                             # skill eval cases + framework
├── scripts/                           # the structural gates (see below)
├── docs/                              # format spec, adoption, onboarding
├── .claude-plugin/                    # marketplace.json + plugin.json
├── .codex-plugin/                     # Codex manifest — door kept openable, undocumented
├── LICENSE                            # MIT — upstream's copyright and ours
└── NOTICE.md                          # derivation, base SHA, and the ownership register
```

The plugin manifest declares `skills` and deliberately declares **no** `commands` key. Declaring one
*replaces* Claude Code's default scan rather than adding to it — and that default scan reads
`<plugin-root>/commands/`, which is where the six live. Staying silent in the manifest is what
registers them.

---

## Checks

Five gates run over this repository. Each one has a mutation that turns it red, which is the only
reason to believe it works:

| Check | Asserts | Turns red when |
|---|---|---|
| `node scripts/validate-skills.js` | Frontmatter, description trigger and length, required sections, `name` matches the directory | A required section is deleted |
| `./scripts/validate-standard.sh` | Frontmatter carries exactly `name` and `description` | Any third key is added |
| `node scripts/check-commands.js` | Exactly six commands, each with a description, no substitution token in any body, the identifier-resolution block verbatim in all six, every named skill resolving, and a rendered size under Codex's migration cap | A substitution token is added to a command body |
| `node scripts/check-no-hosts.js` | No hostname outside a curated allowlist, and no absolute workspace path, anywhere in the tree | Any new hostname appears |
| `node scripts/check-register.js` | Every shipped file is registered exactly once, the base SHA is an ancestor of `HEAD`, and every `unchanged` file really is byte-identical to it | A file is added without a register row |

`check-no-hosts.js` is the one that matters most. This repository is public, making a repository
public later does not scrub its history, and GitHub's push protection matches credential patterns —
a hostname matches none of them.

---

## Why skills?

AI coding agents default to the shortest path - which often means skipping specs, tests, security reviews, and the practices that make software reliable. These skills give agents structured workflows that enforce the same discipline senior engineers bring to production code.

Each skill encodes hard-won engineering judgment: *when* to write a spec, *what* to test, *how* to review, and *when* to ship. These aren't generic prompts - they're the kind of opinionated, process-driven workflows that separate production-quality work from prototype-quality work.

Skills bake in best practices from Google's engineering culture — including concepts from [Software Engineering at Google](https://abseil.io/resources/swe-book) and Google's [engineering practices guide](https://google.github.io/eng-practices/). You'll find Hyrum's Law in API design, the Beyonce Rule and test pyramid in testing, change sizing and review speed norms in code review, Chesterton's Fence in simplification, trunk-based development in git workflow, Shift Left and feature flags in CI/CD, and a dedicated deprecation skill treating code as a liability. These aren't abstract principles — they're embedded directly into the step-by-step workflows agents follow.

---

## Contributing

Skills should be **specific** (actionable steps, not vague advice), **verifiable** (clear exit criteria with evidence requirements), **battle-tested** (based on real workflows), and **minimal** (only what's needed to guide the agent).

See [docs/skill-anatomy.md](docs/skill-anatomy.md) for the format specification and [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Attribution

This is a hard fork of an MIT-licensed upstream project, taken at a pinned commit and merged
periodically. It is **not affiliated with, endorsed by, or published by** that project or its
author — bugs here are ours, and should not be reported upstream.

The derivation, the base commit, the sync procedure, and a per-file register of what is inherited
versus what is ours are all in **[NOTICE.md](NOTICE.md)**. The upstream copyright is preserved
verbatim in **[LICENSE](LICENSE)**.

---

## License

MIT - use these skills in your projects, teams, and tools.
