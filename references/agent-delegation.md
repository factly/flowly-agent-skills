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
following the skill, and no gate, no tool and no human noticed at the time.** It surfaced only
because a transcript was read afterwards for an unrelated reason. Prose asking for restraint was the
only thing enforcing it, and prose is what failed.

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

### Limits of this measurement

- **n = 1.** One run, one parent, one repository, one kind of work — a merge with heavy conflict
  resolution, which is read-heavy in a way a feature slice may not be.
- **Three of the eight children cannot be attributed individually**, because their windows overlap.
  Five can.
- **Growth is not the same as cost.** A child that reads a large file and a child that writes a large
  file both grow the context; only one of them can be avoided by delegating.
- **The session did more than the run.** The 398,400 session peak includes the PR and the release; the
  run's own peak is 394,288, and that is the number to quote.

## The contract

One child in flight, exactly as before. The parent walks the queue; the implementation of the current
child runs in a subagent whose context is discarded when it returns. Nothing about the queue, the
order, the gate or the commits changes — **this buys context, not wall-clock**, and a loop that
adopts it should say so as plainly as `commands/build.md` already says it about `auto`.

### What the parent keeps

Everything durable. The division is not a matter of taste: each row is something a subagent either
cannot do correctly or cannot be trusted to do at all.

| the parent keeps | because |
|---|---|
| the queue, the ordering, the count reconciliation | the dependency graph survives only in the parent's task list, and a subagent holding one child cannot see it |
| every Flowly write — status, comments, everything | one actor's name belongs on the issue, and an interrupted run must stay legible from the tracker alone |
| every git command, including the commit | `git` is tree-wide; a subagent sharing the tree cannot scope a command to its own work |
| the dirty-tree precondition | it is a statement about a tree the subagent shares and did not create |
| the decision that a child is `done` | `done` means the acceptance holds **and** the commit exists, and only the parent knows the second half |
| the decision that a child is `canceled` | it changes the shape of a plan a human approved, so it is a human's call carried out by the parent |
| in `flowly-batch`, whether a cross-repository issue is finished | a subagent cannot know whether a sibling repository landed |

The last row is why parent-only writing is the universal rule rather than a `flowly-build` rule. There
is no version of the cross-repo case where a subagent has the information to decide.

### Why that is enforced rather than requested

**Subagents inherit the parent session's MCP tools by default**, and a plugin agent's `mcpServers`
declaration is ignored. So a delegated implementer arrives holding `update_issue` and every other
Flowly write unless the persona's `tools` allowlist takes them away — and nothing server-side refuses
a wrong write when it comes.

That the allowlist really does take them away was measured, on 2026-08-21, by probing two agents that
differ in exactly that respect so both outcomes were reachable:

| agent | `tools` | `mcp__flowly__*` reachable |
|---|---|---|
| allowlist naming only built-ins — `Bash, Read, WebFetch, WebSearch` | an allowlist | **none.** Reported the tool absent from its own definitions, and had no `ToolSearch` to reacquire it |
| no allowlist over MCP — all tools bar six built-ins | effectively none | **all 48**, `update_issue` among them; a read-only `whoami` executed and returned the parent's own actor |

Exclusion by omission is therefore sufficient, and `agents/implementer.md` is the persona that relies
on it. Two consequences worth carrying:

- **An agent's description is not its enforcement.** The unconstrained agent above is described in the
  registry as a read-only search agent. It holds every Flowly write tool. Any future design that fans
  out "read-only" helpers needs a constrained persona of its own, not a stock one and a hopeful
  sentence.
- **`Bash` has to stay, so `git` stays reachable.** An implementer runs the verification command, and
  the verification command needs a shell. The prohibition can only be by name, and it has to name the
  read-only spellings too — `status`, `diff`, `log`, `show` — because those are the ones that feel
  safe on the way to `stash`.

### The digest

The subagent's final message is the return value. It is read by a loop, not by a person, and it
carries four fields.

