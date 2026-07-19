#!/usr/bin/env bun
// Per-session channel client. Identity comes from AGENT_ID. Pushes peer messages into
// the session as <channel> events and acks them deterministically once emitted (no reliance
// on the model to ack). Exposes send_message for outbound.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, writeFileSync } from 'node:fs'

const BUS = process.env.BUS_URL ?? 'http://localhost:9000'
// If no bytes (not even a heartbeat) arrive within this window, the stream is dead —
// abort and reconnect. Must exceed the broker's heartbeat interval (default 15s).
const IDLE_MS = Number(process.env.AGENTBUS_IDLE_MS ?? 40000)
const SESSION_ID = process.env.CLAUDE_CODE_SESSION_ID ?? ''
const NAME_FILE = SESSION_ID ? `/tmp/agentbus-name-${SESSION_ID}` : ''
const CLIENT_VERSION = '2.0.0'
// Tier-2 read-receipt data plane: the client appends each emitted msg id here; the Stop hook
// drains it and POSTs /read so the sender learns the message was actually processed in a turn.
const UNREAD_FILE = SESSION_ID ? `/tmp/agentbus-unread-${SESSION_ID}.jsonl` : ''
// Test-only escape hatch: keep running even when stdio to the MCP host closes (the e2e harness
// runs this client with no host). In a real session this stays 0 so the client self-terminates
// when Claude Code exits — the anti-zombie guarantee.
const STANDALONE = process.env.AGENTBUS_STANDALONE === '1'
// The stable session key the broker routes on. Falls back to the name only in legacy launches
// with no CLAUDE_CODE_SESSION_ID (pre-hook), where the broker treats name == session.
const SKEY = SESSION_ID || ''

// Resolve this session's bus identity. Priority: the name-file (written by the SessionStart
// hook or /busname) > a real AGENT_ID env > the session uuid > 'agent'. The literal
// '${AGENT_ID}' is a launch-quoting bug — treat it as unset so a mis-launched session still
// gets a stable id instead of registering the ghost peer '${AGENT_ID}'.
function resolveId(): string {
  if (NAME_FILE) {
    try { const n = readFileSync(NAME_FILE, 'utf8').trim(); if (n) return n } catch {}
  }
  const env = process.env.AGENT_ID
  if (env && env !== '${AGENT_ID}') return env
  return SESSION_ID || 'agent'
}

// At startup the SessionStart hook may not have written the name-file yet (it races the MCP
// server spawn). If we'd otherwise fall back to the uuid, wait briefly for the name-file — so we
// register under the real name from the start instead of registering as the uuid and then
// renaming, which churns the bus and can trip the broker's flapping guard against another claimant.
async function resolveIdAtStartup(): Promise<string> {
  const env = process.env.AGENT_ID
  if (env && env !== '${AGENT_ID}') return env // explicit valid env wins, no wait
  for (let i = 0; i < 15 && NAME_FILE; i++) {
    try { const n = readFileSync(NAME_FILE, 'utf8').trim(); if (n) return n } catch {}
    await new Promise(r => setTimeout(r, 200)) // up to ~3s for the hook to write it
  }
  return resolveId()
}
let AGENT_ID = await resolveIdAtStartup()

const mcp = new Server(
  { name: 'agentbus', version: '0.1.0' },
  {
    capabilities: { experimental: { 'claude/channel': {} }, tools: {} },
    instructions:
      `You are "${AGENT_ID}", one of several peer Claude Code sessions sharing a message bus. ` +
      `Peer messages arrive as <channel source="agentbus" from="..." msg_id="..."> tags. A peer may be ` +
      `announcing a tool or feature they shipped, or reporting a bug in something you maintain. ` +
      `Read it and act if it concerns you. To reach a peer, call send_message with their id in "to" ` +
      `(omit "to" to broadcast to all peers). Call list_peers first to get the exact connected ids — ` +
      `a mistyped "to" is silently queued to a blackhole nobody reads. Inbound tags are prefixed "← ", ` +
      `your own sent messages echo back prefixed "→ ". Do not reply unless you have something substantive to send.`,
  },
)

