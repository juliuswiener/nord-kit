#!/usr/bin/env node
// vault-context.test.cjs — plain-node checks for the vault context section.
// Run: node vault-context.test.cjs [section]
//      sections: zeitfilter historisch groesse applies_to paket   (no argument = all)
//
// Runs against the real vault (~/00_projects/vault) and the real orch_tui repo, because
// the point is what the vault actually holds, not what a fixture would. Read-only: never
// writes into the vault or orch_tui, only `git show`. Vault: backlog/nord/implementierer-
// paket-aus-dem-graphen (AP-vault).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const VC = path.join(__dirname, "vault-context.cjs");
const WP = path.join(__dirname, "work-package.cjs");
const ORCH_REPO = process.env.WP_TEST_REPO || path.join(os.homedir(), "00_projects/169_orch_tui/orch_tui");
const { vaultContext, excerptOf, VAULT } = require(VC);

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
}
const g = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();

const SECTIONS = {
  // AK1 replay: 94cab77 fixed exactly the wedge described here, and the vault's own
  // write-up of it (a decision plus its qualified backlog ticket) landed AFTER that
  // commit's committer time. Replaying against the old commit must not let the vault
  // hand the worker its own future fix.
  zeitfilter() {
    const auftrag = "Deliver und Interrupt nehmen writeMu, während a.mu gehalten wird; "
      + "Snapshot, Idle, LastResult warten";
    const before = parseInt(g(ORCH_REPO, "log", "-1", "--format=%ct", "94cab77"), 10);
    const NAMED = [
      "decisions/ordnungsplatz-wird-uebergeben-nicht-genommen.md",
      "backlog/archive/orch_tui/overview-haengt-hinter-verkeiltem-arbeiter.md",
    ];

    const withBefore = vaultContext({ auftrag, repo: ORCH_REPO, files: [], before });
    const paths1 = withBefore.notes.map((n) => n.path);
    check("zeitfilter: neither solution note appears with before = 94cab77's committer time",
      NAMED.every((p) => !paths1.includes(p)), JSON.stringify(paths1));

    const withoutBefore = vaultContext({ auftrag, repo: ORCH_REPO, files: [] });
    const paths2 = withoutBefore.notes.map((n) => n.path);
    check("zeitfilter: at least one solution note appears without before (proves the filter, not an empty search)",
      NAMED.some((p) => paths2.includes(p)), JSON.stringify(paths2));
  },

  // decisions/nord-pacman-repo.md: created 2026-08-21, 13 commits total (git log --follow),
  // last touched 2026-09-22. Its "## Entschieden" section (the excerpt's preferred section)
  // was rewritten between the first commit and today — checked by hand.
  historisch() {
    const NOTE = "decisions/nord-pacman-repo.md";
    const log = g(VAULT, "log", "--format=%H %ct", "--follow", "--", NOTE).split("\n");
    check("historisch: the note has at least two commits", log.length >= 2, `${log.length}`);
    const [firstSha, firstCt] = log[log.length - 1].split(" ");
    const before = parseInt(firstCt, 10) + 60; // just after creation, well before the last edit

    const oldContent = execFileSync("git", ["-C", VAULT, "show", `${firstSha}:${NOTE}`], { encoding: "utf8" });
    const oldExcerpt = excerptOf(oldContent);

    const auftrag = "pacman Repo nordserver signiert Port arch-desk darkhttpd";
    const historic = vaultContext({ auftrag, repo: ORCH_REPO, files: [], before });
    const found = historic.notes.find((n) => n.path === NOTE);
    check("historisch: the note is found with before set", !!found,
      JSON.stringify(historic.notes.map((n) => n.path)));
    if (!found) return;
    check("historisch: excerpt equals the old content's excerpt", found.excerpt === oldExcerpt);

    const current = vaultContext({ auftrag, repo: ORCH_REPO, files: [] });
    const now = current.notes.find((n) => n.path === NOTE);
    check("historisch: excerpt differs from the current content, not the old one",
      !!now && now.excerpt !== oldExcerpt);
  },

  groesse() {
    const auftrag = "Deliver und Interrupt nehmen writeMu, während a.mu gehalten wird; "
      + "Snapshot, Idle, LastResult warten";
    const normal = vaultContext({ auftrag, repo: ORCH_REPO, files: [], maxTokens: 1500 });
    check("groesse: markdown stays under maxTokens*4 chars", normal.markdown.length <= 1500 * 4,
      `${normal.markdown.length}`);
    check("groesse: uncapped run finds more than one note (else the drop below tests nothing)",
      normal.notes.length > 1, `${normal.notes.length}`);

    const tiny = vaultContext({ auftrag, repo: ORCH_REPO, files: [], maxTokens: 60 });
    check("groesse: tiny maxTokens keeps only the top note", tiny.notes.length === 1,
      JSON.stringify(tiny.notes.map((n) => n.path)));
    check("groesse: tiny markdown stays under maxTokens*4 chars", tiny.markdown.length <= 60 * 4,
      `${tiny.markdown.length}`);
    check("groesse: the surviving note is the same as the top-ranked note of the uncapped run",
      tiny.notes[0] && tiny.notes[0].path === normal.notes[0].path);
  },

  // decisions/stop-heisst-geleert.md and decisions/schreibgrenze-folgt-tmpdir-aus-einer-quelle.md
  // both carry internal/router/router.go in applies_to for orch_tui — one of 14 decisions
  // that do, so the budget is opened wide here; the default-budget drop is groesse's job.
  applies_to() {
    const r = vaultContext({ auftrag: "", repo: ORCH_REPO, files: ["internal/router/router.go"], maxTokens: 1e6 });
    check("applies_to: at least one decision is found via applies_to", r.notes.length > 0,
      JSON.stringify(r.notes));
    check("applies_to: found notes carry source \"applies_to\"",
      r.notes.every((n) => n.source === "applies_to"), JSON.stringify(r.notes.map((n) => n.source)));
    check("applies_to: a known orch_tui decision for router.go is among them",
      r.notes.some((n) => n.path === "decisions/stop-heisst-geleert.md"
        || n.path === "decisions/schreibgrenze-folgt-tmpdir-aus-einer-quelle.md"),
      JSON.stringify(r.notes.map((n) => n.path)));
  },

  paket() {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "wp-vault-"));
    const q = path.join(out, "q.json");
    fs.writeFileSync(q, JSON.stringify({ symbols: ["Deliver", "Interrupt"], terms: [], subsystems: ["agent"] }));
    const before = g(ORCH_REPO, "log", "-1", "--format=%ct", "94cab77");

    const { spawnSync } = require("child_process");
    const withVault = path.join(out, "with");
    const r1 = spawnSync("node", [WP, "dispatch", "--repo", ORCH_REPO, "--commit", "94cab77~1",
      "--questions", q, "--out", withVault, "--vault", "--vault-before", before], { encoding: "utf8" });
    const run1 = r1.stdout.trim().split("\n").pop();
    const md1 = fs.readFileSync(path.join(withVault, run1, "package.md"), "utf8");
    check("paket: --vault run exits 0", r1.status === 0, r1.stderr.slice(0, 300));
    check("paket: --vault run's package.md carries the section heading",
      md1.includes("## Entscheidungen und Vorgeschichte"));

    const withoutVault = path.join(out, "without");
    const r2 = spawnSync("node", [WP, "dispatch", "--repo", ORCH_REPO, "--commit", "94cab77~1",
      "--questions", q, "--out", withoutVault], { encoding: "utf8" });
    const run2 = r2.stdout.trim().split("\n").pop();
    const md2 = fs.readFileSync(path.join(withoutVault, run2, "package.md"), "utf8");
    check("paket: run without --vault exits 0", r2.status === 0, r2.stderr.slice(0, 300));
    check("paket: run without --vault has no section heading",
      !md2.includes("## Entscheidungen und Vorgeschichte"));

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
