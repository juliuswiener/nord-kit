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
const SEQ_FILE = join(DIR, 'seq') // persistent id high-water-mark (see below)
const PORT = Number(process.env.AGENTBUS_PORT ?? 9000)
const HEARTBEAT_MS = Number(process.env.AGENTBUS_HEARTBEAT_MS ?? 15000)
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })

// inbox[agent] holds messages not yet acked by that agent. This is the durable state.
const inbox: Record<string, Msg[]> = existsSync(FILE)
  ? JSON.parse(await Bun.file(FILE).text())
  : {}
const clients = new Map<string, (d: string) => void>()
const closers = new Map<string, () => void>()
// seq must be MONOTONIC ACROSS RESTARTS. Deriving it only from the inbox lets it regress
// after a restart (acked messages are gone from the inbox), so a fresh message can reuse an
// id a long-lived channel already has in its dedup `seen` set — that message is then silently
// skipped-and-acked, never shown. Persist a high-water-mark and load the max of it + the inbox.
let seq = Math.max(
  0,
  ...Object.values(inbox).flat().map(m => m.id),
  existsSync(SEQ_FILE) ? Number((await Bun.file(SEQ_FILE).text()).trim()) || 0 : 0,
)

const persist = async () => {
  await Bun.write(FILE, JSON.stringify(inbox, null, 2))
  await Bun.write(SEQ_FILE, String(seq)) // advance the high-water-mark with the inbox
}

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
          // A new subscribe for an agent that's already registered supersedes it: force-close
          // the old stream so it can't linger as a zombie (still heartbeating, no longer routed
          // to) after the Map entry moves on — this is what let a superseded-but-alive client
          // silently stop receiving messages once its successor also died.
          closers.get(agent)?.()
          ctrl.enqueue(': connected\n\n')
          const emit = (d: string) => { try { ctrl.enqueue(`data: ${d}\n\n`) } catch (e) { console.error(`DEBUG emit-throw agent=${agent}`, e) } }
          clients.set(agent, emit)
          console.error(`DEBUG registered agent=${agent} total=${clients.size}`)
          const drop = () => {
            clearInterval(hb)
            console.error(`DEBUG drop-fired agent=${agent} stillCurrent=${clients.get(agent) === emit}`)
            if (clients.get(agent) === emit) { clients.delete(agent); closers.delete(agent) } // don't clobber a newer reconnect
            try { ctrl.close() } catch {}
          }
          closers.set(agent, drop)
          // Heartbeat comment-frames so an idle client can detect a dead stream (broker
          // restart, half-open TCP) via its watchdog and reconnect instead of wedging.
          // A throwing enqueue means the consumer is gone: self-clean so /status stays honest
          // and dead ghosts don't accumulate (Bun's req.signal abort is not always reliable).
          const hb = setInterval(() => {
            try { ctrl.enqueue(': ping\n\n') } catch { drop() }
          }, HEARTBEAT_MS)
          req.signal.addEventListener('abort', drop)
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
      const body = await req.json() as Record<string, unknown>
      // Permissive like the ORIGINAL broker: never reject a send. Accept any historical text field
      // name, coerce to a string so text.length can never crash (that was the only real bug — a
      // 500 HTML page that broke the JSON client), and default from. A missing/empty body just
      // becomes an empty message. If nothing text-like is present, log the keys to catch a client
      // using yet another field name — but still deliver.
      const from = typeof body.from === 'string' ? body.from : 'unknown'
      const to = typeof body.to === 'string' ? body.to : undefined
      const raw = body.text ?? body.message ?? body.content ?? body.body ?? ''
      const text = typeof raw === 'string' ? raw : String(raw ?? '')
      if (!text) console.error(`SEND empty-text from=${from} to=${to ?? '(broadcast)'} keys=[${Object.keys(body).join(', ')}]`)
      const peers = new Set([...clients.keys(), ...Object.keys(inbox)])
      const targets = (to ? [to] : [...peers]).filter(a => a && a !== from)
      const live = targets.filter(t => clients.has(t))    // connected now → delivered instantly
      const queued = targets.filter(t => !clients.has(t)) // offline (waits) OR mistyped id (blackhole)
      for (const t of targets) (inbox[t] ??= []).push({ id: ++seq, from, text, ts: Date.now() })
      await persist()
      for (const t of targets) deliver(t) // deliver live if connected; else it waits in the inbox
      // Message trail to journald (journalctl --user -u agentbus | grep SEND). A DIRECTED send to
      // an id that isn't currently connected is the typo signature — it queues forever into an
      // inbox nobody reads. WARN on it so a mistyped target id is visible, not a silent blackhole.
      const preview = text.length > 80 ? text.slice(0, 80) + '…' : text
      if (to && !clients.has(to))
        console.error(`SEND ${from} -> ${to} QUEUED (target NOT connected — typo or offline?) connected=[${[...clients.keys()].join(', ')}] "${preview}"`)
      else
        console.error(`SEND ${from} -> ${to ?? '(broadcast)'} live=[${live.join(', ')}]${queued.length ? ` queued=[${queued.join(', ')}]` : ''} "${preview}"`)
      return Response.json({ ok: true, delivered_to: targets, live, queued })
    }

    // A channel client posts here once a message is in its session, so it can be dropped.
    if (url.pathname === '/ack' && req.method === 'POST') {
      const { agent, id } = await req.json() as { agent: string; id: number }
      if (inbox[agent]) inbox[agent] = inbox[agent].filter(m => m.id !== id)
      await persist()
      return Response.json({ ok: true })
    }

    // Rename an agent's bus identity: carry its queued inbox to the new id and drop the
    // old subscription so the channel re-subscribes as `to`. Called by the channel when its
    // name-file changes (SessionStart hook / /busname). Idempotent-ish: unknown `from` just
    // migrates nothing.
    if (url.pathname === '/rename' && req.method === 'POST') {
      const { from, to } = await req.json() as { from: string; to: string }
      if (!from || !to || from === to)
        return Response.json({ ok: false, error: 'from/to required and distinct' }, { status: 400 })
      const carried = inbox[from]?.length ?? 0
      if (carried) (inbox[to] ??= []).push(...inbox[from])
      delete inbox[from]
      await persist()
      closers.get(from)?.() // drop the old stream so the channel reconnects under `to`
      console.error(`RENAME ${from} -> ${to} (carried ${carried} pending)`)
      if (clients.has(to)) deliver(to) // if `to` is already live, flush the carried queue now
      return Response.json({ ok: true, migrated: carried })
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
