#!/usr/bin/env bun
// agentbus broker v2 — routes peer messages between Claude Code sessions and durably
// queues undelivered ones. Standalone, long-lived, independent of any session.
//
// Identity model (v2): `sessionId` (CLAUDE_CODE_SESSION_ID) is the SOLE routing key. A
// `name` is a mutable, UNIQUE alias for exactly one live session — a claim on a name a
// different live session already holds is REJECTED (name_taken), never superseded, so a
// message to a name has exactly one live destination or none. This eliminates the
// supersede war and squatting at the root. The durable inbox is keyed by sessionId, so a
// dead session's queue dies with it (no ghost inboxes). A separate TTL'd pendingByName
// bucket preserves "send to a peer that hasn't started yet". Receipts tell the sender what
// happened AND which session consumed it (acked = client emit; read = Stop-hook per turn).
//
// Dual-mode migration: with AGENTBUS_STRICT_IDENTITY off (default), a LEGACY subscribe
// that omits `session` still works (sessionKey = name, the old behaviour) with the
// war-guard retained, so the running fleet does not break. Flip strict on after the fleet
// has drained onto v2 clients — then legacy subscribes get an upgrade_required frame.
import { existsSync, mkdirSync, renameSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

type MsgState = 'queued_pending' | 'queued_offline' | 'delivered' | 'acked' | 'read'
interface Msg {
  id: number
  from_session: string
  from_name: string
  to_name: string
  to_session: string | null
  text: string
  ts: number
  state: MsgState
  acked_by_session?: string
  acked_at?: number
  read_at?: number
  expires_at?: number // set only for pendingByName (pre-launch) messages
}

interface PeerMeta { pid?: number; ppid?: number; cwd?: string; title?: string; client_version?: string }

interface SessionRec {
  emit?: (d: string) => void // undefined while dropped
  closer?: () => void
  names: Set<string>
  meta: PeerMeta
  v2: boolean // subscribed with a real session= (receipt-capable)
  state: 'live' | 'dropped'
  connectedSince: number
  lastSeen: number
  graceUntil?: number
}

const DIR = process.env.AGENTBUS_HOME ?? join(homedir(), '.agentbus')
const FILE = join(DIR, 'inbox.json')
const SEQ_FILE = join(DIR, 'seq')
const PORT = Number(process.env.AGENTBUS_PORT ?? 9000)
const HEARTBEAT_MS = Number(process.env.AGENTBUS_HEARTBEAT_MS ?? 15000)
const GRACE_MS = Number(process.env.AGENTBUS_GRACE_MS ?? 45000)
const PENDING_TTL_MS = Number(process.env.AGENTBUS_PENDING_TTL_MS ?? 3_600_000)
const SWEEP_MS = Number(process.env.AGENTBUS_SWEEP_MS ?? 30_000)
const RECEIPT_CAP = Number(process.env.AGENTBUS_RECEIPT_CAP ?? 10_000)
const STRICT = process.env.AGENTBUS_STRICT_IDENTITY === '1'
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })

// --- durable state ---------------------------------------------------------
// inbox keyed by sessionId (exact delivery; dies with the session). pendingByName is the
// TTL'd pre-launch bucket. Persisted together in a versioned file. An old (v1, name-keyed)
// inbox.json is archived and we start clean — its entries are name-addressed debris.
const inbox = new Map<string, Msg[]>()
const pendingByName = new Map<string, Msg[]>()

let loadedSeq = 0
if (existsSync(FILE)) {
  try {
    const parsed = JSON.parse(await Bun.file(FILE).text())
    if (parsed && parsed.version === 2) {
      for (const [sid, q] of Object.entries(parsed.inbox ?? {})) inbox.set(sid, q as Msg[])
      for (const [nm, q] of Object.entries(parsed.pendingByName ?? {})) pendingByName.set(nm, q as Msg[])
      loadedSeq = Number(parsed.seq) || 0
    } else {
      // v1 name-keyed format (or unknown): archive, start clean.
      renameSync(FILE, `${FILE}.v1.bak`)
      console.error(`MIGRATE archived v1 inbox.json -> ${FILE}.v1.bak, starting clean`)
    }
  } catch (e) {
    console.error(`load inbox.json failed (${e}); starting clean`)
  }
}

