---
description: Implement an approved Flowly issue's children in Flowly. Add "auto" to work all of them in one pass.
argument-hint: FLO-1234, or "auto FLO-1234" for the whole plan
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

## Select the mode

The arguments carry two independent things and they may arrive in either order: the identifier you
just resolved, and optionally a mode word. Read each out of the argument text separately. Do not
test the whole argument against the mode words — `auto FLO-1234` is both, and matching the whole
string selects single-task mode on the very invocation that asked for the opposite.

- **`auto`, or `all`** — autonomous: work every remaining child to done without stopping between
  them.
- **anything else, or nothing** — the default: work the next child, then stop.

Autonomous is not faster per child. Same loop, same tests, same one commit per child; it removes the
human step between children and nothing else.

## Check the gate

`get_review(identifier)` must report `approved`. Anything else — `none`, `planning`, `in_review`,
`changes_requested` — means stop and say so. There is no file to look for and no spec on disk; the
gate is the human decision recorded on the issue.

## Work the children

`get_issue` gives the parent its own id and project. `list_issues` on that project returns every
issue in it, each carrying a `parent_id`; the children are the ones that match. There is no parent
filter, and the list is capped and newest-first, so **sort the matches by issue number ascending**.
That is the dependency order conversion produced; the returned order is its reverse. With no
children yet, `convert_todo_to_issues(identifier)` creates them.

Then, one child at a time: `update_issue` it into progress, invoke the flowly:flowly-build skill for
the loop, and `update_issue` it to done with an `add_comment` saying what changed. One commit per
child, containing only that child's work.

Re-invoking resumes from the tracker, not from a file: the next child is the lowest-numbered one
that is not done and not canceled. A child sitting in progress means an earlier run stopped inside
it — read it, and the working tree, before carrying on.

## Stop conditions

Stop and ask when a child's acceptance turns out to be wrong, when the work needs a decision the
plan did not make, when a check goes red for a reason outside the child you are on, or when the
child count disagrees with the plan. Do not widen a child to absorb the surprise, and in autonomous
mode do not push past one of these — take it back to the plan.
