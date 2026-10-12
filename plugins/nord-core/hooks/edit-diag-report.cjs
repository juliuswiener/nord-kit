#!/usr/bin/env node
// Registered again since 2026-09-24 (unregistered 2026-09-05 to 2026-09-24: its
// dist/ and daemon lived in the retired nord-core development repo). dist/tools/lsp/
// is now built from mcp/src by mcp/build.mjs, and the MCP server stands in for the
// lost daemon. Vault: edit-diagnose-laeuft-ueber-den-warmen-mcp-server.
// PostToolBatch — report the errors a RESPONSE's edits (Edit|Write|NotebookEdit)
// introduced, once, after the last of them.
//
// Edit verifies that old_string occurs exactly once. That is a string check,
// not a code check: nothing confirms the file still compiles, and the next
// build is where it surfaces. Measured in this workspace: Edit 12,035 calls,
// Write 2,865, lsp_diagnostics 0 — nobody closes the loop by hand.
//
// ---------------------------------------------------------------------------
// When it runs
//
// Once per response, on PostToolBatch, not per edit on PostToolUse. Measured
// 2026-10-12 (CLI 2.1.296, three `claude -p` runs): the edits of one response run
// one after another, each as soon as its block has streamed in, so when the first
// edit's PostToolUse fires the later edits often do not exist yet (block 2
// arrived 268 ms after it). Reported per edit, 58 % of the messages to orch
// workers came in behind edits already sent, and 29 % named an error those edits
// had fixed. PostToolBatch fires once after every call of the response, all of
// them in tool_calls. Its matcher is ignored (it fired for a batch of Reads), so
// the edits are picked out here. Per file, the stash of the response's FIRST edit
// (edit-diag-capture.cjs keeps it) is compared with the disk after the LAST one.
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
// "Not checked" is said once per session and file (rust-analyzer said it 602
// times in five days, 310 of them byte-identical), and it says that silence
// about that file is no all-clear until the server answers. The first answer
// after it says "checked again", so silence means "checked" from then on.
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
// The files of one response are diagnosed one after another, not in parallel:
// two leases on one language-server client run interleaved (no lock in
// runWithClientLease), two cold files of one language would each start a server,
// and rust-analyzer's flycheck tracking (lastSaveAt, flycheckActive) is per
// client, so two saves at once blur which cargo check ended. One Rust file costs
// up to BUDGET_MS + FLYCHECK_MS (8 s) warm and a socket timeout plus an
// in-process run cold (about 30 s). So the hook timeout in hooks.json is 150 s,
// and past this limit the remaining files are "not checked" -- a hook killed by
// its timeout would say nothing, and silence reads as "checked".
const REPORT_MS = positiveInt(process.env.NORD_EDIT_DIAG_REPORT_MS, 90000);
// Same value and rule as in edit-diag-capture.cjs.
const SLOT_MAX_AGE_MS = 15 * 60 * 1000;

function positiveInt(v, dflt) {
  const n = parseInt(v || "", 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function quit() { process.exit(0); }

function say(text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
  }));
  process.exit(0);
}

// Same layout as slotFor() in edit-diag-capture.cjs.
function slotFor(input, file) {
  const owner = [input.session_id || "nosession", input.agent_id].filter(Boolean).join("-").replace(/[^A-Za-z0-9_-]/g, "_");
  const dir = path.join(os.tmpdir(), `nord-edit-diag-${process.getuid ? process.getuid() : 0}`, owner);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, crypto.createHash("sha256").update(file).digest("hex").slice(0, 32) + ".json");
}

// Same rule as current() in edit-diag-capture.cjs: a stash from an earlier prompt
// (its batch never reported) is no baseline for this one.
function current(stash, input) {
  return input.prompt_id ? stash.prompt_id === input.prompt_id : Date.now() - stash.at < SLOT_MAX_AGE_MS;
}

// Read and remove the stash; null when there is none or it is not this response's.
function takeSlot(input, file) {
  try {
    const slot = slotFor(input, file);
    const stash = JSON.parse(fs.readFileSync(slot, "utf8"));
    fs.unlinkSync(slot);
    return current(stash, input) ? stash : null;
  } catch { return null; }
}

// "Not checked", once per (session, agent, file): the marker beside the stash
// says it was said. null when it was.
function unchecked(input, file, reason) {
  const name = path.basename(file);
  try { fs.writeFileSync(slotFor(input, file) + ".unchecked", "", { flag: "wx" }); } catch { return null; }
  return `nord: not checked — ${reason}. Further edits to ${name} in this session stay unchecked until the server answers; silence about ${name} is not an all-clear.`;
}

// The server answered: true when "not checked" had been said, which now ends.
function checkedAgain(input, file) {
  try { fs.unlinkSync(slotFor(input, file) + ".unchecked"); return true; } catch { return false; }
}

