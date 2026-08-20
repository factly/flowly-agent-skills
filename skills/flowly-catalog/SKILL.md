---
name: flowly-catalog
description: Routes an incoming task to the one skill that governs it, across the six lifecycle phases plus the two that sit under all of them, and states the shared Flowly conventions the rest of the pack assumes about priority, pagination, list caps and silently ignored arguments. Use when starting a session, when you do not know which skill or workflow applies to a piece of work, and before the first Flowly tool call of a run.
---

# Flowly Skill Catalog

## Overview

This pack is a set of engineering workflows, each one a process a senior engineer follows, arranged along six phases: **Define → Plan → Build → Verify → Review → Ship**. Two skills sit under all six rather than inside one, and this catalog is the third.

Two kinds of skill live here and they are not alternatives:

- The `flowly-` skills **bind a phase to the tracker**. They say where an artifact lives, who approves it, and what moves a status.
- The inherited skill beside each one **governs the craft**. It says how to do the work well, and it is silent about where the result goes.

A feature usually runs one of each per phase. `flowly-review` is where a run's verdict lives; `code-review-and-quality` is how to form one. `flowly-ship` is the release record; `shipping-and-launch` is launch readiness.

This file is also the only place the shared Flowly conventions are written down. Every other skill assumes they were read, and each one is a rule the server does not enforce at the door: break it and the call succeeds, wrongly.

## When to Use

- At the start of a session, before picking an approach
- When a task arrives and you do not know which phase it belongs to
- When two skills both look applicable and you need to know whether to run one or both
- Before the first Flowly tool call of a run, to read the conventions below
- When a skill you were routed to turns out not to fit, and you need the next one

**When NOT to use** — once you are inside a skill. This document routes; it does not carry any phase's process. Open the skill it names and follow that. Coming back here mid-task to re-derive the route is how a workflow gets abandoned halfway.

## Route by Phase

```
Task arrives
    │
    ├── No Flowly tools in this session, or a call was refused? ──→ flowly-connect
    │
    ├── DEFINE — what are we building?
    │   ├── The ask is vague and you are filling in gaps ────────→ interview-me
    │   ├── A rough concept that needs options ─────────────────→ idea-refine
    │   ├── No Flowly issue behind the request yet ─────────────→ flowly-define
    │   └── Requirements need writing down ────────────────────→ spec-driven-development
    │
    ├── PLAN — how does it break down?
    │   ├── An issue exists and needs planning docs + tasks ────→ flowly-plan
    │   ├── The plan is written and a human must decide ────────→ flowly-plan-gate
    │   └── Decomposing a spec into verifiable units ───────────→ planning-and-task-breakdown
    │
    ├── BUILD — write the code
    │   ├── A queue derived from an approved plan's children ───→ flowly-build
    │   ├── A queue you named yourself, no parent, no plan ─────→ flowly-batch
    │   ├── The change touches more than one file ──────────────→ incremental-implementation
    │   ├── Any logic, any bug fix, any behaviour change ───────→ test-driven-development
    │   ├── Output quality is dropping, or context is wrong ────→ context-engineering
    │   ├── A framework or library decision needs grounding ────→ source-driven-development
    │   ├── Stakes are high, or the code is unfamiliar ─────────→ doubt-driven-development
    │   ├── User-facing interface work ────────────────────────→ frontend-ui-engineering
    │   └── An API, a module boundary, a public contract ───────→ api-and-interface-design
    │
    ├── VERIFY — prove it works
    │   ├── Evidence must be attached to a run or an issue ─────→ flowly-verify
    │   ├── It runs in a browser ──────────────────────────────→ browser-testing-with-devtools
    │   └── Something broke and the cause is unknown ───────────→ debugging-and-error-recovery
    │
    ├── REVIEW — is it good enough?
    │   ├── A run needs its verdict recorded ──────────────────→ flowly-review
    │   ├── Reviewing a change before merge ───────────────────→ code-review-and-quality
    │   ├── It works but reads badly ──────────────────────────→ code-simplification
    │   ├── Untrusted input, auth, secrets, third parties ─────→ security-and-hardening
    │   └── It is slow, or a budget is at risk ────────────────→ performance-optimization
    │
    └── SHIP — get it out
        ├── A release record grouping issues ──────────────────→ flowly-ship
        ├── Committing, branching, versioning, changelog ──────→ git-workflow-and-versioning
        ├── Pipeline and quality gates ────────────────────────→ ci-cd-and-automation
        ├── Retiring an old system or migrating users ─────────→ deprecation-and-migration
        ├── A decision worth recording ────────────────────────→ documentation-and-adrs
        ├── Production behaviour must be visible ──────────────→ observability-and-instrumentation
        └── Deploying, rollout, rollback ──────────────────────→ shipping-and-launch

Working inside a loop run at any point above ──────────────────→ flowly-loop-runs
```

