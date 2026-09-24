#!/usr/bin/env node
// PreToolUse(Read) — work-package read guard (AK5). While a work package is
// active for the repo (.nord/work-package/active), a Read of a file that is
// IN the package and UNCHANGED since dispatch is refused: the relevant code
// already sits in the package, re-reading it just spends tokens for nothing
// new. A ranged read (offset/limit) always passes and is only measured: its log
// line says how many of its lines the package already carried (`ranges`). Every
// Read while a package is active is logged to <run>/reads.jsonl for the post-run audit
// (AK6). Vault: backlog/nord/implementierer-paket-aus-dem-graphen.
//
// Fail-OPEN: any error (no git root, no/empty active package, unreadable or
// malformed package.json, ...) -> allow, print nothing. A missing or broken
// work package must never block a Read.

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function allow() { process.exit(0); }

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function findGitRoot(start) {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
} catch { allow(); }

if (!input || input.tool_name !== "Read") allow();

const ti = input.tool_input || {};
const filePath = ti.file_path;
if (!filePath || typeof filePath !== "string") allow();

try {
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const root = findGitRoot(path.resolve(cwd));
  if (!root) allow();

  const wpDir = path.join(root, ".nord", "work-package");
  const activePath = path.join(wpDir, "active");
  let active = "";
  try { active = fs.readFileSync(activePath, "utf8").trim(); } catch { /* missing */ }

  // No active pointer: nothing is ever refused. The run directory may still
  // exist on disk from a just-finished package though, and its audit trail
  // (Nachkontrolle) wants the tail end of the worker's reads too, so keep
  // logging into it as long as it is unambiguous.
  // ponytail: assumes at most one run directory under work-package/ at a
  // time; with several present we cannot tell which one is stale and skip
  // logging rather than guess.
  let run = active;
  if (!run) {
    let entries = [];
    try { entries = fs.readdirSync(wpDir, { withFileTypes: true }); } catch { allow(); }
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (dirs.length !== 1) allow(); // no package was ever dispatched here, or it's ambiguous
    run = dirs[0];
  }

  const dir = path.join(wpDir, run);
  let files = {};
  let ranges = {};
  if (active) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      files = pkg.files || {};
      ranges = pkg.ranges || {};
    } catch { /* corrupt/missing package.json -> nothing recorded, still logged below */ }
  }

  const absFile = path.resolve(cwd, filePath);
  const relFile = path.relative(root, absFile).split(path.sep).join("/");
  const ranged = ti.offset !== undefined || ti.limit !== undefined;

  // Read's offset is the 1-based first line; without a limit it reads up to 2000 lines.
  const first = Number(ti.offset) || 1;
  const last = first + (Number(ti.limit) || 2000) - 1;
  // Two real worker runs read ranged only (10 of 10), with a margin around the packaged
  // declarations, so no refusal rule fired. Decision 2026-09-24: measure, do not refuse,
  // until enough runs show where a threshold belongs.
  // ponytail: overlap is counted against the requested span; a read past EOF overcounts nothing,
  // because ranges never extend past the file.
  const packagedLines = (ranges[relFile] || []).reduce(
    (n, [s, e]) => n + Math.max(0, Math.min(e, last) - Math.max(s, first) + 1), 0);

  let verdict = "allow";
  if (!ranged && Object.prototype.hasOwnProperty.call(files, relFile)) {
    let currentHash = null;
    try { currentHash = sha256(absFile); } catch { /* unreadable -> no match */ }
    if (currentHash === files[relFile]) verdict = "deny";
  }

  const entry = { ts: Date.now(), file: relFile, verdict, ranged };
  if (ranged) Object.assign(entry, { offset: ti.offset, limit: ti.limit, packagedLines });
  fs.appendFileSync(path.join(dir, "reads.jsonl"), JSON.stringify(entry) + "\n");

  if (verdict === "deny") {
    const packageMd = path.join(dir, "package.md");
    deny(
      `Diese Datei liegt im aktiven Arbeitspaket und ist seit dem Dispatch unverändert: ${packageMd}. ` +
      `Der relevante Code steht bereits im Paket. ` +
      `Für andere Teile der Datei: gezielter Read mit offset/limit oder Grep.`
    );
  }

  allow();
} catch {
  allow();
}
