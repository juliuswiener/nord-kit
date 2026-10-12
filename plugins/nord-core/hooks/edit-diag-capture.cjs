#!/usr/bin/env node
// Registered again since 2026-09-24 (unregistered 2026-09-05 to 2026-09-24: its
// dist/ and daemon lived in the retired nord-core development repo). dist/tools/lsp/
// is now built from mcp/src by mcp/build.mjs, and the MCP server stands in for the
// lost daemon. Vault: edit-diagnose-laeuft-ueber-den-warmen-mcp-server.
// PreToolUse(Edit|Write|NotebookEdit) — stash the file's CURRENT bytes so the
// PostToolBatch companion can tell a newly-introduced error from one that was
// already there. The FIRST edit of a file in a prompt keeps its stash: the
// report compares the state before a response's first edit with the state after
// its last one.
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
// Without a prompt_id (absent until the first user input of a process), a stash
// counts as this response's for this long.
// ponytail: fixed age, a prompt_id-less batch longer than this gets a later baseline.
const SLOT_MAX_AGE_MS = 15 * 60 * 1000;

// One directory per (session, agent): two sessions or a subagent editing the same
// file never share a stash. Keyed by file path inside it: the report knows the
// paths from tool_calls. Same layout as slotFor() in edit-diag-report.cjs.
function slotFor(input, file) {
  const owner = [input.session_id || "nosession", input.agent_id].filter(Boolean).join("-").replace(/[^A-Za-z0-9_-]/g, "_");
  const dir = path.join(os.tmpdir(), `nord-edit-diag-${process.getuid ? process.getuid() : 0}`, owner);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, crypto.createHash("sha256").update(file).digest("hex").slice(0, 32) + ".json");
}

// A stash belongs to this response when it was taken under the same prompt.
// A batch whose report never ran (interrupted) leaves its stash behind; the next
// prompt must not take it as its baseline. Same rule in edit-diag-report.cjs.
function current(stash, input) {
  return input.prompt_id ? stash.prompt_id === input.prompt_id : Date.now() - stash.at < SLOT_MAX_AGE_MS;
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
  const slot = slotFor(input, file);
  // An earlier edit of this file in the same response keeps its stash.
  // Edits run one after another (measured), so read-then-write does not race.
  try { if (current(JSON.parse(fs.readFileSync(slot, "utf8")), input)) allow(); } catch { /* no stash yet */ }
  // A file that does not exist yet has an empty baseline: every error the new
  // content produces is genuinely new. Record that explicitly rather than
  // leaving the slot absent, which the report cannot distinguish from "the
  // PreToolUse hook never ran".
  const existed = fs.existsSync(file);
  fs.writeFileSync(slot, JSON.stringify({
    file,
    existed,
    text: existed ? fs.readFileSync(file, "utf8") : "",
    at: Date.now(),
    prompt_id: input.prompt_id,
  }));
} catch {
  // Unreadable (binary, permissions, race). The report will find no usable
  // stash and will say the baseline is unknown instead of inventing one.
}

allow();
