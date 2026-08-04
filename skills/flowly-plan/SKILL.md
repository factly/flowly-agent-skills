---
name: flowly-plan
description: Plans a Flowly issue inside Flowly — writes the issue's four planning docs and its task list through Flowly's own tools, then hands the plan to a human gate rather than saving files into the working tree. Use when you have a Flowly issue identifier and work under it that needs breaking down, use before turning a plan into child issues, and use after the requirements for that issue are settled.
---

# Planning in Flowly

## Overview

A plan belongs to the issue, not to the laptop that produced it. This skill does the same breakdown craft as any good plan — small tasks, explicit acceptance, dependency order — and then writes the result into the Flowly issue through Flowly's tools, where a human reviews it and where approving it creates the child issues.

Nothing is saved to the working tree. There is no plan file and no todo file; the two documents that older workflows wrote to disk are now two of the issue's four planning docs, written by tool call. The sizing and slicing guidance in the `planning-and-task-breakdown` skill still applies to *what* you write. This skill governs *where* it goes and *who* approves it.

## When to Use

- You have a Flowly issue identifier and the work under it needs breaking into tasks
- An issue is large enough that a human should approve the shape before code is written
- You are about to create child issues and need the parent to carry an approved plan
- A reviewer asked for changes and the plan needs revising

**When NOT to use** — a one-line fix with no issue behind it, or an issue whose plan is already approved and converted. To implement tasks that already exist as child issues, plan nothing; go build them.

## The Four Planning Docs

Every issue has exactly four planning docs, and the kind is a closed set of four values:

| kind | carries |
|---|---|
| `research` | what was read, what the code actually does today, what is still unknown |
| `plan` | the approach, the decisions and their reasons, the long-form prose |
| `todo` | the ordered task list — write this one with the structured tool, never by hand |
| `risks` | what could go wrong, how it would show up, what mitigates it |

All four must exist before the plan can be submitted. A thin `risks` doc is still a doc; an absent one blocks the gate. See `references/planning-docs.md` for what belongs in each and what is enough.

## The Tools

Use these names exactly. A wrong tool name is the most common way this workflow fails.

| tool | does |
|---|---|
| `put_planning_doc(identifier, kind, content)` | creates or replaces one doc; `content` is markdown |
| `put_todo_tasks(identifier, tasks)` | writes the `todo` kind from a task array and returns the rendered document |
| `list_planning_docs(identifier)` | every doc that exists, with kind, content and last-updated, in canonical order |
| `submit_for_review(identifier)` | hands the plan to the human gate; requires all four kinds |
| `get_review(identifier)` | the current review state plus the whole comment thread, oldest first |
| `convert_todo_to_issues(identifier)` | creates one child issue per task once the plan is approved |

Supporting reads and writes around them — `get_issue`, `update_issue`, `add_comment`, `get_project_assets`, `list_issues`, `create_issue`.

`identifier` accepts the prefixed form in either case, or the bare number. All three name the same issue.

## Process

### 1. Read before writing

Call `get_issue` for the ask, `list_planning_docs` to see what already exists, and `get_project_assets` for the project's own conventions. If docs already exist you are revising, not starting; read them before replacing anything, because a write replaces the whole doc.

### 2. Write research, then plan

Do the reading, then `put_planning_doc` with kind `research`. Writing the first doc moves the issue's review state from `none` to `planning` on its own — you do not set that state by hand. Then write the approach as kind `plan`.

### 3. Write the task list with the structured tool

Call `put_todo_tasks` with the task array. This is how tasks are written. Do not compose the todo document yourself and push it through `put_planning_doc` — the server owns that document's shape, renders it from your task objects, and hands the rendered document back to you.

### 4. Write risks

`put_planning_doc` with kind `risks`. This is the doc most often skipped and the one that most often blocks submission.

### 5. Submit and hand over

`submit_for_review`. Then stop. An agent cannot approve its own plan; a human decides in Flowly's web app. Poll `get_review` for the state and read the comment thread it returns.

### 6. On approval, convert once

Only when `get_review` reports `approved` may `convert_todo_to_issues` run, and only then may implementation start. It reads the todo doc at call time, so the doc must be final. It creates one child issue per task, ordered by the dependency graph, and it refuses once the issue has children — so it runs exactly once, ever.

## The Task List

### Arguments

Each element of `tasks` is an object. Four arguments are required, four are optional.

| argument | required | carries |
|---|---|---|
| `num` | yes | position in the list — an integer, contiguous from 1, in ascending order |
| `title` | yes | what the task delivers, short enough to become an issue title |
| `acceptance` | yes | the condition that makes the task done, stated so it can be checked |
| `verify` | yes | how someone confirms that condition — a command, a check, an observation |
| `description` | no | context the title cannot carry, including named dependencies |
| `files` | no | the files the task is expected to touch |
| `scope` | no | the size estimate |
| `depends_on` | no | an array of `num` values from this same list |

Every `depends_on` entry must name a task in the same array, and the graph must have no cycle. A forward reference is fine — a task may depend on one numbered after it.

Any argument outside that set is rejected outright rather than dropped. That is deliberate: an argument the renderer cannot emit would vanish silently, and silent loss in a plan a human is about to approve is worse than a refusal. The tool publishes its own schema — that schema, not this table and not any example, is the authority on argument names and shapes.

A call looks like this. It is an arguments object, not a document.

