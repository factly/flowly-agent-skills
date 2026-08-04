---
description: Bundle a finished Flowly issue into a release, and run the pre-launch checklist
argument-hint: FLO-1234 (issue identifier)
---

Ship one Flowly issue: put it into a release, and check that launching is actually safe.

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

## Two different things called ship

**Flowly's release is an object** — a dated bundle of issues that went out together, with notes,
created and read through `list_releases`, `create_release` and `update_release`. It is the record of
what shipped.

**The flowly:shipping-and-launch skill is the pre-launch checklist** — monitoring, staged rollout,
rollback plan, go/no-go. It is the decision about whether to ship at all.

Do both. They share a word and nothing else.

## Bundle the issue

1. `get_issue` — confirm the work is actually done. A release naming unfinished work misinforms
   everyone who reads it later.
2. `list_releases` — if an open release covers this change, reuse it.
3. Otherwise `create_release`, then `add_issue_to_release`. `remove_issue_from_release` undoes a
   wrong bundling and `update_release` fixes the notes.
4. `link_pull_request` when the change went out as a pull request, so the release points at the code.

## Check the launch

Invoke the flowly:shipping-and-launch skill for the checklist, and the flowly:flowly-ship skill for
the Ship phase workflow. Record the go/no-go with `add_comment` on the issue, naming what would
trigger a rollback. A checklist run and never written down is a checklist nobody can audit.
