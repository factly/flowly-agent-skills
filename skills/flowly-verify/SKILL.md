---
name: flowly-verify
description: Attaches a Flowly loop run's evidence packet — the diff, the test output and the log a human reviews instead of the agent's summary — as few substantial items, because the packet caps at item count and not size. Use after a Flowly child issue's work is committed and its verification has been run, use before a loop run is handed over at awaiting_review, and use when a packet comes back reporting its own truncation.
---

# Verifying in Flowly

## Overview

The evidence packet is what a human reads instead of the agent's account of what it did. A summary that stands in for the work turns review into a reading exercise, and the packet exists to make that substitution unnecessary: the diff, the output, the log, in the order they were produced.

**This is an addition to this distribution, not a rebinding of something already in it.** The other skills here produce evidence — a test run, a browser session, a failure chased to its cause — and none of them has anywhere to put it, because no inherited skill has the concept of an evidence packet. Nothing in this file replaces an older instruction. It describes an object that only exists in Flowly.

The packet hangs off a **loop run**, not off an issue. `attach_evidence` takes a `run_id` and nothing else identifies a packet. If the work was not done under a run, there is no packet to attach to.

## When to Use

- A child issue's work is committed, its verification has been run, and a human is about to look at it
- A run is going to `awaiting_review` and the packet is everything the reviewer will have
- A verification produced output that has to reach the reviewer verbatim rather than paraphrased
- A run came back `changes_requested`, the work was redone, and the new evidence has to be attached
- A packet was read back and it reports that it was truncated

**When NOT to use** — deciding whether the tests should pass (the build loop and the testing skills own that), reviewing someone else's change, or work with no Flowly loop run behind it. Without a run there is nowhere for evidence to go.

## The Packet

`attach_evidence(run_id, kind, content, url)` adds **exactly one item per call**. The kinds are a closed set of five:

| kind | carries | how many, typically |
|---|---|---|
| `diff` | the change itself | one |
| `test` | verification output, as it was printed | one per suite that ran |
| `log` | a build, deploy or tool log | one, if any |
| `link` | a URL out to something too large to inline | as few as possible |
| `note` | what could not be verified, and why | one |

Read the packet back with `get_loop_run(run_id)`. Find the run in the first place with `list_loop_runs(target=<issue identifier>)` — a run id from an earlier conversation is not something you are still holding, and `get_loop_run` and `attach_evidence` both need one.

Attach in the order you produced them. The packet is read top to bottom by someone deciding whether to approve.

### Inline text or a URL — there is nothing else

`content` is inline text and `url` is a link. **Large-artifact storage is deferred**: there is no upload, no attachment and no blob store. `url` must be `http` or `https`, because it is rendered as a link a human is invited to click, and any other scheme is refused rather than guessed at.

So an artifact too large to inline goes behind a `link`, with a `note` saying what is behind it and why. It does not go to a path in the working tree — the reviewer is reading Flowly, not your filesystem, and a path names nothing they can open.

## The Cap Is On Count, Not Size

The packet holds **250 items**. That is the same cap every list in Flowly uses, and it counts rows, not bytes. There is no byte budget anywhere in it.

| what gets attached | items | what the reviewer gets |
|---|---|---|
| one `diff`, one `test`, one `note` | 3 | all of it |
| one `diff` of 4,000 lines | 1 | all of it |
| 300 one-line `note`s | 300 | the first 250 — the last 50 are gone |
| one `test` log split into 40 chunks "so it fits" | 40 | all of it, 40 slots spent, unreadable |

**Few substantial items beat many small ones**, and the arithmetic is the entire reason. A 4,000-line diff is one item. Forty notes describing that same diff are forty items, and worse evidence besides.

The consequence that catches people is the last row. Splitting a large artifact to make it "fit" moves it in exactly the wrong direction: there is nothing to fit into, so chunking spends forty slots to deliver the same bytes and hands the reviewer a jigsaw. Size is never the reason to split. If an artifact is unwieldy, that is a `link`.

## Truncation Is Reported — And Only Here

`get_loop_run` returns the packet **with a flag saying whether it was truncated.** This is the only list in Flowly that reports its own truncation. Every other list — issues, comments, runs, planning docs, notifications — cuts at the cap silently and hands back a short list indistinguishable from a complete one.

Two things follow from that, and both are load-bearing:

- **The flag is a report of loss, not an offer of the rest.** Flowly has no pagination anywhere: no cursor, no offset, no page token. There is no second call that returns the missing items, so a raised flag cannot be cleared by fetching more. The only fix is to have attached fewer, larger items in the first place — which means rebuilding the packet, not extending it.
- **The exception exists because of what the packet decides.** A silently truncated issue list costs someone a scroll. A silently truncated evidence packet lets a human approve a run on a subset of its evidence while believing they saw all of it, and that verdict is the thing the gate exists to produce. The flag is there so the reviewer's approval means what it says.

A packet that comes back with the flag raised is not ready for a human. Say so, rebuild it, and hand it over once the flag is clear.

## Process

