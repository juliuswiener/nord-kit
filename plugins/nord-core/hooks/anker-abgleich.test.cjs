#!/usr/bin/env node
// anker-abgleich.test.cjs — do `review --deep` and `research --web` promise only the checks their code makes?
// Run: node anker-abgleich.test.cjs   (from plugins/nord-core, or by path)
//
// Ticket "review-deep-verspricht-eine-mechanische-ankerpruefung-die-es-nicht-gibt". A Workflow script has no
// filesystem and no shell (Workflow tool: "No filesystem or Node.js API access"): it can call agent() and compute
// over what the agents report. So it cannot check an anchor against a file, and a flag an agent sets
// (toolVerified, reproduced) is a report. What a script CAN do is refuse a report that names no command.
// A*/S* run the REAL script text with a stub agent(); T* read the REAL text that makes the claim.
//
// ponytail: T* match phrases; a rewording that says the same untruth differently passes (as F1/G1 in
// rollen-abgleich.test.cjs). Upgrade path: a mechanical anchor check run by the caller (not by the script).

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ---- the harness: the Workflow tool's globals, as plain JS ----
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function run(src, args, agent) {
  const body = src.replace(/^export const meta/m, "const meta");
  const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let v = item;
    for (const s of stages) v = await s(v, item, i);
    return v;
  }));
  const parallel = (thunks) => Promise.all(thunks.map((t) => t()));
  return new AsyncFunction("args", "agent", "pipeline", "parallel", "phase", "log", body)(args, agent, pipeline, parallel, () => {}, () => {});
}

// ---- repo-deep: skills/review/references/repo-deep/audit.workflow.js ----
const AUDIT = read("skills/review/references/repo-deep/audit.workflow.js");
const lane = (id, extra = {}) => ({
  id, title: id, severity: "high", category: "security", file: "a.js", lines: "1-2",
  description: "d", impact: "i", recommendation: "r", effort: "small", ...extra,
});
// One lane returns `findings`; the verifier answers isReal=`approve` for every finding it is shown.
async function auditRun(findings, approve) {
  const shown = []; // ids the verifier was asked about
  const agent = async (prompt, opts) => {
    if (opts.label === "vitals") return { archetype: "library", languages: [{ name: "JavaScript", loc: 1, pct: 100 }], loc: 1, demographics: { contributors_90d: 1 } };
    if (opts.label.startsWith("find:")) return { lane: "security", summary: "s", findings };
    if (opts.label.startsWith("verify:")) {
      const ids = findings.map((f) => f.id).filter((id) => prompt.includes(`"id": "${id}"`));
      shown.push(...ids);
      return { verdicts: ids.map((findingId) => ({ findingId, isReal: approve, reasoning: "r" })) };
    }
    return {}; // blast-radius, synthesis
  };
  const out = await run(AUDIT, { path: "/no/such/repo", lanes: ["security"] }, agent);
  return { shown, kept: out.findings.map((f) => f.id) };
}

// ---- diff-deep: the first ```javascript block of skills/review/references/diff-deep.md ----
const DIFF = (/```javascript\n([\s\S]*?)\n```/.exec(read("skills/review/references/diff-deep.md")) || [, ""])[1];
// One reviewer reports one finding at a place that does not exist; the verifier answers `verdict`.
async function diffRun(verdict) {
  const agent = async (prompt, opts) => {
    if (opts.label === "review:correctness") return { findings: [{ file: "no/such/file.js", line: 99999, severity: "high", confidence: "high", title: "t", detail: "d" }] };
    if (opts.label.startsWith("review:")) return { findings: [] };
    if (opts.label.startsWith("verify:")) return verdict;
    return {};
  };
  return (await run(DIFF, { target: "x" }, agent)).count; // 1 = the finding stands
}

let red = 0;
let total = 0;
function kase(id, name, ok, detail = []) {
  total++;
  console.log(`${ok ? "ok  " : "FAIL"} ${id} ${name}`);
  if (!ok) { red++; for (const d of detail) console.log(`       ${d}`); }
}
const section = (text, from, to) => {
  const a = text.indexOf(from);
  const b = a < 0 ? -1 : text.indexOf(to, a + from.length);
  return a < 0 ? "" : text.slice(a, b < 0 ? undefined : b);
};
const flat = (s) => s.replace(/\s+/g, " ").trim(); // a pinned phrase may wrap across lines in the text
const around = (s, re) => { const m = re.exec(flat(s)); return m ? "..." + flat(s).slice(Math.max(0, m.index - 50), m.index + m[0].length + 50) + "..." : "(no match)"; };

