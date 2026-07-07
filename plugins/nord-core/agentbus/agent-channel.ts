#!/usr/bin/env bun
// Per-session channel client. Identity comes from AGENT_ID. Pushes peer messages into
// the session as <channel> events and acks them deterministically once emitted (no reliance
// on the model to ack). Exposes send_message for outbound.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const AGENT_ID = process.env.AGENT_ID ?? 'agent'
const BUS = process.env.BUS_URL ?? 'http://localhost:9000'
// If no bytes (not even a heartbeat) arrive within this window, the stream is dead —
// abort and reconnect. Must exceed the broker's heartbeat interval (default 15s).
const IDLE_MS = Number(process.env.AGENTBUS_IDLE_MS ?? 40000)

const mcp = new Server(
  { name: 'agentbus', version: '0.1.0' },
  {
    capabilities: { experimental: { 'claude/channel': {} }, tools: {} },
    instructions:
      `You are "${AGENT_ID}", one of several peer Claude Code sessions sharing a message bus. ` +
      `Peer messages arrive as <channel source="agentbus" from="..." msg_id="..."> tags. A peer may be ` +
      `announcing a tool or feature they shipped, or reporting a bug in something you maintain. ` +
      `Read it and act if it concerns you. To reach a peer, call send_message with their id in "to" ` +
      `(omit "to" to broadcast to all peers). Do not reply unless you have something substantive to send.`,
  },
)

// Outbound tool: Claude calls this to message a peer.
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'send_message',
    description: 'Send a message to a peer Claude Code session over the shared bus.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Target peer id. Omit to broadcast to all peers.' },
        text: { type: 'string', description: 'Message body.' },
      },
      required: ['text'],
    },
  }],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'send_message') {
    const { to, text } = req.params.arguments as { to?: string; text: string }
    const res = await fetch(`${BUS}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: AGENT_ID, to, text }),
    }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))
    return { content: [{ type: 'text', text: JSON.stringify(res) }] }
  }
  throw new Error(`unknown tool: ${req.params.name}`)
})

await mcp.connect(new StdioServerTransport())

// Inbound: subscribe to the bus, push each message into the session, ack it.
const seen = new Set<number>() // dedupe redelivered messages within this session

async function ack(id: number) {
  try {
    await fetch(`${BUS}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: AGENT_ID, id }),
    })
  } catch {}
}

async function pump() {
  for (;;) {
    // Idle watchdog: if no bytes (not even a heartbeat) arrive within IDLE_MS the stream is
    // dead — force the loop to reconnect. Bun's reader.read() does NOT reliably reject when the
    // fetch signal aborts, so we cannot rely on ctrl.abort() alone: we RACE each read against an
    // idle promise and explicitly cancel the reader, guaranteeing the loop breaks and re-subscribes.
    const ctrl = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let idle: ReturnType<typeof setTimeout> | undefined
    let onIdle: () => void = () => {}
    const idlePromise: Promise<'idle'> = new Promise(res => { onIdle = () => res('idle') })
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => { ctrl.abort(); onIdle() }, IDLE_MS) }
    try {
      arm()
      const res = await fetch(`${BUS}/subscribe?agent=${encodeURIComponent(AGENT_ID)}`, { signal: ctrl.signal })
      if (!res.body) throw new Error('no response body')
      reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const r = await Promise.race([reader.read(), idlePromise])
        if (r === 'idle') throw new Error('idle timeout') // hung/dead stream — reconnect
        const { value, done } = r
        if (done) break
        arm() // any data (message or heartbeat) proves the stream is alive
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const line = frame.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          let m: { id: number; from: string; text: string; ts: number }
          try { m = JSON.parse(line.slice(6)) } catch { continue }
          if (seen.has(m.id)) { await ack(m.id); continue } // duplicate: ack and skip
          seen.add(m.id)
          await mcp.notification({
            method: 'notifications/claude/channel',
            params: { content: m.text, meta: { from: m.from, msg_id: String(m.id) } },
          })
          await ack(m.id) // deterministic: the message is now in the session
        }
      }
    } catch {}
    clearTimeout(idle)
    try { await reader?.cancel() } catch {} // free the socket so it can't linger half-open
    await new Promise(r => setTimeout(r, 1000)) // reconnect backoff
  }
}

pump()
