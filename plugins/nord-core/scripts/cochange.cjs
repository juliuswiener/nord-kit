#!/usr/bin/env node
// cochange.cjs — the co-change overlay (AP12): which code symbols change together in
// git history. A pair that always changes together but carries no structural edge in
// graph.json (a config table read by two unrelated handlers, a shared invariant) is
// exactly what the static graph misses, so work-package.cjs uses this as a second,
// independent signal for its "pruefen" tier. Vault: backlog/nord/implementierer-paket-aus-dem-graphen.
//
// Per non-merge commit: one `git show -U0 --format=%P%x1f%ct%x1e <sha>` gives both the
// commit's metadata (parent, committer time) and its unified diff in one process (root
// commits diff cleanly against the empty tree this way, no special case needed). All
// blob content the commit's files need — old side and new side — is then fetched in a
// single `git cat-file --batch` per commit rather than one `git show <ref>:<file>` per
// file side: orch_tui averages ~6 files/commit, and 900 commits x 2 sides x 1 process
// each is what pushed the 900-commit build past the 120s budget the first time round.
// ast-grep still runs once per file side that is actually needed (spec budget: "one
// ast-grep per changed file side"). That raw per-commit {t, syms} cache is never
// filtered by maxSymbols/halfLifeDays — aggregation (support, confidence, lift) is
// recomputed from it fresh on every build/update, so changing those knobs or adding
// commits never drifts from a full rebuild.
//
// CLI:
//   cochange.cjs build  --repo R
//   cochange.cjs update --repo R   (falls back to build if no overlay exists yet)

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const wp = require("./work-package.cjs");
const { astGrepDeclarations, langFor, bareLabel, subsystemOf } = wp;

const GIT_BUF = 1 << 28;

// ---- git plumbing ----------------------------------------------------------