## Skill Index

Every skill in this pack, and nothing that is not in it. `All` means the skill sits under all six phases rather than inside one.

| Phase | Skill | Route here when |
|---|---|---|
| All | `flowly-catalog` | You are cold, or a route is unclear — this document, and the conventions below |
| All | `flowly-connect` | Flowly's tools are missing from the session, or a call came back refused |
| All | `flowly-loop-runs` | A loop or run is involved — a run spans plan and build rather than sitting in either |
| Define | `flowly-define` | A request has no Flowly issue behind it, or nothing has been researched against one |
| Define | `interview-me` | The ask is underspecified and you are about to guess what was meant |
| Define | `idea-refine` | A rough concept needs options generated and then narrowed |
| Define | `spec-driven-development` | Requirements and acceptance criteria have to exist before code does |
| Plan | `flowly-plan` | An issue needs its planning docs and its task list written through Flowly |
| Plan | `flowly-plan-gate` | The plan is written and a human must approve it, or a verdict has landed |
| Plan | `planning-and-task-breakdown` | A spec has to become small, ordered, verifiable units |
| Build | `flowly-build` | The issues to work are one parent's children, ordered by its approved plan |
| Build | `flowly-batch` | The issues to work are a set somebody named — no parent, no plan, no order but yours |
| Build | `incremental-implementation` | The change touches more than one file, or feels too big to land at once |
| Build | `test-driven-development` | Any logic is being written, any bug fixed, any behaviour changed |
| Build | `context-engineering` | A session is starting, tasks are switching, or output quality has dropped |
| Build | `source-driven-development` | A framework or library decision has to be grounded in official documentation |
| Build | `doubt-driven-development` | Stakes are high, the code is unfamiliar, or a confident answer is cheap to check now |
| Build | `frontend-ui-engineering` | A user-facing interface is being built or changed |
| Build | `api-and-interface-design` | An API, a module boundary or any public contract is being designed |
| Verify | `flowly-verify` | Evidence has to be produced and attached where a reviewer will read it |
| Verify | `browser-testing-with-devtools` | The thing under test runs in a browser and needs real runtime data |
| Verify | `debugging-and-error-recovery` | Something broke and the cause is not yet known |
| Review | `flowly-review` | A run needs its verdict recorded, or a review is being asked for |
| Review | `code-review-and-quality` | A change is about to merge and has not been reviewed across all five axes |
| Review | `code-simplification` | The code works but is harder to read or extend than it needs to be |
| Review | `security-and-hardening` | Untrusted input, authentication, secrets or a third-party integration is involved |
| Review | `performance-optimization` | Something is slow, or a performance budget is at risk |
| Ship | `flowly-ship` | Work is being grouped into a release record and moved to shipped |
| Ship | `git-workflow-and-versioning` | Committing, branching, versioning, tagging or writing a changelog |
| Ship | `ci-cd-and-automation` | Build and deployment pipelines, or automated quality gates |
| Ship | `deprecation-and-migration` | An old system is being retired or users are being migrated off it |
| Ship | `documentation-and-adrs` | A decision was made that a future reader will need the reasoning for |
| Ship | `observability-and-instrumentation` | Production behaviour has to be visible and diagnosable |
| Ship | `shipping-and-launch` | A deployment, a staged rollout, or a rollback plan |

