---
name: flowly-define
description: Opens work on a Flowly issue — locates it by FLO identifier or files a new one, accepts or declines what sits in triage, reads the project's shared assets, and records what was found as the issue's research doc. Use when a request has no Flowly issue behind it yet, use when an issue exists but nothing has been investigated against it, and use before that issue's plan is written.
---

# Defining work in Flowly

## Overview

Work that is not on an issue is not work Flowly can carry. This skill is the step before planning: it puts the ask on an issue, reads what the project has already decided for itself, and records what the code actually does today — through Flowly's tools, so the reading outlives the session that produced it.

The output is exactly two things: one issue with a `FLO-` identifier, and one planning doc of kind `research` on that issue. Nothing is written to the working tree. The `flowly-plan` skill takes it from there and writes the other three docs and the task list; this skill does not write them and does not submit anything.

## When to Use

- A request has arrived and no `FLO-` identifier exists for it yet
- An issue exists but nobody has read the code, the prior art, or the constraints
- An issue is sitting in `triage` and has to be accepted or declined
- A plan came back needing more investigation before it can be revised

**When NOT to use** — an issue that already carries a research doc you have read and still believe. Reading it again is cheap. Overwriting the document a reviewer is commenting on is not.

## The Tools

Use these names exactly.

| tool | does |
|---|---|
| `list_projects()` | every project, newest first — an issue belongs to exactly one |
| `list_issues(project_id, status, assignee, release)` | summaries without descriptions, newest first |
| `get_issue(identifier)` | one issue including its full description |
| `create_issue(project_id, title, description, status, priority)` | files a new issue and returns its `FLO-` identifier |
| `triage_issue(identifier, action, assignee, milestone, reason)` | accepts an issue out of `triage`, or declines it with a reason |
| `assign_issue(identifier, assignee)` | sets or clears the assignee; `"me"` is this agent |
| `get_project_assets(project_id, kind)` | the agents, skills and commands the project defines |
| `put_planning_doc(identifier, kind, content)` | writes one of the four planning docs whole |
| `list_planning_docs(identifier)` | what already exists on the issue, in canonical order |
| `add_comment(identifier, body)` | what belongs on the issue thread rather than in a doc |

`identifier` accepts `FLO-12`, `flo-12`, or the bare `12`. All three name the same issue.

## Process

### 1. Find before you file

There is no search tool. No full-text query, no keyword lookup, nothing that takes a phrase. `list_issues` filters by project, status, assignee and release and returns newest first — that is the whole retrieval surface.

It is also capped. Every list tool stops at 250 rows, silently: no pagination, no cursor, no flag that says the list was cut. A project with more than 250 issues will hand you a full-looking page that is missing the older half. So narrow with the filters you have before you conclude an issue does not exist, and say which filters you used when you report that it does not.

Read the candidate with `get_issue` — `list_issues` returns summaries without descriptions, so the body you need to judge a match is not in the list.

### 2. File it, or decide it out of triage

Filing and triaging are different acts on different issues.

`create_issue` files something new. It needs a project uuid and a title; `description` is markdown, `status` defaults to `backlog`, and `priority` defaults to `0`. Priority is inverted — `0 none | 1 urgent | 2 high | 3 medium | 4 low` — so a new issue is not top priority, it is unprioritised.

`triage_issue` decides something that has already arrived. Only an issue whose status is `triage` can be triaged; `triage` is upstream of the backlog, not a sibling of it. Action `accept` moves it out of `triage` and into `backlog`, and can attach an assignee and a milestone in the same atomic write. Action `decline` requires a reason, records that reason as a comment, and moves the issue to `canceled`. Nothing in Flowly deletes an issue — declining cancels it, and the reason stays readable on the thread.

### 3. Read the project's assets before your own defaults

`get_project_assets` returns the agents, skills and commands the project defines, each at its latest version. This is the project's shared setup: the whole team's coding agents pull the same one instead of each contributor running their own dotfiles. Prefer what it says over your own defaults, and say in the research doc where a project convention and your default disagreed.

Two properties decide how you treat what comes back. Flowly stores and serves this content and never runs it — interpreting an asset is your job, and nothing in it has been executed on your behalf. And the MCP door reads assets only; there is no tool here that writes one. An asset that needs changing is a request to a human, or an issue of its own.

### 4. Write the research doc

`put_planning_doc(identifier, kind="research", content=…)`. The content is markdown and the write replaces the whole doc — there is no append and no patch, so call `list_planning_docs` first and edit what is actually there rather than what you remember writing.

**Writing the first planning doc on an issue moves its plan-gate state from `none` to `planning`, on its own.** No tool sets that state and none needs to: the write is the transition. From that moment the issue reads as being planned to everyone looking at it, which is the point — it is a claim, made by writing rather than by saying so, that somebody is on this.

Keep observations and conclusions apart. What you read and what it does today belongs here; what you propose to do about it belongs in the `plan` doc, which this skill does not write. The `flowly-plan` skill's planning-docs reference has the full division.

### 5. Hand over

