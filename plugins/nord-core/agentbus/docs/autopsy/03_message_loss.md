# 03 — Message loss vs the durability claim

## The claim

README line 5: *"Messages survive the recipient being busy, offline, or not yet started."*
README "Design decisions": *"Keep-until-ack + redeliver-on-reconnect… Purge-on-send would drop
exactly those messages."* README "Known limits" lists exactly one loss window (the crash window)
and calls it "rare."

The keep-until-ack machinery is real and correct (`bus.ts:78-83`, purge only on `/ack`
`bus.ts:182-193`). But the durability guarantee is **conditional on the ack coming from the
intended session**, and there are three ways it doesn't.

## Loss mode 1 — wrong-holder ack (CRITICAL, unfixed)

**Where**: `agent-channel.ts:207-211` (ack is deterministic on emit) × `bus.ts:78-83` (deliver to
whatever `nameOwner` points at).

The client acks the moment it emits the notification, **regardless of whether the receiving session
is the intended one or even alive to a human**. When a name is held by the wrong session (squatter,
02-2b) or a transiently-winning war copy (02-2a), the message is delivered there, acked, and purged
from `inbox`. `pending` shows 0. To every observer — sender, `/status`, the durability layer — the
message was "delivered." It was delivered to a void.

This is the precise failure that produced the 2026-07-18 outage: `dev→instructor` messages showed
`live=[taxgraph-instructor]` in the broker log and `pending: 0` in `/status`, while the human
instructor saw nothing. Durability worked perfectly; it just durably delivered to the wrong session.

**Severity: CRITICAL.** It is silent (no error, `pending` stays 0), it is data loss, and it triggers
under the system's most common identity event (a fork). No code detects it.

## Loss mode 2 — seq/`seen` ack-and-skip (HIGH, mitigated not eliminated)

**Where**: `agent-channel.ts:205` `if (seen.has(m.id)) { await ack(m.id); continue }` ×
`bus.ts:52-56` (seq init).

The client skips-and-acks any id already in its in-memory `seen` set. If the broker ever issues an
id a long-lived client has already seen, that message is silently dropped. The git history shows
this already bit once (`6ae1220 fix(agentbus): persist message-id seq across restarts`): before the
`seq` high-water file, a broker restart reset `seq` below live clients' `seen` high-water, and fresh
messages reused old ids → skipped. The fix (`bus.ts:52-56`, load `max(inbox ids, SEQ_FILE)`) closes
the restart case.

Residual risk: `seen` is **per-process and unbounded** (README "Known limits" admits it grows
unbounded; `agent-channel.ts:124`). A client process can outlive many broker restarts. The high-water
file makes seq monotonic *as long as the SEQ_FILE survives and is writable* — an `AGENTBUS_HOME` on a
volume that is wiped, or a permissions error on `persist()` (`bus.ts:58-61`, failures are not
surfaced), reopens the exact hole `6ae1220` closed. Not currently triggering (SEQ_FILE = 3731 > all
observed ids), but the mitigation is a single file away from failing silently.

**Severity: HIGH, latent.**

## Loss mode 3 — the crash window (LOW, acknowledged)

**Where**: README "Known limits"; `agent-channel.ts:207-211` ordering.

If CC drops the notification *after* the client posts the ack, the message is lost. The README
states this honestly and it is genuinely rare (the ack immediately follows the emit). No dispute.

## What the durability layer actually guarantees

Restated honestly, stripped of the identity assumption the README quietly makes:

> A message is durably held until *some* client that currently owns its target **name** acks it.
> If that owner is the session the sender intended, the guarantee is real. If the name has been
> claimed by another session — which a fork, a shared branch, or a shared project directory will
> cause — the message is durably delivered to the wrong place and then purged.

The durability is not the weak link. The durability is *strong*, which is precisely why loss mode 1
is so damaging: the system commits (persists, delivers, acks, purges) to a delivery that never
reached a reader, and leaves no trace that it happened.
