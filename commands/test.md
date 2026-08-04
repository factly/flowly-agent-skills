---
description: Drive a Flowly issue's verification with TDD and record the run's evidence in Flowly
argument-hint: FLO-1234 (issue identifier)
---

Verify one Flowly issue's work, then leave the evidence where Flowly can read it.

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

## Drive the tests

Invoke the flowly:test-driven-development skill and follow it properly:

1. **RED** — write the test that describes the behaviour and watch it fail. A test that has never
   failed has proved nothing. For a bug, the failing test must reproduce the bug.
2. **GREEN** — the smallest change that makes it pass.
3. **Regression** — run the whole suite, not only the test you just wrote.

Invoke the flowly:browser-testing-with-devtools skill when the behaviour lives in a browser; console
and network output are the evidence there. The flowly:flowly-verify skill carries the Verify phase
workflow.

## Record the evidence

Flowly's Verify artifact is an evidence packet on the loop run, not a green suite on your machine.
This is an addition to the inherited workflow rather than parity with it.

When the work belongs to a loop run — `list_loops` and `list_loop_runs` locate it, `get_loop_run`
reads it — attach all three with `attach_evidence(run_id, kind, content, url)`:

- `diff` — what changed.
- `test` — the run's actual output, pass or fail, rather than your summary of it.
- `note` — anything you could not verify, and why. A gap named in the packet is one a reviewer can
  act on; a gap left out is one they inherit without knowing.

If there is no loop run, say so plainly and put the same three into `add_comment` on the issue.
