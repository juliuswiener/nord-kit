#!/usr/bin/env node
// work-package.recall.test.cjs — how much of what 10 real commits changed the default
// package finds, with the decomposition pinned (no model call).
// Run: node work-package.recall.test.cjs
//
// Truth: changedSymbols(repo, commit) — declarations the commit touched. The package is
// built at <commit>~1 from the fixture's questions. Thresholds from the decision
// die-zerlegung-wird-am-graphen-geprueft: package recall >= 0.80, aendern precision
// >= 0.45, mean package <= 7000 tokens. Baseline 2026-09-25 (1.62.0): 0.74 / 0.53 / 5342;
// on the frozen bench (a562d32, main a9ed8d4): 0.83 / 0.53 / 5463.
// Vault: backlog/nord/zerlegung-verfehlt-ein-viertel-der-geaenderten-symbole.

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const wp = require(path.join(__dirname, "work-package.cjs"));
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, "work-package.recall.fixture.json"), "utf8"));
const bare = (s) => String(s).replace(/^\./, "").replace(/\(\)$/, "");

// Frozen bench: the git history of WP_TEST_REPO (commits are immutable) plus the graph of
// 2026-09-25 (built at ddca425c), kept as work-package.recall.graph.json.gz. buildPackage
// reads the LIVE graphify-out/graph.json whatever commit it builds at, and graphify rebuilds
// that file in orch_tui: it grew from 7182 to 15496 nodes in six weeks, and the unchanged
// code of 2026-09-25 fell from 0.83 to 0.78 (a562d32 and main alike, measured 2026-11-09).
// The clone has no co-change overlay; the recall is the same with and without it.
// This does not measure the package on today's graph.
const SRC = process.env.WP_TEST_REPO || path.join(os.homedir(), "00_projects/169_orch_tui/orch_tui");
const BENCH = fs.mkdtempSync(path.join(os.tmpdir(), "wp-recall-"));
process.on("exit", () => fs.rmSync(BENCH, { recursive: true, force: true }));
const REPO = path.join(BENCH, "repo");
execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", SRC, REPO]);
fs.mkdirSync(path.join(REPO, "graphify-out"));
fs.writeFileSync(path.join(REPO, "graphify-out", "graph.json"),
  zlib.gunzipSync(fs.readFileSync(path.join(__dirname, "work-package.recall.graph.json.gz"))));
for (const c of Object.keys(FX.commits)) {
  try { execFileSync("git", ["-C", REPO, "cat-file", "-e", `${c}^{commit}`], { stdio: "ignore" }); } catch {
    console.error(`FAIL bench: commit ${c} is not in the history of ${SRC} (branch rewritten?)`);
    process.exit(2);
  }
}

let truth = 0, found = 0, aendernAll = 0, aendernHit = 0, tokens = 0;
const missed = [];
const commits = Object.entries(FX.commits);
for (const [commit, { questions }] of commits) {
  const gt = wp.changedSymbols(REPO, commit);
  const pkg = wp.buildPackage({ repo: REPO, commit: `${commit}~1`, questions });
  const inPkg = new Set([...pkg.tiers.aendern, ...pkg.tiers.wahrscheinlich, ...pkg.tiers.pruefen].map((i) => bare(i.symbol)));
  const aendern = new Set(pkg.tiers.aendern.map((i) => bare(i.symbol)));
  truth += gt.length;
  found += gt.filter((s) => inPkg.has(s)).length;
  aendernAll += aendern.size;
  aendernHit += [...aendern].filter((s) => gt.includes(s)).length;
  tokens += wp.renderMarkdown(pkg).length / 4;
  missed.push(...gt.filter((s) => !inPkg.has(s)).map((s) => `${commit}:${s}`));
}
const recall = found / truth;
const precision = aendernAll ? aendernHit / aendernAll : 0;
const meanTokens = Math.round(tokens / commits.length);
console.log(`recall ${recall.toFixed(2)} (${found}/${truth}) · precision aendern ${precision.toFixed(2)} (${aendernHit}/${aendernAll}) · mean ${meanTokens} tokens`);
console.log(`missed: ${missed.join(" ") || "-"}`);

let failed = 0;
const check = (name, ok) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
check("recall: the package holds >= 80 % of the changed symbols", recall >= 0.8);
check("precision: >= 45 % of aendern were really changed", precision >= 0.45);
check("size: mean package <= 7000 tokens", meanTokens <= 7000);
console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
