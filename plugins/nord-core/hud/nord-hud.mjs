#!/usr/bin/env node
// nord-hud — custom Claude Code statusline.
// Reads the statusline JSON on stdin (CC >= 2.1.x) and prints one line:
//   host · branch · model · ctx% · 4h% · wk% · mode · goal
// Self-contained (node builtins only). Synced via nord-kit; the nord-router
// SessionStart hook copies this to ~/.claude/hud/nord-hud.mjs (stable path).

import { execSync, spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const cfgDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const pricesCachePath = path.join(cfgDir, 'hud', 'prices-cache.json');

let multipliers = {
  fable: '2x',
  mythos: '2x',
  opus: '1x',
  sonnet: '0.6x',
  haiku: '0.2x'
};

try {
  if (fs.existsSync(pricesCachePath)) {
    const cached = JSON.parse(fs.readFileSync(pricesCachePath, 'utf8'));
    multipliers = { ...multipliers, ...cached };
  }
} catch {}

// Trigger async background pricing fetch once a day
try {
  let shouldFetch = false;
  if (!fs.existsSync(pricesCachePath)) {
    shouldFetch = true;
  } else {
    const stats = fs.statSync(pricesCachePath);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs > 24 * 60 * 60 * 1000) {
      shouldFetch = true;
    }
  }
  if (shouldFetch) {
    const fetchScript = path.join(cfgDir, 'hud', 'fetch-prices.mjs');
    if (fs.existsSync(fetchScript)) {
      spawn(process.execPath, [fetchScript], {
        detached: true,
        stdio: 'ignore'
      }).unref();
    }
  }
} catch {}

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let s = {};
try { s = JSON.parse(raw || '{}'); } catch {}

const R = '\x1b[0m';
const SEP = '\x1b[38;5;240m·' + R;
const c = (code, t) => '\x1b[38;5;' + code + 'm' + t + R;
// usage gradient: green < 60, orange < 85, red >=85
const grad = (p) => p >= 85 ? 203 : p >= 60 ? 215 : 114;

const cwd = (s.workspace && s.workspace.current_dir) || s.cwd || process.cwd();
const parts = [];

// hostname (short)
parts.push(c(110, os.hostname().split('.')[0]));

// working dir (basename only; ~ for home)
const dir = cwd === os.homedir() ? '~' : (path.basename(cwd) || cwd);
parts.push(c(150, '' + dir));

