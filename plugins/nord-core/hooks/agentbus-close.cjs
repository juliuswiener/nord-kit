#!/usr/bin/env node
// SessionEnd hook: when a Claude Code session ends, deregister it from the bus (POST /close, which
// GCs its names + inbox) and clean up its /tmp identity files. Belt-and-suspenders to the client's
// own stdio-close self-exit — if the client already left, /close is idempotent. Ensures a closed
// session leaves NO lingering registration for a peer to address. Best-effort; never blocks.
const fs = require('fs')
const http = require('http')

let input = {}
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) } catch {}
const sid = process.env.CLAUDE_CODE_SESSION_ID || input.session_id || ''
if (!sid) process.exit(0)

for (const f of [`/tmp/agentbus-name-${sid}`, `/tmp/agentbus-unread-${sid}.jsonl`]) {
  try { fs.rmSync(f, { force: true }) } catch {}
}

const body = JSON.stringify({ session: sid })
const req = http.request({
  host: '127.0.0.1', port: Number(process.env.AGENTBUS_PORT || 9000), path: '/close', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
}, res => { res.resume(); res.on('end', () => process.exit(0)) })
req.on('error', () => process.exit(0))
req.write(body); req.end()
setTimeout(() => process.exit(0), 2000)
