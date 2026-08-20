---
description: Work a named set of small Flowly issues to done in one pass, with one run holding the queue.
argument-hint: FLO-301 FLO-304 FLO-307
---

Work several already-understood Flowly issues to done in one run.

## Resolve the issues

This command works on a NAMED SET of Flowly issues, and resolving which ones comes first — before
reading code, before calling any other tool, before writing anything.

1. **From the invocation arguments.** Claude Code appends them to the end of this body
   automatically, precisely because this body names no substitution token. Separated by spaces or
   commas; two or more of them.
2. **`FLO-1234`, `flo-1234` and the bare `1234` are all accepted.** Flowly's tools match an
   identifier case-insensitively and take the bare number, so pass through the form the human used
   rather than reformatting it.
3. **The order given is the order they are worked.** It is stored on the run and a resumed run
   walks it the same way, so do not sort it and do not regroup it.

**If no identifier can be resolved, stop and ask.** Do not guess, and do not assemble a set out of
whatever happens to be open — a batch is a set somebody named. And do not fall back to writing a
plan, a spec, a todo list, a checklist or notes to a local file — every artifact belongs to the
issues and to the run, and a local file is the exact failure this distribution exists to prevent.

## Find the run before starting one

`list_loop_runs(target=<any one of them>)` matches a run that names that issue **or contains it**, so
one call finds a batch already in flight. Nothing found reads the same as no run in flight, and a
second run over issues the first is part-way through is what this lookup exists to prevent.

Found one? Resume it: read each issue's status, and start from the lowest-positioned one that is
neither done nor canceled. One sitting in progress means an earlier run stopped inside it — read it,
read its comments, and look at the working tree before carrying on.

## Otherwise start one

`list_loops` for a loop whose `target_kind` is `issue_set`, or `create_loop` with that kind — it is a
reusable recipe, so one such loop serves every batch. Then `run_loop(loop_id, targets=[…],
autonomy=2)` and `advance_loop_run(run_id, status="running")`.

Invoke the flowly:flowly-batch skill for the loop itself: what each issue's turn looks like, why the
run stays in its plan phase for its whole life, one commit per issue per repository, and why a batch
that hits trouble is never marked failed.

## Hand it over

`attach_evidence` as the work lands, then `advance_loop_run(run_id, status="awaiting_review")`, which
notifies every human on the team. Then stop — the verdict is theirs and there is no tool for it.

## Stop conditions

Stop, and do not start the next issue, when one needs a decision the batch cannot make, when one
turns out to depend on another that is not done, when a check goes red for a reason outside the
issue being worked, or when the working tree was not clean at the start. Comment on the issue in
flight, attach a note, advance to awaiting_review, and stop. Do not widen an issue to absorb a
surprise, and do not push past one of these because the rest look easy.
