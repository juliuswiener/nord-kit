#!/usr/bin/env bun
// End-to-end test of the agentbus transport + durability layer. Drives the REAL broker
// (bus.ts) and the REAL channel client (agent-channel.ts) as subprocesses. Proves live
// delivery, reply path, broadcast, offline durability, broker-restart durability and the
// status endpoint — everything except the visible <channel> render inside a CC session,
// which is inherently interactive (see README acceptance tests 1-3).
import { rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

const HERE = import.meta.dir
const PORT = 9077 // isolated from a real broker on 9000
const BUS = `http://127.0.0.1:${PORT}`
const HOME = join(HERE, '.e2e-home')
const INBOX = join(HOME, 'inbox.json')

// Short heartbeat/idle windows so the self-heal test runs in seconds, not 40s.
const env = {
  ...process.env, AGENTBUS_HOME: HOME, AGENTBUS_PORT: String(PORT), BUS_URL: BUS,
  AGENTBUS_HEARTBEAT_MS: '500', AGENTBUS_IDLE_MS: '1500',
}

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!cond) failures++
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function status(): Promise<{ connected: string[]; pending: Record<string, number> }> {
  return fetch(`${BUS}/status`).then(r => r.json())
}
async function send(from: string, text: string, to?: string) {
  return fetch(`${BUS}/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, text }),
  }).then(r => r.json())
}
// Poll until predicate on /status holds, or timeout.
async function waitFor(pred: (s: Awaited<ReturnType<typeof status>>) => boolean, ms = 5000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    try { if (pred(await status())) return true } catch {}
    await sleep(100)
  }
  return false
}
async function waitPort(ms = 5000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    try { await fetch(`${BUS}/status`); return true } catch {}
    await sleep(100)
  }
  return false
}

function spawnBroker() {
  return Bun.spawn(['bun', join(HERE, 'bus.ts')], { env, stdout: 'inherit', stderr: 'inherit' })
}
// Real channel client. stdin kept open ('pipe') so its StdioServerTransport stays alive with
// no MCP host attached; pump() runs regardless and drives subscribe/ack against the broker.
function spawnClient(agentId: string) {
  return Bun.spawn(['bun', join(HERE, 'agent-channel.ts')], {
    env: { ...env, AGENT_ID: agentId },
    stdin: 'pipe', stdout: 'ignore', stderr: 'ignore',
  })
}
async function kill(p: { kill: (s?: number) => void; exited: Promise<number> }) {
  p.kill(); try { await p.exited } catch {}
}

// A raw SSE subscriber used as a passive peer (represents a session that only receives).
// Collects delivered message texts; does NOT ack, so we can assert live delivery independently.
function rawSubscriber(agent: string, session?: string) {
  const got: { id: number; from: string; text: string }[] = []
  const ctrl = new AbortController()
  ;(async () => {
    try {
      const qs = session ? `&session=${encodeURIComponent(session)}` : ''
      const res = await fetch(`${BUS}/subscribe?agent=${agent}${qs}`, { signal: ctrl.signal })
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { value, done } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true }); let i
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2)
          const line = frame.split('\n').find(l => l.startsWith('data: '))
          if (line) { try { got.push(JSON.parse(line.slice(6))) } catch {} }
        }
      }
    } catch {}
  })()
  return { got, stop: () => ctrl.abort() }
}

async function main() {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true })

  let broker = spawnBroker()
  check('broker starts + /status reachable', await waitPort(), BUS)

  // --- Acceptance 6: status endpoint shape ---
  const s0 = await status()
  check('status: shape { connected:[], pending:{} }',
    Array.isArray(s0.connected) && typeof s0.pending === 'object')

  // --- Acceptance 1: live delivery (toolmaker -> consumer), passive raw subscribers ---
  const consumer = rawSubscriber('consumer')
  const toolmaker = rawSubscriber('toolmaker')
  await waitFor(s => s.connected.includes('consumer') && s.connected.includes('toolmaker'))
  await send('toolmaker', 'shipped render_pcb_preview(path) -> PNG, drop the old workaround', 'consumer')
  await sleep(300)
  check('live delivery: consumer received directed message',
    consumer.got.some(m => m.from === 'toolmaker' && m.text.includes('render_pcb_preview')))
  check('live delivery: toolmaker did NOT receive its own directed message',
    !toolmaker.got.some(m => m.text.includes('render_pcb_preview')))

  // --- Acceptance 2: reply path (consumer -> toolmaker), symmetric ---
  await send('consumer', 'bug: render_pcb_preview throws on empty path', 'toolmaker')
  await sleep(300)
  check('reply path: toolmaker received reply',
    toolmaker.got.some(m => m.from === 'consumer' && m.text.includes('empty path')))

  // --- Acceptance 3: broadcast (to omitted) reaches all peers except sender ---
  const third = rawSubscriber('third')
  await waitFor(s => s.connected.includes('third'))
  const beforeC = consumer.got.length, beforeT = third.got.length
  await send('toolmaker', 'BROADCAST: bus migrated to v0.1.0')
  await sleep(300)
  check('broadcast: consumer received', consumer.got.slice(beforeC).some(m => m.text.includes('BROADCAST')))
  check('broadcast: third received', third.got.slice(beforeT).some(m => m.text.includes('BROADCAST')))
  check('broadcast: sender(toolmaker) did NOT receive its own broadcast',
    !toolmaker.got.some(m => m.text.includes('BROADCAST')))
  consumer.stop(); toolmaker.stop(); third.stop()
  await sleep(200)

  // --- Acceptance 4: offline durability via the REAL client (subscribe -> ack) ---
  // No subscriber for 'worker'. Send -> must sit pending. Then start real client -> redeliver+ack.
  await send('boss', 'task queued while you were offline', 'worker')
  check('offline: message pending for absent agent', (await status()).pending['worker'] === 1)

  const worker = spawnClient('worker')
  const acked = await waitFor(s => (s.pending['worker'] ?? 0) === 0, 8000)
  check('offline durability: real client redelivered + acked on connect', acked,
    JSON.stringify((await status()).pending))
  await kill(worker)
  await sleep(200)

  // --- Acceptance 5: broker-restart durability ---
  // Queue for an offline agent, kill broker, restart, assert message survived on disk + in /status.
  await send('boss', 'survive-the-restart', 'ghost')
  check('restart: pending before kill', (await status()).pending['ghost'] === 1)
  const diskBefore = existsSync(INBOX) ? readFileSync(INBOX, 'utf8') : ''
  check('restart: inbox.json persisted the message on disk', diskBefore.includes('survive-the-restart'))

  await kill(broker)
  await sleep(300)
  broker = spawnBroker()
  check('restart: broker back up', await waitPort())
  check('restart durability: message still pending after broker restart',
    (await status()).pending['ghost'] === 1, JSON.stringify((await status()).pending))

  await kill(broker)
  await sleep(300)

  // --- Self-heal: an idle client survives a broker restart and re-subscribes ---
  // Regression for the wedge bug: a hung reader.read() used to leave an idle client
  // permanently unsubscribed. Heartbeat + idle-watchdog must reconnect it automatically.
  broker = spawnBroker()
  await waitPort()
  const healer = spawnClient('healer')
  check('self-heal: client subscribed initially',
    await waitFor(s => s.connected.includes('healer'), 4000))
  // Kill the broker out from under the idle client, bring a fresh one up.
  await kill(broker)
  await sleep(200)
  broker = spawnBroker()
  await waitPort()
  // Without touching the client, it must re-appear as connected within ~watchdog+backoff.
  const rehealed = await waitFor(s => s.connected.includes('healer'), 6000)
  check('self-heal: idle client auto-reconnected after broker restart (no wedge)', rehealed,
    JSON.stringify((await status()).connected))
  // And it actually delivers again: send post-reconnect, expect ack (pending -> 0).
  await send('boss', 'post-heal delivery', 'healer')
  check('self-heal: delivers + acks after reconnect',
    await waitFor(s => (s.pending['healer'] ?? 0) === 0, 4000))
  await kill(healer)
  await kill(broker)

  // --- Acceptance 7: a once-announced NAME resolves to the session's CURRENT live
  // transport across a reconnect + rename (the peer-identity fix). Session 'sess-x'
  // announces 'alpha', drops that transport, reconnects under a NEW transport with a
  // NEW current name 'beta' (same session). A peer's send to the ORIGINAL name 'alpha'
  // MUST land live on the new transport — not blackhole in a stale inbox. ---
  broker = spawnBroker()
  await waitPort()
  const t1 = rawSubscriber('alpha', 'sess-x')
  check('identity: session announces alpha (connected)',
    await waitFor(s => s.connected.includes('alpha'), 4000))
  t1.stop() // drop the old transport
  await sleep(300)
  const t2 = rawSubscriber('beta', 'sess-x') // reconnect: new transport, new name, SAME session
  check('identity: reconnect under new name beta (connected)',
    await waitFor(s => s.connected.includes('beta'), 4000))
  // The OLD name must still resolve to the (now beta) live transport.
  check('identity: old name alpha still resolves to the live session',
    await waitFor(s => s.connected.includes('alpha'), 4000),
    JSON.stringify((await status()).connected))
  const beforeT2 = t2.got.length
  const sendRes = await send('peer', 'reaches the reconnected session via the old name', 'alpha')
  await sleep(300)
  check('identity: send to old name reported LIVE (not queued)',
    (sendRes as { live?: string[] }).live?.includes('alpha') === true, JSON.stringify(sendRes))
  check('identity: send to old name delivered live on the new transport',
    t2.got.slice(beforeT2).some(m => m.text.includes('reconnected session via the old name')))
  t2.stop()
  await kill(broker)

  rmSync(HOME, { recursive: true, force: true })

  console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
