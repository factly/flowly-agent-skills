# Syncing with upstream

This repository is a hard fork of [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills).
Upstream history is preserved, so upstream's improvements can still be merged — and merging them is a
deliberate, monthly, by-hand operation, not something that happens on its own.

Everything a merge is resolved against lives in [`NOTICE.md`](../NOTICE.md): the base SHA in
§ Base, the four statuses in § Ownership register, and the list of files we deleted in
§ Removed at import. `scripts/check-register.js` is what keeps that table honest, so it is worth
trusting — but only as far as it goes, and § Resolving a conflict below says where that is.

Do this monthly. Do it on its own branch, with nothing else in it.

---

## The procedure

### 1. Add the remote — once per clone

```sh
git remote add upstream https://github.com/addyosmani/agent-skills
```

### 2. Fetch, and find out whether upstream actually moved

```sh
git fetch upstream --tags
git log --oneline <base-sha>..upstream/main
```

Take `<base-sha>` from `NOTICE.md` § Base. **If that log is empty, upstream has not moved and there
is nothing to merge.** Stop here and say so; do not run the merge to produce a green tick. A merge
that changes nothing is indistinguishable from a merge that was reviewed, and the whole point of this
procedure is the review.

### 3. Branch

```sh
git switch -c sync/upstream-$(date +%Y-%m) main
```

One merge per branch, nothing else on it. A sync branch carrying unrelated work makes the one diff
anybody needs to read — what upstream changed and what we did about it — unreadable.

### 4. Merge

```sh
git merge upstream/main
```

Expect conflicts in `bound` files. Their absence is not good news; see § Resolving a conflict.

### 5. Resolve, file by file, against the register

Look up **every** conflicting path in `NOTICE.md` § Ownership register before touching it. The status
is the instruction. § Resolving a conflict below spells out all four.

### 6. Advance the base SHA — this is not bookkeeping

Update `NOTICE.md` § Base: the `Base SHA` becomes the upstream commit you just merged, and the
`Upstream commit date` becomes its date. Tag it, and put the tag in `Base tag`.

This is load-bearing, and `check-register.js` will not let you skip it. Every row marked `unchanged`
asserts the file is byte-identical to its blob **at the base SHA**. Merge an upstream change into one
of those files without moving the base and the assertion is false for every file upstream touched —
the check goes red, and the only correct fix is to advance the base. That coupling is deliberate: it
is what forces the register to be re-read on every merge instead of once at the fork.

**Do not take the check's advice on this one.** When an `unchanged` file differs from the base it
prints:

```
↳ either restore it, or change its status to `bound`, `owned` or `new`.
```

Both of those are right when somebody edited a file and forgot the row, which is the case that hint
was written for. **Both are wrong after a merge.** Restoring the file throws away the upstream
improvement you just merged, and calling it `bound` claims an edit we never made — buying eye-review
on that file forever, on every future sync, for nothing. The correct third option is the one the hint
does not offer, because the check cannot tell the two situations apart: advance the base. The first
rehearsal hit this exactly (§ Rehearsal record).

`Base tag` is prose — nothing reads it. `Upstream` and `Base SHA` are read by the check.

### 7. Run every gate before opening anything

```sh
node scripts/validate-skills.js
bash scripts/validate-standard.sh
node scripts/check-no-hosts.js
node scripts/check-binding.js
node scripts/check-register.js
node scripts/check-catalog.js
node scripts/check-commands.js
node scripts/check-tool-drift.js
node --test scripts/run-evals-test.js
node scripts/run-evals.js --min-rank1 80
bash hooks/session-start-test.sh
bash hooks/simplify-ignore-test.sh
```

§ What a merge specifically endangers explains what each of these is watching for on a merge, which
is not the same as what it watches for on an ordinary change.

### 8. Push and open a pull request

CI runs on pull requests, not on pushes to arbitrary branches, so the pull request is what gets the
sync branch checked. (`workflow_dispatch` also runs it against any branch, if you want the gates
before you are ready to open one.)

