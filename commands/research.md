---
description: Research a Flowly issue and write its research planning doc through Flowly's MCP tools
argument-hint: FLO-1234 (issue identifier)
---

Investigate one Flowly issue and record what you find as that issue's `research` planning doc.

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

## Gather context

- `get_issue` — title, description, state, project, parent, children.
- `list_comments` — a constraint stated in the discussion outranks your assumption.
- `get_project_assets(project_id)` — the project's agentic assets: the standing context Flowly keeps
  about conventions, stack and boundaries. Read them before you read code.
- `list_planning_docs` — if a `research` doc already exists you are revising it, not starting over.

## Investigate

Invoke the flowly:interview-me skill when the ask is underspecified, and the flowly:idea-refine skill
when the idea needs stress-testing before it hardens into a plan. The flowly:flowly-define skill
carries the Define phase workflow.

Then read the code. Ground every claim in a file you actually opened, and keep what you verified
separate from what you inferred.

## Write the research doc

`put_planning_doc(identifier, "research", content)` — covering what the issue is really asking for,
what exists today, the constraints that bound it, the open questions that need a human, and the
options with their trade-offs. Do not choose between the options here; that is the plan command's job.

Nothing is written to the local filesystem — no `research.md`, no scratch file, no `tasks/`
directory. The planning doc on the issue is the artifact.
