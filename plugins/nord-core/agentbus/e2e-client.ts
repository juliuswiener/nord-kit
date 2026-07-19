#!/usr/bin/env bun
// Phase-2 gate: the REAL agent-channel.ts client lifecycle against a real broker on an isolated
// port. Proves the anti-zombie guarantee (stdio-close / SIGTERM -> /close -> gone from the bus),
// name_taken retry under a unique suffix, and the Tier-2 unread-file data plane. Each client gets
// an EXPLICIT CLAUDE_CODE_SESSION_ID (never inherited) — the isolation the v1 harness lacked.
import { rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

const HERE = import.meta.dir
const PORT = 9078
const BUS = `http://127.0.0.1:${PORT}`
const HOME = join(HERE, '.e2e-client-home')
const env = {
  ...process.env, AGENTBUS_HOME: HOME, AGENTBUS_PORT: String(PORT), BUS_URL: BUS,
  AGENTBUS_HEARTBEAT_MS: '250', AGENTBUS_GRACE_MS: '1000', AGENTBUS_SWEEP_MS: '250',
}

let failures = 0
const check = (n: string, c: boolean, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`); if (!c) failures++ }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const status = () => fetch(`${BUS}/status`).then(r => r.json())
const send = (to: string, text: string) => fetch(`${BUS}/send`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from_session: 'probe', from: 'probe', to, text }),
}).then(r => r.json())
async function waitFor(p: (s: any) => boolean, ms = 4000) {
  const t = Date.now(); while (Date.now() - t < ms) { try { if (p(await status())) return true } catch {} await sleep(60) } return false
}
async function waitPort(ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { try { await fetch(`${BUS}/status`); return true } catch {} await sleep(80) } return false }
const live = (s: any, name: string) => s.peers.some((p: any) => p.connected && p.names.includes(name))
const gone = (s: any, sid: string) => !s.peers.some((p: any) => p.session === sid)

const cleanTmp = (sid: string) => { for (const f of [`/tmp/agentbus-name-${sid}`, `/tmp/agentbus-unread-${sid}.jsonl`]) if (existsSync(f)) rmSync(f, { force: true }) }
function spawnClient(session: string, name: string) {
  cleanTmp(session)
  return Bun.spawn(['bun', join(HERE, 'agent-channel.ts')], {
    env: { ...env, CLAUDE_CODE_SESSION_ID: session, AGENT_ID: name }, // EXPLICIT session — never inherited
    stdin: 'pipe', stdout: 'ignore', stderr: 'ignore',
  })
}

async function main() {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true })
  const broker = Bun.spawn(['bun', join(HERE, 'bus.ts')], { env, stdout: 'ignore', stderr: 'ignore' })
  check('broker up', await waitPort(), BUS)

  // 1 — stdio close -> client deregisters (/close) -> gone from the bus (anti-zombie) ----
  const z1 = spawnClient('sess-Z1', 'zombie1')
  check('1a client registered', await waitFor(s => live(s, 'zombie1')), 'zombie1')
  z1.stdin!.end() // simulate Claude Code exiting: close the client's stdin
  check('1b closing stdio removed it from the bus', await waitFor(s => gone(s, 'sess-Z1'), 3000))
  try { await z1.exited } catch {}

  // 2 — SIGTERM -> /close -> gone --------------------------------------------------------
  const z2 = spawnClient('sess-Z2', 'zombie2')
  check('2a client registered', await waitFor(s => live(s, 'zombie2')))
  z2.kill() // SIGTERM
  check('2b SIGTERM removed it from the bus', await waitFor(s => gone(s, 'sess-Z2'), 3000))
  try { await z2.exited } catch {}

  // 3 — name_taken: a second session claiming a held name retries under a unique suffix ---
  const u1 = spawnClient('sess-U1', 'dup')
  check('3a first holder connected as dup', await waitFor(s => live(s, 'dup')))
  const u2 = spawnClient('sess-U2', 'dup') // same name, different session
  const suffixed = await waitFor(s => s.peers.some((p: any) => p.connected && p.session === 'sess-U2' && p.names.some((n: string) => n.startsWith('dup-'))), 5000)
  check('3b second session took a unique suffixed name (dup-…)', suffixed,
    JSON.stringify((await status()).peers.filter((p: any) => p.session === 'sess-U2').map((p: any) => p.names)))
  check('3c original still holds bare dup', live(await status(), 'dup'))
  u1.kill(); u2.kill(); try { await u1.exited; await u2.exited } catch {}

  // 4 — Tier-2 unread data plane: an emitted message id is recorded for the Stop hook -----
  const r = spawnClient('sess-U3', 'reader')
  check('4a reader connected', await waitFor(s => live(s, 'reader')))
  const sr = await send('reader', 'hello reader')
  await sleep(400)
  const unreadFile = '/tmp/agentbus-unread-sess-U3.jsonl'
  const recorded = existsSync(unreadFile) && readFileSync(unreadFile, 'utf8').includes(`"id":${sr.id}`)
  check('4b emitted message id recorded in the unread file', recorded, `id=${sr.id}`)
  r.kill(); try { await r.exited } catch {}

  // 5 — no name-file + no AGENT_ID -> client derives a STABLE name (branch/dir), not raw UUID ----
  // (Covers the /reload-plugins gap: SessionStart didn't fire, so no name-file exists.)
  const dv = spawnClient('sess-DV', '') // AGENT_ID='' + cleanTmp removes any name-file
  const derived = await waitFor(s => s.peers.some((p: any) =>
    p.session === 'sess-DV' && p.names.length && !p.names.includes('sess-DV')), 4000)
  check('5 no name-file -> derived stable name (not raw UUID)', derived,
    JSON.stringify((await status()).peers.filter((p: any) => p.session === 'sess-DV').map((p: any) => p.names)))
  dv.kill(); try { await dv.exited } catch {}

  for (const sid of ['sess-Z1', 'sess-Z2', 'sess-U1', 'sess-U2', 'sess-U3', 'sess-DV']) cleanTmp(sid)
  broker.kill(); try { await broker.exited } catch {}
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true })
  console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
