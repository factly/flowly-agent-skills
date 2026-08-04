# Flowly's planning docs, the gate, and conversion

Companion to the `flowly-plan` skill. Read it when you need to know what belongs in a doc, what the review gate does next, or what conversion carries into the child issues. The skill itself is the workflow; this is the detail behind it.

## The four docs

An issue has exactly four planning docs. The kind is a closed set — `research`, `plan`, `todo`, `risks` — and `list_planning_docs` returns them in that order, which is the order they are meant to be written and read in. There is no fifth kind and no way to add one.

Each doc is whole. `put_planning_doc` replaces the entire content of a kind; there is no append and no patch. To revise, read the current content with `list_planning_docs`, edit it, and write the whole doc back.

### research

What you actually read, and what you found. This is the doc that stops the plan from being fiction.

Worth writing down — the files and behaviours you inspected and what they do today, the constraints the existing code imposes, the prior art elsewhere in the codebase, and the questions you could not answer. An unknown recorded here is honest; an unknown quietly resolved by assumption is how a plan goes wrong three tasks in.

Keep the distinction sharp between what you observed and what you concluded. Observations belong here; conclusions belong in the plan.

### plan

The approach, and why it is this approach. This is the only doc with room for long-form prose, so anything that will not fit on a single task field belongs here.

Worth writing down — the shape of the change, the decisions you made and the options you rejected, the sequencing logic behind the task order, anything a reviewer needs in order to disagree with you productively, and any open question you want the human to settle at the gate rather than during implementation.

A reviewer approving the plan is approving this doc. If a decision is not written here, it was not approved; it was just not noticed.

### todo

The ordered task list. Write it with `put_todo_tasks`, never by hand.

You send task objects; the server renders the document and hands the rendered result back. That division is the point. The rendering is the server's business and changes on its schedule, while the task objects are a published schema you can read. Anything you hand-write against the rendered shape is a copy of a format you do not own.

The tool validates as it writes. What it refuses is what would have failed conversion later — so a refusal here is strictly cheaper than the same problem discovered after a human approved the plan.

### risks

What could go wrong, how you would notice, and what reduces it.

Worth writing down — the parts of the change with the least test coverage, the assumptions the plan rests on that have not been verified, the operations that are hard to undo, and anything that would make you want a checkpoint with a human mid-implementation.

This is the doc most often skipped and the one that most often blocks submission, because submission requires all four kinds to exist. Thin is allowed. Absent is not. If the honest answer is that the change is low-risk, write the two lines that say so and say why.

## The gate

The review state lives on the issue and takes five values.

```
 none ──── first planning doc written ────► planning
                                               │
                                    submit_for_review
                                               │
                                               ▼
                    ┌───────────────────► in_review ───── human approves ────► approved
                    │                          │                                  │
           submit_for_review          human requests changes           convert_todo_to_issues
                    │                          │                                  │
                    └──── changes_requested ◄──┘                                  ▼
                                                                            child issues
```

| state | means | who moves it, and how |
|---|---|---|
| `none` | nothing has been planned | the agent, implicitly, by writing the first planning doc |
| `planning` | docs are being written | the agent, by calling `submit_for_review` |
| `in_review` | handed to a human | the human, in Flowly's web app |
| `changes_requested` | the human wants something different | the agent, by revising and calling `submit_for_review` again |
| `approved` | the plan stands | nobody — this is a terminal state, and only conversion follows it |

Three properties of this gate are worth stating plainly.

The move out of `none` is automatic. Writing any planning doc does it. There is no call that sets the state directly and none is needed.

`submit_for_review` refuses unless all four kinds exist. That refusal is a checklist, not an error — it is telling you which doc you still owe.

`approved` is human-only. No tool an agent can call reaches it, from either the `in_review` or the `changes_requested` state. An agent that believes its plan is obviously correct still submits and waits. This is the whole reason the gate exists.

## After changes are requested

`get_review` returns the review state together with the full comment thread, oldest first. The thread is the review; read all of it, not just the newest entry, because a reviewer's second comment often qualifies the first.

The revision loop:

1. `get_review` for the state and the thread.
2. `list_planning_docs` for the current content of every doc, so you revise what is actually there rather than what you remember writing.
3. Rewrite whichever docs the feedback touches. Feedback about approach usually lands in `plan`; feedback about scope, ordering or task size lands in the task list.
4. For the task list, call `put_todo_tasks` again with the corrected array. It replaces the list. Renumber so the `num` values stay contiguous from 1 and in order, and fix every `depends_on` that referred to a task you removed or reordered.
5. `add_comment` to say what you changed and why, especially where you did something other than what was asked. A reviewer who has to diff two documents to find your response will approve more slowly and less carefully.
6. `submit_for_review` again.

The loop has no limit. Going around it twice costs far less than converting a plan nobody understood.

## Conversion

`convert_todo_to_issues` turns the approved task list into child issues. Four things about it decide how you write the tasks.

**It requires the approved state.** Called earlier, it refuses.

**It reads the doc at call time, not at approval time.** Whatever the todo doc says at the moment of the call is what becomes child issues. Editing the list after approval silently changes what gets created, and nobody re-reviews it. Land every edit before submitting.

**It runs exactly once.** It refuses when the issue already has children. There is no re-run to pick up a fix and no partial conversion — the list you convert is the list you get. This is why the validation in `put_todo_tasks` matters so much: it is the last cheap place to be wrong.

**It orders the children by the dependency graph but does not transfer the graph.** The child issues come out in an order consistent with `depends_on`, so ascending child issue number is a valid execution order. The dependency itself does not appear on the child. An implementer reading one child issue sees no indication that another must land first.

That last property is why every dependency is stated twice — once in `depends_on` for the ordering, and once in the dependent task's `description` in prose, naming the other task **by its title**. Numbers are positions in a list that no longer exists once the children do; a description pointing at "task 1" points at nothing. Titles survive, because the title becomes the child issue's title.

## Identifiers

Every tool takes the same `identifier` argument, and it accepts three forms of the same issue — the prefixed form in upper case, the prefixed form in lower case, and the bare number with no prefix. Pick whichever the human used and stay consistent within a session; there is no behavioural difference.

## When docs already exist

Finding docs already present means one of three things, and they need different responses.

| what you find | what it means | what to do |
|---|---|---|
| some kinds present, state is `planning` | an earlier session stopped partway | read what is there, keep what still holds, write the missing kinds |
| all four present, state is `in_review` | a plan is already with a human | do not rewrite it — `get_review` and wait, or ask |
| all four present, state is `changes_requested` | a human sent it back | run the revision loop above |

In every case, read before writing. A write replaces a whole doc, and the fastest way to destroy a reviewer's context is to overwrite the document they were commenting on.
