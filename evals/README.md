# Skill Evals

How this repo measures whether its skills actually work: that they **trigger** when they should, **stay distinct** from each other, and **change agent behavior** the way each skill promises.

## Prior art (and what we adopted)

There is no single settled community standard for evaluating `SKILL.md` skills, but two approaches lead:

- **Anthropic's skill-creator v2** defines a per-skill `evals.json` (prompt + `expectations[]`, graded from the transcript) plus trigger-accuracy testing of descriptions against sample prompts. We adopt its [`evals.json` schema](https://github.com/anthropics/skills/tree/main/skills/skill-creator) for our behavioral tier and add one optional `kind` field to select the artifact being graded.
- **Superpowers** (obra) tests skills with bash + `claude -p` + prompt fixtures and grader scripts. Our behavioral runner follows the same headless-`claude` pattern, with the grading rubric drawn from `expectations[]`.

What neither provides is a **deterministic, CI-safe** check for a multi-skill *catalog* — does each skill's description carry the vocabulary users actually say, and do two skills' descriptions collide? That's Tier 2 below, and it's this repo's addition.

## The three tiers

| Tier | What it checks | Runs | Cost |
|---|---|---|---|
| 1. Structural | Frontmatter, naming, required sections | CI (`validate-skills.js`) | Free |
| 2. Trigger & routing | Positive prompts rank their skill top-k; negative prompts don't; no two descriptions near-collide | CI (`run-evals.js`) | Free |
| 3. Behavioral | An agent following the skill satisfies its `expectations[]` | On demand (`run-evals.js --behavioral`) | Tokens |
| 3. Round-trip | An agent holding this corpus drives Flowly instead of writing a local file | On demand (`claude plugin eval`) | Tokens + a live instance |

Tier 2 is a **lexical approximation** of routing (stemmed TF-IDF over descriptions). It cannot judge semantics — that's Tier 3's job — but it catches the two failure modes that dominate real trigger bugs: a description missing the vocabulary users say (false negative), and an over-broad description that outranks the right skill (false positive). A Tier-2 failure usually means *fix the description*, not the eval.

Tier 3 has two shapes, and they measure different things. The behavioral evals grade **one skill** against its own `expectations[]`, with an LLM reading the trace. The round-trip case grades **the distribution** against its product claim, mostly with mechanical graders — tool calls counted, created files matched — so its verdict does not depend on a judge's reading. Neither replaces the other, and neither runs in CI.

## Running

```bash
# Tier 2 — deterministic, runs in CI
node scripts/run-evals.js
node scripts/run-evals.js --min-rank1 80  # enforce the current routing floor

# Tier 3 — behavioral, runs each eval through headless claude, then grades it
node scripts/run-evals.js --behavioral test-driven-development            # spends tokens
node scripts/run-evals.js --behavioral test-driven-development --dry-run  # prints the plan only
```

Tier 3 supports two behavioral artifact kinds. `execution` is the default: each eval runs in a throwaway git repository, real project inputs from `files[]` are materialized out of `evals/fixtures/` and committed as the baseline, and the grader judges the full `--output-format stream-json --verbose` execution trace, including tool calls. `dialogue` is reserved for skills whose deliverable is the conversation itself; it needs no fixture, and the grader judges the assistant's conversational turns without requiring file edits or commands. Claiming `dialogue` is a human-reviewed exemption, not a general escape hatch for execution skills.

The executor runs with an explicit permission mode (`--permission-mode acceptEdits` plus a pre-approved tool list) so execution evals can genuinely edit files, run commands, inspect diffs, and make commits rather than being denied and narrating instead. Traces are fenced as untrusted data in the grader prompt and piped to the grader over stdin (they can be megabytes; argv would hit the OS argument-size limit), executor and grader calls carry timeouts, and grader output is validated as JSON before being written to `evals/results/` (gitignored) in skill-creator's `grading.json` shape. Discipline skills also include pressure cases for time pressure, sunk cost, and authority pressure; these verify that the workflow still holds when the prompt argues for skipping it.

## The round-trip case

`evals/flowly-round-trip/case.yaml` is the only thing here that measures the reason this fork exists. Everything else reads text off disk: `check-binding.js` proves no shipped byte still points at a destination this distribution does not have, and Tier 2 proves a description carries the vocabulary that routes to it. Neither can tell you whether a model, handed the plan command and the skills it names, writes four planning docs to a Flowly issue instead of a file to the working tree.

