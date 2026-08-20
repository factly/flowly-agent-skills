---
name: flowly-ship
description: Records what a set of finished Flowly issues amounts to, as a dated release bundle — creating the release, adding and removing its member issues, and carrying its status through to released or canceled. Use when finished work has to be grouped into a Flowly release, use when an issue has to go into or come out of a release, and use after a release has gone out and the record has to say so.
---

# Releases in Flowly

## Overview

A release in Flowly is a **dated bundle of issues** — a team-scoped record of what went out together, drawn from whatever projects happen to hold the work. It has a name, an optional version, an optional target date, a status, and a membership list.

**A release ships nothing by itself.** Creating one deploys no code, merges no branch, tags no commit, notifies no user and starts no rollout. Setting its status to `released` flips no switch; it records that the thing already happened. The bundle is the record written beside the deploy, never the deploy.

That is worth stating twice because the form looks like a button. It is a row.

## This Is Not the Pre-Launch Checklist

Two skills in this corpus answer to the word *ship*, and they do opposite halves of the job.

| | `shipping-and-launch` | this skill |
|---|---|---|
| Question | **are we ready to go?** | **what went out together, and where is that written?** |
| Artifact | a checklist result, a rollback plan, a go/no-go call | a Flowly release row and its issues |
| Timing | before the deploy | around and after it |
| Content | feature flags, staged rollout, monitoring, error budgets, rollback | name, version, target date, status, membership |
| Changes production | yes — that is the point | no, never |

**Reach for the `shipping-and-launch` skill when the question is readiness.** It owns the pre-launch checklist, the flag strategy, the staged-rollout thresholds and the rollback plan, and none of that is restated here. It already carries a short section pointing at the release object; this skill is the long form of that pointer, not a rival to it.

Most real launches use both, in order: run that checklist, deploy, then record the bundle here. Filling in a release form is not a launch, and a launch with no release row is work nobody can later account for.

Two more neighbours, so the boundary is complete:

- **A release is not a milestone.** A milestone is a dated checkpoint *within one project*, ordered on that project's roadmap and filled with `set_issue_milestone`. A release is *team-scoped* and crosses projects. An issue can have one milestone and belong to several releases at once.
- **A release is not a tag.** Semantic versioning, tagging and changelog discipline are the `git-workflow-and-versioning` skill's, and Flowly enforces none of it — see the `version` field below.

## When to Use

- Finished work needs grouping into the thing that goes out together
- An issue has to be added to, or taken out of, a bundle that already exists
- Someone asks which release a given issue is in, or what is still open in a release
- A release has gone out, or has been abandoned, and its status has to say so
- A roadmap view needs the dated bundles to be accurate

**When NOT to use** — deciding *whether* to deploy, preparing the deploy, or handling one that went wrong. That is the `shipping-and-launch` skill, and reaching for this one instead produces a tidy record of an unshipped release.

## The Tools

| tool | does |
|---|---|
| `create_release(name, description, version, target_date)` | creates the bundle; status starts at `planned` |
| `add_issue_to_release(release_id, identifier)` | puts one issue in; returns the release with rollups updated |
| `remove_issue_from_release(release_id, identifier)` | takes one issue out; unlinks only |
| `update_release(release_id, name, description, status, version, target_date)` | changes any field, including the status |
| `list_releases(status, issue)` | lists releases newest first, with their rollups |

Supporting reads — `list_issues(release=<uuid>)` for a release's member issues, `get_issue` for one of them, `add_comment` for anything the fields cannot carry.

**There is no delete tool**, for a release or for anything else in Flowly. A release that will not happen ends at `canceled`.

## The Fields

| field | rule |
|---|---|
| `name` | required, and **unique within the team**. A second release with the same name is refused. |
| `description` | markdown, free text |
| `version` | free text, optional, **and not unique** |
| `target_date` | `YYYY-MM-DD`, optional |
| `status` | `planned`, `in_progress`, `released`, `canceled` — starts at `planned` |

**`version` is free text and Flowly enforces no versioning policy.** It is not validated, not parsed, and not required to be unique — two releases may both carry `1.0.0` and neither call will complain. Do not assume the product is checking semantic versioning on your behalf; it is not, and an agent that assumes it is will happily create a duplicate. That discipline is the `git-workflow-and-versioning` skill's to keep, and yours to apply.

`target_date` may be left unset while the bundle is still being shaped. Undated releases are listed on the roadmap rather than hidden, so leaving it empty is an honest answer, not a gap.

Over this door, `version` and `target_date` are **set-only**: the door cannot tell an omitted argument from an explicit null, so passing null means "leave it alone" rather than "clear it". Either one is cleared from Flowly's web app.

## The Status Set

Four values, fixed, no configuration.

| status | means |
|---|---|
| `planned` | the bundle exists and is being shaped — the starting value |
| `in_progress` | the work in it is being done |
| `released` | it went out. **Recorded after the fact, by a person or an agent who knows it went out.** |
| `canceled` | it will not happen — the terminal off-ramp |

**A release is never deleted, it is canceled.** Cancelling keeps the row, its membership and its history, which is what makes "why did that not ship?" answerable later. Nothing in Flowly deletes a release, and nothing deletes an issue either.

`update_release(release_id, status=…)` is the only way any of these move. No status is set as a side effect of anything else — closing every member issue does not move a release to `released`.

## Membership