// git branch + dirty marker
try {
  const br = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (br) {
    let dirty = '';
    try { dirty = execSync('git status --porcelain', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() ? '*' : ''; } catch {}
    parts.push(c(180, '⎇ ' + br + dirty));
  }
} catch {}

// model (shortened)
const m = (s.model && (s.model.display_name || s.model.id)) || '';
if (m) {
  const short = m.replace('Opus', 'O').replace('Sonnet', 'S').replace('Haiku', 'H')
    .replace(' (1M context)', '·1M').replace(/\s+/g, '');
  const mult = getModelMultiplier(m);
  const multText = mult ? ' (' + mult + ')' : '';
  const coloredMult = mult ? c(mult === '2x' ? 203 : mult === '1x' ? 215 : mult === '0.6x' ? 222 : 114, multText) : '';
  parts.push(c(146, short) + coloredMult);
}

// context window usage. CC reports context_window_size=200000 and caps
// used_percentage at 100 even on 1M-context sessions (exceeds_200k_tokens=true),
// so recompute against the real window from token counts when available.
const cw = s.context_window || {};
let cwSize = cw.context_window_size || 200000;
if (s.exceeds_200k_tokens && cwSize <= 200000) cwSize = 1000000;
let ctx = cw.used_percentage;
if (typeof cw.total_input_tokens === 'number' && cwSize)
  ctx = Math.round((cw.total_input_tokens / cwSize) * 100);
if (typeof ctx === 'number') parts.push(c(grad(ctx), 'ctx ' + Math.round(ctx) + '%'));

// rate limits (5h + 7d) from stdin
const rl = s.rate_limits || {};
const fh = rl.five_hour && rl.five_hour.used_percentage;
const wk = rl.seven_day && rl.seven_day.used_percentage;
if (typeof fh === 'number') parts.push(c(grad(fh), '4h ' + Math.round(fh) + '%') + resetTag(rl.five_hour && rl.five_hour.resets_at, 'time'));
if (typeof wk === 'number') parts.push(c(grad(wk), 'wk ' + Math.round(wk) + '%') + resetTag(rl.seven_day && rl.seven_day.resets_at, 'day'));

// active subagent(s) running right now (Task/Agent tool_use without tool_result)
const active = readActiveAgents(s.transcript_path);
if (active) parts.push(c(212, '▶ ' + active));

// active OMC/nord execution mode (best-effort, fresh state files only)
const mode = readMode(cwd, s.session_id);
if (mode) parts.push(c(215, '⚙ ' + mode));

// goal if set (best-effort)
const goal = readGoal(cwd);
if (goal) parts.push(c(114, '⊙ ' + goal.slice(0, 40)));

process.stdout.write(parts.join(' ' + SEP + ' '));

// Detect in-flight subagents by scanning the transcript tail for Task/Agent
// tool_use blocks that have no matching tool_result yet.
function readActiveAgents(transcriptPath) {
  if (!transcriptPath) return null;
  let buf;
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 262144); // last 256KB
    buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
  } catch { return null; }
  const lines = buf.toString('utf8').split('\n');
  const running = new Map(); // tool_use_id -> label
  const doneIds = new Set();
  for (const ln of lines) {
    if (!ln || (ln.indexOf('tool_use') < 0 && ln.indexOf('tool_result') < 0)) continue;
    let o; try { o = JSON.parse(ln); } catch { continue; }
    const content = o && o.message && o.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use' && (b.name === 'Task' || b.name === 'Agent')) {
        const inp = b.input || {};
        running.set(b.id, inp.subagent_type || inp.description || 'agent');
      } else if (b.type === 'tool_result' && b.tool_use_id) {
        doneIds.add(b.tool_use_id);
      }
    }
  }
  const live = [];
  for (const [id, label] of running) if (!doneIds.has(id)) live.push(label);
  if (!live.length) return null;
  const counts = {};
  for (const l of live) counts[l] = (counts[l] || 0) + 1;
  return Object.entries(counts).map(([k, v]) => v > 1 ? `${k}×${v}` : k).join(',');
}

// "↻HH:MM" (time) or "↻DdHH:MM" (day) reset hint, dim. Empty if no/invalid epoch.
function resetTag(epoch, kind) {
  if (typeof epoch !== 'number' || !epoch) return '';
  const ms = Math.abs(epoch) < 1e12 ? epoch * 1000 : epoch;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
  const txt = kind === 'day' ? '↻' + wd + hh + ':' + mm : '↻' + hh + ':' + mm;
  return ' \x1b[38;5;240m' + txt + R;
}

function fresh(p, maxMs) {
  try { return (Date.now() - fs.statSync(p).mtimeMs) < maxMs; } catch { return false; }
}
function readMode(cwd, sid) {
  const states = ['ralph', 'ultrawork', 'autopilot', 'ultragoal', 'team'];
  // .nord is the new state dir (renamed from .omc); read both so the indicator
  // works before and after the migration regardless of which the skills write.
  const dirs = ['.nord', '.omc'];
  const roots = [];
  for (const d of dirs) roots.push(path.join(cwd, d, 'state'), path.join(os.homedir(), d, 'state'));
  for (const base of roots) {
    for (const name of states) {
      const f = name + '-state.json';
      const cands = [sid ? path.join(base, 'sessions', sid, f) : null, path.join(base, f)].filter(Boolean);
      for (const p of cands) if (fresh(p, 30 * 60 * 1000)) return name;
    }
  }
  return null;
}
function readGoal(cwd) {
  const cands = [
    path.join(cwd, '.nord', 'goal.txt'),
    path.join(cwd, '.nord', 'ultragoal', 'goal.md'),
    path.join(cwd, '.omc', 'goal.txt'),
    path.join(cwd, '.omc', 'ultragoal', 'goal.md'),
    path.join(cwd, '.claude', 'goal.md'),
    path.join(os.homedir(), '.claude', 'goal.txt'),
  ];
  for (const p of cands) {
    try { const t = fs.readFileSync(p, 'utf8').trim(); if (t) return t.split('\n')[0].replace(/^#+\s*/, ''); } catch {}
  }
  return null;
}


function getModelMultiplier(modelNameOrId) {
  if (!modelNameOrId) return '';
  const name = modelNameOrId.toLowerCase();
  for (const [key, value] of Object.entries(multipliers)) {
    if (name.includes(key)) return value;
  }
  return '';
}