function listCommits(repo) {
  const out = execFileSync("git", ["-C", repo, "rev-list", "--no-merges", "--reverse", "HEAD"], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

// %x1f/%x1e are field/record separators no commit message contains. Everything after
// the %x1e byte is the plain unified diff, unchanged from an empty --format.
function commitDiffAndMeta(repo, sha) {
  const raw = execFileSync("git", ["-C", repo, "show", "-U0", "--format=%P%x1f%ct%x1e", sha], { encoding: "utf8", maxBuffer: GIT_BUF });
  const sep = raw.indexOf("\x1e");
  const [parents, t] = raw.slice(0, sep).split("\x1f");
  const parentList = parents.trim().split(/\s+/).filter(Boolean);
  return { parent: parentList[0] || null, t: parseInt(t, 10), diffText: raw.slice(sep + 1) };
}

const stripAB = (p) => p.replace(/^[ab]\//, "");

// Unified diff -> file -> hunks, keeping BOTH sides (work-package's parseDiffHunks only
// keeps the old side; cochange needs the new side too, to catch a pure insertion).
function parseHunks(diffText) {
  const map = new Map();
  const lines = diffText.split("\n");
  let curFile = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("--- ") && lines[i + 1] && lines[i + 1].startsWith("+++ ")) {
      const oldP = l.slice(4).trim();
      const newP = lines[i + 1].slice(4).trim();
      curFile = oldP === "/dev/null" && newP === "/dev/null" ? null : stripAB(newP !== "/dev/null" ? newP : oldP);
      i++;
      continue;
    }
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (m && curFile) {
      const oldStart = parseInt(m[1], 10), oldCount = m[2] !== undefined ? parseInt(m[2], 10) : 1;
      const newStart = parseInt(m[3], 10), newCount = m[4] !== undefined ? parseInt(m[4], 10) : 1;
      if (!map.has(curFile)) map.set(curFile, []);
      map.get(curFile).push({ oldStart, oldCount, newStart, newCount });
    }
  }
  return map;
}

// path *.pb.go, *_gen.go, vendor/, graphify-out/, or a "Code generated ... DO NOT EDIT"
// first line -> excluded. The first line is checked against whichever side's content is
// available (old, new, or both); either side carrying the marker is enough.
function isExcludedPath(file) {
  return /\.pb\.go$/.test(file) || /_gen\.go$/.test(file)
    || /(^|\/)vendor\//.test(file) || /(^|\/)graphify-out\//.test(file);
}
function isGeneratedContent(content) {
  if (!content) return false;
  return /Code generated .* DO NOT EDIT/.test(content.split("\n", 1)[0]);
}

// One "git cat-file --batch" for every "<ref>:<file>" this commit's declaration
// extraction needs, in one process instead of one `git show` per blob. Requests for an
// object that does not exist (file added/removed/renamed) come back as null, same as a
// failed `git show` would have.
function catFileBatch(repo, requests) {
  if (!requests.length) return {};
  const res = spawnSync("git", ["-C", repo, "cat-file", "--batch"], {
    input: requests.map((r) => `${r}\n`).join(""), maxBuffer: GIT_BUF,
  });
  const buf = res.stdout;
  const out = {};
  let offset = 0;
  for (const req of requests) {
    const nl = buf.indexOf(10, offset);
    if (nl === -1) { out[req] = null; continue; }
    const header = buf.slice(offset, nl).toString("utf8");
    offset = nl + 1;
    if (header.endsWith(" missing")) { out[req] = null; continue; }
    const size = parseInt(header.split(" ").pop(), 10);
    out[req] = buf.slice(offset, offset + size).toString("utf8");
    offset += size + 1; // one LF terminates the content block
  }
  return out;
}

// The declarations touched on BOTH sides of one commit's diff, as "path#Name" strings.
// Test files are included (tests that co-change with the code they cover are useful).
function commitSymbols(repo, sha, parent, diffText) {
  const files = [...parseHunks(diffText)].filter(([file]) => !isExcludedPath(file) && langFor(file));
  if (!files.length) return [];

  const requests = [];
  const perFile = files.map(([file, hunks]) => {
    const oldReq = parent && hunks.some((h) => h.oldCount > 0) ? `${parent}:${file}` : null;
    const newReq = hunks.some((h) => h.newCount > 0) ? `${sha}:${file}` : null;
    if (oldReq) requests.push(oldReq);
    if (newReq) requests.push(newReq);
    return { file, langKey: langFor(file), hunks, oldReq, newReq };
  });
  const blobs = catFileBatch(repo, requests);

  const syms = new Set();
  for (const { file, langKey, hunks, oldReq, newReq } of perFile) {
    const oldContent = oldReq ? blobs[oldReq] : null;
    const newContent = newReq ? blobs[newReq] : null;
    if (isGeneratedContent(oldContent) || isGeneratedContent(newContent)) continue;
    if (oldContent) {
      const decls = astGrepDeclarations(oldContent, langKey);
      for (const h of hunks) {
        if (h.oldCount === 0) continue;
        const hs = h.oldStart, he = h.oldStart + h.oldCount - 1;
        for (const d of decls) if (d.start <= he && d.end >= hs) syms.add(`${file}#${d.name}`);
      }
    }
    if (newContent) {
      const decls = astGrepDeclarations(newContent, langKey);
      for (const h of hunks) {
        if (h.newCount === 0) continue;
        const hs = h.newStart, he = h.newStart + h.newCount - 1;
        for (const d of decls) if (d.start <= he && d.end >= hs) syms.add(`${file}#${d.name}`);
      }
    }
  }
  return [...syms].sort();
}

function commitEntry(repo, sha) {
  const { parent, t, diffText } = commitDiffAndMeta(repo, sha);
  return { t, syms: commitSymbols(repo, sha, parent, diffText) };
}

// ---- aggregation ------------------------------------------------------------

// ponytail: graph.json missing -> empty node set, every symbol drops unmapped. The
// commits cache is still built and written; a later `graphify build` plus `update`
// picks the pairs up without re-walking history.
function loadGraphRaw(repo) {
  try { return JSON.parse(fs.readFileSync(path.join(repo, "graphify-out", "graph.json"), "utf8")); }
  catch { return { nodes: [], links: [] }; }
}

function symbolToIds(nodes) {
  const map = new Map();
  for (const n of nodes) {
    if (!n.source_file) continue;
    const key = `${n.source_file}#${bareLabel(n.label)}`;
    (map.get(key) || map.set(key, []).get(key)).push(n.id);
  }
  return map;
}

function nodeInfo(nodes) {
  const out = {};
  for (const n of nodes) {
    if (!n.source_file) continue;
    out[n.id] = { file: n.source_file, package: subsystemOf(n.source_file) };
  }
  return out;
}

// idA|idB with idA < idB, so a pair is keyed once regardless of lookup order.
function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

function structuralLinks(links) {
  const set = new Set();
  for (const l of links || []) {
    if (l.relation === "contains") continue;
    set.add(pairKey(l.source, l.target));
  }
  return [...set];
}

function finalizePairs(acc, support) {
  const out = {};
  for (const [key, a] of Object.entries(acc)) {
    const [x, y] = key.split("|");
    const sX = support[x] || 0, sY = support[y] || 0;
    out[key] = {
      support: a.support,
      count: a.count,
      confidence: { [x]: sX ? a.support / sX : 0, [y]: sY ? a.support / sY : 0 },
      lift: sX && sY ? (a.support * a.total) / (sX * sY) : 0,
      last: a.last,
    };
  }
  return out;
}

// Recomputed fresh from the commits cache every time, so update() and build() always
// agree: nothing about support/confidence/lift is carried incrementally.
function assemble(repo, { head, now, halfLifeDays, maxSymbols, minCount, commits }) {
  const graph = loadGraphRaw(repo);
  const symToIds = symbolToIds(graph.nodes || []);
  const w = (t) => Math.pow(0.5, (now - t) / (halfLifeDays * 86400));

  let totalSupport = 0, packageTotalSupport = 0;
  const nodeSupport = {}, packageSupport = {};
  const pairAcc = {}, pkgPairAcc = {};

  for (const sha of Object.keys(commits)) {
    const entry = commits[sha];
    const n = entry.syms.length;
    if (n < 1 || n > maxSymbols) continue;
    const weight = w(entry.t);

    const idSet = new Set();
    for (const sym of entry.syms) for (const id of symToIds.get(sym) || []) idSet.add(id);
    const ids = [...idSet];
    if (ids.length) {
      totalSupport += weight;
      for (const id of ids) nodeSupport[id] = (nodeSupport[id] || 0) + weight;
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const key = pairKey(ids[i], ids[j]);
        const a = pairAcc[key] || (pairAcc[key] = { support: 0, count: 0, last: 0 });
        a.support += weight; a.count += 1; a.last = Math.max(a.last, entry.t);
      }
    }

    const pkgs = [...new Set(entry.syms.map((s) => subsystemOf(s.slice(0, s.lastIndexOf("#")))))];
    packageTotalSupport += weight;
    for (const pk of pkgs) packageSupport[pk] = (packageSupport[pk] || 0) + weight;
    for (let i = 0; i < pkgs.length; i++) for (let j = i + 1; j < pkgs.length; j++) {
      const key = pairKey(pkgs[i], pkgs[j]);
      const a = pkgPairAcc[key] || (pkgPairAcc[key] = { support: 0, count: 0, last: 0 });
      a.support += weight; a.count += 1; a.last = Math.max(a.last, entry.t);
    }
  }

  for (const a of Object.values(pairAcc)) a.total = totalSupport;
  for (const a of Object.values(pkgPairAcc)) a.total = packageTotalSupport;

  return {
    version: 1,
    head,
    builtAt: Date.now(),
    commits,
    nodes: nodeInfo(graph.nodes || []),
    totalSupport,
    packageTotalSupport,
    pairs: finalizePairs(pairAcc, nodeSupport),
    packagePairs: finalizePairs(pkgPairAcc, packageSupport),
    links: structuralLinks(graph.links || []),
    opts: { minCount, maxSymbols, halfLifeDays },
  };
}