Stop at one doc. `flowly-plan` writes `plan`, `todo` and `risks`, and `flowly-plan-gate` submits the set and waits. An issue with a research doc and nothing else is a correct place to stop; an issue with four docs and no reader is not.

## A repository charter is not a planning doc kind

The `kind` argument is a closed set of exactly four values — `research`, `plan`, `todo`, `risks` — and every one of them is scoped to a single issue. There is no fifth kind, no way to add one, and no object anywhere in Flowly that holds a document about the repository as a whole.

Workflows inherited from elsewhere ask for one anyway: a charter, a constitution, a principles document, a one-time pass over some fixed set of core areas that every later plan is supposed to inherit. Flowly has nowhere to put it.

The failure is silent, and that is what makes this worth a section. `put_planning_doc` applies **no structural validation to `content`**. It accepts markdown and stores it. A charter sent as `research` returns success and then occupies the slot a reviewer opens expecting to find what this issue's code does today. Nothing downstream catches it either — the gate checks that four kinds exist, not what is inside them, so the human at the gate is the first reader, and they are reading it as research.

What to do instead, by what the material actually is:

| the material | where it goes |
|---|---|
| a convention the whole project should follow | the project's assets — read with `get_project_assets`, authored by a human in Flowly's web app |
| a decision this particular change turns on | the issue's `plan` doc, written by `flowly-plan` |
| what this issue's code does today | the `research` doc — this is the only thing it is for |
| the work of establishing the convention | its own issue — `create_issue`, then plan it like any other work |

The same reasoning covers every document a workflow wants to write once and reuse forever. Flowly's unit is the issue. A document with no issue behind it has no gate, no reviewer, no thread, and no way to be found again.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I searched and the issue does not exist" | There is no search tool. You filtered a newest-first list that silently stops at 250. Say which filters you used, or file the issue and let the duplicate be found. |
| "The list came back short, so that is all of them" | Truncation is silent everywhere except the evidence packet. A short list is not proof of a small project. |
| "I will write the charter as the research doc, it is close enough" | It is accepted without validation and it displaces the one thing the gate's reader expects to find. Put the convention in the project's assets and the work in its own issue. |
| "The project needs a constitution before any of this makes sense" | Then that is an issue — `create_issue` — and it gets planned and gated like anything else. It is not a fifth doc kind. |
| "I will draft the research locally and paste it in later" | The local file has no issue, no gate and no reader. Later does not come, and the issue stays empty. |
| "I will set the state to `planning` after writing the doc" | Writing the doc already did it. There is no tool that sets the state, and looking for one wastes a call. |
| "The issue is in triage, I will just start on it" | Only an issue whose status is `triage` can be triaged, and once it moves the decision is unrecorded. Accept it or decline it with a reason. |
| "Priority 0 means I filed it as top priority" | Priority is inverted. `0` is none. Urgent is `1`. |
| "The project's asset disagrees with how I usually do it, so I will use mine" | The asset is the team's shared setup and it wins. Where you disagree, write the disagreement into the research doc. |
| "I will decline the issue and delete it" | Nothing in Flowly deletes an issue. Declining requires a reason and cancels it. |
| "The research doc is thin, I will write the plan too and make up for it" | This skill ends at one doc. A thin research doc that names what is still unknown is more useful than a plan resting on an assumption. |

## Red Flags

- A claim that an issue does not exist, made without naming the filters that were searched
- A conclusion drawn from a list of exactly 250 items
- A document about the repository, the team, or the workflow written into any planning doc kind
- A fifth `kind` value passed to `put_planning_doc`
- A research file, spec file, or scratch note written into the working tree
- `put_planning_doc` called without `list_planning_docs` first, on an issue that already has docs
- Any attempt to set the plan-gate state directly after writing the first doc
- `triage_issue` called on an issue whose status is not `triage`
- An issue declined with no reason
- Implementation starting straight off the research doc, with no plan and no gate
- The project's assets never read, because your own defaults were faster

## Verification

Before handing the issue to planning, confirm:

- [ ] The issue exists and you have its `FLO-` identifier
- [ ] If it was found rather than filed, `get_issue` was read in full, not just the list summary
- [ ] If it arrived in `triage`, `triage_issue` accepted it or declined it with a reason
- [ ] `get_project_assets` was called for the issue's project, and what it said is reflected in what you wrote
- [ ] `list_planning_docs` was read before any write
- [ ] Exactly one doc was written, of kind `research`
- [ ] That doc describes this issue's problem and this issue's code — no repository-wide charter, no team conventions, no fifth-kind material
- [ ] Unknowns are written down as unknowns rather than resolved by assumption
- [ ] Nothing was written to the local filesystem
- [ ] The issue's plan-gate state reads `planning`, reached by the write and not set by hand

## See Also

`flowly-plan` writes the remaining three docs and the task list. `flowly-plan-gate` submits the set, waits for the human decision, and converts the approved list into child issues.

For how to interrogate a vague request before it becomes an issue, the `interview-me` and `idea-refine` skills still hold — they change what you ask, this skill changes where the answer lands.
