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
  const dstDir = path.join(cfgDir, 'hud');
  fs.mkdirSync(dstDir, { recursive: true });

  const filesToCopy = ['nord-hud.mjs', 'fetch-prices.mjs'];
  for (const file of filesToCopy) {
    const src = path.join(__dirname, '..', 'hud', file);
    const dst = path.join(dstDir, file);
    if (fs.existsSync(src)) {
      const a = fs.readFileSync(src, 'utf8');
      let b = '';
      try { b = fs.readFileSync(dst, 'utf8'); } catch {}
      if (a !== b) fs.writeFileSync(dst, a);
    }
  }
} catch (e) { /* non-fatal */ }

// Record which plugin version THIS session is pinned to.
//
// Claude Code resolves ${CLAUDE_PLUGIN_ROOT} once per session and never again:
// "when a plugin updates mid-session, hook commands, monitors, MCP servers, and
// LSP servers keep using the previous version's path" (plugins-reference). There
// is no warning when that happens — a session can run a week-old plugin with no
// sign at all, and on 2026-08-19 one had been running an eight-day-old one.
//
// This hook is itself pinned, so __dirname IS the session's version, and writing
// it here is the only place that fact is available. nord-hud compares it against
// what is installed now and says so when they differ.
try {
  // Only when stdin is a pipe. SessionStart delivers JSON there and closes it,
  // but a hand-run hook on a TTY would block until the 5s timeout kills it and
  // the routing context below would silently never be emitted.
  if (!process.stdin.isTTY) {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const sid = payload.session_id;
    if (sid && /^[\w.-]+$/.test(sid)) {
      const cfgDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
      const dir = path.join(cfgDir, 'hud', 'pinned');
      fs.mkdirSync(dir, { recursive: true });
      const manifest = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
      fs.writeFileSync(path.join(dir, sid + '.json'),
        JSON.stringify({ version: manifest.version, root: path.resolve(__dirname, '..') }));
      // One file per session accumulates forever otherwise. A week outlives any
      // session and matches the grace period Claude Code gives orphaned version
      // directories, so a marker never outlives the tree it points at.
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch {}
      }
    }
  }
} catch (e) { /* non-fatal — a missing marker just means no staleness hint */ }

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
