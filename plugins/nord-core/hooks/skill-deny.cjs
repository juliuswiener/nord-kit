#!/usr/bin/env node
// PreToolUse(Skill) — block overlapping/grab-bag plugin skills so the model does
// not pick them over the canonical nord skill.
//
// This is a SOFT lever, and the previous header claiming otherwise was wrong in
// two measurable ways (audited 19.08.2026):
//
//   - "CC has no settings-level skill deny" — there is one level up: disabling a
//     whole plugin removes its skills from INJECTION entirely. Measured, by
//     turning nord-ee and nord-web off. Per-skill control is what does not exist:
//     `skillOverrides` returns "on" early for source === "plugin".
//   - "this hook IS the only hard lever" — it fails OPEN on any error (below),
//     which is not what hard means.
//
// And it acts where the cost does not accrue: it blocks the CALL, while the
// tokens are spent at INJECTION. All 19 claude-mem skills are injected either
// way; the 15 denied ones cost a wasted turn on top when the model reaches for
// one and is refused. What this buys is steering, not budget.
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
  "do":             "use implement (router canonical Execute)",
  "knowledge-agent":"unused; use claude-mem search / external-context",
  "timeline-report":"unused memory-narrative skill",
  "weekly-digests": "unused memory-narrative skill",
  "babysit":        "use the Monitor tool for PR/CI watching",
  "standup":        "off-topic grab-bag skill",
  "pathfinder":     "use review --scope repo --deep / nord-plan",
  "design-is":      "off-topic grab-bag skill",
  "oh-my-issues":   "off-topic grab-bag skill",
  "wowerpoint":     "off-topic grab-bag skill",
  "version-bump":   "use the commit skill + manual release",
  // Added 19.08.2026. The audit reconciled this list against what claude-mem
  // actually ships: 19 skills, 12 denied, 4 named as deliberately kept in the
  // header — and these three accounted for by neither. Unused, so denied.
  "cloud-sync":     "unused; memory sync is not part of this setup",
  "mode-creator":   "unused; modes are configured directly",
  "what-the":       "off-topic grab-bag skill",
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
