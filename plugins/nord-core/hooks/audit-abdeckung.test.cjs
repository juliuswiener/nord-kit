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

// ---- the harness: the Workflow tool's globals, as plain JS ----
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const nullOnThrow = async (f) => { try { return await f(); } catch { return null; } };
async function runScript(args, agent) {
  const body = SRC.replace(/^export const meta/m, "const meta");
  const pipeline = (items, ...stages) => Promise.all(items.map((item, i) => nullOnThrow(async () => {
    let v = item;
    for (const s of stages) v = await s(v, item, i);
    return v;
  })));
  const parallel = (thunks) => Promise.all(thunks.map((t) => nullOnThrow(t)));
  const logs = [];
  const budget = { total: null, spent: () => 0, remaining: () => Infinity };
  const workflow = async () => { throw new Error("workflow() is not stubbed"); };
  const out = await new AsyncFunction("args", "agent", "pipeline", "parallel", "phase", "log", "budget", "workflow", body)(
    args, agent, pipeline, parallel, () => {}, (m) => logs.push(String(m)), budget, workflow);
  return { out, logs };
}

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
  const r = await runScript({ path: "/no/such/repo", ...args }, s.agent);
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

  // ---- the guard: the text that promises the table must not promise more than the table is ----
  const doc = fs.readFileSync(path.join(ROOT, "skills/review/references/repo-deep.md"), "utf8");
  kase("D1", "repo-deep.md tells the caller to write `coverage` into findings.json and says the table checks form, not truth",
    /findings\.json[^\n]*coverage/.test(doc) && /form, not (what|truth)|form only/i.test(doc), ["repo-deep.md: output step and limitation"]);

  console.log(`${total} cases, ${red} red`);
  process.exit(red ? 1 : 0);
})().catch((e) => { console.log(`FAIL harness crashed: ${e && e.stack || e}`); process.exit(2); });