function writeOverlay(repo, overlay) {
  const dir = path.join(repo, "graphify-out");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "cochange.json"), JSON.stringify(overlay));
}

function resolvedOpts(opts) {
  return {
    now: opts.now ?? Date.now() / 1000,
    halfLifeDays: opts.halfLifeDays ?? 180,
    maxSymbols: opts.maxSymbols ?? 30,
    minCount: opts.minCount ?? 2,
  };
}

// ---- public API ---------------------------------------------------------

function build(repo, opts = {}) {
  const { now, halfLifeDays, maxSymbols, minCount } = resolvedOpts(opts);
  const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const commits = {};
  for (const sha of listCommits(repo)) commits[sha] = commitEntry(repo, sha);
  const overlay = assemble(repo, { head, now, halfLifeDays, maxSymbols, minCount, commits });
  writeOverlay(repo, overlay);
  return overlay;
}

function update(repo, opts = {}) {
  const overlayPath = path.join(repo, "graphify-out", "cochange.json");
  let existing;
  try { existing = JSON.parse(fs.readFileSync(overlayPath, "utf8")); } catch { return build(repo, opts); }

  const { now, halfLifeDays, maxSymbols, minCount } = resolvedOpts(opts);
  const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const commits = { ...existing.commits };
  for (const sha of listCommits(repo)) {
    if (sha in commits) continue;
    commits[sha] = commitEntry(repo, sha);
    if (typeof opts.onCommit === "function") opts.onCommit(sha);
  }
  const overlay = assemble(repo, { head, now, halfLifeDays, maxSymbols, minCount, commits });
  writeOverlay(repo, overlay);
  return overlay;
}