// seq monotonic across restarts (see v1 note: a regressed id can collide a client's `seen`
// dedup set and be silently skipped). Load max(persisted, any live msg id, SEQ_FILE).
let seq = Math.max(
  0,
  loadedSeq,
  ...[...inbox.values(), ...pendingByName.values()].flat().map(m => m.id),
  existsSync(SEQ_FILE) ? Number((await Bun.file(SEQ_FILE).text()).trim()) || 0 : 0,
)

const persist = async () => {
  const snap = {
    version: 2,
    seq,
    inbox: Object.fromEntries(inbox),
    pendingByName: Object.fromEntries(pendingByName),
  }
  await Bun.write(FILE, JSON.stringify(snap, null, 2))
  await Bun.write(SEQ_FILE, String(seq))
}

// --- live registry ---------------------------------------------------------
const sessions = new Map<string, SessionRec>()
const nameIndex = new Map<string, string>() // name -> owning sessionId (UNIQUE)
const receipts = new Map<number, Msg>()      // id -> message (bounded)
const regTimes = new Map<string, number[]>() // legacy war-guard only

const isLive = (sid: string) => sessions.get(sid)?.state === 'live'

// Record a message for receipt lookup, evicting oldest ids past the cap.
function track(m: Msg) {
  receipts.set(m.id, m)
  if (receipts.size > RECEIPT_CAP) {
    const drop = receipts.size - RECEIPT_CAP
    let i = 0
    for (const k of receipts.keys()) { if (i++ >= drop) break; receipts.delete(k) }
  }
}

// Push a message frame to a session's live stream (shape the client expects: id/from/text/ts).
function deliver(sid: string) {
  const rec = sessions.get(sid)
  const q = inbox.get(sid)
  if (!rec?.emit || !q?.length) return
  for (const m of q) {
    rec.emit(JSON.stringify({ id: m.id, from: m.from_name, text: m.text, ts: m.ts }))
    if (m.state === 'queued_offline' || m.state === 'queued_pending') m.state = 'delivered'
  }
}

// Push a receipt control-frame back to a v2 sender (legacy senders would mis-parse it).
function pushReceipt(m: Msg, state: 'acked' | 'read') {
  const rec = sessions.get(m.from_session)
  if (!rec?.emit || !rec.v2) return
  rec.emit(JSON.stringify({
    type: 'receipt', id: m.id, state,
    by_session: m.acked_by_session ?? m.to_session, by_name: m.to_name,
  }))
}

// When a session claims a name, move any pre-launch pending for it into the session inbox.
function drainPending(name: string, sid: string) {
  const q = pendingByName.get(name)
  if (!q?.length) return
  const dst = inbox.get(sid) ?? []
  for (const m of q) { m.to_session = sid; m.state = 'queued_offline' }
  dst.push(...q)
  inbox.set(sid, dst)
  pendingByName.delete(name)
}

// Remove a session entirely: its live record, its names from the index, its inbox. This is
// what makes ghosts impossible — a gone session leaves nothing routable behind.
function gcSession(sid: string, reason: string) {
  const rec = sessions.get(sid)
  if (!rec) return
  try { rec.closer?.() } catch {}
  for (const nm of rec.names) if (nameIndex.get(nm) === sid) nameIndex.delete(nm)
  sessions.delete(sid)
  inbox.delete(sid)
  console.error(`GC session=${sid} names=[${[...rec.names].join(',')}] reason=${reason}`)
}

// Periodic sweep: GC dropped sessions past their grace window, expire pending, that's it.
// A LIVE session is never swept (a healthy idle client heartbeats; a dead stream is already
// 'dropped'). Zombie *processes* are the client's job to self-terminate, and the operator's
// /kill — the broker cannot tell a zombie's heartbeat from a live one.
setInterval(() => {
  const now = Date.now()
  for (const [sid, rec] of sessions)
    if (rec.state === 'dropped' && rec.graceUntil && now > rec.graceUntil) gcSession(sid, 'grace-expired')
  for (const [name, q] of pendingByName) {
    const kept = q.filter(m => !m.expires_at || m.expires_at > now)
    if (kept.length) pendingByName.set(name, kept); else pendingByName.delete(name)
  }
}, SWEEP_MS)

