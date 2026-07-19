#!/usr/bin/env bun
// End-to-end test of the agentbus v2 broker (bus.ts). Drives the REAL broker as a subprocess
// on an isolated port + home, using raw SSE subscribers (no dependence on the Phase-2 client,
// which sidesteps the CLAUDE_CODE_SESSION_ID name-file inheritance that made v1's harness
// env-dependent). Proves: session-keyed delivery + Tier-1 receipt, name uniqueness, GC on
// close, the drop->grace->GC lifecycle, queued_pending vs delivered, pendingByName drain +
// expiry, broadcast to live-only, Tier-2 read receipt, and legacy war convergence.
import { rmSync, existsSync } from 'fs'
import { join } from 'path'

const HERE = import.meta.dir
const PORT = 9077
const BUS = `http://127.0.0.1:${PORT}`
const HOME = join(HERE, '.e2e-home')

// Fast timers so lifecycle transitions happen in ~1s, not 45s.
const env = {
  ...process.env, AGENTBUS_HOME: HOME, AGENTBUS_PORT: String(PORT),
  AGENTBUS_HEARTBEAT_MS: '250', AGENTBUS_GRACE_MS: '800',
  AGENTBUS_SWEEP_MS: '250', AGENTBUS_PENDING_TTL_MS: '3000',
}

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!cond) failures++
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function status(): Promise<any> { return fetch(`${BUS}/status`).then(r => r.json()) }
async function post(path: string, body: object) {
  return fetch(`${BUS}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json())
}
const send = (from_session: string, from: string, text: string, to?: string) =>
  post('/send', { from_session, from, to, text })
async function receipt(id: number) { return fetch(`${BUS}/receipt?id=${id}`).then(r => ({ s: r.status, b: r.status === 200 ? undefined : undefined })).catch(() => ({ s: 0 })) }

async function waitFor(pred: (s: any) => boolean, ms = 4000) {
  const t = Date.now()
  while (Date.now() - t < ms) { try { if (pred(await status())) return true } catch {} await sleep(60) }
  return false
}
async function waitPort(ms = 5000) {
  const t = Date.now()
  while (Date.now() - t < ms) { try { await fetch(`${BUS}/status`); return true } catch {} await sleep(80) }
  return false
}
const nameLive = (s: any, n: string) => s.peers.some((p: any) => p.connected && p.names.includes(n))
const sessionGone = (s: any, sid: string) => !s.peers.some((p: any) => p.session === sid)

// Raw SSE subscriber. Buckets frames: msgs (id/from/text), receipts (type:receipt),
// control (name_taken/upgrade_required). Does NOT ack — we ack via HTTP to assert precisely.
function sub(name: string, session?: string) {
  const msgs: any[] = [], receipts: any[] = [], control: any[] = []
  let closed = false
  const ctrl = new AbortController()
  ;(async () => {
    try {
      const qs = session ? `&session=${encodeURIComponent(session)}` : ''
      const res = await fetch(`${BUS}/subscribe?agent=${encodeURIComponent(name)}${qs}`, { signal: ctrl.signal })
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { value, done } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true }); let i
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2)
          const line = frame.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          let m: any; try { m = JSON.parse(line.slice(6)) } catch { continue }
          if (m.type === 'receipt') receipts.push(m)
          else if (m.type) control.push(m)
          else msgs.push(m)
        }
      }
    } catch {}
    closed = true
  })()
  return { msgs, receipts, control, stop: () => ctrl.abort(), isClosed: () => closed }
}

function spawnBroker() { return Bun.spawn(['bun', join(HERE, 'bus.ts')], { env, stdout: 'ignore', stderr: 'ignore' }) }
async function kill(p: { kill: () => void; exited: Promise<number> }) { p.kill(); try { await p.exited } catch {} }

async function main() {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true })
  let broker = spawnBroker()
  check('broker up', await waitPort(), BUS)

  // 1 — session-keyed directed delivery + Tier-1 receipt to the sender ------------
  const A = sub('alice', 'sess-A'), B = sub('bob', 'sess-B')
  await waitFor(s => nameLive(s, 'alice') && nameLive(s, 'bob'))
  const r1 = await send('sess-A', 'alice', 'hi bob', 'bob')
  check('1a send reported delivered', r1.state === 'delivered' && r1.to_session === 'sess-B', JSON.stringify(r1))
  await sleep(150)
  check('1b bob received the message', B.msgs.some(m => m.text === 'hi bob' && m.from === 'alice'))
  const mid = r1.id
  await post('/ack', { session: 'sess-B', id: mid })
  await sleep(150)
  check('1c alice got a Tier-1 acked receipt naming bob\'s session',
    A.receipts.some(x => x.id === mid && x.state === 'acked' && x.by_session === 'sess-B'))

  // 2 — name uniqueness: a different live session cannot steal a held name ---------
  const dupB = sub('alice', 'sess-OTHER') // same name, different session
  await sleep(200)
  check('2a second claimant rejected with name_taken', dupB.control.some(c => c.type === 'name_taken'))
  check('2b original owner keeps the name', nameLive(await status(), 'alice'))

  // 3 — GC on /close: session vanishes, inbox gone --------------------------------
  const C = sub('carol', 'sess-C'); await waitFor(s => nameLive(s, 'carol'))
  await post('/close', { session: 'sess-C' })
  check('3 closed session GC\'d immediately', await waitFor(s => sessionGone(s, 'sess-C'), 1500))
  C.stop()

  // 4 — drop -> grace -> GC lifecycle ---------------------------------------------
  const D = sub('dave', 'sess-D'); await waitFor(s => nameLive(s, 'dave'))
  D.stop() // abort SSE (session drops)
  await sleep(200)
  check('4a within grace: still present as dropped',
    (await status()).peers.some((p: any) => p.session === 'sess-D' && p.state === 'dropped'))
  check('4b after grace: swept', await waitFor(s => sessionGone(s, 'sess-D'), 2500))

  // 5 — queued_pending (no owner) vs delivered (owner) ----------------------------
  const r5 = await send('sess-A', 'alice', 'anyone?', 'nobody-here')
  check('5a send to unknown name = queued_pending, not silent', r5.state === 'queued_pending' && r5.to_session === null, JSON.stringify(r5))
  check('5b pending_by_name records it', (await status()).pending_by_name['nobody-here'] === 1)

  // 6 — pendingByName drains to the session that later claims; expiry sweeps -------
  await send('sess-A', 'alice', 'for the future worker', 'worker')
  const W = sub('worker', 'sess-W')
  await sleep(250)
  check('6a late-joining worker drained the pending message', W.msgs.some(m => m.text === 'for the future worker'))
  await send('sess-A', 'alice', 'to a name that never shows', 'never-shows')
  check('6b expired pending is swept', await waitFor(s => !(('never-shows') in s.pending_by_name), 4000))
  W.stop()

  // 6c — durability across a broker restart (pending survives on disk, drains after) ----
  await send('sess-A', 'alice', 'survive the restart', 'restart-peer')
  check('6c1 pending before restart', (await status()).pending_by_name['restart-peer'] === 1)
  await kill(broker); await sleep(200)
  broker = spawnBroker(); await waitPort()
  check('6c2 pending survived the restart on disk', (await status()).pending_by_name['restart-peer'] === 1)
  const RP = sub('restart-peer', 'sess-RP'); await sleep(250)
  check('6c3 reconnecting peer drains the persisted message', RP.msgs.some(m => m.text === 'survive the restart'))
  RP.stop()

  // 7 — broadcast reaches live sessions only, not pending/dead names ---------------
  const X = sub('xavier', 'sess-X'), Y = sub('yolanda', 'sess-Y')
  await waitFor(s => nameLive(s, 'xavier') && nameLive(s, 'yolanda'))
  await send('sess-A', 'alice', 'seed', 'phantom') // phantom -> pendingByName, no live session
  const rb = await send('sess-X', 'xavier', 'BROADCAST hello', undefined)
  await sleep(200)
  check('7a broadcast delivered to live peer yolanda', Y.msgs.some(m => m.text === 'BROADCAST hello'))
  check('7b broadcast excluded the sender xavier', !X.msgs.some(m => m.text === 'BROADCAST hello'))
  check('7c broadcast did NOT target the phantom pending name',
    !rb.targets.some((t: any) => t.name === 'phantom'))
  X.stop(); Y.stop()

  // 8 — Tier-2 read receipt (the Stop-hook path) ----------------------------------
  const S = sub('sam', 'sess-S'), R = sub('rita', 'sess-R')
  await waitFor(s => nameLive(s, 'sam') && nameLive(s, 'rita'))
  const r8 = await send('sess-S', 'sam', 'read me', 'rita')
  await sleep(120)
  await post('/ack', { session: 'sess-R', id: r8.id })
  await post('/read', { session: 'sess-R', ids: [r8.id] })
  await sleep(150)
  check('8 sam got a Tier-2 read receipt', S.receipts.some(x => x.id === r8.id && x.state === 'read'))
  S.stop(); R.stop(); A.stop(); B.stop()

  // 9 — legacy war convergence (dual-mode, no session=) ---------------------------
  // Two legacy warriors reconnect-loop under one name. The legacy war-guard must converge
  // them to a single stable incumbent instead of a 1Hz supersede war.
  let stopWar = false
  async function warrior() {
    while (!stopWar) {
      try {
        const res = await fetch(`${BUS}/subscribe?agent=warvictim`) // NO session -> legacy
        const reader = res.body!.getReader()
        for (;;) { const { done } = await reader.read(); if (done) break }
      } catch {}
      await sleep(150)
    }
  }
  warrior(); warrior()
  await sleep(2500)
  check('9a legacy war converged to a live incumbent', nameLive(await status(), 'warvictim'))
  const r9 = await send('sess-A', 'probe', 'still routable', 'warvictim')
  check('9b send to the converged name is delivered (not lost)', r9.state === 'delivered', JSON.stringify(r9))
  stopWar = true
  await sleep(300)

  await kill(broker)
  rmSync(HOME, { recursive: true, force: true })
  console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
