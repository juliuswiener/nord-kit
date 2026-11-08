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

  // ---- D0..D10: a verifier that returns null keeps the finding and marks it unverified, in all three workflows (ticket "ein-toter-verifizierer-hat-in-drei-workflows-drei-standardwerte") ----
  // The rule (decision 2026-11-08): a missing verdict is not a refutation. audit.workflow.js batch path already does it; `thorough`, diff-deep.md and lens-a11y.md do not.
  // dAudit: audit.workflow.js at tier `intensity` with one high finding "d1"; call number i to a verifier answers answers[i % answers.length] (null = a dead agent).
  async function dAudit(intensity, answers) {
    let n = 0;
    const agent = async (prompt, opts) => {
      if (opts.label === "vitals") return { archetype: "library", languages: [{ name: "JavaScript", loc: 1, pct: 100 }], loc: 1, demographics: { contributors_90d: 1 } };
      if (opts.label.startsWith("find:")) return { lane: "security", summary: "s", findings: [lane("d1")] };
      if (opts.label.startsWith("verify:")) return answers[n++ % answers.length];
      return {};
    };
    try {
      const { out } = await runScript(AUDIT, { path: "/no/such/repo", lanes: ["security"], verifyIntensity: intensity }, agent);
      const row = out.coverage.rows.find((r) => r.lane === "security");
      return { kept: out.findings.map((f) => f.id).join(), state: row.state, unverified: row.unverified.join(), headline: out.coverage.headline };
    } catch (e) { return { kept: "", state: `script threw ${e.message}`, unverified: "", headline: "" }; }
  }
  const dReal = { isReal: true, reasoning: "r" };
  const dFake = { isReal: false, reasoning: "r" };
  const dShow = (r) => `kept=[${r.kept}] security row: ${r.state}, unverified=[${r.unverified}]`;
  const d0 = await dAudit("standard", [null]);
  kase("D0", "control (Bau 3, batch path): a batch verifier that returns null keeps the finding, the security row stays covered and names it unverified",
    d0.kept === "d1" && d0.state === "covered" && d0.unverified === "d1" && /unverified/.test(d0.headline), [dShow(d0)]);

  const d1 = await dAudit("thorough", [null]);
  kase("D1", "audit.workflow.js thorough: three skeptics that return null keep the finding, the row stays covered and names it unverified (today a TypeError loses the whole lane)",
    d1.kept === "d1" && d1.state === "covered" && d1.unverified === "d1" && /unverified/.test(d1.headline), [`${dShow(d1)} ; headline: ${d1.headline}`]);

  const d2 = { "real,real,null": await dAudit("thorough", [dReal, dReal, null]), "null,null,real": await dAudit("thorough", [null, null, dReal]), "fake,null,null": await dAudit("thorough", [dFake, null, null]), "fake,fake,null": await dAudit("thorough", [dFake, dFake, null]) };
  kase("D2", "audit.workflow.js thorough: a null skeptic is a missing vote, not a refutation: only two refutations drop the finding",
    d2["real,real,null"].kept === "d1" && d2["null,null,real"].kept === "d1" && d2["fake,null,null"].kept === "d1" && d2["fake,fake,null"].kept === "",
    [`${Object.entries(d2).map(([k, r]) => `[${k}] ${dShow(r)}`).join(" | ")} ; want kept, kept, kept, dropped`]);

  const d3 = { "real,real,fake": await dAudit("thorough", [dReal, dReal, dFake]), "fake,fake,real": await dAudit("thorough", [dFake, dFake, dReal]), "fake,fake,fake": await dAudit("thorough", [dFake, dFake, dFake]), "real,real,real": await dAudit("thorough", [dReal, dReal, dReal]) };
  kase("D3", "control: audit.workflow.js thorough with all three verdicts in: the majority decides, and nothing is named unverified",
    d3["real,real,fake"].kept === "d1" && d3["fake,fake,real"].kept === "" && d3["fake,fake,fake"].kept === "" && d3["real,real,real"].kept === "d1" && Object.values(d3).every((r) => r.unverified === ""),
    [Object.entries(d3).map(([k, r]) => `[${k}] ${dShow(r)}`).join(" | ")]);

  // diff-deep.md and lens-a11y.md: one finding, the verifier answers `verdict`; the run is caught so a throw reads as a result
  async function dScript(src, label, finding, verdict) {
    const agent = async (prompt, opts) => (opts.label === label ? { findings: [finding] } : opts.label.startsWith("review:") ? { findings: [] } : opts.label.startsWith("verify:") ? verdict : {});
    try { const { out } = await runScript(src, { target: "x" }, agent); return { count: out.count, verdict: out.findings[0] ? out.findings[0].verdict : undefined, threw: null }; }
    catch (e) { return { count: -1, verdict: undefined, threw: e.message }; }
  }
  const dDiffF = { file: "a.js", line: 1, severity: "high", confidence: "high", title: "d-diff", detail: "d" };
  const dA11yF = { title: "d-a11y", detail: "d", where: "a.btn", severity: "high", confidence: "high" };
  const d4 = DIFF ? await dScript(DIFF, "review:correctness", dDiffF, null) : { count: -1, threw: "no script block" };
  kase("D4", "diff-deep.md: a verifier that returns null keeps the finding with verdict.reproduced 'unverified' and a reason that says there was no verdict",
    d4.count === 1 && !!d4.verdict && d4.verdict.reproduced === "unverified" && /no verdict/i.test(d4.verdict.reason || ""),
    [`count=${d4.count} (want 1); verdict=${JSON.stringify(d4.verdict)}${d4.threw ? `; script threw ${d4.threw}` : ""}`]);

  const d6 = A11Y ? await dScript(A11Y, "review:perceivable", dA11yF, null) : { count: -1, threw: "no script block" };
  kase("D6", "lens-a11y.md: a verifier that returns null keeps the finding with verdict.checked 'unverified' and a reason that says there was no verdict",
    d6.count === 1 && !!d6.verdict && d6.verdict.checked === "unverified" && /no verdict/i.test(d6.verdict.reason || ""),
    [`count=${d6.count} (want 1); verdict=${JSON.stringify(d6.verdict)}${d6.threw ? `; script threw ${d6.threw}` : ""}`]);

  const d5 = DIFF && A11Y ? [await dScript(DIFF, "review:correctness", dDiffF, { isReal: true, reason: "r", reproduced: "na" }), await dScript(DIFF, "review:correctness", dDiffF, { isReal: false, reason: "r", reproduced: "na" }),
    await dScript(A11Y, "review:perceivable", dA11yF, { isReal: true, reason: "r", checked: "na" }), await dScript(A11Y, "review:perceivable", dA11yF, { isReal: false, reason: "r", checked: "na" })] : [];
  kase("D5", "control: a verdict that arrives still decides in diff-deep.md and lens-a11y.md (isReal), and is not labelled unverified",
    d5.length === 4 && d5.map((r) => r.count).join() === "1,0,1,0" && d5[0].verdict.reproduced === "na" && d5[2].verdict.checked === "na",
    [d5.length ? `diff isReal true/false: ${d5[0].count}/${d5[1].count}, a11y: ${d5[2].count}/${d5[3].count} (want 1/0 and 1/0); labels kept: ${d5[0].verdict && d5[0].verdict.reproduced}, ${d5[2].verdict && d5[2].verdict.checked}` : "no script block"]);

  const diffAfter = flat(section(diffMd, "After the workflow returns", "```javascript"));
  kase("D7", "diff-deep.md prose: says how a finding without a verifier verdict is shown (kept, marked unverified)",
    diffAfter !== "" && /unverified/.test(diffAfter) && /no (verifier )?verdict/i.test(diffAfter), [diffAfter === "" ? "paragraph not found" : `after-the-workflow paragraph: ${diffAfter.slice(0, 220)}`]);

  const a11yMdD = read("skills/review/references/lens-a11y.md");
  const a11yConf = flat(section(a11yMdD, "## Confidence + provenance", "## Final output"));
  const a11yOut = flat(section(a11yMdD, "## Final output", "**Bürgernähe"));
  kase("D8", "lens-a11y.md prose: the confidence rule and the output template say how a finding with checked:'unverified' is shown",
    a11yConf.includes("unverified") && a11yOut.includes("unverified"), [`confidence section names unverified: ${a11yConf.includes("unverified")}; output template names it: ${a11yOut.includes("unverified")}`]);

  const rdLimit = flat(repoMd.split("\n").find((l) => /^- \*\*The coverage table/.test(l)) || "");
  kase("D9", "repo-deep.md limitations: the unverified rule is not tied to the batch verifier alone; thorough is named",
    rdLimit !== "" && /unverified/.test(rdLimit) && /thorough/i.test(rdLimit), [rdLimit === "" ? "bullet not found" : `says: ${around(rdLimit, /A finding the[^.]*\./)} ; thorough named: ${/thorough/i.test(rdLimit)}`]);

  // ---- N1..N9: a verdict counts only when isReal is a boolean; any other answer is no verdict: the finding stays, marked unverified, in all three workflows ----
  // (ticket "ein-verifizierer-urteil-ohne-isreal-verwirft-den-befund-in-diff-deep-und-a11y-still-der-batch-weg-behaelt-ihn"; the rule follows the decision of 2026-11-08)
  // An explicit refutation stays isReal === false. A verdict that carries its own evidence (diff-deep: reproCmd + confirmed/refuted; a11y: checked confirmed/refuted) is read as before (N5).
  const nBad = { "{}": {}, "{isReal:null}": { isReal: null }, "{isReal:'false'}": { isReal: "false" }, "{isReal:'yes'}": { isReal: "yes" }, "{reason:'x'}": { reason: "x" } };
  const nAudit = async (intensity, wrap) => { const r = {}; for (const [k, v] of Object.entries(nBad)) r[k] = await dAudit(intensity, [wrap({ ...v, reasoning: "r" })]); return r; };
  const nShow = (r) => Object.entries(r).map(([k, x]) => `${k}: ${dShow(x)}`).join(" | ");
  const n1 = await nAudit("thorough", (v) => v);
  const n1m = [await dAudit("thorough", [dFake, dFake, {}]), await dAudit("thorough", [dFake, {}, {}])];
  kase("N1", "audit.workflow.js thorough: skeptics whose isReal is no boolean cast no vote: the finding stays, the row names it unverified; two explicit refutations still drop it",
    Object.values(n1).every((x) => x.kept === "d1" && x.state === "covered" && x.unverified === "d1") && n1m[0].kept === "" && n1m[1].kept === "d1",
    [`${nShow(n1)} ; [false,false,{}] kept=[${n1m[0].kept}] (want none); [false,{},{}] kept=[${n1m[1].kept}] (want d1)`]);

  const n2 = await nAudit("standard", (v) => ({ verdicts: [{ findingId: "d1", ...v }] }));
  const n2c = await dAudit("standard", [{ verdicts: [{ findingId: "d1", isReal: false, reasoning: "r" }] }]);
  kase("N2", "audit.workflow.js batch: a batch entry whose isReal is no boolean is no verdict: the finding stays, the row names it unverified; isReal false still drops it",
    Object.values(n2).every((x) => x.kept === "d1" && x.state === "covered" && x.unverified === "d1") && n2c.kept === "",
    [`${nShow(n2)} ; isReal false: kept=[${n2c.kept}] (want none)`]);

  const nScript = async (src, label, finding) => { const r = {}; for (const [k, v] of Object.entries(nBad)) r[k] = await dScript(src, label, finding, v); return r; };
  const nShowS = (r, key) => Object.entries(r).map(([k, x]) => `${k}: count=${x.count} ${key}=${x.verdict && x.verdict[key]}${x.threw ? ` threw ${x.threw}` : ""}`).join(" | ");
  const n3 = DIFF ? await nScript(DIFF, "review:correctness", dDiffF) : {};
  kase("N3", "diff-deep.md: a verdict whose isReal is no boolean keeps the finding with verdict.reproduced 'unverified' and a reason that says there was no verdict",
    Object.keys(n3).length === 5 && Object.values(n3).every((x) => x.count === 1 && x.verdict && x.verdict.reproduced === "unverified" && /no verdict/i.test(x.verdict.reason || "")), [nShowS(n3, "reproduced") + " ; want count=1 and reproduced=unverified each"]);

  const n4 = A11Y ? await nScript(A11Y, "review:perceivable", dA11yF) : {};
  kase("N4", "lens-a11y.md: a verdict whose isReal is no boolean keeps the finding with verdict.checked 'unverified' and a reason that says there was no verdict",
    Object.keys(n4).length === 5 && Object.values(n4).every((x) => x.count === 1 && x.verdict && x.verdict.checked === "unverified" && /no verdict/i.test(x.verdict.reason || "")), [nShowS(n4, "checked") + " ; want count=1 and checked=unverified each"]);

  const n5 = DIFF && A11Y ? [
    await dScript(DIFF, "review:correctness", dDiffF, { reproduced: "confirmed", reproCmd: "node t.js" }), await dScript(DIFF, "review:correctness", dDiffF, { reproduced: "refuted", reproCmd: "node t.js" }),
    await dScript(A11Y, "review:perceivable", dA11yF, { checked: "confirmed" }), await dScript(A11Y, "review:perceivable", dA11yF, { checked: "refuted" })] : [];
  kase("N5", "control: a verdict without isReal that carries its own evidence is read as before: diff-deep reproCmd + confirmed keeps, + refuted drops; a11y checked confirmed keeps, refuted drops; the kept ones are not labelled unverified",
    n5.length === 4 && n5.map((r) => r.count).join() === "1,0,1,0" && n5[0].verdict.reproduced === "confirmed" && n5[2].verdict.checked === "confirmed",
    [n5.length ? `diff confirmed/refuted: ${n5[0].count}/${n5[1].count}, a11y confirmed/refuted: ${n5[2].count}/${n5[3].count} (want 1/0 and 1/0); labels: ${n5[0].verdict && n5[0].verdict.reproduced}, ${n5[2].verdict && n5[2].verdict.checked}` : "no script block"]);

  const nPhrase = /isReal[^.;)]*\b(neither true nor false|boolean)\b/i;
  const nDiffTxt = diffAfter;
  kase("N6", "diff-deep.md prose: says that a verdict whose isReal is no boolean counts as no verdict", nPhrase.test(nDiffTxt), [`after-the-workflow paragraph: ${nDiffTxt.slice(0, 260)}`]);
  kase("N7", "lens-a11y.md prose (confidence rule): says that a verdict whose isReal is no boolean counts as no verdict", nPhrase.test(a11yConf), [`confidence section around unverified: ${around(a11yConf, /unverified/)}`]);
  kase("N8", "repo-deep.md limitations (coverage table): the batch entry and the thorough skeptic with an isReal that is no boolean count as no verdict", nPhrase.test(rdLimit) && (rdLimit.match(new RegExp(nPhrase.source, "gi")) || []).length >= 2,
    [`bullet around unverified: ${around(rdLimit, /A finding the[^.]*\./)} ; isReal clauses: ${(rdLimit.match(new RegExp(nPhrase.source, "gi")) || []).length} (want 2)`]);

  // N9 (ticket "diff-deep-md-eine-reproduktionsmeldung-ohne-befehl-und-ohne-isreal-hat-keinen-pruefall"): the verifier reports a reproduction but names no command and gives no isReal.
  // A3 sends isReal with it, N3 sends no `reproduced` at all, N5 sends the command: none of them is this shape. Without the command the report is no evidence (A3), without isReal there is nothing to fall back to.
  // ponytail: diff-deep.md only. lens-a11y.md reads `checked` without a command; its confirmed and refuted are pinned in N5, `checked: 'na'` without isReal is not (own ticket).
  const n9 = DIFF ? { "{reproduced:'confirmed'}": await dScript(DIFF, "review:correctness", dDiffF, { reproduced: "confirmed" }), "{reproduced:'refuted'}": await dScript(DIFF, "review:correctness", dDiffF, { reproduced: "refuted" }),
    "{reproduced:'na'}": await dScript(DIFF, "review:correctness", dDiffF, { reproduced: "na" }) } : {};
  kase("N9", "diff-deep.md: a reproduction report (confirmed, refuted, na) with no reproCmd and no isReal is no verdict: the finding stays with verdict.reproduced 'unverified'",
    Object.keys(n9).length === 3 && Object.values(n9).every((x) => x.count === 1 && x.verdict && x.verdict.reproduced === "unverified"), [nShowS(n9, "reproduced") + " ; want count=1 and reproduced=unverified each"]);

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

  // ---- K1..K4: the verdict lens-a11y.md gives a finding that skipped the verifier (ticket "weitere-selbstflag-stellen-a11y-checked-confirmed-...", part 1) ----
  // Its schema calls checked:'confirmed' "re-ran the tool / inspected the actual DOM-or-tile", and the filter reads the value. K2..K4 hold the
  // report, the filter and the verifier's schema in place; K1 asks the synthetic verdict for a label that says what happened.
  // ponytail: kf() builds its own findings, because `plain` above spreads the verdict-less `base` of S1, not the a11y one (own ticket).
  const kf = (title, extra = {}) => ({ title, detail: "d", where: "a.btn", severity: "high", confidence: "high", ...extra });
  const kTool = { toolVerified: true, toolEvidence: TOOL_LINE };
  async function kRun(findings, verdict) {
    const seen = {};
    const agent = async (prompt, opts) => {
      if (opts.label === "review:perceivable") return { findings };
      if (opts.label.startsWith("review:")) return { findings: [] };
      if (opts.label.startsWith("verify:")) { seen.schema = opts.schema; return verdict; }
      return {};
    };
    const { out } = A11Y ? await runScript(A11Y, { target: "x" }, agent) : { out: { count: -1, findings: [] } };
    return { titles: out.findings.map((f) => f.title), out, seen };
  }
  const k1 = await kRun([kf("k-tool", kTool)], { isReal: false, reason: "r", checked: "na" });
  const k1v = (k1.out.findings[0] && k1.out.findings[0].verdict) || {};
  kase("K1", "lens-a11y.md: the verdict of a finding that skipped the verifier says 'tool-reported', not checked:'confirmed' (re-ran the tool / inspected the DOM)",
    k1.titles.join() === "k-tool" && k1v.checked === "tool-reported", [`kept: ${k1.titles.join() || "(nothing)"} ; verdict: ${JSON.stringify(k1v)} ; want checked "tool-reported"`]);

  const kSet = () => [kf("k-t1", kTool), kf("k-j1"), kf("k-t2", { ...kTool, severity: "low" })];
  const k2y = await kRun(kSet(), { isReal: true, reason: "r", checked: "na" });
  const k2n = await kRun(kSet(), { isReal: false, reason: "r", checked: "na" });
  kase("K2", "control: the a11y report does not depend on the label: tool-reported findings stay whatever the verifier says, the judged one follows isReal, order by severity",
    k2y.titles.join() === "k-t1,k-j1,k-t2" && k2n.titles.join() === "k-t1,k-t2", [`approving verifier: ${k2y.titles.join() || "(nothing)"} (want k-t1,k-j1,k-t2); refuting verifier: ${k2n.titles.join() || "(nothing)"} (want k-t1,k-t2)`]);

  const k3 = {};
  for (const [c, isReal] of [["confirmed", false], ["refuted", true], ["na", true], ["na", false]]) k3[`${c}/${isReal}`] = (await kRun([kf("k-j")], { isReal, reason: "r", checked: c })).titles.length;
  kase("K3", "control: the filter reads checked from the verifier: confirmed keeps, refuted drops, na follows isReal",
    k3["confirmed/false"] === 1 && k3["refuted/true"] === 0 && k3["na/true"] === 1 && k3["na/false"] === 0, [`kept (1) or dropped (0) by checked/isReal: ${JSON.stringify(k3)}; want confirmed/false 1, refuted/true 0, na/true 1, na/false 0`]);

  const k4 = await kRun([kf("k-j")], { isReal: true, reason: "r", checked: "na" });
  const k4enum = ((k4.seen.schema && k4.seen.schema.properties.checked.enum) || []).slice().sort().join();
  kase("K4", "control: the verifier is offered confirmed, refuted and na only ('tool-reported' is the workflow's own label, a verifier never picks it)",
    k4enum === "confirmed,na,refuted", [`verdict schema offers checked: ${k4enum || "(none)"}`]);

  // ---- Q0..Q4: cleanup/references/remove.md — what its "DETERMINISTIC gate" does, and what the text says (part 2) ----
  const REMOVE_MD = read("skills/cleanup/references/remove.md");
  const REMOVE = (/```javascript\n([\s\S]*?)\n```/.exec(REMOVE_MD) || [, ""])[1];
  async function qRun(verdict, detector = "dead-code") {
    const seen = {};
    const agent = async (prompt, opts) => {
      if (opts.label === `detect:${detector}`) return { candidates: [{ file: "a.js", lines: "1-3", what: "fn foo", why: "unused" }] };
      if (opts.label.startsWith("detect:")) return { candidates: [] };
      if (opts.label.startsWith("safe:")) { seen.prompt = prompt; seen.schema = opts.schema; return verdict; }
      return {};
    };
    const { out } = REMOVE ? await runScript(REMOVE, { target: "x" }, agent) : { out: { safeToRemove: -1 } };
    return { kept: out.safeToRemove, seen };
  }
  const qV = (extra) => ({ safeToRemove: true, reason: "r", refsFound: 0, refCmd: "grep -rn foo .", ...extra });
  const q = {
    "0 refs, no refCmd": (await qRun(qV({ refCmd: "" }))).kept, "0 refs, refCmd is no search": (await qRun(qV({ refCmd: "echo 0" }))).kept,
    "1 ref": (await qRun(qV({ refsFound: 1 }))).kept, "safe=false, 0 refs": (await qRun(qV({ safeToRemove: false }))).kept,
    "refsFound missing": (await qRun(qV({ refsFound: undefined }))).kept, "ai-slop, 2 refs": (await qRun(qV({ refsFound: 2 }), "ai-slop")).kept, "verifier null": (await qRun(null)).kept,
  };
  kase("Q0", "control (what the filter does): a candidate stays only with safeToRemove true AND refsFound exactly 0, for every detector; refCmd is never read; a null verifier drops it",
    q["0 refs, no refCmd"] === 1 && q["0 refs, refCmd is no search"] === 1 && Object.entries(q).filter(([k]) => !k.startsWith("0 refs")).every(([, n]) => n === 0), [`candidates kept: ${JSON.stringify(q)}`]);

  const qSeen = (await qRun(qV())).seen;
  const qPrompt = flat(qSeen.prompt || "");
  kase("Q1", "remove.md verifier prompt: not called a DETERMINISTIC gate / 'not a judgement call', and says the workflow does not rerun the search",
    qPrompt !== "" && !/deterministic|not a judgement call/i.test(qPrompt) && /does not rerun/i.test(qPrompt),
    [`prompt says: ${around(qPrompt, /deterministic[^.]*|not a judgement call/i)} ; "does not rerun" present: ${/does not rerun/i.test(qPrompt)}`]);

  const qRefs = flat((qSeen.schema && qSeen.schema.properties.refsFound.description) || "");
  kase("Q2", "remove.md schema: refsFound is not '0 required for symbol removals' (the script requires 0 for every candidate) and is a count the verifier reports",
    qRefs !== "" && !/symbol removals/i.test(qRefs) && /every candidate/i.test(qRefs) && /report/i.test(qRefs), [`refsFound says: ${qRefs || "(missing)"}`]);

  const qCmt = flat((/((?:^\/\/.*\n)+)const safe =/m.exec(REMOVE) || [, ""])[1]);
  kase("Q3", "remove.md comment above the filter: not 'deterministic gate ... regardless of the agent's own boolean', and says the script does not rerun refCmd",
    qCmt !== "" && !/deterministic|regardless of the agent/i.test(qCmt) && /does not rerun/i.test(qCmt), [qCmt === "" ? "comment above `const safe` not found" : `says: ${qCmt}`]);

  const qSec = flat(section(REMOVE_MD, "\n## Deterministic delete gate", "\n## Scoped File-List") || section(REMOVE_MD, "\n## Delete gate", "\n## Scoped File-List"));
  kase("Q4", "remove.md delete-gate section: the reference gate is not called deterministic / 'no LLM judge' / exit-code, and it says the workflow does not rerun refCmd",
    qSec !== "" && !/deterministic|no LLM judge|both exit-code|regardless of\s+the agent/i.test(qSec) && qSec.includes("does not rerun `refCmd`") && !/The gate is the exit code/.test(qSec),
    [qSec === "" ? "section not found" : `says: ${around(qSec, /deterministic[^.]*|no LLM judge|both exit-code|regardless of\s+the agent[^.]*/i)} ; "does not rerun \`refCmd\`": ${qSec.includes("does not rerun `refCmd`")}`]);

  // ---- Q5..Q9: a candidate the verifier gave no usable judgement for is not proposed for deletion, and the run names it (ticket "der-cleanup-filter-in-remove-md-verwirft-bei-fehlendem-urteil-still-und-traegt-einen-toten-zweig") ----
  // Deleting is the case where dropping is the safe direction (unlike review, where a missing verdict keeps the finding). The drop must not be silent: the result carries `noJudgement`.
  // q2Run: two dead-code candidates, a.js and b.js; a.js always gets a clean verdict; `answerB` is the verifier's answer for b.js (a function that throws = a dead agent); `candB` is the detector's candidate for b.js.
  async function q2Run(answerB, candB = { file: "b.js", lines: "4-6", what: "fn bar", why: "unused" }) {
    const agent = async (prompt, opts) => {
      if (opts.label === "detect:dead-code") return { candidates: [{ file: "a.js", lines: "1-3", what: "fn foo", why: "unused" }, candB] };
      if (opts.label.startsWith("detect:")) return { candidates: [] };
      if (opts.label === "safe:a.js") return qV();
      if (opts.label === "safe:b.js") return typeof answerB === "function" ? answerB() : answerB;
      return {};
    };
    if (!REMOVE) return { total: -1, kept: -1, plan: [], named: [] };
    const { out } = await runScript(REMOVE, { target: "x" }, agent);
    return { total: out.totalCandidates, kept: out.safeToRemove, plan: out.plan.map((c) => c.file), planEntries: out.plan, named: Array.isArray(out.noJudgement) ? out.noJudgement.map((c) => c.file) : null, entries: Array.isArray(out.noJudgement) ? out.noJudgement : null };
  }
  const q5 = {
    "verifier null": await q2Run(null), "verifier {}": await q2Run({}), "agent throws": await q2Run(() => { throw new Error("agent died"); }),
    "refsFound missing": await q2Run(qV({ refsFound: undefined })), "refsFound null": await q2Run(qV({ refsFound: null })), "refsFound '0'": await q2Run(qV({ refsFound: "0" })),
    "refsFound 0.5": await q2Run(qV({ refsFound: 0.5 })), "refsFound NaN": await q2Run(qV({ refsFound: NaN })),
    "safeToRemove missing": await q2Run(qV({ safeToRemove: undefined })), "safeToRemove 'true'": await q2Run(qV({ safeToRemove: "true" })),
  };
  const qShow = (o) => Object.entries(o).map(([k, r]) => `${k}: plan=[${r.plan}] noJudgement=${r.named === null ? "(missing)" : `[${r.named}]`}`).join(" | ");
  kase("Q5", "remove.md: a candidate whose verifier gave no usable judgement (null, {}, a dead agent, refsFound missing/null/'0'/0.5/NaN, safeToRemove missing or 'true') is not in the plan, and the result names it in noJudgement",
    Object.values(q5).every((r) => r.plan.join() === "a.js" && r.kept === 1 && r.total === 2 && r.named && r.named.join() === "b.js"),
    [`${qShow(q5)} ; want plan [a.js] and noJudgement [b.js] each`]);

  const q6 = {
    "safe=true, 0 refs": await q2Run(qV()), "safe=false, 0 refs": await q2Run(qV({ safeToRemove: false })),
    "safe=true, 1 ref": await q2Run(qV({ refsFound: 1 })), "safe=false, 3 refs": await q2Run(qV({ safeToRemove: false, refsFound: 3 })), "refsFound 0.0": await q2Run(qV({ refsFound: 0.0 })),
  };
  kase("Q6", "control: a judgement that arrived is not 'no judgement': a clean verdict (also refsFound 0.0) is in the plan, an explicit refusal or a reference count is out, and neither is named in noJudgement",
    q6["safe=true, 0 refs"].plan.join() === "a.js,b.js" && q6["refsFound 0.0"].plan.join() === "a.js,b.js"
      && ["safe=false, 0 refs", "safe=true, 1 ref", "safe=false, 3 refs"].every((k) => q6[k].plan.join() === "a.js" && (q6[k].named ?? []).length === 0)
      && (q6["safe=true, 0 refs"].named ?? []).length === 0,
    [qShow(q6)]);

  kase("Q7", "remove.md: the counts stay consistent when a candidate has no judgement: totalCandidates counts it, safeToRemove does not, noJudgement lists exactly that one",
    q5["verifier null"].total === 2 && q5["verifier null"].kept === 1 && !!q5["verifier null"].named && q5["verifier null"].named.length === 1,
    [`verifier null: total=${q5["verifier null"].total} safeToRemove=${q5["verifier null"].kept} noJudgement=${q5["verifier null"].named === null ? "(missing)" : `[${q5["verifier null"].named}]`}`]);

  const qLead = flat(section(REMOVE_MD, "This is REPORT-FIRST", "```javascript"));
  kase("Q8", "remove.md prose (REPORT-FIRST paragraph): says that a candidate without a usable judgement is not deleted and that the report names it (noJudgement)",
    qLead !== "" && qLead.includes("noJudgement") && /no usable judgement/i.test(qLead), [qLead === "" ? "paragraph not found" : `says: ${qLead.slice(0, 400)}`]);

  kase("Q9", "remove.md filter: no dead branch: the script does not test `refsFound == null` (a clause that `&& false` kept from ever being true)",
    REMOVE !== "" && !/refsFound\s*==\s*null/.test(REMOVE), [`script block has it: ${/refsFound\s*==\s*null/.test(REMOVE)}; line: ${(REMOVE.split("\n").find((l) => /refsFound\s*==\s*null/.test(l)) || "(none)").trim().slice(0, 160)}`]);

  // Q10 (Bau 11): Q5 reads the file of a noJudgement entry only. The report names the candidates, so the entry must also say where (lines), what, and which detector found it.
  // ponytail: four fields with fixed values. A verdict that carries its own file/what/lines/detector is pinned in Q11, a candidate that carries verdict-named keys or its own detector in Q12.
  const qEntry = (r) => (r.entries && r.entries.length === 1 ? r.entries[0] : null);
  kase("Q10", "remove.md: a noJudgement entry carries what the report needs to find the candidate again (file, lines, what, and the detector that found it), for every kind of missing judgement",
    Object.values(q5).every((r) => { const e = qEntry(r); return !!e && e.file === "b.js" && e.lines === "4-6" && e.what === "fn bar" && e.detector === "dead-code"; }),
    [`entries: ${Object.entries(q5).map(([k, r]) => `${k}: ${JSON.stringify(qEntry(r))}`).join(" | ")} ; want {"file":"b.js","lines":"4-6","what":"fn bar","detector":"dead-code"} each`]);

  // ---- Q11, Q12: a verifier's answer does not replace what the detector reported (ticket "remove-md-laesst-ein-urteil-mit-eigenen-feldern-den-kandidaten-ueberschreiben") ----
  // The candidate schema names file/lines/what/why (the script adds detector), the verdict schema safeToRemove/reason/refsFound/refCmd/references: the two share no key. Neither schema forbids more keys and the harness strips none,
  // so an answer can still send some. The plan is the list of what gets deleted: it names the candidate the verifier was asked about, never a file the verifier chose to send.
  // ponytail: Q11 and Q12 send the keys the two schemas name. The script lists the candidate's five keys by hand, so a key added to CAND_SCHEMA later stays overridable until it joins that list, and no case notices.
  // A key outside both schemas (say `severity`) is dropped where `cands` is built and reaches no entry (Q13). Upgrade path: read the key list from the schema the stub sees.
  const q11own = { file: "other.js", what: "fn other", lines: "9-9", detector: "ui-design", why: "other reason" }; // fields a verdict has no business sending
  const q11bad = { safeToRemove: "yes", reason: "r", refCmd: "x" }; // no usable judgement: refsFound is missing
  const q11cand = { file: "b.js", what: "fn bar", why: "unused" }; // b.js without `lines`, the one optional candidate key
  const q11 = {
    "clean verdict + own fields": await q2Run(qV(q11own)),
    "unusable verdict + own fields": await q2Run({ ...q11bad, ...q11own }),
    "clean verdict sends lines, candidate has none": await q2Run(qV({ lines: "9-9" }), q11cand),
    "unusable verdict sends lines, candidate has none": await q2Run({ ...q11bad, lines: "9-9" }, q11cand),
  };
  const q11at = (e, want) => !!e && Object.entries(want).every(([k, v]) => e[k] === v);
  const q11b = (r) => (r.planEntries || [])[1]; // a.js is the first plan entry, b.js the second
  const q11one = (r) => (r.entries && r.entries.length === 1 ? r.entries[0] : null);
  const q11c = q11["clean verdict + own fields"], q11n = q11["unusable verdict + own fields"];
  const q11cl = q11["clean verdict sends lines, candidate has none"], q11nl = q11["unusable verdict sends lines, candidate has none"];
  kase("Q11", "remove.md: a verdict that sends its own file/what/lines/detector/why does not replace the candidate: the plan entry and the noJudgement entry name what the detector reported, also for a candidate without `lines`",
    q11c.plan.join() === "a.js,b.js" && q11at(q11b(q11c), { file: "b.js", lines: "4-6", what: "fn bar", detector: "dead-code", why: "unused" })
      && q11n.plan.join() === "a.js" && q11at(q11one(q11n), { file: "b.js", lines: "4-6", what: "fn bar", detector: "dead-code" })
      && q11cl.plan.join() === "a.js,b.js" && q11at(q11b(q11cl), { file: "b.js", what: "fn bar", detector: "dead-code", lines: undefined })
      && q11at(q11one(q11nl), { file: "b.js", what: "fn bar", detector: "dead-code", lines: undefined }),
    [`clean verdict + own fields: plan entry ${JSON.stringify(q11b(q11c))} ; want {"file":"b.js","lines":"4-6","what":"fn bar","detector":"dead-code","why":"unused"}`,
      `unusable verdict + own fields: plan=[${q11n.plan}] noJudgement entry ${JSON.stringify(q11one(q11n))} ; want plan [a.js] and {"file":"b.js","lines":"4-6","what":"fn bar","detector":"dead-code"}`,
      `clean verdict sends lines, candidate has none: plan entry ${JSON.stringify(q11b(q11cl))} ; want b.js with no lines`,
      `unusable verdict sends lines, candidate has none: noJudgement entry ${JSON.stringify(q11one(q11nl))} ; want b.js with no lines`]);

  // Q12: the other direction. A candidate that carries keys of its own does not outvote the verifier or the workflow. A plain swap of the merge order ({ ...v, ...c }) fixes Q11 and breaks this.
  const q12cand = { file: "b.js", lines: "4-6", what: "fn bar", why: "unused" };
  const q12ref = await q2Run(qV({ safeToRemove: false, refsFound: 3 }), { ...q12cand, safeToRemove: true, refsFound: 0 }); // the candidate says safe with 0 refs, the verdict says no with 3 refs
  const q12det = await q2Run(qV(), { ...q12cand, detector: "claimed-by-detector" }); // the detector labels its own candidate; the label the workflow gives it is the one that counts
  const q12detn = await q2Run(q11bad, { ...q12cand, detector: "claimed-by-detector" });
  kase("Q12", "remove.md: a candidate that carries keys of its own does not outvote the verifier (safeToRemove true / refsFound 0 on the candidate, a refusal in the verdict) nor the workflow (its own detector label)",
    q12ref.plan.join() === "a.js" && (q12ref.named ?? []).length === 0
      && q11at(q11b(q12det), { file: "b.js", detector: "dead-code" }) && q11at(q11one(q12detn), { file: "b.js", detector: "dead-code" }),
    [`candidate says safe/0 refs, verdict says refused/3 refs: plan=[${q12ref.plan}] noJudgement=[${q12ref.named}] ; want plan [a.js] and noJudgement []`,
      `candidate labelled by the detector: plan entry ${JSON.stringify(q11b(q12det))} ; noJudgement entry ${JSON.stringify(q11one(q12detn))} ; want detector "dead-code" in both`]);

  // ---- Q13, Q14: a candidate is not its own verdict (ticket "remove-md-nimmt-einen-kandidaten-mit-urteilsschluesseln-vom-detektor-ohne-pruefung-in-den-plan") ----
  // The candidate schema names file/lines/what/why, but nothing stops a detector's answer from carrying the verdict's keys (the harness strips none; whether the real runtime does is not measured).
  // The filter reads safeToRemove and refsFound off the merged entry, so a detector's own true/0 would stand for a judgement nobody made when the verifier answers null, dies, or leaves one of the two keys out.
  // Only the verifier's answer is a judgement: the candidate is cut to its five keys where `cands` is built (not inside the detector's own `.then`: Q14), so a verdict key the detector sent reaches no entry.
  // ponytail: Q13 sends safeToRemove, refsFound, reason, refCmd and references from the detector. The five candidate keys are listed by hand where `cands` is built and again in the merge (Q11), and a key added to CAND_SCHEMA is dropped until it joins the first list. Upgrade path: read the key list from the schema the stub sees.
  const q13cand = { ...q12cand, safeToRemove: true, refsFound: 0 }; // the detector's own verdict: safe, 0 refs
  const q13 = {
    "verifier null": await q2Run(null, q13cand),
    "agent throws": await q2Run(() => { throw new Error("agent died"); }, q13cand),
    "answer without safeToRemove and refsFound": await q2Run({ reason: "r", refCmd: "x" }, q13cand),
    "answer without refsFound": await q2Run({ safeToRemove: true, reason: "r", refCmd: "x" }, q13cand),
    "answer without safeToRemove": await q2Run({ refsFound: 0, reason: "r", refCmd: "x" }, q13cand),
  };
  const q13yes = await q2Run({ safeToRemove: true, refsFound: 0 }, { ...q12cand, reason: "from the detector", refCmd: "from the detector", references: "from the detector" }); // a usable verdict that sends no reason, refCmd or references
  kase("Q13", "remove.md: a candidate that brings verdict keys from the detector is not its own verdict: if the verifier answers null, dies, or leaves safeToRemove or refsFound out, it is named in noJudgement and not in the plan; a plan entry holds no reason, refCmd or references the verifier did not send",
    Object.values(q13).every((r) => r.plan.join() === "a.js" && q11at(q11one(r), { file: "b.js", lines: "4-6", what: "fn bar", detector: "dead-code" }))
      && q13yes.plan.join() === "a.js,b.js" && q11at(q11b(q13yes), { file: "b.js", safeToRemove: true, refsFound: 0, reason: undefined, refCmd: undefined, references: undefined }),
    [`${Object.entries(q13).map(([k, r]) => `${k}: plan=[${r.plan}] noJudgement entry ${JSON.stringify(q11one(r))}`).join(" | ")} ; want plan [a.js] and {"file":"b.js","lines":"4-6","what":"fn bar","detector":"dead-code"} each`,
      `usable verdict without reason/refCmd/references, the detector sent its own: plan=[${q13yes.plan}] entry ${JSON.stringify(q11b(q13yes))} ; want b.js in the plan with safeToRemove true, refsFound 0 and none of the three`]);

  // Q14 (pin, green today): the cut sits where `cands` is built, not inside the detector's own `.then`, where a null element would throw and drop that detector's whole list.
  const q14 = await q2Run(qV(), null); // the detector's list is [a.js, null]
  kase("Q14", "remove.md: a null element in a detector's candidate list does not take the detector's other candidates with it (a.js still reaches its verifier and the plan)",
    q14.plan.join() === "a.js", [`list [a.js, null]: plan=[${q14.plan}] total=${q14.total} ; want plan [a.js]`]);

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

  // ---- O0..O4: args.toolFindings of the a11y lane — a text stays as it is, an object goes in as JSON (ticket T2) ----
  // tfRun runs the REAL lens-a11y.md script with `tf` as args.toolFindings (undefined = not set) and returns the tool line the "perceivable"
  // lane is told, or the error the script threw, and how many agents had run by then.
  async function tfRun(tf) {
    let prompt = null;
    let calls = 0;
    const agent = async (p, opts) => { calls++; if (opts.label === "review:perceivable") prompt = p; return { findings: [] }; };
    const args = tf === undefined ? { target: "x" } : { target: "x", toolFindings: tf };
    try {
      await runScript(A11Y, args, agent);
    } catch (e) {
      return { threw: String((e && e.message) || e), line: null, calls };
    }
    const m = /do not re-argue it\): ([\s\S]*?)\nFor a finding that restates/.exec(prompt || "");
    return { threw: null, line: m ? m[1] : null, calls };
  }
  const NONE = "none supplied";
  const oText = "axe color-contrast: a.btn 4.54:1\naxe image-alt: img.hero has no alt";
  const oJsonText = '{"violations":[{"id":"color-contrast"}]}'; // a text that only looks like JSON must not be quoted again
  const o0 = A11Y ? { text: await tfRun(oText), json: await tfRun(oJsonText), unset: await tfRun(undefined), nul: await tfRun(null), empty: await tfRun(""), zero: await tfRun(0), five: await tfRun(5) } : null;
  kase("O0", "control: a text in args.toolFindings reaches the lane unchanged (also one that looks like JSON); unset, null, '' and 0 give 'none supplied'; 5 stays '5'",
    !!o0 && o0.text.line === oText && o0.json.line === oJsonText && [o0.unset, o0.nul, o0.empty, o0.zero].every((r) => r.line && r.line.startsWith(NONE)) && o0.five.line === "5",
    [o0 ? `text: ${JSON.stringify(o0.text.line)}; json-looking text: ${JSON.stringify(o0.json.line)}; unset/null/''/0: ${[o0.unset, o0.nul, o0.empty, o0.zero].map((r) => (r.line || "").slice(0, 13)).join(" | ")}; 5: ${JSON.stringify(o0.five.line)}` : "no script block found"]);

  const oObj = { violations: [{ id: "color-contrast", nodes: 3 }], url: "https://example.org/" };
  const o1 = A11Y ? await tfRun(oObj) : { line: null };
  kase("O1", "lens-a11y.md: an object in args.toolFindings reaches the lane as its JSON text, not as '[object Object]'",
    o1.line === JSON.stringify(oObj), [`lane prompt carries: ${JSON.stringify(o1.line)} ; want: ${JSON.stringify(oObj)}`]);

  const oArr = [{ id: "a" }, { id: "b" }];
  const o2 = A11Y ? await tfRun(oArr) : { line: null };
  kase("O2", "lens-a11y.md: an array of objects in args.toolFindings reaches the lane as its JSON text",
    o2.line === JSON.stringify(oArr), [`lane prompt carries: ${JSON.stringify(o2.line)} ; want: ${JSON.stringify(oArr)}`]);

  const o3a = A11Y ? await tfRun({}) : { line: null };
  const o3b = A11Y ? await tfRun({ secret: 1, toJSON() { return { shown: 2 }; } }) : { line: null };
  kase("O3", "lens-a11y.md: an empty object gives '{}' and an object with toJSON gives what its toJSON returns (the lane gets JSON.stringify's text, not a hand-made one)",
    o3a.line === "{}" && o3b.line === '{"shown":2}', [`{} -> ${JSON.stringify(o3a.line)} (want "{}"); toJSON -> ${JSON.stringify(o3b.line)} (want {"shown":2})`]);

  const oCyc = { tool: "axe" }; oCyc.self = oCyc;
  const o4a = A11Y ? await tfRun(oCyc) : { threw: null, calls: -1 };
  const o4b = A11Y ? await tfRun({ n: 1n }) : { threw: null, calls: -1 }; // JSON.stringify throws on a BigInt too
  const refused = (r) => r.threw !== null && r.threw.includes("args.toolFindings") && r.calls === 0;
  kase("O4", "lens-a11y.md: an object JSON.stringify cannot serialise (a cycle, a BigInt) stops the run before any agent runs, with an error that names args.toolFindings",
    refused(o4a) && refused(o4b), [`cycle: threw ${JSON.stringify(o4a.threw)} after ${o4a.calls} agent call(s); BigInt: threw ${JSON.stringify(o4b.threw)} after ${o4b.calls} agent call(s)`]);

  // ---- U1..U12: the rule "no verdict keeps the finding" at its edges, and the claims that stood without a case or without a source (Bau 11) ----
  // Tickets: die-regel-toter-verifizierer-behaelt-den-befund-hat-fuenf-grenzen-ohne-testfall (U1, U3, U4, U5), die-zwei-von-drei-regel-von-thorough-... (U2),
  // repo-deep-md-nennt-high-fuer-die-skeptiker-mehrheit-... (U6, U7), repo-deep-md-nennt-45-prozent-kosten-... (U8, U9, U10); findings 5 and T-1 of nord-qual-folge (U12, U11).
  // U1, U7 (second half) and U12 run the real script; the others read a phrase of the text (as D7..D9 and N6..N8 do).
  // A figure or a superlative without a source in the tree falls; no measurement replaces it (decision review-deep-sagt-im-text-nur-was-der-workflow-tut).
  // ponytail: the text cases match phrases. A rewording that keeps the phrase and turns the sense passes; a faithful synonym turns the case red and the case is updated.
  // Upgrade path: a person reads the places (as for D7..D9), or a case that checks the sentence against the script's result.
  const u1 = { "real,real,null": await dAudit("thorough", [dReal, dReal, null]), "fake,null,null": await dAudit("thorough", [dFake, null, null]), "null,null,real": await dAudit("thorough", [null, null, dReal]), "{},null,real": await dAudit("thorough", [{}, null, dReal]) };
  kase("U1", "audit.workflow.js thorough: a finding that at least one skeptic answered is checked, not unverified: the row names only a finding that no skeptic answered (D1)",
    Object.values(u1).every((x) => x.kept === "d1" && x.state === "covered" && x.unverified === "" && !/unverified/.test(x.headline)),
    [`${Object.entries(u1).map(([k, r]) => `[${k}] ${dShow(r)} ; headline: ${r.headline}`).join(" | ")} ; want kept=[d1] and unverified=[] each`]);

  const uP3 = flat(p3Lines.find((l) => /standard\/lite/.test(l)) || "");
  kase("U2", "repo-deep.md Phase 3: the verdict line says one explicit isReal=false drops the finding under standard/lite, a missing verdict keeps it, and thorough drops at two of three refutations",
    uP3.includes("one explicit isReal=false drops the finding") && uP3.includes("a missing verdict keeps it") && uP3.includes("`thorough`: ≥2/3 refute"),
    [uP3 === "" ? "standard/lite line of Phase 3 not found" : `says: ${uP3}`]);

  kase("U3", "repo-deep.md limitations (coverage table): with thorough, only two explicit refutations drop the finding",
    rdLimit.includes("only two explicit refutations drop the finding"), [rdLimit === "" ? "bullet not found" : `says: ${around(rdLimit, /With `thorough`[^.]*/)}`]);

  kase("U4", "diff-deep.md prose: an unverified finding is marked `(unverified: no verifier verdict)`, and --fix applies the confirmed findings and leaves the unverified ones",
    diffAfter.includes("(unverified: no verifier verdict)") && /--fix[^.]*\bleave the unverified ones/.test(diffAfter),
    [`marker present: ${diffAfter.includes("(unverified: no verifier verdict)")} ; --fix says: ${around(diffAfter, /if `--fix`[^.]*/)}`]);

  kase("U5", "lens-a11y.md prose: an unverified finding shows `unverified` in place of a confidence, in the confidence rule and in the output template",
    a11yConf.includes("`unverified` in place of a confidence") && a11yOut.includes("`unverified` in place of `conf`"),
    [`confidence rule: ${around(a11yConf, /unverified[^.]*/)} ; output template: ${around(a11yOut, /A finding whose verdict[^.]*/)}`]);

  kase("U6", "repo-deep.md confidence rule: a finding none of its three skeptics answered is not counted as having survived the refute, its lane row names it, and it is not `high` on that ground",
    provMd.includes("none of its three skeptics answered") && provMd.includes("coverage.rows[].unverified") && provMd.includes("not `high`"),
    [provMd === "" ? "section not found" : `names the unanswered finding: ${provMd.includes("none of its three skeptics answered")} ; lane row named: ${provMd.includes("coverage.rows[].unverified")} ; says not high: ${provMd.includes("not `high`")} ; high rule: ${around(provMd, /\*\*high\*\*[^;]*;/)}`]);

  // uFinding: the finding that leaves audit.workflow.js (one high finding "d1") at tier `tier`; call number i to a verifier answers answers[i % answers.length]
  async function uFinding(tier, answers) {
    let n = 0;
    const agent = async (prompt, opts) => {
      if (opts.label === "vitals") return { archetype: "library", languages: [{ name: "JavaScript", loc: 1, pct: 100 }], loc: 1, demographics: { contributors_90d: 1 } };
      if (opts.label.startsWith("find:")) return { lane: "security", summary: "s", findings: [lane("d1")] };
      if (opts.label.startsWith("verify:")) return answers[n++ % answers.length];
      return {};
    };
    return (await runScript(AUDIT, { path: "/no/such/repo", lanes: ["security"], verifyIntensity: tier }, agent)).out.findings[0];
  }
  const uApprove = { isReal: true, confidence: "high", reasoning: "r" }; // the verifier's own confidence: the script must not hand it on to the finding
  const u7 = { "thorough, no answer": await uFinding("thorough", [null]), "thorough, approved": await uFinding("thorough", [uApprove]), "standard, no answer": await uFinding("standard", [null]), "standard, approved": await uFinding("standard", [{ verdicts: [{ findingId: "d1", ...uApprove }] }]) };
  kase("U7", "repo-deep.md confidence rule: the lead-in says the script sets no confidence on a finding (not 'the semantics it already wires'), and the script sets none, at either tier: no confidence field on a finding no verifier answered, nor on one a verifier approved with its own confidence",
    /sets no confidence on a finding/.test(provMd) && !/already wires/.test(provMd) && Object.values(u7).every((f) => !!f && !("confidence" in f)),
    [`lead-in: ${around(provMd, /The finding\/verdict schema[^:]*:/)} ; finding keys: ${Object.entries(u7).map(([k, f]) => `${k}: ${f ? Object.keys(f).join(",") : "(no finding)"}`).join(" | ")}`]);

  kase("U8", "repo-deep.md verifyIntensity: no percent figure (the '~45% of total spend' and '~80% fewer verification agents' had no run, no measurement and no note in the tree)",
    tiers !== "" && !/\d\s*%/.test(tiers), [tiers === "" ? "tier block not found" : `says: ${around(tiers, /\d\s*%[^.]*/)}`]);

  const uHead = flat(section(AUDIT, "// Verification intensity", "const verifyIntensity").replace(/^\/\/ ?/gm, ""));
  kase("U9", "audit.workflow.js comment above verifyIntensity: no percent figure and no 'same false-positive protection' (repo-deep.md dropped that claim, V4)",
    uHead !== "" && !/\d\s*%/.test(uHead) && !/same false-positive protection/i.test(uHead),
    [uHead === "" ? "comment block not found" : `says: ${around(uHead, /\d\s*%[^.]*|same false-positive protection/i)}`]);

  kase("U10", "the superlative 'the single biggest cost lever' is gone from the repo-deep.md tier block and from the script comment (its only support was the ~45% figure)",
    tiers !== "" && uHead !== "" && !/single biggest cost lever/i.test(tiers) && !/single biggest cost lever/i.test(uHead),
    [`tier block: ${around(tiers, /single biggest cost lever/i)} ; script comment: ${around(uHead, /single biggest cost lever/i)}`]);

  const uOut = flat(repoMd.split("\n").find((l) => /findings\.json/.test(l) && /coverage/.test(l)) || "");
  kase("U11", "repo-deep.md findings.json step: coverage.rows[].unverified is not tied to the batch verifier alone; thorough is named",
    uOut !== "" && /unverified/.test(uOut) && /thorough/i.test(uOut), [uOut === "" ? "findings.json step not found" : `says: ${around(uOut, /coverage\.rows\[\]\.unverified[^;]*/)} ; thorough named: ${/thorough/i.test(uOut)}`]);

  const u12a = await dAudit("standard", [{ verdicts: [null] }]);
  const u12b = await dAudit("standard", [{ verdicts: [null, { findingId: "d1", isReal: false, reasoning: "r" }] }]);
  kase("U12", "audit.workflow.js batch: a null inside verdicts is no verdict, not a crash: the finding stays and the row names it; a refutation next to it still drops the finding",
    u12a.kept === "d1" && u12a.state === "covered" && u12a.unverified === "d1" && u12b.kept === "" && u12b.unverified === "",
    [`[null]: ${dShow(u12a)} (want kept=[d1], covered, unverified=[d1]) | [null, refutation]: ${dShow(u12b)} (want kept=[], unverified=[])`]);

  console.log(`${total} cases, ${red} red`);
  process.exit(red ? 1 : 0);
})().catch((e) => { console.log(`FAIL harness: ${e && e.stack || e}`); process.exit(2); });
