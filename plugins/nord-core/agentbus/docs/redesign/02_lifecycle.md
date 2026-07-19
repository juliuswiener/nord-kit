# 02 — Lifecycle & zombie elimination

## Session state machine

```
                subscribe(session,name,meta)
   (none) ──────────────────────────────────▶ LIVE
                                               │  ▲
                       SSE stream drops        │  │ reconnect (same session) within grace
                                               ▼  │
                                             DROPPED ──(grace expires)──▶ GC ──▶ (none)
                                               │
                     explicit /close, or /kill │
                                               ▼
                                              GC ──▶ (none)
```

| State | Meaning | In `connected` presence? | Inbox kept? |
|-------|---------|--------------------------|-------------|
| LIVE | SSE open, heartbeating | Yes | Yes |
| DROPPED | SSE gone, within `GRACE_MS` (reconnect allowed) | No | Yes (reconnect will drain) |
| GC | removed: session, its names from `nameIndex`, its `inbox` | — | **No — dropped** |

Transitions:

- **subscribe**: create/refresh `SessionRec`; enforce uniqueness on each claimed name (01); drain
  `pendingByName[name]` → session inbox; deliver inbox. Record `meta` (pid/ppid/cwd/title/version).
- **SSE drop** (`req.signal` abort / stream close): `state='dropped'`, `graceUntil = now + GRACE_MS`
  (e.g. 45 s), remove `emit` from presence. Do **not** drop inbox — a reconnect within grace resumes.
- **reconnect within grace**: same `sessionId` subscribes → back to LIVE, redeliver.
- **grace expires** (sweep): GC. Its inbox messages die here (undeliverable — the session is gone).
- **explicit /close**: immediate GC, no grace (clean shutdown).
- **/kill**: force GC now + close the stream (operator action).

## Zombie elimination — three layers + one honest limit

### The limit (stated first)

The broker sees only SSE heartbeats. A **zombie client process** (CC session dead, bun `agent-channel`
still running and reconnecting) heartbeats identically to a live one. **The broker cannot tell them
apart.** So zombie *prevention* must happen in the client, and zombie *cleanup* needs the operator.

### Layer 1 (primary) — client self-terminates on stdio close

Root cause today: `pump()` is decoupled from the MCP/stdio connection (`agent-channel.ts` + the e2e
comment at `e2e.ts:59-60` that deliberately keeps stdin open). When CC exits it SIGTERMs the bun
child and closes stdio, but `pump()` keeps reconnecting to the bus regardless — that is the zombie.

Fix: bind the client's life to its stdio-to-CC transport.

```ts
const transport = new StdioServerTransport()
transport.onclose = onParentGone
await mcp.connect(transport)
process.stdin.on('end', onParentGone)   // stdin EOF = parent gone
process.on('SIGTERM', onParentGone); process.on('SIGINT', onParentGone)

async function onParentGone() {
  try { await fetch(`${BUS}/close`, { method:'POST', body: JSON.stringify({ session: SESSION_ID }) }) } catch {}
  activeCtrl?.abort(); process.exit(0)
}
```

`/close` immediately GCs the session at the broker (names + inbox gone). No zombie, no ghost inbox.
(The e2e harness must opt out of this — see 06/07 — since it deliberately runs the client with no MCP
host; that opt-out is a test-only env flag, not a product decouple.)

### Layer 2 (belt) — SessionEnd hook

CC fires a `SessionEnd` hook on exit. Add `agentbus-close.cjs`:

```
SessionEnd → curl -s -XPOST 127.0.0.1:9000/close -d '{"session":"'$CLAUDE_CODE_SESSION_ID'"}'
```

Catches clean exits even if the stdio-close race is lost, and covers `/clear` semantics if desired.

### Layer 3 (backstop) — TTL sweep

A periodic sweep (every `SWEEP_MS`, e.g. 30 s):

- `DROPPED` sessions past `graceUntil` → GC.
- `pendingByName` messages past `expires_at` → drop.
- **Optional aggressive mode**: a `LIVE` session whose `lastSeen` is older than `2×heartbeat` with no
  reconnect is suspect — but since a healthy idle client heartbeats, a stale `lastSeen` means the
  stream is actually dead and will already be `DROPPED`. The sweep does not kill `LIVE` sessions
  (can't distinguish zombie from busy); that is the operator's `/kill` (Layer 4, see 05).

### Layer 4 (operator) — investigate + kill

Presence (`/status`) exposes `pid/ppid/cwd/lastSeen/version` so the user can spot a straggler (old
`lastSeen`, or a `ppid` whose CC parent is gone). `/kill?session=|name=` force-GCs it at the broker
and returns the `pid` so the user (or the `agentbus kill` CLI) can `SIGTERM` the actual process. See
05.

## Guarantee

- Clean session close → gone from the bus in **≤1 sweep** (Layer 1/2 make it immediate; Layer 3 is
  the backstop).
- Crash without clean close → gone within `GRACE_MS` of the SSE dropping.
- Orphaned zombie process (survives its CC parent) → self-exits via Layer 1; if Layer 1 fails, the
  operator sees it in presence and `/kill`s it. It can **never silently hold a name and eat messages**,
  because uniqueness (01) means it can't co-own a name with the live session, and receipts (04) name
  whoever acked.
