---
name: flowly-connect
description: Connects an agent to a Flowly instance over its MCP door and tells the ways in apart from the ways a call is turned away — proving the door with a whoami identity call, choosing among OAuth, a scoped credential and the legacy shared one in preference order, and mapping 401, 503, 307, 421 and a scope refusal that arrives inside a 200 to its cause and its next action. Use when Flowly's tools are missing from a session or a Flowly call is refused, use before pointing a client at an instance URL, and use after a credential is rotated, revoked or reissued with different scopes.
---

# Connecting to Flowly

## Overview

An agent reaches Flowly through one door: an MCP endpoint at `/mcp/`, served from whatever URL that instance runs on. Every other Flowly skill assumes the door is open and the credential behind it resolves to an actor. This skill opens it, proves it with a single call, and separates the ways it can be shut — because they have different causes, and only one of them is fixed by getting a new credential.

**No hostname appears in this skill, and none belongs in anything you write.** The URL is per-instance. Ask the operator for it and put it in client configuration; do not guess one, do not carry one over from an example, and do not commit one. A hostname matches no credential pattern, so nothing scans it out of a public commit later.

## When to Use

- A session has no Flowly tools at all, or a Flowly tool call comes back refused
- You are pointing a client at an instance for the first time
- A credential was rotated, revoked, or reissued with a different scope set
- Two clients are being attributed to the same actor and should not be
- Before any Flowly workflow that assumes the tools work — planning, building, reviewing

**When NOT to use** — a failure in the project you are working on. A broken build, a failing test, an exception in your own code: none of that is this door, and the `debugging-and-error-recovery` skill is where that goes.

## The Door

| | |
|---|---|
| Path | `/mcp/` on the instance's own URL — the trailing slash is the canonical form |
| Transport | streamable HTTP, stateless, plain JSON responses |
| Client | any spec-conformant MCP client; nothing in the door reads which one is calling |
| Credential | a bearer token, sent in the `Authorization` header |
| Off switch | `FLOWLY_MCP_ENABLED`. Off answers `503` to every request, credential or not |

Every tool is gated by exactly one of six scopes, and a tool absent from the map cannot be called at all rather than defaulting to ungated:

| Scope | Gates |
|---|---|
| `issues:read` | every read — projects, issues, comments, actors, notifications, planning docs, reviews, loops, runs |
| `issues:write` | writing an issue: create, update, assign, comment, triage, milestone, notifications, PR links |
| `projects:write` | the shape of the work — projects, initiatives, milestones, releases |
| `planning:write` | the planning ceremony — the planning docs, the task list, submission, conversion |
| `loops:run` | loops, runs, advancing a run, and attaching evidence |
| `assets:read` | a project's agents, skills and commands, over both the tool and the resource surface |

## Ways In

Three credentials reach the door. All three resolve to one actor, and the actor is what every write is attributed to — so the choice is not only about secrecy, it decides whether two agents are two people on the board or one.

The prefix is not secret and is how the door dispatches before it touches the database. It is also how you tell which of the three you are holding without asking anyone.

| Order | Credential | Prefix | Preferred over the next because |
|---|---|---|---|
| A | OAuth | `flo_oat_` | nothing secret is copied between windows, and each client ends up as its own actor |
| B | a scoped credential issued by hand | `flo_pat_` | it is scoped, revocable and expiring, and it still names one actor |
| C | the legacy static one | none — it is matched as a whole | nothing. It is last: one shared secret, one actor, all six scopes, and it exists so an older setup keeps running |

### A. OAuth — nothing to copy

Point the client at the instance URL and let it do the rest. It discovers the authorization server from the `401`, registers itself, and sends the human to a consent screen where they sign in, **pick which agent actor the client will act as**, and approve scopes. No secret moves between windows, and no secret lands in a config file.

This is the path that makes attribution work: two clients connected this way are two actors, so the board shows who did what.

The authorization server is served from the instance's origin root, **not from under `/mcp/`**. Do not go looking for a discovery document beneath the MCP path — follow the pointer the `401` hands you and it lands in the right place.

### B. A scoped credential, issued by hand

