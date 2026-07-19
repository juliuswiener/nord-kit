# 04 — Receipts: delivered vs read (end-to-end)

The sender must learn what happened to its message — and **which session** consumed it. Two tiers,
both **deterministic** (neither relies on the model choosing to call an ack tool — the failure the
original design correctly avoided).

## Message state machine

```
queued_pending ──(name claimed)──▶ queued_offline ──(reconnect)──▶ delivered ──(client emit+ack)──▶ ACKED
      │                                   │                            │                               │
   (no owner yet, TTL'd)          (owner in grace)              (pushed to live SSE)          (in session's client)
                                                                                                       │
                                                                                    (session runs a turn: Stop hook) │
                                                                                                       ▼
                                                                                                     READ
```

| State | Set by | Proves |
|-------|--------|--------|
| `queued_pending` | `/send`, no live owner | nobody is there yet (TTL'd, not immortal) |
| `queued_offline` | `/send`, owner DROPPED | the right session exists but is momentarily gone |
| `delivered` | broker pushed to a live SSE | a live transport for the right session received the bytes |
| `acked` (**Tier 1**) | client `/ack` on emit | the message entered the target **session's client** |
| `read` (**Tier 2**) | Stop hook `/read` | the target session's **model actually ran a turn** with it in context |

## Tier 1 — transport ack (`acked`) — deterministic, immediate

Unchanged mechanism from today, with one critical addition: the ack is **keyed by session** and
carries **who acked**.

- Client emits the `notifications/claude/channel` and immediately POSTs `/ack {session, id}`
  (`03`).
- Broker sets `state=acked`, `acked_by_session=session`, and **pushes a receipt frame back to the
  sender**: `{type:receipt, id, state:acked, by_name, by_session}`.
- Because uniqueness (01) guarantees one live owner per name, `acked_by_session` **is** the intended
  target. A squatter can't hold the name, so it can't false-ack — the exact silent-loss bug
  (autopsy 03-1) is structurally impossible, and if anything odd happens the sender sees a
  `by_session` that doesn't match.

Tier 1 answers: *"did it reach the right session's inbox-client?"* — deterministically, in
milliseconds.

## Tier 2 — read receipt (`read`) — the operator's request, via a Stop hook

Tier 1 proves the client emitted it; it does **not** prove the model saw it (an idle session, or a
client that emits into a session whose model isn't running). The operator asked for an ack that
fires *on actual receipt, not on landing*. The deterministic way to get that — without trusting the
model to call a tool — is a **Stop hook**, which Claude Code fires when the model completes a turn.

### Mechanism

1. On emit, the client appends the msg id to a per-session unread file:
   `/tmp/agentbus-unread-<session>.jsonl` ← `{id, from}`. (In addition to the Tier-1 ack.)
2. A **Stop hook** `agentbus-read.cjs` (fires on turn completion): reads the unread file, POSTs
   `/read {session, ids:[…]}` to the broker, then truncates the file.
3. Broker: for each id sets `state=read`, `read_at=now`, and pushes `{type:receipt, id, state:read,
   by_session}` to `from_session`.
4. Sender's client renders it against the outbound echo, messenger-style:
   `→ taxgraph-instructor: …  ✓ delivered  →  ✓✓ read`.

### Why this is deterministic

The Stop hook is fired by Claude Code, not chosen by the model. If the session's model runs a turn,
the hook runs — guaranteed. A **zombie session never runs a turn → never fires Stop → never reads**,
so the sender sees `delivered` but never `read`. That is the true end-to-end signal the operator
wants: *read means a live model actually processed a turn with the message present.*

### Verified CC hook facts (checked against the hooks + channels docs)

- **No channel-receipt hook exists.** There is no hook that fires when a `<channel>` event is
  injected/rendered. `Notification` is for CC's *own* notifications (permission/idle/auth), not
  inbound channels. `UserPromptSubmit` **does not fire for channel-injected content** (docs:
  "system-injected context uses `additionalContext`/`InstructionsLoaded`, not this event"). So the
  Stop hook is the only deterministic vehicle — confirming the design, not a workaround for a missing
  better option.
- **Stop hook fires once per turn**, receives stdin JSON `{session_id, transcript_path, cwd,
  permission_mode, last_assistant_message, …}`, supports `type:"command"`, and can `curl` a local
  endpoint. `session_id` tells the hook which unread file to drain. All required capabilities: present.
- **A hook cannot learn which msg_ids were in the turn.** Confirmed — so the **temp-file handshake is
  mandatory, not optional**: the MCP client writes emitted ids to `/tmp/agentbus-unread-<session>.jsonl`,
  the Stop hook reads+confirms+truncates. This is a data-plane pattern between client and hook, which
  is exactly what steps 1–2 specify.
- **Channel events do NOT wake an idle session** (docs: notifications "queue into the session and are
  processed… on the next turn"). So **`read` fires on the peer's *next* turn, not on arrival.** For an
  actively-working peer, that's seconds; for a peer idle at the prompt, `read` waits until the user or
  a tool drives it. This is a real property of CC channels, not a defect of this design — and the
  receipt surfaces it honestly: `delivered` but not `read` = *the peer hasn't looked yet.*

### Design consequence to accept

Because channel events don't self-trigger a turn, the entire bus already has "delivered ≠ processed"
latency for idle peers — today that is **invisible** (client acks on emit, sender assumes success).
Tier-2 makes it **visible**. If a workflow needs a peer to act promptly on a message, that is an
orchestration concern (the peer must be actively looping, e.g. under `/loop` or a team), not
something the bus can force — but now the sender can *see* whether it landed on a looping peer or an
idle one.
- If CC ever exposes a per-channel-message receipt hook, swap step 2's trigger; the broker `/read`
  contract is unchanged.

## Receipt storage (bounded)

The `receipts: Map<id, Msg>` is capped (e.g. last 10k ids or 24 h, whichever first) so `/receipt`
lookups and the state machine don't leak memory. Aged-out ids return 404 on `/receipt` — the sender
already got the pushed frame; the pull endpoint is only a fallback for a sender that missed it.

## What the sender sees (summary)

| The sender wants to know | Answered by |
|--------------------------|-------------|
| Is anyone there to receive this? | `/send` response `state` (`queued_pending` = nobody) |
| Did it reach the right session? | Tier-1 receipt `acked` + `by_session` |
| Did the peer's model actually process it? | Tier-2 receipt `read` |
| Did it go to the WRONG session (old bug)? | Impossible (uniqueness) + `by_session` in receipt would reveal it |

This closes autopsy finding 03-1 (silent wrong-holder delivery) twice over: structurally
(uniqueness) and observably (receipts naming the consumer).
