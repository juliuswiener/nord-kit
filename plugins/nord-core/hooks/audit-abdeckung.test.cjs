#!/usr/bin/env node
// audit-abdeckung.test.cjs — does `review --scope repo --deep` say which lane ended in which state?
// Run: node audit-abdeckung.test.cjs   (from plugins/nord-core, or by path)
//
// Ticket "review-deep-fuehrt-keine-abdeckungstabelle-und-eine-ausgelassene-einheit-verschwindet-still".
// A Workflow script has no filesystem and no shell (Workflow tool: "No filesystem or Node.js API access"), so the
// check is a pure function INSIDE audit.workflow.js and this test reaches it two ways:
//   H* run the REAL script text with the Workflow tool's globals stubbed (AsyncFunction, as commit 2759550 did by hand):
//      this is the call site — what the pipeline does with a lane that returned null, threw, or reported `skipped`.
//   U* cut the block between the two `ledger:` markers out of the text and evaluate it alone: the state table itself.
//
// ponytail: the stub of pipeline()/parallel() is our reading of the Workflow reference ("a stage that throws drops that
// item to null"), not the runtime. Only a live Workflow run proves it. Upgrade path: one recorded live run as a fixture.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "skills/review/references/repo-deep/audit.workflow.js");
const SRC = fs.readFileSync(SCRIPT, "utf8");

// ---- the harness: the Workflow tool's globals, as plain JS (shared with anker-abgleich.test.cjs) ----
const { runScript } = require("./workflow-harness.cjs");

const VITALS = { archetype: "service", languages: [{ name: "JavaScript", loc: 1, pct: 100 }], loc: 1, demographics: { contributors_90d: 1 } };
const CORE = ["architecture", "code-quality", "tests", "deps", "security", "perf", "obs", "cicd", "api", "data", "docs", "config", "drift"];
const COND = ["a11y", "bundle", "i18n", "compliance", "ml", "embedded"];
const okLane = (k) => ({ lane: k, summary: `${k} checked`, findings: [], skipped: [] });
// `lanes[k]`: a value the lane agent returns, or a function that may throw. Everything else is a clean lane.
function scenario(lanes = {}, synthesis = { summary_markdown: "# Audit Summary" }, vitals = VITALS) {
  const seen = { prompts: {} };
  const agent = async (prompt, opts) => {
    seen.prompts[opts.label] = prompt;
    if (opts.label === "vitals") return vitals;
    if (opts.label.startsWith("find:")) {
      const k = opts.label.slice(5);
      const v = k in lanes ? lanes[k] : okLane(k);
      return typeof v === "function" ? v() : v;
    }
    if (opts.label.startsWith("verify:")) return { verdicts: [] };
    if (opts.label === "blast-radius") return { hotspots: [] };
    if (opts.label === "synthesis") return synthesis;
    throw new Error(`unexpected agent label ${opts.label}`);
  };
  return { agent, seen };
}
async function go(args, lanes, synthesis, vitals) {
  const s = scenario(lanes, synthesis, vitals);
  const r = await runScript(SRC, { path: "/no/such/repo", ...args }, s.agent);
  return { ...r, seen: s.seen, row: (k) => (r.out.coverage?.rows || []).find((x) => x.lane === k) };
}

let red = 0;
let total = 0;
function kase(id, name, ok, detail = []) {
  total++;
  console.log(`${ok ? "ok  " : "FAIL"} ${id} ${name}`);
  if (!ok) { red++; for (const d of detail) console.log(`       ${d}`); }
}
const brief = (r) => (r ? `${r.state}${r.reason ? ` (${r.reason})` : ""}` : "(no row)");

