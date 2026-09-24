#!/usr/bin/env node
// edit-diag.test.cjs — plain-node check for the edit-diag hook pair.
// No framework. Run: node edit-diag.test.cjs
//
// Drives the real hooks with real-shape payloads against a throwaway TypeScript
// project and a real typescript-language-server. Needs dist/ built
// (cd mcp && npm run build). Vault: edit-diagnose-laeuft-ueber-den-warmen-mcp-server.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync, spawn } = require("child_process");

const HOOKS = __dirname;
const CAPTURE = path.join(HOOKS, "edit-diag-capture.cjs");
const REPORT = path.join(HOOKS, "edit-diag-report.cjs");
const DIST = path.join(HOOKS, "..", "dist", "tools", "lsp", "index.js");

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${detail}`}`);
  if (!ok) failed++;
}

// Every run gets its own tmpdir: the stash slots and the socket directory both
// live under os.tmpdir(), and a live session's sockets must not answer here.
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "edit-diag-test-"));
const ENV = { ...process.env, TMPDIR: TMP, NORD_EDIT_DIAG_DEBUG: "1" };

function project({ ownTypescript = true } = {}) {
  const root = fs.mkdtempSync(path.join(TMP, "proj-"));
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }));
  if (!ownTypescript) return root;
  // A project with its own classic typescript (5.x) drives typescript-language-server.
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.symlinkSync(path.join(HOOKS, "..", "mcp", "node_modules", "typescript"), path.join(root, "node_modules", "typescript"));
  return root;
}

function hook(script, event, file, env = ENV) {
  const payload = { hook_event_name: event, tool_name: "Edit", tool_input: { file_path: file }, cwd: path.dirname(file) };
  const r = spawnSync("node", [script], { input: JSON.stringify(payload), env, encoding: "utf8", timeout: 60000 });
  let ctx = "";
  try { ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { /* silent = no output */ }
  return ctx;
}

function edit(file, before, after, env) {
  fs.writeFileSync(file, before);
  hook(CAPTURE, "PreToolUse", file, env);
  fs.writeFileSync(file, after);
  return hook(REPORT, "PostToolUse", file, env);
}

async function main() {
  check("dist/tools/lsp/index.js exists", fs.existsSync(DIST), `missing ${DIST} -- run npm run build in mcp/`);

  // 1. A new error is reported -- in-process, no socket anywhere.
  const p1 = project();
  const f1 = path.join(p1, "a.ts");
  const out1 = edit(f1, "export const x: number = 1;\n", 'export const x: number = "s";\n');
  check("new error is reported", /introduced 1 new error/.test(out1), `got: ${JSON.stringify(out1)}`);
  check("without a socket it says so", /via=in-process/.test(out1), `got: ${JSON.stringify(out1)}`);

  // 2. An error that was already there is not blamed on this edit.
  const p2 = project();
  const f2 = path.join(p2, "b.ts");
  const out2 = edit(f2, 'export const y: number = "s";\n', 'export const y: number = "s";\nexport const z = 1;\n');
  check("pre-existing error stays quiet", !/introduced/.test(out2), `got: ${JSON.stringify(out2)}`);

  // 3. With a warm server listening, the hook asks it instead of starting its own.
  // Stands in for the MCP server: its shutdown handlers end in process.exit.
  const serverCode = (dist) => `const l = require(${JSON.stringify(dist)}); l.startDiagSocket();
    process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1e6);`;
  const server = spawn("node", ["-e", serverCode(DIST)], { env: ENV, stdio: "ignore" });
  const sockDir = path.join(TMP, `nord-lsp-${process.getuid()}`);
  const sock = path.join(sockDir, `${server.pid}.sock`);
  for (let i = 0; i < 50 && !fs.existsSync(sock); i++) await new Promise((r) => setTimeout(r, 100));
  check("MCP-side socket comes up", fs.existsSync(sock), `no ${sock}`);

  const p3 = project();
  const f3 = path.join(p3, "c.ts");
  edit(f3, "export const w = 1;\n", "export const w = 2;\n");            // warms the server
  fs.writeFileSync(f3, "export const w: number = 2;\n");
  hook(CAPTURE, "PreToolUse", f3);
  fs.writeFileSync(f3, 'export const w: number = "t";\n');
  const t0 = Date.now();
  const out3 = hook(REPORT, "PostToolUse", f3);
  const warmMs = Date.now() - t0;
  check("socket answer reports the new error", /introduced 1 new error/.test(out3), `got: ${JSON.stringify(out3)}`);
  check("answer came over the socket", /via=socket/.test(out3), `got: ${JSON.stringify(out3)}`);
  const ms3 = Number((/nord-edit-diag (\d+)ms/.exec(out3) || [])[1]);
  // Own classic typescript (5.9) still gets the global TS 7 native server
  // (Julius, 2026-09-24): the classic one waited 4-8 s per clean edit.
  check("own classic typescript: answered under 1 s", ms3 < 1000, `took ${ms3} ms`);
  console.log(`     warm edit round trip: ${warmMs} ms (diagnostics ${ms3} ms)`);

  // 3b. A project WITHOUT its own typescript uses the global TS 7 native server,
  //     which answers pull diagnostics -- so the everyday clean edit is fast.
  //     Measured 2026-09-24: 77 ms native vs 8,070 ms classic (vault:
  //     zwei-hooks-ohne-eintrag-in-hooks-json AK3).
  const p5 = project({ ownTypescript: false });
  const f5 = path.join(p5, "e.ts");
  edit(f5, "export const v = 1;\n", "export const v = 2;\n");            // warms it
  const out5clean = edit(f5, "export const v = 2;\n", "export const v = 3;\n");
  const ms5 = Number((/nord-edit-diag (\d+)ms/.exec(out5clean) || [])[1]);
  check("no own typescript: clean edit is answered", /no new errors/.test(out5clean), `got: ${JSON.stringify(out5clean)}`);
  check("no own typescript: clean edit under 1 s", ms5 < 1000, `took ${ms5} ms: ${JSON.stringify(out5clean)}`);
  const out5err = edit(f5, "export const v: number = 3;\n", 'export const v: number = "e";\n');
  check("no own typescript: new error is reported", /introduced 1 new error/.test(out5err), `got: ${JSON.stringify(out5err)}`);

  server.kill();
  for (let i = 0; i < 30 && fs.existsSync(sock); i++) await new Promise((r) => setTimeout(r, 100));
  check("socket is removed when the server exits", !fs.existsSync(sock), `${sock} still there`);

  // 4. A SIGKILLed server leaves its socket; the next hook call removes it and
  //    still answers in-process.
  const dead = spawn("node", ["-e", serverCode(DIST)], { env: ENV, stdio: "ignore" });
  const deadSock = path.join(sockDir, `${dead.pid}.sock`);
  for (let i = 0; i < 50 && !fs.existsSync(deadSock); i++) await new Promise((r) => setTimeout(r, 100));
  dead.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 300));
  check("SIGKILL leaves the socket (precondition)", fs.existsSync(deadSock), "socket vanished on its own");
  const out4 = edit(f3, "export const w: number = 3;\n", 'export const w: number = "u";\n');
  check("dead socket is removed on the next call", !fs.existsSync(deadSock), `${deadSock} still there`);
  check("and the answer still comes, in-process", /introduced 1 new error/.test(out4) && /via=in-process/.test(out4), `got: ${JSON.stringify(out4)}`);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : "\nedit-diag: all ok");
  process.exit(failed ? 1 : 0);
}

main();
