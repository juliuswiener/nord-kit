#!/usr/bin/env node
// behaviour-verweis.test.cjs — no text of the kit points to BEHAVIOUR.md, which the kit does not ship any more.
// Run: node behaviour-verweis.test.cjs   (from plugins/nord-core/hooks, or by path)   exit 0 = no pointer left
//
// Ticket "die-behaviour-md-zeiger-in-skilltexten-zeigen-auf-eine-datei-die-es-nicht-mehr-gibt". nord-router.js says
// BEHAVIOUR.md was retired in 8fa5a860 and its rules moved to the user's own config. A customer of the kit has no such
// config, so "see BEHAVIOUR.md" in a skill, an agent card or a script comment leads nowhere. Every text that used the
// pointer already defines its grades (explicit, derived, ...) in the lines next to it; the pointer is what goes.
//
// Reads every text file of nord-core and, where the repo has it, nord-ee. Not read: node_modules, build output (bridge,
// dist), test files (they name the file to forbid it), and nord-router.js, whose comment names the retirement.
// ponytail: matches the word, not the meaning; "see the behaviour file" would pass. Upgrade path: none worth building.

const fs = require("fs");
const path = require("path");

const CORE = path.resolve(__dirname, "..");
const ROOTS = [CORE, path.join(CORE, "..", "nord-ee")].filter((d) => fs.existsSync(d));
const SKIP_DIR = new Set(["node_modules", "bridge", "dist", ".git", "__pycache__"]);
const ALLOWED = new Set([path.join(CORE, "hooks", "nord-router.js")]);
const WORD = /BEHAVIOUR/;

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p); }
    else if (e.isFile() && !/\.test\.[cm]?[jt]s$/.test(e.name) && !ALLOWED.has(p)) files.push(p);
  }
};
ROOTS.forEach(walk);

let red = 0;
const hits = [];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  if (text.includes("\0")) continue; // binary
  text.split("\n").forEach((l, i) => { if (WORD.test(l)) hits.push(`${path.relative(CORE, f)}:${i + 1}`); });
}

// Controls: the matcher matches the pointer it is meant to find, and the walk is not empty (a zero over no files proves nothing).
if (!WORD.test("(canonical vocab, see BEHAVIOUR.md)")) { red++; console.log("FAIL control: the matcher misses the pointer"); }
if (files.length < 50) { red++; console.log(`FAIL control: only ${files.length} files read`); }

for (const h of hits) { red++; console.log(`FAIL ${h} points to BEHAVIOUR.md`); }
console.log(`${files.length} files read, ${hits.length} pointers, ${red} red`);
process.exit(red ? 1 : 0);
