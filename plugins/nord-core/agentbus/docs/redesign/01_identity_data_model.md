# 01 — Identity & data model

## The one rule

**`sessionId` is the sole routing identity. A name is a mutable, unique alias for exactly one live
session.** Everything else follows.

`sessionId` = `CLAUDE_CODE_SESSION_ID` (stable per session, survives SSE reconnects and renames).
The client MUST present it on every subscribe. A subscribe without it is legacy and handled only
during migration (06).

## Uniqueness rule (the anti-collision core)

> A `name` maps to **at most one live session** at a time. A claim on a name already held by a
> *different live session* is **rejected**, not superseded.

This single rule eliminates the supersede war (02-2a) and squatting (02-2b) at the root — there can
never be two live sessions under one name, so a message to a name has exactly one live destination
or none. It replaces the entire flap-guard / war-guard machinery (`48fd92c` becomes dead code).

A session may hold **multiple** names (aliases accumulate across renames), but each name has one
owner. A rename adds the new name and keeps the old ones pointing at the same session (so peers who
knew an old name still reach it — the one good property of the current session-centric model).

## Data structures (broker)

```ts
type SessionId = string   // CLAUDE_CODE_SESSION_ID
type Name = string

interface SessionRec {
  emit: (frame: string) => void      // current live SSE writer (undefined when dropped)
  closer: () => void
  names: Set<Name>                   // every alias this session announced
  meta: PeerMeta                     // pid, ppid, cwd, title, client_version (reported on subscribe)
  state: 'live' | 'dropped'          // 'dropped' = SSE gone, within grace window
  connectedSince: number
  lastSeen: number                   // last heartbeat/ack/subscribe; drives GC + presence age
  graceUntil?: number                // set when dropped; GC target
}

interface PeerMeta { pid?: number; ppid?: number; cwd?: string; title?: string; client_version?: string }

interface Msg {
  id: number                         // monotonic (seq high-water, unchanged from today)
  from_session: SessionId
  from_name: Name
  to_name: Name                      // as addressed by sender
  to_session: SessionId | null       // resolved at send; null while name-pending
  text: string
  ts: number
  state: 'queued' | 'delivered' | 'acked'
  acked_by_session?: SessionId       // WHO consumed it (receipt truth)
  acked_at?: number
  expires_at?: number                // only set for name-pending messages (TTL)
}

const sessions   = new Map<SessionId, SessionRec>()
const nameIndex  = new Map<Name, SessionId>()      // alias -> owner (uniqueness enforced here)
const inbox      = new Map<SessionId, Msg[]>()      // durable, keyed by SESSION (not name)
const pendingByName = new Map<Name, Msg[]>()        // for sends to a not-yet-live name; TTL'd
const receipts   = new Map<number, Msg>()           // id -> message, for /receipt lookups (bounded, see 04)
```

## Inbox re-keying — the big change

Today `inbox` is keyed by **name** and lives forever (autopsy 04). New model:

- **`inbox` is keyed by `sessionId`.** Delivery is exact: a message for session S is queued under S,
  redelivered on S's reconnect, and **dropped when S is GC'd** (a dead session has no inbox — no
  ghost). This is what makes ghosts impossible.
- **`pendingByName`** preserves the one feature session-keying would otherwise lose: *send to a peer
  that hasn't started yet.* When you send to name `worker` and no session owns it, the message goes
  to `pendingByName['worker']` with `expires_at = now + PENDING_TTL` (e.g. 1 h). When a session later
  claims `worker`, it drains `pendingByName['worker']` into its session inbox. The TTL sweep drops
  expired pending → bounded, unlike today's immortal name inbox.

### Send resolution

```
send(to_name):
  owner = nameIndex.get(to_name)
  if owner and sessions.has(owner):        # live or in-grace
      msg.to_session = owner
      inbox[owner].push(msg); deliver(owner)
  else:                                     # nobody owns it (yet)
      msg.to_session = null
      pendingByName[to_name].push(msg with expires_at)   # TTL'd, not immortal
      # response tells sender: "queued, no live peer" — distinct from "delivered"
```

## Why this closes the autopsy findings

| Autopsy finding | Closed by |
|---|---|
| Supersede war (02-2a) | Uniqueness rule — second claimant rejected, never supersedes |
| Squatting / wrong-holder ack (02-2b, 03-1) | One live owner per name + `acked_by_session` in the receipt |
| Ghost inboxes (04) | Session-keyed inbox dies with the session; name-pending is TTL'd |
| Version skew disabling identity (02-3) | `session=` mandatory (enforced after drain, 06) |
| Collision-factory names (02-1) | Unique name derivation in the hook (below) |

## Unique name derivation (hook rewrite)

`agentbus-name.cjs` must never mint a name a live session already holds and never fall back to a
shared token. New `pick()`:

1. explicit `AGENT_ID` env (if set and not `${AGENT_ID}`)
2. launch title / `--name`
3. else derive a **base** from branch or project-dir, then **suffix a short session-id fragment**:
   `taxgraph-<a1b2>` — unique per session, still human-readable.
4. On write, the client's first subscribe carries the name; if the broker rejects it as taken by
   another live session (uniqueness), the client appends/increments the suffix and retries. The name
   the broker accepted is the canonical one, echoed back in the subscribe ack and shown to the user.

Bare `agent`, bare branch, bare dir are never final names — they are only *bases* that always get a
session-unique suffix.
