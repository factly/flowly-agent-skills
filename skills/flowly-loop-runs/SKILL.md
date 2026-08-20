---
name: flowly-loop-runs
description: Drives a Flowly loop run through its three gates — choosing an autonomy level the agent can actually move, walking the run's status and phase with the loop tools, and stopping where a human's verdict is required instead of retrying a refusal. Use when creating a loop or starting a run against a Flowly issue or initiative, use when a run will not start or will not leave its plan phase, and use before recording a loop rule or schedule that nothing in this product dispatches.
---

# Loop runs in Flowly

## Overview

A loop is a reusable recipe — a goal, a stopping condition, what it runs against, a default autonomy level. A run is one attempt at that recipe against one target, and it carries the state a human reads when deciding whether the work was done.

Autonomy is not a preference or a speed setting. It is **where the human sits**, expressed as three gate positions on the run. A gate that is on is a step the agent cannot take: attempting it is refused outright, not queued for later. So the level chosen at creation decides which of its own transitions the agent will be allowed to make, and the default level is the one that leaves the agent with none.

That is the trap this skill exists for. A run created at the default autonomy cannot be started by the agent that created it.

## When to Use

- You are about to create a loop or start a run against a Flowly issue or initiative
- A run you created will not move — it refuses to start, or refuses to leave its plan phase
- You need to know which run states an agent may write and which belong to a human
- You are picking up a run started in an earlier session
- Someone asked for a rule or a cron schedule on a loop

**When NOT to use** — ordinary implementation work on a child issue, which needs no run at all; the plan gate on an issue, which is a different gate on a different object; and general CI or pipeline automation, which has nothing to do with Flowly's autonomy ladder.

## The Three Gates

A run has exactly three gate positions. Not four, not one per tool call.

| gate | the transition it guards | who passes it when on |
|---|---|---|
| `start` | `queued → running` | a human |
| `phase` | `plan → build` | a human |
| `ship` | `→ completed` | a human, by approving the run |

`get_loop_run(run_id)` returns them as `{start, phase, ship}` booleans. **A gate that reads `true` is a step you cannot take.** Read them before planning a sequence of calls, not after the first refusal.

## The Autonomy Ladder

The level is a number between 0 and 5, and a number outside that range is refused as "outside the ladder's 0-5".

| level | name | status |
|---|---|---|
| 0 | `assist` | usable — **the default** |
| 1 | `supervised_action` | usable |
| 2 | `scoped_task_delegation` | usable |
| 3 | `goal_driven` | usable, **requires a stopping condition** |
| 4 | `parallel_delegation` | reserved — refused |
| 5 | `managed_by_exception` | reserved — refused |

### The gate matrix

| level | `start` | `phase` | `ship` |
|---|---|---|---|
| 0 `assist` | `true` | `true` | `true` |
| 1 `supervised_action` | `false` | `true` | `true` |
| 2 `scoped_task_delegation` | `false` | `true` | `true` |
| 3 `goal_driven` | `false` | `false` | `true` |

Levels 1 and 2 are identical, and that is deliberate rather than an oversight. Level 1 gates each consequential step; level 2 gates each phase boundary; a run has two phases and therefore exactly one boundary, so both descriptions pick out the same set. They separate the moment a run grows a third phase. Choose between them for what you mean, not for what it does today.

`ship` is `true` at every level and cannot be turned off. A loop may carry a review policy that overrides `start` and `phase`, but an attempt to set the ship gate to `false` is refused by the field itself: a run reaching `completed` with no human involved anywhere is reserved for an explicit decision, not a value typed into a form. That policy is also not reachable from this door — the agent tools that create and update a loop take no policy argument, so gate overrides are a human's edit in the web app.

## The Default Is Not Drivable

`create_loop` defaults `default_autonomy` to `0`, and level 0 has `start = true`. A run created from that loop sits in `queued`, and the only transition out of `queued` that is not `failed` or `canceled` is gated on a human.

The refusal is checkable and it names itself:

> `starting the run is gated at this autonomy level and must be taken by a human`

There is no flag, no override argument, and no way for the agent to satisfy it. Gated steps require a human **actor**, and this door resolves to an agent actor and nothing else — the check is about who is calling, not about what they claim. Waiting does not help either: nothing in this product will start the run on the agent's behalf.

