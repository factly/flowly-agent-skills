---
name: flowly-review
description: Drives a Flowly loop run through its human gate — attaching the evidence packet, handing over at awaiting_review, and picking the work back up once a person has ruled. Use when a Flowly loop run has built something and a human has to rule on it, use after the evidence packet is attached and the run needs handing over, and use when a verdict has landed on a Flowly run and the work has to continue.
---

# Review in Flowly

## Overview

The verdict on built work is a status on the **loop run**. Not on the issue, not in a file, not in a comment thread that someone might read. An agent brings a run to the point where a person can judge it, moves it to `awaiting_review`, and stops.

Stopping there is not a convention this skill recommends. It is what the door does: `advance_loop_run` **rejects `approved` and `changes_requested`**. Those two statuses are the human's verdict, they are written by one code path the agent cannot reach, and there is no tool, flag or argument that offers a second way in.

This skill is about the **verdict**: which object carries it, who may write it, and what an agent may still do around it. Three neighbours carry the rest and are not restated here — the judgement itself (the five axes, the severity labels, how to write a finding) is the `code-review-and-quality` skill's; what goes into the packet and how much of it is the `flowly-verify` skill's; the run's gates, autonomy ladder and full lifecycle are the `flowly-loop-runs` skill's.

## When to Use

- A loop run has produced work and a human has to see it before it goes further
- The evidence packet is being assembled and the run is about to be handed over
- A run is sitting in `awaiting_review` and you need to know what may still be done to it
- A verdict has landed — `approved` or `changes_requested` — and the run has to be picked up
- A new session has to find a run that a previous session left in flight

**When NOT to use** — reviewing a diff that no Flowly run tracks (that is plain code review), or asking whether a *plan* may proceed. The plan's gate is a different gate on a different object; see the next section before assuming otherwise.

## Two Gates, Two Objects

This is the distinction the whole Flowly corpus turns on, and it is the one a reader gets wrong most easily. Both gates use the words *approved* and *changes requested*. They are not the same gate.

| | The plan gate | Review |
|---|---|---|
| Lives on | the **issue** — `issue.review_state` | the **loop run** — `loop_run.status` |
| Read with | `get_review(identifier)` | `get_loop_run(run_id)` |
| Addressed by | `FLO-` identifier | run uuid |
| Asks | is this the right work? | is the work that got built good? |
| When | **before** any code exists | **after** the code exists |
| Handed over with | `submit_for_review(identifier)` | `advance_loop_run(run_id, status="awaiting_review")` |
| Values | `none`, `planning`, `in_review`, `changes_requested`, `approved` | `queued`, `running`, `awaiting_review`, `changes_requested`, `approved`, `completed`, `failed`, `canceled` |
| Verdict written by | a human, in Flowly's web app, only | a human, in Flowly's web app, only |

Two consequences worth stating plainly:

- **`get_review` does not read this skill's gate.** Its name is the trap. It takes an issue identifier and returns `review_state` — the plan gate, decided before anything was built. A code review read out of `get_review` is a report on a decision that was made days earlier about a different question. Use `get_loop_run(run_id)`.
- **An approved plan is not an approved run**, and a run reaching `approved` says nothing about the issue's `review_state`. The two are stored on different rows and move independently.

The word *review*, unqualified, means the run's gate. The issue's gate is always called the plan gate, and the `flowly-plan-gate` skill owns it.

## The Tools

Use these names exactly.

| tool | does |
|---|---|
| `list_loop_runs(target, loop_id, status)` | finds a run — **this is how a new session gets a run id** |
| `get_loop_run(run_id)` | one run — status, phase, gates, and the whole evidence packet |
| `attach_evidence(run_id, kind, content, url)` | adds one item to the packet; `kind` is `diff`, `test`, `log`, `link` or `note` |
| `advance_loop_run(run_id, status, phase)` | moves the run — status, phase, or both |
| `add_comment(identifier, body)` | replies to the human's feedback on the issue thread |
| `list_notifications(unread_only)` | how you learn a verdict landed without polling |
| `mark_notification_read(notification_id, mark_all)` | clears one or all — also re-arms de-duplication |
| `get_issue(identifier)`, `update_issue(identifier, …)` | the issue behind the run |

