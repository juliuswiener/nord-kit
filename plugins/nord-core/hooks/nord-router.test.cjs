#!/usr/bin/env node
// nord-router.test.cjs — what each role reads from the NORD ROUTER hook.
// Run: node nord-router.test.cjs [path-to-hook.js]
// Runs the real hook twice: without ORCH_CAN_SPAWN (a worker) and with it (the instructor).

const path = require("path");
const { spawnSync } = require("child_process");

const HOOK = path.resolve(process.argv[2] || path.join(__dirname, "nord-router.js"));

function render(env) {
  const base = { ...process.env };
  delete base.ORCH_CAN_SPAWN;
  const r = spawnSync("node", [HOOK], { env: { ...base, ...env }, encoding: "utf8", input: "{}" });
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
check("instructor: 'unconditionally' kept", instructor.includes("unconditionally"));
check("instructor: 'Yours to run' kept", instructor.includes("Yours to run"));
check("instructor: dagger explained", instructor.includes("`†` runs in the main session only"));

check("no marker text reaches either role", !worker.includes("instructor-only") && !instructor.includes("instructor-only"));

process.exit(failed ? 1 : 0);
