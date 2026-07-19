# 03 — HTTP endpoint contract

Broker on `127.0.0.1:9000`. All bodies JSON. Errors return `{error: string}` with a 4xx/5xx status.

## `GET /subscribe?agent=<name>&session=<id>&meta=<b64json>`

Opens the SSE stream for a session. `session` is **required** in strict mode (06); in migration mode
a missing `session` falls back to `session = name` (legacy) and is flagged.

- `meta` (optional): base64-encoded `PeerMeta` `{pid,ppid,cwd,title,client_version}` for presence.
- **Uniqueness check**: if `agent` is already owned by a *different live* `session` → the stream
  emits a control frame `:{"type":"name_taken","name":"<name>"}` and closes. The client must retry
  with a suffixed name (01). If owned by the *same* session (reconnect) → resume.
- On success: registers/refreshes the `SessionRec`, drains `pendingByName[name]`, delivers `inbox`,
  emits `: connected` then message frames.

SSE frame types (all `data: <json>` except comments):
- message: `{id, from, text, ts}`
- control: `{type:"receipt", id, state, by_name, by_session}` (04)
- control: `{type:"name_taken", name}` / `{type:"upgrade_required"}` (06)
- comment `: ping` heartbeat.

## `POST /send`  → `{ id, target, state, to_session }`

Body: `{ from_session, from, to?, text, expect_receipt?:bool }` (accepts legacy `message/content/body`
text fields, unchanged). `to` omitted = broadcast.

- **Directed**: resolve `to → sessionId` (01). Response `state`:
  - `delivered` — a live session owns it, pushed now. `to_session` = the owner.
  - `queued_offline` — a known session owns it but is `DROPPED` (in grace); queued to its inbox.
  - `queued_pending` — no session owns the name; queued to `pendingByName` with TTL. **Distinct
    from delivered** — the sender knows nobody is there yet (fixes today's silent "queued to a
    blackhole" — autopsy 04, `list_peers` typo trap).
- **Broadcast**: targets **live owners only** (`nameIndex` entries whose session is `LIVE`), never the
  full inbox keyset. Returns per-target `{name, state}`. (Fixes broadcast ghost-amplification,
  autopsy 04 / KC-4.)
- Returns `id` for receipt tracking (04).

## `POST /ack`  → `{ ok }`

Body: `{ session, id }`. Purges message `id` from the acking **session's** inbox, sets the message
`state='acked'`, `acked_by_session=session`, `acked_at=now`, and **emits a `receipt` frame back to
`from_session`** (04). The ack is keyed by `session` (not name), so the receipt names exactly who
consumed it.

## `POST /close`  → `{ ok, gc:true }`

Body: `{ session }`. Immediate GC of the session: removes it from `sessions`, drops all its names
from `nameIndex`, deletes its `inbox`. Called by the client on stdio-close/SIGTERM (Layer 1) and by
the SessionEnd hook (Layer 2). Idempotent.

## `POST /rename`  → `{ ok, name }`

Body: `{ session, to }`. Adds alias `to` to `session.names` (uniqueness-checked; `name_taken` on
conflict), keeps old aliases resolving to the same session. Preferred path is a re-subscribe under
the new name with the same `session=` — `/rename` remains for the name-file-poll client path.

## `POST /kill`  → `{ ok, killed:[{session,name,pid}] }`

Operator/admin. Body: `{ session? , name? }`. Force-GCs the target (same as `/close`) and closes its
stream. Returns the `pid`(s) so the caller can `SIGTERM` the actual process. Does **not** kill the
process itself (not the broker's authority).

## `GET /receipt?id=<id>`  → `{ id, state, to_session, acked_by_session, acked_at }`

Pull-based receipt lookup for a sent message (04). `state ∈ {queued_pending, queued_offline,
delivered, acked}`. Returns 404 once the receipt has aged out of the bounded `receipts` map.

## `GET /status`  → presence (05)

Full peer list with per-peer meta, state, age, pending. See 05 for the exact shape.

## Endpoint delta vs today

| Endpoint | Today | v2 |
|----------|-------|-----|
| `/subscribe` | `agent` (+ optional `session`) | `session` required (strict); uniqueness reject; `meta` |
| `/send` | returns `{delivered_to, live, queued}` | returns `{id, state, to_session}`; broadcast = live-only |
| `/ack` | purge by name-alias set | purge by session; **emit receipt** |
| `/close` | — | **new** (immediate GC) |
| `/kill` | — | **new** (operator force-remove) |
| `/receipt` | — | **new** (pull receipt) |
| `/rename` | name→name inbox move | session-scoped alias add |
| `/status` | names + pending | + pid/ppid/cwd/state/lastSeen/version |
