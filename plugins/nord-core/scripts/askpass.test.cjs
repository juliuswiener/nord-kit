#!/usr/bin/env node
// askpass.test.cjs — plain-node checks for scripts/askpass.sh (SUDO_ASKPASS helper: shows reason + command).
// Run: node askpass.test.cjs [section]
//      sections: dialog command text reason failclosed password anleitung   (no argument = these)
//      opt-in:   show  (prints the capture)  real  (ONE real zenity call, --timeout=2, opens a window for 2 s)
//                gtk   (feeds the captured text to the real GTK label calls of zenity's entry.c; needs python3-gi + $DISPLAY)
//
// No real sudo and no real zenity in the default run. The parent is a tiny C program (needs cc, gcc or clang),
// started with argv[0] "sudo": its /proc/<pid>/cmdline is exactly `sudo -A systemctl restart foo`. Like sudo
// (src/tgetpass.c sudo_askpass) it forks and execs $SUDO_ASKPASS — the askpass is its CHILD, not an exec.
// The zenity is a node script first on PATH: it records argv + stdin and prints a fixed password.
// Fixtures live under $TMPDIR.
//
// What the dialog shows is modelled from the zenity 4.2.2 / GTK 4.24.1 sources (entry.c: label text =
// gtk_label_set_text_with_mnemonic(g_strcompress(text)); forms.c / msg.c: gtk_label_set_markup(g_strcompress(text))).
//
// Mutation seds (run against a COPY, never the real file; ASKPASS_UNDER_TEST points the test at the copy):
//   sed "$SED" askpass.sh > $TMPDIR/m.sh; ASKPASS_UNDER_TEST=$TMPDIR/m.sh node askpass.test.cjs
//   SED_A ='s/"Befehl: \$cmd"/"Befehl: "/'                           command removed from the text
//   SED_B ='s/"Wofür: \$why"/"Wofür: "/'                            reason removed from the text
//   SED_C ='s/^esc() {.*/esc() { cat; }/'                            escaping dropped: "\" and "_" reach the label
//   SED_C2='s/--entry --hide-text/--forms --add-password=Passwort/'  a dialog whose label parses markup
//   SED_D ='s/^\[ -n "\$cmd" \] || .*/:/'                           fail closed dropped
// The instructions (section anleitung) against the OLD SKILL.md: git show HEAD~:plugins/nord-core/skills/interactive/SKILL.md
//   > $TMPDIR/old-skill.md; SKILL_UNDER_TEST=$TMPDIR/old-skill.md node askpass.test.cjs anleitung   (HEAD~ = the commit before this change)

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = process.env.ASKPASS_UNDER_TEST || path.join(__dirname, "askpass.sh");

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
}

const ROOT = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "askpass-test-"));
process.on("exit", () => fs.rmSync(ROOT, { recursive: true, force: true }));
const BIN = path.join(ROOT, "bin"), REC = path.join(ROOT, "zenity.jsonl"), ASKPASS = path.join(ROOT, "askpass.sh");
const FAKE_SUDO = path.join(ROOT, "fake-sudo");
fs.mkdirSync(BIN);

// A copy with the exec bit, so a mutated copy (sed output has none) runs like the installed one (chmod 700).
let setupErr = "";
try { fs.copyFileSync(SCRIPT, ASKPASS); fs.chmodSync(ASKPASS, 0o700); } catch (e) { setupErr = `${SCRIPT}: ${e.message}`; }

fs.writeFileSync(path.join(BIN, "zenity"), `#!${process.execPath}
const fs = require("fs");
fs.appendFileSync(process.env.FAKE_ZENITY_REC, JSON.stringify({ argv: process.argv.slice(2), stdin: fs.readFileSync(0, "utf8") }) + "\\n");
if (process.env.FAKE_ZENITY_MODE === "cancel") process.exit(1);
process.stdout.write("s3cret-pa55\\n");
`, { mode: 0o755 });

