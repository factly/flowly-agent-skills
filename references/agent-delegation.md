# Agent delegation in the build loop

The two serial walkers in this distribution — `flowly-build` and `flowly-batch` — accumulate every
child's reads, diffs and test output in one context. This file records what that actually costs,
measured rather than estimated, and it is the shared reference both skills point at instead of
restating the mechanics twice.

It opens with the measurement because the measurement is the whole argument. A design that offloads
context is worth its complexity only if the context is really the thing that runs out.

## The measurement

### What was measured

One `auto` run: **FLO-306, "Merge upstream agent-skills v0.6.7 into the fork", eight children**
(FLO-307 … FLO-314), worked serially by one agent on 2026-08-21. Seven reached `done`; FLO-308 was
`canceled` on a recorded human decision.

### Method

Claude Code writes a session transcript as JSONL, one object per line, under
`~/.claude/projects/<slugified-cwd>/<session-id>.jsonl`. Every `type: "assistant"` object carries a
`message.usage` block, and the context the model was handed for that request is

```
input_tokens + cache_read_input_tokens + cache_creation_input_tokens
```

Requests where that sum is zero are dropped: they are aborted or errored turns, not measurements of a
context. That left **704 usable requests** out of 2,260 transcript lines.

Segment boundaries come from the loop's own writes, not from wall-clock guesses. Each
`mcp__flowly__update_issue` tool call in the transcript names an issue and a status, so a child's
window is the span from its `in_progress` call to its `done` or `canceled` call. Those are the exact
brackets the build loop is required to write, which is what makes them usable as instrumentation.

Compaction boundaries are read from `type: "system"` objects with `subtype: "compact_boundary"`,
cross-checked against the `isCompactSummary` marker and the `/compact` command that preceded each.

Anyone can re-run this over a second parent. The numbers below are one run.

### Per child

Growth is the context at the end of a child's window minus the context at its start — what that child
added and left behind for every child after it.

| child | requests | context grew by |
|---|---|---|
| FLO-307 | 70 | 44,989 |
| FLO-308 (canceled) | 30 | 39,791 |
| FLO-309 | 48 | 30,860 |
| FLO-310 | 26 | 11,863 |
| FLO-311 | 40 | 24,600 |
| FLO-312 + FLO-313 + FLO-314 | 134 | 81,281 |

**The last row is three children, not one, and it cannot be split.** Their windows overlap: FLO-312
was opened at 14:07:35 and not closed until 14:19:17, and in that time FLO-313 ran start to finish
(14:10:43 → 14:14:01) and FLO-314 was opened (14:14:02). Growth inside overlapping windows cannot be
attributed to one child, so it is reported as a block — mean 27,094 apiece if divided evenly, which
is a division and not a measurement.

That overlap is itself a finding, and § *Three children in flight* below says what it means.

### The run as a whole

| | |
|---|---|
| window | FLO-307 `in_progress` 13:18:10 → FLO-306 `done` 14:28:26 |
| requests | 381 |
| context at start | 113,708 |
| context at end | **394,288** |
| growth over eight children | **280,580** |
| mean growth per child | 29,173 |
| sum of the eight child windows | 233,384 |
| growth *outside* any child's window | 47,196 |

That last row is the parent's own overhead — enumerating the queue, reading the parent's `todo` doc,
reconciling the count, committing between children. It is 17% of the run's growth and it is the part
delegation **cannot** remove, because it is exactly the work the parent must keep.

### What the estimate got wrong, in both directions

The research doc on FLO-305 estimated 15–25k tokens per child and 400–700k over the 27-child parent
cited at `skills/flowly-build/SKILL.md`.

- **Per child it was low.** Measured mean 29,173, with a spread from 11,863 (FLO-310) to 44,989
  (FLO-307). The cheapest child cost less than the estimate's floor and the dearest cost nearly
  double its ceiling, so the range was not merely shifted — it was narrower than reality.
- **The projection was therefore low too.** Twenty-seven children at the measured mean is roughly
  **788k of growth**, on top of whatever the context already held when the run started. There is no
  configuration in which that survives one context.

### Correcting the compaction claim

The FLO-305 plan states "four compaction boundaries in one run". **That is wrong, and the correction
matters more than the error.** The session contains five compaction boundaries, and:

| boundary | when | relative to the eight-child run |
|---|---|---|
| 1 | 2026-08-20 23:48:55 | before |
| 2 | 2026-08-21 13:09:03 | before |
| 3 | 2026-08-21 13:16:48 | before |
| 4 | 2026-08-21 14:31:04 | after |
| 5 | 2026-08-21 14:51:28 | after |

**Zero compactions occurred inside the run**, and every one of the five was invoked by hand with
`/compact` rather than fired automatically. The session spanned research and planning for two issues
as well as the build, and the boundaries cluster at those seams.

So the honest claim is not "the loop compacts mid-flight". It is this: **the run ended at 394,288
tokens and was compacted by a human eleven seconds later.** The session peak, 398,400, lands twelve
seconds after the run's last write, during the PR and release work that followed. The loop did not
survive its own run comfortably; it was rescued at the end by a human who happened to be watching.

That is a weaker claim about what *did* happen and a stronger one about what *will*. An unattended
`auto` run over a parent half again this size has no human at the boundary, and the compaction lands
wherever the context runs out — which, per `skills/flowly-build/SKILL.md`, is worst at a half-landed
`in_progress` child, the one state the loop is least able to reconstruct.

### Three children in flight

`skills/flowly-build/SKILL.md` opens by making serialism a rule rather than a pacing preference: the
child issue is the unit of status, commit and rollback, and two children in flight share all three
and leave none of them. The transcript shows that rule was broken in this run — three children were
open at once, for 3m18s and then 5m15s.

Nothing went wrong. That is the point worth recording: **the invariant was violated by an agent
following the skill, and no gate, no tool and no human noticed until a transcript was read weeks
later.** Prose asking for restraint was the only thing enforcing it, and prose is what failed.

This is the same shape as the constraint delegation depends on. A brief that merely *asks* a subagent
not to write to Flowly or not to run git is relying on the mechanism that has now been measured
failing in this exact loop. Where an allowlist can enforce a rule instead, it should.

## What the numbers support

- **Context offload is worth building.** 280,580 tokens of growth over eight children, ~29k of it per
  child, against a parent that only needs to keep the queue, the tracker writes and the commits.
- **Wall-clock parallelism is not what the measurement argues for.** Nothing here is a latency
  finding; the pain is a context that fills.
- **The floor is 47,196, not zero.** The parent's own overhead survives any delegation design, so the
  win to expect is on the 233,384, not on the whole 280,580.

## Limits of this measurement

- **n = 1.** One run, one parent, one repository, one kind of work — a merge with heavy conflict
  resolution, which is read-heavy in a way a feature slice may not be.
- **Three of the eight children cannot be attributed individually**, because their windows overlap.
  Five can.
- **Growth is not the same as cost.** A child that reads a large file and a child that writes a large
  file both grow the context; only one of them can be avoided by delegating.
- **The session did more than the run.** The 398,400 session peak includes the PR and the release; the
  run's own peak is 394,288, and that is the number to quote.