Review the merge as a diff against `main`, not as a list of upstream commits. What matters is what
this repository looks like afterwards.

---

## Resolving a conflict

The register's four words each answer a different question. Read the status first; it decides the
resolution before you have an opinion about the hunk.

### `unchanged` — take upstream's version whole

Our side is byte-identical to the base, so there is nothing of ours to weigh. Accept upstream.

A conflict here should not be reachable. If one appears, the row is lying: somebody edited the file
and left the status alone. Resolve by taking upstream, then decide separately whether the edit that
caused it should come back — and if it should, the row becomes `bound`.

### `bound` — read every hunk by eye, and keep the binding

This is the status that costs money, and it is the only one that cannot be resolved mechanically.
These files were inherited and then edited to point at Flowly instead of at a file on disk. Take
upstream's improvements to the craft; keep our binding.

**The failure to watch for is upstream quietly reverting a binding.** Upstream has every reason to
re-add an instruction to write a plan to a local file — that is correct in their distribution. Accept
that hunk and the skill sends an agent to write a file nothing in this distribution will ever read,
and it happens without an error anywhere.

`scripts/check-binding.js` is the backstop, and it is worth knowing exactly how far it reaches: it
refuses a fixed list of destinations that upstream is known to use. It cannot recognise a destination
upstream invents next month. So the eye is the gate here and the check is the second line, not the
other way round.

If a `bound` file merges with **no** conflict at all, that is worth a second look rather than relief:
either upstream did not touch it, or the hunks happened not to overlap and upstream's new text now
sits beside our binding contradicting it.

### `owned` — take ours, never merge

An inherited path this fork has taken over. Upstream's version is not a candidate. Discard their side
entirely.

If upstream is now doing substantial work at that path, that is information rather than a change to
accept: note it in the pull request, because it will come back every month.

### `new` — there is nothing upstream to merge

Ours outright. A conflict here means upstream has started shipping at a path we took over — most
likely `commands/`. Keep ours, and record the collision in `NOTICE.md`, because the next merge brings
it again and the next resolver should not have to rediscover it.

### Files we deleted, offered back

A merge cannot tell "an inherited file is gone" apart from "an inherited file was never here", so
upstream re-offers everything we removed, as a delete/modify conflict every time.

**The answer is no.** `git rm` the path and move on. `NOTICE.md` § Removed at import lists what was
removed and why, one entry each — upstream's meta-skill, upstream's own slash-command directory, the
helper script that created a local directory `idea-refine` no longer saves into, and the manifests
for the doors this fork does not ship. That section is the reason a resolver can answer "no" in ten
seconds rather than relitigating the deletion.

If you delete an inherited file during a sync, add it to that section in the same commit. A deletion
recorded nowhere is a deletion the next resolver will silently undo.

---

## What a merge specifically endangers

Every gate runs on every change. These are the ones whose failure mode is *specific to a merge*, and
what each one is actually watching:

| Gate | On a merge it catches |
|---|---|
| `check-register.js` | the base SHA was not advanced, or a file changed status without the row changing — the two ways the table stops describing the tree |
| `check-binding.js` | upstream reverted a binding at one of the destinations it knows by name |
| `check-catalog.js` | upstream added, renamed or removed a skill and a hand-maintained list of skills did not follow — the router's index or the gap form's dropdown, in either direction |
| `validate-standard.sh` | upstream added a frontmatter field beyond `name` and `description`, which closes a door this fork keeps open |
| `check-commands.js` | upstream started shipping at `commands/`, or introduced a substitution token in a command body |
| `run-evals.js` | ranking is zero-sum — a skill upstream added or reworded re-scores **every** skill, so read the aggregate rank-1 number, not just the rows that changed |
| `check-no-hosts.js` | nothing upstream is likely to do, and it runs anyway, because this is the one failure that cannot be undone after a push |

`check-tool-drift.js` is the exception: it watches Flowly, not upstream, and a merge cannot move it.

---

## Rehearsal record