(async () => {
  // ---- S1: the harness reaches the real pipeline (a parser that finds nothing makes every case pass for the wrong reason) ----
  const base = await go({}, {});
  kase("S1", "the script runs under the harness: 13 core lanes reach the synthesis, which returns a report",
    base.out.laneSummaries.length === 13 && base.out.report && base.out.report.summary_markdown.includes("Audit Summary"),
    [`laneSummaries=${base.out.laneSummaries.length} report=${JSON.stringify(base.out.report)}`]);

  // ---- H*: the call site ----
  const cov = base.out.coverage;
  kase("H1", "every lane of the registry (13 core + 6 conditional) has exactly one row in a known state",
    Boolean(cov) && [...CORE, ...COND].join() === (cov.rows || []).map((r) => r.lane).join() &&
    cov.rows.every((r) => ["covered", "partial", "not_run", "no_result"].includes(r.state)),
    [`coverage=${cov ? JSON.stringify((cov.rows || []).map((r) => `${r.lane}:${r.state}`)) : "(the return value has no `coverage`)"}`]);
  kase("H1b", "a clean run: 13 core lanes covered, 6 conditional lanes not_run with a reason, complete=true, no errors",
    Boolean(cov) && CORE.every((k) => base.row(k)?.state === "covered") &&
    COND.every((k) => base.row(k)?.state === "not_run" && base.row(k).reason) && cov.complete === true && cov.errors.length === 0,
    [`coverage=${cov ? JSON.stringify(cov.counts) : "(none)"}`]);

  const others = (r, k) => CORE.filter((x) => x !== k).every((x) => r.row(x)?.state === "covered"); // the rest stays untouched
  const nul = await go({}, { security: null });
  kase("H2", "a lane whose agent returned null is no_result with a reason, the other 12 stay covered, and the run is not complete",
    nul.row("security")?.state === "no_result" && Boolean(nul.row("security").reason) && others(nul, "security") && nul.out.coverage.complete === false,
    [`today laneSummaries says: ${JSON.stringify(nul.out.laneSummaries.find((l) => l.lane === "security"))}`, `security=${brief(nul.row("security"))}`]);

  const thr = await go({}, { perf: () => { throw new Error("boom"); } });
  kase("H3", "a lane whose stage threw (the pipeline drops it to null) is still a row, state no_result, the other 12 stay covered",
    thr.row("perf")?.state === "no_result" && Boolean(thr.row("perf").reason) && others(thr, "perf"),
    [`today laneSummaries has ${thr.out.laneSummaries.length} lanes, perf among them: ${thr.out.laneSummaries.some((l) => l.lane === "perf")}`, `perf=${brief(thr.row("perf"))}`]);

  const skp = await go({}, { tests: { lane: "tests", summary: "s", findings: [], skipped: ["coverage tool absent: unverified"] } });
  kase("H4", "a lane that reports `skipped` is partial and the row carries the text",
    skp.row("tests")?.state === "partial" && skp.row("tests").skipped.join() === "coverage tool absent: unverified" && skp.out.coverage.complete === true,
    [`tests=${brief(skp.row("tests"))}`]);

  const blank = await go({}, { tests: { lane: "tests", summary: "s", findings: [], skipped: ["  "] } });
  kase("H5", "a blank `skipped` entry is a form error, not a reason: errors names the lane, the run is not complete",
    blank.out.coverage?.errors.some((e) => e.startsWith("tests:")) && blank.out.coverage.complete === false,
    [`errors=${JSON.stringify(blank.out.coverage?.errors)}`]);

  const sub = await go({ lanes: ["security"] }, {});
  kase("H6", "args.lanes: the 12 core lanes left out are not_run with the reason, and the run is not complete",
    CORE.filter((k) => k !== "security").every((k) => sub.row(k)?.state === "not_run" && /args\.lanes/.test(sub.row(k).reason)) &&
    sub.row("security")?.state === "covered" && sub.out.coverage.complete === false,
    [`architecture=${brief(sub.row("architecture"))} security=${brief(sub.row("security"))}`]);

  const fe = await go({}, {}, undefined, { ...VITALS, archetype: "frontend" });
  kase("H7", "a frontend archetype starts the a11y and bundle lanes: they are covered, i18n stays not_run",
    fe.row("a11y")?.state === "covered" && fe.row("bundle")?.state === "covered" && fe.row("i18n")?.state === "not_run",
    [`a11y=${brief(fe.row("a11y"))} bundle=${brief(fe.row("bundle"))}`]);

  const head = nul.out.report?.summary_markdown || "";
  kase("H8", "the report head carries the table without the synthesis model: it names security, and the model's text follows",
    /^## Coverage/.test(head) && /security/.test(head.split("\n").slice(0, 12).join("\n")) && head.includes("# Audit Summary"),
    [`summary_markdown starts: ${JSON.stringify(head.slice(0, 120))}`]);
  const dead = await go({}, { security: null }, null);
  kase("H9", "a dead synthesis agent (null) does not make the run throw: report stays null, the table is still returned",
    dead.out.report === null && dead.out.coverage?.rows.length === 19 && dead.out.coverage.complete === false,
    [`report=${JSON.stringify(dead.out.report)} coverage=${dead.out.coverage ? "present" : "(none)"}`]);
  kase("H10", "the run logs one coverage line, so the gap shows before the report is read",
    nul.logs.some((l) => /coverage/i.test(l) && /no_result/.test(l)), [`logs=${JSON.stringify(nul.logs.slice(-3))}`]);

  // ---- N*: a lane key that names no lane is refused BEFORE the first agent() call ----
  // Ticket "review-deep-nimmt-einen-falschen-bahnnamen-in-lanes-oder-extralanes-still-hin". "Show, don't throw" is about a gap found AFTER
  // agents ran (a throw would waste 30+ runs). A wrong key is known before the first agent() call, so refusing it costs nothing.
  // `refuse` keeps the throw for the assertion (go() would crash the whole run) and notes which agents had been called by then.
  const refuse = async (args) => {
    const s = scenario();
    let err = null;
    try { await runScript(SRC, { path: "/no/such/repo", ...args }, s.agent); } catch (e) { err = e; }
    return { err, msg: err ? String(err.message) : "", agents: Object.keys(s.seen.prompts) };
  };
  const said = (args, r) => `${JSON.stringify(args)} -> ${r.err ? `threw ${JSON.stringify(r.msg.slice(0, 60))}` : "no error"}, ${r.agents.length} agent call(s)`;
  const wrong = {
    lanes: [{ lanes: ["sec"] }, { lanes: ["security", "sec"] }, { lanes: ["Security"] }, { lanes: ["a11y"] }],
    extra: [{ extraLanes: ["zzz"] }, { extraLanes: ["security"] }, { extraLanes: ["constructor"] }],
    shape: [{ lanes: "security" }, { extraLanes: "a11y" }, { extraLanes: 5 }, { lanes: { security: true } }],
  };
  const got = {};
  for (const [g, list] of Object.entries(wrong)) got[g] = await Promise.all(list.map(refuse));
  const lines = (g) => got[g].map((r, i) => said(wrong[g][i], r));
  const nameLanes = await refuse({ lanes: ["architecture", "sekurity"] }); // "sekurity" is no substring of a valid key, so naming it is checkable
  const nameExtra = await refuse({ extraLanes: ["a11y", "zzz"] });
  kase("N1", "args.lanes with a key that is no core lane (typo, other case, a conditional key) is refused whole; the error names the key and lists the core keys",
    got.lanes.every((r) => r.err) && nameLanes.msg.includes("sekurity") && CORE.every((k) => nameLanes.msg.includes(k)),
    [...lines("lanes"), `error for ["architecture","sekurity"]: ${JSON.stringify(nameLanes.msg.slice(0, 100))}`]);
  kase("N2", "args.extraLanes with a key that is no conditional lane (typo, a core key, an Object.prototype name) is refused; the error names the key and lists the conditional keys",
    got.extra.every((r) => r.err) && nameExtra.msg.includes("zzz") && COND.every((k) => nameExtra.msg.includes(k)),
    [...lines("extra"), `error for ["a11y","zzz"]: ${JSON.stringify(nameExtra.msg.slice(0, 100))}`]);
  kase("N3", "a value that is not an array (string, number, object) in args.lanes or args.extraLanes is refused, and the error says array",
    got.shape.every((r) => r.err && /array/i.test(r.msg)), lines("shape"));
  const refusals = Object.values(got).flat();
  kase("N4", "every refusal comes before the first agent() call: nothing is spent on a run that cannot be the one asked for",
    refusals.every((r) => r.err && r.agents.length === 0),
    Object.keys(got).flatMap((g) => lines(g).filter((l) => !/threw .*, 0 agent call/.test(l))));
  const finds = (r) => r.agents.filter((l) => l.startsWith("find:")).map((l) => l.slice(5)).sort().join();
  const ctl = { two: await refuse({ lanes: ["security", "deps"] }), dup: await refuse({ lanes: ["security", "security"] }),
    all: await Promise.all([{}, { lanes: [] }, { lanes: null }, { extraLanes: [] }, { extraLanes: null }].map(refuse)),
    extra: await refuse({ extraLanes: ["a11y", "i18n", "a11y"] }) };
  kase("N5", "control: valid lane args are not refused. lanes starts exactly its core lanes (duplicates too); absent, [] or null starts all 13; extraLanes adds exactly its lanes",
    !ctl.two.err && finds(ctl.two) === "deps,security" && !ctl.dup.err && finds(ctl.dup) === "security" &&
    ctl.all.every((r) => !r.err && finds(r) === [...CORE].sort().join()) && !ctl.extra.err && finds(ctl.extra) === [...CORE, "a11y", "i18n"].sort().join(),
    [`two=${ctl.two.err ? ctl.two.msg.slice(0, 60) : finds(ctl.two)} dup=${ctl.dup.err ? ctl.dup.msg.slice(0, 60) : finds(ctl.dup)}`,
      `13-lane runs=${ctl.all.filter((r) => !r.err && finds(r) === [...CORE].sort().join()).length}/5 extra=${ctl.extra.err ? ctl.extra.msg.slice(0, 60) : finds(ctl.extra)}`]);

  // ---- U*: the state table, cut out of the text by its markers and evaluated alone ----
  const BEGIN = /^\/\/ ─+ ledger:begin\b.*$/m;
  const END = /^\/\/ ─+ ledger:end\b.*$/m;
  const a = BEGIN.exec(SRC);
  const b = END.exec(SRC);
  kase("U0", "the script holds exactly one ledger:begin and one ledger:end marker, in that order",
    Boolean(a) && Boolean(b) && a.index < b.index && SRC.split(/ledger:begin/).length === 2 && SRC.split(/ledger:end/).length === 2,
    ["add the two marker lines around the pure block in audit.workflow.js"]);
  let L = null;
  if (a && b && a.index < b.index) {
    L = new Function(`${SRC.slice(a.index, b.index)}\nreturn { LEDGER_STATES, buildCoverage, checkCoverage, coverageOf, coverageMarkdown };`)();
  }
  const reg = [{ key: "a", kind: "core" }, { key: "b", kind: "core" }, { key: "c", kind: "conditional" }];
  const keys = reg.map((r) => r.key);
  const res = (extra = {}, key = "a") => ({ lane: { key }, result: { lane: key, summary: "s", findings: [], skipped: [], ...extra }, verified: [] });
  const row = (o = {}) => ({ lane: "a", kind: "core", state: "covered", reason: "", summary: "s", skipped: [], ...o });
  const errs = (rows) => (L ? L.checkCoverage(rows, keys) : ["(no ledger block)"]);
  const clean = [row(), row({ lane: "b" }), row({ lane: "c", kind: "conditional", state: "not_run", reason: "no trigger", summary: "" })];
  kase("U1", "a consistent table has no errors", L !== null && errs(clean).length === 0, [`errors=${JSON.stringify(errs(clean))}`]);
  kase("U2", "a missing row is an error naming the lane", L !== null && errs(clean.slice(0, 2)).some((e) => e.startsWith("c:")), [`errors=${JSON.stringify(errs(clean.slice(0, 2)))}`]);
  kase("U3", "a duplicate row is an error", L !== null && errs([...clean, row()]).some((e) => /duplicate/.test(e)), [`errors=${JSON.stringify(errs([...clean, row()]))}`]);
  kase("U4", "an unknown lane and an unknown state are errors", L !== null &&
    errs([...clean, row({ lane: "zzz" })]).some((e) => e.startsWith("zzz:")) &&
    errs([row({ state: "done" }), clean[1], clean[2]]).some((e) => /unknown state/.test(e)),
    [`errors=${JSON.stringify(errs([row({ state: "done" }), clean[1], clean[2]]))}`]);
  kase("U5", "covered needs a summary and an empty skipped; partial needs a summary and every skipped entry non-blank",
    L !== null &&
    errs([row({ summary: " " }), clean[1], clean[2]]).some((e) => e.startsWith("a:")) &&
    errs([row({ skipped: ["x"] }), clean[1], clean[2]]).some((e) => e.startsWith("a:")) &&
    errs([row({ state: "partial", skipped: [] }), clean[1], clean[2]]).some((e) => e.startsWith("a:")) &&
    errs([row({ state: "partial", skipped: ["tool absent", ""] }), clean[1], clean[2]]).some((e) => e.startsWith("a:")) &&
    errs([row({ state: "partial", skipped: ["tool absent"] }), clean[1], clean[2]]).length === 0,
    ["covered/partial rules"]);
  kase("U6", "not_run and no_result need a reason; deferring without one is the case the ticket names",
    L !== null &&
    errs([row({ state: "not_run", reason: "" }), clean[1], clean[2]]).some((e) => e.startsWith("a:")) &&
    errs([row({ state: "no_result", reason: " " }), clean[1], clean[2]]).some((e) => e.startsWith("a:")),
    ["reason rules"]);
  if (L) {
    const m = L.buildCoverage(reg, new Map([["a", res()], ["b", null]]), () => "not asked");
    const one = (v) => L.buildCoverage(reg, new Map([["a", v]]), () => "w")[0].state;
    kase("U7", "buildCoverage is total: a result, a null, a missing key, a result without .result and a non-array skipped each land in one known state",
      m.map((r) => r.state).join() === "covered,no_result,not_run" &&
      one(undefined) === "no_result" && one({ lane: { key: "a" }, result: "oops" }) === "no_result" && one(res({ skipped: "not an array" })) === "partial",
      [JSON.stringify(m.map((r) => `${r.lane}:${r.state}`))]);
    const alone = L.coverageOf({ core: [{ key: "a" }, { key: "b" }], conditional: { c: {} }, active: [{ key: "a" }, { key: "b" }],
      results: [null, res({}, "b")], notRun: () => "n" });
    kase("U8", "coverageOf keys the results by lane, not by position: a null in front does not move b's result onto a",
      alone.rows.map((r) => `${r.lane}:${r.state}`).join() === "a:no_result,b:covered,c:not_run" && alone.complete === false && alone.errors.length === 0,
      [JSON.stringify(alone.rows.map((r) => `${r.lane}:${r.state}`))]);
  } else kase("U7", "buildCoverage is total", false, ["(no ledger block)"]);

  // ---- V*: a batch verifier that leaves findings without a verdict (ticket "ein-toter-batch-verifizierer-laesst-in-review-deep-alle-befunde-ungeprueft-stehen") ----
  // Policy stays: a missing verdict keeps the finding (losing a real finding is worse than one stray nit). The gap is NAMED instead:
  // `coverage.rows[].unverified` lists the ids the verifier owed a verdict and did not give, and the report head (written by the script) says so.
  {
    const vf = (id, severity = "high", extra = {}) => ({ id, title: `t ${id}`, severity, category: "security", file: "a.js", lines: "1", description: "d", impact: "i", recommendation: "r", effort: "small", ...extra });
    const vd = (findingId, isReal = true) => ({ findingId, isReal, reasoning: "r" });
    // `verifier`: what the agent labelled verify:security answers (a value, or a function that may throw). Every other lane is clean.
    async function vgo(findings, verifier, args = {}) {
      const calls = [];
      const agent = async (prompt, opts) => {
        calls.push(opts.label);
        if (opts.label === "vitals") return VITALS;
        if (opts.label === "find:security") return { lane: "security", summary: "security checked", findings, skipped: [] };
        if (opts.label.startsWith("find:")) return okLane(opts.label.slice(5));
        if (opts.label === "verify:security") return typeof verifier === "function" ? verifier() : verifier;
        if (opts.label === "blast-radius") return { hotspots: [] };
        if (opts.label === "synthesis") return { summary_markdown: "# Audit Summary" };
        throw new Error(`unexpected agent label ${opts.label}`);
      };
      const r = await runScript(SRC, { path: "/no/such/repo", ...args }, agent);
      const srow = (r.out.coverage?.rows || []).find((x) => x.lane === "security");
      const head = (r.out.report?.summary_markdown || "").split("# Audit Summary")[0]; // the script's block, before the model's text
      return { ...r, calls, srow, head, headLine: head.split("\n").find((l) => /^- security/.test(l)) || "",
        named: [...(srow?.unverified || [])].sort(), kept: r.out.findings.map((f) => f.id).sort(), verifyCalls: calls.filter((c) => c.startsWith("verify:")).length };
    }
    const two = [vf("f1", "high"), vf("f2", "critical")];
    const mixed = [vf("tool1", "high", { toolVerified: true, toolEvidence: "npm audit -> CVE" }), vf("m1", "medium"), vf("f1", "high"), vf("f2", "critical")];

    const v0 = await vgo(two, { verdicts: [vd("f1", false), vd("f2")] });
    kase("V0", "control: a verifier that answers (f1 refuted, f2 confirmed) drops f1, keeps f2, and nothing is named unverified",
      v0.verifyCalls === 1 && v0.kept.join() === "f2" && v0.named.length === 0 && v0.headLine === "" && v0.srow?.state === "covered",
      [`verify calls=${v0.verifyCalls} kept=${v0.kept} named=${v0.named} headLine=${JSON.stringify(v0.headLine)}`]);
    const v1 = await vgo(two, null);
    kase("V1", "a batch verifier that returns null: both findings stay and the security row names f1 and f2 as unverified",
      v1.kept.join() === "f1,f2" && v1.named.join() === "f1,f2",
      [`kept=${v1.kept}  row.unverified=${JSON.stringify(v1.srow?.unverified)} (today a finding kept for lack of a verdict looks like a confirmed one)`]);
    const v2 = await vgo(two, { verdicts: [] });
    kase("V2", "a batch verifier that returns verdicts: [] is the same: both stay, both are named",
      v2.kept.join() === "f1,f2" && v2.named.join() === "f1,f2", [`kept=${v2.kept}  row.unverified=${JSON.stringify(v2.srow?.unverified)}`]);
    const v3 = await vgo(two, { verdicts: [vd("f1")] });
    kase("V3", "a verdict for f1 only: f2 is named, f1 is not, both stay",
      v3.kept.join() === "f1,f2" && v3.named.join() === "f2", [`kept=${v3.kept}  row.unverified=${JSON.stringify(v3.srow?.unverified)}`]);
    kase("V4", "the report head, written by the script, names the lane and both ids and says unverified; the model's text follows it",
      /security/.test(v1.headLine) && /f1/.test(v1.headLine) && /f2/.test(v1.headLine) && /unverified/i.test(v1.headLine) && (v1.out.report?.summary_markdown || "").includes("# Audit Summary"),
      [`head block: ${JSON.stringify(v1.head.slice(0, 260))}`]);
    const v5 = await vgo(mixed, null);
    kase("V5", "only findings the verifier was owed are named: a tool fact and a medium finding pass without it and are not named",
      v5.named.join() === "f1,f2" && v5.kept.join() === "f1,f2,m1,tool1", [`named=${v5.named} kept=${v5.kept}`]);
    const v6 = await vgo(mixed, null, { verifyIntensity: "lite" });
    kase("V6", "lite: only the critical finding is owed a verdict, so only it is named; the high one passes by design",
      v6.named.join() === "f2" && v6.kept.join() === "f1,f2,m1,tool1", [`named=${v6.named} kept=${v6.kept}`]);
    const noOwed = [await vgo([vf("m1", "medium"), vf("l1", "low")], null), await vgo(mixed, null, { verifyIntensity: "off" })];
    kase("V7", "control: no verdict owed (standard with medium and low only; verifyIntensity off) means no verifier call and nothing named",
      noOwed.every((x) => x.verifyCalls === 0 && x.named.length === 0 && x.headLine === ""),
      [`verifier calls=${noOwed.map((x) => x.verifyCalls)} named=${noOwed.map((x) => x.named.length)} headLines=${JSON.stringify(noOwed.map((x) => x.headLine))}`]);
    kase("V8", "control: a dead verifier is a gap in the findings, not in the lane: the row stays covered, the run complete, nothing thrown, the report returned",
      v1.srow?.state === "covered" && v1.out.coverage?.complete === true && v1.out.coverage.errors.length === 0 && v1.out.report !== null,
      [`security=${brief(v1.srow)} complete=${v1.out.coverage?.complete} errors=${JSON.stringify(v1.out.coverage?.errors)}`]);
    kase("V9", "the Coverage log line shows the gap before the report is read",
      v1.logs.some((l) => /^Coverage:/.test(l) && /unverified/i.test(l)), [`logs=${JSON.stringify(v1.logs.slice(-2))}`]);
    const vdoc = fs.readFileSync(path.join(ROOT, "skills/review/references/repo-deep.md"), "utf8").split("\n");
    const vlimit = vdoc.find((l) => /^- \*\*The coverage table/.test(l)) || "";
    const vout = vdoc.find((l) => /findings\.json/.test(l) && /coverage/.test(l)) || "";
    kase("V10", "repo-deep.md says what the code does: a finding the verifier left without a verdict stays, unverified, and the table names it",
      /verdict/i.test(vlimit) && /unverified/i.test(vlimit) && /unverified/i.test(vout),
      [`limitations bullet: ${JSON.stringify(vlimit.slice(0, 200))}`, `findings.json step: ${JSON.stringify(vout.slice(0, 200))}`]);
  }

  // ---- the guard: the text that promises the table must not promise more than the table is ----
  const doc = fs.readFileSync(path.join(ROOT, "skills/review/references/repo-deep.md"), "utf8");
  kase("D1", "repo-deep.md tells the caller to write `coverage` into findings.json and says the table checks form, not truth",
    /findings\.json[^\n]*coverage/.test(doc) && /form, not (what|truth)|form only/i.test(doc), ["repo-deep.md: output step and limitation"]);
  const argLine = (name) => doc.split("\n").find((l) => l.startsWith(`- \`${name}\``)) || "";
  kase("D2", "repo-deep.md says in the `lanes` line and in the `extraLanes` line that an unknown key, or a value that is not an array, stops the run before the first phase",
    ["lanes", "extraLanes"].every((n) => /unknown key/i.test(argLine(n)) && /not an array/i.test(argLine(n)) && /before the first phase/i.test(argLine(n))),
    ["lanes", "extraLanes"].map((n) => `${n} line: ${JSON.stringify(argLine(n).slice(0, 110))}`));

  console.log(`${total} cases, ${red} red`);
  process.exit(red ? 1 : 0);
})().catch((e) => { console.log(`FAIL harness crashed: ${e && e.stack || e}`); process.exit(2); });
