---
name: flowly-build
description: Walks a Flowly parent issue's child issues to done one at a time, deriving the queue from the tracker rather than from any local file — filtering the project listing by parent, sorting it, writing each child's status transitions, and committing once per child. Use when a Flowly issue's plan gate reports approved and it is time to build its child issues, use before an autonomous build run across those children, and use after an interrupted build has to pick up from child status.
---

# Building in Flowly

## Overview

By the time this skill applies, the plan is written, a human has approved it, and conversion has turned its tasks into child issues. Building is therefore not a fresh judgement about what to do next — it is a walk over a queue Flowly already holds, one child at a time, with the tracker recording position as the run goes.

The queue is derived from the issue graph on every run. Nothing about it is cached locally, and no file on disk records where the run got to. That is what makes an interrupted run resumable and an autonomous run safe to stop.

This skill governs the loop. What belongs in a single task was settled by the `flowly-plan` skill; how to implement one is the `incremental-implementation` skill and the `test-driven-development` skill. This is where they get sequenced, and where the status writes and the commits happen.

## When to Use

- A parent issue's plan gate reports `approved` and its child issues exist
- You are working a list of child issues rather than one isolated fix
- An autonomous run has been asked for and needs an order and a stopping condition
- A previous run stopped part-way and the work needs picking up

**When NOT to use** — an issue whose plan is not approved (plan it first, and wait for the human), a one-line fix with no issue behind it, or a single child handed over on its own with no queue to walk.

## The Precondition

`get_review(identifier)` on the **parent** issue reports the plan gate. It takes five values, and exactly one of them permits building.

| review state | means | build? |
|---|---|---|
| `none` | nothing planned yet | no — plan it |
| `planning` | docs are being written | no |
| `in_review` | handed to a human, not yet judged | no — wait |
| `changes_requested` | a human wants something different | no — revise, resubmit |
| `approved` | a human approved it | yes |

**There is no file gate.** This distribution has no specification file, no charter file and no plan file in the working tree; nothing on disk grants permission to build and nothing on disk withholds it. An agent that goes looking for such a file is looking for something that will never exist, and an agent that treats its absence as a blocker — or its presence as an approval — is reading the wrong signal. The plan gate is the only signal, and only a human moves it to `approved`.

## The Queue

### Enumerate

`list_issues` takes `project_id`, `status`, `assignee` and `release`. **It has no parent filter** — no `parent`, no `parent_identifier`. The children are found by listing the project and filtering client-side:

1. `get_issue(parent)` — take the parent's own id and the project it belongs to. Note that this is the internal id, not the `FLO-` identifier: the two are different fields and the filter below compares against the internal one.
2. `list_issues(project_id=<the parent's project>)` — every summary it returns carries the id of its own parent, in that same internal form.
3. Keep the summaries whose parent id equals the parent's id.
4. Sort what is left by issue number, ascending.

Three properties of that list decide whether the result is trustworthy:

| property | consequence |
|---|---|
| capped at 250 results | in a project with more issues, an older parent's children can fall outside the window |
| no pagination | there is no second page to ask for |
| truncation is silent | you get a short list, never an error |

So the count is the check. Read the parent's task list — `list_planning_docs(parent)` returns the `todo` doc — and compare the number of tasks against the number of children found. If they disagree, the enumeration is incomplete: say so and stop. Do not build the subset you happened to receive; a truncated queue silently drops the oldest work, which is usually the work everything else depends on.

### Order

`list_issues` returns newest first. Conversion created the children in dependency order, ascending. **The returned order is therefore the reverse of the order that matters** — measured on a real parent with 27 children, the last task in the plan came back first and the first task came back last.

Sort by issue number ascending, always. That ascending order *is* the dependency order conversion produced, and it is the only surviving record of it. Never take the returned order as the execution order, and never infer order from titles.

### When ascending number is not enough

The dependency graph does not reach the child issue: a child's body deliberately omits its dependencies, because a task's number is local to the parent's task list and names nothing once the children exist. Mapping those dependencies onto real issue identifiers is a known, unimplemented gap. So a child that looks self-contained may not be.

