#!/usr/bin/env bun
// Phase-3 gate: the SessionStart name hook, the Stop read hook, the SessionEnd close hook, and
// the operator CLI — each exercised against a real broker on an isolated port.
import { rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const HERE = import.meta.dir
const HOOKS = join(HERE, '..', 'hooks')
const PORT = 9079
const BUS = `http://127.0.0.1:${PORT}`
const HOME = join(HERE, '.e2e-hooks-home')
const env = { ...process.env, AGENTBUS_HOME: HOME, AGENTBUS_PORT: String(PORT), AGENTBUS_HEARTBEAT_MS: '250', AGENTBUS_GRACE_MS: '1000', AGENTBUS_SWEEP_MS: '250' }

let failures = 0
const check = (n: string, c: boolean, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`); if (!c) failures++ }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const status = () => fetch(`${BUS}/status`).then(r => r.json())
const post = (p: string, b: object) => fetch(`${BUS}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json())
async function waitPort(ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { try { await fetch(`${BUS}/status`); return true } catch {} await sleep(80) } return false }
async function waitFor(p: (s: any) => boolean, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (p(await status())) return true } catch {} await sleep(60) } return false }
const live = (s: any, name: string) => s.peers.some((p: any) => p.connected && p.names.includes(name))
const gone = (s: any, sid: string) => !s.peers.some((p: any) => p.session === sid)

// Run a hook (node) with piped stdin JSON + env; resolve on exit.
async function runHook(script: string, stdin: object, extra: Record<string, string> = {}) {
  const p = Bun.spawn(['node', join(HOOKS, script)], { env: { ...env, ...extra }, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
  p.stdin.write(JSON.stringify(stdin)); p.stdin.end()
  const out = await new Response(p.stdout).text(); try { await p.exited } catch {}
  return out
}
// Minimal raw SSE subscriber to register a session.
function sub(name: string, session: string) {
  const ctrl = new AbortController()
  ;(async () => { try { const res = await fetch(`${BUS}/subscribe?agent=${name}&session=${session}`, { signal: ctrl.signal }); const rd = res.body!.getReader(); for (;;) { const { done } = await rd.read(); if (done) break } } catch {} })()
  return { stop: () => ctrl.abort() }
}
async function cli(args: string[]) {
  const p = Bun.spawn(['bun', join(HERE, 'agentbus'), ...args], { env, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(p.stdout).text(); try { await p.exited } catch {}
  return out
}

async function main() {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true })
  const broker = Bun.spawn(['bun', join(HERE, 'bus.ts')], { env, stdout: 'ignore', stderr: 'ignore' })
  check('broker up', await waitPort(), BUS)

  // 1 — name hook: explicit verbatim; auto-derived is RESTART-STABLE (no session suffix) ----
  for (const sid of ['nh1', 'nh2', 'nh3']) try { rmSync(`/tmp/agentbus-name-${sid}`, { force: true }) } catch {}
  await runHook('agentbus-name.cjs', { source: 'startup' }, { CLAUDE_CODE_SESSION_ID: 'nh1', AGENT_ID: 'explicit-name' })
  check('1a explicit AGENT_ID used verbatim', readFileSync('/tmp/agentbus-name-nh1', 'utf8') === 'explicit-name')
  // Two different sessions, same cwd -> the derived name must be IDENTICAL (a restart reclaims it)
  // and must NOT carry a session fragment.
  await runHook('agentbus-name.cjs', { source: 'startup', session_title: '' }, { CLAUDE_CODE_SESSION_ID: 'nh2', AGENT_ID: '' })
  await runHook('agentbus-name.cjs', { source: 'startup', session_title: '' }, { CLAUDE_CODE_SESSION_ID: 'nh3', AGENT_ID: '' })
  const d2 = readFileSync('/tmp/agentbus-name-nh2', 'utf8'), d3 = readFileSync('/tmp/agentbus-name-nh3', 'utf8')
  check('1b auto-derived name is restart-stable (same across sessions, no session frag)',
    d2 === d3 && !d2.endsWith('-nh2') && !d2.endsWith('-nh3'), `${d2} == ${d3}`)
  for (const sid of ['nh1', 'nh2', 'nh3']) try { rmSync(`/tmp/agentbus-name-${sid}`, { force: true }) } catch {}

  // 2 — close hook deregisters the session --------------------------------------------------
  const c = sub('closeme', 'ch1'); await waitFor(s => live(s, 'closeme'))
  await runHook('agentbus-close.cjs', { session_id: 'ch1' }, { CLAUDE_CODE_SESSION_ID: 'ch1' })
  check('2 SessionEnd close hook removed the session', await waitFor(s => gone(s, 'ch1'), 2000))
  c.stop()

  // 3 — read hook marks acked messages as read (Tier-2) ------------------------------------
  const r = sub('rdr', 'rh1'); await waitFor(s => live(s, 'rdr'))
  const sr = await post('/send', { from_session: 'probe', from: 'probe', to: 'rdr', text: 'read via hook' })
  await post('/ack', { session: 'rh1', id: sr.id }) // client would ack on emit
  writeFileSync('/tmp/agentbus-unread-rh1.jsonl', JSON.stringify({ id: sr.id, from: 'probe' }) + '\n')
  await runHook('agentbus-read.cjs', { session_id: 'rh1' }, { CLAUDE_CODE_SESSION_ID: 'rh1' })
  await sleep(150)
  const rec = await fetch(`${BUS}/receipt?id=${sr.id}`).then(x => x.json())
  check('3 read hook marked the message read', rec.state === 'read', JSON.stringify(rec))
  try { rmSync('/tmp/agentbus-unread-rh1.jsonl', { force: true }) } catch {}
  r.stop()

  // 4 — CLI: peers lists a live peer; kill removes it --------------------------------------
  const k = sub('clipeer', 'cli1'); await waitFor(s => live(s, 'clipeer'))
  const peersOut = await cli(['peers'])
  check('4a `agentbus peers` lists the live peer', peersOut.includes('clipeer'), peersOut.split('\n').slice(0, 4).join(' | '))
  await cli(['kill', 'clipeer'])
  check('4b `agentbus kill` deregistered it', await waitFor(s => gone(s, 'cli1'), 2000))
  k.stop()

  broker.kill(); try { await broker.exited } catch {}
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true })
  console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
