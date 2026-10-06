#!/usr/bin/env node
// Registered again since 2026-09-24 (unregistered 2026-09-05 to 2026-09-24: its
// dist/ and daemon lived in the retired nord-core development repo). dist/tools/lsp/
// is now built from mcp/src by mcp/build.mjs, and the MCP server stands in for the
// lost daemon. Vault: edit-diagnose-laeuft-ueber-den-warmen-mcp-server.
// PostToolUse(Edit|Write|NotebookEdit) — report the errors THIS edit introduced.
//
// Edit verifies that old_string occurs exactly once. That is a string check,
// not a code check: nothing confirms the file still compiles, and the next
// build is where it surfaces. Measured in this workspace: Edit 12,035 calls,
// Write 2,865, lsp_diagnostics 0 — nobody closes the loop by hand.
//
// ---------------------------------------------------------------------------
// How the before-picture is obtained
//
// The pre-edit bytes come from the PreToolUse companion (edit-diag-capture.cjs),
// which is a plain file read. This hook then asks the language server about
// BOTH versions over one connection, using LSP's in-memory document model:
// didOpen with the pre-edit text, then didChange to the post-edit text. The
// server is asked about the REAL path both times, so imports, tsconfig and
// crate layout resolve exactly as they do for the file on disk, and the file on
// disk is never touched or temporarily reverted.
//
// The alternative — "only report errors on lines the edit touched" — needs no
// baseline, but it misses the break three functions away, which is the case
// worth catching. It also cannot tell a pre-existing error from a new one when
// both sit on the same line.
//
// Diagnostics are compared IGNORING position. Inserting a line shifts every
// error below it, and a position-sensitive diff would report the whole rest of
// the file as newly broken.
//
// ---------------------------------------------------------------------------
// Errors only, never warnings or hints. A file mid-refactor legitimately has
// warnings, and a hook that fires on every edit trains the reader to skip it.
//
// Silence means "checked, nothing new". When the server did not actually answer
// -- the case a cold server produces -- this says so instead. A silent all-clear
// from a server that never looked is the worst output this hook could give.
//
// Fail-OPEN and silent on every internal error: a diagnostics nicety must never
// break the edit loop.
//
// ---------------------------------------------------------------------------
// Where the language server lives
//
// A hook is a fresh process on every edit, so a pool held in this process is
// always empty and every edit paid a full language-server startup. Measured in
// nord-core before the daemon, per edit, and identical on the 6th edit as on the
// 1st: TypeScript 7.1s, JSON 1.68s, TOML 0.76s, Rust 0.27s answering
// "not checked" (2.7s if made to actually answer).
//
// So the work is handed to the MCP server, which keeps the servers warm for the
// whole session and answers on a Unix socket. If no socket answers, the hook does
// the work in-process -- slow, but correct. The socket is an optimisation, and a
// broken one must never be able to turn a real answer into silence.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const WATCHED = new Set(["Edit", "Write", "NotebookEdit"]);
const BUDGET_MS = positiveInt(process.env.NORD_EDIT_DIAG_BUDGET_MS, 4000);
const DEBUG = process.env.NORD_EDIT_DIAG_DEBUG === "1";
// How long to wait for a server that reports itself still indexing, BEFORE
// asking. Default 0: the fast path never waits, because turning every edit into
// a multi-second stall to serve the rare cold first edit is a bad trade — an
// honest "not checked" costs nothing and says the same thing. Raise it when
// reliability matters more than latency (measured: rust-analyzer needs seconds
// on a cold crate, and answers empty until then).
// How long to wait for rust-analyzer's flycheck (cargo check) after the save the
// plugin sends it. rustc's errors (E0425, E0599 ...) exist only after it; on
// expiry the hook says "not checked" instead of "no new errors". Rust only: other
// languages never send a save and ignore this.
const FLYCHECK_MS = positiveInt(process.env.NORD_EDIT_DIAG_FLYCHECK_MS, 4000);
const WAIT_READY_MS = positiveInt(process.env.NORD_EDIT_DIAG_WAIT_READY_MS, 0);

