# agentbus v2 — redesign spec & implementation plan (2026-07-19)

Forward design for the nord-core agentbus, driven by the autopsy
(`../autopsy/`). Fixes the identity/lifecycle/observability failures while keeping
the transport layer that already works.

## Goals (from the autopsy + operator requirements)

1. **Identity is unambiguous.** A message addressed to a peer reaches the session the sender means —
   or fails loudly. No silent wrong-session delivery. *(autopsy 02, 03)*
2. **No zombies.** When a session closes, it leaves the bus — automatically. A lingering client
   process cannot keep squatting a name. *(operator req 1; autopsy 02-2b)*
3. **Observable.** The user can list open peers with enough detail to spot and kill a straggler; a
   peer can see who else is present. *(operator req 2, 3; autopsy 04)*
4. **Delivery is verifiable end-to-end.** A sender learns whether its message reached the target —
   and *which session* consumed it. *(operator req 4; autopsy 03-1)*
5. **Bounded.** No unbounded ghost inboxes; broadcast targets live peers only. *(autopsy 04)*

## Non-goals

- Rewriting the transport (SSE + heartbeat + idle-watchdog + durable inbox). It works; it stays.
- Model-confirmed read receipts (L3). Deterministic client-ack (L2) is the guarantee; L3 is
  best-effort only, because model-cooperation is exactly what the original design correctly avoided.
- Multi-host / off-loopback operation. Still `127.0.0.1`-only.

## What stays vs changes

| Component | Verdict | Action |
|-----------|---------|--------|
| SSE transport, heartbeat, idle-watchdog | Sound | **Keep** |
| Durable `inbox.json` + seq high-water | Sound | **Keep** (re-key by session; migrate format) |
| Broker identity maps (`sessions`/`nameOwner`/`sessionNames`) | Broken | **Rewrite** — session-keyed, uniqueness-enforced |
| Client lifecycle (pump decoupled from stdio) | Root of zombies | **Rewrite** — bind to stdio; self-deregister |
| `agentbus-name.cjs` hook | Collision factory | **Rewrite** — unique names |
| Receipts | Absent | **Add** |
| Presence / kill / GC | Absent | **Add** |
| Per-model classifier-style fail-close band-aids in `bus.ts` (`48fd92c` war-guard) | Workaround | **Delete** once session-keying lands |

## Reading order

| # | Doc | Contents |
|---|-----|----------|
| 01 | `01_identity_data_model.md` | Session-sole-key identity, uniqueness rule, data structures, inbox re-keying, name-pending TTL |
| 02 | `02_lifecycle.md` | Connect/drop/grace/reconnect/close/GC state machine; how zombies are eliminated (and the honest limit) |
| 03 | `03_endpoints.md` | Full HTTP contract for every endpoint (params, bodies, responses, errors) |
| 04 | `04_receipts.md` | Message state machine, receipt push+pull, `acked_by_session`, client render, squatter-visibility |
| 05 | `05_presence_ops.md` | `/status` shape, `list_peers`, `/kill`, the `agentbus` CLI |
| 06 | `06_migration.md` | Phased rollout under version skew; `strict_identity` flag; data migration; fleet drain |
| 07 | `07_implementation_plan.md` | Phases, files touched, deterministic gates, test additions |

## The one honest limit stated upfront

The broker **cannot autonomously distinguish a zombie client process from a live session** — both
send heartbeats over the same SSE. Zombie elimination therefore lives in the **client** (self-exit on
stdio-close) plus a **SessionEnd hook**, with the broker providing the **kill lever** and the
**presence detail** to catch stragglers. Any design that claims the broker alone can GC zombies is
lying; this one doesn't.
