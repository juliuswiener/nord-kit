#!/usr/bin/env node
// edit-diag-rust.test.cjs — the edit-diag hook against a FAKE rust-analyzer.
// No framework, no real rust-analyzer. Run: node edit-diag-rust.test.cjs
// Needs dist/ built (cd mcp && npm run build).
//
// The fake behaves as measured on the real one: it answers the pull request with
// its own diagnostics only, and runs a flycheck ($/progress begin/end, then a
// publishDiagnostics with source "rustc") ONLY after textDocument/didSave. Without
// the save it stays silent, so a hook that never saves reports "no new errors" for
// code that does not compile.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const HOOKS = __dirname;
const CAPTURE = path.join(HOOKS, "edit-diag-capture.cjs");
const REPORT = path.join(HOOKS, "edit-diag-report.cjs");

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${detail}`}`);
  if (!ok) failed++;
}

const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "edit-diag-rust-"));
const BIN = path.join(TMP, "bin");
fs.mkdirSync(BIN);

// FAKE_MODE: "ok" = flycheck ends, "hang" = it begins and never ends,
// "none" = didSave starts nothing. FAKE_CODE = the rustc code it publishes ("" = none).
fs.writeFileSync(path.join(BIN, "rust-analyzer"), `#!/usr/bin/env node
let buf = Buffer.alloc(0);
const send = (m) => { const s = JSON.stringify({ jsonrpc: "2.0", ...m }); process.stdout.write("Content-Length: " + Buffer.byteLength(s) + "\\r\\n\\r\\n" + s); };
let progress = false;
process.stdin.on("data", (c) => {
  buf = Buffer.concat([buf, c]);
  for (;;) {
    const h = buf.indexOf("\\r\\n\\r\\n"); if (h < 0) return;
    const n = Number(/Content-Length: (\\d+)/.exec(buf.subarray(0, h).toString())[1]);
    if (buf.length < h + 4 + n) return;
    const m = JSON.parse(buf.subarray(h + 4, h + 4 + n).toString());
    buf = buf.subarray(h + 4 + n);
    on(m);
  }
});
function on(m) {
  if (m.method === "initialize") {
    progress = !!(m.params.capabilities.window && m.params.capabilities.window.workDoneProgress);
    send({ id: m.id, result: { capabilities: { textDocumentSync: { openClose: true, change: 1, save: {} }, diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false } } } });
  } else if (m.method === "initialized") {
    send({ method: "experimental/serverStatus", params: { quiescent: true, health: "ok" } });
  } else if (m.method === "textDocument/diagnostic") {
    send({ id: m.id, result: { kind: "full", items: [] } });
  } else if (m.method === "shutdown") {
    send({ id: m.id, result: null });
  } else if (m.method === "exit") {
    process.exit(0);
  } else if (m.method === "textDocument/didSave" && progress && process.env.FAKE_MODE !== "none") {
    const uri = m.params.textDocument.uri;
    send({ id: 900, method: "window/workDoneProgress/create", params: { token: "rust-analyzer/flycheck/0" } });
    send({ method: "$/progress", params: { token: "rust-analyzer/flycheck/0", value: { kind: "begin", title: "cargo check" } } });
    if (process.env.FAKE_MODE === "hang") return;
    setTimeout(() => {
      const at = { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } };
      const code = process.env.FAKE_CODE;
      const list = code ? [
        { range: at, severity: 1, code, source: "rust-analyzer", message: "no such value in this scope" },
        { range: at, severity: 1, code, source: "rustc", message: "cannot find value \`x\` in this scope" },
      ] : [];
      send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics: list } });
      send({ method: "$/progress", params: { token: "rust-analyzer/flycheck/0", value: { kind: "end" } } });
    }, 300);
  }
}
`, { mode: 0o755 });

function project() {
  const root = fs.mkdtempSync(path.join(TMP, "crate-"));
  fs.writeFileSync(path.join(root, "Cargo.toml"), '[package]\nname = "t"\nversion = "0.1.0"\n');
  fs.mkdirSync(path.join(root, "src"));
  return path.join(root, "src", "lib.rs");
}

function run(script, file, extra) {
  const env = { ...process.env, TMPDIR: TMP, PATH: BIN + path.delimiter + process.env.PATH,
    NORD_LSP_DAEMON: "0", NORD_EDIT_DIAG_DEBUG: "1", ...extra };
  const payload = { hook_event_name: "x", tool_name: "Edit", tool_input: { file_path: file }, cwd: path.dirname(file) };
  const r = spawnSync("node", [script], { input: JSON.stringify(payload), env, encoding: "utf8", timeout: 60000 });
  try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ""; }
}

function edit(extra) {
  const f = project();
  fs.writeFileSync(f, "fn a() {\n    let y = 1;\n}\n");
  run(CAPTURE, f, extra);
  fs.writeFileSync(f, "fn a() {\n    let y = x;\n}\n");
  return run(REPORT, f, extra);
}

const dist = path.join(HOOKS, "..", "dist", "tools", "lsp", "index.js");
check("dist/tools/lsp/index.js exists", fs.existsSync(dist), `missing ${dist} -- run npm run build in mcp/`);

// 1. rustc's error is reported, once, although rust-analyzer says it too.
const out1 = edit({ FAKE_MODE: "ok", FAKE_CODE: "E0425" });
check("rustc error E0425 is reported", /introduced 1 new error/.test(out1) && /E0425 cannot find value `x`/.test(out1), `got: ${JSON.stringify(out1)}`);
check("rust-analyzer and rustc duplicate becomes one (rustc text wins)", !/no such value/.test(out1), `got: ${JSON.stringify(out1)}`);
check("cold server: says rustc errors may predate the edit", /no rustc baseline/.test(out1), `got: ${JSON.stringify(out1)}`);
check("debug line carries the flycheck timings", /didSave->flycheck-end=\d+ms didSave->first-publish=\d+ms/.test(out1), `got: ${JSON.stringify(out1)}`);

// 2. A clean rustc verdict is a real "no new errors".
const out2 = edit({ FAKE_MODE: "ok", FAKE_CODE: "" });
check("flycheck finished clean: no new errors", /no new errors/.test(out2) && !/not checked/.test(out2), `got: ${JSON.stringify(out2)}`);

// 3. A flycheck that does not finish is never "no new errors".
const t0 = Date.now();
const out3 = edit({ FAKE_MODE: "hang", FAKE_CODE: "E0425", NORD_EDIT_DIAG_FLYCHECK_MS: "1200" });
check("flycheck timeout says not checked — rustc", /not checked — rustc \(cargo check\) did not finish within 1200ms/.test(out3) && !/no new errors\./.test(out3), `got: ${JSON.stringify(out3)}`);
check("timeout is bounded by the flycheck limit", Date.now() - t0 < 15000, `took ${Date.now() - t0} ms`);

// 4. No flycheck ever begins (file outside a crate): honest answer, and it does
//    not wait out the whole limit.
const t1 = Date.now();
const out4 = edit({ FAKE_MODE: "none", FAKE_CODE: "E0425", NORD_EDIT_DIAG_FLYCHECK_MS: "30000" });
check("no flycheck begins: not checked — rustc", /not checked — rustc/.test(out4), `got: ${JSON.stringify(out4)}`);
check("and the wait ends at the start grace, not at the limit", Date.now() - t1 < 15000, `took ${Date.now() - t1} ms`);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nedit-diag-rust: all ok");
process.exit(failed ? 1 : 0);
