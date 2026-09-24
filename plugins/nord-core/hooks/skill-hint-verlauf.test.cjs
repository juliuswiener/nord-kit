#!/usr/bin/env node
// skill-hint-verlauf.test.cjs — plain-node check for the mid-work skill hint.
// No framework. Run: node skill-hint-verlauf.test.cjs [path-to-hook.cjs]
//
// Builds real-shape transcripts, spawns the real hook with a real-shape PostToolUse
// payload against a local stand-in for the bridge, and looks at what goes out. The point
// is what does NOT go out: tool output, keys, orch workers — and what stays silent.
// Vault: backlog/nord/skill-hinweis-mitten-in-der-arbeit.

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

const HOOK = path.resolve(process.argv[2] || path.join(__dirname, "skill-hint-verlauf.cjs"));
const FRAGE = path.join(__dirname, "skill-hint-verlauf.frage.json");
// sha256 of audits/skill-hinweis-verlauf/frage.json (Fassung 2) in the vault.
const FRAGE_SHA = "b3fc3aa5960bef4140ba121b376b016ae59d0258792bd1a5a0a064f4cc708c66";

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${detail}`}`);
  if (!ok) failed++;
}

const reqs = [];
let reply = () => ({ status: 200, body: answer("diagnose", 0.8) });
const server = http.createServer((req, res) => {
  let d = "";
  req.on("data", (c) => { d += c; });
  req.on("end", () => {
    reqs.push({ url: req.url, headers: req.headers, body: d });
    const r = reply();
    const send = () => { res.writeHead(r.status, { "Content-Type": "application/json" }); res.end(r.body); };
    r.delayMs ? setTimeout(send, r.delayMs) : send();
  });
});

function answer(choice, p) {
  const probabilities = { none_of_these: (1 - p) * 0.6, verify: (1 - p) * 0.4, [choice]: p };
  return JSON.stringify({ answers: { skill: { type: "choice", choice, probabilities, confidence: p } } });
}

const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "skill-hint-verlauf-test-"));
let n = 0;

// Transcript lines in Claude Code's shape.
const L = {
  agent: (t) => ({ type: "assistant", message: { content: [{ type: "text", text: t }] } }),
  user: (t) => ({ type: "user", message: { content: t } }),
  tool: (name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } }),
  result: (t) => ({ type: "user", message: { content: [{ type: "tool_result", content: t }] } }),
};
const BIG = "x".repeat(7000);   // one tool result, ~7000 chars — three of them cross 20000