So the level is a decision made **before** the run exists, and it has three places to be made:

| where | call | use it when |
|---|---|---|
| on the loop, at creation | `create_loop(..., default_autonomy=2)` | the loop is yours and every run of it should be drivable |
| on the loop, afterwards | `update_loop(loop_id, default_autonomy=2)` | the loop already exists at 0 and you own it |
| on the one run | `run_loop(loop_id, target, autonomy=2)` | someone else's loop, or one run that should differ from the default |

Create at **1 or 2** for work an agent will drive. Reach for 0 only when a human is deliberately being put in front of every step, and then expect to hand the run over immediately.

## Level 3 Requires a Stopping Condition

`goal_driven` is the level at which the phase gate comes off, and it is the only level with a precondition attached.

The condition lives on the **loop**; the check fires when the **run** is created. A loop can be created at `default_autonomy=3` with no `stopping_condition` and nothing complains — the refusal arrives later, at `run_loop`:

> `loop '<name>' has no stopping_condition, so it cannot run at autonomy 3 (goal_driven): a goal with no way to tell when it has been reached is not a contract the run can be held to`

Write the condition as something a run can evaluate — a suite that passes, a count that reaches zero, a state a named issue arrives at. A goal with no measurable stopping condition is a number with no contract behind it, which is exactly what the refusal says.

`update_loop` can set or change a stopping condition but **cannot clear one**: this door cannot tell an omitted argument from an explicit null. Clearing is a human's edit in the web app.

## Levels 4 and 5 Are Refused

Both are refused wherever a level is accepted — at `create_loop`, at `update_loop`, and at `run_loop` — and the refusal names the capability that is missing rather than reporting an arbitrary cap:

> level 4: `parallel delegation needs isolated-worktree execution, which this product does not model`
>
> level 5: `managed-by-exception orchestration needs a headless runner, which does not exist`

They are declared in the ladder so that a runner, when one exists, needs no migration. They are not a stretch goal an agent can talk its way into, and neither is expressible as gate placement, which is all a per-run dial can say. Treat 3 as the top of the usable ladder.

## Two Rules Outside the Dial

The matrix is not the whole story. Two rules sit outside it and no autonomy level relaxes them.

**`plan → build` is refused for an issue-targeted run at every level, including 3.** The phase move delegates to the issue's own plan gate: unless that issue's review state is `approved`, the move is refused —

> `this run cannot leave its plan phase until the issue's plan is approved (review_state is planning)`

Level 3's `phase = false` means only "no *additional* run-level acknowledgement". It does not mean "no plan gate". Get the plan approved first; the `flowly-plan` skill owns how. For an **initiative**-targeted run there is no review state to delegate to, so the gate is a human at every level instead.

For an **`issue_set`**-targeted run the move is refused outright, for an agent and a human alike —

> `a run targeting a issue_set has no plan phase to leave: its issues carry their own plan gates, and the batch is reviewed as a whole when the run reaches awaiting_review`

That is not a gate waiting to open. A batch has no plan phase to leave, so the run stays in `plan` for its whole life while its status moves underneath it. Reading `phase: plan` on a batch that is plainly writing code and trying to "correct" it is the mistake this refusal exists to stop.

So across the three kinds the difference is *which* gate — or, for a set, that the phase is not the thing being gated at all — never *whether* there is one.

**`ship` is on at every level.** `completed` is reachable only from `approved`, and `approved` is a human verdict.

## The Status Table

`advance_loop_run(run_id, status=…, phase=…)` moves a run. What may follow what, with an empty right-hand side meaning terminal:

```
queued            -> running, failed, canceled
running           -> awaiting_review, completed, failed, canceled
awaiting_review   -> failed, canceled
changes_requested -> running, failed, canceled
approved          -> completed, failed, canceled
completed         -> (terminal)
failed            -> (terminal)
canceled          -> (terminal)
```

Four things this table does not say out loud:

- **`running -> completed` is listed and still refused** while the ship gate is on. It is legal in the lifecycle and closed by policy, which is why it appears here rather than being absent.
- **`awaiting_review` has no agent exit but failure or cancellation.** The way forward is the human's verdict, and there is no tool for it. Handing over is where the agent's turn ends.
- **`approved` and `changes_requested` are refused outright** as arguments, before anything else is checked. They are written only by the human's review action.
- **A terminal run never moves again**, in any direction, including a re-send of the status it already holds.