| field | carries |
|---|---|
| `outcome` | `implemented`, `blocked`, or `acceptance-wrong` |
| `files` | every path created, edited or deleted |
| `verification` | the command run, verbatim, and the tail of its real output |
| `notes` | what the other three cannot carry — a surprise, a missing dependency, a reason it stopped |

**`verification` is the field the whole design turns on.** The build loop requires a child's
verification to be run *and its output observed*; delegation moves the observer inside the subagent,
so the only thing that keeps the requirement real is that the evidence comes back with it. A field
reading `tests: pass` satisfies the letter of the loop and destroys the thing it protected, and
nothing goes red when it happens.

So: **a digest whose `verification` field carries no command text is malformed, and the parent stops
the child rather than accepting it.** Not a warning, not a note in the commit — a stop.

Be honest about what that buys. A subagent can still fabricate an output tail, and nothing here
prevents it. The gap narrows from "trust a boolean" to "trust a transcript", which is a real
improvement and not a proof.

### The file set is reported, not predicted

The parent stages from the digest's `files` field — **what the subagent actually touched**, not what
the task's `Files:` line predicted it would.

That is deliberate, and it is the opposite of tightening the prediction. `Files:` is optional and is
measurably narrower than the change it describes: one task named four files for work its own
description promised across nineteen call sites, and the twenty surfaces that went unhandled kept
every gate green, because the tests had been written against the four. Making the field *required*
would not fix that. It would make a bad predictor look authoritative, which is worse than an absent
one — an absent field invites a look, a confident wrong one does not.

A prediction made before the work cannot be better than a report made after it. So the loop asks for
the report.

### What delegation costs

Two things get worse, and a reader should meet them here rather than discover them.

**Resumability.** Today an interrupted run leaves the parent holding the full context of the half-done
child. Under delegation the parent holds a digest that never arrived, because the subagent died
mid-flight — so the child is `in_progress`, the tree may carry partial edits, and the parent knows
*less* about them than it would have before. Nothing automatic catches this. What holds is that the
parent still owns the status write and the commit, so the tracker stays truthful and the recovery path
is unchanged: read the child, read the tree, do not restart blind.

**A subagent can exhaust its own context.** A child too large for one fresh context returns a digest
assembled from a summary of itself, and that failure looks exactly like success. The partial-field
stop above is the immediate catch; the real answer is upstream, in task sizing, where a child that
overflows a fresh context was mis-sized when the plan was written.

## Not built: parallel implementation

Delegation makes concurrency *look* close, and it is worth writing down why it was not taken, so the
next person does not rediscover it at the cost of a corrupted tree.

**Read-ahead prefetch** — fanning out helpers to gather context for children not yet reached — is
plausible and unbuilt. Its value is wall-clock, which is not what the measurement above argues for,
and prefetch for a child whose predecessor rewrites the code underneath it is stale rather than
merely wasted. The staleness rule is the hard part and nobody has written it.

**Concurrent implementation across children** is gated behind explicit opt-in, and two facts stand in
its way:

- **No trustworthy conflict key.** Disjoint `Files:` lines do not imply children that cannot collide,
  for the reason given above. Overlap would have to be established by pre-flight search rather than
  taken from the plan.
- **Worktree isolation branches from the wrong commit.** `isolation: worktree` is real and it does
  dissolve the shared-tree problem — but the worktree is created **from the repository's default
  branch, not from the parent session's `HEAD`**. A build loop commits each child in sequence, so a
  worktree-isolated child sees a tree missing every sibling that landed before it. Under dependency
  ordering that is not an edge case; it is the normal case, and it breaks precisely the children that
  depend on one another. The cross-repository case has no worktree story at all.

Anyone picking this up should also pin the task-list document's wire format in the server's own tests
first. Its dependency line is currently exercised only by a round-trip through its own parser, and a
round-trip agrees with itself: rename the token in both and every test stays green while readers
outside the server break. Serial delegation does not care, because it matches children to tasks by
title and parses nothing. A scheduler would care a great deal.
