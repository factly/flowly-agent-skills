#!/usr/bin/env bash
#
# validate-standard.sh — assert every skill conforms to the Agent Skills open
# standard AND to this distribution's stricter two-field frontmatter rule.
#
# WHY THIS EXISTS
# ---------------
# This distribution keeps the flat-install door openable:
#
#     npx skills add <owner>/<repo>
#
# That door is not shipped and not tested here, but it stays openable only if
# skill frontmatter remains valid under the open standard. The standard closes
# its frontmatter field set, so a vendor-specific key makes a skill invalid
# there even while it works fine in one vendor's agent.
#
# Spec (authoritative, check the rules below against it):
#     https://agentskills.io/specification
#
# THE TWO-FIELD RULE IS STRICTER THAN THE SPEC — DELIBERATELY
# -----------------------------------------------------------
# The spec permits six frontmatter fields: name and description (required),
# plus license, compatibility, metadata and allowed-tools (optional).
# We allow exactly two: `name` and `description`.
#
# Two fields is the intersection that loads on every door. The optional four
# buy us nothing here and each one is a portability liability: `allowed-tools`
# is marked Experimental by the spec itself ("support for this field may vary
# between agent implementations"), and `metadata` is an open map whose
# consumers are all vendor-specific. Holding the intersection from the first
# commit is cheaper than discovering at flat-install time which door drops a
# field it does not know.
#
# WHY THIS SCRIPT DOES NOT DRIVE THE REFERENCE VALIDATOR
# ------------------------------------------------------
# A real reference validator for the standard does exist: `skills-ref`
# (https://github.com/agentskills/agentskills/tree/main/skills-ref, npm
# `skills-ref`). It is not driven here, for a measured reason:
#
#   * It enforces the SPEC's field set, not our intersection. Measured against
#     skills-ref 0.1.5, adding `allowed-tools: Bash` to a SKILL.md exits 0 —
#     it is a legal spec field. Only a non-spec key such as `x-flowly-custom`
#     fails it. So it cannot enforce the rule this script exists to enforce.
#   * Its own README states it is "intended for demonstration purposes only
#     and is not meant to be used in production."
#   * Driving it would put an npm install (and its transitive tree) on the
#     critical path of a check that must run on a public repo's first commit.
#
# The rules below are therefore implemented directly, each annotated with the
# spec clause it comes from so the next reader can diff them against the source
# rather than trust this comment. This script does NOT claim to be a reference
# validator; it is a conformance check written against a published spec.
#
# Exit codes: 0 = every skill conforms, 1 = one or more violations.

set -u

# Resolve the repo root from this script's own location, so the script is
# correct when invoked by path from any working directory — matching how the
# node scripts resolve SKILLS_DIR from __dirname.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SKILLS_DIR="$REPO_ROOT/skills"

# Spec: exactly these two keys are permitted here (see rationale above).
ALLOWED_KEYS="name description"

# Spec: description must be 1-1024 characters.
MAX_DESCRIPTION_LENGTH=1024
# Spec: name must be 1-64 characters.
MAX_NAME_LENGTH=64

errors=0

skill_errors=0

fail() {
  # $1 = skill dir name, $2 = message
  printf '  FAIL %s\n       ERROR: %s\n' "$1" "$2"
  errors=$((errors + 1))
  skill_errors=$((skill_errors + 1))
}

# --- The skills tree must exist and be non-empty -----------------------------
# A vacuous pass is the failure mode this check exists to prevent: an empty or
# missing skills/ must be an error, never "0 violations".
if [ ! -d "$SKILLS_DIR" ]; then
  printf 'ERROR: skills directory not found at %s\n' "$SKILLS_DIR" >&2
  exit 1
fi