const failed = (call) => /<tool_use_error>/.test(typeof call.tool_response === "string" ? call.tool_response : JSON.stringify(call.tool_response || ""));
const pathOf = (call) => (call.tool_input || {}).file_path || (call.tool_input || {}).notebook_path;

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
  return `nord: this response's edits introduced ${n} new ${n === 1 ? "error" : "errors"}\n${lines.join("\n")}`;
}

async function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch { quit(); }
  if (!input || input.hook_event_name !== "PostToolBatch") quit();

  const edits = (input.tool_calls || []).filter(c => WATCHED.has(c.tool_name) && typeof pathOf(c) === "string");
  const files = [...new Set(edits.map(pathOf))];
  if (files.length === 0) quit();
  // Taken before anything can end the hook early, so no stash outlives its batch.
  const stashes = files.map(f => takeSlot(input, f));

  // dist/ ships alongside hooks/ in the plugin, so nord's real client is
  // reachable. Re-implementing server selection and workspace-root detection
  // here would be a second source of truth that drifts.
  const dist = path.join(__dirname, "..", "dist", "tools", "lsp", "index.js");
  if (!fs.existsSync(dist)) quit();
  const lsp = require(dist);

  const t0 = Date.now();
  const state = { inProcess: false };
  const out = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const calls = edits.filter(c => pathOf(c) === files[i]);
      // The first file is always diagnosed; see REPORT_MS.
      const overTime = i > 0 && Date.now() - t0 >= REPORT_MS;
      // Fail-open per file: one file's internal error must not drop the others' messages.
      const text = await diagnose(lsp, input, files[i], stashes[i], calls, state, overTime).catch(() => null);
      if (text) out.push(text);
    }
  } finally {
    // A server this process started must not outlive it.
    if (state.inProcess) await lsp.disconnectAll().catch(() => {});
  }
  if (out.length > 0) say(out.join("\n"));
  quit();
}

// The message about one file of the batch, or null for silence.
async function diagnose(lsp, input, file, stash, calls, state, overTime) {
  const name = path.basename(file);
  const serverConfig = lsp.getServerForFile(file);
  // No server for this language, or the server is not installed. Say nothing:
  // an edit to a .md file should not produce output, and claiming "clean" for a
  // language nothing checked would be a lie.
  if (!serverConfig || !lsp.commandExists(serverConfig.command)) return null;

  // A call rejected by input validation (old_string not found ...) fires no
  // PreToolUse and changes nothing (measured); its file's old errors are not news.
  if (!stash && calls.every(failed)) return null;

  let afterText;
  try { afterText = fs.readFileSync(file, "utf8"); } catch { return null; }

  const beforeText = stash ? stash.text : null;
  if (beforeText === afterText) return null;   // nothing actually changed
  if (overTime) return unchecked(input, file, `this report used up its ${REPORT_MS}ms before ${name}`);

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
    // The servers it starts stay up for the batch's other files; main() stops them.
    via = "in-process";
    state.inProcess = true;
    r = await lsp.editDiagnostics(req);
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

  const notAnswered = `${serverConfig.name} did not answer about ${name} within ${BUDGET_MS}ms`;
  const withDebug = text => (text ? text + debug : null);
  // Fully checked: the server answered and, for Rust, cargo check finished.
  const checked = ready && !rustcUnchecked;
  const again = checked && checkedAgain(input, file);

  if (beforeText === null) {
    const errs = dedupe(after.filter(isError));
    if (!ready) return withDebug(unchecked(input, file, notAnswered));
    if (errs.length === 0) {
      if (rustcUnchecked) return withDebug(unchecked(input, file, rustcNote));
      return again ? `nord: ${name} is checked again — no new errors.${debug}` : null;
    }
    return `nord: ${name} has ${errs.length} error(s); no pre-edit baseline was captured, so these may predate this response's edits.\n${render(file, errs).split("\n").slice(1).join("\n")}${debug}`;
  }

  const fresh = newErrors(dedupe(before.filter(isError)), dedupe(after.filter(isError)));
  if (fresh.length > 0) {
    // rustc ran against the disk text only; without an earlier verdict from this
    // server session its errors may predate the edit.
    const notes = [];
    if (rustcBaselineKnown === false && fresh.some(d => d.source === "rustc")) notes.push("no rustc baseline in this server session; rustc errors may predate this edit");
    if (rustcUnchecked) notes.push(`not checked — ${rustcNote}`);
    return render(file, fresh) + notes.map(n => `\n  (${n})`).join("") + debug;
  }

  // Nothing new. Only claim that if the server actually looked.
  if (!ready) return withDebug(unchecked(input, file, notAnswered));
  if (rustcUnchecked) return withDebug(unchecked(input, file, rustcNote));
  if (again) return `nord: ${name} is checked again — no new errors.${debug}`;
  if (DEBUG) return `nord: no new errors.${debug}`;
  return null;
}

main().catch(() => process.exit(0));
