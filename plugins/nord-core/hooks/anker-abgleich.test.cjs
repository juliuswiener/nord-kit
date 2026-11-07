#!/usr/bin/env node
// anker-abgleich.test.cjs — do `review --deep` and `research --web` promise only the checks their code makes?
// Run: node anker-abgleich.test.cjs   (from plugins/nord-core, or by path)
//
// Ticket "review-deep-verspricht-eine-mechanische-ankerpruefung-die-es-nicht-gibt". A Workflow script has no
// filesystem and no shell (Workflow tool: "No filesystem or Node.js API access"): it can call agent() and compute
// over what the agents report. So it cannot check an anchor against a file, and a flag an agent sets
// (toolVerified, reproduced) is a report. What a script CAN do is refuse a report that names no command.
// A*/S* run the REAL script text with a stub agent(); T* read the REAL text that makes the claim.
// L* are the same for the a11y lane (skills/review/references/lens-a11y.md): its toolVerified bypass needs toolEvidence too,
// while the caller's args.toolFindings (a tool run before the workflow) stay a legitimate source of the flag.
//
// ponytail: T* match phrases; a rewording that says the same untruth differently passes (as F1/G1 in
// rollen-abgleich.test.cjs). Upgrade path: a mechanical anchor check run by the caller (not by the script).

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ---- the harness: the Workflow tool's globals, as plain JS (shared with audit-abdeckung.test.cjs) ----
const { runScript } = require("./workflow-harness.cjs");

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
  const { out } = await runScript(AUDIT, { path: "/no/such/repo", lanes: ["security"] }, agent);
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
  return (await runScript(DIFF, { target: "x" }, agent)).out.count; // 1 = the finding stands
}