Phase is a separate argument with its own one-entry table: `plan → build`, forward only. Replanning revises the issue's planning docs in place and resubmits its review; it never rewinds a run's phase. A run may also finish in the plan phase — moving to `build` is not required to reach `completed`.

`advance_loop_run` needs at least one of `status` or `phase`; passing neither is refused as nothing to update.

## Process

### 1. Pick the level before creating anything

Decide who is meant to be in the loop, then pick the level that puts them there. If the answer is "the agent drives and a human reviews the result", that is 1 or 2, not 0.

### 2. Create or find the loop

`list_loops()` shows the team's definitions; `create_loop(name, goal, target_kind, stopping_condition, default_autonomy)` makes a new one. Loop names are unique within a team, so a name already in use is refused rather than duplicated. `target_kind` is `issue`, `initiative` or `issue_set`, and the run's target must match it — the loop declares the kind, the run supplies the targets.

### 3. Start the run

`run_loop(loop_id, target)` — `target` is a `FLO-` identifier or an initiative uuid. For an `issue_set` loop pass `targets` instead, a list of identifiers in the order they should be worked; give exactly one of the two or the call is refused. The run comes back `queued`, in the `plan` phase, with its gates resolved. Read them off the response and confirm `start` is `false` before assuming the next call will work.

Then `advance_loop_run(run_id, status="running")`.

### 4. Do the work and attach what it produced

`attach_evidence(run_id, kind, content|url)` as you go, with `kind` one of `diff`, `test`, `log`, `link`, `note`. What belongs in a packet and how much of it is the verify phase's subject, not this skill's; what matters here is that the packet is what the human reviews instead of a summary.

### 5. Hand over

`advance_loop_run(run_id, status="awaiting_review")`. That notifies the team's humans, and it is where the agent's turn ends. Do not poll in a tight loop and do not attempt the verdict — there is no tool that writes it.

### 6. After the verdict

`get_loop_run(run_id)` reports it.

- `approved` — the agent finishes: `advance_loop_run(run_id, status="completed")`.
- `changes_requested` — a rejected packet is not a dead run. Move back to `running`, fix what was asked for, attach the new evidence, and hand over again. The cycle can repeat.

### 7. Picking a run back up

A run id does not survive a session. `list_loop_runs(target="FLO-30")` finds the run already in flight against a target — do that **before** starting another, or the target ends up with two runs and a reviewer with two packets.

## Rules and Schedules Record Intent and Dispatch Nothing

A loop's trigger is `manual`, `automatic` or `scheduled`, and **only `manual` has an execution path** — `run_loop`. The other two are vocabulary the schema carries; nothing reads them and acts.

`create_loop_rule(loop_id, on_event)` and `create_loop_schedule(loop_id, cron)` write rows and stop there. No process watches for the event. No process watches the clock, and the cron expression is stored unparsed until one does. Both tools say so in their own descriptions.

Creating either is a legitimate thing to do — it records reviewable intent, and it is how the intent survives until a runner exists. What is not legitimate is creating one and then waiting, or reporting to a human that the work is "now automated". An agent that creates a schedule and waits waits forever. When the work has to happen now, call `run_loop`.

## Reading a Refusal

Every refusal below is the system working. None of them is retryable as sent.

