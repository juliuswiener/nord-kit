#!/usr/bin/env node
// nord-router — SessionStart hook.
// Emits the canonical task-routing policy as hidden session context so the agent
// picks ONE tool per task instead of improvising among overlapping duplicates.
// Single source of truth = ../ROUTING.md (read at runtime so edits propagate).

const fs = require('fs');
const path = require('path');
const os = require('os');

// Self-install the custom statusline to a stable path (statusLine config can't use
// ${CLAUDE_PLUGIN_ROOT}). Copy the latest nord-hud.mjs each session start so it stays
// fresh across plugin updates. Set settings.json statusLine to: node ~/.claude/hud/nord-hud.mjs
try {
  const cfgDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const src = path.join(__dirname, '..', 'hud', 'nord-hud.mjs');
  const dstDir = path.join(cfgDir, 'hud');
  const dst = path.join(dstDir, 'nord-hud.mjs');
  if (fs.existsSync(src)) {
    fs.mkdirSync(dstDir, { recursive: true });
    const a = fs.readFileSync(src, 'utf8');
    let b = '';
    try { b = fs.readFileSync(dst, 'utf8'); } catch {}
    if (a !== b) fs.writeFileSync(dst, a);
  }
} catch (e) { /* non-fatal */ }

let routing = '';
try {
  routing = fs.readFileSync(path.join(__dirname, '..', 'ROUTING.md'), 'utf8');
} catch (e) { /* fall through to inline */ }

// Compact inline fallback if ROUTING.md is missing.
if (!routing.trim()) {
  routing = [
    'NORD ROUTER — canonical task routing. Pick the named tool; do not improvise among duplicates.',
    'PLAN: default->nord-plan (parallel tournament) | vague/high-stakes->nord-plan --consensus | pin requirements first->nord-requirements.',
    'BRAINSTORM: decide->brainstorm-adversarial | explore->brainstorm.',
    'CODE-GEN (test/compiler/lint gate): gate-loop (cheap $0 worker + deterministic gate, escalate after 3 reds).',
    'EXECUTE: batch/no-gate->nord-execute | gated items->gate-loop | completion->ralph | parallel->team | full idea->code->autopilot | one file->executor.',
    'REVIEW: deep->nord-review | quick->/code-review | security->/security-review.',
    'CLEANUP: multi-agent->nord-cleanup | quick->/simplify.',
    'DEBUG: causal->trace | python->nord-dev:python-debugger.',
    'AUDIT: full->codebase-audit | quick->scrutinize-code.',
    'RESEARCH: web+docs->external-context | codebase->nord-codebase-research | fallback->native WebSearch.',
    'WEB-DATA/READ: read-router picks paradigm | normal page->web-scrape (Crawl4AI local) | anti-bot->web-scrape --stealth | PDF/doc->pdf-extract (MinerU) | visual/charts->visual-read. Sensitive=local only.',
    'VERIFY->verify. MEMORY->claude-mem mem-search. PRIME->deepinit.',
    'EE->kicad-analyze/spice-sim/digikey-search/bom-manager (nord-ee). RUST->rust-coder. PYTHON->python-ticket-implementer.',
  ].join('\n');
}

// Global behaviour rules (synced via nord-core).
let behaviour = '';
try { behaviour = fs.readFileSync(path.join(__dirname, '..', 'BEHAVIOUR.md'), 'utf8'); } catch (e) {}

let out = '';
if (behaviour.trim()) out += behaviour.trim() + '\n\n';
out += 'NORD ROUTER ACTIVE — follow this canonical tool routing (overrides ad-hoc choice among overlapping skills):\n\n' + routing;
process.stdout.write(out);
process.exit(0);