### First rehearsal — 2026-08, against a synthetic upstream commit

**Upstream had not moved since the fork.** At the time of the first rehearsal `upstream/main` was
byte-identical to the base SHA recorded in `NOTICE.md`, and no upstream tag was ahead of it. A
literal `git merge upstream/main` was a **no-op**.

That matters, because a no-op merge satisfies the sentence "one upstream merge has been completed" and
proves nothing whatsoever: no conflict is raised, no status is consulted, no binding is defended, and
the procedure above gets its first exercise on the day it is first genuinely needed. This is written
down rather than left to be inferred, so that a reader who later checks the history and finds an
empty merge knows it was noticed at the time and is not looking at a bug.

So the rehearsal was run against a **synthetic upstream commit**, built on the base SHA and touching
three files chosen because they produce the three conflict classes the register exists to arbitrate:

| The synthetic commit touches | Class | What resolving it has to show |
|---|---|---|
| a file registered `unchanged` | clean merge | it merges with no conflict and needs no human judgement — the common case, and the one that must stay cheap |
| a file registered `bound` | content conflict | it conflicts, and the resolution keeps the Flowly binding while taking upstream's improvement. This is the case the register exists for, and the silent failure it defends against |
| `skills/using-agent-skills/SKILL.md`, which we deleted | delete/modify conflict | the deletion holds. Upstream re-offers a removed file on every sync, and the answer is no — `NOTICE.md` already documents this pattern for the `idea-refine` helper script |

A synthetic upstream is a weaker test than a real one in exactly one respect: it does not tell you
what upstream will actually change. It is a stronger test in every other respect, because it reaches
all three classes on purpose instead of whichever one the month happens to produce.

**Outcome — run 2026-08-04, in a throwaway clone, merging a synthetic upstream commit into
`sync/2026-08`.** All three classes behaved as the table predicts, and one thing did not go as
described.

```
Auto-merging skills/spec-driven-development/SKILL.md
CONFLICT (content): Merge conflict in skills/spec-driven-development/SKILL.md
CONFLICT (modify/delete): skills/using-agent-skills/SKILL.md deleted in HEAD and modified in
  synthetic-upstream. Version synthetic-upstream of skills/using-agent-skills/SKILL.md left in tree.

UU skills/spec-driven-development/SKILL.md
DU skills/using-agent-skills/SKILL.md
```

- **`unchanged` merged clean.** `skills/test-driven-development/SKILL.md` took upstream's added line
  with no conflict and no human judgement, as it should.
- **`bound` conflicted, and the hunk was the exact silent failure § Resolving a conflict warns about.**
  Upstream's side restored *"Save the plan to `tasks/plan.md` … per the `/plan` command convention"*
  over our *"The plan and the task list belong to the Flowly issue … `put_planning_doc`"*. Accepting
  it would have reverted the binding, produced no error anywhere, and left the skill telling agents to
  write a file nothing in this distribution reads. Resolved by keeping ours.
- **The deletion held.** Note git's default: it leaves upstream's copy of the deleted file *in the
  working tree*. A `git add -A` at that moment silently resurrects the router this fork replaced.
  `git rm` is not a formality here.

**What did not go as described.** After a correct resolution, with every conflict handled,
`check-register.js` still failed:

```
✗  `unchanged` really is unchanged
     ERROR: marked unchanged but differs from the base: skills/test-driven-development/SKILL.md
```

That is the *clean* merge — the file nobody was asked to think about — and its hint recommends two
fixes that are both wrong here (§ 6). Advancing the base SHA to the merged upstream commit returned
all six register checks to green, and the other nine gates were green throughout, including
`run-evals.js` at rank-1 85%.

The lesson is worth carrying: on a sync, the file that needs attention afterwards is not the one that
conflicted. The conflict announced itself. The clean merge is what quietly made the register untrue.

### Later syncs

Add an entry per sync: the date, the upstream range merged, which `bound` files needed judgement, and
anything the register got wrong. The register is only worth having if it is true, and the place its
untruths become visible is here.
