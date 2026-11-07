#!/usr/bin/env node
// edit-diag-pool.test.cjs -- Obergrenze, Buchfuehrung, Abweisung und Schalter des LSP-Pools (AK0-AK7).
// Vault: der-diagnose-hook-haelt-je-rust-arbeitsbaum-einen-rust-analyzer-warm-ohne-obergrenze.
// Form wie edit-diag.test.cjs / edit-diag-rust.test.cjs: nur node, kein Framework, FAKE rust-analyzer
// auf PATH (kein echter, kein cargo), eigenes TMPDIR (kein Socket einer lebenden Sitzung antwortet).
// Ein Stand-in-Prozess spielt den MCP-Server (startDiagSocket aus dist/), der echte Hook
// (edit-diag-capture.cjs + edit-diag-report.cjs) fragt ihn ueber den Socket.
// Braucht gebautes dist/ und bridge/ (cd mcp && npm run build). LSP_DIST=<index.js> ueberschreibt nur den Server.
// STANDIN=bridge node edit-diag-pool.test.cjs ak1|ak5  -> der Server ist das gebaute Buendel bridge/mcp-server.cjs
// statt dist/ (AK8: ak1 und ak5 muessen mit beiden Stand-ins bestehen).
// Aufruf: node edit-diag-pool.test.cjs [ak0|ak1|ak2|ak3|ak4|ak5|ak6|ak7]   (ohne Argument: alle; ak1 schliesst ak1b ein)
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");