The graph does still exist, in the parent's `todo` planning doc. When order matters beyond "ascending number" — a child that fails because something it needs is not there yet — read that doc with `list_planning_docs(parent)` and match each task to its child **by title**: the child's title is the task's title verbatim. Match on titles and read the prose; do not depend on the document's markdown shape, which the server owns and changes on its own schedule.

## Status Transitions

Issue status is a closed set of six values — `triage`, `backlog`, `todo`, `in_progress`, `done`, `canceled` — and `update_issue(identifier, status=…)` writes it. Converted children arrive as `backlog`, priority 0, unassigned.

| moment | write |
|---|---|
| this run intends to take a child (optional queue marking) | `backlog → todo` |
| work on a child starts, before any code | `backlog → in_progress` |
| the child's acceptance is met **and** its commit exists | `in_progress → done` |
| the plan turned out not to need this child | `→ canceled`, with a comment saying why |

Supporting calls: `assign_issue` to put a child on an actor, `whoami` to learn which actor this agent is, `list_issues(assignee="me")` to narrow a listing to that actor's work, `add_comment` to record anything a status cannot carry.

Review verdicts are not statuses. There is no `approved` issue status; approval lives on the parent's plan gate and nowhere else.

## The Loop

### Before the first child

1. `get_review(parent)` reports `approved`.
2. The child queue is enumerated and its count reconciled against the parent's task list.
3. **The working tree is clean.** An autonomous run commits by itself, once per child; anything already sitting uncommitted gets swept into the first of those commits, and a commit carrying someone else's half-finished work is no longer a rollback point. There is no list of expected local changes to wave through — nothing in this workflow writes to the working tree, so a dirty tree is unexplained by construction. Report what is there and let the human decide. Do not stash it, do not commit it, and do not build around it.
4. Uncommitted planning artefacts are the same rule at its sharpest. A plan, a task list, a checklist or a specification sitting in the working tree should not exist at all — every one of those belongs to the issue, written through Flowly's tools. Finding one means an earlier step wrote to disk; that is a defect to report, never a file to accept.

### Per child

1. Take the lowest-numbered child that is neither `done` nor `canceled`.
2. `get_issue(child)`. Its acceptance and verification lines are the contract — read them off the issue rather than from a memory of the plan.
3. `update_issue(child, status="in_progress")` **before** writing code, so an interrupted run is legible to the next one.
4. Implement it: a failing test first, then the smallest change that passes it.
5. Run the child's own verification step and observe the result. A verification that was not run is not evidence, and neither is one whose output nobody read.
6. Commit once, staging only the files this child touched. Never stage everything.
7. `update_issue(child, status="done")` — only once the commit exists.
8. Return to step 1.

One commit per child, containing only that child's work, is what makes each child a clean rollback point. Two children in one commit collapses two rollback points into none.

### Stopping

The loop ends when no child remains that is neither `done` nor `canceled`.

Stop early, without starting the next child, when any of these is true:

- The enumeration looks truncated, or the child count disagrees with the task count
- The working tree was not clean at the start
- A child's verification fails and the cause is outside that child's scope
- A child needs work the plan does not cover — that is a plan revision, not a bigger commit
- A child depends on something no child provides
- The parent's review state is anything but `approved`

On an early stop, leave the current child's status truthful — `in_progress` if work started — and `add_comment` on it saying where the run stopped and why. A silent stop leaves the next run a child it cannot interpret.

Collecting an evidence packet is the verify phase's artifact and belongs to that phase's command and skill. This loop commits; it does not attach evidence.

## Resuming

Re-invoking the command re-derives position from the tracker. There is no checklist file to read, and writing one would create a second tracker that drifts from the first.

