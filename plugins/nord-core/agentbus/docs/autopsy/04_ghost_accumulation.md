# 04 — Ghost accumulation & broadcast amplification

## The empirical state (live `/status`, 2026-07-19 11:19)

```
total peer records:            70
connected (live):               5
dead-but-pending ghost inboxes: 62   (holding 1041 undeliverable messages)
literal ${AGENT_ID} ghost:      present
duplicate live name:            3 procs named "main"
top ghost inboxes: gplan=28, smoke=27, agent=27, diag=27, julius-test=27, debugtest1=26
```

70 names have registered over the broker's lifetime; 5 are alive. The other 65 are debris — dead
sessions, test runs (`smoke`, `diag`, `julius-test`, `debugtest1`, `__seqcheck__`, `__vchk__`,
`__t__`), the launch-quoting ghost `${AGENT_ID}`, and project/branch-derived collisions
(02, mechanism 1). 62 of them hold 1041 messages that will never be delivered because their target
session is gone forever.

## No garbage collection exists

**Status in code**: CONFIRMED absence.

- `inbox` is only ever pruned by `/ack` (`bus.ts:189-190`). A name with no live session never acks,
  so its queue is immortal. `persist()` (`bus.ts:58-61`) rewrites the **entire** `inbox.json` on
  every send — so the file grows monotonically and every write re-serializes all 1041 dead messages.
- `sessionNames` and `nameOwner` are only ever added to (`bus.ts:124-127`) and are cleared **only on
  broker restart** (in-memory, per the comment at `bus.ts:38-41`). There is no TTL, no LRU, no
  "evict names idle > N days," no cap.
- The dedup `regTimes` map (`bus.ts:47`) self-trims to a 5 s window, but that is the only bounded
  structure. Everything identity-related grows without bound until a manual broker restart wipes the
  in-memory half (the on-disk `inbox.json` survives the restart and reloads all ghosts —
  `bus.ts:30-32`).

`/status` reconstructs orphan inbox entries explicitly (`bus.ts:229-231`), so the ghost list is not
a display artifact — it is the real routable state. A `send` to any of those 62 names is accepted
and queued (`bus.ts:164` includes `Object.keys(inbox)` in the broadcast peer set).

## Broadcast is O(all-names-ever) and amplifies the debris

**Where**: `bus.ts:163-168`.

```js
const peers = new Set([...nameOwner.keys(), ...Object.keys(inbox)])  // every name ever seen
const targets = (to ? [to] : [...peers]).filter(a => a && a !== from)
for (const t of targets) (inbox[t] ??= []).push({ id: ++seq, from, text, ts: Date.now() })
```

A broadcast (send with no `to`) queues a copy into **every** name — all 62 ghosts included. Observed
directly: the two maintenance broadcasts sent during this session each reported `delivered_to` of ~68
names with `live` of 4 and `queued` of ~64. Each broadcast therefore *adds* ~62 permanently-stuck
messages to `inbox.json` and bumps every ghost's pending count. The `gplan=28 / smoke=27` counts are
broadcast sediment: those sessions died long ago but still accrue a copy of every subsequent
broadcast.

This is a positive-feedback loop: more broadcasts → more per-ghost debris → larger `inbox.json` →
every `persist()` (once per send, `bus.ts:169`) rewrites a larger file. At 1041 messages it is
harmless in bytes; the concern is architectural, not yet operational — there is no mechanism that
ever makes it smaller except `rm ~/.agentbus/inbox.json` + restart.

## Severity

**MEDIUM.** Not currently a functional failure (the live path still works), but: (1) it inflates
every broadcast's fan-out and every disk write unboundedly; (2) it makes `/status` and `list_peers`
near-useless for their stated purpose — "verify a target id before send_message"
(`agent-channel.ts:77-80`) — because 65 of 70 listed ids are dead, and nothing distinguishes a dead
ghost from a live peer except the `connected` boolean the model must remember to check; (3) it means
the `${AGENT_ID}` and `agent` fallbacks act as permanent blackhole sinks for any mis-launched session.

## Fix shape

A name idle (no live session) for longer than a TTL should have its inbox and registry entries
dropped; broadcast should target only `nameOwner` entries with a live session, never the full
`inbox` keyset. Both are small, localized changes to `bus.ts` (the broadcast peer set at `:164` and
a periodic sweep over `inbox`/`sessionNames`).