There is no `approve` tool. There is no `reject` tool. There is no tool of any kind that writes a verdict, because the verdict is not an agent capability.

## What the Agent May Write

`advance_loop_run` accepts exactly five statuses:

```
running   awaiting_review   completed   failed   canceled
```

and refuses the other two. `approved` and `changes_requested` are the human verdicts in the server's own vocabulary; they are written by the review action in Flowly's web app, reached over the human's own login, and by nothing else. An agent on the MCP door resolves to an agent actor and never to a human one — there is no flag that changes that, so the refusal is structural rather than a permission you might be granted.

These are the three statuses that sit either side of the gate. The full lifecycle table is the `flowly-loop-runs` skill's.

| from | where the agent may take it | how else it moves |
|---|---|---|
| `running` | `awaiting_review`, `failed`, `canceled` | — |
| `awaiting_review` | `failed`, `canceled` | **the human rules — `approved` or `changes_requested`** |
| `changes_requested` | `running`, `failed`, `canceled` | — |

Read the `awaiting_review` row twice. From there the agent can abandon the run or cancel it, and that is the whole list. **The human's verdict is the only other way out**, so waiting is a state the run is designed to sit in, not a stall to work around.

Read the `changes_requested` row too: it goes back to `running`. **A rejected packet is not a dead run.** Re-open the same run, fix what was asked for, attach the new evidence beside the old, and hand it over again. Cancelling and starting a fresh run throws away both the packet and the thread that explain the change.

Two refusals sit either side of the gate, and neither is an error to route around: `-> completed` is refused until the run is `approved`, because the ship gate is true on every run and cannot be turned off; and `plan -> build` is refused until the *issue's* plan gate reports `approved` — the other gate, reaching across.

## Process

### 1. Find the run

A run id does not survive a session. `list_loop_runs(target="FLO-1234")` finds the run already in flight against an issue — do that before starting another, or you will review one run while the work sits on a second. `list_loop_runs(status="awaiting_review")` answers "what is waiting on a person right now".

### 2. Check the packet is worth a person's time

The packet — the `diff`, `test`, `log`, `link` and `note` items on the run — is what the human reviews **instead of** your account of what you did. A summary that stands in for the work turns review into a reading exercise, which is exactly the failure the packet exists to prevent. What to attach and how much of it is the `flowly-verify` skill's subject.

What matters at the gate is a precondition, not a technique: `get_loop_run(run_id)` reads the packet back, and a packet that is empty, that is a summary, or that comes back with its truncation flag raised is **not ready to hand over**. Fix it before the next call, not after a reviewer has already opened it.

### 3. Hand over

`advance_loop_run(run_id, status="awaiting_review")`.

That call is the handover. It creates a `run_awaiting_review` notification for the humans who care about it, and it ends the agent's authority over the run's outcome.

If findings need words — a five-axis review you formed yourself, a caveat, a question — `add_comment` on the issue or `attach_evidence` as a `note`. Neither is a verdict and neither substitutes for one.

### 4. Stop

Do not poll in a tight loop, do not "provisionally proceed", and do not start the next piece of work on the assumption that this run will be approved. There is nothing further to write on the run except `failed` or `canceled`, and neither of those is what you mean.

### 5. Learn the verdict

`list_notifications(unread_only=true)` is the cheap read — a `review_decided` item names the issue that was ruled on. `get_loop_run(run_id)` is the authoritative one. Clear what you have acted on with `mark_notification_read`: while an item sits unread, further activity of the same kind on the same issue adds no new row, so an uncleared inbox goes quiet on exactly the thing you are waiting for.

### 6. Act on it

**On `changes_requested`** — read the comment thread with `get_review(identifier)` (its comment thread is useful even though its state is the other gate) or `list_comments`, then `advance_loop_run(run_id, status="running")`, fix, attach the new evidence, and hand over again. Reply on the thread with `add_comment` so the reviewer can see their point was understood, not just that a status moved.