const FAKE_SUDO_C = `
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
int main(int argc, char **argv) {
  char *a = getenv("SUDO_ASKPASS"), *prompt = getenv("FAKE_SUDO_PROMPT");
  if (!a) return 99;
  if (getenv("FAKE_SUDO_BLANK_ARGV"))  /* wipe our own command line: /proc/<pid>/cmdline is NUL bytes only */
    memset(argv[0], 0, argv[argc - 1] + strlen(argv[argc - 1]) - argv[0]);
  pid_t p = fork();
  if (p == 0) { execl(a, a, prompt ? prompt : "[sudo] password for julius: ", (char *)0); _exit(127); }
  int st; waitpid(p, &st, 0);
  return WIFEXITED(st) ? WEXITSTATUS(st) : 128;
}
`;
function buildFakeSudo() {
  fs.writeFileSync(FAKE_SUDO + ".c", FAKE_SUDO_C);
  for (const cc of ["cc", "gcc", "clang"]) {
    if (spawnSync(cc, ["-o", FAKE_SUDO, FAKE_SUDO + ".c"], { encoding: "utf8" }).status === 0) return "";
  }
  return "no C compiler (cc, gcc, clang) could build the fake sudo";
}
const buildErr = setupErr || buildFakeSudo();

const ARGS = ["-A", "systemctl", "restart", "foo"];
// The fake sudo with argv[0] "sudo". o.why -> NORD_SUDO_WHY (undefined: not set at all), o.env: extra env.
function run(o = {}) {
  fs.rmSync(REC, { force: true });
  const env = { PATH: `${o.bin || BIN}:${process.env.PATH}`, HOME: ROOT, LANG: process.env.LANG || "C", FAKE_ZENITY_REC: REC, SUDO_ASKPASS: ASKPASS, ...(o.env || {}) };
  if (o.why !== undefined) env.NORD_SUDO_WHY = o.why;
  const r = spawnSync(FAKE_SUDO, o.args || ARGS, { argv0: "sudo", env, encoding: "utf8", timeout: o.timeout || 20000, stdio: ["ignore", "pipe", "pipe"] });
  const calls = fs.existsSync(REC) ? fs.readFileSync(REC, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", signal: r.signal, calls, argv: (calls[0] || { argv: [] }).argv };
}
const textOf = (argv) => (argv.find((a) => a.startsWith("--text=")) || "").slice("--text=".length);

// What the user reads for --text (see the header). Unknown dialog kinds: the text as given.
function shown(argv) {
  if (argv.includes("--no-markup")) return textOf(argv);
  const t = textOf(argv).replace(/\\([0-7]{1,3}|[\s\S])/g, (m, x) =>
    /^[0-7]/.test(x) ? String.fromCharCode(parseInt(x, 8)) : { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" }[x] ?? x); // g_strcompress
  if (argv.includes("--entry")) return t.replace(/__|_([\s\S]?)/g, (m, x) => (m === "__" ? "_" : x)); // markup escaped, "_" = mnemonic
  if (argv.includes("--forms")) return t.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|apos);/g, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e])); // markup parsed
  return t;
}
// The command as a human should read it: shell quoting, control characters as $'..' escapes.
const quote = (s) =>
  s === "" ? "''" : /^[A-Za-z0-9_@%+=:,.\/-]+$/.test(s) ? s
  : /[\x00-\x1f\x7f]/.test(s) ? "$'" + [...s].map((c) => ({ "\t": "\\t", "\n": "\\n", "\r": "\\r", "\x1b": "\\e", "\\": "\\\\", "'": "\\'" }[c] ??
      (/[\x00-\x1f\x7f]/.test(c) ? "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0") : c))).join("") + "'"
  : "'" + s.replace(/'/g, "'\\''") + "'";
const want = (why, args = ARGS) => ["Claude Code fragt nach deinem sudo-Passwort.", `Wofür: ${why}`, `Befehl: ${["sudo", ...args].map(quote).join(" ")}`].join("\n");
const flat = (s) => s.replace(/\n/g, ""); // fold -s only inserts a newline after a space

function needSetup(name) {
  if (!buildErr) return true;
  check(`${name}: askpass.sh copied and fake sudo built`, false, buildErr);
  return false;
}

const SECTIONS = {};

// The agreed case: `sudo -A systemctl restart foo`, reason "Dienst neu starten" — both in ONE dialog.
SECTIONS.dialog = function () {
  if (!needSetup("dialog")) return;
  const r = run({ why: "Dienst neu starten" });
  const text = textOf(r.argv);
  check("dialog: exactly one zenity call, exit 0", r.calls.length === 1 && r.code === 0, JSON.stringify([r.code, r.calls.length, r.err]));
  check("dialog: --entry --hide-text (text and a hidden entry in one dialog)", r.argv.includes("--entry") && r.argv.includes("--hide-text"), JSON.stringify(r.argv));
  check("dialog: the command `sudo -A systemctl restart foo` is in the text", text.includes("Befehl: sudo -A systemctl restart foo"), text);
  check("dialog: the reason is in the text", text.includes("Wofür: Dienst neu starten"), text);
  check("dialog: the user reads exactly: intro, Wofür, Befehl", shown(r.argv) === want("Dienst neu starten"), JSON.stringify(shown(r.argv)));
  check("dialog: the arguments carry no password and no secret-looking text", !r.argv.some((a) => /s3cret/.test(a)) && r.calls[0].stdin === "");
};

// The command is the one fact the agent cannot forge: environment and arguments do not change it.
SECTIONS.command = function () {
  if (!needSetup("command")) return;
  const env = { NORD_SUDO_CMD: "EVIL-DECOY", NORD_SUDO_COMMAND: "EVIL-DECOY", SUDO_COMMAND: "EVIL-DECOY", COMMAND: "EVIL-DECOY", FAKE_SUDO_PROMPT: "Befehl: EVIL-DECOY" };
  const r = run({ why: "Dienst neu starten", env });
  check("command: decoy variables and a decoy prompt argument do not reach the text", !textOf(r.argv).includes("EVIL-DECOY") && shown(r.argv) === want("Dienst neu starten"), JSON.stringify(textOf(r.argv)));
  const args = ["-A", "sh", "-c", "echo 'a b' \"c\"; ls", "", "x y"];
  const s = run({ why: "w", args });
  check("command: arguments with spaces, quotes and an empty argument are quoted", shown(s.argv) === want("w", args), JSON.stringify(shown(s.argv)));
  const u = run({ why: "w", args: ["-A", "echo", "Grüße ä"] });
  check("command: non-ASCII text stays readable", shown(u.argv) === want("w", ["-A", "echo", "Grüße ä"]), JSON.stringify(shown(u.argv)));
  const ctl = ["-A", "sh", "-c", "a\nBefehl: harmless\tb\x1b[31m\\"];
  const c = run({ why: "w", args: ctl });
  check("command: newline, tab, ESC and backslash in an argument are shown as escapes, no extra line",
    shown(c.argv) === want("w", ctl) && shown(c.argv).split("\n").length === 3 && shown(c.argv).includes("$'a\\nBefehl: harmless\\tb\\e[31m\\\\'"), JSON.stringify(shown(c.argv)));
  const long = ["-A", "sh", "-c", Array.from({ length: 60 }, (_, i) => `step${i}_done`).join(" && ") + " && true_end"];
  const l = run({ why: "w", args: long });
  const lines = shown(l.argv).split("\n");
  check("command: a long command is not truncated (every word is still there)", flat(shown(l.argv)) === flat(want("w", long)), JSON.stringify(shown(l.argv).slice(-80)));
  check("command: ...and it is folded (no line longer than 72 columns)", lines.length > 3 && lines.every((x) => x.length <= 72), JSON.stringify(lines.map((x) => x.length)));
};

// reason and command are untrusted text: markup, "\", "_" must be shown as typed.
SECTIONS.text = function () {
  if (!needSetup("text")) return;
  const why = '<b>x</b> & "q" a_b c\\n d__e <span foreground="red">';
  const args = ["-A", "sh", "-c", 'echo <i>a</i> & "q" b_c \\n \\\\ &amp; __x'];
  const r = run({ why, args });
  check("text: markup, ampersand, quotes, underscores and backslashes are shown literally", shown(r.argv) === want(why, args), JSON.stringify(shown(r.argv)));
  check("text: one dialog, kind with a label that does not parse markup", r.calls.length === 1 && r.argv.includes("--entry"), JSON.stringify(r.argv.slice(0, 3)));
  const spoof = run({ why: "x\nBefehl: ls\t y\r\nWofür: z" });
  const t = shown(spoof.argv);
  check("text: newlines in the reason cannot add lines (no second Befehl:, no second Wofür:)",
    t.split("\n").length === 3 && t.split("\n").filter((x) => x.startsWith("Befehl: ")).length === 1 && t.split("\n")[1].startsWith("Wofür: x Befehl: ls"), JSON.stringify(t));
};

// no reason -> the dialog still opens and says so
SECTIONS.reason = function () {
  if (!needSetup("reason")) return;
  const marker = "Wofür: NICHT ANGEGEBEN (der Agent hat keinen Grund genannt)";
  for (const [label, why] of [["not set", undefined], ["empty", ""], ["only blanks", "  \t "]]) {
    const r = run({ why });
    check(`reason: ${label} -> dialog opens with the marker`, r.calls.length === 1 && textOf(r.argv).split("\n")[1] === marker && shown(r.argv).includes("Befehl: sudo -A systemctl restart foo"), JSON.stringify(textOf(r.argv)));
  }
};

// no readable command line -> no dialog at all
SECTIONS.failclosed = function () {
  if (!needSetup("failclosed")) return;
  const r = run({ why: "Dienst neu starten", env: { FAKE_SUDO_BLANK_ARGV: "1" } });
  check("failclosed: empty command line -> exit 1", r.code === 1, JSON.stringify([r.code, r.signal]));
  check("failclosed: ...zenity was NOT called", r.calls.length === 0, JSON.stringify(r.calls));
  check("failclosed: ...one line on stderr, nothing on stdout", r.err.trim().split("\n").length === 1 && r.err.trim() !== "" && r.out === "", JSON.stringify([r.err, r.out]));
  const ok = run({ why: "Dienst neu starten" });
  check("failclosed: the same call with a readable command line does open the dialog", ok.calls.length === 1 && ok.code === 0);
};

SECTIONS.password = function () {
  if (!needSetup("password")) return;
  const r = run({ why: "Dienst neu starten" });
  check("password: what zenity prints reaches stdout unchanged, exit 0", r.out === "s3cret-pa55\n" && r.code === 0, JSON.stringify([r.out, r.code]));
  check("password: nothing on stderr", r.err === "", JSON.stringify(r.err));
  const c = run({ why: "Dienst neu starten", env: { FAKE_ZENITY_MODE: "cancel" } });
  check("password: cancel -> non-zero exit and no output", c.code !== 0 && c.code !== null && c.out === "", JSON.stringify([c.code, c.out]));
};

// The instructions: the install lines are taken OUT of the SKILL.md text and run in a fixture HOME (the way
// skill-lock.test.cjs runs its SKILL.md commands), and no file of the repo may tell agents the old call.
// What no test can show: that an agent follows the steps.
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const SKILL = process.env.SKILL_UNDER_TEST || path.join(PLUGIN_ROOT, "skills", "interactive", "SKILL.md");
function docs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") docs(p, out); } else if (/\.(md|json)$/.test(e.name)) out.push(p);
  }
  return out;
}
SECTIONS.anleitung = function () {
  const md = fs.readFileSync(SKILL, "utf8");
  const call = (md.match(/^NORD_SUDO_WHY='[^'\n]+' SUDO_ASKPASS=~\/\.cache\/nord\/askpass\.sh sudo -A <cmd>$/m) || [])[0];
  check("anleitung: the sudo call sets NORD_SUDO_WHY and SUDO_ASKPASS=~/.cache/nord/askpass.sh", !!call);
  check("anleitung: the old printf helper and 'created if absent' are gone", !/printf '#!\/bin\/sh/.test(md) && !/created if absent/.test(md));
  const install = (md.match(/^mkdir -p ~\/\.cache\/nord\ncp "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/askpass\.sh" ~\/\.cache\/nord\/askpass\.sh\nchmod 700 ~\/\.cache\/nord\/askpass\.sh$/m) || [])[0];
  check("anleitung: the helper is installed by cp from ${CLAUDE_PLUGIN_ROOT}/scripts/askpass.sh, chmod 700", !!install);
  if (install) {
    const home = path.join(ROOT, "home-install");
    fs.mkdirSync(path.join(home, ".cache", "nord"), { recursive: true });
    const target = path.join(home, ".cache", "nord", "askpass.sh");
    fs.writeFileSync(target, "#!/bin/sh\nzenity --password\n", { mode: 0o755 }); // the stale helper of the old procedure
    const r = spawnSync("sh", ["-c", install.split("${CLAUDE_PLUGIN_ROOT}").join(PLUGIN_ROOT)], { encoding: "utf8", env: { ...process.env, HOME: home } });
    check("anleitung: the install lines exit 0, overwrite a stale helper, leave mode 700 and the script's bytes",
      r.status === 0 && fs.readFileSync(target, "utf8") === fs.readFileSync(path.join(__dirname, "askpass.sh"), "utf8") && (fs.statSync(target).mode & 0o777) === 0o700, JSON.stringify([r.status, r.stderr]));
  }
  const repo = fs.existsSync(path.join(PLUGIN_ROOT, "..", "..", ".claude-plugin", "marketplace.json")) ? path.resolve(PLUGIN_ROOT, "..", "..") : PLUGIN_ROOT;
  const old = [];
  for (const f of [...docs(repo), ...(process.env.SKILL_UNDER_TEST ? [SKILL] : [])]) fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (/SUDO_ASKPASS=/.test(l) && !/NORD_SUDO_WHY=/.test(l)) old.push(`${path.relative(repo, f)}:${i + 1}`); });
  check("anleitung: no .md/.json in the repo tells agents to call sudo -A without NORD_SUDO_WHY", old.length === 0, old.join(", "));
};