It is read by **`claude plugin eval`**, Claude Code's own plugin eval runner — not by anything in `scripts/`. That is why it is YAML while every Tier-2 case is JSON: `evals/**/case.yaml` is the runner's convention, and its parser is the CLI's. This repository has no dependencies and Node ships no YAML parser, so writing one here to read a file we do not parse would be a liability with no reader.

```bash
claude plugin eval . --scaffold --ablation with-without \
  --allow-tools Write Edit Bash 'mcp__flowly__*'
```

**It has never been executed.** `plugin eval` is in early access (`plugin eval` is currently in early access on claude 2.1.220), so the case is authored against the runner's schema and validated statically, but no run of it has ever been observed. Treat its first green as unverified until someone has watched it.

**What it asserts.** Two halves, because the claim has two halves.

- *The artifacts reached the issue.* `tool_used` graders count the calls the plan phase actually makes. The arithmetic matters and is the likeliest way a case like this is quietly wrong: the phase writes **three** of the four kinds and reads the fourth. `research` is seeded by the scaffold and is the command's input; `plan` and `risks` go through `put_planning_doc`; `todo` goes through `put_todo_tasks`, a different tool. So `put_planning_doc` is asserted at `min: 2`, not `min: 4` — `min: 4` would fail a correct run. One `llm` grader reads the `list_planning_docs` result back out of the trace, because the acceptance is about four docs *existing*, which is a statement about the issue rather than about the calls.
- *Nothing planning-shaped reached the working tree.* `file_exists` and `target: files` both read the list of files **created during the run**, so anything the scaffold wrote grades as absent and only the agent's own output is under test. The load-bearing grader is a case-insensitive regex over the whole planning vocabulary, matched anywhere in a created path — a whitelist of filenames would only refuse the destinations someone already thought of, and the destination a drifting agent invents is by definition not on that list. The `file_exists` globs beside it are named sensors so a failure reads as "it wrote a spec" rather than "the net matched something".

**Why the executor may write files.** `Write`, `Edit` and `Bash` are in the case's `allowed_tools` deliberately. An agent that cannot write a file cannot write a local plan, so every absence grader would pass regardless of what the corpus said. The absence has to be reachable or it is not being tested — `check-round-trip-case.js` asserts those tools are still granted for exactly that reason.

**The ablation is the claim.** `--ablation with-without` runs a second arm with the plugin removed and reports the delta. Both arms get the same Flowly door — the scaffold writes `.mcp.json` into the sandbox rather than letting the plugin carry it — so the ablation varies exactly one thing: the corpus. The absence graders carry `arm: both` because they are the delta; they should pass with the plugin and fail without it.

**Side effects are real and permanent.** Each run creates an issue on a live instance and moves its plan gate to `in_review`. Flowly has no delete tool for an issue, so every run leaves one behind — which is why the case pins `runs: 1` against a default of 3, and why `--ablation with-without` doubles that. The endpoint and token come from `FLOWLY_MCP_URL` and `FLOWLY_MCP_TOKEN` in your environment and are never committed.

**What holds it honest.** `node scripts/check-round-trip-case.js` — it parses the file, checks it against the runner's schema, verifies every `mcp__flowly__*` tool it names exists in `scripts/tool-snapshot.json`, and verifies that the sentence it quotes from `commands/plan.md` is still there, on one line. That last check is what makes the case's central dependency visible: delete the refusal from the plan command and the check goes red. So does `check-commands.js`, which holds the same block byte-identical across all six commands — a deletion turns two gates red, not one.

The quotation has to sit on a single source line, because the grader matches the trace literally and the trace carries the command body with its hard wraps intact. The first draft of that grader quoted the tail of the sentence, which crosses a wrap: it read correctly, and could never have matched. The checker caught it, and there is a test that keeps catching it.

The schema half of that check needs a YAML parser, and this repository has none — it shells out to `ruby -ryaml`, which ships on macOS and on the standard CI images. Without ruby it reports the parse as **skipped**, not passed; the tool-name and quotation checks are plain text and always run.

## Eval case format

One file per skill: `evals/cases/<skill-name>.json`.

