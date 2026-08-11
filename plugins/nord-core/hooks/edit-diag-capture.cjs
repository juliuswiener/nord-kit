#!/usr/bin/env node
// PreToolUse(Edit|Write|NotebookEdit) — stash the file's CURRENT bytes so the
// PostToolUse companion can tell a newly-introduced error from one that was
// already there.
//
// Why a companion hook at all: PostToolUse fires after the write, so by then
// the pre-edit content is gone. Reconstructing it from tool_input works for
// Edit (reverse new_string -> old_string) but not for Write, which carries only
// the new content — and Write is 2,865 of the measured 14,900 edit calls. One
// cheap read covers every editing tool with no per-tool reconstruction rules.
//
// Why this hook is cheap: it does NO language-server work. It reads the file
// and writes a copy. The expensive half (connect, diagnose twice, diff) all
// happens in PostToolUse, where it is at least buying an answer. A PreToolUse
// that ran diagnostics would add its latency BEFORE every edit, including the
// overwhelming majority that introduce nothing.
//
// Fail-OPEN: any error -> allow the edit. A diagnostics nicety must never be
// able to block a write.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

function allow() { process.exit(0); }

const WATCHED = new Set(["Edit", "Write", "NotebookEdit"]);

function stateDir() {
  const dir = path.join(os.tmpdir(), `nord-edit-diag-${process.getuid ? process.getuid() : 0}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Keyed by file path, not tool_use_id: PostToolUse is the only reader, it always
// knows the path, and tool_use_id is not guaranteed to be present on the
// PreToolUse payload. A second edit to the same file before the first is
// reported simply overwrites the stash, which is the correct baseline anyway.
function slotFor(file) {
  return path.join(stateDir(), crypto.createHash("sha256").update(file).digest("hex").slice(0, 32) + ".json");
}

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
} catch { allow(); }

if (!input || !WATCHED.has(input.tool_name)) allow();

const ti = input.tool_input || {};
const file = ti.file_path || ti.notebook_path;
if (!file || typeof file !== "string") allow();

try {
  // A file that does not exist yet has an empty baseline: every error the new
  // content produces is genuinely new. Record that explicitly rather than
  // leaving the slot absent, which PostToolUse cannot distinguish from "the
  // PreToolUse hook never ran".
  const existed = fs.existsSync(file);
  fs.writeFileSync(slotFor(file), JSON.stringify({
    file,
    existed,
    text: existed ? fs.readFileSync(file, "utf8") : "",
    at: Date.now(),
  }));
} catch {
  // Unreadable (binary, permissions, race). PostToolUse will find no usable
  // stash and will say the baseline is unknown instead of inventing one.
}

allow();
