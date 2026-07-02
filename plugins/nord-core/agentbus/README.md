# agentbus — peer message bus for Claude Code sessions

Let two or more running Claude Code sessions notify each other. Not orchestrator/worker —
**peer collaboration**: session A ships a tool and tells the others; session B hits a bug and
reports it back. Messages survive the recipient being busy, offline, or not yet started.

Built on Claude Code **channels** (research preview). Each session runs a small MCP "channel"
server (`agent-channel.ts`) that pushes peer messages into the session and exposes a
`send_message` tool. A standalone broker (`bus.ts`) routes and durably queues messages.

```
Session A ──send_message──▶ A client ──POST /send──▶ broker ──queue+SSE──▶ B client ──channel event──▶ Session B
```

**Opt-in, isolated.** This module is deliberately NOT wired into nord-core's always-on
`.mcp.json`. Channels are a preview feature requiring a launch flag, and the bus is a
prompt-injection surface (see Security) — you load it per project/session on purpose.

## Prerequisites

- Claude Code **v2.1.80+** (`claude --version`) — channels are gated on this.
- Anthropic auth via claude.ai or a Console API key. Channels do **not** work on Bedrock,
  Vertex, or Foundry.
- **Bun** (`bun --version`).
- Team/Enterprise orgs: an admin must have enabled channels. Pro/Max personal accounts are fine.

## Install

```bash
cd <this dir>
bun install
```

## Run the broker (once, independent of any session)

Manual:

```bash
bun bus.ts            # listens on 127.0.0.1:9000, inbox at ~/.agentbus/inbox.json
```

Or as a user systemd service (survives reboots):

```bash
mkdir -p ~/.config/systemd/user
cp agentbus.service ~/.config/systemd/user/agentbus.service   # check the ExecStart paths first
systemctl --user daemon-reload
systemctl --user enable --now agentbus.service
journalctl --user -u agentbus -f
```

Env: `AGENTBUS_HOME` (inbox dir, default `~/.agentbus`), `AGENTBUS_PORT` (default `9000`).

## Run peer sessions

Each session gets a unique `AGENT_ID` and must be launched with the dev-channels flag (custom
channels are off the allowlist during the preview). Point Claude Code at this module's
`.mcp.json`, or add the server to a project/user config with a **unique `AGENT_ID` per session**.

```bash
# Terminal 1 — broker (leave running)
bun bus.ts

# Terminal 2 — peer "toolmaker"
AGENT_ID=toolmaker claude --dangerously-load-development-channels server:agentbus

# Terminal 3 — peer "consumer"
AGENT_ID=consumer claude --dangerously-load-development-channels server:agentbus
```

On first run each session prompts to trust the new MCP server — select "Use this MCP server".
Run sessions in tmux/screen so they stay open to receive. Peer messages arrive as
`<channel source="agentbus" from="..." msg_id="...">` events.

## Tests

`bun e2e.ts` drives the **real** broker and the **real** `agent-channel.ts` as subprocesses and
asserts, deterministically and with no human in the loop:

- live delivery (directed), sender-exclusion
- reply path (symmetric)
- broadcast (`to` omitted) to all peers except sender
- offline durability (message pending for absent agent → real client redelivers + acks on connect)
- broker-restart durability (message survives on disk in `inbox.json` and in `/status`)
- `/status` endpoint shape

Not covered by the harness (inherently interactive — verify manually in two terminals): the
visible `<channel>` event rendering **inside** a live CC session. The harness proves the full
transport + durability path up to that render.

Inspect a running broker anytime: `curl -s localhost:9000/status`.

## Design decisions (do not "simplify" away)

- **Separate broker process, not in-process bridging.** Claude Code spawns each session's MCP
  server as its own stdio subprocess — two sessions loading the same file get isolated processes
  that cannot see each other's memory. Routing MUST go through a separate process.
- **Ack in the client, not the model.** The client acks as soon as the message is emitted into
  the session — deterministic, no reliance on Claude remembering an ack tool.
- **Keep-until-ack + redeliver-on-reconnect.** What makes a bug report survive an offline peer or
  a broker restart. Purge-on-send would drop exactly those messages.
- **Dedupe by `id` in the client** (`seen` set) — redelivery after a reconnect that races an
  in-flight ack is then harmless.
- **`127.0.0.1` bind, no auth** — acceptable only because it is localhost and you own both ends.

## Security

An ungated channel is a **prompt-injection vector**: anything posted to `/send` lands in a
peer session's context. Kept localhost-only and opt-in for that reason. If you ever bind beyond
`127.0.0.1`, add a sender allowlist to `/send` and `/subscribe` **before** anything else.

## Known limits

- **Crash window:** if the client dies between emitting the notification and posting the ack, the
  message redelivers on reconnect (good). If CC drops the notification after the ack, it is lost
  (rare). For stricter guarantees, move the ack to a model-called tool after Claude reads it.
- **`seen` grows unbounded** over a very long session — negligible; prune if a session runs days.
- **One session per `AGENT_ID`** — two sessions sharing an id clobber each other's subscription.
- **Auth boundary:** channels require claude.ai/Console auth. A local-inference-only session
  cannot use this bus; use a `tmux send-keys` relay for those.
