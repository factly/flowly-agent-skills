# Orchestration Patterns

Reference catalog of agent orchestration patterns this repo endorses, plus anti-patterns to avoid. Read this before adding a new slash command that coordinates multiple personas, or before introducing a new persona that "wraps" existing ones.

The governing rule: **the user (or a slash command) is the orchestrator. Personas do not invoke other personas.** Skills are mandatory hops inside a persona's workflow.

---

## Endorsed patterns

### 1. Direct invocation (no orchestration)

Single persona, single perspective, single artifact. The default and the cheapest option.

```
user → code-reviewer → report → user
```

**Use when:** the work is one perspective on one artifact and you can describe it in one sentence.

**Examples:**
- "Review this PR" → `code-reviewer`
- "Find security issues in `auth.ts`" → `security-auditor`
- "What tests are missing for the checkout flow?" → `test-engineer`

**Cost:** one round trip. The baseline you should always compare orchestrated patterns against.

---

### 2. Single-persona slash command

A slash command that wraps one persona with the project's skills. Saves the user from re-explaining the workflow every time.

```
a slash command → one persona (with the relevant skill) → report
```

**Use when:** the same single-persona invocation happens repeatedly with the same setup.

**Examples in this repo: none.** This entry used to name `/flowly:review` and `/flowly:test`, and neither has ever wrapped a persona — grep the whole of `commands/` for `subagent`, `persona` or any persona name and it returns nothing. Both commands invoke *skills* and do the work in the main context, which is Pattern 1. Do not read the pattern back out of them.

Every command this distribution ships is namespaced, because they arrive inside a plugin: `commands/review.md` is typed `/flowly:review`, and the bare form resolves to nothing at all. There is no simplification command; the `code-simplification` skill is reached from `/flowly:review`, or by name.

**Cost:** same as direct invocation. The slash command is just a saved prompt.

**Anti-signal:** if the slash command's body is mostly "decide which persona to call," delete it and let the user call the persona directly.

---

### 3. Parallel fan-out with merge

