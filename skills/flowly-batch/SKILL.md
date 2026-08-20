---
name: flowly-batch
description: Works a named batch of Flowly issues to done in one pass — a set-targeted loop run holds the whole queue, drives each issue through its status and its tests, and hands the batch to a human once as an evidence packet. Use when several already-understood fixes should be worked in one pass, use when resuming a batch a previous session left part-way, and use when the per-issue research and approval ceremony is not worth paying several times over.
---

# Working a batch of issues in Flowly

## Overview

Every other Flowly lifecycle command takes exactly one issue, and each one that is planned costs four planning docs, a submit, a human approval and a build. For five small fixes that is five approvals — more ceremony than doing them by hand, not less.

A batch is the other shape. **One run holds the whole queue.** A loop run whose target is a *set* of issues carries the list, accumulates the evidence as the work goes, and reaches `awaiting_review` once — which is the single place a human looks at all of it.

The run is the batch. There is no checklist file, no parent issue and no plan document; position lives in the issues' own statuses and in the run's membership rows, which is what makes an interrupted batch resumable by a session that remembers nothing.

## When to Use

- Several small issues are already understood and need working in one pass
- A previous session stopped part-way through a batch and it needs picking up
- A set of fixes is too small each to justify the planning-doc ceremony, and too many to want five separate approvals

**When NOT to use:**

- **One issue.** Use the ordinary build loop; a batch of one is ceremony with no payoff.
- **Issues that are not yet understood.** A batch works a queue; it does not decide what the work is. If any member needs research or a design decision, it needs a plan, and it is not a batch member.
- **Issues that depend on each other.** A batch has an order but no dependency graph, and it will not re-order or stop when a later issue turns out to need an earlier one. Related work belongs under a plan whose conversion produces ordered children.
- **A parent issue's children.** Those already have a plan and an order. Build them.

## The Shape

A loop declares the KIND of target it takes; a run holds the actual targets. So a batch needs a loop whose `target_kind` is `issue_set`, and then one run of it against the issues named.

1. `list_loops` for one whose `target_kind` is `issue_set`, or `create_loop` with that kind. One such loop is reused for every batch — it is a recipe, not a queue.
2. `run_loop(loop_id, targets=[...], autonomy=2)`. `targets` is the list of issue identifiers, **in the order they should be worked**. That order is stored and a resumed run walks it the same way.
3. `advance_loop_run(run_id, status="running")`.
4. Per issue, in order: `update_issue` to `in_progress`, do the work test-first, commit, `update_issue` to `done`, `attach_evidence`.
5. `advance_loop_run(run_id, status="awaiting_review")` — which notifies every human on the team.
6. **Stop.** The verdict is theirs and there is no tool for it.

### Autonomy 2

Level 2 is the level at which the agent may start its own run and drive it to the gate. At the default level it cannot start the run it just created. Levels 4 and 5 are refused outright — they name capabilities this product does not have.

## The Run Stays in the Plan Phase

A run has a `status` and a `phase`, and they are **independent columns**. The batch moves its status — `queued`, `running`, `awaiting_review` — and never touches its phase.

That is deliberate, and it is worth stating plainly rather than letting it look like an oversight: a set-targeted run has no plan phase to leave. Its issues carry their own plan gates, and the batch is judged as a whole when it reaches `awaiting_review`. **Asking such a run to move from `plan` to `build` is refused**, at every autonomy level and for a human too.

So a batch run reads `phase: plan` while code is being written. Do not try to "correct" it. The refusal is the design, and the status is what says where the work is.

## One Commit Per Issue, Per Repository

Each issue gets its own commit, staging only that issue's files. That is what makes each issue a rollback point; two issues in one commit collapses two rollback points into none.

**An issue that touches two repositories takes two commits — one in each.** They are separate histories and nothing can make them atomic. The rule is unchanged: still one commit per issue per repository, still nothing else staged.

The failure that follows from it is the one to plan for. If the run stops between those two commits, one repository has the change and the other does not. Leave the issue `in_progress`, say in a comment which repository landed and which did not, and let the resume finish it. **Never write `done` until every repository the issue touched is committed** — a `done` issue with half its work committed is a tracker that lies to the next run.

## Never Mark the Run Failed

A failed run is terminal: nothing may follow it, so it cannot be picked back up after the problem is fixed. A batch that hits trouble is almost never finished — it is *interrupted*, and interrupted work should stay resumable.

When a batch cannot continue:

- Leave the current issue `in_progress` and `add_comment` on it saying exactly where it stopped.
- `attach_evidence` a `note` on the run recording what was done and what remains.
- `advance_loop_run(run_id, status="awaiting_review")`.