```json
{
  "skill_name": "test-driven-development",
  "trigger": {
    "positive": [
      { "prompt": "Write a failing test for this bug before fixing it", "top_k": 3 }
    ],
    "negative": [
      { "prompt": "Update the architecture diagram in the docs", "owner": "documentation-and-adrs" }
    ]
  },
  "evals": [
    {
      "id": 1,
      "kind": "execution",
      "prompt": "Fix the reported rounding bug in the invoice totals, test-first.",
      "expected_output": "A failing test demonstrating the bug, a minimal fix turning it green, full suite passing",
      "files": [
        "test-driven-development"
      ],
      "expectations": [
        "A failing test is written and shown failing before the fix",
        "The implementation is the minimum needed to pass",
        "The full suite is run after the fix to catch regressions"
      ]
    }
  ]
}
```

- `evals[]` uses skill-creator's core schema (`id`, `prompt`, `expected_output`, optional `files[]`, `expectations[]`) plus this repository's optional `kind`. `kind` must be `execution` or `dialogue` and defaults to `execution` for compatibility. Execution evals require non-empty `files[]`; paths are relative to `evals/fixtures/` and may name a file or project directory. Dialogue evals may omit `files[]` because the transcript is the artifact. Expectations are verifiable statements a grader checks against the relevant artifact — behaviors, not phrasings.
- `trigger` is this repo's extension. `positive` prompts are realistic user asks that should route here (`top_k` defaults to 3; tighten to 1 for a skill's signature ask). `negative` prompts belong to a *different* skill; this skill must not rank first for them. Declare that skill in `owner` where you can: the runner then asserts the owner **outranks** this skill, turning the negative into a real pairwise routing test instead of one that can pass vacuously when the prompt matches nothing.

**Writing good trigger prompts:** paraphrase how users actually talk; don't copy the description (that's gaming the eval). If a realistic prompt can't rank because the description lacks its vocabulary, that is a real finding — improve the description.

## Adding a skill

Every skill ships with an eval file. When you add `skills/<name>/`, add `evals/cases/<name>.json` with at least 3 positive triggers, 2 negative triggers, and 1 behavioral eval. Execution evals must be backed by `evals/fixtures/<name>/`; use `kind: "dialogue"` only when the skill's deliverable is genuinely the conversation itself. Missing case files, incomplete case counts, unknown kinds, invalid fixture paths, and absent required fixtures are CI errors.

The round-trip case adds nothing to this list. It is one suite-level case about the plan phase, not a per-skill obligation, and a new skill does not need a second case file over there.

What a new skill *does* owe the rest of the catalog is a re-read of the aggregate. Ranking is zero-sum — one skill's description competes with every other's for the same prompts — so run the whole suite after adding or renaming one and read the rank-1 number, not just your own skill's row.

## Metrics to watch

The Tier-2 run prints a **trigger rank-1 rate** (share of positive prompts that rank their skill first, not merely top-k). CI runs with `--min-rank1 80`. That number is the fact; the day's measured rate is not, and a baseline written into this paragraph would be wrong again inside a week — it has already been 86%, 84% and 85%. Read the rate off the run, not off this file. Raise the floor as routing improves; never lower it to make a regression pass.

**The floor is not the sensitive gate, and it is worth knowing which one is.** Lowering a single skill's description to a generic phrase does turn the suite red — but through the per-prompt top-k checks, not through the ratchet. Measured against the current catalog: lowering one description moved the rate 85% → 83% and produced 3 errors; three descriptions moved it to 81% with 8 errors; it took **six** before the rate fell to 79% and breached the floor at all. The arithmetic is why — 105 positive prompts across 33 skills means one skill's three prompts can move the aggregate by at most ~3 points, and lowering a skill also frees rank-1 for its competitors, so the rate is far stickier than it looks. The ratchet catches a broad slide across the catalog. The thing that catches *your* description is the case file's own positive prompts, which is another reason not to write them by copying the description.

Falling numbers mean descriptions are drifting toward each other. The collision check errors at ≥75% pairwise description similarity and warns at ≥50%. Known description-vocabulary gaps surfaced by these evals are inherited from upstream, where they are tracked as [upstream issue #351](https://github.com/addyosmani/agent-skills/issues/351).
