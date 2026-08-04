---
description: Plan a Flowly issue — write its plan, todo and risks docs, then submit them for review
argument-hint: FLO-1234 (issue identifier)
---

Turn one Flowly issue's research into a reviewable plan, written to that issue.

## Resolve the issue

This command works on exactly one Flowly issue, and resolving which one comes first — before
reading code, before calling any other tool, before writing anything.

1. **From the invocation arguments, if present.** Claude Code appends them to the end of this body
   automatically, precisely because this body names no substitution token.
2. **Otherwise from the conversation**, and only when exactly one issue is unambiguously under
   discussion. Two candidates, or an issue mentioned in passing, is not unambiguous.
3. **`FLO-1234`, `flo-1234` and the bare `1234` are all accepted.** Flowly's tools match an
   identifier case-insensitively and take the bare number, so pass through the form the human used
   rather than reformatting it.

**If exactly one identifier cannot be resolved, stop and ask for it.** Do not guess. Do not pick the
most recent issue. And do not fall back to writing a plan, a spec, a todo list, a checklist or notes
to a local file — every artifact belongs to the issue, and a local file is the exact failure this
distribution exists to prevent.

## Read what exists

`get_issue`, then `list_planning_docs`. The `research` doc is this command's input; if it is missing,
run the research command first rather than planning from an empty context.

## Write the docs

Invoke the flowly:planning-and-task-breakdown skill for the breakdown method, and the
flowly:flowly-plan skill for how Flowly wants a plan written.

- `put_planning_doc(identifier, "plan", content)` — the approach, the decisions and their reasons,
  and what is deliberately out of scope.
- `put_todo_tasks(identifier, tasks)` — the structured way to write the `todo` doc. Vertical slices,
  each with acceptance criteria and a verification step, in dependency order.
- `put_planning_doc(identifier, "risks", content)` — what could go wrong, and what would catch it.

All four kinds — `research`, `plan`, `todo`, `risks` — must exist before you submit. Confirm that
with `list_planning_docs` rather than assuming your writes landed.

## Submit, then stop

`submit_for_review(identifier)` moves the issue's plan gate to `in_review`. The
flowly:flowly-plan-gate skill carries the gate's rules.

**Approval is a human action in Flowly's web app.** There is no agent-side path from `in_review` to
`approved`, and you must not begin implementation until `get_review(identifier)` reports `approved`.
If it reports `changes_requested`, revise the docs and submit again. Once it reports `approved`,
`convert_todo_to_issues(identifier)` turns the todo doc into child issues.
