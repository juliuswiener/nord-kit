#!/usr/bin/env node
// SessionStart hook: derive a RESTART-STABLE agent name for this session, set it as the session
// title, and write it where the agentbus channel reads its identity (/tmp/agentbus-name-<session_id>).
// The name is derived from STABLE keys (git branch, else project dir) — NOT the session id — so a
// restart of the same project reclaims the SAME name. We deliberately do NOT append a session
// fragment: that would make the name rotate on every restart. Genuine collisions between two
// DIFFERENT live sessions are resolved structurally by the broker (name_taken) + client (suffix
// retry), so pre-suffixing is unnecessary and harmful to stability. Distinct co-located agents
// (e.g. dev-1/dev-2 in one repo) can't be told apart by derivation — they use an explicit AGENT_ID
// or launch name, which is restart-stable by construction. Never emits the literal "${AGENT_ID}".
const fs = require('fs')
const { execSync } = require('child_process')

let input = {}
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) } catch {}

const sid = process.env.CLAUDE_CODE_SESSION_ID || input.session_id || ''
const source = input.source || 'startup'
const launchName = input.session_title || input.session_name || '' // --name surfaces under either

function pick() {
  const env = process.env.AGENT_ID
  if (env && env !== '${AGENT_ID}') return env    // explicit env: verbatim, restart-stable
  if (launchName) return String(launchName)       // user-named: verbatim
  // Auto-derived from a STABLE key so restarts reclaim the same name.
  let base
  try {
    const b = execSync('git branch --show-current', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    if (b) base = b
  } catch {}
  if (!base) {
    const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
    base = dir.split('/').filter(Boolean).pop()
  }
  return base || 'agent'
}

const name = pick()
if (sid) { try { fs.writeFileSync(`/tmp/agentbus-name-${sid}`, name) } catch {} }

const out = {}
if (source === 'startup' || source === 'resume') {
  out.sessionTitle = name
  out.hookSpecificOutput = { hookEventName: 'SessionStart', sessionTitle: name }
}
process.stdout.write(JSON.stringify(out))
