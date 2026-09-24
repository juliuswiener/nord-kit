#!/usr/bin/env node
// PostToolUse — the skill hint MID-WORK. After every ~5.000 tokens of new work it asks
// Jev whether one of nord's skills would lift the next steps, and if so, appends a short
// suggestion to the context. A HINT, never a gate.
//
// What Jev sees is only the DIRECTION of the work: what the user said, what the agent
// said, what it thought. Tool calls and tool results are dropped — on the user's note
// that a skill can only be judged from the agent's mindset, not from some result. They
// made up 71 % of the work and 3 % was agent text.
//
// Measured 2026-09-24 (vault: audits/skill-hinweis-verlauf), exactly this instrument:
//   loudness   median ≤2 hints per ~100k tokens of work after dedupe, all three kinds
//   usefulness 23/30 suggestions judged useful by the catalogue owner (60-90 %)
//   cost       ~0.0001 $ per question, p95 384 ms — and it asks rarely
//
// Released for: sessions with a human at the terminal, orchestrator sessions, subagents
// (vault: decisions/arbeitsverlauf-darf-fuer-den-skill-hinweis-raus). NOT orch workers.
// Fail-SILENT everywhere. Never blocks a tool call on anything but its own 1 s cap.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");

const SWITCH_ENV = "NORD_SKILL_HINT_VERLAUF";
// Verbatim copy of audits/skill-hinweis-verlauf/frage.json (Fassung 2); the test pins it.
const FRAGE = path.join(__dirname, "skill-hint-verlauf.frage.json");
const THRESHOLD = 0.60;           // chosen in AK5 by the rule fixed before the run
const X_CHARS = 5000 * 4;         // ask after this much new work (tokens = chars / 4)
const ELEMENT_CAP = 8000;         // same cap as the measurement, or Jev sees other text
const TIMEOUT_MS = 1000;
const RICHTUNG = ["[NUTZER] ", "[AGENT] ", "[DENKT] "];

// ---------------------------------------------------------------- the instrument
// Everything from here to `ask` mirrors audits/skill-hinweis-verlauf/verlauf.py and
// schwaerzen.py. A drift between the two means the hook asks a question nobody measured;
// the cross-check against the Python is recorded in the vault audit.

// Python's json.dumps(x, ensure_ascii=False): ", " and ": " as separators. Only the
// LENGTH matters here (tool calls are counted, not sent), and the length decides where
// a chunk ends.
function pyDumps(x) {
  if (x === null || typeof x !== "object") return JSON.stringify(x === undefined ? null : x);
  if (Array.isArray(x)) return "[" + x.map(pyDumps).join(", ") + "]";
  return "{" + Object.keys(x).map((k) => JSON.stringify(k) + ": " + pyDumps(x[k])).join(", ") + "}";
}

function cap(s) {
  if (s.length <= ELEMENT_CAP) return s;
  return Array.from(s).slice(0, ELEMENT_CAP).join("");   // code points, like Python
}

function elements(o) {
  const t = o.type;
  if (t !== "user" && t !== "assistant") return [];
  const m = o.message;
  const c = m && typeof m === "object" ? m.content : undefined;
  const role = t === "user" ? "NUTZER" : "AGENT";
  // NOT capped — the measurement returned plain-string messages before its cap, and the
  // hook must ask the question that was measured. Found by the cross-check against
  // verlauf.py; the Python docstring claimed otherwise and was corrected.
  if (typeof c === "string") return c.trim() ? [`[${role}] ${c}`] : [];
  const out = [];
  for (const b of Array.isArray(c) ? c : []) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) out.push(`[${role}] ${b.text}`);
    else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) out.push(`[DENKT] ${b.thinking}`);
    else if (b.type === "tool_use") out.push(`[WERKZEUG ${b.name}] ${pyDumps(b.input === undefined ? {} : b.input)}`);
    else if (b.type === "tool_result") {
      let x = b.content;
      if (Array.isArray(x)) x = x.filter((y) => y && typeof y === "object").map((y) => y.text || "").join("\n");
      out.push(`[ERGEBNIS${b.is_error ? " FEHLER" : ""}] ${typeof x === "string" ? x : pyDumps(x)}`);
    }
  }
  return out.map(cap);
}

