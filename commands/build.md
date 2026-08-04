---
description: Implement an approved Flowly issue's child issues one at a time, updating each in Flowly
argument-hint: FLO-1234 (issue identifier)
---

Implement the work an approved Flowly plan broke out, one child issue at a time.

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

## Check the gate before writing code

`get_review(identifier)` must report `approved`. If it reports anything else — `none`, `planning`,
`in_review`, `changes_requested` — stop and say so. An unapproved plan is not a plan to build.

`list_issues` filtered to this issue's children gives the work the approved `todo` doc produced. If
there are none, `convert_todo_to_issues(identifier)` creates them.

## Work one child issue at a time

For each child, in dependency order, one at a time:

1. `update_issue` to move it into progress before you touch a file.
2. Invoke the flowly:incremental-implementation skill — the smallest change that makes one thing
   work, not the whole slice at once. Invoke the flowly:test-driven-development skill for the logic:
   a failing test first, then the code that passes it.
3. Run the project's own checks. Green before you move on.
4. Commit that child's work as one commit, containing only that child's work.
5. `update_issue` to move it to done, and `add_comment` with what changed and anything the next
   child needs to know.

The flowly:flowly-build skill carries the Build phase workflow.

## Stop conditions

Stop and ask when a child's acceptance criteria turn out to be wrong, when the work needs a decision
the plan did not make, or when a check goes red for a reason outside the child you are on. Do not
widen a child's scope to absorb the surprise — take it back to the plan.
