#!/usr/bin/env node
// work-package-dispatch.test.cjs — payload checks for the implementer-start hook.
// Run: node work-package-dispatch.test.cjs [path-to-hook.cjs]
// Real-shape PreToolUse(Agent) payloads against a throwaway clone of orch_tui with its
// graph. The decomposition is pinned through WORK_PACKAGE_QUESTIONS so no model is
// called. Vault: backlog/nord/implementierer-paket-aus-dem-graphen.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const HOOK = path.resolve(process.argv[2] || path.join(__dirname, "work-package-dispatch.cjs"));
const SRC = process.env.WP_TEST_REPO || path.join(os.homedir(), "00_projects/169_orch_tui/orch_tui");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wp-dispatch-"));
const repo = path.join(tmp, "repo");
execFileSync("git", ["clone", "-q", SRC, repo]);
fs.mkdirSync(path.join(repo, "graphify-out"));
fs.copyFileSync(path.join(SRC, "graphify-out", "graph.json"), path.join(repo, "graphify-out", "graph.json"));
const bare = path.join(tmp, "nograph");
execFileSync("git", ["init", "-q", bare]);
const qFile = path.join(tmp, "q.json");
fs.writeFileSync(qFile, JSON.stringify({ symbols: ["Deliver"], affected: [], terms: [], subsystems: ["agent"] }));

function run(toolInput, { cwd = repo, tool = "Agent", env = {} } = {}) {
  const payload = { session_id: "s", transcript_path: "/tmp/t.jsonl", cwd, permission_mode: "default",
    hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput };
  const r = spawnSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8",
    env: { ...process.env, WORK_PACKAGE_QUESTIONS: qFile, ...env } });
  let out = null;
  try { out = JSON.parse(r.stdout).hookSpecificOutput; } catch { /* no output = pass-through */ }
  return { status: r.status, out, stderr: r.stderr };
}

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
}

const PROMPT = "Deliver blockiert unter a.mu, wenn stdin voll ist. Erwartete Subsysteme: agent.";
const impl = { subagent_type: "nord-core:implementer", description: "fix", prompt: PROMPT };

let r = run(impl);
const p = r.out && r.out.updatedInput && r.out.updatedInput.prompt;
check("implementer spawn gets the package appended", Boolean(p && p.startsWith(PROMPT) && /Arbeitspaket/.test(p)), r.stderr.slice(0, 300));
check("the package names its commit", Boolean(p && /Stand: [0-9a-f]{40}/.test(p)));
check("the package carries the change target's code", Boolean(p && p.includes("func (a *Agent) Deliver(")));
check("the other tool_input fields survive", r.out && r.out.updatedInput.subagent_type === "nord-core:implementer"
  && r.out.updatedInput.description === "fix");
check("decision is allow, with a reason naming the run", r.out && r.out.permissionDecision === "allow"
  && /run-\d+/.test(r.out.permissionDecisionReason || ""), JSON.stringify(r.out && r.out.permissionDecisionReason));
check("the run is written but not activated (the guard would hit the instructor too)",
  (fs.existsSync(path.join(repo, ".nord", "work-package"))
    && fs.readdirSync(path.join(repo, ".nord", "work-package")).some((d) => d.startsWith("run-")))
  && !fs.existsSync(path.join(repo, ".nord", "work-package", "active")));

check("Task (older name) is handled like Agent", Boolean(run(impl, { tool: "Task" }).out));
check("another role passes untouched", run({ ...impl, subagent_type: "nord-core:reviewer" }).out === null);
check("no subagent_type passes untouched", run({ prompt: PROMPT }).out === null);
check("a repo without graph passes untouched", run(impl, { cwd: bare }).out === null);
check("the opt-out marker passes untouched", run({ ...impl, prompt: PROMPT + "\n[kein-arbeitspaket]" }).out === null);
check("a prompt that already carries a package is not packed twice",
  run({ ...impl, prompt: p || "x" }).out === null);
const broken = run(impl, { env: { WORK_PACKAGE_QUESTIONS: path.join(tmp, "missing.json") } });
check("a failing dispatch fails open: exit 0, no output", broken.status === 0 && broken.out === null, broken.stderr.slice(0, 200));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
