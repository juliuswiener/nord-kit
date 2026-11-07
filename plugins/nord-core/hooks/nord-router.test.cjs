#!/usr/bin/env node
// nord-router.test.cjs — what each role reads from the NORD ROUTER hook.
// Run: node nord-router.test.cjs [path-to-hook.js]
// Runs the real hook twice: without ORCH_CAN_SPAWN (a worker) and with it (the instructor).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOK = path.resolve(process.argv[2] || path.join(__dirname, "nord-router.js"));

function render(env, payload = {}, hook = HOOK) {
  const base = { ...process.env };
  delete base.ORCH_CAN_SPAWN;
  const r = spawnSync("node", [hook], { env: { ...base, ...env }, encoding: "utf8", input: JSON.stringify(payload) });
  if (r.status !== 0) throw new Error(`hook exit ${r.status}: ${r.stderr}`);
  return r.stdout;
}

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
}

const worker = render({});
const instructor = render({ ORCH_CAN_SPAWN: "1" });

// The worker reads no rule or catalogue it cannot act on...
check("worker: no 'Not loaded' section", !worker.includes("Not loaded"));
check("worker: no 'unconditionally' (Workflow/Task denial)", !worker.includes("unconditionally"));
check("worker: no 'Yours to run' memory rule", !worker.includes("Yours to run"));
// ...but still learns what the dagger in its table means.
check("worker: dagger is still explained", worker.includes("`†` runs in the main session only"));
check("worker: table is still there", worker.includes("| **Implement**"));

check("instructor: 'Not loaded' kept", instructor.includes("Not loaded"));
check("instructor: names the off plugins, not their tools", instructor.includes("`nord-ee`") && !instructor.includes("kicad-analyze"));
check("instructor: 'unconditionally' kept", instructor.includes("unconditionally"));
check("instructor: 'Yours to run' kept", instructor.includes("Yours to run"));
check("instructor: dagger explained", instructor.includes("`†` runs in the main session only"));

check("no marker text reaches either role", !worker.includes("instructor-only") && !instructor.includes("instructor-only"));

// Skills are called by their full name: the short `plan` hits the built-in command /plan ("plan is a
// UI command, not a skill") and costs a turn. The table and the inline fallback must say the same names.
const SKILLS = ["plan", "implement", "review", "cleanup", "diagnose", "research", "orient", "verify", "commit-message", "interactive", "abort"];
const defaultCells = (text) => text.split("\n").filter((l) => l.startsWith("| **")).map((l) => l.split(/(?<!\\)\|/)[2].trim());
for (const [role, text] of [["worker", worker], ["instructor", instructor]]) {
  const cells = defaultCells(text);
  const short = SKILLS.filter((s) => !cells.some((c) => c.startsWith("`nord-core:" + s + "`")));
  check(`${role}: the Default column names all ${SKILLS.length} skills nord-core:<name>${short.length ? ` (missing: ${short.join(", ")})` : ""}`, short.length === 0);
}
// The fallback is what the hook says when ROUTING.md is missing: run a copy of it with none beside it.
const lone = fs.mkdtempSync(path.join(os.tmpdir(), "nord-router-"));
fs.mkdirSync(path.join(lone, "hooks"));
fs.copyFileSync(HOOK, path.join(lone, "hooks", "nord-router.js"));
const fallback = render({}, {}, path.join(lone, "hooks", "nord-router.js"));
fs.rmSync(lone, { recursive: true, force: true });
check("fallback (no ROUTING.md): the hook emits its inline routing", fallback.includes("canonical task routing"));
const fallbackShort = SKILLS.filter((s) => !new RegExp(`nord-core:${s}(?![\\w-])`).test(fallback));
check(`fallback: names all ${SKILLS.length} skills nord-core:<name>${fallbackShort.length ? ` (missing: ${fallbackShort.join(", ")})` : ""}`, fallbackShort.length === 0);

// A fork replays its parent's transcript, which already holds the router: say nothing twice.
check("fork start: no output", render({}, { source: "fork" }) === "");
for (const source of ["startup", "resume", "clear", "compact"]) {
  check(`${source} start: router emitted`, render({}, { source }).includes("NORD ROUTER ACTIVE"));
}

process.exit(failed ? 1 : 0);