`scripts/check-catalog.js` holds this table to the skills tree in both directions: a name here with no directory is an error, and a directory with no row here is an error. The catalog is in its own table for that reason — an exemption would be a second place to register a skill, and it would be the first thing copied by whoever finds the rule inconvenient.

## Flowly Conventions

Five rules the whole pack depends on. Each one describes a call Flowly accepts and answers normally while doing something other than what the caller intended — which is why they are written down once, here, rather than assumed in thirty-two places.

### Priority is inverted

`priority` is an integer from 0 to 4, and the ramp runs:

| 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| none | urgent | high | medium | low |

**Lower is more urgent.** And `0` is not the bottom of that ramp — it is *unset*, and it sits outside the ramp entirely. Two mistakes follow directly: reading `priority: 1` as "low" has it exactly backwards, and writing `priority: 0` to mean "not urgent" silently clears the field instead of de-prioritising anything.

### `null` means two different things

On the `update_*` tools, omitted and `null` fields are **left untouched**. That is the partial-update contract, and for a NOT NULL column `null` is indistinguishable from omitted anyway.

A *nullable* column would need `null` to mean *clear it*, and one field cannot carry both meanings — an MCP JSON schema cannot express omitted-versus-null at all. So each nullable link gets its own tool with a required nullable argument: `assign_issue` and `set_issue_milestone`. Passing `null` **there** does clear the link.

Same JSON value, opposite meanings, decided entirely by which tool you called. Unassigning through `update_issue` is a no-op that reports success.

`update_issue` also carries no `review_state` and no `parent_id`: the gate moves only through the review actions, and children are created only by conversion.

### There is no pagination

No list tool takes `limit`, `offset`, `cursor` or `page`. `list_issues` takes `project_id`, `status`, `assignee` and `release`, and nothing else. Inventing a paging argument does not page — see the last convention for what it does instead.

### Every list is capped

Reads are capped at **250 rows**, and a caller who hits the ceiling **is not told**. A short answer and a truncated answer look identical, so "that project has 250 issues" is a number to distrust rather than report.

The single exception is the loop-run evidence packet, which carries an explicit `evidence_truncated` flag, because a human approves against exactly what they were shown.

Narrow the filter until the count is plainly under the cap, and say the number is a floor if you cannot.

### Unknown arguments are ignored, unknown values are refused

A misspelled or invented **argument name** is accepted and silently dropped. A bad **value** for a real argument is refused loudly with a validation error.

So `list_issues` called with `parent_identifier` — no such filter exists — returns every issue in the instance and reads as a filtered answer, while `list_issues(status="nonsense")` fails immediately and honestly. The failure that looks like success is the one worth guarding: check an argument name against the tool's schema before trusting a filtered result, and sanity-check the row count against what you expected.

Refusals arrive as an error result carrying **plain text**, not JSON. Parsing one as JSON throws, and the exception is about your parser rather than about the call.

## Core Operating Behaviors

These apply at all times, across every skill in the index. They are not phase-specific and they are not optional.

### 1. Surface assumptions

Before implementing anything non-trivial, state what you are assuming — about requirements, about architecture, about scope — and invite correction before proceeding. The most common failure is not a wrong answer; it is a right answer to a question nobody asked. Surfacing uncertainty early is cheaper than rework.

### 2. Manage confusion actively

On an inconsistency, a conflicting requirement or an unclear spec: **stop**. Name the specific confusion, present the tradeoff or ask the question, and wait. Silently picking one interpretation and hoping is the failure mode; "I see X in the issue but Y in the code — which wins?" is the fix.

### 3. Push back when warranted

You are not a yes-machine. When an approach has a clear problem, say so, quantify the downside where you can ("this adds ~200ms" rather than "this might be slower"), propose an alternative, and accept the human's decision once they have the full picture. Agreeing enthusiastically and then implementing a bad idea helps nobody.

### 4. Enforce simplicity

The natural tendency is to overcomplicate; resist it deliberately. Before finishing, ask whether this could be fewer lines, whether each abstraction is earning its complexity, and whether a staff engineer would say "why didn't you just…". If 1000 lines were written where 100 would do, that is a failure and not a thorough job.

### 5. Maintain scope discipline

