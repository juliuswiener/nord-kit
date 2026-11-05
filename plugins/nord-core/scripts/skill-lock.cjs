#!/usr/bin/env node
// skill-lock.cjs — hash lock for skills installed from outside (install-skill, search-skills).
// A lock records, per skill, a SHA-256 per file and one total. Later, `verify` (and the SessionStart
// hook hooks/skill-lock-check.cjs) says which file changed. No scan, no network: this only notices
// a change AFTER install. It does not judge whether a skill was bad on the day it was installed.
//
//   node skill-lock.cjs write <skill-dir> --source <text>   lock (or re-lock) one skill
//   node skill-lock.cjs verify [<skill-dir>]                one skill, or every lock of user + project
//   node skill-lock.cjs remove <slug> [--project]           drop an entry (the folder stays)
//   exit: 0 all equal | 1 deviation | 2 not locked, lock unusable, usage error
//
// Lock file: <claude-dir>/nord-skill-lock.json, beside skills/ (user: $CLAUDE_CONFIG_DIR or ~/.claude;
// project: <project>/.claude). { "version": 1, "skills": { "<slug>": { source, files, hash } } }.
// Vault: backlog/nord/nord-kit-installiert-skills-ohne-pruefsumme-agent-skills-zeigt-ein-verfahren.
// ponytail: whoever can rewrite the skill can rewrite the lock too; a PreToolUse guard would be its own ticket.
// ponytail: no mutex around read-modify-write, two parallel writes lose one entry; upgrade: O_EXCL lock file.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const LOCK_NAME = "nord-skill-lock.json";
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function validSlug(s) {
  return typeof s === "string" && s !== "" && s !== "." && s !== "__proto__" && !/[/\\\0]|\.\./.test(s);
}

// Names reach a terminal and the model's context: control characters out, length capped.
function clean(s, max = Infinity) {
  s = String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "?");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Per file the SHA-256 of its bytes. An inner symlink is NOT followed: "symlink:" + SHA-256 of its target
// text. Anything else that is no regular file (FIFO, socket, device): "special:<type bits>", never read.
// Total = SHA-256 of the canonical JSON of the [path, value] pairs sorted by code unit (no locale);
// JSON escapes a newline in a name, so names cannot run into each other. Empty folders do not count.
// ponytail: names are read as UTF-8, a name that is not valid UTF-8 ends in an error; upgrade: readdir
// with encoding "buffer" and hex-escape the name.
// ponytail: the file mode (exec bit) is not part of the hash; upgrade: add st.mode & 0o777 to the value.
// ponytail: a file is read whole into memory; upgrade: hash in chunks (fs.readSync loop) for big assets.
function hashSkillDir(dir) {
  const root = fs.realpathSync(dir);
  const files = Object.create(null); // a file called "__proto__" must stay a key
  (function walk(abs, rel) {
    for (const name of fs.readdirSync(abs)) {
      const p = path.join(abs, name), r = rel ? rel + "/" + name : name, st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p, r);
      else if (st.isSymbolicLink()) files[r] = "symlink:" + sha(fs.readlinkSync(p));
      else if (st.isFile()) files[r] = sha(fs.readFileSync(p));
      else files[r] = "special:" + (st.mode & 0o170000).toString(8);
    }
  })(root, "");
  const names = Object.keys(files).sort();
  const pairs = names.map((n) => [n, files[n]]);
  return { files: Object.fromEntries(pairs), hash: sha(JSON.stringify(pairs)) };
}

// null = no lock file. Anything unusable throws with a short reason.
function readLock(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  let lock;
  try { lock = JSON.parse(text); } catch { throw new Error("kein gültiges JSON"); }
  if (!lock || lock.version !== 1 || !lock.skills || typeof lock.skills !== "object" || Array.isArray(lock.skills)) {
    throw new Error("unbekanntes Format oder unbekannte version");
  }
  for (const [slug, e] of Object.entries(lock.skills)) {
    if (!validSlug(slug) || !e || typeof e.hash !== "string" || !e.files || typeof e.files !== "object") {
      throw new Error(`Eintrag „${clean(slug, 60)}" ungültig`);
    }
  }
  return lock;
}

