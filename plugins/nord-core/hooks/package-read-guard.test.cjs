#!/usr/bin/env node
// package-read-guard.test.cjs — payload checks for the Read guard (AK5).
// Run: node package-read-guard.test.cjs [path-to-hook.cjs]
// Builds a temp git repo with an active work package and pipes real-shape PreToolUse
// payloads into the hook. Vault: backlog/nord/implementierer-paket-aus-dem-graphen.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync, spawnSync } = require("child_process");

const HOOK = path.resolve(process.argv[2] || path.join(__dirname, "package-read-guard.cjs"));
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-read-guard-"));
execFileSync("git", ["init", "-q", root]);
fs.writeFileSync(path.join(root, "a.go"), "package a\n\nfunc A() int { return 1 }\n");
fs.writeFileSync(path.join(root, "b.go"), "package a\n\nfunc B() int { return 2 }\n");
const run = "run-1";
const dir = path.join(root, ".nord", "work-package", run);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "package.md"), "# Arbeitspaket\n");
fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ run, commit: "x",
  files: { "a.go": sha(path.join(root, "a.go")) } }));
fs.writeFileSync(path.join(root, ".nord", "work-package", "active"), run + "\n");

function decide(toolInput, cwd = root) {
  const payload = { session_id: "s", transcript_path: "/tmp/t.jsonl", cwd, permission_mode: "default",
    hook_event_name: "PreToolUse", tool_name: "Read", tool_input: toolInput };
  const r = spawnSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
  if (r.status !== 0) return { verdict: "CRASH", reason: r.stderr.slice(0, 200) };
  try {
    const o = JSON.parse(r.stdout).hookSpecificOutput;
    return { verdict: o.permissionDecision, reason: o.permissionDecisionReason || "" };
  } catch { return { verdict: "allow", reason: "" }; }
}

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
}

const a = path.join(root, "a.go");
let d = decide({ file_path: a });
check("unchanged package file is refused", d.verdict === "deny", JSON.stringify(d));
check("refusal points at package.md", d.reason.includes(path.join(dir, "package.md")), d.reason);
check("a ranged read of a package file passes", decide({ file_path: a, offset: 1, limit: 2 }).verdict !== "deny");
check("a file outside the package passes", decide({ file_path: path.join(root, "b.go") }).verdict !== "deny");
check("a subdirectory cwd still finds the package", decide({ file_path: a }, path.join(root, ".nord")).verdict === "deny");
fs.appendFileSync(a, "\nfunc A2() int { return 3 }\n");
check("the same file passes after it changed", decide({ file_path: a }).verdict !== "deny");
fs.writeFileSync(path.join(root, ".nord", "work-package", "active"), "");
fs.writeFileSync(a, fs.readFileSync(a, "utf8")); // unchanged content, but no active package now
check("no active package: nothing is refused", decide({ file_path: path.join(root, "b.go") }).verdict !== "deny");

const log = fs.readFileSync(path.join(dir, "reads.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
check("every read under an active package is logged", log.length === 6, String(log.length));
check("log entries carry the repo-relative file and the verdict",
  log.every((e) => typeof e.file === "string" && !path.isAbsolute(e.file) && ["allow", "deny"].includes(e.verdict)),
  JSON.stringify(log[0]));

fs.rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