Touch only what the task asks for. Do not remove comments you do not understand, tidy orthogonal code, refactor adjacent systems as a side effect, delete apparently-unused code without approval, or add features because they seem useful. Surgical precision, not unsolicited renovation.

### 6. Verify, do not assume

Every skill ends in a verification step, and a task is not done until it passes. "Seems right" is never evidence; a passing test, a build output or runtime data is.

Per-skill verification is the local check. The bar that applies to *every* change regardless of skill is the Definition of Done — tests pass, no regressions, behaviour verified at runtime, docs updated (`references/definition-of-done.md`). It complements a task's acceptance criteria; it does not replace them.

## Failure Modes to Avoid

The errors below all look like productivity while they are happening:

1. Making assumptions without checking them
2. Plowing ahead while lost instead of naming the confusion
3. Noticing an inconsistency and not surfacing it
4. Deciding something non-obvious without presenting the tradeoff
5. Agreeing with an approach that has a clear problem
6. Overcomplicating code and interfaces
7. Changing code or comments orthogonal to the task
8. Removing something you do not fully understand
9. Building with no spec because "it's obvious"
10. Skipping verification because "it looks right"
11. Reporting a list read as complete when it may have hit the cap
12. Treating a call that returned data as a call that did what you meant

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I know this task, I don't need to route it" | Routing costs one read of a table. The skills exist because the obvious approach skips a step that matters, and the step it skips is not obvious |
| "Two skills look right, so this catalog is ambiguous" | Both usually apply. The `flowly-` one binds the phase to the tracker; the one beside it governs the craft. Run both |
| "The skill I was sent to doesn't fit, so I'll improvise" | Come back and take the next route. Improvising is exactly what a router exists to prevent |
| "The list came back fine, so that's everything" | A capped read looks identical to a complete one. Nothing tells you which you got |
| "I set priority to 0 so it's the lowest" | `0` is unset. Low is `4`. The ramp is inverted and `0` is outside it |
| "I passed null to unassign it" | On `update_issue` that is a no-op reported as success. The dedicated link tool is what clears it |
| "The call succeeded, so the filter was applied" | An unknown argument name is dropped silently. A succeeding call proves the request parsed, not that it meant what you thought |
| "I'll add a limit argument to keep the response small" | There is no pagination. The argument is ignored and you get the capped list either way |
| "I'll re-read the catalog to check I'm still on track" | This document routes and then gets out of the way. Mid-task, the skill you are in is the authority |
| "The conventions are Flowly-specific, so they don't apply to my inherited skill" | Any skill that reads or writes through Flowly's tools is subject to all five. The tools do not know which skill called them |

## Red Flags

- Work started without identifying its phase
- A skill named in conversation that does not appear in the index above
- A `flowly-` skill run without the craft skill beside it, or the reverse, when both applied
- A count reported from a list read with no check that it is under the cap
- A `priority` value chosen without reference to the inverted ramp
- `null` passed to an `update_*` tool with the intention of clearing something
- An argument name passed to a Flowly tool that was not read off that tool's schema
- A filtered result trusted without a sanity check on the row count
- A tool refusal parsed as JSON
- Routing re-derived mid-task instead of finishing the skill in hand
- A phase skipped because the change "is small"

## Verification

Before starting work:

- [ ] The phase this task belongs to has been named
- [ ] The skill routed to is one that appears in the index above
- [ ] Where a `flowly-` skill and a craft skill both apply, both are in play
- [ ] `flowly-connect` has been run if the session has no Flowly tools

Before trusting any Flowly call:

- [ ] Every argument name was read off the tool's own schema, not guessed
- [ ] Any `priority` written was chosen against the inverted ramp, and `0` was not used to mean "low"
- [ ] Any intent to clear a link used the dedicated link tool, not `update_*` with `null`
- [ ] Any list read whose count could plausibly be at the cap was narrowed or reported as a floor
- [ ] Any refusal was read as text rather than parsed as JSON

## See Also

`flowly-connect` covers the door itself — the ways in, and what each refusal means. Every other skill in the index owns its own phase and states its own verification; this document names them and stops there.
