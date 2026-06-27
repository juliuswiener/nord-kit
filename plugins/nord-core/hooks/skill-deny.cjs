#!/usr/bin/env node
// PreToolUse(Skill) — hard-block overlapping/grab-bag plugin skills so the model
// cannot pick them over the canonical nord skill. CC has no settings-level skill
// deny, so this hook IS the only hard lever (router table is just a soft hint).
//
// Fail-OPEN: any parse/IO error -> allow. Never brick the Skill tool.
//
// Scope: only skills bundled by foreign plugins that duplicate a nord keeper or
// are off-topic. nord's own skills + kept claude-mem skills (mem-search,
// smart-explore, how-it-works, learn-codebase) are NOT listed.

"use strict";

// skill basename -> why blocked + what to use instead (shown to the model)
const DENY = {
  // claude-mem overlaps the nord router explicitly bans / we don't use
  "make-plan":      "use nord-plan (router canonical Plan)",
  "do":             "use nord-execute (router canonical Execute)",
  "knowledge-agent":"unused; use wiki / external-context",
  "timeline-report":"unused memory-narrative skill",
  "weekly-digests": "unused memory-narrative skill",
  "babysit":        "use the Monitor tool for PR/CI watching",
  "standup":        "off-topic grab-bag skill",
  "pathfinder":     "use codebase-audit / nord-plan",
  "design-is":      "off-topic grab-bag skill",
  "oh-my-issues":   "off-topic grab-bag skill",
  "wowerpoint":     "off-topic grab-bag skill",
  "version-bump":   "use the commit skill + manual release",
};

function allow() { process.exit(0); }   // no output -> tool proceeds

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

let raw = "";
try {
  raw = require("fs").readFileSync(0, "utf8");
} catch { allow(); }

let input;
try { input = JSON.parse(raw || "{}"); } catch { allow(); }

if (!input || input.tool_name !== "Skill") allow();

const skillArg = (input.tool_input && input.tool_input.skill) || "";
// normalize: strip a "plugin:" namespace prefix -> bare basename
const base = String(skillArg).split(":").pop().trim().toLowerCase();

if (Object.prototype.hasOwnProperty.call(DENY, base)) {
  deny(`nord: skill "${base}" disabled — ${DENY[base]}. (nord-core/skill-deny.cjs)`);
}

allow();
