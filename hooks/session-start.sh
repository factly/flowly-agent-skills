#!/bin/bash
# agent-skills session start hook
# Injects the flowly-catalog skill into every new session
#
# Every output path must emit the SessionStart envelope
#   {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "..."}}
# quoted from https://code.claude.com/docs/en/hooks#sessionstart
#
# Claude Code reads stdout as JSON whenever its first non-whitespace character
# is `{`, and injects nothing but additionalContext. A well-formed object
# carrying any other key is therefore parsed and then discarded in silence -
# no error, no non-zero exit, nothing logged back here. Changing these keys
# does not break loudly; it stops working.
#
# Runtime dependency: bash (3.2 or newer) and nothing else. The JSON payload is
# built with shell builtins only - no jq, no node, no coreutils - so the hook
# works on a machine with an empty PATH. hooks/session-start-test.sh runs it
# that way to keep it honest.

# `${0%/*}` instead of `dirname`, and `cd` + `$PWD` instead of `pwd`: both are
# builtins, so the path resolves with nothing on PATH. The `cd` runs in a
# command substitution, so it cannot change this script's own directory.
script_dir=${0%/*}
[ "$script_dir" = "$0" ] && script_dir=.
script_dir=$(cd "$script_dir" && printf '%s' "$PWD")

SKILLS_DIR="${script_dir%/*}/skills"
META_SKILL="$SKILLS_DIR/flowly-catalog/SKILL.md"

PREFACE="agent-skills loaded. Use the flowly-catalog phase tree and skill index to find the right skill for your task."

# A newline, escaped for JSON: the two characters backslash and n.
NEWLINE_ESCAPE='\n'

# Escapes one newline-free chunk for use inside a JSON string literal and
# leaves the result in $json_escaped. Pure parameter expansion, so nothing is
# forked and no external tool is involved.
json_escaped=""
json_escape_chunk() {
  local s=$1

  # Backslash must come first: every rule below introduces backslashes, and
  # re-escaping those would double them.
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  s=${s//$'\b'/\\b}
  s=${s//$'\f'/\\f}

  json_escaped=$s
}

# Maps the C0 control characters that have no shorthand escape to their \u00xx
# form. None of them belongs in a markdown file, but a stray one (an ESC pasted
# from terminal output, say) would otherwise emit invalid JSON and take the
# whole session message down.
#
# This runs once over the assembled payload rather than per line, because it is
# 26 passes and every one of them normally matches nothing. Two code points are
# deliberately absent: U+0000, which `read` cannot deliver, and U+007F (DEL),
# which JSON permits unescaped.
json_escape_controls() {
  local s=$1 cp ch
  for cp in 01 02 03 04 05 06 07 0b 0e 0f 10 11 12 13 14 15 16 17 18 19 1a 1b 1c 1d 1e 1f; do
    printf -v ch "\\x$cp"
    s=${s//"$ch"/\\u00$cp}
  done
  json_escaped=$s
}

# Reads $META_SKILL and leaves the escaped preface + catalog in $json_escaped.
#
# The file is escaped a line at a time rather than in one string. Both produce
# the same bytes, but `${s//pattern/replacement}` rebuilds the whole string on
# every match, so replacing ~200 newlines in a 10KB string costs over a second
# on the bash 3.2 that ships with macOS. Per line it is a few tens of
# milliseconds, and the newline rule disappears entirely.
build_catalog_message() {
  local line="" assembled

  json_escape_chunk "$PREFACE"
  assembled="$json_escaped$NEWLINE_ESCAPE$NEWLINE_ESCAPE"

  while IFS= read -r line; do
    json_escape_chunk "$line"
    assembled="$assembled$json_escaped$NEWLINE_ESCAPE"
  done < "$META_SKILL"

  # A file whose last line has no trailing newline leaves `read` returning
  # non-zero with that line still assigned, so it is appended here - without
  # the newline the loop would have added. This is also why the file is not
  # read with `$(cat ...)`, which would silently drop a trailing newline.
  # (When the file does end in a newline, the final `read` assigns an empty
  # string, so no reset is needed inside the loop.)
  if [ -n "$line" ]; then
    json_escape_chunk "$line"
    assembled="$assembled$json_escaped"
  fi

  json_escape_controls "$assembled"
}

# `-r` as well as `-f`: a catalog that exists but cannot be read would pass the
# `-f` test and then produce a payload containing the preface and nothing else,
# injecting a claim that the catalog is loaded with no catalog behind it.
# Better to say so.
if [ -f "$META_SKILL" ] && [ -r "$META_SKILL" ]; then
  build_catalog_message
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$json_escaped"
else
  # The resolved path is deliberately not interpolated here. A directory name
  # may legally contain a newline, and json_escape_chunk is newline-free by
  # contract, so this - the branch whose whole job is to fail safely - would be
  # the one emitting invalid JSON. The expected location is fixed, so name that.
  json_escape_chunk "agent-skills: the flowly-catalog skill catalog was not found or could not be read. Expected skills/flowly-catalog/SKILL.md next to this hook's parent directory. Skills remain available individually."
  json_escape_controls "$json_escaped"
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$json_escaped"
fi
