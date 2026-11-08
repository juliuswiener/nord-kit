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
// W* read the words the scripts hand to the agents and to the progress display (schema descriptions, prompts, meta, a verdict
// label): they say what the code does. A flag or an outcome an agent sets is a report; it counts only with its command.
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
// `extraArgs` override the args; `seen` keeps what the agents were told (labels, a lane's prompt and schema, the synthesis prompt).
async function auditRun(findings, approve, extraArgs = {}) {
  const shown = []; // ids the verifier was asked about
  const seen = { labels: [] };
  const agent = async (prompt, opts) => {
    seen.labels.push(opts.label);
    if (opts.label === "vitals") return { archetype: "library", languages: [{ name: "JavaScript", loc: 1, pct: 100 }], loc: 1, demographics: { contributors_90d: 1 } };
    if (opts.label.startsWith("find:")) { seen.lanePrompt = prompt; seen.laneSchema = opts.schema; return { lane: "security", summary: "s", findings }; }
    if (opts.label.startsWith("verify:")) {
      const ids = findings.map((f) => f.id).filter((id) => prompt.includes(`"id": "${id}"`));
      shown.push(...ids);
      (seen.verifyCalls = seen.verifyCalls || []).push({ label: opts.label, agentType: opts.agentType, prompt, ids });
      return { verdicts: ids.map((findingId) => ({ findingId, isReal: approve, reasoning: "r" })) };
    }
    if (opts.label === "synthesis") seen.synthPrompt = prompt;
    return {}; // blast-radius, synthesis
  };
  const { out } = await runScript(AUDIT, { path: "/no/such/repo", lanes: ["security"], ...extraArgs }, agent);
  return { shown, kept: out.findings.map((f) => f.id), seen };
}

