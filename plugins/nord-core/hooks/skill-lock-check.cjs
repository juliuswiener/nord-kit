#!/usr/bin/env node
// SessionStart — skill lock check. Skills installed from outside are locked by scripts/skill-lock.cjs
// (a SHA-256 per file in <claude-dir>/nord-skill-lock.json). This hook re-hashes the LOCKED skills of the
// user scope and the project scope at every session start and says, in ONE line, which skill changed.
// The line is a JSON object: systemMessage reaches the user, hookSpecificOutput.additionalContext the model
// (plain stdout would reach only the model). Vault: backlog/nord/nord-kit-installiert-skills-ohne-
// pruefsumme-agent-skills-zeigt-ein-verfahren.
//
// WHY A HOOK, NOT A LINE IN A SKILL: "run verify now and then" is a request an agent can forget; the
// hook runs at every start and cannot be skipped.
// Reads lock entries only and scans no folder: a skill that was never locked stays unchecked (E3).
// Fail-OPEN, always exit 0: a missing or broken lock, a vanished skill folder, an unreadable file or
// garbage on stdin end in at most one line, never in a failed session start.
// Not detected: a skill that was bad at install time, or a change that also rewrites the lock.
// ponytail: the time budget (NORD_SKILL_LOCK_BUDGET_MS, default 3000) is checked between skills, not inside
// one; a single skill with a huge tree can still run into the 5 s hook timeout, which drops the line.
// Upgrade: hand the deadline down into hashSkillDir.

"use strict";

const fs = require("fs");
const path = require("path");

const START = Date.now();
const MAX_NAMED = 3;

function emit(text) {
  process.stdout.write(JSON.stringify({
    systemMessage: text,
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
  }) + "\n");
}

function main() {
  const { clean, checkLock, scopeLocks } = require(path.join(__dirname, "..", "scripts", "skill-lock.cjs"));

  // The payload is optional: stdin only when it is a pipe (a hand-run hook on a TTY would block).
  let payload = {};
  if (!process.stdin.isTTY) {
    try { payload = JSON.parse(fs.readFileSync(0, "utf8") || "{}") || {}; } catch { /* garbage: no payload */ }
  }
  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : undefined;
  const raw = process.env.NORD_SKILL_LOCK_BUDGET_MS, ms = Number(raw);
  const budget = raw && Number.isFinite(ms) && ms >= 0 ? ms : 3000;

  const describe = (d) => {
    const s = clean(d.slug, 60);
    if (d.state === "missing") return `${s}: Skill-Ordner fehlt (Lock-Eintrag löschen: skill-lock.cjs remove ${s})`;
    if (d.state === "unreadable") return `${s}: nicht lesbar (${clean(d.error, 40)})`;
    const [first, ...rest] = d.diffs;
    return `${s}: ${clean(first.file, 60)} ${first.kind}${rest.length ? ` (+${rest.length} Dateien)` : ""}`;
  };

  const items = [];
  let incomplete = false;
  for (const file of scopeLocks(cwd)) {
    try {
      const r = checkLock(file, { deadline: START + budget });
      if (!r) continue;
      if (r.incomplete) incomplete = true;
      for (const d of r.devs) items.push(describe(d));
    } catch (e) {
      items.push(`Lock unlesbar: ${clean(file, 100)}: ${clean(e.code || e.message, 60)}`);
    }
  }
  if (!items.length && !incomplete) return;

  const named = items.slice(0, MAX_NAMED).join("; ") + (items.length > MAX_NAMED ? `; +${items.length - MAX_NAMED} weitere` : "");
  emit(["nord-skill-lock:",
    items.length ? `${named}.` : "",
    incomplete ? `Prüfung unvollständig (Zeitbudget ${budget} ms erreicht).` : "",
    items.length ? "Erst prüfen (skill-lock.cjs verify), dann nutzen." : "",
  ].filter(Boolean).join(" "));
}

try {
  main();
} catch {
  // fail-open: a broken check must not break the session start
}
process.exit(0);