**On `approved`** — the gate is passed, not the run finished. `approved` means "go finish"; `completed` means "the run is over". Do the remaining work, then `advance_loop_run(run_id, status="completed")`. Move the issue itself with `update_issue`; a run status is not an issue status and neither one writes the other.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The evidence is clean, I'll mark the run approved and move on" | `advance_loop_run` refuses `approved`. It is a human verdict written through the web app, and no argument opens that path. |
| "I'll set `changes_requested` on my own run to record that I found a problem" | Also refused, and also not what it means. Attach a `note`, or leave the run in `running` until it is worth a person's time. |
| "`get_review` says approved, so the run is approved" | That is the issue's plan gate, decided before the code existed. The run's verdict is `get_loop_run(run_id)`. |
| "I'll write the code review onto the issue and skip the run" | Then no gate holds it. The issue's `review_state` was settled at plan time and does not move again for code. |
| "The run is stuck in `awaiting_review`" | It is not stuck, it is waiting. `failed` and `canceled` are the only other exits, and the human's verdict is the intended one. |
| "Nobody has looked, I'll cancel and start a fresh run" | Cancelling discards the packet and the thread. If it needs a nudge, that is a comment, not a new run. |
| "Changes were requested, so that run is dead — I'll open a new one" | `changes_requested` goes back to `running`. Re-open the same run and attach the new evidence beside the old. |
| "I'll summarize what I did instead of attaching the diff" | A summary is the thing the packet exists to replace. The reviewer is judging the work, not your account of it. |
| "I'll assign the issue to the reviewer so they know it's waiting" | Handing over is what notifies them — `awaiting_review` raises a `run_awaiting_review` item in their inbox. An assignee is a different fact about the issue. |
| "The tests pass, so I'll go straight to `completed`" | The ship gate is true on every run and cannot be disabled. `completed` is reachable only from `approved`. |
| "The plan was approved, so `plan -> build` will go through" | Check it did. That gate reads the *issue's* state, and an initiative-targeted run has no `review_state`, so a human must make the phase move. |
| "I don't have the run id from last session, I'll start a new run" | `list_loop_runs(target="FLO-…")` finds the one in flight. Two runs on one target is how a reviewed packet gets orphaned. |

## Red Flags

- `advance_loop_run` called with `approved` or `changes_requested`
- A verdict, approval or sign-off written anywhere by an agent
- `get_review` used to read the outcome of built work
- A code-review verdict recorded on the issue's `review_state`
- A run advanced to `awaiting_review` with an empty packet, a summary in place of the work, or its truncation flag raised
- Work continuing past `awaiting_review` on the assumption of approval
- A run cancelled because a verdict was slow
- A fresh run started after `changes_requested` instead of re-opening the same one
- `completed` attempted from `running`, or the ship gate treated as a bug
- A second run started against a target that already has one in flight
- A notification inbox never cleared, so the `review_decided` item never arrives

## Verification

Before handing the run over:

- [ ] The run id came from `list_loop_runs` or from this session, and no second run is in flight against the same target
- [ ] `get_loop_run(run_id)` was read back — the packet carries the work rather than a summary of it, and its truncation flag is clear
- [ ] `advance_loop_run(run_id, status="awaiting_review")` returned without a refusal
- [ ] No agent-written verdict exists anywhere — not on the run, not on the issue, not in a comment claiming one

After the verdict:

- [ ] `get_loop_run(run_id)` — not `get_review` — is what was read to learn it
- [ ] On `changes_requested`, the same run was moved back to `running` and the feedback answered on the thread
- [ ] On `approved`, the remaining work was done before `completed` was written
- [ ] The issue's own status was updated separately, by `update_issue`

## See Also

The `code-review-and-quality` skill — what to look for and how to say it. This skill assumes that judgement is already formed and governs where it goes.

The `flowly-verify` skill — what belongs in the packet this gate reads, and why the cap is on item count. The `flowly-loop-runs` skill — the run's three gates, its autonomy ladder and the full status table this one takes three rows out of.

The `flowly-plan-gate` skill — the other gate, on the other object, before any code exists. The `flowly-build` skill — the loop that produces the work this run is judged on.
