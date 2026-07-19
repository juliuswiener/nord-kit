# 07 — Implementation plan

Phased, each phase gated by a **deterministic** check (test exit code / `/status` assertion), not
self-review. Phases 1–3 are code; Phase 4 is the operational cutover (06). Transport code is not
touched in any phase.

## Phase 1 — broker state-model rewrite (`bus.ts`)

**Build:**
- Replace `sessions`/`nameOwner`/`sessionNames` with the 01 data model: `sessions: Map<SessionId,
  SessionRec>`, `nameIndex` (uniqueness-enforced), `inbox` keyed by `SessionId`, `pendingByName` (TTL),
  `receipts` (bounded).
- Lifecycle/GC (02): DROPPED grace window, sweep loop, immediate GC on `/close`.
- Endpoints (03): `/close`, `/kill`, `/receipt`, `/read`, enriched `/status`; `/send` returns
  `{id,state,to_session}` with `queued_pending` vs `queued_offline` vs `delivered`; broadcast → live
  owners only; `/ack` keyed by session + pushes Tier-1 receipt; `/read` marks read + pushes Tier-2
  receipt.
- Dual-mode (06): accept legacy no-`session` behind `strict_identity=false`, keep the war-guard for it.
- Keep: SSE writer, heartbeat, seq high-water, `inbox.json` persistence (re-keyed), the idle-watchdog
  contract.

**Gate — a rewritten `e2e.ts` (in-tree), all green in a CLEAN env:**
1. session-keyed directed delivery + ack + Tier-1 receipt to `from_session`
2. **uniqueness**: second live session claiming a held name gets `name_taken`, first keeps it
3. **GC**: `/close` → session vanishes from `/status`, its inbox gone (no ghost)
4. **grace**: SSE drop → still present ≤grace, GC'd after
5. `queued_pending` (no owner) vs `delivered` (owner) distinction in `/send` response
6. `pendingByName` drains to the session that later claims the name; expired pending swept
7. broadcast reaches only live owners; a dead name never receives
8. Tier-2: a simulated `/read` marks `read` + pushes a receipt to the sender
9. **war-convergence regression** (the `48fd92c` case that shipped without a test — autopsy 06)

## Phase 2 — client lifecycle (`agent-channel.ts`)

**Build:**
- `session=` always sent (already in the marketplace copy, `:185-186`); `meta` (pid/ppid/cwd/title/
  version) on subscribe.
- **Stdio-bound life** (02 Layer 1): `transport.onclose` / `stdin 'end'` / SIGTERM → POST `/close` →
  exit. Remove the pump-decoupled-from-stdio behavior (guard the e2e standalone case behind a
  test-only `AGENTBUS_STANDALONE=1` env, not a product decouple).
- On emit: also append `{id,from}` to `/tmp/agentbus-unread-<session>.jsonl` (Tier-2 data plane, 04).
- Render receipt frames on the outbound echo: `✓ delivered` → `✓✓ read`.
- `name_taken` handling: append/increment a session-id suffix and re-subscribe (01).

**Gate — new client-lifecycle tests:**
1. **zombie kill**: spawn client with a fake parent; close its stdin → within N s it POSTs `/close`
   and disappears from `/status` (the anti-zombie proof)
2. SIGTERM → `/close` + exit
3. `name_taken` → retries with suffix, ends up connected under a unique name
4. emit → unread file contains the id; receipt frame updates the echo

## Phase 3 — hooks + CLI

**Build:**
- Rewrite `agentbus-name.cjs`: unique-name derivation (base + session-id suffix; never bare
  `agent`/branch/dir) — 01.
- New `agentbus-read.cjs` (Stop hook): read `session_id` from stdin → drain
  `/tmp/agentbus-unread-<session>.jsonl` → POST `/read {session, ids}` → truncate. (Verified: Stop
  fires per turn, gets `session_id`, can `curl`.)
- New `agentbus-close.cjs` (SessionEnd hook): POST `/close {session}`. Register both + the existing
  name hook in `hooks.json`.
- `agentbus` CLI (05): `peers | ghosts | kill | gc | tail | receipt`.

**Gate:**
1. two sessions in the same project/branch (no explicit name) → **distinct** busnames in `/status`
   (collision-factory fixed)
2. SessionEnd → peer removed from `/status`
3. Stop hook end-to-end: peer B receives a message, runs a turn → sender A receives a `read` receipt
   naming B's session (run with two real CC sessions or a scripted turn)
4. `agentbus kill <name>` → peer gone from `/status` AND its pid SIGTERM'd

## Phase 4 — cutover (operational, 06)

- Phase 0 deploy (dual-mode) → drain (monitor `client_version`) → flip `strict_identity=true` →
  delete the war-guard + legacy `?? name` branch.
- **Gate:** dual-mode accepts both legacy + v2 (Phase 0); after flip, a no-`session` subscribe gets
  `upgrade_required`; `/status` shows zero legacy `client_version`; uniqueness enforced with no
  fallback; dead code removed and `tsc`/tests still green.

## Cross-cutting

- Every phase: `bun build`/`tsc` clean + the phase's e2e gate green **in a clean env** (fix the
  `CLAUDE_CODE_SESSION_ID` inheritance first — `delete env.CLAUDE_CODE_SESSION_ID` in `spawnClient`,
  autopsy 06 — so green is trustworthy).
- Tests live in-tree; nothing ships without its regression test (the war-guard's missing test is the
  cautionary tale).

## Sequencing & effort

| Phase | Depends on | Rough size |
|-------|-----------|-----------|
| 1 broker | — | Largest — the state-model rewrite (~½ of `bus.ts`) |
| 2 client | 1 (endpoints) | Medium — lifecycle + receipt render |
| 3 hooks+CLI | 1, 2 | Small-medium — three hooks + a CLI wrapper |
| 4 cutover | 1–3 deployed + drain | Config flip + dead-code delete |

Phases 1+2 are the substance and can be built together against the new `e2e.ts`. Phase 3 makes it
usable and enforces unique identity at the source. Phase 4 is a flag flip gated on the fleet
relaunching — days/weeks of calendar time, minutes of work.

## Files touched

`bus.ts` (rewrite state model), `agent-channel.ts` (lifecycle + receipts + meta), `e2e.ts` (rewrite +
isolation fix), `agentbus-name.cjs` (unique names), **new** `agentbus-read.cjs`, **new**
`agentbus-close.cjs`, `hooks.json` (register two hooks), **new** `agentbus` CLI, `README.md`
(reconcile with reality — autopsy 05), `config`/service (new flags, 06). Transport internals: **untouched**.