function positiveInt(v, dflt) {
  const n = parseInt(v || "", 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function quit() { process.exit(0); }

function say(text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text },
  }));
  process.exit(0);
}

function slotFor(file) {
  const dir = path.join(os.tmpdir(), `nord-edit-diag-${process.getuid ? process.getuid() : 0}`);
  return path.join(dir, crypto.createHash("sha256").update(file).digest("hex").slice(0, 32) + ".json");
}

// Identity of a diagnostic for set-difference purposes: everything that
// describes WHAT is wrong, and nothing that describes WHERE.
//
// Rust is the exception: rust-analyzer and rustc word the same error differently
// ("cannot find value" vs "no such value"), so for those two sources the CODE is
// the identity (E0425 ...) and the text is not. Limit: swapping one E0425 for a
// different E0425 in the same file leaves the count unchanged and is not seen.
const isRust = d => (d.source === "rustc" || d.source === "rust-analyzer") && d.code !== undefined && d.code !== null;

function identity(d) {
  if (isRust(d)) return ["rust", d.severity, d.code].join(" ");
  return [d.severity, d.code === undefined || d.code === null ? "" : d.code, d.source || "", d.message].join(" ");
}

const isError = d => d.severity === 1;

// One message per (line, code) for Rust, the rustc one when both tools say it.
// Everything else passes through untouched.
function dedupe(list) {
  const out = [];
  const at = new Map();
  for (const d of list) {
    if (!isRust(d)) { out.push(d); continue; }
    const k = (d.range && d.range.start ? d.range.start.line : -1) + " " + d.code;
    if (!at.has(k)) { at.set(k, out.length); out.push(d); }
    else if (d.source === "rustc" && out[at.get(k)].source !== "rustc") out[at.get(k)] = d;
  }
  return out;
}

function newErrors(before, after) {
  const remaining = new Map();
  for (const d of before.filter(isError)) {
    remaining.set(identity(d), (remaining.get(identity(d)) || 0) + 1);
  }
  const fresh = [];
  for (const d of after.filter(isError)) {
    const k = identity(d);
    const n = remaining.get(k) || 0;
    if (n > 0) remaining.set(k, n - 1);
    else fresh.push(d);
  }
  return fresh;
}

function render(file, list) {
  const rel = path.basename(file);
  const lines = list.map(d => {
    const line = d.range && d.range.start ? d.range.start.line + 1 : 0;
    const col = d.range && d.range.start ? d.range.start.character + 1 : 0;
    const code = d.code === undefined || d.code === null ? "" : ` ${d.code}`;
    return `  ${rel}:${line}:${col}${code} ${d.message.split("\n")[0]}`;
  });
  const n = list.length;
  return `nord: this edit introduced ${n} new ${n === 1 ? "error" : "errors"}\n${lines.join("\n")}`;
}

