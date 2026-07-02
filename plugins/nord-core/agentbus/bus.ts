#!/usr/bin/env bun
// agentbus broker — routes peer messages between Claude Code sessions and durably
// queues undelivered ones. Standalone, long-lived, independent of any session.
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

type Msg = { id: number; from: string; text: string; ts: number }

// Absolute, env-driven so a systemd service and a manual run agree on the same inbox
// regardless of cwd. (The handover's './.agentbus' is cwd-relative and would split state.)
const DIR = process.env.AGENTBUS_HOME ?? join(homedir(), '.agentbus')
const FILE = join(DIR, 'inbox.json')
const PORT = Number(process.env.AGENTBUS_PORT ?? 9000)
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })

// inbox[agent] holds messages not yet acked by that agent. This is the durable state.
const inbox: Record<string, Msg[]> = existsSync(FILE)
  ? JSON.parse(await Bun.file(FILE).text())
  : {}
const clients = new Map<string, (d: string) => void>()
let seq = Math.max(0, ...Object.values(inbox).flat().map(m => m.id))

const persist = () => Bun.write(FILE, JSON.stringify(inbox, null, 2))

// Push every unacked message for an agent down its live SSE stream. No purge here:
// messages are removed only when the client acks, so a crash before processing redelivers.
function deliver(agent: string) {
  const emit = clients.get(agent)
  const q = inbox[agent]
  if (!emit || !q?.length) return
  for (const m of q) emit(JSON.stringify(m))
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1', // localhost only: nothing off this machine can inject
  idleTimeout: 0,        // keep SSE streams open indefinitely
  async fetch(req) {
    const url = new URL(req.url)

    // A channel client subscribes here to receive messages for its agent id.
    if (url.pathname === '/subscribe') {
      const agent = url.searchParams.get('agent')
      if (!agent) return new Response('agent required', { status: 400 })
      return new Response(new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(': connected\n\n')
          clients.set(agent, d => { try { ctrl.enqueue(`data: ${d}\n\n`) } catch {} })
          req.signal.addEventListener('abort', () => clients.delete(agent))
          deliver(agent) // redeliver anything queued while the agent was away
        },
      }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // A channel client posts here when its session wants to message a peer.
    if (url.pathname === '/send' && req.method === 'POST') {
      const { from, to, text } = await req.json() as { from: string; to?: string; text: string }
      const peers = new Set([...clients.keys(), ...Object.keys(inbox)])
      const targets = (to ? [to] : [...peers]).filter(a => a && a !== from)
      for (const t of targets) (inbox[t] ??= []).push({ id: ++seq, from, text, ts: Date.now() })
      await persist()
      for (const t of targets) deliver(t) // deliver live if connected; else it waits in the inbox
      return Response.json({ ok: true, delivered_to: targets })
    }

    // A channel client posts here once a message is in its session, so it can be dropped.
    if (url.pathname === '/ack' && req.method === 'POST') {
      const { agent, id } = await req.json() as { agent: string; id: number }
      if (inbox[agent]) inbox[agent] = inbox[agent].filter(m => m.id !== id)
      await persist()
      return Response.json({ ok: true })
    }

    // Inspection: who is connected and how many messages are pending per agent.
    if (url.pathname === '/status') {
      const pending = Object.fromEntries(Object.entries(inbox).map(([a, q]) => [a, q.length]))
      return Response.json({ connected: [...clients.keys()], pending })
    }

    return new Response('not found', { status: 404 })
  },
})

console.error(`agentbus broker listening on http://127.0.0.1:${PORT}  (inbox: ${FILE})`)