`add_issue_to_release` and `remove_issue_from_release` both take a `FLO-` identifier (either case, or the bare number) and both are **idempotent**: adding an issue that is already a member succeeds and changes nothing; removing one that is not a member succeeds and changes nothing. Neither call needs a read first, and neither errors on a repeat.

**An issue may belong to several releases at once.** Adding one membership disturbs none of the others, and removing one leaves the rest intact. So "which release is this in?" is the wrong shape of question — `list_releases(issue="FLO-77")` is the reverse lookup and it returns a list.

Removal **unlinks only**. The issue itself is untouched, keeps its status, and stays in every other release it belongs to.

Each release carries rollups over its members — `project_count`, `total_count` and `done_count`. They are a reading of what the member issues say, not a claim the release makes about itself, so a release whose rollup shows open issues has open issues whatever its status says. The rollups come back on `list_releases` and on both membership calls.

Listings cap at 250 results and truncation is silent, so a release with more members than that returns a full-looking page and no error. A membership count at the cap is a number to check rather than to trust: `list_issues` takes `offset`, so ask for the next page and keep going until a short one comes back. That is the only end-of-list signal there is.

## Process

### 1. Decide what the bundle is

A release answers "what went out together". If the answer is "everything that happened to be done that week", the bundle carries no information. Name the thing that shipped, and let the membership follow from it.

### 2. Create it

`create_release(name=…)`. The name has to be unique in the team, so read `list_releases` first if you are guessing — a collision is refused and re-running with a suffix produces a name nobody chose. Set `version` and `target_date` if they are known; leaving them unset is fine and better than inventing them.

### 3. Add the issues

`add_issue_to_release` per issue. Add the issue that carries the work, not every issue anyone touched — the bundle is read later by someone asking what changed.

### 4. Ship, elsewhere

The deploy itself, its gates and its rollback plan are the `shipping-and-launch` skill's. Nothing in this file causes anything to reach a user.

### 5. Record the outcome

Once it is actually out, `update_release(release_id, status="released")`. If it is abandoned, `update_release(release_id, status="canceled")` and say why in the description or in a comment on the issues — a canceled release with no reason is a row that raises a question and answers none.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I created the release, so the work is shipped" | Creating a release deploys nothing, merges nothing and notifies nobody. It records what a set of issues amounts to. |
| "Setting the status to `released` releases it" | It records that a release happened. The deploy is a separate act, and it happens first. |
| "This is the ship skill, so it covers the pre-launch checks" | It does not. The checklist, the flag, the rollout and the rollback plan are the `shipping-and-launch` skill's, and they run before any of this. |
| "I need a rollback plan — this skill is called ship, so it is here" | Wrong skill with the right name. Route to `shipping-and-launch` and come back to record what went out. |
| "Flowly will reject the version if it isn't valid semver" | `version` is free text, unvalidated and not unique. The product enforces no versioning policy at all. |
| "Two releases can't have the same version" | They can. Only `name` is unique, and only within the team. |
| "I'll delete the release that got cancelled" | There is no delete tool. Cancel it — the row is how the decision stays answerable. |
| "This issue is already in another release, so I can't add it here" | An issue may be in several releases at once, and a new membership displaces none. |
| "Adding it twice will error, so let me check first" | Both membership calls are idempotent. The check costs a round trip and buys nothing. |
| "Removing it from the release will delete the issue" | Removal unlinks only. Nothing in Flowly deletes an issue. |
| "Every member issue is done, so the release is released" | Nothing moves a release's status but `update_release`. The rollup is a reading, not a trigger. |
| "The release listing came back complete" | Lists cap at 250 and truncate silently. Near the cap, verify the count instead of trusting it. |
| "A milestone and a release are the same thing" | A milestone is a dated checkpoint inside one project. A release is team-scoped and crosses projects. |

## Red Flags

- A release created and treated as the deploy
- `released` set before the thing actually went out
- A pre-launch question — readiness, rollback, monitoring, staged rollout — answered from this skill
- A version invented to look like semver, or assumed to have been validated
- A duplicate `version` treated as impossible, or a duplicate `name` retried with a random suffix
- An attempt to delete a release, or a search for a delete tool
- An issue removed from a release in order to "remove" the issue
- A release whose membership is everything closed in a date range
- A rollup read as a trigger rather than as a reading of the member issues
- A member listing sitting exactly on 250 results and accepted as complete
- `version` or `target_date` passed as null in the hope of clearing it
- A milestone used where a release was meant, or the reverse

## Verification

Before the release goes out:

- [ ] `list_releases` was checked and the `name` is not already taken in this team
- [ ] `version`, if set, was chosen deliberately — nothing validated it
- [ ] `target_date` is either a real date or deliberately unset
- [ ] Every issue that belongs in the bundle is a member, checked with `list_issues(release=<uuid>)`
- [ ] The member count is not sitting on the 250 cap
- [ ] The readiness work was done under the `shipping-and-launch` skill, not here

After it goes out:

- [ ] The deploy actually happened before `update_release(release_id, status="released")` was called
- [ ] A release that will not happen is `canceled`, with the reason written down — not deleted, and not left at `planned`
- [ ] Member issues carry their own true status; the release status did not set it and does not stand in for it

## See Also

The `shipping-and-launch` skill — the pre-launch checklist, feature flags, staged rollout, monitoring and rollback. Run it before this one; it decides whether to ship, and this one records what shipped.

The `git-workflow-and-versioning` skill — tags, semantic versioning and changelogs, none of which Flowly enforces. The `flowly-review` skill — the run-level gate each piece of work passes before it is a candidate for a bundle.
