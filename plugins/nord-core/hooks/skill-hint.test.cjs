#!/usr/bin/env node
// skill-hint.test.cjs — plain-node check for the UserPromptSubmit skill hint.
// No framework. Run: node skill-hint.test.cjs [path-to-hook.cjs]
//
// Spawns the real hook with a real-shape payload against a local stand-in for the
// bridge, and looks at what actually goes out and what comes back. The point is the
// SILENT paths: a hint that fires where it should not is noise, and a hook that hangs
// or errors puts itself in front of every prompt.
// Vault: backlog/nord/skill-wahl-haengt-an-einer-prosatabelle-ohne-gezaehlte-trefferquote.

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

const HOOK = path.resolve(process.argv[2] || path.join(__dirname, "skill-hint.cjs"));
const FRAGE = path.join(__dirname, "skill-hint.frage.json");
// sha256 of audits/skill-hinweis/frage.json in the vault, the instrument every
// published number was measured with.
const FRAGE_SHA = "cb8e6ddb5f289f78b8fc51fb1a509a1932bb0e61b4f2bb388ad6d645a657d465";

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${detail}`}`);
  if (!ok) failed++;
}

// The bridge stand-in. `reply` decides per request; every request is recorded.
const seenReqs = [];
let reply = () => ({ status: 200, body: answer("diagnose", 0.83) });
const server = http.createServer((req, res) => {
  let data = "";
  req.on("data", (c) => { data += c; });
  req.on("end", () => {
    seenReqs.push({ url: req.url, headers: req.headers, body: data });
    const r = reply();
    const send = () => { res.writeHead(r.status, { "Content-Type": "application/json" }); res.end(r.body); };
    r.delayMs ? setTimeout(send, r.delayMs) : send();
  });
});

// The remainder is spread over two other options, the way real answers look. A fixture
// that puts all of 1-p on none_of_these makes p=0.50 a tie, and a tie is not the case
// the threshold test is about.
function answer(choice, p) {
  const probabilities = { none_of_these: (1 - p) * 0.6, verify: (1 - p) * 0.4, [choice]: p };
  return JSON.stringify({ answers: { skill: { type: "choice", choice, probabilities, confidence: p } } });
}

const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "skill-hint-test-"));

function run({ prompt = "warum faellt der test nur in CI um?", session = "s1", env = {} } = {}) {
  return new Promise((resolve) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const e = Object.assign({}, process.env, {
      NORD_SKILL_HINT: "jev",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      ANTHROPIC_BASE_URL: base,
      XDG_CACHE_HOME: TMP,
    }, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete e[k];
    const t0 = Date.now();
    const child = spawn(process.execPath, [HOOK], { env: e });
    let out = "", err = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.on("close", (code) => resolve({ code, out, err, ms: Date.now() - t0 }));
    child.stdin.end(JSON.stringify({
      session_id: session, transcript_path: "/tmp/t.jsonl", cwd: "/tmp",
      permission_mode: "default", hook_event_name: "UserPromptSubmit", prompt,
    }));
  });
}

function ctx(r) {
  try { return JSON.parse(r.out).hookSpecificOutput.additionalContext; } catch { return null; }
}

