---
description: Review a Flowly issue's changes on five axes and take the loop run to awaiting review
argument-hint: FLO-1234 (issue identifier)
---

Review the work done for one Flowly issue, then hand the verdict to a human.

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

## Review on five axes

Read the issue with `get_issue` and its planning docs with `list_planning_docs` first: a review
against the wrong intent is worse than no review at all. Then invoke the
flowly:code-review-and-quality skill and cover all five axes:

1. **Correctness** — does it do what the issue asked? Edge cases? Are the tests real tests?
2. **Readability** — clear names, straightforward control flow, structure you can navigate.
3. **Architecture** — does it fit the patterns already here, at the right boundary?
4. **Security** — untrusted input validated, secrets kept out, authorization actually checked.
5. **Performance** — no N+1, no unbounded work, no accidental quadratic.

Categorize each finding Critical, Important or Suggestion, with the file and line. The
flowly:flowly-review skill carries the Review phase workflow.

## Where the verdict lives

A code-review verdict belongs to the **loop run**, not to the issue. The issue's `review_state` is
the plan gate — a different gate, decided earlier, by a human, about the plan rather than the code.

`advance_loop_run` refuses the human's verdict values: it will not take `approved` and it will not
take `changes_requested`. Reaching `awaiting_review` is where the agent's part ends.

So: post the findings — `add_comment` on the issue, or `attach_evidence(run_id, "note", content, url)`
on the run — advance the run to `awaiting_review`, and stop there.