| the message says | the cause | what to do |
|---|---|---|
| `starting the run is gated at this autonomy level` | the run is at level 0 | create the next run at 1 or 2; this one needs a human |
| `leaving the plan phase is gated at this autonomy level` | level 1 or 2 | a human makes the move; or the run can finish in the plan phase |
| `cannot leave its plan phase until the issue's plan is approved` | the issue's plan gate is not `approved` | plan the issue, submit it, wait for the human |
| `cannot be completed until a human approves it` | the ship gate, at every level | hand over at `awaiting_review` instead |
| `is the human's verdict and is not writable here` | `approved` or `changes_requested` was sent | stop at `awaiting_review` |
| `a run cannot go X -> Y` | not in the status table | re-read the table; the run's current status is in the message |
| `has ended — it does not move again` | terminal | start a new run if more work is needed |
| `is reserved:` plus a named capability | level 4 or 5 | use 3 or lower |
| `has no stopping_condition` | level 3 with nothing to stop on | set one on the loop, or run at 2 |
| `runs against a` … `but the target given is a` | target kind mismatch | the loop's `target_kind` decides which target is legal |
| `has no plan phase to leave` | a `plan → build` move on an `issue_set` run | nothing to fix — a batch never enters `build`, and its status is what says where the work is |

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I created the run, so I can start it" | The default level gates `queued → running` on a human. Creating a run grants nothing; the level decides. |
| "I'll leave the autonomy default and raise it if I hit a wall" | The wall is the first transition. Pick the level before `run_loop`, or the run's first move needs a person. |
| "The gate refusal is a bug — I'll retry" | It is a policy check and it is deterministic. The same call refuses forever. |
| "There must be a flag for agent-driven runs" | Gated steps require a human actor, and this door only ever presents an agent actor. There is no flag to find. |
| "Level 3 turns the phase gate off, so I can move to build" | For an issue-targeted run the plan gate still applies at every level. `phase = false` removes the extra run-level acknowledgement, not the issue's approval. |
| "I'll set autonomy to 4 so the work parallelizes" | 4 and 5 are refused wherever a level is accepted, and the refusal names the capability that does not exist. |
| "I'll run at level 3 and describe the goal well" | Level 3 without a stopping condition on the loop is refused at run creation. A prose goal is not a stopping condition. |
| "I'll mark the run `approved` since the work is clearly fine" | `approved` and `changes_requested` are rejected as arguments before anything else is checked. |
| "The run is in `awaiting_review`, I'll move it back to `running` and keep going" | Only `failed` and `canceled` leave `awaiting_review` from this side. Returning to work happens after `changes_requested`. |
| "I'll create a schedule so this runs nightly" | Nothing watches the clock. The row is intent, not a job, and reporting it as automation is reporting something that will not happen. |
| "The loop's trigger is `automatic`, so it will fire" | Only `manual` has an execution path. The other two values dispatch nothing. |
| "I'll start a fresh run, I don't have the old run id" | `list_loop_runs(target=…)` finds it. A second run against the same target gives the reviewer two packets and no way to tell which is current. |
| "I'll summarize what I did in the handover instead of attaching it" | The packet is what a human reviews instead of the summary. A summary standing in for the work turns review into a reading exercise. |

## Red Flags

- A run created at the default autonomy that the agent then tries to start
- `run_loop` called before anyone decided the level
- A gate refusal retried unchanged, or retried with different wording
- A search for an override argument, a force flag, or a human-actor impersonation
- `approved` or `changes_requested` passed to `advance_loop_run`
- `completed` attempted from anything other than `approved`
- A phase move attempted while the target issue's plan gate is not `approved`
- Autonomy 4 or 5 in any call
- Level 3 requested on a loop with no stopping condition
- A run reported as complete when it is sitting in `awaiting_review`
- A schedule or a rule created and then waited on, or described to a human as automation
- A second run started against a target that already has one in flight
- The evidence packet empty at handover

## Verification

Before starting a run:

- [ ] The autonomy level was chosen deliberately, and it is 1, 2 or 3
- [ ] If it is 3, the loop carries a stopping condition
- [ ] The loop's `target_kind` matches the target being passed
- [ ] `list_loop_runs(target=…)` shows no run already in flight against this target

After `run_loop` returns:

- [ ] The response's `gates` were read, and `start` is `false`
- [ ] The run is `queued`, in the `plan` phase

Before handing over:

- [ ] Every transition made is one the status table allows
- [ ] The evidence packet holds what was actually produced, not a description of it
- [ ] The run is in `awaiting_review` and no verdict was attempted

After the verdict:

- [ ] `get_loop_run` reports `approved` or `changes_requested`, written by a human
- [ ] `completed` was written only from `approved`
- [ ] Any rule or schedule created was described to the human as recorded intent that dispatches nothing

## See Also

The `flowly-plan` skill — the issue's plan gate, which is what an issue-targeted run's `plan → build` move delegates to, and the only way that move ever becomes legal.

The `flowly-build` skill — the work a run wraps when its target is an issue with child issues. A run records the attempt; that loop does the walking.

The `flowly-batch` skill — what an `issue_set` run is for, and the rules that only apply to one: the phase that never moves, one commit per issue per repository, and why such a run is never marked `failed`. Reached from `/flowly:batch`.
