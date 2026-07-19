# 05 — Claim verification

Every significant claim in the README, code comments, and skill docs, traced to code. Verdicts:
**Confirmed** / **Partially true** / **False** / **Stale** (was true, no longer) / **Aspirational**
(claimed, not implemented).

## README claims

| # | Claim (README) | Verdict | Evidence |
|---|----------------|---------|----------|
| R1 | "Messages survive the recipient being busy, offline, or not yet started." | **Partially true** | Survives offline via durable `inbox` (`bus.ts:78-83`). Does NOT survive a name collision — delivered to wrong holder + acked (03, loss mode 1). |
| R2 | "A standalone broker routes and durably queues." | **Confirmed** | `bus.ts` whole; `inbox.json` persistence `bus.ts:30-61`. |
| R3 | "Separate broker process, not in-process bridging" is required. | **Confirmed** | Correct — each MCP server is an isolated stdio subprocess; routing must cross processes. Sound design decision. |
| R4 | "Ack in the client, not the model… deterministic." | **Confirmed, double-edged** | `agent-channel.ts:207-211`. Deterministic, yes — and that determinism is what silently acks messages into a wrong/idle holder (03-1). |
| R5 | "Dedupe by id in the client (`seen` set) — redelivery… harmless." | **Partially true** | Harmless for *redelivery*; harmful if seq ever regresses below `seen` (skip-and-ack, 03-2). The claim omits the failure direction. |
| R6 | "`127.0.0.1` bind, no auth — acceptable because localhost." | **Confirmed** | `bus.ts:87` hardcodes `127.0.0.1`. Accurate. But see S1 below. |
| R7 | "One session per `AGENT_ID` — two sessions sharing an id clobber each other's subscription." | **True but grossly understated** | This one line is the entire disease of 02/03. "Clobber each other's subscription" reads as a benign inconvenience; the actual consequence is silent multi-hour message loss and a 1 Hz supersede war. |
| R8 | "If `AGENT_ID` is unset the client defaults to `agent`… `${AGENT_ID}` may pass through unexpanded." | **Stale** | The client now resolves name-file > env > **session uuid** (`agent-channel.ts:21-28`), not `agent`. The hook (`agentbus-name.cjs`) is now the identity source. README predates the name-file system (git: `cf954c6` post-dates the README's model). |
| R9 | Launch instructions: `AGENT_ID=toolmaker claude --dangerously-load-development-channels plugin:nord-core@nord`. | **Stale** | Still works, but is no longer the intended path — the SessionStart hook auto-derives the name and `/busname` renames. The README never mentions the hook or `/busname` at all. |
| R10 | Tests: "`bun e2e.ts`… asserts, deterministically and with no human in the loop." | **Conditional / currently False here** | 3 self-heal assertions fail when run inside a named CC session due to env inheritance (06). "Deterministic" holds only in a clean env. |

## Code-comment claims

| # | Claim (comment) | Verdict | Evidence |
|---|-----------------|---------|----------|
| C1 | `bus.ts:5-13`: "EVERY name a session ever announces resolves to that session's CURRENT live transport… surviving reconnects AND renames." | **Aspirational for the live fleet** | True only when the client sends `session=`. The 1.4.0 fleet client does not (`1.4.0/agent-channel.ts:182`), so `sessionKey = name` and the guarantee collapses to legacy behavior (01, skew; 02-3). |
| C2 | `agentbus-name.cjs:5`: "Removes… the `${AGENT_ID}` unexpanded-var ghost peer." | **False as a state claim** | The hook prevents *new* `${AGENT_ID}` registrations, but `/status` still lists a live `${AGENT_ID}` peer record (04). The ghost is not removed; its creation is prevented going forward. |
| C3 | `bus.ts` flap guard comment: rejects duplicates "keeping incumbent." | **Confirmed (post-`48fd92c`)** | Verified converging in repro (06). Note this is *my* change this session; it bounds the war (02-2a) but not squatting (02-2b). |
| C4 | `agentbus-name.cjs:13-15`: "One-line debug… Harmless; remove once confirmed." | **Confirmed left in** | The hook still appends every SessionStart payload to `/tmp/agentbus-hook-input.log` on every session start of every nord project. Debug code shipped to production, unbounded append. LOW but real. |
| C5 | README "Design decisions (do not 'simplify' away)". | **Confirmed & correct** | These four decisions are sound and correctly defended. This section is the healthiest part of the docs. |

## Skill claim

| # | Claim (`busname/SKILL.md`) | Verdict | Evidence |
|---|---------------------------|---------|----------|
| K1 | "the broker migrates any pending inbox to the new id." | **Confirmed** | `/rename` carries `inbox[from]→inbox[to]` (`bus.ts:198-208`). |
| K2 | "the old one should drop" from `connected`. | **Confirmed for the legacy path** | Under name==sessionKey, renaming re-subscribes under the new name and the old sessionKey's stream is superseded. |

## The pattern

The docs are honest about the *transport* and the *design rationale*, and stale or understated
about *identity*. Every red verdict above is an identity claim. The README describes a system whose
identity model was replaced (name-files, hook, session-param) without the README being updated, and
whose one real identity limitation (R7) is buried as a one-liner in "Known limits."
