#!/usr/bin/env node
// NOT REGISTERED since 2026-09-05. This pair needs dist/tools/lsp/index.js, which
// lived in the nord-core development repo (retired 2026-09-03, deleted 2026-09-05) and
// was never part of nord-kit. Without it the report hook quits on every call, and this
// capture hook has been writing a full copy of every edited file to
// /tmp/nord-edit-diag-<uid>/ for nobody — 195 files on the day it was measured. Both
// files stay so the pair can be re-registered in hooks.json once dist/ is back.
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
// So the work is handed to a daemon that keeps the servers warm between
// processes. If the daemon cannot be reached the hook does the work in-process
// exactly as before -- slow, but correct. The daemon is an optimisation, and a
// broken one must never be able to turn a real answer into silence.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const WATCHED = new Set(["Edit", "Write", "NotebookEdit"]);
const BUDGET_MS = positiveInt(process.env.NORD_EDIT_DIAG_BUDGET_MS, 4000);
const DEBUG = process.env.NORD_EDIT_DIAG_DEBUG === "1";
// How long to wait for a server that reports itself still indexing, BEFORE
// asking. Default 0: the fast path never waits, because turning every edit into
// a multi-second stall to serve the rare cold first edit is a bad trade — an
// honest "not checked" costs nothing and says the same thing. Raise it when
// reliability matters more than latency (measured: rust-analyzer needs seconds
// on a cold crate, and answers empty until then).
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
function identity(d) {
  return [d.severity, d.code === undefined || d.code === null ? "" : d.code, d.source || "", d.message].join(" ");
}

const isError = d => d.severity === 1;

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
  const lsp = await import(pathToFileURL(dist).href);

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
  let before = [];
  let after = [];
  let answered = false;
  let indexState = "unknown";
  let via = "daemon";

  // The whole before/after sequence goes over in ONE request. Splitting it into
  // per-step calls would mean the daemon holding a client lease across socket
  // round-trips, and this process dying mid-sequence would pin that client.
  const useDaemon = process.env.NORD_LSP_DAEMON !== "0";
  let daemonErr = null;
  if (useDaemon) {
    try {
      const dc = await import(pathToFileURL(
        path.join(__dirname, "..", "dist", "tools", "lsp", "daemon", "client.js")).href);
      const r = await dc.daemonEditDiagnostics(
        { file, beforeText, afterText, budgetMs: BUDGET_MS, waitReadyMs: WAIT_READY_MS },
        BUDGET_MS * 2 + WAIT_READY_MS + 30000);
      before = r.before; after = r.after;
      answered = r.answered; indexState = r.indexState;
    } catch (e) {
      // Reaching the daemon failed. Fall through to doing it here -- never to
      // reporting "no new errors", which is the one answer we have not earned.
      daemonErr = e && e.message ? e.message : String(e);
    }
  }

  if (!useDaemon || daemonErr) {
    via = daemonErr ? "in-process (daemon: " + daemonErr.slice(0, 80) + ")" : "in-process";
    await lsp.lspClientManager.runWithClientLease(file, async (client) => {
      if (WAIT_READY_MS > 0) {
        const until = Date.now() + WAIT_READY_MS;
        // Wait for POSITIVE readiness, not for the absence of "indexing":
        // a server that has not sent its first status yet reports "unknown", and
        // treating that as ready returns before rust-analyzer has said anything.
        while (client.indexState !== "ready" && Date.now() < until) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
      if (beforeText === null) {
        // No baseline. Open the real file and treat every error as "cannot tell".
        await client.openDocument(file);
        after = await client.collectDiagnostics(file, BUDGET_MS);
      } else {
        // baseSeq is -1 on a fresh open and the current publish counter when the
        // document was already open (a reused client), so the baseline's
        // diagnostics are never satisfied by the previous edit's publish.
        const baseSeq = await client.openDocumentWithText(file, beforeText);
        before = await client.collectDiagnostics(file, BUDGET_MS, baseSeq);
        const sentAt = client.changeDocument(file, afterText);
        after = await client.collectDiagnostics(file, BUDGET_MS, sentAt);
      }
      answered = client.diagnosticsAnswered(file);
      indexState = client.indexState;
    });
  }

  // A publish having arrived is not enough. Measured: rust-analyzer publishes an
  // EMPTY set immediately on didOpen and only later replaces it with the real
  // one, so "a publish arrived" is true ~300ms before any analysis exists. Its
  // own quiescent flag is the signal that can actually fail, and nord already
  // opts into it. 'unknown' is deliberately NOT treated as unready: servers that
  // offer no readiness signal at all report it forever from a fresh process, and
  // hedging on it would put "not checked" on every TypeScript edit.
  const ready = answered && indexState !== "indexing";

  const ms = Date.now() - t0;
  const debug = DEBUG ? `\n[nord-edit-diag ${ms}ms via=${via} answered=${answered} index=${indexState} before=${before.length} after=${after.length}]` : "";

  if (beforeText === null) {
    const errs = after.filter(isError);
    if (!ready) say(`nord: not checked — ${serverConfig.name} did not answer about ${path.basename(file)} within ${BUDGET_MS}ms.${debug}`);
    if (errs.length === 0) quit();
    say(`nord: ${path.basename(file)} has ${errs.length} error(s); no pre-edit baseline was captured, so these may predate this edit.\n${render(file, errs).split("\n").slice(1).join("\n")}${debug}`);
  }

  const fresh = newErrors(before, after);
  if (fresh.length > 0) say(render(file, fresh) + debug);

  // Nothing new. Only claim that if the server actually looked.
  if (!ready) {
    say(`nord: not checked — ${serverConfig.name} did not answer about ${path.basename(file)} within ${BUDGET_MS}ms, so "no new errors" is not established.${debug}`);
  }
  if (DEBUG) say(`nord: no new errors.${debug}`);
  quit();
}

main().catch(() => process.exit(0));