That hands a partial batch to a human with its evidence intact, and leaves a run a later session can still read. Marking it `failed` buys nothing and closes the door.

## Resuming

A new session holds no run id. It finds the batch the same way it finds any run: `list_loop_runs(target=<any one of the issues>)`, which matches a run that **names** the issue or **contains** it.

Do that before starting anything. Nothing found reads the same as no run in flight, and a second run over issues the first is part-way through is the mistake this lookup prevents.

Then read the issues' statuses. The next issue is the lowest-positioned one that is neither `done` nor `canceled`; one sitting `in_progress` means a previous run stopped inside it, so read it, read its comments, and look at the working tree before carrying on.

## Stopping Early

Stop, and do not start the next issue, when:

- An issue turns out to need a decision the batch cannot make — that is a plan, not a bigger commit
- An issue turns out to depend on another that is not done
- A check goes red for a reason outside the issue being worked
- The working tree was not clean when the run started

In every case: comment on the issue in flight, attach the note, advance to `awaiting_review`, stop. Do not widen an issue to absorb the surprise and do not push past one of these because the rest of the batch looks easy.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll write the queue to a file so I can resume" | The run holds the queue and the issues hold the position. A file is a second tracker that goes stale the moment a run is interrupted — the exact case it was written for. |
| "The run says `plan` while I'm writing code, I should move it to `build`" | A set-targeted run has no plan phase to leave, and the move is refused. The status says where the work is; the phase is not the batch's to move. |
| "These two issues are tiny, one commit is cleaner" | One commit per issue is what makes each issue revertible. Two in one is zero rollback points, not one. |
| "This issue touches both repos, so it is one commit each way — I'll mark it done after the first" | `done` means every repository it touched is committed. Half-committed and `done` is a tracker that lies to the next run. |
| "The batch broke, I'll mark the run failed" | Failed is terminal and cannot be resumed. An interrupted batch is not a finished one — comment, attach a note, and take it to `awaiting_review`. |
| "I'll plan each of these properly first" | Then they are not a batch. The whole point is the issues are already understood; if one is not, it needs a plan and does not belong here. |
| "These issues are related, so a batch keeps them together" | A batch has an order, not a dependency graph. It will not stop when a later issue needs an earlier one. Related work belongs under a plan. |
| "I'll start a fresh run, it's simpler than finding the old one" | A second run over the same issues means two runs claiming the same work and one evidence packet that describes half of it. Look the run up by any member first. |
| "Nobody needs telling, the work is in the tracker" | Status writes and comments on an unassigned issue reach no inbox. Only the run reaching `awaiting_review` notifies the team. Skipping it means the work is done and nobody knows. |
| "The human can approve the batch through a tool" | There is no such tool. The verdict is a human action in Flowly's web app. |

## Red Flags

- A queue, checklist or progress file written to the working tree
- A run advanced from `plan` to `build`, or repeated attempts to
- One commit spanning two issues, or a stage-everything commit
- An issue marked `done` while one of the repositories it touched is uncommitted
- A run marked `failed`
- A new run started without first looking one up by a member issue
- Issues worked in an order other than the one the run holds
- The batch finished without the run ever reaching `awaiting_review`
- An issue widened mid-batch to absorb something the batch did not plan for
- A batch whose members turn out to depend on each other, worked anyway

## Verification

Before the first issue:

- [ ] `list_loop_runs` was called against a member and returned nothing in flight, or returned the run being resumed
- [ ] The loop's `target_kind` is `issue_set`
- [ ] The run exists, holds every issue, and is `running`
- [ ] The working tree is clean
- [ ] Any issue already `in_progress` has been read and accounted for

For each issue, before moving on:

- [ ] It is the only issue in flight
- [ ] Its status was `in_progress` before any code was written
- [ ] Its tests were run and the output read
- [ ] Exactly one commit exists per repository it touched, staging only its files
- [ ] It was marked `done` only after every one of those commits existed

Before stopping:

- [ ] Every issue is `done`, `canceled`, or named in a comment saying where it stopped
- [ ] Evidence is attached to the run
- [ ] The run is `awaiting_review`, so a human has actually been told
- [ ] The run was never marked `failed`
- [ ] Nothing was written to the working tree except code and its tests

## See Also

`flowly-loop-runs` — autonomy levels, the three gates, and what a run's status and phase each mean. This skill uses one shape of run; that one covers all of them.

`flowly-build` — the queue derived from an approved plan's child issues. The inner loop per issue is the same; where the queue comes from is not.

`test-driven-development` and `incremental-implementation` — the inner loop inside each issue.
