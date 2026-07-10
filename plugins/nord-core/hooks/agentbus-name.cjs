#!/usr/bin/env node
// SessionStart hook: derive a stable agent name for this session, set it as the session title
// (automatic /rename-equivalent naming), and write it where the agentbus channel reads its
// identity (/tmp/agentbus-name-<session_id>). Removes the need for a manual AGENT_ID env — and
// with it the "${AGENT_ID}" unexpanded-var ghost peer. sessionTitle only takes effect on
// startup/resume (ignored on clear/compact), which is fine: the name-file is written every time.
const fs = require('fs')
const { execSync } = require('child_process')

let input = {}
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) } catch {}

// One-line debug of the raw SessionStart input, so the exact field --name lands in
// (session_title vs session_name vs …) is verifiable. Harmless; remove once confirmed.
try { fs.appendFileSync('/tmp/agentbus-hook-input.log', JSON.stringify(input) + '\n') } catch {}

const sid = process.env.CLAUDE_CODE_SESSION_ID || input.session_id || ''
const source = input.source || 'startup'

// --name may surface as session_title or session_name depending on version.
const launchName = input.session_title || input.session_name || ''

// Priority: explicit AGENT_ID env > an already-set session title (e.g. on resume) > git branch
// > project-dir basename. Never emit the literal "${AGENT_ID}" (a launch-quoting bug).
function pick() {
  const env = process.env.AGENT_ID
  if (env && env !== '${AGENT_ID}') return env
  if (launchName) return String(launchName)
  try {
    const b = execSync('git branch --show-current', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
    if (b) return b
  } catch {}
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  return dir.split('/').filter(Boolean).pop() || 'agent'
}

const name = pick()
if (sid) {
  try { fs.writeFileSync(`/tmp/agentbus-name-${sid}`, name) } catch {}
}

// Set the CC session title on real start/resume. Emit both the top-level and nested shapes so
// whichever the harness reads takes effect.
const out = {}
if (source === 'startup' || source === 'resume') {
  out.sessionTitle = name
  out.hookSpecificOutput = { hookEventName: 'SessionStart', sessionTitle: name }
}
process.stdout.write(JSON.stringify(out))
