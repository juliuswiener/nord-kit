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
    // Uncapped this package is ~3.600 tokens, aendern alone ~1.460: 3000 forces a cut
    // that must take pruefen first and leave aendern whole.
    const q = { symbols: ["Deliver", "Interrupt", "Overview"], terms: [], subsystems: ["agent", "router"] };
    const full = wp.buildPackage({ repo: REPO, budgetTokens: 1e9, questions: q });
    const pkg = wp.buildPackage({ repo: REPO, budgetTokens: 3000, questions: q });
    const md = wp.renderMarkdown(pkg);
    check("budget: uncapped package is above the cap (else nothing is tested)",
      wp.renderMarkdown(full).length / 4 > 3000, String(wp.renderMarkdown(full).length / 4));
    check("budget: rendered package stays under the cap", md.length / 4 <= 3000, String(md.length / 4));
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
};

const only = process.argv[2];
for (const [name, fn] of Object.entries(SECTIONS)) {
  if (only && only !== name) continue;
  try { fn(); } catch (e) { check(`${name}: threw`, false, e.stack.split("\n").slice(0, 3).join(" | ")); }
}
console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