// ---- diff-deep: the first ```javascript block of skills/review/references/diff-deep.md ----
const DIFF = (/```javascript\n([\s\S]*?)\n```/.exec(read("skills/review/references/diff-deep.md")) || [, ""])[1];
// One reviewer reports one finding at a place that does not exist; the verifier answers `verdict`.
// `seen` (optional) keeps the verifier's prompt and schema.
async function diffRun(verdict, seen = {}) {
  const agent = async (prompt, opts) => {
    if (opts.label === "review:correctness") return { findings: [{ file: "no/such/file.js", line: 99999, severity: "high", confidence: "high", title: "t", detail: "d" }] };
    if (opts.label.startsWith("review:")) return { findings: [] };
    if (opts.label.startsWith("verify:")) { seen.prompt = prompt; seen.schema = opts.schema; return verdict; }
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
  if (!A11Y) return { shown, kept: [], seen, verdicts: [] }; // no script block found: the cases fail by assertion, L0 names the cause
  const { out } = await runScript(A11Y, args, agent);
  return { shown, kept: out.findings.map((f) => f.title), seen, verdicts: out.findings.map((f) => f.verdict) };
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
// the `export const meta = {...}` literal of a script (it ends at the first `}` in column 0), or null
const metaOf = (src) => { const m = /export const meta = (\{[\s\S]*?\n\})/.exec(src); return m ? Function(`return (${m[1]})`)() : null; };

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

  // ---- W0..W9: the words the scripts hand to the agents and to the progress display ----
  // One run of audit.workflow.js shows what the lanes and the synthesis are told: a high finding (verified), a medium one (passes
  // the threshold unverified) and a tool finding with its command (skips the verifier); the verifier approves what it is shown.
  const wa = await auditRun([lane("w-high"), lane("w-med", { severity: "medium" }), lane("w-tool", { toolVerified: true, toolEvidence: "npm audit -> CVE-2024-1 high in lodash@4.17.20" })], true);
  const wProps = (wa.seen.laneSchema && wa.seen.laneSchema.properties.findings.items.properties) || {};
  const wFlag = flat((wProps.toolVerified && wProps.toolVerified.description) || "");
  const wEvid = flat((wProps.toolEvidence && wProps.toolEvidence.description) || "");
  const wDiff = {};
  if (DIFF) await diffRun({ isReal: true, reason: "r", reproduced: "na" }, wDiff);
  const wDiffProps = (wDiff.schema && wDiff.schema.properties) || {};
  const wMeta = metaOf(A11Y);
  const wVerify = (wMeta && wMeta.phases.find((p) => p.title === "Verify")) || null;
  const wSkip = await a11yRun(() => [plain("w-skip", { toolVerified: true, toolEvidence: TOOL_LINE })], false);
  const wCore = (await auditRun([], true, { lanes: undefined })).seen.labels.filter((l) => l.startsWith("find:")).length;
  kase("W0", "the places the W cases read are reached: audit lane prompt + schema + synthesis prompt, diff-deep verifier prompt + schema, a11y meta + skipped verdict, core lane count",
    !!wa.seen.lanePrompt && !!wFlag && !!wa.seen.synthPrompt && !!wDiff.prompt && !!wDiffProps.reproduced && !!wDiffProps.reproCmd && !!wVerify && wSkip.verdicts.length === 1 && wCore > 0,
    [`lane prompt: ${!!wa.seen.lanePrompt}, toolVerified description: ${!!wFlag}, synthesis prompt: ${!!wa.seen.synthPrompt}, diff-deep prompt: ${!!wDiff.prompt}, reproduced/reproCmd schema: ${!!wDiffProps.reproduced}/${!!wDiffProps.reproCmd}, a11y Verify phase: ${!!wVerify}, a11y skipped verdicts: ${wSkip.verdicts.length}, core lanes started: ${wCore}`]);

  kase("W1", "audit.workflow.js schema: toolVerified is not described as a fact that bypasses the verifier, and the description names toolEvidence as the condition",
    wFlag !== "" && !/\bfacts?\b/i.test(wFlag) && wFlag.includes("toolEvidence"),
    [`toolVerified says: ${around(wFlag, /\bfacts?\b/i)} ; toolEvidence named there: ${wFlag.includes("toolEvidence")}`]);

  const wLane = flat(wa.seen.lanePrompt || "");
  const wUncond = wLane.split(/(?<=[.!?])\s+/).filter((s) => /adversarial/i.test(s) && /\bbypass|\bskips?\b/i.test(s) && !s.includes("toolEvidence"));
  kase("W2", "audit.workflow.js lane prompt (tool-gate bullet): a tool finding is not called a FACT, and the sentence that says it skips adversarial verification names toolEvidence",
    wLane !== "" && !/\bFACT\b/.test(wLane) && wUncond.length === 0,
    [`sentence without toolEvidence: ${wUncond.map((s) => `"${s}"`).join(" ") || "(none)"} ; says FACT: ${/\bFACT\b/.test(wLane)}`]);

  const wInputs = (/^- \d+ .*findings across.*$/m.exec(wa.seen.synthPrompt || "") || ["(no Inputs line)"])[0];
  const wNever = wa.kept.filter((id) => !wa.shown.includes(id)); // in the report, never shown to the verifier
  // the count may not be called "verified", unless the line says not all of them are
  const wCalled = /\d+\s+verified\b/i.test(wInputs) || (/\bverified\b/i.test(wInputs) && !/\bnot all\b[^.;]*\bverified\b|\bunverified\b/i.test(wInputs));
  kase("W3", "audit.workflow.js synthesis prompt: the findings count is not called verified when findings in it never reached the verifier",
    wNever.length > 0 && wInputs !== "(no Inputs line)" && !wCalled,
    [`Inputs line: ${wInputs} ; kept but never shown to the verifier: ${wNever.join(", ") || "(none)"}`]);

  const wRepro = flat((wDiffProps.reproduced && wDiffProps.reproduced.description) || "");
  const wLabel = /deterministic(ally)?\s+(REAL|NOT real)/i;
  kase("W4", "diff-deep.md schema: reproduced=confirmed/refuted is not labelled deterministic, and its description names reproCmd as what makes the report count",
    wRepro !== "" && !wLabel.test(wRepro) && wRepro.includes("reproCmd"),
    [`reproduced says: ${around(wRepro, wLabel)} ; reproCmd named there: ${wRepro.includes("reproCmd")}`]);

  const wVerPrompt = flat(wDiff.prompt || "");
  const wSaysCount = /\b(without|missing|empty|blank|omit\w*)\b[^.]*\breproCmd\b|\breproCmd\b[^.]*\b(without it|only with|counts only|required|empty|missing|blank|absent|omitted)\b/i.test(wVerPrompt);
  kase("W5", "diff-deep.md verifier prompt: the outcomes are not labelled 'deterministically REAL / NOT real', and the prompt says the report counts only with reproCmd",
    wVerPrompt !== "" && !/deterministically (REAL|NOT real)/i.test(wVerPrompt) && wSaysCount,
    [`labels: ${(wVerPrompt.match(/deterministically (REAL|NOT real)/gi) || []).join(" | ") || "(none)"} ; says what happens without reproCmd: ${wSaysCount}`]);

  const wDetail = (wVerify && wVerify.detail) || "";
  kase("W6", "lens-a11y.md meta: the Verify phase does not say tool-verified findings bypass, and names toolEvidence as the condition",
    wDetail !== "" && wDetail.includes("toolEvidence"), [`Verify phase says: ${wDetail || "(not found)"}`]);

  const wReason = (wSkip.verdicts[0] && wSkip.verdicts[0].reason) || "";
  kase("W7", "lens-a11y.md: the verdict of a finding that skipped the verifier does not say it was verified",
    wSkip.kept.includes("w-skip") && wReason !== "" && !/verified/i.test(wReason), [`kept: ${wSkip.kept.join(", ") || "(nothing)"} ; verdict.reason: ${JSON.stringify(wReason)}`]);

  const wAuditMeta = metaOf(AUDIT);
  const wHead = flat(AUDIT.slice(0, Math.max(0, AUDIT.indexOf("export const meta"))) + " " + JSON.stringify(wAuditMeta));
  const wCounts = [...wHead.matchAll(/\b(\d+)(\+)?\s+(?:(?:core|parallel|specialist)\s+)*lanes\b/gi)].map((m) => ({ text: m[0], n: +m[1], plus: !!m[2] }));
  const wWrong = wCounts.filter((c) => (c.plus ? c.n > wCore : c.n !== wCore)); // "12+" is true for 13 lanes, "12" is not
  kase("W8", "audit.workflow.js header comment and meta state the number of core lanes the registry has",
    wAuditMeta !== null && wCore > 0 && wWrong.length === 0,
    [`registry starts ${wCore} core lanes ; the text says: ${wCounts.map((c) => `"${c.text}"`).join(" | ") || "(no count)"} ; wrong: ${wWrong.map((c) => `"${c.text}"`).join(" | ") || "(none)"}`]);

  // W9: control. Text that is already true must stay: the toolEvidence description names the command, the diff-deep verifier is told to put its command in reproCmd.
  kase("W9", "control: audit.workflow.js toolEvidence is described as the command run, and the diff-deep verifier is still told to put the exact command in reproCmd",
    /\bcommand\b/i.test(wEvid) && wVerPrompt.includes("command in reproCmd"),
    [`toolEvidence says: ${wEvid || "(missing)"} ; diff-deep prompt names "command in reproCmd": ${wVerPrompt.includes("command in reproCmd")}`]);

  // ---- V0..V10: which findings a verifier sees, and what the texts say about it (tickets T1a, T1b) ----
  // V0 measures what the code does; V1..V10 read the texts that describe it. The decision: the text says what the code does, the filter stays.
  const vSet = () => [lane("v-high"), lane("v-crit", { severity: "critical" }), lane("v-med", { severity: "medium" }), lane("v-low", { severity: "low" })];
  const vStd = await auditRun(vSet(), true);
  const vLite = await auditRun(vSet(), true, { verifyIntensity: "lite" });
  const vThor = await auditRun(vSet(), true, { verifyIntensity: "thorough" });
  const vOff = await auditRun(vSet(), true, { verifyIntensity: "off" });
  const vRef = await auditRun(vSet(), false); // standard, one verifier that refutes everything it is shown
  const vDiffShown = [];
  if (DIFF) {
    const dagent = async (prompt, opts) => {
      if (opts.label === "review:correctness") return { findings: ["critical", "medium", "low"].map((severity, i) => ({ file: `f${i}.js`, line: 1, severity, confidence: "high", title: `d-${severity}`, detail: "d" })) };
      if (opts.label.startsWith("review:")) return { findings: [] };
      if (opts.label.startsWith("verify:")) { vDiffShown.push(/Finding: "([^"]*)"/.exec(prompt)[1]); return { isReal: true, reason: "r", reproduced: "na" }; }
      return {};
    };
    await runScript(DIFF, { target: "x" }, dagent);
  }
  const vA11y = await a11yRun(() => ["low", "medium", "high"].map((severity) => plain(`a-${severity}`, { severity })), true);
  const vTests = await auditRun([lane("v-high")], true, { lanes: ["tests"] });
  const vSec = await auditRun([lane("v-high")], true);
  const vKinds = (r) => r.seen.verifyCalls || [];
  kase("V0", "control (what the code does): standard shows a verifier the high and critical findings, one call per lane; lite only critical; thorough three calls per finding; off none; one refutation drops under standard; diff-deep and a11y show every finding",
    vStd.shown.slice().sort().join() === "v-crit,v-high" && vKinds(vStd).length === 1
      && vLite.shown.join() === "v-crit" && vKinds(vLite).length === 1
      && vKinds(vThor).length === 6 && vKinds(vThor).every((c) => /:[012]$/.test(c.label))
      && vOff.shown.length === 0
      && vRef.kept.slice().sort().join() === "v-low,v-med"
      && vDiffShown.slice().sort().join() === "d-critical,d-low,d-medium"
      && vA11y.shown.slice().sort().join() === "a-high,a-low,a-medium",
    [`standard: saw ${vStd.shown.join() || "(nothing)"} in ${vKinds(vStd).length} call(s); lite: ${vLite.shown.join() || "(nothing)"}; thorough: ${vKinds(vThor).length} calls; off: ${vOff.shown.join() || "(nothing)"}; refuting standard kept ${vRef.kept.join() || "(nothing)"}; diff-deep verifier saw ${vDiffShown.join() || "(nothing)"}; a11y verifier saw ${vA11y.shown.join() || "(nothing)"}`]);

  const skillDesc = (/^description: "(.*)"$/m.exec(skill) || [, ""])[1];
  const deepDesc = flat(section(skillDesc, "`--deep`", "Defaults"));
  kase("V1", "review/SKILL.md description: --deep does not promise 'every finding adversarially verified', and names the high and critical filter",
    deepDesc !== "" && !/every finding/i.test(deepDesc) && /\bhigh\b/i.test(deepDesc) && /\bcritical\b/i.test(deepDesc),
    [deepDesc === "" ? "--deep part of the description not found" : `says: ${around(deepDesc, /every finding/i)} ; names high: ${/\bhigh\b/i.test(deepDesc)}, critical: ${/\bcritical\b/i.test(deepDesc)}`]);

  const diffRow = flat(skill.split("\n").find((l) => l.startsWith("| **`diff`**")) || "");
  kase("V2", "control: the diff cell of review/SKILL.md still says every finding is adversarially verified (V0: diff-deep shows a verifier every reviewer finding)",
    diffRow.includes("every finding adversarially verified") && vDiffShown.length === 3, [`row found: ${diffRow !== ""}; says it: ${diffRow.includes("every finding adversarially verified")}; verifier saw ${vDiffShown.length} of 3`]);

  const intro = flat(section(repoMd, "An architect-level audit", "\n\n"));
  kase("V3", "repo-deep.md intro: the '3 skeptics per finding, majority refute' promise is tied to the thorough tier",
    intro !== "" && (!/skeptic/i.test(intro) || /thorough/i.test(intro)),
    [intro === "" ? "intro not found" : `says: ${around(intro, /skeptics?[^)]*/i)} ; names thorough: ${/thorough/i.test(intro)}`]);

  const tiers = flat(section(repoMd, "- `verifyIntensity`", "\n- `lanes`"));
  kase("V4", "repo-deep.md verifyIntensity: the standard tier is not said to give 'the same false-positive protection' as three skeptics",
    tiers !== "" && !/same false-positive protection/i.test(tiers), [tiers === "" ? "tier block not found" : `says: ${around(tiers, /same false-positive protection/i)}`]);

  const nWord = { twelve: 12, thirteen: 13 };
  const mCounts = [...flat(repoMd).matchAll(/\b(\d+|twelve|thirteen)\s+(?:(?:specialist|core|parallel)\s+)*lanes\b/gi)].map((m) => ({ text: m[0], n: nWord[m[1].toLowerCase()] || +m[1] }));
  const phase2 = (/Phase 2: PARALLEL LANES \((\d+) agents/.exec(repoMd) || [])[1];
  const mWrong = mCounts.filter((c) => c.n !== wCore).map((c) => `"${c.text}"`).concat(phase2 && +phase2 !== wCore ? [`"Phase 2 ... ${phase2} agents"`] : []);
  kase("V5", "repo-deep.md names the number of core lanes the registry has (every 'N lanes' and the Phase 2 line)",
    wCore > 0 && mCounts.length > 0 && !!phase2 && mWrong.length === 0, [`registry starts ${wCore} core lanes ; text: ${mCounts.map((c) => `"${c.text}"`).join(" | ")} ; Phase 2 agents: ${phase2} ; wrong: ${mWrong.join(" | ") || "(none)"}`]);

  const phase3 = section(repoMd, "Phase 3:", "Phase 4:");
  const p3Lines = phase3.split("\n");
  const p3Bad = p3Lines.filter((l) => (/\b3 agents\b|2\/3|majority/i.test(l)) && !/thorough/i.test(l));
  kase("V6", "repo-deep.md Phase 3: the three-agents and two-of-three rules are tied to the thorough tier, and the standard batch is named",
    phase3 !== "" && p3Bad.length === 0 && /batch/i.test(phase3), [phase3 === "" ? "Phase 3 not found" : `lines with the rule but not thorough: ${p3Bad.map((l) => `"${l.trim()}"`).join(" | ") || "(none)"} ; batch named: ${/batch/i.test(phase3)}`]);

  const sameVerifier = vKinds(vSec).length === 1 && vKinds(vTests).length === 1
    && vKinds(vSec)[0].agentType === vKinds(vTests)[0].agentType && vKinds(vSec)[0].prompt === vKinds(vTests)[0].prompt;
  kase("V7", "repo-deep.md Phase 3: the Security lane's verifier is not described as a special one (V0: every lane gets the same verifier type and prompt)",
    sameVerifier && phase3 !== "" && !/security-domain|not a generic skeptic/i.test(phase3),
    [`same agentType and prompt for security and tests: ${sameVerifier} (${vKinds(vSec)[0] && vKinds(vSec)[0].agentType}) ; says: ${around(phase3, /security-domain[^`]*|not a generic skeptic/i)}`]);

  const m4 = flat(section(repoMd, "Plus meta-lanes", "\n"));
  kase("V8", "repo-deep.md meta-lane M4: 'runs per finding' is tied to the thorough tier",
    m4 !== "" && (!/per finding/i.test(m4) || /thorough/i.test(m4)), [m4 === "" ? "M4 line not found" : `says: ${around(m4, /M4[^)]*/)}`]);

  const provMd = flat(section(repoMd, "## Finding confidence + provenance", "## Honest limitations"));
  kase("V9", "repo-deep.md confidence: findings below the verify threshold are not called a 'verify-lite' passthrough alone (standard passes them on unverified too)",
    provMd !== "" && !/verify-lite passthrough/i.test(provMd), [provMd === "" ? "section not found" : `says: ${around(provMd, /verify-lite passthrough/i)}`]);

  const wfHead = section(AUDIT, "// ─── PHASE 2 + 3", "const REFUTE_PROMPT");
  kase("V10", "audit.workflow.js comments above REFUTE_PROMPT do not describe the verification as per-finding (standard and lite batch per lane)",
    wfHead !== "" && !/per-finding/i.test(wfHead), [wfHead === "" ? "comment block not found" : `says: ${around(wfHead, /per-finding/i)}`]);

  console.log(`${total} cases, ${red} red`);
  process.exit(red ? 1 : 0);
})().catch((e) => { console.log(`FAIL harness: ${e && e.stack || e}`); process.exit(2); });