(async () => {
  // A parser that finds nothing makes every case below pass for the wrong reason: prove the harness reaches the
  // real filters and that the extracted diff-deep script is the pipeline.
  const base = await auditRun([lane("plain")], false);
  kase("S1", "audit.workflow.js runs under the harness: a plain high finding reaches the verifier, a refuting verifier drops it",
    base.shown.join() === "plain" && base.kept.length === 0, [`shown=${base.shown} kept=${base.kept}`]);
  const na = await diffRun({ isReal: true, reason: "r", reproduced: "na" });
  const naNo = await diffRun({ isReal: false, reason: "r", reproduced: "na" });
  kase("S2", "diff-deep.md script runs under the harness: reproduced=na follows the adversarial isReal",
    DIFF.includes("pipeline(") && na === 1 && naNo === 0, [`isReal=true -> ${na}, isReal=false -> ${naNo}`]);

  // ---- A1..A2: toolVerified skips the verifier only when the lane names the command it ran ----
  const bare = await auditRun([lane("flag-null", { toolVerified: true, toolEvidence: null }), lane("flag-blank", { toolVerified: true, toolEvidence: "   " })], false);
  kase("A1", "audit.workflow.js: toolVerified=true with no toolEvidence still goes to the verifier",
    bare.shown.includes("flag-null") && bare.shown.includes("flag-blank"), [`verifier saw: ${bare.shown.join(", ") || "(nothing)"}; kept: ${bare.kept.join(", ")}`]);
  const evid = await auditRun([lane("flag-cmd", { toolVerified: true, toolEvidence: "npm audit -> CVE-2024-1 high in lodash@4.17.20" })], false);
  kase("A2", "audit.workflow.js: toolVerified=true with a command in toolEvidence still skips the verifier",
    !evid.shown.includes("flag-cmd") && evid.kept.includes("flag-cmd"), [`verifier saw: ${evid.shown.join(", ") || "(nothing)"}; kept: ${evid.kept.join(", ")}`]);

  // ---- A3..A4: reproduced counts only when the verifier names the command it ran ----
  const noCmd = [await diffRun({ isReal: false, reason: "r", reproduced: "confirmed" }), await diffRun({ isReal: false, reason: "r", reproduced: "confirmed", reproCmd: "  " })];
  const noCmdR = await diffRun({ isReal: true, reason: "r", reproduced: "refuted" });
  kase("A3", "diff-deep.md: reproduced=confirmed or refuted with no reproCmd falls back to isReal",
    noCmd.every((n) => n === 0) && noCmdR === 1, [`confirmed, isReal=false: no cmd -> ${noCmd[0]}, blank cmd -> ${noCmd[1]} (want 0, 0); refuted, isReal=true, no cmd -> ${noCmdR} (want 1)`]);
  const cmdC = await diffRun({ isReal: false, reason: "r", reproduced: "confirmed", reproCmd: "node t.js" });
  const cmdR = await diffRun({ isReal: true, reason: "r", reproduced: "refuted", reproCmd: "node t.js" });
  kase("A4", "diff-deep.md: reproduced with a reproCmd still overrides isReal, both ways",
    cmdC === 1 && cmdR === 0, [`confirmed + cmd, isReal=false -> ${cmdC} (want 1); refuted + cmd, isReal=true -> ${cmdR} (want 0)`]);

  // ---- P1: the premise of the ticket, measured. Nothing checks that the cited place exists. ----
  const forged = await auditRun([lane("forged", { file: "no/such/file.js", lines: "9999-10000" }), lane("nofile", { file: null, lines: null })], true);
  kase("P1", "a finding whose file does not exist (or is null) survives an approving verifier in audit.workflow.js and diff-deep.md",
    forged.kept.includes("forged") && forged.kept.includes("nofile") && na === 1, [`audit kept: ${forged.kept.join(", ")}; diff-deep with a missing file and isReal=true -> ${na}`]);

  // ---- T1..T4: the texts say what the cases above measured ----
  const skill = read("skills/review/SKILL.md");
  const rule1 = section(skill, "1. **A finding you cannot anchor", "2. **One severity");
  kase("T1", "review/SKILL.md rule 1 does not say --deep mechanises the anchor rule, and says no script checks file or line",
    rule1 !== "" && !/mechanis/i.test(rule1) && flat(rule1).includes("no script checks that the file or line exists"),
    [rule1 === "" ? "rule 1 not found" : `rule 1 says: ${around(rule1, /mechanis\w*/i)} ; pinned phrase present: ${flat(rule1).includes("no script checks that the file or line exists")}`]);

  const web = read("skills/research/references/web.md");
  const step25 = section(web, "### Step 2.5", "### Step 3");
  kase("T2", "research/references/web.md Step 2.5 is not called deterministic and says no script runs the quote check",
    step25 !== "" && !/deterministic/i.test(step25.split("\n")[0]) && flat(step25).includes("no script"),
    [step25 === "" ? "Step 2.5 not found" : `heading: ${step25.split("\n")[0]} ; pinned phrase "no script" present: ${flat(step25).includes("no script")}`]);

  const diffMd = read("skills/review/references/diff-deep.md");
  const verifyPar = section(diffMd, "**Verify = reproducer-gate first", "---");
  kase("T3", "review/references/diff-deep.md does not call a reported reproduction deterministic, and says the workflow does not rerun reproCmd",
    verifyPar !== "" && !/deterministically/i.test(verifyPar) && flat(verifyPar).includes("does not rerun `reproCmd`"),
    [verifyPar === "" ? "Verify paragraph not found" : `says: ${around(verifyPar, /deterministically/i)} ; pinned phrase present: ${flat(verifyPar).includes("does not rerun `reproCmd`")}`]);

  const repoMd = read("skills/review/references/repo-deep.md");
  const prov = section(repoMd, "## Finding confidence + provenance", "## Honest limitations");
  kase("T4", "review/references/repo-deep.md does not call a lane's toolVerified a fact, and names toolEvidence as what lets it skip the verifier",
    prov !== "" && !/a fact, not a vote|deterministic source/i.test(flat(prov)) && flat(prov).includes("toolEvidence"),
    [prov === "" ? "section not found" : `says: ${around(prov, /a fact, not a vote|deterministic source/i)} ; toolEvidence named: ${flat(prov).includes("toolEvidence")}`]);

  console.log(`${total} cases, ${red} red`);
  process.exit(red ? 1 : 0);
})().catch((e) => { console.log(`FAIL harness: ${e && e.stack || e}`); process.exit(2); });
