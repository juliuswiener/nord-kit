#!/usr/bin/env node
// SessionStart hook: derive a STABLE, UNIQUE agent name for this session, set it as the session
// title, and write it where the agentbus channel reads its identity (/tmp/agentbus-name-<session_id>).
// Explicit names (AGENT_ID env / launch title) are used verbatim; AUTO-DERIVED names (git branch /
// project dir) get a short session fragment appended, so two sessions in the same repo/dir do not
// collide in the first place. The broker (name uniqueness) + client (name_taken retry) resolve any
// residual collision, but suffixing derived names avoids the churn. Never emits a bare shared token
// (the old collision factory) nor the literal "${AGENT_ID}" (a launch-quoting bug).
const fs = require('fs')
const { execSync } = require('child_process')

let input = {}
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) } catch {}

const sid = process.env.CLAUDE_CODE_SESSION_ID || input.session_id || ''
const source = input.source || 'startup'
const launchName = input.session_title || input.session_name || '' // --name surfaces under either

const frag = (sid || String(process.pid)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 4) || 'x'

function pick() {
  const env = process.env.AGENT_ID
  if (env && env !== '${AGENT_ID}') return env    // explicit env: verbatim
  if (launchName) return String(launchName)       // user-named: verbatim
  // Auto-derived → suffix a session fragment so it is unique per session.
  let base
  try {
    const b = execSync('git branch --show-current', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    if (b) base = b
  } catch {}
  if (!base) {
    const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
    base = dir.split('/').filter(Boolean).pop()
  }
  base = base || 'agent'
  return `${base}-${frag}`
}

const name = pick()
if (sid) { try { fs.writeFileSync(`/tmp/agentbus-name-${sid}`, name) } catch {} }

const out = {}
if (source === 'startup' || source === 'resume') {
  out.sessionTitle = name
  out.hookSpecificOutput = { hookEventName: 'SessionStart', sessionTitle: name }
}
process.stdout.write(JSON.stringify(out))