// --- resolution ------------------------------------------------------------
// Resolve a send target name -> a routable destination.
function routeTo(toName: string): { sid: string; state: 'delivered' | 'queued_offline' } | null {
  const owner = nameIndex.get(toName)
  if (owner && sessions.has(owner)) return { sid: owner, state: isLive(owner) ? 'delivered' : 'queued_offline' }
  return null
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url)

    // ---- subscribe ----------------------------------------------------------
    if (url.pathname === '/subscribe') {
      const name = url.searchParams.get('agent')
      if (!name) return new Response('agent required', { status: 400 })
      const rawSession = url.searchParams.get('session')
      const v2 = !!rawSession
      if (STRICT && !v2) {
        // Legacy client cannot present a stable identity in strict mode — tell it to upgrade.
        return new Response('data: {"type":"upgrade_required"}\n\n', {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        })
      }
      const sid = rawSession || name // legacy: name is its own session key
      let meta: PeerMeta = {}
      const rawMeta = url.searchParams.get('meta')
      if (rawMeta) { try { meta = JSON.parse(Buffer.from(rawMeta, 'base64').toString('utf8')) } catch {} }

      return new Response(new ReadableStream({
        start(ctrl) {
          const now = Date.now()

          // Uniqueness: a DIFFERENT live session already owns this name -> reject. (Same
          // session reconnecting is fine — it owns its own name.) In legacy dual-mode two
          // no-session clients collapse to sid=name, so this path also needs the war-guard.
          const owner = nameIndex.get(name)
          if (owner && owner !== sid && isLive(owner)) {
            console.error(`NAME_TAKEN name=${name} wanted-by=${sid} held-by=${owner}`)
            try { ctrl.enqueue(`data: {"type":"name_taken","name":${JSON.stringify(name)}}\n\n`); ctrl.close() } catch {}
            return
          }
          if (!v2) {
            // Legacy war-guard: same-key storm (fork/dupe under one collapsed key). Retained
            // only for the legacy path; v2's uniqueness rule makes it unreachable.
            const recent = (regTimes.get(name) ?? []).filter(t => now - t < 5000)
            recent.push(now); regTimes.set(name, recent)
            if (recent.length > 4 && sessions.has(sid)) {
              console.error(`FLAP(legacy) name=${name} session=${sid}: ${recent.length}/5s — rejecting duplicate`)
              try { ctrl.enqueue(': duplicate-id\n\n'); ctrl.close() } catch {}
              return
            }
          }

          // Supersede this session's own prior stream (a reconnect), never another session's.
          const prior = sessions.get(sid)
          const connectedSince = prior?.connectedSince ?? now
          if (prior?.emit) try { prior.closer?.() } catch {}

          ctrl.enqueue(': connected\n\n')
          const emit = (d: string) => { try { ctrl.enqueue(`data: ${d}\n\n`) } catch (e) { console.error(`emit-throw name=${name} session=${sid}`, e) } }

          const names = prior?.names ?? new Set<string>()
          names.add(name)
          for (const nm of names) nameIndex.set(nm, sid)

          const drop = () => {
            clearInterval(hb)
            const cur = sessions.get(sid)
            if (cur?.emit === emit) {
              // Enter the grace window: keep the record + inbox for a reconnect, but mark
              // dropped and stop presenting it as connected. Sweep GCs it if no reconnect.
              cur.emit = undefined; cur.closer = undefined
              cur.state = 'dropped'; cur.graceUntil = Date.now() + GRACE_MS
            }
            try { ctrl.close() } catch {}
          }
          sessions.set(sid, {
            emit, closer: drop, names, meta, v2, state: 'live',
            connectedSince, lastSeen: now,
          })
          console.error(`REGISTER name=${name} session=${sid} v2=${v2} names=[${[...names].join(',')}] live=${[...sessions.values()].filter(s => s.state === 'live').length}`)

          const hb = setInterval(() => {
            const cur = sessions.get(sid); if (cur) cur.lastSeen = Date.now()
            try { ctrl.enqueue(': ping\n\n') } catch { drop() }
          }, HEARTBEAT_MS)
          req.signal.addEventListener('abort', drop)

          for (const nm of names) drainPending(nm, sid)
          deliver(sid)
        },
      }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
    }

    // ---- send ---------------------------------------------------------------
    if (url.pathname === '/send' && req.method === 'POST') {
      const body = await req.json() as Record<string, unknown>
      const from_name = typeof body.from === 'string' ? body.from : 'unknown'
      const from_session = (typeof body.from_session === 'string' && body.from_session)
        || nameIndex.get(from_name) || from_name
      const to = typeof body.to === 'string' ? body.to : undefined
      const raw = body.text ?? body.message ?? body.content ?? body.body ?? ''
      const text = typeof raw === 'string' ? raw : String(raw ?? '')

      const mk = (to_name: string, to_session: string | null, state: MsgState, expires_at?: number): Msg => {
        const m: Msg = { id: ++seq, from_session, from_name, to_name, to_session, text, ts: Date.now(), state, expires_at }
        track(m); return m
      }

      if (!to) {
        // Broadcast: one copy per LIVE session (not per name, not to ghosts), excluding self.
        const seen = new Set<string>()
        const results: { name: string; session: string; state: string }[] = []
        for (const [nm, sid] of nameIndex) {
          if (sid === from_session || !isLive(sid) || seen.has(sid)) continue
          seen.add(sid)
          const m = mk(nm, sid, 'queued_offline')
          ;(inbox.get(sid) ?? inbox.set(sid, []).get(sid)!).push(m)
          results.push({ name: nm, session: sid, state: 'delivered' })
        }
        await persist()
        for (const sid of seen) deliver(sid)
        console.error(`SEND ${from_name} -> (broadcast) live=${results.length}`)
        return Response.json({ ok: true, broadcast: true, targets: results })
      }

      // Directed.
      const route = routeTo(to)
      let m: Msg
      if (route) {
        m = mk(to, route.sid, route.state)
        ;(inbox.get(route.sid) ?? inbox.set(route.sid, []).get(route.sid)!).push(m)
        await persist(); deliver(route.sid)
      } else {
        // Nobody owns this name yet: TTL'd pre-launch queue. The sender is told nobody is
        // there (queued_pending) — never a silent blackhole.
        m = mk(to, null, 'queued_pending', Date.now() + PENDING_TTL_MS)
        ;(pendingByName.get(to) ?? pendingByName.set(to, []).get(to)!).push(m)
        await persist()
      }
      const preview = text.length > 80 ? text.slice(0, 80) + '…' : text
      console.error(`SEND ${from_name} -> ${to} state=${m.state} "${preview}"`)
      return Response.json({ ok: true, id: m.id, state: m.state, to_session: m.to_session })
    }

    // ---- ack (Tier-1 receipt) ----------------------------------------------
    if (url.pathname === '/ack' && req.method === 'POST') {
      const b = await req.json() as { session?: string; agent?: string; id: number }
      const sid = b.session || (b.agent ? (nameIndex.get(b.agent) ?? b.agent) : '')
      const q = inbox.get(sid)
      if (q) inbox.set(sid, q.filter(m => m.id !== b.id))
      const m = receipts.get(b.id)
      if (m) { m.state = 'acked'; m.acked_by_session = sid; m.acked_at = Date.now(); pushReceipt(m, 'acked') }
      await persist()
      return Response.json({ ok: true })
    }

    // ---- read (Tier-2 receipt; from the Stop hook) -------------------------
    if (url.pathname === '/read' && req.method === 'POST') {
      const { session, ids } = await req.json() as { session: string; ids: number[] }
      const now = Date.now()
      for (const id of ids ?? []) {
        const m = receipts.get(id)
        if (m && m.acked_by_session === session) { m.state = 'read'; m.read_at = now; pushReceipt(m, 'read') }
      }
      return Response.json({ ok: true, read: (ids ?? []).length })
    }

    // ---- receipt (pull) -----------------------------------------------------
    if (url.pathname === '/receipt') {
      const id = Number(url.searchParams.get('id'))
      const m = receipts.get(id)
      if (!m) return Response.json({ error: 'unknown or aged-out id' }, { status: 404 })
      return Response.json({
        id: m.id, state: m.state, to_session: m.to_session,
        acked_by_session: m.acked_by_session ?? null, acked_at: m.acked_at ?? null, read_at: m.read_at ?? null,
      })
    }

    // ---- close (client stdio-close / SessionEnd hook) — immediate GC --------
    if (url.pathname === '/close' && req.method === 'POST') {
      const { session } = await req.json() as { session: string }
      if (session && sessions.has(session)) { gcSession(session, 'close'); await persist() }
      return Response.json({ ok: true, gc: true })
    }

    // ---- kill (operator force-remove) --------------------------------------
    if (url.pathname === '/kill' && req.method === 'POST') {
      const { session, name } = await req.json() as { session?: string; name?: string }
      const sid = session || (name ? nameIndex.get(name) : undefined)
      const killed: { session: string; names: string[]; pid?: number }[] = []
      if (sid && sessions.has(sid)) {
        const rec = sessions.get(sid)!
        killed.push({ session: sid, names: [...rec.names], pid: rec.meta.pid })
        gcSession(sid, 'kill'); await persist()
      }
      return Response.json({ ok: true, killed })
    }

    // ---- rename (add alias to a session; legacy name-file path) -------------
    if (url.pathname === '/rename' && req.method === 'POST') {
      const b = await req.json() as { session?: string; from?: string; to: string }
      const sid = b.session || (b.from ? (nameIndex.get(b.from) ?? b.from) : '')
      if (!b.to || !sid) return Response.json({ ok: false, error: 'session/to required' }, { status: 400 })
      const owner = nameIndex.get(b.to)
      if (owner && owner !== sid && isLive(owner))
        return Response.json({ ok: false, error: 'name_taken' }, { status: 409 })
      const rec = sessions.get(sid)
      if (rec) { rec.names.add(b.to); nameIndex.set(b.to, sid); drainPending(b.to, sid); deliver(sid) }
      else nameIndex.set(b.to, sid)
      // Legacy inbox carry (v1 name-keyed sends that predate this session): none in v2.
      console.error(`RENAME session=${sid} +alias=${b.to}`)
      return Response.json({ ok: true, name: b.to })
    }

    // ---- status (honest presence) ------------------------------------------
    if (url.pathname === '/status') {
      const now = Date.now()
      const peers = [...sessions.entries()].map(([sid, r]) => ({
        session: sid,
        names: [...r.names],
        state: r.state,
        connected: r.state === 'live',
        last_seen_ms: now - r.lastSeen,
        connected_since: r.connectedSince,
        pending: inbox.get(sid)?.length ?? 0,
        pid: r.meta.pid ?? null,
        ppid: r.meta.ppid ?? null,
        cwd: r.meta.cwd ?? null,
        title: r.meta.title ?? null,
        client_version: r.meta.client_version ?? null,
      }))
      const pending_by_name = Object.fromEntries([...pendingByName].map(([n, q]) => [n, q.length]))
      // Back-compat: keep `connected` (live names) + `pending` (per-name) for old readers.
      const connected = peers.filter(p => p.connected).flatMap(p => p.names)
      const pending = Object.fromEntries(peers.map(p => p.names.map(n => [n, p.pending])).flat())
      return Response.json({
        peers, pending_by_name, connected, pending,
        counts: {
          live: peers.filter(p => p.state === 'live').length,
          dropped: peers.filter(p => p.state === 'dropped').length,
          pending_names: pendingByName.size,
        },
      })
    }

    return new Response('not found', { status: 404 })
  },
})

console.error(`agentbus broker v2 listening on http://127.0.0.1:${PORT}  strict=${STRICT}  (inbox: ${FILE})`)
