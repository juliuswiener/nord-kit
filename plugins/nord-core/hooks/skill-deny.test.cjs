#!/usr/bin/env node
// skill-deny.test.cjs — payload checks for the PreToolUse(Skill) deny list.
// Run: node skill-deny.test.cjs [path-to-hook.cjs]
// Pipes real-shape PreToolUse payloads into the hook. DENY is read out of the hook's
// own source (not re-typed here) so the test cannot drift from the list it checks.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOK = path.resolve(process.argv[2] || path.join(__dirname, "skill-deny.cjs"));

// The hook is a script, not a module: requiring it would read this process's stdin
// and call process.exit(0). Pull DENY out of the source text instead.
const src = fs.readFileSync(HOOK, "utf8");
const declStart = src.indexOf("const DENY = {");
if (declStart === -1) throw new Error(`no "const DENY = {" found in ${HOOK}`);
const braceStart = src.indexOf("{", declStart);
let depth = 0, i = braceStart;
for (; i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
}
const DENY = new Function(`"use strict"; return (${src.slice(braceStart, i)});`)();

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
  if (!ok) failed++;
}

function run(rawInput) {
  const r = spawnSync("node", [HOOK], { input: rawInput, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function decide(toolInput, toolName = "Skill") {
  return run(JSON.stringify({
    session_id: "s", transcript_path: "/tmp/t.jsonl", cwd: "/tmp",
    permission_mode: "default", hook_event_name: "PreToolUse",
    tool_name: toolName, tool_input: toolInput,
  }));
}

function decision(r) {
  try { return JSON.parse(r.out).hookSpecificOutput; } catch { return null; }
}

// --- every DENY entry is refused, naming its own replacement -----------------------
for (const [skill, replacement] of Object.entries(DENY)) {
  const r = decide({ skill });
  const d = decision(r);
  check(`"${skill}" is refused`, r.code === 0 && d && d.permissionDecision === "deny", JSON.stringify(r));
  check(`"${skill}" refusal names its replacement`,
    d && d.permissionDecisionReason && d.permissionDecisionReason.includes(replacement),
    d && d.permissionDecisionReason);
}

// --- a non-listed nord skill passes silently ---------------------------------------
let r = decide({ skill: "nord-core:implement" });
check("non-listed nord skill passes, exit 0", r.code === 0, JSON.stringify(r));
check("non-listed nord skill produces no output", r.out === "", r.out);

// --- a non-Skill tool passes ---------------------------------------------------------
r = decide({ file_path: "/tmp/x" }, "Read");
check("non-Skill tool passes, exit 0", r.code === 0, JSON.stringify(r));
check("non-Skill tool produces no output", r.out === "", r.out);

// --- a broken payload fails open ------------------------------------------------------
r = run("not json");
check("garbage payload -> exit 0", r.code === 0, JSON.stringify(r));
check("garbage payload -> no output", r.out === "", r.out);

console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