// Outbound + discovery tools.
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
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
    },
    {
      name: 'list_peers',
      description:
        'List agent ids currently connected to the bus (plus pending-message counts). Call this to '
        + 'verify a target id before send_message — a mistyped id is silently queued to a blackhole '
        + 'inbox nobody reads.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'send_message') {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    const to = typeof args.to === 'string' ? args.to : undefined
    // Accept the message text under any of these arg names — the model sometimes calls with
    // `message`/`content`/`body` instead of `text`, which otherwise silently sends an empty body.
    const text = String(args.text ?? args.message ?? args.content ?? args.body ?? '')
    const res = await fetch(`${BUS}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_session: SKEY || AGENT_ID, from: AGENT_ID, to, text }),
    }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))
    // Echo the outbound into this session, symmetric to inbound. The broker now returns a precise
    // state: queued_pending means NOBODY holds that name (the old silent-blackhole typo, now
    // surfaced); queued_offline means the right peer is momentarily away; delivered means it landed.
    if ((res as { ok?: boolean }).ok) {
      const state = (res as { state?: string }).state
      const warn =
        state === 'queued_pending' ? '  ⚠ no live peer under that id — check it'
        : state === 'queued_offline' ? '  (queued — peer offline, will deliver on reconnect)'
        : ''
      await mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content: `→ ${to ?? '(broadcast)'}: ${text}${warn}`,
          meta: { to: to ?? '(broadcast)', direction: 'outbound', state: state ?? '', id: String((res as { id?: number }).id ?? '') },
        },
      }).catch(() => {})
    }
    return { content: [{ type: 'text', text: JSON.stringify(res) }] }
  }
  if (req.params.name === 'list_peers') {
    const res = await fetch(`${BUS}/status`).then(r => r.json()).catch(e => ({ error: String(e) }))
    return { content: [{ type: 'text', text: JSON.stringify(res) }] }
  }
  throw new Error(`unknown tool: ${req.params.name}`)
})

// Bind the client's life to its stdio link to Claude Code. When CC exits it closes stdio; we
// then deregister from the bus (POST /close) and exit — so a dead session leaves NO lingering
// client squatting its name (the zombie the autopsy found). STANDALONE=1 (tests) opts out.
let activeCtrl: AbortController | undefined
let closing = false
async function onParentGone(why: string) {
  if (closing) return
  closing = true
  dbg(`parent gone (${why}) → /close + exit`)
  try {
    await fetch(`${BUS}/close`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: SKEY || AGENT_ID }),
    })
  } catch {}
  try { activeCtrl?.abort() } catch {}
  process.exit(0)
}
const transport = new StdioServerTransport()
await mcp.connect(transport)
if (!STANDALONE) {
  transport.onclose = () => onParentGone('transport-close')
  process.stdin.on('end', () => onParentGone('stdin-end'))
  process.stdin.on('close', () => onParentGone('stdin-close'))
  process.on('SIGTERM', () => onParentGone('SIGTERM'))
  process.on('SIGINT', () => onParentGone('SIGINT'))
}

// Inbound: subscribe to the bus, push each message into the session, ack it.
const seen = new Set<number>() // dedupe redelivered messages within this session

async function ack(id: number) {
  try {
    await fetch(`${BUS}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: SKEY || AGENT_ID, agent: AGENT_ID, id }),
    })
  } catch {}
}

import { appendFileSync as _append } from 'node:fs'
// Tier-2 data plane: record an emitted id so the Stop hook can POST /read for it.
function recordUnread(id: number, from: string) {
  if (!UNREAD_FILE) return
  try { _append(UNREAD_FILE, JSON.stringify({ id, from }) + '\n') } catch {}
}
// Render a receipt frame from the broker on THIS (sender) session — messenger-style.
async function renderReceipt(m: { id: number; state: string; by_name?: string; by_session?: string }) {
  const mark = m.state === 'read' ? '✓✓ read' : m.state === 'acked' ? '✓ delivered' : m.state
  await mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content: `${mark} · #${m.id}${m.by_name ? ` (${m.by_name})` : ''}`,
      meta: { direction: 'receipt', id: String(m.id), state: m.state, by_session: m.by_session ?? '' },
    },
  }).catch(() => {})
}

