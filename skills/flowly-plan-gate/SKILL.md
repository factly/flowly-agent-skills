---
name: flowly-plan-gate
description: Carries a Flowly issue across its plan gate — puts the finished planning docs in front of a human, watches the notification inbox for the verdict, and converts the todo doc into child issues exactly once. Use when a Flowly issue's docs are written and a human must now decide, use when a Flowly notification reports a decision on an FLO issue, and use before building anything under that issue.
---

# The plan gate in Flowly

## Overview

This is the one boundary in Flowly an agent structurally cannot cross. Everything up to it is yours: the issue, the four planning docs, the task list. The verdict is not, and there is no argument, flag or tool that makes it yours.

The skill covers three moves and nothing else — hand the plan over, learn what was decided, turn the approved list into child issues. The `flowly-plan` skill owns writing the docs; `flowly-build` owns what happens to the children. This one owns the wait in between, which is the part agents get wrong, because waiting looks like doing nothing and doing nothing looks like a failure to make progress.

## When to Use

- All four planning docs exist on a Flowly issue and it is time to hand them over
- A notification says a decision landed on an issue you submitted
- An issue's plan-gate state reads `approved` and no child issues exist yet
- A human sent the plan back and you need to know what they said before revising

**When NOT to use** — an issue whose children already exist. Conversion has run; go build them. Also not for the verdict on built code: that lives on the loop run, not on the issue.

## Two gates, and the word for each

Flowly has two gates on two different objects, and this skill is about one of them.

| | this skill | not this skill |
|---|---|---|
| the gate on | the **issue** — its plan-gate state | the **loop run** — its status |
| gates | the plan, before any code is written | the built work, before it ships |
| read with | `get_review(identifier)` | `get_loop_run(run_id)` |
| the corpus calls it | **the plan gate** | **review** |

**The word "review" is reserved for code review.** The gate this skill crosses is *the plan gate*. Several tool and field names contain the string — `submit_for_review`, `get_review`, `review_requested` — and those are identifiers, not vocabulary. In prose, say plan gate, and say verdict or decision rather than review.

## The Tools

| tool | does |
|---|---|
| `submit_for_review(identifier)` | hands the plan to a human; refuses unless all four doc kinds exist |
| `get_review(identifier)` | the current plan-gate state plus the whole comment thread, oldest first |
| `list_notifications(unread_only)` | your inbox — what happened on issues you care about, unread first |
| `mark_notification_read(notification_id, mark_all)` | clears one or all, and re-arms de-duplication |
| `convert_todo_to_issues(identifier)` | creates one child issue per task; refuses unless approved, refuses if children exist |
| `list_planning_docs(identifier)` | what the docs say right now — the version that will be converted |
| `add_comment(identifier, body)` | your reply to the human's feedback |
| `assign_issue(identifier, assignee)` | the call the children need and do not get for free |

## Process

### 1. Submit

`submit_for_review(identifier)` moves the plan-gate state to `in_review`. It refuses unless `research`, `plan`, `todo` and `risks` all exist — that refusal is a checklist telling you which doc you still owe, not an error to route around.

Then stop editing. From here the docs are what a human is reading.

### 2. Wait, and learn from the inbox

The verdict reaches you two ways, and they are not equivalent.

**The inbox is the event.** `list_notifications` returns what happened on issues you care about, unread first. A `review_decided` item names the issue a human ruled on; a `review_requested` item is the request itself. Other kinds are `assigned`, `commented`, `status_changed` and `run_awaiting_review`. Each item embeds exactly one of `issue` (identifier and title) or `run` (id and loop name) and the other is null — a run can target an initiative, which has no issue at all, so never assume `issue` is present. The list caps at 250 like every other list.

**`get_review` is the state.** It answers "what is the state right now, and what is on the thread" for one issue you name. It is the right call once you know something happened, and the right call when you need the comments. It is the wrong way to find out *that* something happened, because you have to already know which issue to ask about, and you have to keep asking.

Use the inbox to learn a decision landed; use `get_review` to read what it was and why.

**Then mark it read.** `mark_notification_read` does more than tidy: while an item is unread, further activity of the same kind on the same issue adds no new row. An unread `commented` item swallows the next comment. Clear what you have acted on or you stop hearing about it.

### 3. On `changes_requested`, revise and resubmit

`get_review` returns the whole thread, oldest first. Read all of it — a reviewer's second comment usually qualifies their first. Revise the docs, `add_comment` to say what you changed and why, and `submit_for_review` again. The loop has no limit.

The revision itself belongs to `flowly-plan`; its planning-docs reference has the loop in full.

### 4. On `approved`, convert once

Only when `get_review` reports `approved` may `convert_todo_to_issues` run, and only then may implementation start. Read the next two sections before you call it.

## Approval is human-only and web-only

Nothing an agent can call reaches `approved`. There is no approve tool in Flowly's tool list, no `force` argument on `submit_for_review`, no autonomy level that skips the gate, and no state the agent can write that stands in for a verdict.

This is not a convention that a sufficiently confident agent may set aside. It is how the server is built: the verdict is written by the human decision path in the web app, and the MCP door resolves to an agent actor and nothing else, so a gate expressed this way is not passable from there. An agent probing for the override is not being thorough, it is burning calls on a door with no handle.

The consequence worth internalising: **an agent that believes its plan is obviously correct still submits and waits.** That is the entire reason the gate exists. A plan nobody read is not a plan that was approved quickly, it is a plan that was never gated.