// --- opt-in ---
SECTIONS.show = function () {
  if (!needSetup("show")) return;
  const r = run({ why: "Dienst neu starten" });
  console.log("zenity argv:", JSON.stringify(r.argv));
  console.log("--text as given:\n" + textOf(r.argv));
};

// ONE real zenity call (the option set is accepted?): exit 5 = the 2 s timeout ran out; nothing is typed.
SECTIONS.real = function () {
  if (!needSetup("real")) return;
  const real = spawnSync("sh", ["-c", "command -v zenity"], { encoding: "utf8" }).stdout.trim();
  fs.mkdirSync(path.join(ROOT, "realbin"));
  fs.writeFileSync(path.join(ROOT, "realbin", "zenity"), `#!/bin/sh\nexec ${real} "$@" --timeout=2\n`, { mode: 0o755 });
  const gui = {}; // the session zenity needs to open its window
  for (const k of ["HOME", "DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) if (process.env[k]) gui[k] = process.env[k];
  const r = run({ why: "Dienst neu starten", bin: path.join(ROOT, "realbin"), timeout: 30000, env: gui });
  check("real: zenity 4.2.2 accepts the option set (exit 5 = timeout, no input)", r.code === 5, JSON.stringify([r.code, r.signal, r.out, r.err]));
};

// The captured --text goes through the REAL GTK calls of entry.c; get_text() is what the label displays.
SECTIONS.gtk = function () {
  if (!needSetup("gtk")) return;
  const cases = [["Dienst neu starten", ARGS], ['<b>x</b> & "q" a_b c\\n d__e', ["-A", "sh", "-c", 'echo <i>a</i> & b_c \\n \\\\ &amp; __x']], ["w", ["-A", "sh", "-c", "a\nb\tc"]]];
  const texts = cases.map(([why, args]) => ({ want: want(why, args), got: textOf(run({ why, args }).argv) }));
  const py = `import json,sys,gi\ngi.require_version("Gtk","4.0")\nfrom gi.repository import Gtk,GLib\nassert Gtk.init_check()\nout=[]\nfor t in json.load(sys.stdin):\n  l=Gtk.Label(); l.set_text_with_mnemonic(GLib.strcompress(t)); out.append(l.get_text())\nprint(json.dumps(out))`;
  const g = spawnSync("python3", ["-I", "-c", py], { input: JSON.stringify(texts.map((t) => t.got)), encoding: "utf8", timeout: 30000 });
  let got = []; try { got = JSON.parse(g.stdout); } catch {}
  texts.forEach((t, i) => check(`gtk: case ${i + 1}: Gtk.Label shows exactly the intended text`, got[i] === t.want, JSON.stringify([got[i], t.want, g.stderr.split("\n")[0]])));
};

const OPT_IN = new Set(["show", "real", "gtk"]);
const only = process.argv[2];
for (const [name, fn] of Object.entries(SECTIONS)) {
  if (only ? only !== name : OPT_IN.has(name)) continue;
  try { fn(); } catch (e) { check(`${name}: threw`, false, String(e && e.stack).split("\n").slice(0, 3).join(" | ")); }
}
if (only && !SECTIONS[only]) check(`unknown section "${only}"`, false);
console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
