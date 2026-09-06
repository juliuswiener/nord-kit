#!/usr/bin/env node
// gate-persist.test.cjs — plain-node check for the Stop-hook block/allow contract.
// No framework, no fixtures. Run: node gate-persist.test.cjs [path-to-hook.cjs]
// (defaults to the sibling gate-persist.cjs; pass a copy of an old version to confirm
// a fixed bug used to be red there — see gate-persist-contract.md).
//
// Builds a temp repo with .nord/state/<mode>-state.json + .nord/prd.json and spawns the
// hook with a real-shape ten-key Stop payload on stdin (measured on Claude Code 2.1.261).

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const HOOK = path.resolve(process.argv[2] || path.join(__dirname, "gate-persist.cjs"));

function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-persist-test-"));
  fs.mkdirSync(path.join(root, ".nord", "state"), { recursive: true });
  return root;
}

function writeState(root, mode, state) {
  fs.writeFileSync(path.join(root, ".nord", "state", `${mode}-state.json`), JSON.stringify(state, null, 2));
}

function writePrd(root, stories) {
  fs.writeFileSync(path.join(root, ".nord", "prd.json"), JSON.stringify({ goal: "g", stories }, null, 2));
}

// The real Stop payload has exactly these ten keys — nothing else, no stop-reason field.
function payload(overrides) {
  return Object.assign(
    {
      session_id: "s",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/tmp",
      prompt_id: "p1",
      permission_mode: "default",
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "done",
      background_tasks: [],
      session_crons: [],
    },
    overrides
  );
}

function runHook(input) {
  return spawnSync("node", [HOOK], { input: JSON.stringify(input), encoding: "utf8", timeout: 5000 });
}

function isBlock(r) {
  const out = (r.stdout || "").trim();
  if (!out) return false;
  try {
    return JSON.parse(out).decision === "block";
  } catch {
    return false;
  }
}

function isAllow(r) {
  return (r.stdout || "").trim() === "";
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
}

const redStory = [{ id: "s1", desc: "d1", passes: false, redCount: 0 }];

// (a) red story + matching session_id -> block
{
  const root = mkRepo();
  writePrd(root, redStory);
  writeState(root, "implement", {
    mode: "implement",
    active: true,
    session_id: "sess-a",
    iteration: 0,
    max: 8,
    startedAt: new Date().toISOString(),
  });
  const r = runHook(payload({ cwd: root, session_id: "sess-a" }));
  check("(a) red story + matching session_id -> block", r.status === 0 && isBlock(r), `exit=${r.status} stdout=${JSON.stringify(r.stdout)}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// (b) state without session_id -> allow (not this session's loop)
{
  const root = mkRepo();
  writePrd(root, redStory);
  writeState(root, "implement", {
    mode: "implement",
    active: true,
    iteration: 0,
    max: 8,
    startedAt: new Date().toISOString(),
  });
  const r = runHook(payload({ cwd: root, session_id: "sess-b" }));
  check("(b) state without session_id -> allow", r.status === 0 && isAllow(r), `exit=${r.status} stdout=${JSON.stringify(r.stdout)}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// (c) stop_reason: context_limit + user_abort: true on the payload -> still block, the
// bypass classes are gone and these fields never appear on a real Stop payload anyway.
{
  const root = mkRepo();
  writePrd(root, redStory);
  writeState(root, "implement", {
    mode: "implement",
    active: true,
    session_id: "sess-c",
    iteration: 0,
    max: 8,
    startedAt: new Date().toISOString(),
  });
  const r = runHook(payload({ cwd: root, session_id: "sess-c", stop_reason: "context_limit", user_abort: true }));
  check("(c) stop_reason/user_abort on payload -> still block", r.status === 0 && isBlock(r), `exit=${r.status} stdout=${JSON.stringify(r.stdout)}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// (d) iteration 8 with max 12 in state -> allow (max clamped to 8)
{
  const root = mkRepo();
  writePrd(root, redStory);
  writeState(root, "implement", {
    mode: "implement",
    active: true,
    session_id: "sess-d",
    iteration: 8,
    max: 12,
    startedAt: new Date().toISOString(),
  });
  const r = runHook(payload({ cwd: root, session_id: "sess-d" }));
  check("(d) iteration 8 / max 12 in state -> allow (clamped to 8)", r.status === 0 && isAllow(r), `exit=${r.status} stdout=${JSON.stringify(r.stdout)}`);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`gate-persist.test.cjs — hook under test: ${HOOK}\n`);
let failed = 0;
for (const { name, pass, detail } of results) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `  (${detail})`}`);
  if (!pass) failed++;
}
process.exit(failed ? 1 : 0);