Multiple personas operate on the same input concurrently, each producing an independent report. A merge step (in the main agent's context) synthesizes them into a single decision.

```
                           ┌─→ code-reviewer    ─┐
some command → fan out  ───┼─→ security-auditor ─┤→ merge → go/no-go + rollback
                           └─→ test-engineer    ─┘
```

**Use when:**
- The sub-tasks are genuinely independent (no shared mutable state, no ordering dependency)
- Each sub-agent benefits from its own context window
- The merge step is small enough to stay in the main context
- Wall-clock latency matters

**"No shared mutable state" excludes writers, and that is the whole clause.** Readers of one tree are independent of each other; two agents *editing* one tree are not, however disjoint their file lists look. See Pattern 6, which is what a fan-out of writers actually requires.

**Examples in this repo: none.** This entry used to name `/flowly:ship`, which has never fanned out — the fork's release command invokes two skills and bundles a release in the main context. The reference implementation is upstream's own pre-fork ship command, which really did spawn three personas concurrently; the fork's rewrite dropped the orchestration and the example outlived it.

**Cost:** N parallel sub-agent contexts + one merge turn. Higher than direct invocation, but faster wall-clock and produces better reports because each sub-agent stays focused on its single perspective.

**Validation checklist before adopting this pattern:**
- [ ] Can I run all sub-agents at the same time without ordering issues?
- [ ] Does each persona produce a different *kind* of finding, not just the same finding from a different angle?
- [ ] Will the merge step fit in the main agent's remaining context?
- [ ] Is the user's wait time long enough that parallelism is actually noticeable?

If any answer is "no," fall back to direct invocation or a single-persona command.

---

### 4. Sequential pipeline as user-driven slash commands

The user runs slash commands in a defined order, carrying context (or commit history) between them. There is no orchestrator agent — the user IS the orchestrator.

```
user runs:  /flowly:research  →  /flowly:plan  →  /flowly:build  →  /flowly:test  →  /flowly:review  →  /flowly:ship
```

**Use when:** the workflow has dependencies (each step needs the previous step's output) and human judgment between steps adds value.

**Examples in this repo:** the entire DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP lifecycle. Those six are the whole command set; `/flowly:research` is the DEFINE step, and each one takes a Flowly issue identifier rather than carrying context in the working tree.

**Cost:** one sub-agent context per step. Free for the orchestration layer because there is no orchestrator agent.

**Why not automate it:** an LLM "lifecycle orchestrator" would (a) lose nuance between steps because it has to summarize for hand-off, (b) skip the human checkpoints that catch wrong-direction work early, and (c) double the token cost via paraphrasing turns.

---

### 5. Research isolation (context preservation)

When a task requires reading large amounts of material that shouldn't pollute the main context, spawn a research sub-agent that returns only a digest.

```
main agent → research sub-agent (reads 50 files) → digest → main agent continues
```

**Use when:**
- The main session needs to stay focused on a downstream task
- The investigation result is much smaller than the input it consumes
- The decision quality benefits from the main agent having room to think after

**Examples:** "Find every call site of this deprecated API across the monorepo," "Summarize what these 30 ADRs say about caching."

**Cost:** one isolated sub-agent context. Worth it any time the alternative is loading hundreds of files into the main context.

**On Claude Code, use the built-in `Explore` subagent** rather than defining a custom research persona. It is purpose-built for this pattern. Define a custom research subagent only when `Explore` doesn't fit (e.g. you need a domain-specific system prompt the model wouldn't infer).

**Be precise about what `Explore` is denied**, because this entry used to overstate it. Its denylist covers the *built-in* write tools — `Edit`, `Write`, `NotebookEdit` — and not MCP tools, which are inherited from the parent session and not named. Measured 2026-08-21: it holds all 48 `mcp__flowly__*` tools, including `update_issue`, `put_planning_doc` and `convert_todo_to_issues`, and a read-only call returned the parent's own actor identity.

So `Explore` cannot edit a file and can absolutely write to your tracker. For research that is usually fine — nothing asks it to. **Do not build a design whose safety argument is that `Explore` writes nothing**, because that is not what its grant says. If a fan-out needs a helper that provably cannot write, that is a persona with a `tools` allowlist, not a built-in and a hopeful sentence.

---

### 6. Writer fan-out (one writer, isolated context)

A parent walks a queue of work items and hands each one's *implementation* to a subagent, which edits the tree and returns a digest. The parent owns the queue, every durable write and every commit.

```
parent (queue, tracker, git) → implementer #1 → digest → parent commits
                             → implementer #2 → digest → parent commits   (after #1, never beside it)
```

**This is the pattern that looks like Pattern 3 and is not.** Pattern 3's first condition is "no shared mutable state", and a writer *is* shared mutable state — the working tree. Two readers of one tree are independent of each other; two writers of one tree are not, no matter how disjoint their declared file lists look. The clause was doing real work all along; it just happened that every pattern above it was a reader.

**Use when:**
- A long serial run accumulates each item's reads, diffs and test output in one context
- The context, not the wall-clock, is what runs out
- Every item's acceptance is already decided, so the subagent decides nothing

**The invariants, and none of them is optional:**
- **One writer in flight.** Not a pacing preference — the item is the unit of status, commit and rollback, and two in flight share all three and leave none.
- **The parent makes every durable write.** Tracker writes and git commands both. `git` is tree-wide, so a subagent sharing the tree cannot scope a command to its own work.
- **The digest carries evidence, not verdicts.** The parent has delegated its own observation of the verification; the command and its output tail have to come back or the observation did not happen.
- **The parent stages what the subagent reports it touched**, not what the work item predicted.

**Enforcement is the `tools` allowlist, not the brief.** Subagents inherit the parent's MCP tools by default and plugin agents have `mcpServers` ignored, so a persona that does not narrow `tools` arrives holding every write the parent has. Omit `Agent` too — see *Platform-enforced rules*, where the guarantee that used to make that unnecessary is gone.

**Cost:** one subagent context per item, and no wall-clock gain at all. This pattern buys context and nothing else, and anyone adopting it should say so plainly rather than let "delegated" be read as "parallel".

**Concurrent writers are a different pattern and this catalog does not endorse one.** `isolation: worktree` looks like the answer and branches from the repository's default branch rather than the parent's `HEAD`, so an item depending on a sibling committed earlier in the same run sees a tree without it.

**Examples in this repo:** `flowly-build` and `flowly-batch`. `references/agent-delegation.md` is the contract both follow, and `agents/implementer.md` is the persona.

---

## Claude Code compatibility

This catalog is harness-agnostic, but most readers will run it on Claude Code. Here's how each pattern maps onto Claude Code's primitives — and where the platform enforces our rules for us.

### Where personas live

Plugin subagents go in `agents/` at the plugin root. This repo is a plugin (`.claude-plugin/plugin.json`), so `agents/code-reviewer.md`, `agents/security-auditor.md`, and `agents/test-engineer.md` are auto-discovered when the plugin is enabled. No path configuration needed.

### Subagents vs. Agent Teams

Claude Code has two parallelism primitives. Pattern 3 (parallel fan-out with merge) maps to **subagents**. If you need teammates that talk to each other, use **Agent Teams** instead.

| | Subagents | Agent Teams |
|--|-----------|-------------|
| Coordination | Main agent fans out, sub-agents only report back | Teammates message each other, share a task list |
| Context | Own context window per subagent | Own context window per teammate |
| When to use | Independent tasks producing reports | Collaborative work needing discussion |
| Status | Stable | Experimental — requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
| Cost | Lower | Higher — each teammate is a separate Claude instance |

**The personas in this repo work in both modes.** When spawned as subagents (e.g. by `/flowly:ship`), they report findings to the main session. When spawned as teammates (`Spawn a teammate using the security-auditor agent type…`), they can challenge each other's findings directly. The persona definition is the same; only the spawning context changes.

One subtlety: the `skills` and `mcpServers` frontmatter fields in a persona are honored when it runs as a subagent but **ignored when it runs as a teammate** — teammates load skills and MCP servers from your project and user settings, the same as a regular session. If a persona depends on a specific skill or MCP server being loaded, configure it at the session level so it's available in both modes.

### Platform-enforced rules

⚠️ **This section used to claim more than the platform enforces. Read the correction before relying on it.**

- **Subagents CAN now spawn subagents**, to a default depth of 3, tunable with `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`. This catalog previously quoted "Subagents cannot spawn other subagents" from the docs and built an argument on top of it: that Anti-pattern B (persona-calls-persona) and Anti-pattern D (deep persona trees) "cannot exist on Claude Code by construction" and would "just fail to load". **That guarantee is gone.** Both anti-patterns are now buildable, and nothing refuses them.

  The mitigation is per-persona and deliberate: **omit `Agent` from the persona's `tools` allowlist.** An allowlist excludes by omission, so naming the tools a persona needs is what removes the one it must not have. `agents/implementer.md` does this and says why.

- **"No nested teams"** — teammates still cannot spawn their own teams. This one holds.

So the anti-patterns below are conventions enforced by review, not by the platform, with the single exception of nested teams. A contributor who builds Anti-pattern D will find it works. That is exactly why it is worth catching in review.

This correction is the reason to distrust "the platform prevents it" as an argument anywhere in this file: the platform's guarantees are the platform's to withdraw, and this one was withdrawn without anything here going red.

### Built-in subagents to know about

Before defining a custom subagent, check whether one of these covers the role:

| Built-in | Purpose |
|----------|---------|
| `Explore` | Codebase search and analysis. Use this for Pattern 5 (research isolation). **Its description says read-only; its tool grant is not.** Measured 2026-08-21: it holds all 48 `mcp__flowly__*` tools, `update_issue` among them. Read-only is a description of intent, and a description is not an enforcement. If a fan-out needs a helper that provably cannot write, give it a persona with a `tools` allowlist. |
| `Plan` | Read-only research during plan mode. |
| `general-purpose` | Multi-step tasks needing both exploration and modification. |

Don't redefine these. Layer your specialist personas (code-reviewer, security-auditor, test-engineer) on top of them.

### Frontmatter restrictions for plugin agents

Plugin subagents do **not** support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields — these are silently ignored. If a future persona needs any of those, the user must copy the file into `.claude/agents/` or `~/.claude/agents/` instead.

The fields that DO work in plugin agents are: `name`, `description`, `tools`, `disallowedTools`, `model`, `maxTurns`, `skills`, `memory`, `background`, `effort`, `isolation`, `color`, `initialPrompt`. Use `model` per-persona if you want to optimize cost (e.g. Haiku for `test-engineer` coverage scans, Sonnet for `code-reviewer`, Opus for `security-auditor`).

### Spawning multiple subagents in parallel

In Claude Code, parallel fan-out (Pattern 3) requires issuing **multiple Agent tool calls in a single assistant turn**. Sequential turns serialize execution.

This used to add that `/flowly:ship` "calls this out explicitly". It does not, and never has — see Pattern 3. The command that did was upstream's pre-fork release command, in a form this distribution no longer ships. **No command here spawns a subagent in parallel**, so any new orchestrator that wants to is the first, and should say the single-turn rule out loud rather than inherit it from an example that is not there.

---

## Worked example: Agent Teams for competing-hypothesis debugging

This example shows when to reach for **Agent Teams** instead of `/flowly:ship`'s subagent fan-out. The two patterns look similar from a distance — both spawn the same three personas — but the value comes from a different place.

### The scenario

> *Checkout occasionally hangs for ~30 seconds before completing. It happens roughly once every 50 sessions. No errors in logs. Started after last week's release.*

Plausible root causes (mutually exclusive, all fit the symptoms):

1. A race condition in the new payment-confirmation flow
2. An auth check that occasionally falls through to a slow synchronous network call
3. A missing index on a query that scales with cart size
4. A flaky third-party API where the SDK retries silently before timing out

A single agent will pick the first plausible theory and stop investigating. A `/flowly:ship`-style subagent fan-out would have each persona report independently — but their reports never meet, so nothing rules out the wrong theories.

This is exactly the case the Agent Teams docs describe: *"With multiple independent investigators actively trying to disprove each other, the theory that survives is much more likely to be the actual root cause."*

### Why this is *not* a `/flowly:ship` job

| | `/flowly:ship` (subagents) | Agent Teams |
|--|--------------------|-------------|
| Sub-agents see | The same diff, different lenses | A shared task list, each other's messages |
| Output | Three independent reports → one merge | Adversarial debate → consensus root cause |
| Right when | You want a verdict on a known artifact | You want to *find* the artifact among hypotheses |

`/flowly:ship` is a verdict; Agent Teams is an investigation.

### Setup (one-time, per-environment)

Agent Teams is experimental. In `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Requires Claude Code v2.1.32 or later. The personas in this repo are picked up automatically — no team-config files to author by hand.

### The trigger prompt

Type into the lead session, in natural language:

```
Users report checkout hangs for ~30 seconds intermittently after last
week's release. No errors in logs.

Create an agent team to debug this with competing hypotheses. Spawn
three teammates using the existing agent types:

  - code-reviewer  — investigate race conditions and blocking calls
                     in the checkout code path
  - security-auditor — investigate auth checks, session handling,
                       and any synchronous network calls added recently
  - test-engineer  — propose tests that would distinguish between the
                     hypotheses and check coverage gaps in checkout

Have them message each other directly to challenge each other's
theories. Update findings as consensus emerges. Only converge when
two teammates agree they can disprove the others'.
```

The lead spawns three teammates referencing the existing persona names. The persona body is **appended** to each teammate's system prompt as additional instructions (on top of the team-coordination instructions the lead installs); the trigger prompt above becomes their task.

### What happens

1. Each teammate runs in its own context window, exploring the codebase from its own lens.
2. Teammates use `message` to send findings to each other directly. The lead doesn't have to relay.
3. The shared task list shows who's investigating what — visible at any time with `Ctrl+T` (in-process mode) or in a tmux pane (split mode).
4. When `code-reviewer` finds a `Promise.all` that should be sequential, it messages `security-auditor` to confirm the auth call isn't part of the race. `security-auditor` checks and replies — either confirming the race is the real issue or producing counter-evidence.
5. `test-engineer` proposes a focused integration test for whichever theory is winning, which the team uses to verify before declaring consensus.
6. The lead synthesizes the converged finding and presents it to you.

You can interrupt at any teammate by cycling with `Shift+Down` and typing — useful for redirecting an investigator who's gone down a wrong path.

### When to clean up

When the investigation lands on a root cause, tell the lead:

```
Clean up the team
```

Always cleanup through the lead, not a teammate (per the docs: teammates lack full team context for cleanup).

### Cost expectation

Three Sonnet teammates running for ~10–15 minutes of investigation costs noticeably more than the same three personas spawned as subagents by `/flowly:ship`. The justification is *quality of conclusion* — for production debugging where the wrong fix is expensive, the extra tokens are a bargain. For a routine PR review, stick with `/flowly:ship`.

### Anti-pattern in this scenario

Do **not** rebuild this as a seventh slash command that fans out subagents. Subagents can't message each other — you'd lose the adversarial debate that makes the pattern work. If a workflow keeps coming up, document the trigger prompt above as a snippet rather than wrapping it in a slash command that misuses subagents.

### When *not* to use Agent Teams

- Production-bound verdict on a known diff → use `/flowly:ship` (subagents).
- One specialist perspective on one artifact → direct persona invocation.
- Sequential lifecycle (spec → plan → build) → user-driven slash commands (Pattern 4).
- Read-heavy research with a small digest → built-in `Explore` subagent.

Reach for Agent Teams only when teammates **need** to challenge each other to produce the right answer.

---

## Anti-patterns

### A. Router persona ("meta-orchestrator")

A persona whose job is to decide which other persona to call.

```
one catch-all command → router-persona → "this needs a review" → code-reviewer → router (paraphrases) → user
```

**Why it fails:**
- Pure routing layer with no domain value
- Adds two paraphrasing hops → information loss + roughly 2× token cost
- The user already knew they wanted a review; they could have called `/flowly:review` directly
- Replicates the work that slash commands and intent mapping in `AGENTS.md` already do

**What to do instead:** add or refine slash commands. Document intent → command mapping in `AGENTS.md`.

---

### B. Persona that calls another persona

A `code-reviewer` that internally invokes `security-auditor` when it sees auth code.

**Why it fails:**
- Personas were designed to produce a single perspective; chaining them defeats that
- The summary the calling persona passes loses context the called persona needs
- Failure modes multiply (which persona's output format wins? whose rules apply?)
- Hides cost from the user

**What to do instead:** have the calling persona *recommend* a follow-up audit in its report. The user or a slash command runs the second pass.

---

### C. Sequential orchestrator that paraphrases

An agent that calls `/flowly:research`, then `/flowly:plan`, then `/flowly:build`, etc. on the user's behalf.

**Why it fails:**
- Loses the human checkpoints that catch wrong-direction work
- Each hand-off summarizes context — accumulated drift over a long pipeline
- Doubles token cost: orchestrator turn + sub-agent turn for every step
- Removes user agency at exactly the points where judgment matters most

**What to do instead:** keep the user as the orchestrator. Document the recommended sequence in `README.md` and let users invoke it.

---

### D. Deep persona trees

`/flowly:ship` calls a `pre-ship-coordinator` that calls a `quality-coordinator` that calls `code-reviewer`.

**Why it fails:**
- Each layer adds latency and tokens with no decision value
- Debugging becomes a multi-level investigation
- The leaf personas lose context to multiple summarization steps

**What to do instead:** keep the orchestration depth at most 1 (slash command → personas). The merge happens in the main agent.

---

## Decision flow

When considering a new orchestrated workflow, walk this flow:

```
Is the work one perspective on one artifact?
├── Yes → Direct invocation. Stop.
└── No  → Will the same composition repeat?
         ├── No  → Direct invocation, ad hoc. Stop.
         └── Yes → Are sub-tasks independent?
                  ├── No  → Sequential slash commands run by user (Pattern 4).
                  └── Yes → Parallel fan-out with merge (Pattern 3).
                           Validate against the checklist above.
                           If any check fails → fall back to single-persona command (Pattern 2).
```

---

## When to add a new pattern to this catalog

Add a new entry only after:

1. You've used the pattern at least twice in real work
2. You can name a concrete artifact in this repo that demonstrates it
3. You can explain why an existing pattern wouldn't have worked
4. You can describe its anti-pattern shadow (what people will mistakenly build instead)

Premature catalog entries become aspirational documentation that no one follows.