const PLUGIN = path.join(__dirname, "..");
const HOOKS = path.join(PLUGIN, "hooks");
const CAPTURE = path.join(HOOKS, "edit-diag-capture.cjs");
const REPORT = path.join(HOOKS, "edit-diag-report.cjs");
const DIST = process.env.LSP_DIST || path.join(PLUGIN, "dist", "tools", "lsp", "index.js");
const ONLY = process.argv[2] || "";
const want = (n) => !ONLY || ONLY === n;

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${detail}`}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; await sleep(50); } return cond(); }

const BASE = process.env.TMPDIR || path.join(os.homedir(), ".cache", "nord-tmp");
fs.mkdirSync(BASE, { recursive: true });
const TMP = fs.mkdtempSync(path.join(BASE, "lsp-pool-"));
const BIN = path.join(TMP, "bin");
const PIDS = path.join(TMP, "pids");
fs.mkdirSync(BIN); fs.mkdirSync(PIDS);

// Der Fake haelt sich wie der echte rust-analyzer (siehe edit-diag-rust.test.cjs): Pull-Antwort leer,
// Flycheck nur nach didSave. Neu: er schreibt seinen Lebenslauf (pid, ppid, cwd) nach FAKE_PIDDIR,
// FAKE_INIT_MS verzoegert initialize, FAKE_SLOW_MS verzoegert die Pull-Antwort (haelt die Lease offen),
// und er endet bei EOF auf stdin wie der echte.
fs.writeFileSync(path.join(BIN, "rust-analyzer"), `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
if (process.env.FAKE_PIDDIR) fs.writeFileSync(path.join(process.env.FAKE_PIDDIR, String(process.pid)), JSON.stringify({ ppid: process.ppid, cwd: process.cwd() }));
setTimeout(() => process.exit(0), 180000).unref();
let buf = Buffer.alloc(0);
const send = (m) => { const s = JSON.stringify({ jsonrpc: "2.0", ...m }); process.stdout.write("Content-Length: " + Buffer.byteLength(s) + "\\r\\n\\r\\n" + s); };
let progress = false;
process.stdin.on("end", () => process.exit(0));
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
    setTimeout(() => send({ id: m.id, result: { capabilities: { textDocumentSync: { openClose: true, change: 1, save: {} }, diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false } } } }), Number(process.env.FAKE_INIT_MS || 0));
  } else if (m.method === "initialized") {
    send({ method: "experimental/serverStatus", params: { quiescent: true, health: "ok" } });
  } else if (m.method === "textDocument/diagnostic") {
    setTimeout(() => send({ id: m.id, result: { kind: "full", items: [] } }), Number(process.env.FAKE_SLOW_MS || 0));
  } else if (m.method === "shutdown") {
    send({ id: m.id, result: null });
  } else if (m.method === "exit") {
    process.exit(0);
  } else if (m.method === "textDocument/didSave" && progress) {
    const uri = m.params.textDocument.uri;
    send({ id: 900, method: "window/workDoneProgress/create", params: { token: "rust-analyzer/flycheck/0" } });
    send({ method: "$/progress", params: { token: "rust-analyzer/flycheck/0", value: { kind: "begin", title: "cargo check" } } });
    setTimeout(() => {
      send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } });
      send({ method: "$/progress", params: { token: "rust-analyzer/flycheck/0", value: { kind: "end" } } });
    }, 300);
  }
}
`, { mode: 0o755 });

function baseEnv(extra = {}) {
  const env = { ...process.env, TMPDIR: TMP, PATH: BIN + path.delimiter + process.env.PATH, FAKE_PIDDIR: PIDS, NORD_EDIT_DIAG_DEBUG: "1" };
  for (const k of Object.keys(env)) if (/^NORD_LSP_|^NORD_EDIT_DIAG_SKIP$/.test(k)) delete env[k];
  return { ...env, ...extra };
}

function isRunning(pid) {
  try { const st = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); return st.slice(st.lastIndexOf(")") + 2, st.lastIndexOf(")") + 3) !== "Z"; } catch { return false; }
}
// Lebende Fake-Server; mit ppid nur die, die ein bestimmter Prozess (der Stand-in-Server) gestartet hat.
function servers(ppid) {
  return fs.readdirSync(PIDS).map((n) => ({ pid: Number(n), ...JSON.parse(fs.readFileSync(path.join(PIDS, n), "utf8")) }))
    .filter((s) => (ppid === undefined || s.ppid === ppid) && isRunning(s.pid));
}

function project() {
  const root = fs.mkdtempSync(path.join(TMP, "crate-"));
  fs.writeFileSync(path.join(root, "Cargo.toml"), '[package]\nname = "t"\nversion = "0.1.0"\n');
  fs.mkdirSync(path.join(root, "src"));
  return path.join(root, "src", "lib.rs");
}

const standIns = [];
async function startServer(extra = {}) {
  // STANDIN=bridge: der Stand-in ist das ausgelieferte Buendel bridge/mcp-server.cjs (der echte MCP-Server auf stdio,
  // stdin bleibt offen); sonst ein kleiner Prozess, der nur dist/tools/lsp/index.js laedt und den Socket oeffnet.
  const code = `const l = require(${JSON.stringify(DIST)}); l.startDiagSocket(); process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1e6);`;
  const child = process.env.STANDIN === "bridge"
    ? spawn("node", [path.join(PLUGIN, "bridge", "mcp-server.cjs")], { env: baseEnv(extra), stdio: ["pipe", "ignore", "ignore"] })
    : spawn("node", ["-e", code], { env: baseEnv(extra), stdio: "ignore" });
  standIns.push(child);
  const sock = path.join(TMP, `nord-lsp-${process.getuid()}`, `${child.pid}.sock`);
  await until(() => fs.existsSync(sock), 5000);
  return child;
}

function runNode(script, payload, env) {
  return new Promise((resolve) => {
    const p = spawn("node", [script], { env, stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), 60000);
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => { clearTimeout(timer); try { resolve(JSON.parse(out).hookSpecificOutput.additionalContext); } catch { resolve(""); } });
    p.stdin.end(JSON.stringify(payload));
  });
}
// Ein Edit wie Claude Code ihn meldet: PreToolUse (Stash), Datei schreiben, PostToolBatch (Bericht).
async function edit(file, env, before = "fn a() {}\n", after = "fn a() { }\n") {
  fs.writeFileSync(file, before);
  const call = { tool_name: "Edit", tool_input: { file_path: file } };
  await runNode(CAPTURE, { hook_event_name: "PreToolUse", ...call, cwd: path.dirname(file) }, env);
  fs.writeFileSync(file, after);
  return runNode(REPORT, { hook_event_name: "PostToolBatch", tool_calls: [{ ...call, tool_use_id: "t", tool_response: "ok" }], cwd: path.dirname(file) }, env);
}

async function main() {
  check("dist/tools/lsp/index.js existiert", fs.existsSync(DIST), `fehlt: ${DIST}`);

  // AK0 (Wache, heute gruen): NORD_LSP_DAEMON=0 -- der Hook rechnet im eigenen Prozess, fragt keinen Socket,
  // und der Server, den er startet, endet mit dem Hook (disconnectAll im finally von main()).
  if (want("ak0")) {
    const srv = await startServer();
    const t0 = Date.now();
    const out = await edit(project(), baseEnv({ NORD_LSP_DAEMON: "0" }));
    const ms = Date.now() - t0;
    check("AK0 NORD_LSP_DAEMON=0: Antwort kommt im Hook-Prozess (via=in-process), der Stand-in-Server startet nichts",
      /via=in-process/.test(out) && servers(srv.pid).length === 0, JSON.stringify({ out, imStandIn: servers(srv.pid).length }));
    check("AK0 und der Server des Hooks ist nach dem Hook beendet", await until(() => servers().length === 0, 3000), `${servers().length} Sprachserver leben`);
    console.log(`     (Hook mit NORD_LSP_DAEMON=0 gegen Fake-rust-analyzer: ${ms} ms fuer Capture + Report)`);
    srv.kill();
  }

  // AK1: Obergrenze fuer die Zahl der gepoolten Sprachserver (NORD_LSP_MAX_SERVERS, je Server-Befehl).
  if (want("ak1")) {
    const srv = await startServer({ NORD_LSP_MAX_SERVERS: "2" });
    const env = baseEnv();
    const files = [project(), project(), project(), project(), project()];
    const out0 = await edit(files[0], env);
    check("AK1 Vorbedingung: der erste Edit geht ueber den Socket und startet genau einen Server",
      /via=socket/.test(out0) && servers(srv.pid).length === 1, JSON.stringify({ out0, lebend: servers(srv.pid).length }));
    for (const f of files.slice(1)) await edit(f, env);
    await until(() => servers(srv.pid).length <= 2, 3000);
    const alive = servers(srv.pid);
    check("AK1 fuenf Arbeitsbaeume nacheinander, NORD_LSP_MAX_SERVERS=2: hoechstens 2 Sprachserver leben", alive.length <= 2,
      `${alive.length} Sprachserver leben: ${alive.map((s) => path.basename(path.dirname(s.cwd)) + "/" + path.basename(s.cwd)).join(", ")}`);
    srv.kill();
  }

  // AK1b (Gruppe ak1): dieselbe Grenze ohne jede Einstellung (Vorgabe 2).
  if (want("ak1")) {
    const srv = await startServer();
    const env = baseEnv();
    for (let i = 0; i < 4; i++) await edit(project(), env);
    await until(() => servers(srv.pid).length <= 2, 3000);
    const n = servers(srv.pid).length;
    check("AK1b vier Arbeitsbaeume ohne Einstellung: hoechstens 2 Sprachserver leben (Vorgabe 2)", n <= 2, `${n} Sprachserver leben`);
    srv.kill();
  }

  // AK2: wer verdraengt wird, ist der am laengsten ungenutzte; der benutzte Server wird nicht neu gestartet.
  if (want("ak2")) {
    const srv = await startServer({ NORD_LSP_MAX_SERVERS: "2" });
    const env = baseEnv();
    const [a, b, c] = [project(), project(), project()];
    await edit(a, env); await edit(b, env);
    const cwdOf = (f) => path.dirname(path.dirname(f));
    const pidOf = (f) => (servers(srv.pid).find((s) => s.cwd === fs.realpathSync(cwdOf(f))) || {}).pid;
    const pidA = pidOf(a), pidB = pidOf(b);
    await edit(a, env);                       // A ist jetzt zuletzt benutzt, B der am laengsten ungenutzte
    await edit(c, env);                       // der dritte Arbeitsbaum braucht Platz
    await until(() => servers(srv.pid).length <= 2, 3000);
    check("AK2 Vorbedingung: A und B hatten je einen eigenen Server", !!pidA && !!pidB && pidA !== pidB, JSON.stringify({ pidA, pidB }));
    check("AK2 der am laengsten ungenutzte Server (B) wurde beendet", !isRunning(pidB), `B (pid ${pidB}) lebt noch; lebend: ${servers(srv.pid).map((s) => s.pid)}`);
    check("AK2 der zuletzt benutzte Server (A) lebt weiter, dieselbe pid", isRunning(pidA) && pidOf(a) === pidA, `A war ${pidA}, jetzt ${pidOf(a)}`);
    srv.kill();
  }

  // AK3: ein Arbeitsbaum, ein Server -- auch bei gleichzeitigen Anfragen (sonst entkommt ein Server der Zaehlung).
  // Und keiner entkommt dem Beenden: nicht nach einem gescheiterten Verbindungsaufbau, nicht mitten im Aufbau.
  if (want("ak3")) {
    const f = project();
    const code = `const fs = require("fs"); const l = require(${JSON.stringify(DIST)});