1. **Find the run.** `list_loop_runs(target=<issue identifier>)` returns the runs against that target, newest first. Use the one already in flight rather than starting another. No run means no packet — that is a stop, not a workaround.
2. **Attach the change.** One `diff` item. Too large to inline: one `link`, plus a `note` saying what it points at.
3. **Attach the verification output.** One `test` item per suite that ran, carrying what was printed. Output that was never read is not evidence, and output that was summarized is not either.
4. **Attach the logs that matter.** A `log` item where a build or tool log explains something the diff and the tests do not.
5. **Attach the gaps.** One `note` for everything that could not be verified, what was assumed, and what a reviewer should look at hardest. This is the item most often skipped and the one a reviewer most often needs.
6. **Read it back.** `get_loop_run(run_id)`. Check the truncation flag, check the order, check that each item says what you meant it to.
7. **Hand over.** `advance_loop_run(run_id, status="awaiting_review")`. That is where your part ends.

On step 7: `advance_loop_run` accepts `running`, `awaiting_review`, `completed`, `failed` and `canceled`. It **rejects `approved` and `changes_requested`** — those are the human's verdict and there is no tool that writes them. `completed` is refused until the run has been approved, at every autonomy level, and that gate cannot be turned off. The reviewer learns there is something waiting from their own inbox, where `run_awaiting_review` is the notification kind for exactly this.

If the verdict comes back `changes_requested`, the run is not dead. It goes back to `running`, the work is redone, the new evidence is attached, and it returns to `awaiting_review` — `changes_requested` moves to `running`, not straight back to `awaiting_review`.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll summarize what changed — the reviewer doesn't need the whole diff" | The packet exists so review is not a reading exercise over your account of the work. Attach the diff. A summary is a `note` beside it, never instead of it. |
| "The tests passed, I'll say so in a note" | "Tests passed" is a claim. The printed output is evidence. Attach it as `test`. |
| "The diff is huge, I'll split it across items so it fits" | Nothing needs to fit — the cap counts items, not bytes. Splitting spends slots to deliver the same bytes and leaves the reviewer reassembling it. One item, or a `link`. |
| "I'll attach a note per file so the reviewer can follow along" | That is one item per file against a 250-item cap, and it is worse evidence than the diff it describes. |
| "The packet says it truncated, I'll fetch the remaining items" | There is no call that returns them. Flowly has no cursor, no offset and no page token. The flag reports loss; it does not offer recovery. |
| "It truncated but the important items are early, that's fine" | You would be asking a human to approve on a subset they cannot see the edge of. Rebuild it as few substantial items and say what happened. |
| "It's capped like every other list, so it'll just cut quietly" | This is the one list in Flowly that reports its own truncation. Silence is what everything else does, which is exactly why this one does not. |
| "I'll write the diff to a file and put the path in a note" | There is no artifact store and no filesystem shared with the reviewer. Inline text or an `http`/`https` URL — those are the only two things that exist. |
| "I linked the pull request, so the diff is attached" | `link_pull_request` records the PR against the issue. It attaches no evidence and moves no status. A `link` item in the packet is a separate call. |
| "The work is done, I'll move the run to `completed`" | `completed` is refused until a human approves the run. The ship gate is on for every run and cannot be switched off. |
| "The evidence is obviously fine, I'll mark the run `approved`" | `advance_loop_run` rejects `approved` and `changes_requested`. They are the human's verdict and no tool writes them. |
| "There's no run, I'll attach the evidence to the issue instead" | `attach_evidence` takes a run id, and there is no issue-level packet. No run, no packet — find the run or stop. |
| "I couldn't verify one thing, no point mentioning it" | The unverified part is the highest-value item in the packet. It is what tells the reviewer where to look. |

## Red Flags

- A packet whose only item is a `note` describing the work
- Test output paraphrased rather than attached as it was printed
- One artifact split across several items "so it fits"
- One item per file, per test case, or per commit
- A truncation flag read and moved past
- A filesystem path, or any scheme other than `http`/`https`, in a `url`
- `attach_evidence` called with an issue identifier where a run id belongs
- Evidence attached after the run already reached `awaiting_review`
- `advance_loop_run` called with `approved` or `changes_requested`
- A run driven to `completed` by the agent
- A packet handed over with nothing recording what could not be verified
- A second run started against a target that already has one in flight

## Verification

Before the run is handed to a human:

- [ ] The run id came from `list_loop_runs`, or from the call that started the run
- [ ] The change itself is attached as a `diff`, not described
- [ ] Every verification that ran is attached as `test`, carrying its output as printed
- [ ] Anything that could not be verified is attached as a `note`
- [ ] No artifact was split into pieces, and nothing was split for size
- [ ] Anything too large to inline sits behind an `http`/`https` `link`, with a note saying what it is
- [ ] `get_loop_run` was called and the packet read back
- [ ] Its truncation flag is not raised
- [ ] The items are in the order they were produced
- [ ] `advance_loop_run(run_id, status="awaiting_review")` was the last call, and nothing attempted the verdict

## See Also

The `flowly-build` skill — the loop that produced the code and the commits this packet is evidence of. It commits and does not attach; this skill attaches and does not commit.

The `test-driven-development` skill and the `debugging-and-error-recovery` skill produce what goes into the packet. They say how to get the output; this skill says where it goes, in what units, and why the units decide whether the reviewer sees all of it.

The `code-review-and-quality` skill — what a reviewer does with the packet once it is waiting on them, and why the verdict on built work lives on the run rather than on the issue.