import { appendFileSync } from 'node:fs'
const DEBUG_LOG = process.env.AGENTBUS_DEBUG_LOG ?? `/tmp/agentbus-pump-${AGENT_ID}.log`
function dbg(msg: string) {
  try { appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`) } catch {}
}

// Watch the name-file: if the resolved identity changes (SessionStart hook / /busname), force
// the current stream to reconnect so the loop re-binds AGENT_ID and re-subscribes under it.
setInterval(() => {
  if (resolveId() !== AGENT_ID) { dbg('name-file changed → forcing reconnect'); activeCtrl?.abort() }
}, 3000)

async function pump() {
  dbg('pump() entered')
  for (;;) {
    dbg('loop iteration start')
    // Re-bind identity before (re)subscribing: if the name-file changed, carry the bus inbox
    // to the new id via /rename, then subscribe under it below.
    const wanted = resolveId()
    if (wanted !== AGENT_ID) {
      const old = AGENT_ID
      AGENT_ID = wanted
      dbg(`identity ${old} -> ${AGENT_ID}`)
      try {
        await fetch(`${BUS}/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: old, to: AGENT_ID }),
        })
      } catch (e) { dbg(`rename call failed: ${e}`) }
    }
    // Idle watchdog: if no bytes (not even a heartbeat) arrive within IDLE_MS the stream is
    // dead — force the loop to reconnect. Bun's reader.read() does NOT reliably reject when the
    // fetch signal aborts, so we cannot rely on ctrl.abort() alone: we RACE each read against an
    // idle promise and explicitly cancel the reader, guaranteeing the loop breaks and re-subscribes.
    const ctrl = new AbortController()
    activeCtrl = ctrl
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let idle: ReturnType<typeof setTimeout> | undefined
    let onIdle: () => void = () => {}
    const idlePromise: Promise<'idle'> = new Promise(res => { onIdle = () => res('idle') })
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => { ctrl.abort(); onIdle() }, IDLE_MS) }
    try {
      arm()
      dbg('fetch /subscribe start')
      // Carry the stable session key so the broker ties every name this session announces
      // (across renames + SSE reconnects) to this one live transport. Omitted when unknown
      // (legacy) — the broker then treats the name as its own session key.
      const sessionQS = SESSION_ID ? `&session=${encodeURIComponent(SESSION_ID)}` : ''
      // Presence meta so /status can show pid/cwd/version — lets the operator spot + kill a zombie
      // and see which peers still run a legacy client (drives the strict-mode cutover).
      const meta = { pid: process.pid, ppid: process.ppid, cwd: process.cwd(), title: AGENT_ID, client_version: CLIENT_VERSION }
      const metaQS = `&meta=${encodeURIComponent(Buffer.from(JSON.stringify(meta)).toString('base64'))}`
      const res = await fetch(`${BUS}/subscribe?agent=${encodeURIComponent(AGENT_ID)}${sessionQS}${metaQS}`, { signal: ctrl.signal })
      dbg(`fetch /subscribe resolved status=${res.status}`)
      if (!res.body) throw new Error('no response body')
      reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        dbg('awaiting reader.read() race')
        const r = await Promise.race([reader.read(), idlePromise])
        dbg(`race settled: ${r === 'idle' ? 'idle' : `done=${r.done} bytes=${r.value?.length ?? 0}`}`)
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
          let m: any
          try { m = JSON.parse(line.slice(6)) } catch { continue }
          // Control frames from the v2 broker.
          if (m.type === 'name_taken') {
            // A DIFFERENT live session already holds this name. Take a session-unique variant and
            // reconnect under it — the client-side complement to the hook's unique-name derivation.
            const frag = (SKEY || String(process.pid)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)
            const base = AGENT_ID.endsWith(`-${frag}`) ? AGENT_ID.slice(0, -(frag.length + 1)) : AGENT_ID
            AGENT_ID = `${base}-${frag}`
            if (NAME_FILE) try { writeFileSync(NAME_FILE, AGENT_ID) } catch {}
            dbg(`name_taken → retry as ${AGENT_ID}`)
            break // reconnect under the new unique name
          }
          if (m.type === 'upgrade_required') { dbg('broker strict mode: upgrade_required'); continue }
          if (m.type === 'receipt') { await renderReceipt(m); continue } // a receipt for something WE sent
          // Otherwise: an inbound peer message.
          if (typeof m.id !== 'number') continue
          if (seen.has(m.id)) { await ack(m.id); continue } // duplicate: ack and skip
          seen.add(m.id)
          await mcp.notification({
            method: 'notifications/claude/channel',
            params: { content: `← ${m.text}`, meta: { from: m.from, msg_id: String(m.id) } },
          })
          await ack(m.id)              // Tier-1: message is in the session
          recordUnread(m.id, m.from)   // Tier-2: Stop hook will POST /read when a turn processes it
        }
      }
    } catch (e) {
      console.error(`DEBUG pump-error agent=${AGENT_ID}: ${e}`)
      dbg(`catch: ${e}`)
    }
    clearTimeout(idle)
    // reader.cancel() can itself hang (same Bun read()-doesn't-reject class of quirk) — without
    // a hard cap here the whole reconnect loop wedges forever, exactly like an unguarded read().
    if (reader) {
      dbg('cancel() start')
      try { await Promise.race([reader.cancel(), new Promise(res => setTimeout(res, 2000))]) } catch (e) { dbg(`cancel() threw: ${e}`) }
      dbg('cancel() settled')
    }
    dbg('backoff sleep start')
    await new Promise(r => setTimeout(r, 1000)) // reconnect backoff
    dbg('backoff sleep done, looping')
  }
}

pump()
