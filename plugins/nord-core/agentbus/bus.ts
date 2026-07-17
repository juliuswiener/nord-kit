#!/usr/bin/env bun
// agentbus broker — routes peer messages between Claude Code sessions and durably
// queues undelivered ones. Standalone, long-lived, independent of any session.
//
// Identity model (session-centric). A channel subscribes with a STABLE `session`
// key (its CLAUDE_CODE_SESSION_ID) plus its current `agent` NAME. The broker tracks
//   session  -> current live SSE emit
//   name     -> owning session
// so EVERY name a session ever announces resolves to that session's CURRENT live
// transport for as long as the session lives — surviving SSE reconnects AND renames
// (main -> claude-bridge). A peer addressing any once-announced name lands live, not
// in a blackhole. Legacy channels that omit `session` still work: the name is its own
// session key (name == transport, the old behaviour).
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

// inbox[name] holds messages not yet acked for that NAME. Durable state (persisted).
const inbox: Record<string, Msg[]> = existsSync(FILE)
  ? JSON.parse(await Bun.file(FILE).text())
  : {}

// Live sessions: sessionKey -> its current SSE emit + closer. Removed when the stream
// drops (and no newer stream has already superseded it).
type Session = { emit: (d: string) => void; closer: () => void; since: number }
const sessions = new Map<string, Session>()
// Every name a session has announced. Persists across SSE reconnects (in-memory,
// cleared only on broker restart) so a reconnecting session reclaims ALL its aliases.
// This is the "alias set" — bounded, in-memory, per the within-session-lifetime scope.
const sessionNames = new Map<string, Set<string>>()
// name -> owning sessionKey (last live claimer wins). Resolves a send target -> session.
const nameOwner = new Map<string, string>()
// Recent registration timestamps per NAME, to detect two DISTINCT sessions fighting for
// the same name (a real collision) — a single session reconnecting under its own key is
// handled by supersede and is not a flap.
const regTimes = new Map<string, number[]>()
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

// The live emit currently owning `name`, or undefined when its session is offline.
function emitFor(name: string): ((d: string) => void) | undefined {
  const sk = nameOwner.get(name)
  return sk ? sessions.get(sk)?.emit : undefined
}

// All names owned by a LIVE session (drives the legacy `connected` list + logs).
function liveNames(): string[] {
  const out: string[] = []
  for (const [name, sk] of nameOwner) if (sessions.has(sk)) out.push(name)
  return out
}