function pair(ov, a, b) { return ov.pairs[pairKey(a, b)]; }

function isStructural(ov, a, b) { return (ov.links || []).includes(pairKey(a, b)); }

function neighbours(ov, id, opts = {}) {
  const minCount = opts.minCount ?? (ov.opts && ov.opts.minCount) ?? 2;

  const symbolMatches = [];
  for (const [key, p] of Object.entries(ov.pairs || {})) {
    if (p.count < minCount) continue;
    const [a, b] = key.split("|");
    if (a !== id && b !== id) continue;
    const other = a === id ? b : a;
    symbolMatches.push({
      id: other, support: p.support, count: p.count, confidence: p.confidence[id],
      lift: p.lift, last: p.last, level: "symbol", structural: isStructural(ov, id, other),
    });
  }
  if (symbolMatches.length) return symbolMatches.sort((x, y) => y.confidence - x.confidence);

  const pkg = (ov.nodes || {})[id]?.package;
  if (!pkg) return [];
  const pkgMatches = [];
  for (const [key, p] of Object.entries(ov.packagePairs || {})) {
    const [a, b] = key.split("|");
    if (a !== pkg && b !== pkg) continue;
    const other = a === pkg ? b : a;
    pkgMatches.push({ package: other, support: p.support, count: p.count, confidence: p.confidence[pkg], lift: p.lift, last: p.last, level: "package" });
  }
  return pkgMatches.sort((x, y) => y.confidence - x.confidence);
}

// ---- CLI --------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { out[a.slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);
  const repo = args.repo || process.cwd();
  if (cmd === "build") {
    const ov = build(repo, {});
    console.log(`cochange: built ${Object.keys(ov.commits).length} commits, ${Object.keys(ov.pairs).length} pairs, ${Object.keys(ov.packagePairs).length} package pairs -> graphify-out/cochange.json`);
    return;
  }
  if (cmd === "update") {
    const existed = fs.existsSync(path.join(repo, "graphify-out", "cochange.json"));
    let added = 0;
    const ov = existed ? update(repo, { onCommit: () => { added++; } }) : build(repo, {});
    console.log(`cochange: ${existed ? `updated +${added}` : "built"} ${Object.keys(ov.commits).length} commits, ${Object.keys(ov.pairs).length} pairs -> graphify-out/cochange.json`);
    return;
  }
  console.error("usage: cochange.cjs build|update --repo R");
  process.exit(1);
}

module.exports = { build, update, pair, neighbours };

if (require.main === module) main();