skill_count=0
for dir in "$SKILLS_DIR"/*/; do
  [ -d "$dir" ] || continue
  skill_count=$((skill_count + 1))
done

if [ "$skill_count" -eq 0 ]; then
  printf 'ERROR: no skill directories found under %s — refusing to pass vacuously\n' "$SKILLS_DIR" >&2
  exit 1
fi

# --- Per-skill conformance ---------------------------------------------------
for dir in "$SKILLS_DIR"/*/; do
  [ -d "$dir" ] || continue

  name=$(basename "$dir")
  skill_md="$dir/SKILL.md"
  skill_errors=0

  if [ ! -f "$skill_md" ]; then
    fail "$name" "Missing SKILL.md (the standard requires one at the skill root)"
    continue
  fi

  # Frontmatter must be a --- delimited block starting on line 1.
  first_line=$(head -n 1 "$skill_md" | tr -d '\r')
  if [ "$first_line" != "---" ]; then
    fail "$name" "SKILL.md does not open with a '---' YAML frontmatter block"
    continue
  fi

  # Extract the frontmatter block (between the first and second '---').
  frontmatter=$(awk '
    NR == 1 { next }
    /^---[ \t]*\r?$/ { exit }
    { print }
  ' "$skill_md")

  if [ -z "$frontmatter" ]; then
    fail "$name" "SKILL.md frontmatter block is empty or unterminated"
    continue
  fi

  # Top-level keys only: a key is a line whose name starts at column 0.
  # Indented lines are values of a nested mapping (e.g. the spec's `metadata`
  # map) and are not themselves top-level keys — but the parent key that
  # introduces them IS matched here, which is what the two-field rule needs.
  keys=$(printf '%s\n' "$frontmatter" | awk -F: '/^[A-Za-z0-9_-]+[ \t]*:/ { gsub(/[ \t]/, "", $1); print $1 }')

  # --- Rule: no key outside the permitted set --------------------------------
  for key in $keys; do
    permitted=0
    for allowed in $ALLOWED_KEYS; do
      [ "$key" = "$allowed" ] && permitted=1
    done
    if [ "$permitted" -eq 0 ]; then
      fail "$name" "Frontmatter key '$key' is not permitted — only 'name' and 'description' are allowed (see the header of this script for why the set is two, not the spec's six)"
    fi
  done

  # --- Rule: both required keys present, exactly once ------------------------
  for required in $ALLOWED_KEYS; do
    count=$(printf '%s\n' "$keys" | grep -c "^${required}$")
    if [ "$count" -eq 0 ]; then
      fail "$name" "Frontmatter missing required key '$required'"
    elif [ "$count" -gt 1 ]; then
      fail "$name" "Frontmatter declares key '$required' $count times — must appear exactly once"
    fi
  done

  # --- Rule: name value ------------------------------------------------------
  name_value=$(printf '%s\n' "$frontmatter" \
    | awk -F: '/^name[ \t]*:/ { sub(/^[^:]*:[ \t]*/, ""); print; exit }' \
    | sed -e 's/[[:space:]]*$//' -e "s/^['\"]//" -e "s/['\"]$//")

  if [ -n "$name_value" ]; then
    # Spec: name must match the parent directory name. This is also what keeps
    # frontmatter and directory moving together when skills are renamed.
    if [ "$name_value" != "$name" ]; then
      fail "$name" "Frontmatter name '$name_value' does not match the directory name '$name' (the standard requires them to be identical)"
    fi

    # Spec: 1-64 chars; lowercase a-z, 0-9 and hyphens only; no leading or
    # trailing hyphen; no consecutive hyphens.
    name_len=$(printf '%s' "$name_value" | wc -c | tr -d ' ')
    if [ "$name_len" -gt "$MAX_NAME_LENGTH" ]; then
      fail "$name" "Frontmatter name is $name_len chars — exceeds the standard's ${MAX_NAME_LENGTH}-char limit"
    fi
    if ! printf '%s' "$name_value" | grep -Eq '^[a-z0-9]+(-[a-z0-9]+)*$'; then
      fail "$name" "Frontmatter name '$name_value' is not standard-conformant — lowercase letters, digits and single non-leading/non-trailing hyphens only"
    fi
  fi

  # --- Rule: description value ----------------------------------------------
  desc_value=$(printf '%s\n' "$frontmatter" \
    | awk '/^description[ \t]*:/ { sub(/^[^:]*:[ \t]*/, ""); print; exit }' \
    | sed -e 's/[[:space:]]*$//' -e "s/^['\"]//" -e "s/['\"]$//")

  if [ -z "$desc_value" ]; then
    # Only report emptiness when the key was actually present; a missing key
    # is already reported above.
    if printf '%s\n' "$keys" | grep -q '^description$'; then
      fail "$name" "Frontmatter description is empty — the standard requires 1-${MAX_DESCRIPTION_LENGTH} characters"
    fi
  else
    desc_len=$(printf '%s' "$desc_value" | wc -c | tr -d ' ')
    if [ "$desc_len" -gt "$MAX_DESCRIPTION_LENGTH" ]; then
      fail "$name" "Frontmatter description is $desc_len chars — exceeds the standard's ${MAX_DESCRIPTION_LENGTH}-char limit"
    fi
  fi

  # Report conformant skills so a passing run still shows what it covered —
  # a check whose green output is silent cannot be distinguished from a check
  # that iterated nothing.
  [ "$skill_errors" -eq 0 ] && printf '  ok   %s\n' "$name"
done

printf '\n%s skills checked against %s — %s violation(s) — %s\n' \
  "$skill_count" "https://agentskills.io/specification" "$errors" \
  "$([ "$errors" -eq 0 ] && printf 'PASSED' || printf 'FAILED')"

[ "$errors" -eq 0 ] || exit 1
