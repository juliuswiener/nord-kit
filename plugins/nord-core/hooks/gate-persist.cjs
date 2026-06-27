#!/usr/bin/env node
// nord gate-persist — Stop-hook continuation+escalation enforcer for PRD-mode skills
// (ralph/team/autopilot driving gate-loop). The persistence GUARANTEE half of omc's
// persistent-mode, on nord's deterministic-gate engine — no gh-poll, no notifications,
// no LLM judge, no 8-mode zoo. (Fusion plan: minimal-glue, consensus 9/9/9.)
//
// On a stop attempt: if an active .omc/state/<mode>-state.json has unfinished PRD
// stories (passes:false) in .omc/prd.json, BLOCK the stop, atomically bump iteration,
// and re-inject what to do next — forcing escalation for any story stuck at >=3 reds.
// ALLOW the stop on: all stories green, iteration cap, staleness, or a safety bypass
// (context-limit / >=95% context / user-abort / auth-error / session-cancel) so a
// blocked stop at full context can never DEADLOCK (omc #213).
//
// STATE CONTRACT (single-writer-per-field):
//   prd.json            — SKILL only (goal, stories[{id,desc,gate,passes,redCount,escalated,files?,lastFail?}])
//   state.json.iteration, .updatedAt — HOOK only (this file)
//   state.json.active/max/mode/startedAt/session_id — SKILL only
//   nord-hud — read-only.

const fs = require("fs");
const path = require("path");

const STALE_MS = 2 * 60 * 60 * 1000; // 2h — never trap a session forever
const HARD_MAX = 12;

function readStdin() { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }
function allow() { process.exit(0); }            // no output => stop proceeds
function block(reason) { process.stdout.write(JSON.stringify({ decision: "block", reason })); process.exit(0); }

function atomicWrite(file, obj) {
  const tmp = file + ".tmp" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file); // atomic on same fs — nord-hud never reads a torn file
}

// --- safety bypasses (allow stop; prevent compaction deadlock). Field names vary
// across CC versions, so check many keys. Ported from omc persistent-mode/context-guard. ---
function bypassReason(inp) {
  const reason = String(
    inp.stop_reason || inp.stopReason || inp.end_turn_reason || inp.reason || ""
  ).toLowerCase();
  if (/context|max_tokens|token limit|compact|overloaded/.test(reason)) return "context-limit";
  if (inp.user_abort || inp.userAbort || /abort|interrupt|cancel|user_stop/.test(reason)) return "user-abort";
  if (inp.auth_error || /unauthor|forbidden|401|403|invalid api key|rate.?limit|429/.test(reason)) return "auth-error";
  // context window near full -> let it compact rather than block
  const cw = inp.context_window || inp.contextWindow || {};
  const pct = Number(cw.used_percentage ?? cw.usedPercentage ?? inp.context_used_percentage ?? 0);
  if (pct >= 95) return "context-95pct";
  return null;
}

let input = {};
try { input = JSON.parse(readStdin() || "{}"); } catch {}

if (bypassReason(input)) allow(); // a safety condition -> never block

const cwd = input.cwd || process.cwd();
const sid = input.session_id || input.sessionId || "";
const stateDir = path.join(cwd, ".omc", "state");
const prdPath = path.join(cwd, ".omc", "prd.json");

let files = [];
try { files = fs.readdirSync(stateDir).filter((f) => f.endsWith("-state.json")); } catch { allow(); }

// load PRD stories once (SSOT). Fallback to embedded st.stories only if prd.json missing.
let prdStories = null;
try { const prd = JSON.parse(fs.readFileSync(prdPath, "utf8")); if (Array.isArray(prd.stories)) prdStories = prd.stories; } catch {}

for (const f of files) {
  const fp = path.join(stateDir, f);
  let st;
  try { st = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
  if (!st || !st.active) continue;                                   // skill marked done/cancelled
  if (st.session_id && sid && st.session_id !== sid) continue;       // another session's loop
  const ts = Date.parse(st.updatedAt || st.startedAt || "") || 0;
  if (ts && Date.now() - ts > STALE_MS) continue;                    // stale -> allow stop
  const iter = Number(st.iteration || 0);
  const max = Number(st.max || HARD_MAX);
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
    `iteration ${iter + 1}/${max}. Continue the gate-loop: re-run each red story's deterministic gate ` +
    `via a gate-worker; set passes:true in .omc/prd.json only on exit 0. Do NOT stop until all stories ` +
    `pass or the cap is hit.`;
  if (stuck.length) {
    reason += ` ESCALATE NOW: ${stuck.map((s) => s.id || s.desc).join(", ")} hit >=3 consecutive red ` +
      `gates — the frontier (you) must fix it directly this round, then set escalated:true on its green. ` +
      `Do not re-dispatch the cheap worker on it.`;
  }
  block(reason);
}

allow();