const alive = () => fs.readdirSync(process.env.FAKE_PIDDIR).filter((n) => { try { const s = fs.readFileSync("/proc/" + n + "/stat", "utf8"); return s.slice(s.lastIndexOf(")") + 2, s.lastIndexOf(")") + 3) !== "Z"; } catch { return false; } }).length;
const req = { file: process.env.RACE_FILE, beforeText: "fn a() {}\\n", afterText: "fn a() { }\\n", budgetMs: 500, waitReadyMs: 0, flycheckMs: 0 };
Promise.all([l.editDiagnostics(req), l.editDiagnostics(req)]).then(async () => {
  const gestartet = alive();
  await l.disconnectAll(); await new Promise((r) => setTimeout(r, 400));
  console.log("GESTARTET " + gestartet + " NACH_DISCONNECTALL " + alive()); process.exit(0); });`;
    const r = spawnSync("node", ["-e", code], { env: baseEnv({ RACE_FILE: f, FAKE_INIT_MS: "200" }), encoding: "utf8", timeout: 30000 });
    const m = /GESTARTET (\d+) NACH_DISCONNECTALL (\d+)/.exec(r.stdout || "");
    check("AK3 zwei gleichzeitige Anfragen fuer denselben Arbeitsbaum starten genau einen Server", !!m && Number(m[1]) === 1,
      `${m ? `gestartet ${m[1]}, nach disconnectAll noch lebend ${m[2]}` : "keine Ausgabe: " + JSON.stringify({ out: r.stdout, err: (r.stderr || "").slice(0, 300) })}`);
    check("AK3 nach disconnectAll lebt kein Server mehr (keiner entkommt der Buchfuehrung)", !!m && Number(m[2]) === 0,
      `${m ? `nach disconnectAll noch lebend ${m[2]}` : "keine Ausgabe"}`);
    // Scheitert der Verbindungsaufbau (initialize laeuft in die Zeitgrenze), darf kein Server zurueckbleiben:
    // runWithClientLease/getClientForFile fangen den Fehler und werfen ihn weiter, ohne den gestarteten Prozess zu beenden.
    const code2 = `const fs = require("fs"); const l = require(${JSON.stringify(DIST)});