// Push every unacked message for a NAME down its owning session's live stream. No purge
// here: messages are removed only when the client acks, so a crash before processing redelivers.
function deliver(name: string) {
  const emit = emitFor(name)
  const q = inbox[name]
  if (!emit || !q?.length) return
  for (const m of q) emit(JSON.stringify(m))
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1', // localhost only: nothing off this machine can inject
  idleTimeout: 0,        // keep SSE streams open indefinitely
  async fetch(req) {
    const url = new URL(req.url)

    // A channel client subscribes here to receive messages for its session/name.
    if (url.pathname === '/subscribe') {
      const name = url.searchParams.get('agent')
      if (!name) return new Response('agent required', { status: 400 })
      // Stable session key ties every name this session announces to one live transport.
      // Legacy channels omit it -> the name is its own session (name == transport).
      const sessionKey = url.searchParams.get('session') || name
      return new Response(new ReadableStream({
        start(ctrl) {
          const nowMs = Date.now()
          const recent = (regTimes.get(name) ?? []).filter(t => nowMs - t < 5000)
          recent.push(nowMs)
          regTimes.set(name, recent)
          // Flap guard: a DIFFERENT session rapidly claiming a name a live session already
          // owns = two sessions fighting for one name. Reject the newcomer, keep the incumbent
          // (operator should rename the duplicate or address it by its session id, always unique).
          // A session reconnecting under its OWN key is not a flap (supersede handles it below).
          const owner = nameOwner.get(name)
          if (recent.length > 4 && owner && owner !== sessionKey && sessions.has(owner)) {
            console.error(`FLAP name=${name} session=${sessionKey}: ${recent.length} claims/5s vs live owner ${owner} — rejecting duplicate`)
            try { ctrl.enqueue(': duplicate-id\n\n'); ctrl.close() } catch {}
            return
          }
          // Supersede an older live stream of THIS SAME session (a reconnect) so it can't
          // linger as a zombie (still heartbeating, no longer routed to).
          const priorSince = sessions.get(sessionKey)?.since
          sessions.get(sessionKey)?.closer()

          ctrl.enqueue(': connected\n\n')
          const emit = (d: string) => { try { ctrl.enqueue(`data: ${d}\n\n`) } catch (e) { console.error(`DEBUG emit-throw name=${name} session=${sessionKey}`, e) } }

          // Record + (re)claim every alias this session has announced onto this live stream.
          const names = sessionNames.get(sessionKey) ?? new Set<string>()
          names.add(name)
          sessionNames.set(sessionKey, names)
          for (const nm of names) nameOwner.set(nm, sessionKey)

          const drop = () => {
            clearInterval(hb)
            // Only drop the LIVE record if this is still the current stream for the session
            // (never clobber a newer reconnect). Keep sessionNames + nameOwner so the reconnect
            // reclaims its aliases — the name still resolves to this session while it lives.
            if (sessions.get(sessionKey)?.emit === emit) sessions.delete(sessionKey)
            try { ctrl.close() } catch {}
          }
          sessions.set(sessionKey, { emit, closer: drop, since: priorSince ?? nowMs })
          console.error(`DEBUG registered name=${name} session=${sessionKey} aliases=[${[...names].join(',')}] live=${sessions.size}`)

          // Heartbeat comment-frames so an idle client can detect a dead stream (broker restart,
          // half-open TCP) via its watchdog and reconnect. A throwing enqueue means the consumer
          // is gone: self-clean so /status stays honest and dead ghosts don't accumulate.
          const hb = setInterval(() => { try { ctrl.enqueue(': ping\n\n') } catch { drop() } }, HEARTBEAT_MS)
          req.signal.addEventListener('abort', drop)
          for (const nm of names) deliver(nm) // redeliver anything queued to any of my aliases
        },
      }), {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      })
    }

    // A channel client posts here when its session wants to message a peer.
    if (url.pathname === '/send' && req.method === 'POST') {
      const body = await req.json() as Record<string, unknown>
      // Permissive: never reject a send. Accept any historical text field name, coerce to a
      // string so text.length can never crash, and default from. If nothing text-like is
      // present, log the keys to catch a client using yet another field name — but still deliver.
      const from = typeof body.from === 'string' ? body.from : 'unknown'
      const to = typeof body.to === 'string' ? body.to : undefined
      const raw = body.text ?? body.message ?? body.content ?? body.body ?? ''
      const text = typeof raw === 'string' ? raw : String(raw ?? '')
      if (!text) console.error(`SEND empty-text from=${from} to=${to ?? '(broadcast)'} keys=[${Object.keys(body).join(', ')}]`)
      // Broadcast reaches every known peer name (announced names + any queued inbox name).
      const peers = new Set([...nameOwner.keys(), ...Object.keys(inbox)])
      const targets = (to ? [to] : [...peers]).filter(a => a && a !== from)
      const live = targets.filter(t => emitFor(t))    // owning session connected now → instant
      const queued = targets.filter(t => !emitFor(t)) // offline (waits) OR mistyped id (blackhole)
      for (const t of targets) (inbox[t] ??= []).push({ id: ++seq, from, text, ts: Date.now() })
      await persist()
      for (const t of targets) deliver(t) // deliver live if the owning session is connected
      // Message trail to journald. A DIRECTED send to a name no live session owns is the typo
      // signature — it queues into an inbox nobody reads. WARN so it is visible, not silent.
      const preview = text.length > 80 ? text.slice(0, 80) + '…' : text
      if (to && !emitFor(to))
        console.error(`SEND ${from} -> ${to} QUEUED (target not connected — typo or offline?) live=[${liveNames().join(', ')}] "${preview}"`)
      else
        console.error(`SEND ${from} -> ${to ?? '(broadcast)'} live=[${live.join(', ')}]${queued.length ? ` queued=[${queued.join(', ')}]` : ''} "${preview}"`)
      return Response.json({ ok: true, delivered_to: targets, live, queued })
    }

    // A channel client posts here once a message is in its session, so it can be dropped.
    if (url.pathname === '/ack' && req.method === 'POST') {
      const { agent, id } = await req.json() as { agent: string; id: number }
      // Purge the id from EVERY queue of the acking session's aliases: a message queued under
      // an OLD alias but delivered to (and acked by) the session's CURRENT name must still be
      // removed. Ids are globally unique, so filtering by id across the alias set is safe.
      const sk = nameOwner.get(agent) ?? agent
      const names = sessionNames.get(sk) ?? new Set([agent])
      for (const nm of names) if (inbox[nm]) inbox[nm] = inbox[nm].filter(m => m.id !== id)
      if (inbox[agent]) inbox[agent] = inbox[agent].filter(m => m.id !== id) // legacy safety
      await persist()
      return Response.json({ ok: true })
    }

    // Back-compat rename: migrate a name's queued inbox to another name. The session-centric
    // subscribe (session+name) is the primary rename mechanism now (a reconnect under the new
    // name re-claims all aliases automatically), but old channels still POST here on a change.
    if (url.pathname === '/rename' && req.method === 'POST') {
      const { from, to } = await req.json() as { from: string; to: string }
      if (!from || !to || from === to)
        return Response.json({ ok: false, error: 'from/to required and distinct' }, { status: 400 })
      const carried = inbox[from]?.length ?? 0
      if (carried) (inbox[to] ??= []).push(...inbox[from])
      delete inbox[from]
      await persist()
      console.error(`RENAME ${from} -> ${to} (carried ${carried} pending)`)
      deliver(to)
      return Response.json({ ok: true, migrated: carried })
    }

    // Inspection. `peers` is the unified view — one record per session with all its aliases,
    // liveness and pending count — so name↔session↔liveness is cross-referenceable in one place.
    // `connected` (live names) + `pending` (per-name counts) are kept for existing readers.
    if (url.pathname === '/status') {
      const peers: { session: string; names: string[]; connected: boolean; pending: number; since: number }[] = []
      const seenNames = new Set<string>()
      for (const [sk, names] of sessionNames) {
        const list = [...names]
        list.forEach(n => seenNames.add(n))
        peers.push({
          session: sk,
          names: list,
          connected: sessions.has(sk),
          pending: list.reduce((a, n) => a + (inbox[n]?.length ?? 0), 0),
          since: sessions.get(sk)?.since ?? 0,
        })
      }
      // Orphan inboxes: names with queued messages and no owning session (dead/legacy cruft).
      for (const [name, q] of Object.entries(inbox)) {
        if (seenNames.has(name) || !q.length) continue
        peers.push({ session: name, names: [name], connected: false, pending: q.length, since: 0 })
      }
      const pending = Object.fromEntries(Object.entries(inbox).map(([a, q]) => [a, q.length]))
      return Response.json({ peers, connected: liveNames(), pending })
    }

    return new Response('not found', { status: 404 })
  },
})

console.error(`agentbus broker listening on http://127.0.0.1:${PORT}  (inbox: ${FILE})`)
