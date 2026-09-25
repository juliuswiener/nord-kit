#!/usr/bin/env node
// PreToolUse(Agent|Task) — implementer start. When an implementer is spawned in a repo
// that carries a code graph (graphify-out/graph.json), the order is dispatched first and
// the work package is appended to the spawn prompt (updatedInput). The implementer then
// starts with the places to change instead of searching for them.
// Vault: backlog/nord/implementierer-paket-aus-dem-graphen.
//
// WHY A HOOK, NOT A LINE IN THE SKILL: SessionStart does not see the prompt, and "run
// dispatch before you spawn" would be a request the instructor can forget. The hook
// sees the prompt and cannot be skipped. Measured with Opus over 10 replayed commits:
// 22-31 % fewer lookup tokens, fewer in 8 of 10 (Messreihe 2).
//
// Not packed: other roles, repos without a graph, a prompt that already carries a
// package, a prompt with the marker [kein-arbeitspaket].
// Fail-OPEN: any error, a timeout of the dispatch, a broken graph -> no output, exit 0;
// the implementer starts as it would have without the package.
// ponytail: the run is written for the audit but not activated — the Read guard is
// repo-wide and cannot tell the worker's reads from the instructor's. Scope the guard
// per agent (payload agent_id) to arm it here.

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROLES = new Set(["nord-core:implementer", "implementer"]);
const OPT_OUT = "[kein-arbeitspaket]";
const MARK = "Hier ist dein Arbeitspaket";
const WP = path.join(__dirname, "..", "scripts", "work-package.cjs");

function pass() { process.exit(0); }

function gitRoot(start) {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

try {
  const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  if (input.tool_name !== "Agent" && input.tool_name !== "Task") pass();
  const ti = input.tool_input || {};
  if (!ROLES.has(ti.subagent_type)) pass();
  const prompt = typeof ti.prompt === "string" ? ti.prompt : "";
  if (!prompt.trim() || prompt.includes(OPT_OUT) || prompt.includes(MARK)) pass();

  const root = gitRoot(path.resolve(input.cwd || process.cwd()));
  if (!root || !fs.existsSync(path.join(root, "graphify-out", "graph.json"))) pass();

  const args = [WP, "dispatch", "--repo", root, "--no-activate"];
  // Test seam: a pinned decomposition instead of a model call.
  if (process.env.WORK_PACKAGE_QUESTIONS) args.push("--questions", process.env.WORK_PACKAGE_QUESTIONS);
  args.push(prompt);
  const r = spawnSync("node", args, { encoding: "utf8", timeout: 80000, maxBuffer: 1 << 26 });
  if (r.status !== 0) pass();
  const run = (r.stdout || "").trim().split("\n").pop();
  const md = path.join(root, ".nord", "work-package", run, "package.md");
  if (!/^run-\d+$/.test(run) || !fs.existsSync(md)) pass();

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: `Arbeitspaket ${run} angehängt (${path.relative(root, md)}).`,
      updatedInput: { ...ti, prompt: `${prompt}\n\n${MARK}:\n\n${fs.readFileSync(md, "utf8")}` },
    },
  }));
  process.exit(0);
} catch {
  pass();
}
