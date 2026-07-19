# 01 — Anatomy: how the transport actually works

Read from code, not the README. The system has three moving parts and one environmental fact
(version skew) that changes the meaning of all three.

## The three parts

### Broker — `bus.ts` (one process, `127.0.0.1:9000`)

A single Bun HTTP server, hardcoded to loopback (`bus.ts:87` `hostname: '127.0.0.1'`), with five
endpoints: `/subscribe` (SSE), `/send`, `/ack`, `/rename`, `/status`. State:

- `inbox: Record<string, Msg[]>` — per-**name** durable queue, persisted to `~/.agentbus/inbox.json`
  (`bus.ts:30`). This is the source of durability.
- `sessions: Map<sessionKey, {emit, closer, since}>` — live SSE transports (`bus.ts:37`).
- `sessionNames: Map<sessionKey, Set<name>>` — every alias a session has announced (`bus.ts:41`).
- `nameOwner: Map<name, sessionKey>` — resolves a send target name → owning session (`bus.ts:43`).
- `seq` — a monotonic message id, persisted to a `seq` high-water file so it cannot regress across
  restarts (`bus.ts:52-56`, added in `6ae1220`).

Delivery is keep-until-ack: `deliver()` (`bus.ts:78-83`) pushes every unacked message for a name to
its owning session's live `emit`; nothing is purged until the client posts `/ack` (`bus.ts:182-193`).
A message queued while the target is offline sits in `inbox[name]` and is redelivered on reconnect
(`bus.ts:145`).

### Client — `agent-channel.ts` (one MCP stdio process per session)

Registered in `.mcp.json` as server `agentbus` (`.mcp.json:13-21`), launched by Claude Code as a
stdio subprocess. It:

1. Resolves its identity (`resolveId()`), subscribes to `/subscribe?agent=<name>`, and pumps SSE
   frames into the session as `notifications/claude/channel` events.
2. **Acks each message the instant it emits the notification** (`agent-channel.ts:207-211`,
   marketplace numbering) — deterministic, no reliance on the model to ack.
3. Dedupes by id via an in-memory `seen` set (`:205`): a redelivered id is acked-and-skipped.
4. Watches its name-file every 3 s and, on change, `/rename`s and re-subscribes (`:145-147`).
5. Exposes `send_message` and `list_peers` tools; `/send` echoes the outbound back into the session.

### Identity source — `agentbus-name.cjs` (SessionStart hook)

Runs at session start (`hooks.json:25-28`), derives a name, writes it to
`/tmp/agentbus-name-<session_id>`, and sets the CC session title. The client reads that file as its
primary identity source. `/busname` (skill) writes the same file to rename mid-session.

## The data path (what the README diagram gets right)

```
send_message tool → client POST /send → broker: inbox[to].push + deliver()
                                                   → owning session's SSE emit
                                                   → client notification → session render → client /ack → purge
```

The transport itself is sound: SSE with heartbeats (`bus.ts:143`), an idle-watchdog on the client
that races `reader.read()` against a timeout to defeat Bun's non-rejecting reads
(`agent-channel.ts:190`, from `e3f5eec`), and durable on-disk queues. The wedge and self-heal bugs
in the git history (`2509b3b`, `e27b3a6`, `e3f5eec`, `1277d1e`) are genuinely fixed at the transport
level.

## The environmental fact that reframes everything: version skew

The broker is the **marketplace** copy (session-centric identity, HEAD). The processes actually
serving the live fleet are the **`1.4.0` cache** copy:

```
# running agent-channel.ts processes, by source path
5 × …/cache/nord/nord-core/1.4.0/agentbus/agent-channel.ts
```

The two copies differ in one decisive line:

| | subscribe call | consequence at broker |
|---|---|---|
| marketplace client | `/subscribe?agent=<name>&session=<uuid>` (`agent-channel.ts:185-186`) | `sessionKey = uuid` — name and transport are decoupled; the identity model works |
| **1.4.0 client (live)** | `/subscribe?agent=<name>` — **no `session=`** (`1.4.0/agent-channel.ts:182`) | `sessionKey = name` (`bus.ts:98` `?? name`) — name **is** the transport |

The broker's entire session-centric identity design (`a4f409d`, the header comment at `bus.ts:5-13`
promising names survive reconnect/rename across one session) is **conditional on the client sending
`session=`**. The live fleet's client does not. So for the fleet, the broker silently degrades to
the legacy "name == transport" model — the exact model the design was written to replace.

This is not a bug in either file. It is a deployment reality: sessions pin whatever plugin version
was active at launch (`.mcp.json` resolves `${CLAUDE_PLUGIN_ROOT}` per session), and the long-lived
fleet sessions launched under 1.4.0. **Every finding in 02 and 03 follows from this skew plus the
identity-derivation logic.**