async function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch { quit(); }
  if (!input || !WATCHED.has(input.tool_name)) quit();

  const ti = input.tool_input || {};
  const file = ti.file_path || ti.notebook_path;
  if (!file || typeof file !== "string") quit();

  // dist/ ships alongside hooks/ in the plugin, so nord's real client is
  // reachable. Re-implementing server selection and workspace-root detection
  // here would be a second source of truth that drifts.
  const dist = path.join(__dirname, "..", "dist", "tools", "lsp", "index.js");
  if (!fs.existsSync(dist)) quit();
  const lsp = require(dist);

  const serverConfig = lsp.getServerForFile(file);
  // No server for this language, or the server is not installed. Say nothing:
  // an edit to a .md file should not produce output, and claiming "clean" for a
  // language nothing checked would be a lie.
  if (!serverConfig || !lsp.commandExists(serverConfig.command)) quit();

  let stash = null;
  try {
    const slot = slotFor(file);
    stash = JSON.parse(fs.readFileSync(slot, "utf8"));
    fs.unlinkSync(slot);
  } catch { /* no baseline captured */ }

  let afterText;
  try { afterText = fs.readFileSync(file, "utf8"); } catch { quit(); }

  const beforeText = stash ? stash.text : null;
  if (beforeText === afterText) quit();   // nothing actually changed

  const t0 = Date.now();
  const req = { file, beforeText, afterText, budgetMs: BUDGET_MS, waitReadyMs: WAIT_READY_MS, flycheckMs: FLYCHECK_MS };

  // Ask the MCP server first: it lives for the whole session and keeps its
  // language servers warm (vault: edit-diagnose-laeuft-ueber-den-warmen-mcp-server).
  // The whole before/after sequence goes over in ONE request, so no client lease
  // is held across round trips. NORD_LSP_DAEMON=0 skips it (name kept from the
  // retired daemon).
  let r = null;
  let via = "socket";
  if (process.env.NORD_LSP_DAEMON !== "0") {
    try {
      r = await lsp.requestEditDiagnostics(req, BUDGET_MS * 2 + WAIT_READY_MS + FLYCHECK_MS + 5000);
    } catch { r = null; }
  }
  if (!r) {
    // Nobody answered. Do it here -- slow but correct, never a silent all-clear.
    via = "in-process";
    try {
      r = await lsp.editDiagnostics(req);
    } finally {
      // A server this process started must not outlive it.
      await lsp.disconnectAll().catch(() => {});
    }
  }
  const { before, after, answered, indexState, flycheck, rustcBaselineKnown, timing } = r;
  const rustcUnchecked = flycheck === "timeout";
  const rustcNote = `rustc (cargo check) did not finish within ${FLYCHECK_MS}ms`;

  // A publish having arrived is not enough. Measured: rust-analyzer publishes an
  // EMPTY set immediately on didOpen and only later replaces it with the real
  // one, so "a publish arrived" is true ~300ms before any analysis exists. Its
  // own quiescent flag is the signal that can actually fail, and nord already
  // opts into it. 'unknown' is deliberately NOT treated as unready: servers that
  // offer no readiness signal at all report it forever from a fresh process, and
  // hedging on it would put "not checked" on every TypeScript edit.
  const ready = answered && indexState !== "indexing";

  const ms = Date.now() - t0;
  const debug = DEBUG ? `\n[nord-edit-diag ${ms}ms via=${via} answered=${answered} index=${indexState} before=${before.length} after=${after.length}${flycheck && flycheck !== "n/a" ? ` flycheck=${flycheck} didSave->flycheck-end=${timing.flycheckMs}ms didSave->first-publish=${timing.firstPublishMs}ms` : ""}]` : "";

  if (beforeText === null) {
    const errs = dedupe(after.filter(isError));
    if (!ready) say(`nord: not checked — ${serverConfig.name} did not answer about ${path.basename(file)} within ${BUDGET_MS}ms.${debug}`);
    if (errs.length === 0) {
      if (rustcUnchecked) say(`nord: not checked — ${rustcNote}.${debug}`);
      quit();
    }
    say(`nord: ${path.basename(file)} has ${errs.length} error(s); no pre-edit baseline was captured, so these may predate this edit.\n${render(file, errs).split("\n").slice(1).join("\n")}${debug}`);
  }

  const fresh = newErrors(dedupe(before.filter(isError)), dedupe(after.filter(isError)));
  if (fresh.length > 0) {
    // rustc ran against the disk text only; without an earlier verdict from this
    // server session its errors may predate the edit.
    const notes = [];
    if (rustcBaselineKnown === false && fresh.some(d => d.source === "rustc")) notes.push("no rustc baseline in this server session; rustc errors may predate this edit");
    if (rustcUnchecked) notes.push(`not checked — ${rustcNote}`);
    say(render(file, fresh) + notes.map(n => `\n  (${n})`).join("") + debug);
  }

  // Nothing new. Only claim that if the server actually looked.
  if (!ready) {
    say(`nord: not checked — ${serverConfig.name} did not answer about ${path.basename(file)} within ${BUDGET_MS}ms, so "no new errors" is not established.${debug}`);
  }
  if (rustcUnchecked) {
    say(`nord: not checked — ${rustcNote}, so "no new errors" is not established for rustc errors.${debug}`);
  }
  if (DEBUG) say(`nord: no new errors.${debug}`);
  quit();
}

main().catch(() => process.exit(0));