// Atomic: write a sibling file, then rename over the lock.
function writeLock(file, lock) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(lock, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

// <claude-dir>/skills/<slug> -> <claude-dir>/nord-skill-lock.json. Lexical on purpose: with a root symlink
// (npx skills add) the realpath would point into the shared copy, not to the scope the skill is installed in.
const lockFileFor = (skillDir) => path.join(path.dirname(path.dirname(path.resolve(skillDir))), LOCK_NAME);

function diffFiles(locked, now) {
  const d = [];
  for (const f of Object.keys(locked)) {
    if (!Object.hasOwn(now, f)) d.push({ file: f, kind: "fehlt" });
    else if (locked[f] !== now[f]) d.push({ file: f, kind: "geändert" });
  }
  for (const f of Object.keys(now)) if (!Object.hasOwn(locked, f)) d.push({ file: f, kind: "neu" });
  return d.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

// { state: "ok" | "changed" | "missing", diffs: [{ file, kind: "geändert" | "neu" | "fehlt" }] }
function verifyEntry(skillDir, entry) {
  if (!fs.existsSync(skillDir)) return { state: "missing", diffs: [] };
  const now = hashSkillDir(skillDir);
  if (now.hash !== entry.hash) {
    const diffs = diffFiles(entry.files, now.files);
    return { state: "changed", diffs: diffs.length ? diffs : [{ file: "(Gesamt-Hash)", kind: "geändert" }] };
  }
  return { state: "ok", diffs: [] };
}

// Checks the entries of one lock (or only `only`). null = no lock file; throws if the lock is unusable.
// A skill that cannot be read is a deviation of its own, it must not hide the others.
// `deadline` (ms since epoch): stop before the next skill once it has passed -> incomplete.
function checkLock(file, { deadline = Infinity, only } = {}) {
  const lock = readLock(file);
  if (!lock) return null;
  const skillsDir = path.join(path.dirname(file), "skills");
  const out = { count: 0, devs: [], incomplete: false };
  for (const [slug, entry] of Object.entries(lock.skills)) {
    if (only && slug !== only) continue;
    if (Date.now() >= deadline) { out.incomplete = true; break; }
    out.count++;
    try {
      const v = verifyEntry(path.join(skillsDir, slug), entry);
      if (v.state !== "ok") out.devs.push({ slug, ...v });
    } catch (e) {
      out.devs.push({ slug, state: "unreadable", diffs: [], error: e.code || e.message });
    }
  }
  return out;
}

const userClaudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const projectClaudeDir = (cwd) => path.join(process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd(), ".claude");

// The user lock, then the project lock. A lock reached twice (cwd = $HOME) counts once.
function scopeLocks(cwd) {
  const seen = new Set(), out = [];
  for (const dir of [userClaudeDir(), projectClaudeDir(cwd)]) {
    const f = path.join(dir, LOCK_NAME);
    let key; try { key = fs.realpathSync(f); } catch { key = path.resolve(f); }
    if (!seen.has(key)) { seen.add(key); out.push(f); }
  }
  return out;
}

// --- CLI -------------------------------------------------------------------------------------------

function usage(msg) {
  process.stderr.write(`skill-lock: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") opt.source = argv[++i];
    else if (argv[i] === "--project") opt.project = true;
    else if (argv[i].startsWith("--")) usage(`unbekannte Option ${clean(argv[i], 40)}`);
    else pos.push(argv[i]);
  }
  return { pos, opt };
}

function lockOrExit(file) {
  try { return readLock(file); } catch (e) { return usage(`Lock unlesbar: ${file}: ${e.message}`); }
}

// The slug is the last segment as typed, so "…/alpha/sub/.." is refused instead of quietly normalised.
const slugOf = (arg) => arg.replace(/\/+$/, "").split("/").pop();

function cmdWrite(pos, opt) {
  if (pos.length !== 1) usage("write braucht genau ein <skill-dir>");
  if (!opt.source) usage("--source <text> fehlt");
  const dir = path.resolve(pos[0]), slug = slugOf(pos[0]);
  if (!validSlug(slug)) usage(`ungültiger Skill-Name „${clean(slug, 60)}"`);
  // The hook reads <claude-dir>/nord-skill-lock.json beside skills/ only; a lock anywhere else is never checked.
  if (path.basename(path.dirname(dir)) !== "skills") usage(`${dir}: liegt nicht in einem skills/-Ordner, das Lock würde nie geprüft`);
  if (!fs.existsSync(path.join(dir, "SKILL.md"))) usage(`${dir}: keine SKILL.md`);
  const file = lockFileFor(dir);
  const lock = lockOrExit(file) || { version: 1, skills: {} };
  const h = hashSkillDir(dir);
  lock.skills[slug] = { source: opt.source, files: h.files, hash: h.hash };
  writeLock(file, lock);
  console.log(`skill-lock: ${clean(slug, 60)} gesperrt (${Object.keys(h.files).length} Dateien) in ${file}`);
  return 0;
}

function cmdRemove(pos, opt) {
  if (pos.length !== 1 || !validSlug(pos[0])) usage("remove braucht einen gültigen <slug> (ohne / und ..)");
  const file = path.join(opt.project ? projectClaudeDir() : userClaudeDir(), LOCK_NAME);
  const lock = lockOrExit(file);
  if (!lock || !Object.hasOwn(lock.skills, pos[0])) usage(`„${clean(pos[0], 60)}" ist nicht gelockt (${file})`);
  delete lock.skills[pos[0]];
  writeLock(file, lock);
  console.log(`skill-lock: ${clean(pos[0], 60)} aus ${file} entfernt`);
  return 0;
}

function devLines(d) {
  const s = clean(d.slug, 60);
  if (d.state === "missing") return [`ABWEICHUNG ${s}: Skill-Ordner fehlt (Eintrag löschen: skill-lock.cjs remove ${s})`];
  if (d.state === "unreadable") return [`ABWEICHUNG ${s}: nicht lesbar (${clean(d.error, 60)})`];
  return d.diffs.map((x) => `ABWEICHUNG ${s}: ${clean(x.file)} ${x.kind}`);
}

function cmdVerify(pos) {
  if (pos.length > 1) usage("verify nimmt höchstens ein <skill-dir>");
  const only = pos.length ? slugOf(pos[0]) : undefined;
  const files = pos.length ? [lockFileFor(pos[0])] : scopeLocks();
  let found = 0, count = 0, devs = [];
  for (const file of files) {
    let r;
    try { r = checkLock(file, { only }); } catch (e) { usage(`Lock unlesbar: ${file}: ${e.message}`); }
    if (!r) continue;
    found++; count += r.count; devs = devs.concat(r.devs);
  }
  if (!found) usage(`kein Lock gefunden: ${files.join(", ")}`);
  if (!count) usage(only ? `„${clean(only, 60)}" ist nicht gelockt` : "Lock ohne Einträge, nichts geprüft");
  console.log(devs.flatMap(devLines).concat(`skill-lock: geprüfte Skills: ${count}, Abweichungen: ${devs.length}`).join("\n"));
  return devs.length ? 1 : 0;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const { pos, opt } = parseArgs(rest);
  if (cmd === "write") return cmdWrite(pos, opt);
  if (cmd === "remove") return cmdRemove(pos, opt);
  if (cmd === "verify") return cmdVerify(pos);
  return usage("Aufruf: write <skill-dir> --source <text> | verify [<skill-dir>] | remove <slug> [--project]");
}

module.exports = { LOCK_NAME, clean, hashSkillDir, verifyEntry, checkLock, scopeLocks };

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`skill-lock: ${clean(e && e.message)}\n`);
    process.exitCode = 2;
  }
}
