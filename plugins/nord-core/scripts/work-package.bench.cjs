// work-package.bench.cjs — the frozen bench the work-package tests run on.
//
// buildPackage reads the LIVE graphify-out/graph.json whatever commit it builds at, and
// graphify rebuilds that file in orch_tui: 7182 nodes on 2026-09-25, 15496 on 2026-11-09.
// A test that follows it moves with it. Replayed on the 37 daily snapshots, the
// nachkontrolle section of work-package.test.cjs went red on 2026-09-25 (router.go sat
// inside the package), and the unchanged recall of that day fell from 0.83 to 0.78.
// So the bench is the git history of WP_TEST_REPO (commits are immutable) plus the graph of
// 2026-09-25 (built at ddca425c), kept as work-package.recall.graph.json.gz. Both tests
// that use it name the graph in their output; neither measures the package on today's graph.
//
//   tree: check the built-at commit out, for a test that reads the working tree
// The bench has no co-change overlay: building one (906 commits of ast-grep) takes a minute.
//
// Returns { SRC, REPO }. Exits 2 when a commit the bench needs is no longer in SRC.
// Vault: backlog/nord/der-recall-test-des-arbeitspakets-liefert-0-78-statt-mindestens-0-80.

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

module.exports = function frozenBench(prefix, { tree = false, commits = [] } = {}) {
  const SRC = process.env.WP_TEST_REPO || path.join(os.homedir(), "00_projects/169_orch_tui/orch_tui");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  const REPO = path.join(dir, "repo");
  const graph = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, "work-package.recall.graph.json.gz")));
  const builtAt = JSON.parse(graph).built_at_commit;
  execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", SRC, REPO]);
  for (const c of [builtAt, ...commits]) {
    try { execFileSync("git", ["-C", REPO, "cat-file", "-e", `${c}^{commit}`], { stdio: "ignore" }); } catch {
      console.error(`FAIL bench: commit ${c} is not in the history of ${SRC} (branch rewritten?)`);
      process.exit(2);
    }
  }
  if (tree) execFileSync("git", ["-C", REPO, "checkout", "-q", "--detach", builtAt]);
  fs.mkdirSync(path.join(REPO, "graphify-out"));
  fs.writeFileSync(path.join(REPO, "graphify-out", "graph.json"), graph);
  return { SRC, REPO };
};
