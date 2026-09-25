#!/usr/bin/env node
// work-package.test.cjs — plain-node checks for the implementer work package.
// Run: node work-package.test.cjs [section]   sections: ungueltig commitstand
//      abweichung historie budget zeit nachkontrolle   (no argument = all)
//
// Runs against the real orch_tui repo and its graphify-out/graph.json, because the
// point is what the graph actually yields, not what a fixture graph would.
// Vault: backlog/nord/implementierer-paket-aus-dem-graphen.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const WP = path.join(__dirname, "work-package.cjs");
const REPO = process.env.WP_TEST_REPO || path.join(os.homedir(), "00_projects/169_orch_tui/orch_tui");
// AK1 replay: 94cab77 "fix(agent): hand the write's place on" changed Agent, Deliver, Interrupt.
const HIST_COMMIT = "94cab77";
const FIXTURE = path.join(__dirname, "work-package.fixture.json");

const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const wp = require(WP);

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
}
const items = (pkg) => [...pkg.tiers.aendern, ...pkg.tiers.wahrscheinlich, ...pkg.tiers.pruefen];
const bare = (s) => String(s).replace(/^\./, "").replace(/\(\)$/, "");

const SECTIONS = {
  ungueltig() {
    const pkg = wp.buildPackage({ repo: REPO, questions: {
      symbols: ["Deliver", "GibtEsNichtImGraphen", "Interrupt"], terms: ["zzqqxxnichtda"], subsystems: ["agent"] } });
    const names = items(pkg).map((i) => bare(i.symbol));
    check("ungueltig: unknown symbol yields no entry", !names.includes("GibtEsNichtImGraphen"));
    check("ungueltig: empty term yields no entry", !names.some((n) => n.includes("zzqq")));
    check("ungueltig: valid symbols land in aendern",
      ["Deliver", "Interrupt"].every((s) => pkg.tiers.aendern.some((i) => bare(i.symbol) === s)),
      JSON.stringify(pkg.tiers.aendern.map((i) => i.symbol)));
    // Deliver and Interrupt are methods of Agent, and a method's receiver type joins aendern.
    check("ungueltig: aendern holds the valid symbols and their receiver, nothing else",
      JSON.stringify(pkg.tiers.aendern.map((i) => bare(i.symbol)).sort()) === '["Agent","Deliver","Interrupt"]',
      JSON.stringify(pkg.tiers.aendern.map((i) => i.symbol)));
    const none = wp.buildPackage({ repo: REPO, questions: { symbols: ["GibtEsNicht"], terms: [], subsystems: [] } });
    check("ungueltig: all-invalid questions give an empty package", items(none).length === 0);
  },

  // Findings of the first real worker run (vault: Übergabe 2026-09-24, Befunde 2–4).
  aufloesung() {
    const where = (pkg, s) => pkg.tiers.aendern.filter((i) => bare(i.symbol) === s).map((i) => i.file);
    const bySub = wp.buildPackage({ repo: REPO, questions: { symbols: ["Overview"], terms: [], subsystems: ["router"] } });
    check("aufloesung: an ambiguous name prefers the expected subsystem",
      JSON.stringify(where(bySub, "Overview")) === '["internal/router/overview.go"]', JSON.stringify(where(bySub, "Overview")));
    check("aufloesung: ...and then raises no feedback", bySub.feedback.length === 0, JSON.stringify(bySub.feedback));
    const qual = wp.buildPackage({ repo: REPO, questions: { symbols: ["Router.Overview"], terms: [], subsystems: [] } });
    check("aufloesung: Type.Method resolves through the receiver",
      JSON.stringify(where(qual, "Overview")) === '["internal/router/overview.go"]', JSON.stringify(where(qual, "Overview")));
    const router = qual.tiers.aendern.find((i) => i.symbol === "Router");
    check("aufloesung: a receiver declared in another file still gets its code",
      Boolean(router && /(^|\n)(type )?Router struct/.test(router.code || "") && router.file !== "internal/router/overview.go"),
      JSON.stringify(router && { file: router.file, code: (router.code || "").slice(0, 40) }));
    check("aufloesung: an unknown Type.Method drops", items(wp.buildPackage({ repo: REPO,
      questions: { symbols: ["Nirgends.Overview"], terms: [], subsystems: [] } })).length === 0);
    const term = wp.buildPackage({ repo: REPO, questions: { symbols: [], terms: ["deadlock"], subsystems: [] } });
    check("aufloesung: a term never pulls a test into aendern",
      term.tiers.aendern.every((i) => !/_test\.go$/.test(i.file)), JSON.stringify(term.tiers.aendern.map((i) => i.file)));
    // Router.Overview is no neighbour of Deliver (checked), so only `affected` can put it there.
    const aff = wp.buildPackage({ repo: REPO, questions: { symbols: ["Deliver"], affected: ["Router.Overview"], terms: [], subsystems: ["agent", "router"] } });
    check("aufloesung: affected symbols land in wahrscheinlich, not aendern",
      aff.tiers.wahrscheinlich.some((i) => i.id === "router_router_overview")
        && !aff.tiers.aendern.some((i) => i.id === "router_router_overview"),
      JSON.stringify(aff.tiers.aendern.map((i) => i.symbol)));
    check("aufloesung: affected items carry a signature",
      aff.tiers.wahrscheinlich.filter((i) => i.id === "router_router_overview").every((i) => i.signature));
  },

  // Gaps the with/without comparison showed (pkg3 read New() and the comments over pipes.write).
  umgebung() {
    const pkg = wp.buildPackage({ repo: REPO, questions: { symbols: ["Deliver"], terms: [], subsystems: ["agent"] } });
    const ctor = pkg.tiers.wahrscheinlich.find((i) => i.id === "internal_agent_agent_new");
    check("umgebung: the receiver's constructor comes with full code",
      Boolean(ctor && ctor.code && ctor.code.includes("func New(cfg Config) *Agent")), JSON.stringify(ctor));
    // 57 references point at Agent, 30 of them from a signature; only New() is a
    // same-package, non-test, non-method one. None of the others may ride along with code.
    const withCode = pkg.tiers.wahrscheinlich.filter((i) => i.code).map((i) => i.symbol);
    check("umgebung: no other signature user of Agent gets code", JSON.stringify(withCode) === '["New()"]', JSON.stringify(withCode));
    // Spec (internal/abrun): ParseSpec names it in its signature; Block and Manifest
    // only hold it as a field, on a line of their own — they must not get code.
    const spec = wp.buildPackage({ repo: REPO, questions: { symbols: ["Spec"], terms: [], subsystems: ["abrun"] } });
    const specCode = spec.tiers.wahrscheinlich.filter((i) => i.code).map((i) => i.symbol).sort();
    check("umgebung: a field reference is no constructor (declaration-line rule)",
      JSON.stringify(specCode) === '["ParseSpec()"]', JSON.stringify(specCode));
    const deliver = pkg.tiers.aendern.find((i) => bare(i.symbol) === "Deliver");
    check("umgebung: the doc comment right above a declaration comes with it",
      Boolean(deliver && deliver.code.startsWith("// Deliver")), JSON.stringify((deliver && deliver.code || "").slice(0, 60)));
    const sha = git("rev-parse", "HEAD").trim();
    check("umgebung: code with its comment is still verbatim at the commit",
      git("show", `${sha}:${deliver.file}`).includes(deliver.code));
  },

  // Knobs for the second series: each must change the package, and the defaults must hold.
  tuning() {
    const q = { symbols: ["Deliver"], terms: ["write"], subsystems: ["agent"] };
    // Term hits are hints, not change targets: by default they land in wahrscheinlich.
    const termHits = (pkg) => pkg.tiers.wahrscheinlich.filter((i) => /write/i.test(i.symbol));
    const def = wp.buildPackage({ repo: REPO, questions: q });
    check("tuning: defaults are subsystem-only terms, 5 per term",
      wp.TUNING.maxPerTerm === 5 && wp.TUNING.termsInSubsystem === true);
    check("tuning: term hits stay inside the expected subsystem",
      termHits(def).length > 0 && termHits(def).every((i) => i.file.startsWith("internal/agent/")),
      JSON.stringify(termHits(def).map((i) => i.file)));
    check("tuning: at most maxPerTerm hits per term", termHits(def).length <= wp.TUNING.maxPerTerm, String(termHits(def).length));
    const wide = wp.buildPackage({ repo: REPO, questions: q, tuning: { termsInSubsystem: false, maxPerTerm: 5 } });
    check("tuning: termsInSubsystem=false reaches outside", termHits(wide).some((i) => !i.file.startsWith("internal/agent/")),
      JSON.stringify(termHits(wide).map((i) => i.file)));
    const full = wp.buildPackage({ repo: REPO, questions: q, budgetTokens: 1e9, tuning: { wahrFull: true } });
    check("tuning: wahrFull gives wahrscheinlich full code",
      full.tiers.wahrscheinlich.filter((i) => i.code).length > def.tiers.wahrscheinlich.filter((i) => i.code).length);
    const nop = wp.buildPackage({ repo: REPO, questions: q, tuning: { pruefen: false } });
    check("tuning: pruefen=false empties the tier", nop.tiers.pruefen.length === 0 && def.tiers.pruefen.length > 0);
    const cc = (pkg) => pkg.tiers.pruefen.filter((i) => i.via === "cochange").length;
    const loose = wp.buildPackage({ repo: REPO, questions: q, budgetTokens: 1e9, tuning: { ccMinConfidence: 0.15, ccMinCount: 1 } });
    const strict = wp.buildPackage({ repo: REPO, questions: q, budgetTokens: 1e9 });
    check("tuning: looser AP12 thresholds admit more neighbours", cc(loose) > cc(strict), `${cc(loose)} vs ${cc(strict)}`);
  },

  // Messreihe 2 misses: terms are phrases, code has identifiers. "idle nudge" must find
  // nudgeIdleWorkers (ab92a97 changed it), "worktree remove" removeWorktree (2a63b3e).
  begriffe() {
    const pkgOf = (terms, subsystems, tuning) => wp.buildPackage({ repo: REPO, questions: { symbols: [], terms, subsystems }, tuning });
    const find = (terms, subsystems) => pkgOf(terms, subsystems).tiers.wahrscheinlich.map((i) => bare(i.symbol));
    const a = find(["idle nudge"], ["app"]);
    check("begriffe: a phrase finds the identifier with its words in another order", a.includes("nudgeIdleWorkers"), JSON.stringify(a));
    const b = find(["worktree remove"], ["router"]);
    check("begriffe: verb and noun find removeWorktree", b.includes("removeWorktree"), JSON.stringify(b));
    const c = find(["idle nudge"], ["app"]);
    check("begriffe: the label matching more words ranks first", c[0] === "nudgeIdleWorkers", JSON.stringify(c));
    check("begriffe: a stop word alone finds nothing", find(["the and"], []).length === 0);
    check("begriffe: by default a term hit never enters aendern", pkgOf(["idle nudge"], ["app"]).tiers.aendern.length === 0);
    const split = pkgOf(["idle nudge"], ["app"], { termTier: "split" });
    check("begriffe: termTier split sends a hit carrying every word to aendern",
      split.tiers.aendern.some((i) => bare(i.symbol) === "nudgeIdleWorkers")
      && !split.tiers.aendern.some((i) => bare(i.symbol) === "nudgeMessage"), JSON.stringify(split.tiers.aendern.map((i) => i.symbol)));
  },

  // Expected subsystems are checked against the graph (234c539: the decomposition named
  // worker/task/probing, none of them a package, and the filter cut the real hits).
  subsysteme() {
    const hits = (subsystems) => {
      const p = wp.buildPackage({ repo: REPO, questions: { symbols: [], terms: ["decide policy"], subsystems } });
      return [...p.tiers.aendern, ...p.tiers.wahrscheinlich].map((i) => i.file);
    };
    check("subsysteme: names that match no package are dropped, then nothing filters",
      hits(["probing", "nosuchpackage"]).some((f) => f.startsWith("internal/permit/")), JSON.stringify(hits(["probing", "nosuchpackage"])));
    check("subsysteme: a real package still filters", !hits(["agent"]).some((f) => f.startsWith("internal/permit/")),
      JSON.stringify(hits(["agent"])));
    check("subsysteme: a mix keeps only the real one", !hits(["agent", "probing"]).some((f) => f.startsWith("internal/permit/")));
  },

  // The Read guard refuses a ranged read wholly inside these spans (Befund 1).
  bereiche() {
    const pkg = wp.buildPackage({ repo: REPO, questions: { symbols: ["Deliver"], terms: [], subsystems: ["agent"] } });
    const it = pkg.tiers.aendern.find((i) => bare(i.symbol) === "Deliver");
    const spans = (pkg.ranges || {})[it && it.file] || [];
    const lines = fs.readFileSync(path.join(REPO, it.file), "utf8").split("\n");
    check("bereiche: every aendern item with code has a span",
      pkg.tiers.aendern.filter((i) => i.code).every((i) => (pkg.ranges || {})[i.file]), JSON.stringify(pkg.ranges));
    check("bereiche: the Deliver span is exactly its code in the working tree",
      spans.some(([s, e]) => lines.slice(s - 1, e).join("\n") === it.code), JSON.stringify(spans));
  },

  commitstand() {
    const sha = git("rev-parse", `${HIST_COMMIT}~1`).trim();
    const pkg = wp.buildPackage({ repo: REPO, commit: `${HIST_COMMIT}~1`,
      questions: { symbols: ["Deliver", "Interrupt"], terms: [], subsystems: ["agent"] } });
    check("commitstand: package names the resolved commit", pkg.commit === sha, pkg.commit);
    const withCode = items(pkg).filter((i) => i.code || i.signature);
    check("commitstand: package carries code", withCode.length >= 2, String(withCode.length));
    const cache = {};
    for (const i of withCode) {
      cache[i.file] ??= git("show", `${sha}:${i.file}`);
      const text = i.code || i.signature;
      check(`commitstand: ${i.file} ${i.symbol} is verbatim at ${sha.slice(0, 7)}`, cache[i.file].includes(text));
    }
    // The graph is at HEAD; the snippet must still come from the named commit.
    const deliver = pkg.tiers.aendern.find((i) => bare(i.symbol) === "Deliver");
    check("commitstand: Deliver at the old commit still takes writeMu", deliver && deliver.code.includes("writeMu"));
    const head = wp.buildPackage({ repo: REPO, questions: { symbols: ["Deliver"], terms: [], subsystems: ["agent"] } });
    const d2 = head.tiers.aendern.find((i) => bare(i.symbol) === "Deliver");
    check("commitstand: Deliver at HEAD no longer does", d2 && !d2.code.includes("writeMu.Lock"));
  },

  abweichung() {
    const q = { symbols: ["Deliver"], terms: [], subsystems: [] };
    const wrong = wp.buildPackage({ repo: REPO, questions: { ...q, subsystems: ["tui"] } });
    check("abweichung: wrong subsystem reports to the orchestrator", wrong.feedback.length > 0);
    check("abweichung: the report names subsystem, coupling and weight",
      wrong.feedback.every((f) => f.subsystem && f.coupling && typeof f.weight === "number"),
      JSON.stringify(wrong.feedback));
    check("abweichung: the report names internal/agent",
      wrong.feedback.some((f) => f.subsystem.includes("internal/agent")), JSON.stringify(wrong.feedback));
    const right = wp.buildPackage({ repo: REPO, questions: { ...q, subsystems: ["agent"] } });
    check("abweichung: matching subsystem reports nothing", right.feedback.length === 0, JSON.stringify(right.feedback));
  },

  historie() {
    if (!fs.existsSync(FIXTURE)) {
      check("historie: fixture exists (record it: node work-package.cjs decompose --repo <orch_tui> \"<auftrag>\")", false);
      return;
    }
    const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    const pkg = wp.buildPackage({ repo: REPO, commit: `${HIST_COMMIT}~1`, questions: fx.questions });
    const got = new Set(pkg.tiers.aendern.map((i) => bare(i.symbol)));
    for (const s of fx.changed) check(`historie: aendern covers ${s}`, got.has(s), JSON.stringify([...got]));
    // The fixture's `changed` must itself be what the commit changed, or the check is hollow.
    check("historie: fixture.changed matches the diff", JSON.stringify(wp.changedSymbols(REPO, HIST_COMMIT).sort())
      === JSON.stringify([...fx.changed].sort()), JSON.stringify(wp.changedSymbols(REPO, HIST_COMMIT)));
  },

  budget() {
    // The cap sits halfway between aendern alone and the uncapped package, so a cut is
    // forced and must take pruefen first and leave aendern whole.
    const q = { symbols: ["Deliver", "Interrupt"], terms: [], subsystems: ["agent"] };
    const tok = (p) => wp.renderMarkdown(p).length / 4;
    const full = wp.buildPackage({ repo: REPO, budgetTokens: 1e9, questions: q });
    const floor = wp.buildPackage({ repo: REPO, budgetTokens: 0, questions: q });
    const cap = Math.round((tok(floor) + tok(full)) / 2);
    const pkg = wp.buildPackage({ repo: REPO, budgetTokens: cap, questions: q });
    const md = wp.renderMarkdown(pkg);
    check("budget: uncapped package is above the cap (else nothing is tested)", tok(full) > cap, `${tok(full)} vs ${cap}`);
    check("budget: rendered package stays under the cap", md.length / 4 <= cap, `${md.length / 4} vs ${cap}`);
    check("budget: pruefen is cut before wahrscheinlich",
      pkg.tiers.pruefen.length < full.tiers.pruefen.length && pkg.tiers.wahrscheinlich.length > 0);
    check("budget: aendern survives the cut", pkg.tiers.aendern.length >= 2 && pkg.tiers.aendern.every((i) => i.code));
    check("budget: header names commit and the do-not-reread note",
      md.includes(pkg.commit) && md.includes("nicht erneut lesen"));
  },

  zeit() {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "wp-zeit-"));
    const q = path.join(out, "q.json");
    fs.writeFileSync(q, JSON.stringify({ symbols: ["Deliver", "Overview"], terms: ["wedge"], subsystems: ["agent"] }));
    const t0 = Date.now();
    const r = spawnSync("node", [WP, "dispatch", "--repo", REPO, "--questions", q, "--out", out], { encoding: "utf8" });
    const secs = (Date.now() - t0) / 1000;
    check("zeit: dispatch exits 0", r.status === 0, r.stderr.slice(0, 300));
    check("zeit: dispatch under 10 s", secs < 10, `${secs}s`);
    fs.rmSync(out, { recursive: true, force: true });
  },

  nachkontrolle() {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "wp-check-"));
    const q = path.join(out, "q.json");
    fs.writeFileSync(q, JSON.stringify({ symbols: ["Deliver", "Interrupt"], terms: [], subsystems: ["agent"] }));
    const r = spawnSync("node", [WP, "dispatch", "--repo", REPO, "--commit", `${HIST_COMMIT}~1`,
      "--questions", q, "--out", out], { encoding: "utf8" });
    const run = r.stdout.trim().split("\n").pop();
    const dir = path.join(out, run);
    check("nachkontrolle: dispatch prints a run id with a package", fs.existsSync(path.join(dir, "package.json")), r.stdout + r.stderr);
    // A replayed worker: the real 94cab77 diff, plus reads in, outside and again inside the package.
    const patch = path.join(out, "diff.patch");
    fs.writeFileSync(patch, git("diff", `${HIST_COMMIT}~1`, HIST_COMMIT));
    const inside = "internal/agent/agent.go";
    fs.writeFileSync(path.join(dir, "reads.jsonl"), [
      { file: inside, verdict: "deny" }, { file: inside, verdict: "deny" },
      { file: "internal/router/router.go", verdict: "allow" },
    ].map((x) => JSON.stringify(x)).join("\n") + "\n");
    const c = spawnSync("node", [WP, "check", "--repo", REPO, "--out", out, "--diff", patch, run], { encoding: "utf8" });
    check("nachkontrolle: check exits 0", c.status === 0, c.stderr.slice(0, 300));
    let m = {};
    try { m = JSON.parse(fs.readFileSync(path.join(dir, "metrics.json"), "utf8")); } catch {}
    for (const k of ["aendernOhneAenderung", "aenderungenAusserhalb", "leseZugriffeAusserhalb", "erneutGelesen"])
      check(`nachkontrolle: metrics has ${k}`, Array.isArray(m[k]), JSON.stringify(m).slice(0, 300));
    check("nachkontrolle: the test file of the diff is a change outside the package",
      (m.aenderungenAusserhalb || []).some((x) => String(x).includes("wedgedqueue_test.go")));
    check("nachkontrolle: router.go is a read outside", (m.leseZugriffeAusserhalb || []).includes("internal/router/router.go"));
    check("nachkontrolle: agent.go read twice counts as re-read", (m.erneutGelesen || []).includes(inside));
    check("nachkontrolle: Deliver and Interrupt were changed", !(m.aendernOhneAenderung || ["x"]).length,
      JSON.stringify(m.aendernOhneAenderung));
    fs.rmSync(out, { recursive: true, force: true });
  },

  // Graph data orch_tui does not have, so a throwaway repo carries it. taxgraph's graph
  // holds code nodes with source_file null (20, ELSTER Kennzahlen) and "" (284); a JS
  // class brings a neighbour named constructor. All three crashed or leaked into the
  // package on 2026-09-25 (vault: audits/claude-mem-als-stoss, Lauf 5 und 7).
  graphrand() {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "wp-graphrand-"));
    const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
    fs.mkdirSync(path.join(repo, "web"));
    fs.writeFileSync(path.join(repo, "web/store.js"),
      "class Store {\n  constructor() { this.q = []; }\n  pending() { return this.q.length; }\n}\n");
    g("init", "-q");
    g("add", "web/store.js");
    g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "store");
    const node = (id, label, file, line) => ({ id, label, file_type: "code", source_file: file, source_location: `L${line}` });
    const edge = (source, target, relation) => ({ source, target, relation, confidence: "EXTRACTED", source_location: "L3" });
    fs.mkdirSync(path.join(repo, "graphify-out"));
    fs.writeFileSync(path.join(repo, "graphify-out/graph.json"), JSON.stringify({
      built_at_commit: g("rev-parse", "HEAD").trim(),
      nodes: [node("pending", ".pending()", "web/store.js", 3), node("ctor", ".constructor()", "web/store.js", 2),
        node("kz_null", "E0800502 (Summe Gewerbe)", null, 1), node("kz_leer", "E0800503 (Summe Leer)", "", 1)],
      links: [edge("pending", "ctor", "calls"), edge("pending", "kz_null", "references"), edge("pending", "kz_leer", "references")],
    }));
    const build = (questions) => {
      try { return wp.buildPackage({ repo, questions, cochange: false }); } catch (e) { return { threw: e.message }; }
    };
    const noFileless = (pkg) => !pkg.threw && items(pkg).every((i) => typeof i.file === "string" && i.file);

    const p = build({ symbols: ["pending"] });
    check("graphrand: a neighbour named constructor does not crash", !p.threw, p.threw);
    const ctor = p.threw ? null : items(p).find((i) => bare(i.symbol) === "constructor");
    check("graphrand: constructor carries text, not Object's constructor",
      ctor && [ctor.code, ctor.signature].every((t) => t === undefined || typeof t === "string"), JSON.stringify(ctor));
    check("graphrand: neighbours without a file stay out", noFileless(p), JSON.stringify(p.threw || items(p).map((i) => i.file)));
    for (const q of [{ symbols: ["E0800502 (Summe Gewerbe)"] }, { terms: ["E08005"] }, { symbols: ["E0800503 (Summe Leer)"] }]) {
      const r = build(q);
      check(`graphrand: ${JSON.stringify(q)} does not crash and yields no file-less entry`, noFileless(r),
        JSON.stringify(r.threw || items(r).map((i) => i.file)));
    }
    fs.rmSync(repo, { recursive: true, force: true });
  },
};

const only = process.argv[2];
for (const [name, fn] of Object.entries(SECTIONS)) {
  if (only && only !== name) continue;
  try { fn(); } catch (e) { check(`${name}: threw`, false, e.stack.split("\n").slice(0, 3).join(" | ")); }
}
console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
