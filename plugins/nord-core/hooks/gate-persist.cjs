#!/usr/bin/env node
// nord gate-persist — Stop-hook continuation+escalation enforcer for PRD-mode skills
// (`implement --from goal|plan`). The persistence GUARANTEE half of nord's
// persistent-mode, on nord's deterministic-gate engine — no gh-poll, no notifications,
// no LLM judge, no 8-mode zoo. (Fusion plan: minimal-glue, consensus 9/9/9.)
//
// On a stop attempt: if an active .nord/state/<mode>-state.json has unfinished PRD
// stories (passes:false) in .nord/prd.json, BLOCK the stop, atomically bump iteration,
// and re-inject what to do next — forcing escalation for any story stuck at >=3 reds.
// ALLOW the stop on: all stories green, iteration cap, or staleness. There is no other
// bypass — Claude Code's Stop hook payload carries no stop-reason field (measured on
// 2.1.261: session_id, transcript_path, cwd, prompt_id, permission_mode, hook_event_name,
// stop_hook_active, last_assistant_message, background_tasks, session_crons — nothing
// else), and the host already ends the turn before this hook runs on prompt-too-long,
// API/auth errors and Ctrl+C, and overrides a Stop hook after
// CLAUDE_CODE_STOP_HOOK_BLOCK_CAP ?? 8 consecutive blocks. A bypass keyed on those fields
// can never fire, so it is not deadlock protection, it is dead code (nord #213 is handled
// by the host, not by this hook).
//
// STATE CONTRACT (single-writer-per-field):
//   prd.json            — SKILL only (goal, stories[{id,desc,gate,passes,redCount,escalated,files?,lastFail?}])
//   state.json.iteration, .updatedAt — HOOK only (this file)
//   state.json.active/max/mode/startedAt/session_id — SKILL only, session_id is mandatory
//   nord-hud — read-only.

const fs = require("fs");
const path = require("path");

const STALE_MS = 2 * 60 * 60 * 1000; // 2h — never trap a session forever
const HARD_MAX = 8; // CC overrides a Stop hook after 8 consecutive blocks anyway

function readStdin() { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }
function allow() { process.exit(0); }            // no output => stop proceeds
function block(reason) { process.stdout.write(JSON.stringify({ decision: "block", reason })); process.exit(0); }

function atomicWrite(file, obj) {
  const tmp = file + ".tmp" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file); // atomic on same fs — nord-hud never reads a torn file
}

let input = {};
try { input = JSON.parse(readStdin() || "{}"); } catch {}

// resolve the repo root from cwd: walk up to the dir holding .nord (preferred, so a
// subproject's own loop wins) or .git; fallback = cwd (old behaviour). Fixes the
// nested-cwd / git-worktree bug where a raw cwd silently missed the repo-root .nord.
function findRoot(start) {
  let d = path.resolve(start);
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(d, ".nord")) || fs.existsSync(path.join(d, ".git"))) return d;
    const p = path.dirname(d);
    if (p === d) break;
    d = p;
  }
  return path.resolve(start);
}
const root = findRoot(input.cwd || process.cwd());
const sid = input.session_id || input.sessionId || "";
const stateDir = path.join(root, ".nord", "state");
const prdPath = path.join(root, ".nord", "prd.json");

let files = [];
try { files = fs.readdirSync(stateDir).filter((f) => f.endsWith("-state.json")); } catch { allow(); }

// load PRD stories once (SSOT). Fallback to embedded st.stories only if prd.json missing.
let prdStories = null;
try { const prd = JSON.parse(fs.readFileSync(prdPath, "utf8")); if (Array.isArray(prd.stories)) prdStories = prd.stories; } catch {}

for (const f of files) {
  const fp = path.join(stateDir, f);
  let st;
  try { st = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
  // A SIGNAL is not a mode state. cancel-signal-state.json ends in "-state.json"
  // and so passed the filename filter above, and it carries `active` and `mode`
  // like a real state does — so the file whose entire meaning is "stop looping"
  // was read as "a loop is running" and had its iteration bumped. Evidence on
  // disk: cancel-signal-state.json holds `iteration` and `updatedAt`, the two
  // fields this file's own header declares HOOK-only, next to
  // `"source": "state_clear"`.
  //
  // Discriminate by shape, not by name: a signal expires, durable state does not.
  // A name check would miss the next signal file someone adds.
  if (st && (st.expires_at || st.requested_at)) continue;
  if (!st || !st.active) continue;                                   // skill marked done/cancelled
  if (!st.session_id) continue;                                      // no session_id -> not this session's loop
  if (sid && st.session_id !== sid) continue;                        // another session's loop
  const ts = Date.parse(st.updatedAt || st.startedAt || "") || 0;
  if (ts && Date.now() - ts > STALE_MS) continue;                    // stale -> allow stop
  const iter = Number(st.iteration || 0);
  const max = Math.min(Number(st.max || HARD_MAX), HARD_MAX);        // clamp -> CC overrides past 8 anyway
  if (iter >= max) continue;                                         // cap -> allow stop, skill reports remaining

  const stories = prdStories || (Array.isArray(st.stories) ? st.stories : []);
  const red = stories.filter((s) => s && !s.passes);
  if (stories.length && red.length === 0) continue;                  // all green -> allow

  // HOOK OWNS iteration: bump atomically on every block (this is the real cap enforcement)
  try { st.iteration = iter + 1; st.updatedAt = new Date().toISOString(); atomicWrite(fp, st); } catch {}

  const mode = st.mode || f.replace("-state.json", "");
  const redIds = red.map((s) => s.id || s.desc || "?").join(", ") || "(stories not decomposed yet)";
  const stuck = red.filter((s) => Number(s.redCount || 0) >= 3 && !s.escalated);
  let reason =
    `[${mode}] not done — ${red.length}/${stories.length || "?"} stories still RED (${redIds}), ` +
    `iteration ${iter + 1}/${max}. Continue the implement loop: re-run each red story's deterministic gate ` +
    `via a gate-worker; set passes:true in .nord/prd.json only on exit 0. Do NOT stop until all stories ` +
    `pass or the cap is hit.`;
  if (stuck.length) {
    reason += ` ESCALATE NOW: ${stuck.map((s) => s.id || s.desc).join(", ")} hit >=3 consecutive red ` +
      `gates — the frontier (you) must fix it directly this round, then set escalated:true on its green. ` +
      `Do not re-dispatch the cheap worker on it.`;
  }
  block(reason);
}

allow();