- The next child is **the lowest-numbered child that is neither `done` nor `canceled`.**
- A child sitting in `in_progress` means a previous run stopped inside it. Read that child and its comments, then look at the working tree and the last commit before continuing. Its work may be half-done, half-committed, or committed but never marked. Never assume an `in_progress` child is untouched, and never restart it from scratch without checking what already landed.
- A `canceled` child is skipped, not revisited.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll just filter the issue list by parent" | There is no parent argument — `project_id`, `status`, `assignee` and `release` are the whole set. List the project and filter on each summary's parent id yourself. |
| "The list came back in an order, I'll work it top to bottom" | It comes back newest first, so the plan's last task is first in hand. Sort ascending by number or you will build the dependents before their dependencies. |
| "There's no spec file, so there's nothing to check" | The precondition is the parent's review state, not a file. No file on disk ever grants or withholds it. |
| "The plan is obviously fine, the gate is a formality" | Only a human reaches `approved`, and there is no argument that skips it. If it is not approved, this loop does not start. |
| "27 children came back, so there are 27 children" | The window is 250, newest first, and truncation is silent. Reconcile the count against the parent's task list before trusting it. |
| "The child's body lists no dependencies, so it has none" | The body omits them by design. The graph is in the parent's `todo` doc; match tasks to children by title. |
| "There are a few unrelated edits in the tree, I'll commit everything" | That absorbs someone else's work into a child's commit and destroys the rollback point. Stop and hand the dirty tree back. |
| "These two children are tiny, one commit is cleaner" | One commit per child is what makes each child revertible. Two in one is zero rollback points, not one. |
| "I'll mark it done and fix the failing test in the next child" | `done` means the acceptance is met and the commit exists. Anything else makes the tracker lie to the next run. |
| "I'll write my progress to a checklist file so I can resume" | Position lives in child status. A file is a second tracker that goes stale the moment a run is interrupted — the exact case it was written for. |
| "This child is `in_progress`, a previous run must have just started it" | It may be half-implemented or half-committed. Read the child and the tree before touching it. |
| "The child is trivial, I'll skip the status writes and do them at the end" | The status write is the resume record. Skipping it is how a crashed run comes back as an untouched-looking queue. |
| "I'll set the child to `approved` when it passes" | Not a status. The six values are `triage`, `backlog`, `todo`, `in_progress`, `done`, `canceled`. |

## Red Flags

- A list call passed a `parent` or `parent_identifier` argument
- Children worked in the order the listing returned them
- A child count that lands exactly on the 250-result cap, accepted as complete
- Implementation starting while the parent's review state is anything but `approved`
- A search of the working tree for a specification, plan or charter file before building
- Dependency order inferred from a child issue's body
- A stage-everything commit, or one commit spanning two children
- A child moved to `done` with its verification unrun, failing, or unread
- A child left in `backlog` while its code is being written
- A resume that starts from a file rather than from child status
- An `in_progress` child adopted, or restarted, without reading it first
- A planning artefact, checklist or task list written to the working tree at any point
- An early stop with no comment on the child that was in flight

## Verification

Before the first child:

- [ ] `get_review(parent)` reports `approved`
- [ ] Children were enumerated by listing the parent's project and filtering on parent id
- [ ] The child count reconciles with the number of tasks in the parent's `todo` doc
- [ ] The queue is sorted by issue number, ascending
- [ ] The working tree is clean, with nothing uncommitted carried into the run
- [ ] Any child already in `in_progress` has been read and accounted for

For each child, before moving on:

- [ ] Its status was set to `in_progress` before any code was written
- [ ] Its acceptance and verification were read from the issue itself
- [ ] Its verification was run and the output observed
- [ ] Exactly one commit exists, staging only the files this child touched
- [ ] Its status was set to `done` only after that commit existed

Before the run stops:

- [ ] Every child is `done` or `canceled`, or the stop condition is named
- [ ] No child is left in `in_progress` without a comment saying where it stopped
- [ ] Nothing was written to the working tree except code and its tests

## See Also

The `flowly-plan` skill — how the plan, the task list and the gate that precedes this loop are written, and why nothing lands on disk.

The `incremental-implementation` skill and the `test-driven-development` skill — the inner loop inside step 4 of each child. When a child's verification fails for reasons the child does not explain, the `debugging-and-error-recovery` skill applies before any status is written.
