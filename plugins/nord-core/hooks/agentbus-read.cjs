#!/usr/bin/env node
// Stop hook (Tier-2 read receipts). After a turn completes, drain this session's unread-msg-id
// file (written by the channel client when it emits a peer message) and POST /read so the broker
// marks those messages READ and pushes a "✓✓ read" receipt to each sender. Because Claude Code
// fires Stop only when the model actually ran a turn, a zombie/idle session never reaches here —
// so `read` means the message was genuinely processed, not merely emitted. Best-effort: never
// blocks or fails the turn; a missed drain simply leaves those messages at `delivered`.
const fs = require('fs')
const http = require('http')

let input = {}
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) } catch {}
const sid = process.env.CLAUDE_CODE_SESSION_ID || input.session_id || ''
if (!sid) process.exit(0)

const file = `/tmp/agentbus-unread-${sid}.jsonl`
let content = ''
try { content = fs.readFileSync(file, 'utf8') } catch { process.exit(0) }
const ids = [...new Set(
  content.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l).id } catch { return null } })
    .filter(x => typeof x === 'number'),
)]
if (!ids.length) process.exit(0)

// Remove only the prefix we consumed, preserving any lines the client appended concurrently.
function finish() {
  try {
    const now = fs.readFileSync(file, 'utf8')
    fs.writeFileSync(file, now.startsWith(content) ? now.slice(content.length) : '')
  } catch {}
  process.exit(0)
}

const body = JSON.stringify({ session: sid, ids })
const req = http.request({
  host: '127.0.0.1', port: Number(process.env.AGENTBUS_PORT || 9000), path: '/read', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
}, res => { res.resume(); res.on('end', finish) })
req.on('error', finish)
req.write(body); req.end()
setTimeout(() => process.exit(0), 2000) // never hang the turn
