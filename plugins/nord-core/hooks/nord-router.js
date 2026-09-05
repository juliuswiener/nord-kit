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

// Sections only the instructor can act on — picking an orch preset needs
// spawn_worker, and orch registers that tool only when ORCH_CAN_SPAWN is set,
// which is RoleMain and never a worker (router/permissions.go: "Only the
// instructor may spawn workers; gate the tool by capability"). A plain Claude
// Code session has no spawn_worker at all, so it is correctly excluded too.
//
// This is the same failure the table's own dagger marks one layer down: text
// naming a capability the reader does not have is worse than no text, because
// the reader acts on it and cannot learn why it failed.
if (!process.env.ORCH_CAN_SPAWN) {
  routing = routing.replace(/<!-- instructor-only -->[\s\S]*?<!-- \/instructor-only -->\n?/g, '');
}
// The markers themselves never reach the model, in either branch.
routing = routing.replace(/^<!-- \/?instructor-only -->\n?/gm, '');

// Compact inline fallback if ROUTING.md is missing.
if (!routing.trim()) {
  routing = [
    'NORD ROUTER — canonical task routing. Pick the named tool; do not improvise among duplicates.',
    'PLAN: plan. One axis, the artifact you want: --stage ideas (idea board, generative) | --stage shortlist (ranked, weak ones killed) | --stage spec (one question per round until requirements are pinned) | no stage = a plan from the tournament. Add --deep when being wrong is expensive.',
    'IMPLEMENT (anything behind a test/compiler/lint gate): implement. One axis, the input: --from task (one story, the only cell a worker may drive) | --from goal (decompose, run until all green) | --from plan (take the split from a finished plan). Add --parallel for disjoint stories.',
    'REVIEW: review. Axes: --scope diff|repo|plan (a change / a whole codebase / a plan before anyone builds it) | --lens security|a11y|claims | --deep (parallel specialists, every finding adversarially verified). Default: one pass over the diff.',
    'CLEANUP: multi-agent->nord-cleanup | quick->/simplify.',
    'DEBUG: causal->trace.',
    'RESEARCH: codebase->nord-codebase-research | web+docs->external-context | fallback->native WebSearch/WebFetch.',
    'VERIFY->verify. MEMORY->claude-mem mem-search. ORIENT->repo-map. TTY->run-interactive.',
    'NOT loaded: nord-web, nord-dev, nord-ee are off in settings.json — do not reach for their tools.',
  ].join('\n');
}

// BEHAVIOUR.md used to be read here and prepended. It was retired in 8fa5a860:
// its rules live in ~/.claude/CLAUDE.md, which Claude Code reads natively, needs
// no hook, and is not subject to the ~10 KB truncation that applies to hook
// output — the limit that had been silently discarding most of that file.

let out = '';
out += 'NORD ROUTER ACTIVE — follow this canonical tool routing (overrides ad-hoc choice among overlapping skills):\n\n' + routing;
process.stdout.write(out);
process.exit(0);