For a client that does not speak OAuth, or when a long-lived credential is wanted: a human issues one at `/settings/tokens`, choosing the agent it acts as and the scopes it carries. **The secret is shown once.** It goes to the client as a bearer token.

Prefer this over C for anything new. It names its own actor, it holds only the scopes it was given, and it can be revoked or left to expire without touching anything else.

### C. The legacy static one

One shared secret from the environment (`FLOWLY_MCP_TOKEN`), resolving to one configured actor and holding **all six scopes** — it names no actor of its own, so there is no row to read a narrower set from. It exists so a setup that predates the other two keeps running, and an operator can retire it with one environment variable (`FLOWLY_MCP_LEGACY_STATIC_TOKEN=false`) with no code change.

Last because it cannot tell two agents apart and cannot be narrowed. If two clients call `whoami` and get the same actor back, they are sharing this credential — every write from both carries one byline.

## Process

### 1. Get the URL from whoever runs the instance

It is the one input you cannot derive. Take it, use it in client configuration, and leave it there.

### 2. Point the client at `/mcp/`

Trailing slash. The door is mounted, so the path without it is a redirect rather than the endpoint.

### 3. Authenticate — A, then B, then C

Take the first one the client and the instance both support. Falling to C is a decision about attribution, not a shortcut: say so rather than letting it happen quietly.

### 4. Call `whoami` — this is the connection test

`whoami` is the identity call and the cheapest proof the door is open. It takes no arguments, and an answer rules out three failures at once:

| An answer proves | Because |
|---|---|
| the door is on | a switched-off door answers `503` before anything else runs |
| the credential resolved | an unresolvable one never reaches a tool; it answers `401` |
| the credential holds `issues:read` | `whoami` is gated like every other tool, so a scopeless credential is refused here too |

It returns the actor you will be attributed as — id, slug, and display name. That actor is also what the sentinel `"me"` means in `assign_issue` and `list_issues`, so you never need to look the id up again in this session.

Do not substitute `list_actors`: it answers who exists, not who you are.

### 5. Read the refusal before changing anything

Every failure below has a different next action, and four of them are not credential problems at all. Match the signal first; rotating a credential by reflex fixes one row out of six.

## What a Refusal Means

| Signal | Cause | Next action |
|---|---|---|
| `401` | no credential, or one the door will not resolve — absent, malformed, expired, revoked, unknown, or the legacy path retired by the operator | get a credential. The response carries a `WWW-Authenticate` header naming the protected-resource metadata document, which is how an OAuth client discovers the authorization server with nothing else told to it. Do not resend the same credential |
| `503` | the agent door is switched off — `FLOWLY_MCP_ENABLED=false` | **not a credential problem.** No credential of any kind gets through; ask the operator to enable the door. An unset `FLOWLY_MCP_TOKEN` does not cause this |
| `307` | the URL had no trailing slash; the canonical path is `/mcp/` | follow the redirect or fix the URL. A client that will not redirect a POST reports this as a dead endpoint |
| `421` | the `Host` header names a host this instance does not claim. DNS-rebinding protection is on, and the allowlist is derived from the URLs the instance advertises as its own, plus loopback | **not a credential problem.** Reach the instance by the hostname it advertises, or have the operator add the one you are using to what it advertises |
| a JSON-RPC result with `isError: true` whose message names a scope | the credential is valid and resolved to an actor; it just does not hold that tool's scope | ask for a credential holding **the scope named in the message**. The identity was never in question, so a fresh token of the same shape changes nothing |
| a tool error inside a `200` naming a field, an identifier or a transition | a domain refusal — an unknown identifier, an illegal transition, a validation failure, or a gate that only a human passes | read the message: it names the field, the transition, or the gate. Fix the argument, or hand over and wait. Several of these are the workflow working, not breaking |

### A scope refusal is not a status

This is the row that gets misread, so it is worth the paragraph. A scope refusal arrives as a JSON-RPC result with `isError: true` **inside a `200`** — it is not a `401`, and it is deliberately not a `403` either. The only middleware in the system that can answer `403` applies one scope set to the whole endpoint, so any non-empty value there would lock a credential that legitimately holds *some* scopes out of the *entire* door. By the time a `tools/call` reaches a tool, the transport has already committed to `200`, so a per-tool refusal can only be a tool error.