async function main() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  // --- the instrument is the measured one --------------------------------------
  const sha = crypto.createHash("sha256").update(fs.readFileSync(FRAGE)).digest("hex");
  check("instrument is the measured frage.json", sha === FRAGE_SHA,
    `sha256 ${sha} — the wording or options changed, every published number is void`);

  // --- it speaks where it should ------------------------------------------------
  seenReqs.length = 0;
  reply = () => ({ status: 200, body: answer("diagnose", 0.83) });
  let r = await run({ session: "speaks" });
  const c = ctx(r);
  check("p 0.83 on diagnose -> hint", c && c.includes("nord-core:diagnose"), `out=${r.out} err=${r.err}`);
  check("hint carries the probability", c && c.includes("0.83"), c);
  check("hint says it is a suggestion", c && /suggestion, not an instruction/.test(c), c);

  const q = seenReqs[0] || {};
  let body = {};
  try { body = JSON.parse(q.body); } catch { /* checked below */ }
  const frage = JSON.parse(fs.readFileSync(FRAGE, "utf8"));
  check("asks the bridge path", q.url === "/api/v1/systemone", q.url);
  check("carries NO Authorization header", q.headers && !("authorization" in q.headers),
    `Authorization=${q.headers && q.headers.authorization} — the key belongs to the bridge`);
  check("model pinned", body.model === "typesafe/jev-1.13", body.model);
  check("state is the prompt and nothing else", body.state === "warum faellt der test nur in CI um?", body.state);
  check("question is the measured one",
    body.questions && JSON.stringify(body.questions.skill.criteria) === JSON.stringify(frage.criteria)
    && body.questions.skill.instructions === frage.instructions, JSON.stringify(body.questions).slice(0, 200));

  // --- the threshold, both sides pinned -----------------------------------------
  reply = () => ({ status: 200, body: answer("plan", 0.49) });
  r = await run({ session: "below" });
  check("p 0.49 -> silent", r.out === "", r.out);
  reply = () => ({ status: 200, body: answer("plan", 0.50) });
  r = await run({ session: "at" });
  check("p 0.50 exactly -> hint", (ctx(r) || "").includes("nord-core:plan"), r.out);

  reply = () => ({ status: 200, body: answer("none_of_these", 0.97) });
  r = await run({ session: "none" });
  check("none_of_these on top -> silent", r.out === "", r.out);

  // --- once per session and skill -----------------------------------------------
  reply = () => ({ status: 200, body: answer("research", 0.9) });
  const a = await run({ session: "dedupe" });
  const b = await run({ session: "dedupe" });
  check("first research hint in a session -> shown", (ctx(a) || "").includes("nord-core:research"), a.out);
  check("second research hint in the same session -> silent", b.out === "", b.out);
  reply = () => ({ status: 200, body: answer("review", 0.9) });
  r = await run({ session: "dedupe" });
  check("a different skill in the same session -> shown", (ctx(r) || "").includes("nord-core:review"), r.out);
  reply = () => ({ status: 200, body: answer("research", 0.9) });
  r = await run({ session: "other-session" });
  check("same skill, other session -> shown", (ctx(r) || "").includes("nord-core:research"), r.out);

  // --- the silent paths: none may output, none may error --------------------------
  const silentCases = [
    ["switch off", { env: { NORD_SKILL_HINT: undefined } }, true],
    ["switch set to something else", { env: { NORD_SKILL_HINT: "1" } }, true],
    ["worker session (sdk-cli)", { env: { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" } }, true],
    ["no base url", { env: { ANTHROPIC_BASE_URL: undefined } }, true],
    ["slash command", { prompt: "/compact" }, true],
    ["empty prompt", { prompt: "   " }, true],
  ];
  reply = () => ({ status: 200, body: answer("diagnose", 0.99) });
  for (const [name, opts, noRequest] of silentCases) {
    seenReqs.length = 0;
    r = await run(Object.assign({ session: `silent-${name}` }, opts));
    check(`${name} -> silent, exit 0`, r.out === "" && r.code === 0, `code=${r.code} out=${r.out}`);
    if (noRequest) check(`${name} -> nothing leaves the machine`, seenReqs.length === 0,
      `${seenReqs.length} request(s) sent`);
  }

  const failures = [
    ["bridge without key (503)", () => ({ status: 503, body: '{"error":"no key"}' })],
    ["network error at the bridge (502)", () => ({ status: 502, body: "{}" })],
    ["garbage answer", () => ({ status: 200, body: "not json" })],
    ["answer of another shape", () => ({ status: 200, body: '{"answers":{"skill":{"noul":0.9}}}' })],
    ["skill outside the catalogue", () => ({ status: 200, body: answer("rm-rf-everything", 0.99) })],
  ];
  for (const [name, f] of failures) {
    reply = f;
    r = await run({ session: `fail-${name}` });
    check(`${name} -> silent, exit 0`, r.out === "" && r.code === 0, `code=${r.code} out=${r.out}`);
  }

  // A prompt must not wait on someone else's uptime.
  reply = () => ({ status: 200, body: answer("diagnose", 0.99), delayMs: 3000 });
  r = await run({ session: "slow" });
  check("slow bridge -> silent", r.out === "", r.out);
  check("slow bridge -> gives up within ~1 s", r.ms < 1800, `waited ${r.ms} ms`);

  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : "\nall ok");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