const alive = () => fs.readdirSync(process.env.FAKE_PIDDIR).filter((n) => { try { const s = fs.readFileSync("/proc/" + n + "/stat", "utf8"); return s.slice(s.lastIndexOf(")") + 2, s.lastIndexOf(")") + 3) !== "Z"; } catch { return false; } }).length;
const req = { file: process.env.RACE_FILE, beforeText: "fn a() {}\\n", afterText: "fn a() { }\\n", budgetMs: 500, waitReadyMs: 0, flycheckMs: 0 };
(async () => {
  let fehler = "keiner";
  try { await l.editDiagnostics(req); } catch (e) { fehler = String(e && e.message).slice(0, 70); }
  await l.disconnectAll(); await new Promise((r) => setTimeout(r, 400));
  console.log("FEHLER [" + fehler + "] NACH_FEHLER_LEBEND " + alive()); process.exit(0); })();`;
    const r2 = spawnSync("node", ["-e", code2], { env: baseEnv({ RACE_FILE: project(), FAKE_INIT_MS: "4000", NORD_LSP_TIMEOUT_MS: "700" }), encoding: "utf8", timeout: 30000 });
    const m2 = /FEHLER \[(.*)\] NACH_FEHLER_LEBEND (\d+)/.exec(r2.stdout || "");
    check("AK3 scheitert der Verbindungsaufbau, bleibt kein Sprachserver zurueck", !!m2 && /timed out/.test(m2[1]) && Number(m2[2]) === 0,
      `${m2 ? `Fehler [${m2[1]}], danach noch lebend ${m2[2]}` : "keine Ausgabe: " + JSON.stringify({ out: r2.stdout, err: (r2.stderr || "").slice(0, 300) })}`);
    // Der Verbindungsaufbau laeuft noch (initialize antwortet erst nach 3 s), als der Pool beendet wird. Der Server steht dann
    // nur in `connecting`, noch nicht in `clients`; beide Wege, den Pool zu beenden, muessen ihn trotzdem treffen: disconnectAll
    // (Ende der Sitzung) und der Exit-/Signal-Handler forceKillAll. process.emit("SIGTERM") ruft ihn, ohne den Prozess zu beenden --
    // der Fake bekommt also kein EOF auf stdin und kann nur durch den Pool selbst sterben. Gezaehlt werden nur die Server dieses Prozesses.
    const connectingCode = (ende) => `const fs = require("fs"), path = require("path"); const l = require(${JSON.stringify(DIST)});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mine = () => fs.readdirSync(process.env.FAKE_PIDDIR).filter((n) => { try {
  if (JSON.parse(fs.readFileSync(path.join(process.env.FAKE_PIDDIR, n), "utf8")).ppid !== process.pid) return false;
  const s = fs.readFileSync("/proc/" + n + "/stat", "utf8"); return s.slice(s.lastIndexOf(")") + 2, s.lastIndexOf(")") + 3) !== "Z"; } catch { return false; } }).length;