// ---- lens-a11y: the first ```javascript block of skills/review/references/lens-a11y.md ----
// Ticket "die-a11y-bahn-ueberspringt-den-verifizierer-mit-einem-selbst-gesetzten-flag-ohne-befehl" (cases L*).
const A11Y = (/```javascript\n([\s\S]*?)\n```/.exec(read("skills/review/references/lens-a11y.md")) || [, ""])[1];
const TOOL_LINE = 'axe color-contrast: a.btn #767676 on #ffffff = 4.54:1 (needs 4.5)'; // one line of the caller's tool-gate output
const base = { detail: "d", where: "a.btn", severity: "high", confidence: "high" };
// The "perceivable" lane answers `lane(prompt)` (a function of the lane prompt, so a case can see what the caller's
// toolFindings put into it); the seven other lanes find nothing. The verifier answers isReal=`approve`, checked "na".
async function a11yRun(lane, approve, args = { target: "x" }) {
  const shown = []; // titles the verifier was asked about
  const seen = {}; // the "perceivable" lane's prompt and schema, for the form cases
  const agent = async (prompt, opts) => {
    if (opts.label === "review:perceivable") { seen.prompt = prompt; seen.schema = opts.schema; return { findings: lane(prompt) }; }
    if (opts.label.startsWith("review:")) return { findings: [] };
    if (opts.label.startsWith("verify:")) { const m = /Finding: "([^"]*)" @/.exec(prompt); if (m) shown.push(m[1]); return { isReal: approve, reason: "r", checked: "na" }; }
    return {};
  };
  if (!A11Y) return { shown, kept: [], seen }; // no script block found: the cases fail by assertion, L0 names the cause
  const { out } = await runScript(A11Y, args, agent);
  return { shown, kept: out.findings.map((f) => f.title), seen };
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

  // ---- L0..L3: lens-a11y.md — toolVerified skips the verifier only when the lane names the tool run it rests on ----
  const plain = (title, extra = {}) => ({ title, ...base, ...extra });
  const l0no = await a11yRun(() => [plain("plain")], false);
  const l0yes = await a11yRun(() => [plain("plain")], true);
  kase("L0", "lens-a11y.md script runs under the harness: a plain finding reaches the verifier and the verifier's isReal decides",
    A11Y.includes("pipeline(") && l0no.shown.join() === "plain" && l0no.kept.length === 0 && l0yes.kept.join() === "plain",
    [`script block found: ${A11Y !== ""}; refuting verifier: saw ${l0no.shown.join() || "(nothing)"}, kept ${l0no.kept.join() || "(nothing)"}; approving verifier: kept ${l0yes.kept.join() || "(nothing)"}`]);

  const l1 = await a11yRun(() => [
    plain("flag-absent", { toolVerified: true }),
    plain("flag-null", { toolVerified: true, toolEvidence: null }),
    plain("flag-blank", { toolVerified: true, toolEvidence: "   " }),
    plain("evidence-no-flag", { toolVerified: false, toolEvidence: TOOL_LINE }),
  ], false);
  kase("L1", "lens-a11y.md: toolVerified=true with no toolEvidence still goes to the verifier (and so does toolEvidence without the flag)",
    ["flag-absent", "flag-null", "flag-blank", "evidence-no-flag"].every((t) => l1.shown.includes(t)),
    [`verifier saw: ${l1.shown.join(", ") || "(nothing)"}; kept: ${l1.kept.join(", ") || "(nothing)"}`]);

  const l2 = await a11yRun(() => [plain("flag-cmd", { toolVerified: true, toolEvidence: 'npx wcag-contrast-cli "#767676" "#ffffff" -> 4.54:1' })], false);
  kase("L2", "lens-a11y.md: toolVerified=true with a tool run in toolEvidence still skips the verifier (the lane ran the tool itself)",
    !l2.shown.includes("flag-cmd") && l2.kept.includes("flag-cmd"), [`verifier saw: ${l2.shown.join(", ") || "(nothing)"}; kept: ${l2.kept.join(", ") || "(nothing)"}`]);

  const l3 = await a11yRun((p) => (p.includes(TOOL_LINE) ? [plain("from-axe", { toolVerified: true, toolEvidence: TOOL_LINE })] : []), false,
    { target: "x", toolFindings: `${TOOL_LINE}\naxe image-alt: img.hero has no alt` });
  const l3prompt = l3.seen.prompt || "";
  kase("L3", "lens-a11y.md: the caller's args.toolFindings reach the lane, and a finding that quotes its tool line in toolEvidence skips the verifier",
    l3prompt.includes(TOOL_LINE) && !l3.shown.includes("from-axe") && l3.kept.includes("from-axe"),
    [`lane prompt carries the tool line: ${l3prompt.includes(TOOL_LINE)}; verifier saw: ${l3.shown.join(", ") || "(nothing)"}; kept: ${l3.kept.join(", ") || "(nothing)"}`]);

  // ---- L4..L5: what the lane is told — the schema and the prompt it gets ----
  const props = (l3.seen.schema && l3.seen.schema.properties.findings.items.properties) || {};
  const flagDesc = flat((props.toolVerified && props.toolVerified.description) || "");
  kase("L4", "lens-a11y.md schema: the lane can report toolEvidence (a string), and toolVerified is not described as a fact that bypasses verify",
    !!props.toolEvidence && [].concat(props.toolEvidence.type).includes("string") && !/a fact/i.test(flagDesc) && flagDesc.includes("toolEvidence"),
    [`toolEvidence field: ${props.toolEvidence ? JSON.stringify(props.toolEvidence.type) : "(missing)"}; toolVerified says: ${around(flagDesc, /a fact/i)}; toolEvidence named there: ${flagDesc.includes("toolEvidence")}`]);
  kase("L5", "lens-a11y.md lane prompt tells the lane to put the tool-gate line (or the command it ran) in toolEvidence",
    l3prompt.includes("toolEvidence"), [`prompt says: ${around(l3prompt, /tool-gate output[^:]*:/)}; toolEvidence named: ${l3prompt.includes("toolEvidence")}`]);

  // ---- L6..L7: the prose around the script ----
  const a11yMd = read("skills/review/references/lens-a11y.md");
  const bullet = flat(section(a11yMd, "- Any failure either tier reports", "- Only what neither tier"));
  const conf = flat(section(a11yMd, "## Confidence + provenance", "## Final output"));
  kase("L6", "lens-a11y.md prose: a tool finding bypasses verify with its toolEvidence (not on the flag alone), and `high` is not 'toolVerified - a fact'",
    bullet !== "" && conf !== "" && !/These \*\*bypass\*\* adversarial verify\./.test(bullet) && bullet.includes("toolEvidence") && !/a fact/i.test(conf) && conf.includes("toolEvidence"),
    [bullet === "" || conf === "" ? "section not found" : `tier bullet: bypass sentence unconditional: ${/These \*\*bypass\*\* adversarial verify\./.test(bullet)}, toolEvidence named: ${bullet.includes("toolEvidence")}; confidence rule says: ${around(conf, /a fact/i)}, toolEvidence named: ${conf.includes("toolEvidence")}`]);

  const gateIntro = flat(section(read("skills/review/references/lens-a11y/tooling.md"), "Run at least one machine checker", "## Get a rendered page first"));
  kase("L7", "lens-a11y/tooling.md: args.toolFindings are said to bypass verify with their tool line in toolEvidence, not on the flag alone",
    gateIntro !== "" && gateIntro.includes("toolEvidence") && !/get `toolVerified:true` and bypass adversarial verify/.test(gateIntro),
    [gateIntro === "" ? "gate intro not found" : `says: ${around(gateIntro, /args\.toolFindings[^)]*\)/)}; toolEvidence named: ${gateIntro.includes("toolEvidence")}`]);

  console.log(`${total} cases, ${red} red`);
  process.exit(red ? 1 : 0);
})().catch((e) => { console.log(`FAIL harness: ${e && e.stack || e}`); process.exit(2); });
