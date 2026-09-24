#!/usr/bin/env node
// UserPromptSubmit — ask Jev whether one of nord's skills would lift the answer to
// this prompt, and if so, append a short suggestion to the context. A HINT, never a
// gate: whether the skill is called stays the model's decision.
//
// Why it exists (vault: backlog/nord/skill-wahl-haengt-an-einer-prosatabelle-ohne-
// gezaehlte-trefferquote, audits/skill-hinweis): the router table calls the skill the
// default, measured it is the exception — 9 of 41 human sessions called one at all.
//
// Measured 2026-09-24 over 1.439 real human prompts, exactly this instrument:
//   loudness   median 1 hint per session after dedupe, max 9 in a 271-prompt session
//   usefulness 21/30 suggestions judged useful by the catalogue owner (53-87 %)
//   cost       0.00004 $ per prompt, latency p50 286 ms, p99 478 ms
//
// Every condition below narrows it to what was measured; outside that it stays silent.
// Fail-SILENT: any error, timeout or odd answer -> no output. Never block a prompt.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");

// Consent, on top of everything else. ANTHROPIC_BASE_URL is set in every session here,
// so keying off it alone would mean every prompt leaves the tailnet because an
// unrelated variable exists. Same reasoning as orch's ORCH_WRITE_ORACLE.
const SWITCH_ENV = "NORD_SKILL_HINT";

// The instrument is a verbatim copy of audits/skill-hinweis/frage.json; the test pins
// its sha256. Changing the wording or the options invalidates every number above.
const FRAGE = path.join(__dirname, "skill-hint.frage.json");

// Chosen in AK3 by the rule fixed before the run: the lowest threshold at which the
// negative control holds (trivial prompts under 5 %; at 0.50 it was 3.7 %).
const THRESHOLD = 0.50;

// The prompt waits on this. p99 was 478 ms; one second cuts ~0.1 % of calls.
const TIMEOUT_MS = 1000;

function silent() { process.exit(0); }

function memoPath(sessionId) {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_") || "unknown";
  return path.join(base, "nord", "skill-hint", `${safe}.json`);
}

// Once per session and skill. The measured loudness ASSUMES this: without it the
// longest session saw 34 raw hits instead of 9.
function seen(sessionId) {
  try { return new Set(JSON.parse(fs.readFileSync(memoPath(sessionId), "utf8"))); }
  catch { return new Set(); }
}

function remember(sessionId, set) {
  try {
    const p = memoPath(sessionId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify([...set]));
  } catch { /* a lost memo means one repeated hint, not a broken prompt */ }
}

function ask(base, frage, prompt) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(base.replace(/\/+$/, "") + "/api/v1/systemone"); }
    catch { return resolve(null); }
    const body = JSON.stringify({
      model: frage.modell,
      state: prompt,
      questions: { skill: {
        type: frage.fragetyp,
        instructions: frage.instructions,
        criteria: frage.criteria,
      } },
    });
    // No Authorization header: the bridge holds JEV_API_KEY. Sending a key from here
    // would reopen the question of who pays — orch pins the same absence.
    const req = (url.protocol === "https:" ? https : http).request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
    req.end(body);
  });
}

async function main() {
  if (process.env[SWITCH_ENV] !== "jev") silent();
  // Measured population: a human at a terminal. Orch workers run as sdk-cli and were
  // 9.104 of the 11.611 prompts the first, wrong count mistook for human ones.
  if (process.env.CLAUDE_CODE_ENTRYPOINT !== "cli") silent();
  const base = process.env.ANTHROPIC_BASE_URL;
  if (!base) silent();

  let input;
  try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { silent(); }
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  // Slash commands were not in the measured corpus; outside it, say nothing.
  if (!prompt.trim() || prompt.trimStart().startsWith("/")) silent();

  let frage;
  try { frage = JSON.parse(fs.readFileSync(FRAGE, "utf8")); } catch { silent(); }

  const res = await ask(base, frage, prompt);
  const answer = res && res.answers && res.answers.skill;
  const probs = answer && answer.probabilities;
  if (!probs || typeof probs !== "object") silent();

  let best = null, p = -1;
  for (const [k, v] of Object.entries(probs)) {
    if (typeof v === "number" && v > p) { best = k; p = v; }
  }
  if (!best || best === "none_of_these" || p < THRESHOLD) silent();
  if (!Object.prototype.hasOwnProperty.call(frage.criteria, best)) silent();

  const done = seen(input.session_id);
  if (done.has(best)) silent();
  done.add(best);
  remember(input.session_id, done);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        `Skill hint (nord-core/skill-hint, Jev p=${p.toFixed(2)}): ` +
        `\`nord-core:${best}\` may lift the quality here — ${frage.criteria[best]} ` +
        `A suggestion, not an instruction: call it if it fits, ignore it if not. ` +
        `Shown once per session.`,
    },
  }));
  process.exit(0);
}

main().catch(silent);