The consequence is the whole point: an agent that reads a scope refusal as an authentication failure goes hunting for a new credential when what it needs is a **scope**. The message names the missing one so you can ask for the right thing instead of retrying.

### A tool error is never a reason to write local planning files

**No failure at this door — `401`, `503`, `307`, `421`, a scope refusal, or a domain refusal — licenses writing a plan, a task list, a spec or a status note into the working tree.** A file on disk has no gate, no reviewer, and no conversion; it is not a degraded version of the Flowly artifact, it is a different thing that nothing will ever read. Where planning artifacts live, and why, is the `flowly-plan` skill's rule, and a connection failure does not suspend it.

When the door is shut, the honest move is to say so and stop. Report the signal and the action the table gives, and hold the work in the conversation until the door opens.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It refused, so the token must be bad — I'll get another one" | Four of the six signals are not credential problems. Read the signal before rotating anything; the wrong fix costs a human's time and leaves the real cause in place |
| "It says I'm missing a scope, so I'll re-authenticate" | The credential already resolved to an actor. A new credential of the same shape holds the same scopes. Ask for the named scope |
| "A scope problem should be a 403, so this must be something else" | Nothing that can answer `403` here knows which tool was called; that middleware guards the whole endpoint. A per-tool refusal can only be a tool error inside a `200` |
| "The tools are gone, so I'll write the plan to a file for now" | A local file has no gate, no reviewer and no conversion. There is no "for now" — nothing reads it later |
| "I'll put the instance URL in the skill so the next agent doesn't have to ask" | The URL is per-instance, and a hostname in a public commit cannot be withdrawn. It belongs in client configuration, which is per-installation |
| "The server is down — I'm getting a 503" | `503` here means the agent door was switched off on purpose. The rest of the instance is unaffected, and no credential changes the answer |
| "Unsetting the token will disable the door" | It disables nothing. The off switch is `FLOWLY_MCP_ENABLED`; a scoped credential needs no environment configuration at all |
| "The static token is what the setup docs show, so I'll use it" | It is the last of three on purpose: one shared secret, one actor, all six scopes. Every agent using it writes under the same byline |
| "The discovery document must be under the MCP path" | It is served from the origin root. Follow the pointer in the `401` rather than guessing a path |
| "I'll call a real tool to check the connection" | `whoami` takes no arguments and writes nothing. A write used as a probe leaves a row behind when it succeeds |

## Red Flags

- A hostname — any hostname, including a loopback one — written into a skill, a doc, a commit, or an eval
- Rotating or reissuing a credential before the signal has been identified
- A scope refusal answered by re-authenticating instead of by asking for the named scope
- Treating `503` or `421` as something a credential can fix
- Retrying the same call unchanged after a refusal that named a field or a transition
- A planning artifact written to the working tree because a tool call did not go through
- The legacy static credential chosen when the client could have done OAuth
- Two clients that report the same actor from `whoami` and are assumed to be two
- A credential's secret pasted anywhere it will be committed or logged
- Reporting "connected" on the strength of a client's own status line rather than an answered call

## Verification

Before treating the connection as working:

- [ ] The instance URL came from the operator and lives only in client configuration
- [ ] The client is pointed at `/mcp/`, with the trailing slash
- [ ] The credential in use is the highest of A, B, C that this client and instance both support
- [ ] `whoami` was called and returned an actor — id, slug and display name
- [ ] That actor is the one this client should be attributed as, not a shared one you did not choose
- [ ] No hostname was written into any file

After any refusal:

- [ ] The signal was identified against the table before anything was changed
- [ ] The next action taken is the one that row names
- [ ] A scope refusal was answered by naming the missing scope, not by fetching a new credential
- [ ] Nothing was written to the local filesystem in place of the Flowly artifact

## See Also

The `flowly-plan` skill owns where planning artifacts live and who approves them; this skill restates only the part a connection failure tempts an agent to break. For a failure in the project you are working on rather than in this door, the `debugging-and-error-recovery` skill applies.