The same rule holds one gate over. On a loop run, `advance_loop_run` accepts `running`, `awaiting_review`, `completed`, `failed` and `canceled`, and rejects `approved` and `changes_requested` outright. Both verdicts in this product are human verdicts.

## Conversion runs once, and reads the doc at call time

Four properties of `convert_todo_to_issues` decide how you use it.

**It requires `approved`.** Called earlier, it refuses.

**It reads the todo doc at call time, not at approval time.** Whatever the doc says at the moment of the call is what becomes child issues. An edit made after the human approved and before you converted goes straight into the tracker with nobody having read it — the approval was of the document as it stood, and nothing re-checks that it still stands. There is no diff, no warning, and no second look. Land every edit before submitting, and treat the doc as frozen from the moment you hand it over.

**It runs exactly once, ever.** It refuses once the issue has children. There is no re-run to pick up a fix, no partial conversion, no incremental top-up when you think of a fifth task. The list you convert is the list you get, and the only remedy afterwards is to file more issues by hand.

**It orders the children by the dependency graph but does not carry the graph.** Ascending child issue number is a valid execution order. The dependency itself does not appear on the child — which is why `flowly-plan` requires every dependency to be named in the dependent task's description, by title.

## What the children actually look like

Conversion creates one issue per task and leaves each of them in the quietest state Flowly has.

| field | what conversion sets | what that means |
|---|---|---|
| assignee | **unassigned** | nobody owns it, and nobody's list shows it |
| status | **`backlog`** | not `todo`, not `in_progress` — it is filed, not queued |
| priority | **`0`** | and priority is inverted — `0` is none, `1` is urgent, `4` is low |

Read that table as one sentence: **nobody is watching these issues.** They are unassigned, out of the working queue, and carrying the priority value that means "none" rather than the one that means "top". A plan that a human spent their attention approving now sits in a backlog that no dashboard highlights.

So conversion is not the end of the handover. Report the child identifiers back to whoever is going to work on them. If you are the one building, `assign_issue(identifier, "me")` on the first child and move it out of `backlog` when you start. If a human is building, say so on the parent's thread with `add_comment` — the children carry no notification of their own creation to anyone who was not already assigned.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The plan is obviously correct, I will approve it and move on" | There is no approve tool. Nothing an agent calls reaches `approved`. Submit and wait. |
| "There must be a flag or an override for autonomous runs" | The plan gate lives on the issue, not on a run's autonomy dial. An issue-targeted run is refused the move from plan to build at every level of the ladder, including the highest one this product will run. |
| "I will call `get_review` every few seconds until it changes" | The inbox is the event. Poll the state when you know something happened, not to find out that it did. |
| "I read the notification, that is enough" | Unread items swallow the next event of the same kind on the same issue. Mark it read or you stop hearing about it. |
| "The notification has an issue on it, so I can read the identifier" | An item embeds an issue *or* a run, never both. A run against an initiative has no issue at all. |
| "It is approved, so I will fix that one task and then convert" | Conversion reads the doc at call time. Your fix ships unreviewed, and the approval on record was of a different document. |
| "I will convert now and top up with the missing tasks after" | Conversion refuses once children exist. There is no second call, ever. |
| "The children are created, so the work is queued" | They land unassigned, in `backlog`, at priority `0`. Nobody is watching them until someone assigns one. |
| "I set priority `0` so it is top of the list" | Priority is inverted. `0` is none. Urgent is `1`. |
| "Nobody has answered, so the gate must be broken — I will build ahead" | Waiting is the normal state of this gate. Building ahead of it is the failure it exists to prevent. |
| "Changes were requested, so the plan was rejected" | `changes_requested` is a loop, not a dead end. Read the whole thread, revise, comment, resubmit. |
| "The human approved the code, so the plan is approved" | Two gates, two objects. A run's verdict says nothing about the issue's plan-gate state. |

## Red Flags

- Any search for an approve tool, an override argument, or an autonomy level that skips the gate
- The plan-gate state written or claimed rather than read from `get_review`
- `get_review` called in a tight loop as the primary way of learning a decision landed
- Notifications read and never marked read
- A notification's `issue` field assumed present without checking
- Implementation starting while the state is `in_review` or `changes_requested`
- Any edit to a planning doc between submission and conversion
- `convert_todo_to_issues` called before `approved`, or called a second time
- Child issues created and never reported, assigned, or moved out of `backlog`
- The word "review" used in prose for this gate instead of "the plan gate"
- A run's `approved` status treated as the issue's plan approval

## Verification

Before handing over:

- [ ] `submit_for_review` returned without a refusal, so all four doc kinds exist
- [ ] No planning doc has been written since that call

Before converting:

- [ ] `get_review` reports `approved`, and that state was read, not assumed
- [ ] `list_planning_docs` shows the todo doc is byte-for-byte what the human approved
- [ ] No edit was made to any doc after submission
- [ ] The issue has no child issues yet

After converting:

- [ ] `convert_todo_to_issues` ran exactly once and returned the child issues
- [ ] Every child issue has an identifier you can name
- [ ] The children's default state is understood and acted on — unassigned, `backlog`, priority `0`
- [ ] Whoever is building has been told, by assignment or by a comment on the parent
- [ ] Every notification you acted on was marked read

## See Also

`flowly-plan` writes the four docs and the task list, and its planning-docs reference carries the gate's states and the revision loop in full. `flowly-define` finds or files the issue and writes the research doc. `flowly-build` drives the child issues to done.

For the verdict on built code — a different gate, on the loop run — see the `code-review-and-quality` skill.