const req = { file: process.env.RACE_FILE, beforeText: "fn a() {}\\n", afterText: "fn a() { }\\n", budgetMs: 500, waitReadyMs: 0, flycheckMs: 0 };
(async () => {
  const anfrage = l.editDiagnostics(req).then(() => "beantwortet", (e) => "abgelehnt: " + String(e && e.message).slice(0, 50));
  for (let i = 0; i < 100 && mine() < 1; i++) await sleep(50);   // bis der Server gestartet ist; sein initialize steht noch aus
  const vor = mine();
  ${ende === "disconnectAll" ? "await l.disconnectAll();" : 'process.emit("SIGTERM");'}
  for (let i = 0; i < 60 && mine() > 0; i++) await sleep(50);    // ein getoeteter Prozess verschwindet nicht im selben Augenblick
  const nach = mine();
  console.log("VOR " + vor + " NACH " + nach + " ANFRAGE [" + await Promise.race([anfrage, sleep(1500).then(() => "haengt")]) + "]"); process.exit(0); })();`;
    for (const [ende, wer] of [["disconnectAll", "disconnectAll"], ["signal", "der Exit-/Signal-Handler (forceKillAll)"]]) {
      const rc = spawnSync("node", ["-e", connectingCode(ende)], { env: baseEnv({ RACE_FILE: project(), FAKE_INIT_MS: "3000" }), encoding: "utf8", timeout: 30000 });
      const mc = /VOR (\d+) NACH (\d+) ANFRAGE \[(.*)\]/.exec(rc.stdout || "");
      const was = mc ? `vor dem Beenden ${mc[1]} Server, danach noch lebend ${mc[2]}, Anfrage [${mc[3]}]` : "keine Ausgabe: " + JSON.stringify({ out: rc.stdout, err: (rc.stderr || "").slice(0, 300) });
      check(`AK3 Vorbedingung (${ende}): genau ein Server verbindet noch, als der Pool beendet wird`, !!mc && Number(mc[1]) === 1, was);
      check(`AK3 ${wer} beendet auch einen Server, der noch verbindet; die wartende Anfrage endet mit Fehler`, !!mc && Number(mc[2]) === 0 && /^abgelehnt/.test(mc[3]), was);
    }
  }

  // AK4: Leerlauf beendet den Server (NORD_LSP_IDLE_TIMEOUT_MS); ist heute schon gebaut, Mutation: evictClientIfIdle.
  if (want("ak4")) {
    const srv = await startServer({ NORD_LSP_IDLE_TIMEOUT_MS: "1500", NORD_LSP_IDLE_CHECK_INTERVAL_MS: "300" });
    const env = baseEnv();
    const out = await edit(project(), env);
    check("AK4 Vorbedingung: der Edit startet einen Server ueber den Socket", /via=socket/.test(out) && servers(srv.pid).length === 1, JSON.stringify({ out, lebend: servers(srv.pid).length }));
    const gone = await until(() => servers(srv.pid).length === 0, 8000);
    check("AK4 ohne weitere Anfrage endet der Server nach der Leerlauf-Frist (1,5 s)", gone, `${servers(srv.pid).length} Sprachserver leben nach 8 s`);
    srv.kill();
  }

  // AK5: sind beide Server belegt, wird die dritte Anfrage ehrlich abgewiesen: "not checked", kein dritter Server,
  // kein Rueckfall in den Hook-Prozess (der wuerde einen dritten rust-analyzer starten).
  if (want("ak5")) {
    const srv = await startServer({ NORD_LSP_MAX_SERVERS: "2", FAKE_SLOW_MS: "2500" });
    const env = baseEnv();
    let max = 0;
    const sampler = setInterval(() => { max = Math.max(max, servers().length); }, 40);
    const files = [project(), project(), project()];
    const outs = [edit(files[0], env), edit(files[1], env)];
    await sleep(1200);                        // beide halten ihre Lease (Pull-Antwort kommt erst nach 2,5 s)
    outs.push(edit(files[2], env));
    const [o0, o1, o2] = await Promise.all(outs);
    clearInterval(sampler);
    const inProcess = servers().filter((s) => s.ppid !== srv.pid);
    check("AK5 die dritte Anfrage meldet 'not checked' und nennt die Grenze (NORD_LSP_MAX_SERVERS)", /not checked/.test(o2) && /NORD_LSP_MAX_SERVERS/.test(o2), JSON.stringify(o2));
    check("AK5 nie mehr als 2 Sprachserver gleichzeitig (Stichprobe alle 40 ms)", max <= 2, `Spitze ${max}`);
    check("AK5 kein Rueckfall in den Hook-Prozess (kein Server mit anderem Elternprozess)", inProcess.length === 0, `${inProcess.length} Server ausserhalb des Stand-in`);
    check("AK5 die beiden belegten Anfragen wurden normal beantwortet", !/not checked/.test(o0 + o1), JSON.stringify([o0, o1]));
    srv.kill();
  }

  // AK6: Schalter je Sitzung im Hook: NORD_EDIT_DIAG_SKIP=rust-analyzer -> "not checked" (einmal je Datei), nirgends ein Server.
  if (want("ak6")) {
    const srv = await startServer();
    const env = baseEnv({ NORD_EDIT_DIAG_SKIP: "rust-analyzer" });
    const f = project();
    const o1 = await edit(f, env);
    check("AK6 mit Schalter: 'not checked' und der Schalter ist genannt", /not checked/.test(o1) && /NORD_EDIT_DIAG_SKIP/.test(o1), JSON.stringify(o1));
    check("AK6 mit Schalter startet nirgends ein Sprachserver (weder im MCP-Server noch im Hook)", servers().length === 0, `${servers().length} Sprachserver leben`);
    const o2 = await edit(f, env);
    check("AK6 die zweite Meldung zur selben Datei entfaellt (einmal je Sitzung und Datei)", o2 === "", JSON.stringify(o2));
    const o3 = await edit(project(), baseEnv());
    check("AK6 Gegenprobe: ohne Schalter prueft dieselbe Sprache weiter (ein Server laeuft, keine 'not checked'-Meldung)", servers(srv.pid).length >= 1 && !/not checked/.test(o3), JSON.stringify({ o3, lebend: servers(srv.pid).length }));
    srv.kill();
  }

  // AK7: Mitglieder EINES Cargo-Workspace teilen einen Sprachserver (Wurzel = Verzeichnis mit [workspace]).
  // Heute gilt das naechste Verzeichnis mit Cargo.toml (client.ts findWorkspaceRoot) -> ein rust-analyzer je Mitglied,
  // obwohl jeder den ganzen Workspace laedt. taxgraph/rust: 17 Mitglieder (Cargo.toml:3) + fuzz mit eigenem [workspace] (fuzz/Cargo.toml:12).
  if (want("ak7")) {
    const srv = await startServer({ NORD_LSP_MAX_SERVERS: "9" });   // Grenze hoch: gemessen wird die Wurzel, nicht die Grenze
    const env = baseEnv();
    const ws = fs.mkdtempSync(path.join(TMP, "ws-"));
    fs.writeFileSync(path.join(ws, "Cargo.toml"), '[workspace]\nresolver = "2"\nmembers = ["a", "b"]\n');
    const crate = (dir, name, extra = "") => {
      fs.mkdirSync(path.join(dir, "src"), { recursive: true });
      fs.writeFileSync(path.join(dir, "Cargo.toml"), `[package]\nname = "${name}"\nversion = "0.1.0"\n${extra}`);
      return path.join(dir, "src", "lib.rs");
    };
    const fa = crate(path.join(ws, "a"), "a"), fb = crate(path.join(ws, "b"), "b");
    await edit(fa, env); await edit(fb, env);
    const alive = servers(srv.pid);
    check("AK7 zwei Mitglieder eines Cargo-Workspace: genau ein Sprachserver, gestartet im Verzeichnis mit [workspace]",
      alive.length === 1 && alive[0].cwd === fs.realpathSync(ws), `${alive.length} Sprachserver: ${alive.map((s) => path.relative(TMP, s.cwd)).join(", ")}`);
    // Randfall wie taxgraph/rust/fuzz: ein Crate mit eigenem [workspace] gehoert NICHT zum aeusseren und behaelt seinen Server.
    const ff = crate(path.join(ws, "fuzz"), "fuzz", "\n[workspace]\n");
    await edit(ff, env);
    const cwds = servers(srv.pid).map((s) => s.cwd);
    check("AK7 Randfall: ein Crate mit eigenem [workspace] (wie rust/fuzz) bekommt einen eigenen Server",
      cwds.includes(fs.realpathSync(path.join(ws, "fuzz"))) && cwds.includes(fs.realpathSync(ws)), `Server in: ${cwds.map((c) => path.relative(TMP, c)).join(", ")}`);
    srv.kill();
  }
}

function cleanup() {
  for (const c of standIns) { try { c.kill("SIGKILL"); } catch {} }
  for (const s of servers()) {
    try { if (fs.readFileSync(`/proc/${s.pid}/cmdline`, "utf8").includes(BIN)) process.kill(s.pid, "SIGKILL"); } catch {}
  }
  if (!process.env.KEEP) fs.rmSync(TMP, { recursive: true, force: true });
}

main().then(() => {
  cleanup();
  console.log(failed ? `\n${failed} FAILED` : "\nedit-diag-pool: all ok");
  process.exit(failed ? 1 : 0);
}, (e) => { cleanup(); console.log("ABBRUCH: " + (e && e.stack || e)); process.exit(2); });