const KEY_PATTERNS = [
  ["pem", /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g],
  ["sk", /\bsk-[A-Za-z0-9_\-]{16,}/g],
  ["github", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ["aws", /\bAKIA[0-9A-Z]{16}\b/g],
  ["bearer", /\bBearer\s+[A-Za-z0-9._\-~+/]{16,}=*/gi],
];
const ASSIGN = /\b([A-Z0-9_]*(?:API_KEY|APIKEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Z0-9_]*)("?\s*[:=]\s*"?)([^\s"',;]{8,})/gi;
const MASK = "[SCHLUESSEL]";

// Counter fields, names of variables and placeholders look like secrets and are not —
// measured on 124 hits in the corpus. Same three exceptions as schwaerzen.py.
function isSecret(name, value) {
  const n = name.toUpperCase();
  if (n.endsWith("TOKENS")) return false;
  if (["_ENV", "_PATH", "_FILE", "_NAME", "_VAR"].some((s) => n.endsWith(s))) return false;
  if (["re.", "os.", "process.", "$", "${", "<", "{", "["].some((s) => value.startsWith(s))) return false;
  return value !== MASK;
}

function redact(text) {
  for (const [, rx] of KEY_PATTERNS) text = text.replace(rx, MASK);
  return text.replace(ASSIGN, (all, name, sep, value) => (isSecret(name, value) ? name + sep + MASK : all));
}

// ---------------------------------------------------------------- the state
function stateDir() {
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "nord", "skill-hint-verlauf");
}

function safe(s) { return String(s || "none").replace(/[^A-Za-z0-9_-]/g, "_"); }

function loadState(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return { offset: 0, acc: 0, keep: [], shown: [], orch: false }; }
}

// Reads what the transcript gained since the last call and cuts it into chunks the
// way the measurement did. Returns the direction text of the LAST complete chunk that
// has agent or thinking text, or null.
// ponytail: if one call completes several chunks (a huge tool dump), only the last one
// is asked about — the older ones are stale by the time the answer would arrive.
function advance(st, transcript) {
  let fd;
  try { fd = fs.openSync(transcript, "r"); } catch { return null; }
  let buf;
  try {
    const size = fs.fstatSync(fd).size;
    if (size < st.offset) { st.offset = 0; st.acc = 0; st.keep = []; }   // rotated or replaced
    buf = Buffer.alloc(size - st.offset);
    fs.readSync(fd, buf, 0, buf.length, st.offset);
  } finally { fs.closeSync(fd); }
  const end = buf.lastIndexOf(0x0a);
  if (end < 0) return null;                    // no complete line yet
  st.offset += end + 1;
  let last = null;
  for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === "assistant" && line.includes("mcp__orch__spawn_worker")) st.orch = true;
    for (const e of elements(o)) {
      st.acc += e.length + 1;
      if (RICHTUNG.some((p) => e.startsWith(p))) st.keep.push(e);
      if (st.acc >= X_CHARS) {
        if (st.keep.some((k) => k.startsWith("[AGENT] ") || k.startsWith("[DENKT] "))) last = st.keep.join("\n");
        st.acc = 0; st.keep = [];
      }
    }
  }
  return last;
}

// ---------------------------------------------------------------- the question
function ask(base, frage, state) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(base.replace(/\/+$/, "") + "/api/v1/systemone"); } catch { return resolve(null); }
    const body = JSON.stringify({
      model: frage.modell, state,
      questions: { skill: { type: frage.fragetyp, instructions: frage.instructions, criteria: frage.criteria } },
    });
    // No Authorization header: the bridge holds JEV_API_KEY.
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

function silent() { process.exit(0); }

async function main() {
  if (process.env[SWITCH_ENV] !== "jev") silent();
  const base = process.env.ANTHROPIC_BASE_URL;
  if (!base) silent();

  let input;
  try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { silent(); }
  if (!input.transcript_path || !input.session_id) silent();

  // A subagent's hook gets the PARENT's transcript path; its own lives next to it.
  const agent = input.agent_id || null;
  const transcript = agent
    ? path.join(input.transcript_path.replace(/\.jsonl$/, ""), "subagents", `agent-${agent}.jsonl`)
    : input.transcript_path;

  const dir = stateDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { silent(); }
  const key = `${safe(input.session_id)}--${safe(agent || "main")}`;
  const stateFile = path.join(dir, `${key}.json`);
  const lockFile = `${stateFile}.lock`;

  // Parallel tool calls fire parallel hooks. Whoever holds the lock reads; the others
  // step aside — the offset is kept, so the next call catches up with nothing lost.
  let lock;
  try { lock = fs.openSync(lockFile, "wx"); } catch {
    try { if (Date.now() - fs.statSync(lockFile).mtimeMs > 10000) fs.unlinkSync(lockFile); } catch { /* */ }
    silent();
  }
  const release = () => { try { fs.closeSync(lock); fs.unlinkSync(lockFile); } catch { /* */ } };

  try {
    const st = loadState(stateFile);
    const chunk = advance(st, transcript);
    // Released for humans, orchestrators and subagents — not for orch workers, which run
    // as sdk-cli and never spawn anyone.
    const allowed = process.env.CLAUDE_CODE_ENTRYPOINT === "cli" || agent !== null || st.orch;
    let hint = null;
    if (chunk && allowed) {
      const frage = JSON.parse(fs.readFileSync(FRAGE, "utf8"));
      const res = await ask(base, frage, redact(chunk));
      const probs = res && res.answers && res.answers.skill && res.answers.skill.probabilities;
      if (probs && typeof probs === "object") {
        let best = null, p = -1;
        for (const [k, v] of Object.entries(probs)) if (typeof v === "number" && v > p) { best = k; p = v; }
        if (best && best !== "none_of_these" && p >= THRESHOLD
            && Object.prototype.hasOwnProperty.call(frage.criteria, best) && !st.shown.includes(best)) {
          st.shown.push(best);
          hint = `Skill hint (nord-core/skill-hint-verlauf, Jev p=${p.toFixed(2)}): judging from the ` +
            `recent direction of the work, \`nord-core:${best}\` may improve the next steps — ` +
            `${frage.criteria[best]} A suggestion, not an instruction: use it if it fits, ` +
            `ignore it if not. Shown once per session.`;
        }
      }
    }
    fs.writeFileSync(stateFile, JSON.stringify(st));
    if (hint) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: hint },
      }));
    }
  } catch { /* silent */ } finally { release(); }
  process.exit(0);
}

if (require.main === module) main().catch(silent);
module.exports = { elements, redact, advance, pyDumps };
