# NOTICE

This repository is a **hard fork** of [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills),
used under the MIT licence. It is **not affiliated with, endorsed by, or published by** that project
or its author. Bugs here are ours; do not report them upstream.

The original MIT copyright is preserved verbatim in [`LICENSE`](LICENSE) alongside our own.

## Base

| | |
|---|---|
| Upstream | `https://github.com/addyosmani/agent-skills` |
| Base SHA | `bdf76c7c6b7b3b3e01bb15c9fdc42ac5351855c1` |
| Base tag | `upstream-base-bdf76c7` |
| Upstream commit date | 2026-08-03 |
| Imported | 2026-08-04 |

Upstream history is preserved: the base SHA is an ancestor of every commit on `main`. The permalink
to any inherited file at the base is
`https://github.com/addyosmani/agent-skills/blob/bdf76c7c6b7b3b3e01bb15c9fdc42ac5351855c1/<path>`.

## Syncing

```sh
git remote add upstream https://github.com/addyosmani/agent-skills   # once
git fetch upstream
git merge upstream/main
```

Merges are resolved by eye against the ownership register below. On the day of the fork
`git merge upstream/main` is a no-op — that is what makes the register's starting point reviewable.

## Removed at import

These are the doors this fork does not ship. They were deleted in the import commit rather than left
to rot, because each one is a manifest or a command set that would have to be kept in sync by hand:

| Removed | Was |
|---|---|
| `.gemini/commands/` | Gemini CLI slash commands (TOML) |
| `commands/` | Antigravity CLI slash commands (TOML) — the path is reused for this fork's own Claude Code commands |
| `.agents/plugins/marketplace.json` | Antigravity marketplace manifest |
| `.opencode/skills` | opencode symlink into `skills/` |
| `scripts/validate-commands.js`, `scripts/validate-commands-test.js` | The three-way parity checker that held the Claude, Gemini and Antigravity command directories in sync |

`.codex-plugin/plugin.json` is **kept**. The Codex door is not shipped and not tested, but it is held
openable by two authoring rules that cost nothing: no substitution token in any command body, and
skill frontmatter limited to `name` and `description`.