```json
{
  "identifier": "FLO-1234",
  "tasks": [
    {
      "num": 1,
      "title": "Add the archived column to the milestone table",
      "description": "Schema and migration only. Nothing reads the column yet.",
      "acceptance": "The column exists, defaults to false, and the migration ledger is clean.",
      "verify": "Apply the migration to a scratch database and run the schema check.",
      "files": "server/migrations, server/app/models",
      "depends_on": []
    },
    {
      "num": 2,
      "title": "Expose archiving through the service layer",
      "description": "Needs the task titled Add the archived column to the milestone table to land first.",
      "acceptance": "Archiving a milestone flips the column and is attributed to the caller.",
      "verify": "Run the milestone service tests.",
      "depends_on": [1]
    }
  ]
}
```

### One line per value

Every field value is a single line, and `put_todo_tasks` refuses one that is not — it does not accept the value and quietly reshape it. The reason the rule exists is the document grammar underneath: it stores one field per line, so a value that wraps gets folded back together with a single space on the way in. Rather than let you write something that would come back changed, the tool declines it and names the field.

Write one sentence per field. When a value wants a paragraph, the paragraph belongs in the `plan` doc and the field carries the one line that can be checked.

### A refusal is feedback

`put_todo_tasks` validates the list as it writes it, and `submit_for_review` validates that all four kinds exist. Either can refuse. A refusal is the tool doing its job — it is catching, now, a task that would have failed conversion later, after a human had already spent their attention approving it.

Read the refusal, fix the task, call again. Two ways of routing around it are both wrong:

- Falling back to `put_planning_doc` with hand-written markdown. That gets the bad task past the validator and into a human's review queue.
- Writing the plan to a local file instead. That gets the plan out of Flowly entirely, where no gate, no reviewer and no conversion can reach it.

### Dependencies

`depends_on` orders the child issues — conversion sorts them by the graph, so ascending child issue number is a valid execution order. But the dependency itself does not reach the child issue; the child's own body does not carry it.

So state the dependency twice. Once in `depends_on`, for the ordering. Once in the dependent task's `description`, in prose, naming the other task **by its title**. Never by its number — task numbers do not survive conversion, so a description that points at "task 1" points at nothing once the children exist.

## The Gate

The gate is a review state on the issue, and it takes five values — `none` before anything is planned, `planning` while you write, `in_review` once you hand over, `changes_requested` when a human wants something different, and `approved`.

Writing the first planning doc moves the state from `none` to `planning` on its own; you never set it by hand. `submit_for_review` moves it to `in_review`. From there a human either approves it or requests changes, and the `changes_requested` loop can run any number of times.

Only a human reaches `approved`. There is no agent path to it, no flag that skips it, and no argument that overrides it. `references/planning-docs.md` has the transitions and the revision loop in full.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll draft the plan in a file and paste it into Flowly later" | The file has no gate, no reviewer and no conversion. Later never comes, and the issue stays empty. Write it through the tools the first time. |
| "The tool refused, so I'll write the markdown by hand" | The refusal is a conversion failure caught early. Routing around it just moves the failure to after a human approved the plan. Fix the task. |
| "This acceptance needs a paragraph to be accurate" | Every field value is one line. If it does not fit, the reasoning belongs in the `plan` doc and the field carries the checkable line. |
| "The risks doc is thin, three docs are enough" | Submission requires all four kinds. Write the thin one — thin is allowed, absent is not. |
| "I know the rendered format, I'll just emit it" | The server owns that shape and changes it without telling you. Send the task objects and let it render. |
| "`depends_on` records the dependency, the child will know" | It orders the children and stops there. The child's body does not carry it. Name it in the description too, by title. |
| "I'll say the task depends on task 1" | Numbers do not survive conversion. Name the other task by its title or the pointer dangles. |
| "The plan is obviously fine, I'll approve it and start" | There is no agent path to approval. Submit, poll, wait. |
| "I'll convert now and fix the tasks in the child issues" | Conversion runs once and refuses when children exist. Every edit has to land before approval. |
| "I'll guess the argument names, they're standard" | The tool publishes its schema. Read it instead of guessing, and note that an unknown argument is rejected, not ignored. |

## Red Flags

- A plan document written into the working tree — `tasks/plan.md`, `tasks/todo.md`, or anything like them
- The todo kind written through `put_planning_doc` instead of `put_todo_tasks`
- A doc kind that is not one of the four
- A field value that wraps onto a second line
- Reproducing the rendered document's shape anywhere instead of sending task objects
- Calling `submit_for_review` before all four kinds exist
- A dependency named by number in prose, or named only in `depends_on`
- Task numbers that skip, repeat, or run out of order
- Implementation starting while the review state is still `in_review`
- `convert_todo_to_issues` called before approval, or called a second time
- A tool refusal treated as an obstacle rather than as the answer

## Verification

Before handing the plan over, confirm:

- [ ] `list_planning_docs` returns all four kinds for this issue
- [ ] The todo kind was written by `put_todo_tasks`, and the tool returned the rendered document
- [ ] Every task carries `num`, `title`, `acceptance` and `verify`
- [ ] The `num` values are contiguous from 1 and in ascending order
- [ ] Every field value is a single line
- [ ] Every `depends_on` entry names a task in the same list, and no cycle exists
- [ ] Every dependency is also named in the dependent task's `description`, by the other task's title
- [ ] No plan artefact was written to the local filesystem
- [ ] `submit_for_review` returned without a refusal

After the gate, before implementing:

- [ ] `get_review` reports `approved`, set by a human
- [ ] `convert_todo_to_issues` ran once and the child issues exist

## See Also

`references/planning-docs.md` — what belongs in each of the four docs, the review states and their transitions, the revision loop after changes are requested, and what conversion does and does not carry.

For how big a task should be and how to slice work vertically, the `planning-and-task-breakdown` skill still holds. This skill changes where the plan lands, not how it is written.