function transcript(lines, file) {
  const p = file || path.join(TMP, `t${++n}.jsonl`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
}

// A chunk of work that crosses the threshold and carries direction.
function arbeit(agentText) {
  return [L.user("fix the flaky sync test"), L.agent(agentText),
    L.tool("Bash", { command: "pytest" }), L.result(BIG),
    L.tool("Bash", { command: "pytest" }), L.result(BIG),
    L.tool("Bash", { command: "pytest" }), L.result(BIG)];
}

function run(tp, { session = `s${n}`, env = {}, agent } = {}) {
  return new Promise((resolve) => {
    const e = Object.assign({}, process.env, {
      NORD_SKILL_HINT_VERLAUF: "jev", CLAUDE_CODE_ENTRYPOINT: "cli",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, XDG_CACHE_HOME: TMP,
    }, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete e[k];
    const t0 = Date.now();
    const c = spawn(process.execPath, [HOOK], { env: e });
    let out = "";
    c.stdout.on("data", (d) => { out += d; });
    c.on("close", (code) => resolve({ code, out, ms: Date.now() - t0 }));
    const payload = { session_id: session, transcript_path: tp, cwd: "/tmp", hook_event_name: "PostToolUse",
      tool_name: "Bash", tool_input: { command: "pytest" }, tool_use_id: "t1", permission_mode: "default" };
    if (agent) Object.assign(payload, { agent_id: agent, agent_type: "general-purpose" });
    c.stdin.end(JSON.stringify(payload));
  });
}
const ctx = (r) => { try { return JSON.parse(r.out).hookSpecificOutput.additionalContext; } catch { return null; } };
const sent = () => { try { return JSON.parse(reqs[reqs.length - 1].body); } catch { return {}; } };

async function main() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  const sha = crypto.createHash("sha256").update(fs.readFileSync(FRAGE)).digest("hex");
  check("instrument is the measured frage.json (Fassung 2)", sha === FRAGE_SHA, sha);

  // --- below the threshold nothing is asked -------------------------------------
  reqs.length = 0;
  let tp = transcript([L.user("hi"), L.agent("I look at the test."), L.tool("Bash", { command: "ls" }), L.result("a b")]);
  let r = await run(tp, { session: "below" });
  check("under 5.000 tokens of work -> nothing asked", reqs.length === 0 && r.out === "", `${reqs.length} requests`);

  // --- crossing it asks, with the direction only ----------------------------------
  const KEY = "sk" + "-or-v1-" + "Q".repeat(30);   // built at runtime, never a literal key
  transcript(arbeit(`Third failure with the same message, no idea why. Key was ${KEY}`), tp);
  reply = () => ({ status: 200, body: answer("diagnose", 0.8) });
  r = await run(tp, { session: "below" });
  const s = sent();
  check("crossing 5.000 tokens -> one question", reqs.length === 1, `${reqs.length} requests`);
  check("hint names the skill", (ctx(r) || "").includes("nord-core:diagnose"), r.out);
  check("state carries the agent's words", (s.state || "").includes("[AGENT] Third failure"), s.state);
  check("state carries the user's words", (s.state || "").includes("[NUTZER] fix the flaky"), s.state);
  check("state carries NO tool call", !(s.state || "").includes("[WERKZEUG"), s.state && s.state.slice(0, 200));
  check("state carries NO tool result", !(s.state || "").includes("[ERGEBNIS") && !(s.state || "").includes(BIG.slice(0, 50)), "tool output leaked");
  check("key is replaced before it leaves", !(s.state || "").includes(KEY) && (s.state || "").includes("[SCHLUESSEL]"), s.state);
  check("carries NO Authorization header", !("authorization" in (reqs[0] || { headers: {} }).headers), "Authorization sent");
  check("model pinned, measured question",
    s.model === "typesafe/jev-1.13" && s.questions && s.questions.skill.instructions === JSON.parse(fs.readFileSync(FRAGE)).instructions, s.model);

  r = await run(tp, { session: "below" });
  check("same transcript again -> offset kept, nothing asked", reqs.length === 1 && r.out === "", `${reqs.length} requests`);

  // --- threshold, both sides -----------------------------------------------------
  reply = () => ({ status: 200, body: answer("plan", 0.59) });
  r = await run(transcript(arbeit("We should decide how to split this.")), { session: "t59" });
  check("p 0.59 -> silent", r.out === "", r.out);
  reply = () => ({ status: 200, body: answer("plan", 0.60) });
  r = await run(transcript(arbeit("We should decide how to split this.")), { session: "t60" });
  check("p 0.60 exactly -> hint", (ctx(r) || "").includes("nord-core:plan"), r.out);
  reply = () => ({ status: 200, body: answer("none_of_these", 0.95) });
  r = await run(transcript(arbeit("All green, moving on.")), { session: "none" });
  check("none_of_these on top -> silent", r.out === "", r.out);

  // --- once per session and skill -------------------------------------------------
  reply = () => ({ status: 200, body: answer("verify", 0.9) });
  tp = transcript(arbeit("Done, that should work now."));
  const a = await run(tp, { session: "dedupe" });
  transcript(arbeit("Also done with the footer, should work."), tp);
  const b = await run(tp, { session: "dedupe" });
  check("first verify hint -> shown", (ctx(a) || "").includes("nord-core:verify"), a.out);
  check("second verify hint, same session -> silent", b.out === "", b.out);

  // --- no direction, no question ---------------------------------------------------
  // The user's words alone are not enough: the measurement skipped chunks without agent
  // or thinking text. A chunk with NO direction text at all would stay silent for a
  // different reason (empty state) and prove nothing about this rule.
  reqs.length = 0;
  r = await run(transcript([L.user("please run the suite"), L.tool("Bash", { command: "x" }), L.result(BIG),
    L.tool("Bash", { command: "x" }), L.result(BIG), L.tool("Bash", { command: "x" }), L.result(BIG)]), { session: "nodir" });
  check("chunk with user text but no agent or thinking text -> nothing asked", reqs.length === 0 && r.out === "", `${reqs.length} requests`);

  // --- who is released ---------------------------------------------------------------
  reply = () => ({ status: 200, body: answer("diagnose", 0.9) });
  reqs.length = 0;
  r = await run(transcript(arbeit("Worker step, failing again.")), { session: "worker", env: { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" } });
  check("orch worker (sdk-cli, never spawns) -> nothing leaves", reqs.length === 0 && r.out === "", `${reqs.length} requests`);
  reqs.length = 0;
  r = await run(transcript([L.tool("mcp__orch__spawn_worker", { name: "w1" }), L.result("ok"), ...arbeit("The worker failed twice, unclear why.")]),
    { session: "orch", env: { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" } });
  check("orchestrator (sdk-cli, spawns workers) -> asked", reqs.length === 1 && (ctx(r) || "").includes("diagnose"), `${reqs.length} requests`);

  // Subagent: the payload carries the PARENT's transcript; the hook must read its own.
  reqs.length = 0;
  const parent = transcript([L.user("parent only"), L.agent("PARENT-TEXT")]);
  transcript(arbeit("SUB-TEXT failing in the subagent."), parent.replace(/\.jsonl$/, "") + "/subagents/agent-abc123.jsonl");
  r = await run(parent, { session: "sub", agent: "abc123", env: { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" } });
  const ss = sent().state || "";
  check("subagent -> asked, from its OWN transcript", reqs.length === 1 && ss.includes("SUB-TEXT") && !ss.includes("PARENT-TEXT"), ss.slice(0, 120));

  // --- off, or failing: silent, never an error -----------------------------------------
  reqs.length = 0;
  r = await run(transcript(arbeit("x fails")), { session: "off", env: { NORD_SKILL_HINT_VERLAUF: undefined } });
  check("switch off -> nothing leaves", reqs.length === 0 && r.out === "" && r.code === 0, `${reqs.length}`);
  reqs.length = 0;
  r = await run(transcript(arbeit("x fails")), { session: "nobase", env: { ANTHROPIC_BASE_URL: undefined } });
  check("no base url -> nothing leaves", reqs.length === 0 && r.out === "" && r.code === 0, `${reqs.length}`);
  for (const [name, f] of [
    ["bridge without key (503)", () => ({ status: 503, body: "{}" })],
    ["garbage answer", () => ({ status: 200, body: "nope" })],
    ["skill outside the catalogue", () => ({ status: 200, body: answer("rm-rf", 0.99) })],
  ]) {
    reply = f;
    r = await run(transcript(arbeit("x fails")), { session: `f-${name}` });
    check(`${name} -> silent, exit 0`, r.out === "" && r.code === 0, `code=${r.code} out=${r.out}`);
  }
  reply = () => ({ status: 200, body: answer("diagnose", 0.99), delayMs: 3000 });
  r = await run(transcript(arbeit("x fails")), { session: "slow" });
  check("slow bridge -> silent", r.out === "", r.out);
  check("slow bridge -> gives up within ~1 s", r.ms < 1800, `${r.ms} ms`);

  // A held lock (a parallel hook) -> step aside, keep the offset, catch up next time.
  reply = () => ({ status: 200, body: answer("review", 0.9) });
  tp = transcript(arbeit("Big diff done, please check it."));
  const lockDir = path.join(TMP, "nord", "skill-hint-verlauf");
  fs.mkdirSync(lockDir, { recursive: true });
  const lock = path.join(lockDir, "locked--main.json.lock");
  fs.writeFileSync(lock, "");
  reqs.length = 0;
  r = await run(tp, { session: "locked" });
  check("lock held -> steps aside", reqs.length === 0 && r.out === "", `${reqs.length}`);
  fs.unlinkSync(lock);
  r = await run(tp, { session: "locked" });
  check("lock free -> catches up", (ctx(r) || "").includes("nord-core:review"), r.out);

  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : "\nall ok");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
