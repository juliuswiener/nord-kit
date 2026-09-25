#!/usr/bin/env node
// work-package.cjs — builds an implementer's work package from the code graph, so a
// worker starts from deterministic findings instead of re-searching the repo itself.
// Dispatch: resolve graph questions -> entry nodes -> neighbours -> tree-sitter
// extraction -> markdown. Check: diff the working tree against the package's commit
// and report drift (unread findings, reads/edits outside the package, re-reads).
// Vault: backlog/nord/implementierer-paket-aus-dem-graphen.
//
// CLI:
//   work-package.cjs dispatch --repo R [--commit C] (--questions F | "<auftrag>")
//                     [--out DIR] [--budget N]
//   work-package.cjs check --repo R [--out DIR] [--diff PATCHFILE] <run>
//   work-package.cjs decompose --repo R "<auftrag>"      (prints {symbols,terms,subsystems})

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync, spawnSync } = require("child_process");

// ---- shared helpers -------------------------------------------------------

const bareLabel = (label) => String(label).replace(/^\./, "").replace(/\(\)$/, "");

function isTestFile(relpath) {
  return /_test\.go$/.test(relpath)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(relpath)
    || /(^|\/)test_[^/]+\.py$/.test(relpath)
    || /_test\.py$/.test(relpath);
}

function lineNum(node) {
  const m = /(\d+)/.exec(node.source_location || "");
  return m ? parseInt(m[1], 10) : 0;
}

function subsystemOf(file) {
  const i = file.lastIndexOf("/");
  return i === -1 ? "." : file.slice(0, i);
}

// Deterministic tie-break for an ambiguous exact-label match: same-named method on
// several types (common here, a Router-shaped interface with many implementers).
// Non-test files first, then the alphabetically-first source file, then line, then id.
function cmpCandidate(a, b) {
  if (a.source_file !== b.source_file) return a.source_file < b.source_file ? -1 : 1;
  const d = lineNum(a) - lineNum(b);
  if (d) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---- graph ------------------------------------------------------------

function loadGraph(repo) {
  const raw = fs.readFileSync(path.join(repo, "graphify-out", "graph.json"), "utf8");
  const data = JSON.parse(raw);
  const nodesById = new Map();
  const codeNodes = [];
  for (const n of data.nodes) {
    nodesById.set(n.id, n);
    if (n.file_type === "code") codeNodes.push(n);
  }
  const adjacency = new Map(); // id -> [{other, relation, confidence, out, loc}]
  const addEdge = (from, other, relation, confidence, out, loc) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ other, relation, confidence, out, loc });
  };
  for (const l of data.links) {
    addEdge(l.source, l.target, l.relation, l.confidence, true, l.source_location);
    addEdge(l.target, l.source, l.relation, l.confidence, false, l.source_location);
  }
  return { nodesById, codeNodes, adjacency, builtAtCommit: data.built_at_commit };
}

// ---- entry-symbol resolution (AK2: unknown/empty questions drop silently) ------

// The type a method node hangs off (graphify: type -method-> method), or null.
function receiverOf(graph, node) {
  for (const e of graph.adjacency.get(node.id) || []) {
    if (e.relation !== "method") continue;
    const owner = graph.nodesById.get(e.other);
    if (owner && !/\(\)$/.test(owner.label)) return owner;
  }
  return null;
}

// One symbol question -> one node. "Type.Method" resolves through the receiver. A bare
// name that several nodes carry (Overview: 12 in orch_tui) prefers non-test files, then
// the subsystems the order expects, then the old deterministic tie-break — the plain
// alphabetical pick sent Overview to internal/bus on the first real run.
function resolveSymbol(graph, sym, subsystems) {
  const dot = sym.lastIndexOf(".");
  const [type, name] = dot > 0 ? [sym.slice(0, dot), sym.slice(dot + 1)] : [null, sym];
  let candidates = graph.codeNodes.filter((n) => bareLabel(n.label) === name);
  if (type) candidates = candidates.filter((n) => bareLabel((receiverOf(graph, n) || {}).label || "") === type);
  if (!candidates.length) return null; // unknown symbol -> silently dropped
  const nonTest = candidates.filter((n) => !isTestFile(n.source_file));
  let pool = nonTest.length ? nonTest : candidates;
  const expected = pool.filter((n) => matchesSubsystem(subsystemOf(n.source_file), subsystems || []));
  if (expected.length) pool = expected;
  return pool.slice().sort(cmpCandidate)[0];
}

function resolveEntries(graph, symbols, terms, subsystems) {
  const picked = new Map(); // id -> node
  for (const sym of symbols || []) {
    if (typeof sym !== "string" || !sym.trim()) continue;
    const node = resolveSymbol(graph, sym.trim(), subsystems);
    if (node) picked.set(node.id, node);
  }
  for (const term of terms || []) {
    if (typeof term !== "string" || !term.trim()) continue; // empty term -> silently dropped
    const t = term.toLowerCase();
    // Tests never enter aendern through a search term ("deadlock" hit TestTroubleNoDeadlock).
    const candidates = graph.codeNodes.filter((n) => !isTestFile(n.source_file)
      && bareLabel(n.label).toLowerCase().includes(t));
    candidates.sort(cmpCandidate);
    for (const c of candidates.slice(0, 5)) picked.set(c.id, c);
  }
  return [...picked.values()];
}

// The receiver type of a method in aendern joins aendern: a method change that alters
// locking or state usually alters the struct's fields too, and the decomposition names
// the methods, never the type (94cab77: Haiku named Deliver/Interrupt in 3 of 3 runs,
// Agent in 0, and Agent's writeMu field was what changed).
// ponytail: every receiver joins; aendernOhneAenderung in the check measures how often
// the type was dragged in for nothing — narrow the rule if that number is high.
function withReceivers(graph, entryNodes) {
  const out = new Map(entryNodes.map((n) => [n.id, n]));
  for (const n of entryNodes) {
    const owner = receiverOf(graph, n);
    if (owner && owner.file_type === "code") out.set(owner.id, owner);
  }
  return [...out.values()];
}

const toItem = (node) => ({ id: node.id, symbol: node.label, file: node.source_file, line: lineNum(node) });

// ---- neighbour tiers (wahrscheinlich = depth 1 strong, pruefen = depth 2 / inferred-only) --

const STRUCT_RELATIONS = new Set([
  "calls", "method", "references", "imports", "imports_from", "extends", "embeds", "indirect_call",
]);
const WAHR_CAP = 40; // ponytail: fixed caps, not tuned against real worker outcomes yet
const PRUEF_CAP = 80;

function neighboursOf(graph, ids, relations) {
  const result = new Map(); // id -> {viaExtracted, viaInferred}
  for (const id of ids) {
    for (const e of graph.adjacency.get(id) || []) {
      if (!relations.has(e.relation)) continue;
      const cur = result.get(e.other) || { viaExtracted: false, viaInferred: false };
      if (e.confidence === "EXTRACTED") cur.viaExtracted = true; else cur.viaInferred = true;
      result.set(e.other, cur);
    }
  }
  return result;
}

function neighbourTiers(graph, entryNodes) {
  const entryIds = new Set(entryNodes.map((n) => n.id));
  const isEligible = (id) => {
    const n = graph.nodesById.get(id);
    return n && n.file_type === "code" && !isTestFile(n.source_file) && !entryIds.has(id);
  };

  const depth1 = neighboursOf(graph, [...entryIds], STRUCT_RELATIONS);
  const depth1Ids = [...depth1.keys()].filter(isEligible);
  const wahrIds = new Set(depth1Ids.filter((id) => depth1.get(id).viaExtracted));
  const inferredOnlyIds = depth1Ids.filter((id) => !wahrIds.has(id));

  const depth2 = neighboursOf(graph, [...wahrIds], STRUCT_RELATIONS);
  const depth2Ids = [...depth2.keys()].filter((id) => isEligible(id) && !wahrIds.has(id));

  const wahr = [...wahrIds].map((id) => graph.nodesById.get(id)).sort(cmpCandidate).slice(0, WAHR_CAP);
  const pruefIds = new Set([...inferredOnlyIds, ...depth2Ids]);
  const pruef = [...pruefIds].map((id) => graph.nodesById.get(id)).sort(cmpCandidate).slice(0, PRUEF_CAP);

  return { wahrscheinlich: wahr.map(toItem), pruefen: pruef.map(toItem) };
}

// ---- subsystem abgleich: strong deviation (aendern) -> feedback; weak (wahrscheinlich) -> hint --

function matchesSubsystem(subsystemPath, expected) {
  const low = subsystemPath.toLowerCase();
  return expected.some((e) => low.includes(String(e).toLowerCase()));
}

function deviation(aendernItems, wahrItems, subsystems) {
  const feedback = [];
  const hints = [];
  if (!subsystems || !subsystems.length) return { feedback, hints }; // nothing expected -> nothing to compare
  const mismatched = new Map(); // subsystem -> count
  for (const it of aendernItems) {
    const sub = subsystemOf(it.file);
    if (!matchesSubsystem(sub, subsystems)) mismatched.set(sub, (mismatched.get(sub) || 0) + 1);
  }
  for (const [subsystem, weight] of mismatched) feedback.push({ subsystem, coupling: "aendern", weight });
  for (const it of wahrItems) {
    const sub = subsystemOf(it.file);
    if (!matchesSubsystem(sub, subsystems))
      hints.push(`Wahrscheinlich betroffen in ${sub} (${it.symbol}) liegt außerhalb der erwarteten Subsysteme.`);
  }
  return { feedback, hints };
}

// ---- tree-sitter extraction via ast-grep --------------------------------

const AST_GREP_LANG = { go: "Go", ts: "TypeScript", tsx: "Tsx", js: "JavaScript", py: "Python", rs: "Rust" };
// ponytail: only the Go path is exercised by the gates; the rest is best-effort for
// when this tool meets a non-Go repo, upgrade as those repos show up.
const DECL_KINDS = {
  go: ["function_declaration", "method_declaration", "type_declaration"],
  ts: ["function_declaration", "method_definition", "class_declaration", "interface_declaration", "type_alias_declaration"],
  tsx: ["function_declaration", "method_definition", "class_declaration", "interface_declaration", "type_alias_declaration"],
  js: ["function_declaration", "method_definition", "class_declaration"],
  py: ["function_definition", "class_definition"],
  rs: ["function_item", "struct_item", "enum_item", "trait_item"],
};

function langFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".go") return "go";
  if (ext === ".ts") return "ts";
  if (ext === ".tsx") return "tsx";
  if (ext === ".js" || ext === ".jsx") return "js";
  if (ext === ".py") return "py";
  if (ext === ".rs") return "rs";
  return null;
}

function declName(text) {
  let m;
  if ((m = /^func\s*(?:\([^)]*\)\s*)?(\w+)/.exec(text))) return m[1];
  if ((m = /^type\s+(\w+)/.exec(text))) return m[1];
  if ((m = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/.exec(text))) return m[1];
  if ((m = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/.exec(text))) return m[1];
  if ((m = /^(?:export\s+)?interface\s+(\w+)/.exec(text))) return m[1];
  if ((m = /^(?:export\s+)?type\s+(\w+)/.exec(text))) return m[1];
  if ((m = /^(?:async\s+)?def\s+(\w+)/.exec(text))) return m[1];
  if ((m = /^class\s+(\w+)/.exec(text))) return m[1];
  if ((m = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/.exec(text))) return m[1];
  if ((m = /^(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/.exec(text))) return m[1];
  return null;
}

// All top-level declarations in one file's content, one ast-grep call. Kept name-less
// on the rule (no --inline-rules "has: field name" filter) so one call answers both
// "what declarations exist" (diff attribution) and "find this name" (extraction).
function astGrepDeclarations(content, langKey) {
  const kinds = DECL_KINDS[langKey];
  const agLang = AST_GREP_LANG[langKey];
  if (!kinds || !agLang || !content) return [];
  const rule = `id: extract\nlanguage: ${agLang}\nrule:\n  any:\n${kinds.map((k) => `    - kind: ${k}`).join("\n")}\n`;
  let out;
  try {
    out = execFileSync("ast-grep", ["scan", "--stdin", "--inline-rules", rule, "--json=compact"],
      { input: content, encoding: "utf8", maxBuffer: 1 << 28 });
  } catch { return []; }
  let matches;
  try { matches = JSON.parse(out || "[]"); } catch { return []; }
  return matches
    .map((m) => ({ start: m.range.start.line + 1, end: m.range.end.line + 1, text: m.text, name: declName(m.text) }))
    .filter((d) => d.name);
}

// One git show + one ast-grep call for every name requested in this file (spec: batch
// per file for speed). Returns {name: text}; missing names are simply absent.
function extractSymbolsBatch(repo, commit, file, names) {
  const langKey = langFor(file);
  const result = {};
  if (!langKey || !names.length) return result;
  let content;
  try { content = execFileSync("git", ["-C", repo, "show", `${commit}:${file}`], { encoding: "utf8", maxBuffer: 1 << 28 }); }
  catch { return result; } // file didn't exist at this commit
  const wanted = new Set(names);
  const lines = content.split("\n");
  const prefix = langKey === "py" ? "#" : "//";
  for (const d of astGrepDeclarations(content, langKey)) {
    if (!wanted.has(d.name) || d.name in result) continue; // first declaration wins
    // The comment block right above belongs to the declaration: pkg3 read the comments
    // over pipes.write by hand. Kept only if the joined text is still verbatim (a
    // type_spec starts mid-line, after `type `).
    let i = d.start - 1;
    while (i > 0 && lines[i - 1].trim().startsWith(prefix)) i--;
    const withDoc = i < d.start - 1 ? lines.slice(i, d.start - 1).join("\n") + "\n" + d.text : d.text;
    result[d.name] = content.includes(withDoc) ? withDoc : d.text;
  }
  return result;
}

function extractSymbol(repo, commit, file, name) {
  return extractSymbolsBatch(repo, commit, file, [name])[name] || null;
}

function signatureOf(text) {
  const idx = text.indexOf("{");
  return idx === -1 ? text.split("\n")[0] : text.slice(0, idx + 1);
}

// The file in `file`'s directory that declares type `name` at `commit`, or null.
// ponytail: Go only (`type Name `); other languages keep the graph's file.
function typeHome(repo, commit, file, name) {
  if (!file.endsWith(".go")) return null;
  const r = spawnSync("git", ["-C", repo, "grep", "-l", "-E", `^type ${name}[ \\[]`, commit, "--",
    `${path.posix.dirname(file)}/*.go`], { encoding: "utf8" });
  const hit = (r.stdout || "").split("\n").map((l) => l.slice(commit.length + 1)).find((f) => f && !isTestFile(f));
  return hit || null;
}

function extractCodeForItems(repo, commit, aendernItems, wahrItems) {
  const wantedByFile = new Map(); // file -> Set(name)
  for (const it of [...aendernItems, ...wahrItems]) {
    if (!wantedByFile.has(it.file)) wantedByFile.set(it.file, new Set());
    wantedByFile.get(it.file).add(bareLabel(it.symbol));
  }
  const extracted = new Map(); // file -> {name: text}
  for (const [file, names] of wantedByFile) extracted.set(file, extractSymbolsBatch(repo, commit, file, [...names]));
  // graphify puts a type node into every file that declares methods on it, so a
  // receiver (Router via Router.Overview) can point at overview.go while the struct
  // sits in router.go. Not found where the graph says -> look in the same package.
  for (const it of [...aendernItems, ...wahrItems]) {
    const name = bareLabel(it.symbol);
    if (extracted.get(it.file)?.[name] || /\(\)$/.test(it.symbol)) continue;
    const home = typeHome(repo, commit, it.file, name);
    if (!home) continue;
    if (!extracted.has(home)) extracted.set(home, {});
    Object.assign(extracted.get(home), extractSymbolsBatch(repo, commit, home, [name]));
    if (extracted.get(home)[name]) it.file = home;
  }
  for (const it of aendernItems) {
    const text = extracted.get(it.file)?.[bareLabel(it.symbol)];
    if (text) it.code = text;
  }
  for (const it of wahrItems) {
    const text = extracted.get(it.file)?.[bareLabel(it.symbol)];
    if (text && it.full) it.code = text;
    else if (text) it.signature = signatureOf(text);
  }
}

// ---- diff parsing (shared by changedSymbols and `check`) -----------------

const stripAB = (p) => p.replace(/^[ab]\//, "");

function parseDiffFiles(diffText) {
  const files = new Set();
  const lines = diffText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("--- ") && lines[i + 1] && lines[i + 1].startsWith("+++ ")) {
      const oldP = lines[i].slice(4).trim();
      const newP = lines[i + 1].slice(4).trim();
      const pick = newP !== "/dev/null" ? newP : oldP;
      if (pick !== "/dev/null") files.add(stripAB(pick));
    }
  }
  return [...files];
}

function parseDiffHunks(diffText) {
  const map = new Map(); // file -> [{oldStart, oldCount}]
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
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(l);
    if (m && curFile) {
      const oldStart = parseInt(m[1], 10);
      const oldCount = m[2] !== undefined ? parseInt(m[2], 10) : 1;
      if (!map.has(curFile)) map.set(curFile, []);
      map.get(curFile).push({ oldStart, oldCount });
    }
  }
  return map;
}

// ponytail: a pure insertion (oldCount 0) has no old-side line of its own; treat it as
// touching the line it was inserted after/before, not as spanning the whole file.
function touchRange(h) {
  return h.oldCount === 0 ? [Math.max(1, h.oldStart), h.oldStart + 1] : [h.oldStart, h.oldStart + h.oldCount - 1];
}

// Per file touched by the diff: which declarations (as they stood at baseCommit) have a
// line range overlapping an old-side hunk. A comment-only hunk outside any declaration's
// span contributes nothing, because it never overlaps one.
function declarationsTouchedByDiff(repo, baseCommit, diffText, { includeTestFiles = false } = {}) {
  const result = new Map(); // file -> Set(name)
  for (const [file, hunks] of parseDiffHunks(diffText)) {
    if (!includeTestFiles && isTestFile(file)) continue;
    let content;
    try { content = execFileSync("git", ["-C", repo, "show", `${baseCommit}:${file}`], { encoding: "utf8", maxBuffer: 1 << 28 }); }
    catch { continue; } // file did not exist at baseCommit (new file) -> nothing to attribute
    const langKey = langFor(file);
    if (!langKey) continue;
    const names = new Set();
    for (const d of astGrepDeclarations(content, langKey)) {
      for (const h of hunks) {
        const [hs, he] = touchRange(h);
        if (d.start <= he && d.end >= hs) { names.add(d.name); break; }
      }
    }
    if (names.size) result.set(file, names);
  }
  return result;
}

function changedSymbols(repo, commit) {
  const diffText = execFileSync("git", ["-C", repo, "diff", "-U0", `${commit}~1`, commit], { encoding: "utf8", maxBuffer: 1 << 28 });
  const touched = declarationsTouchedByDiff(repo, `${commit}~1`, diffText, { includeTestFiles: false });
  const names = new Set();
  for (const set of touched.values()) for (const n of set) names.add(n);
  return [...names];
}

// ---- package assembly ------------------------------------------------------

function fileHashes(repo, items) {
  const files = {};
  for (const it of items) {
    if (files[it.file]) continue;
    try {
      files[it.file] = crypto.createHash("sha256").update(fs.readFileSync(path.join(repo, it.file))).digest("hex");
    } catch { /* not in the working tree -> nothing to hash */ }
  }
  return files;
}

// Where a type in aendern gets built: a free, non-test function in the type's own
// package whose SIGNATURE names the type — the references edge sits on the function's
// declaration line. pkg3 read New() by hand because the package carried Agent but not
// where its new field is initialised. Of 57 references to Agent, 30 come from a
// signature and exactly one (New) passes all four conditions.
// ponytail: the graph does not tell parameter from return type, so a same-package
// helper `f(a *Agent)` rides along too; add a New*/new* name check if that turns
// out to be noise (aendernOhneAenderung, packagedLines).
function constructorsOf(graph, entryNodes) {
  const out = new Map();
  for (const t of entryNodes) {
    if (/\(\)$/.test(t.label)) continue; // types only
    for (const e of graph.adjacency.get(t.id) || []) {
      if (e.relation !== "references" || e.out) continue;
      const f = graph.nodesById.get(e.other);
      if (!f || f.file_type !== "code" || isTestFile(f.source_file) || f.label.startsWith(".")) continue;
      if (e.loc !== f.source_location) continue;
      if (subsystemOf(f.source_file) !== subsystemOf(t.source_file)) continue;
      out.set(f.id, f);
    }
  }
  return [...out.values()];
}

// Co-change neighbours (AP12) for the aendern tier: a symbol pair that reliably changes
// together in git history but carries no edge in graph.json is exactly what the static
// graph misses. Read-only here — cochange.json is built/updated separately by
// cochange.cjs, never from inside a dispatch.
function applyCochange(repo, graph, entryNodes, tiers) {
  const ccPath = path.join(repo, "graphify-out", "cochange.json");
  if (!fs.existsSync(ccPath)) return [];
  let overlay;
  try { overlay = JSON.parse(fs.readFileSync(ccPath, "utf8")); } catch { return []; }

  const cc = require("./cochange.cjs");
  const placedIds = new Set([...tiers.aendern, ...tiers.wahrscheinlich, ...tiers.pruefen].map((i) => i.id));
  const hints = [];
  for (const entry of entryNodes) {
    const neigh = cc.neighbours(overlay, entry.id, {}).filter((n) => n.level === "symbol" && n.confidence >= 0.3 && n.count >= 2);
    for (const n of neigh) {
      const node = graph.nodesById.get(n.id);
      if (!node || node.file_type !== "code" || isTestFile(node.source_file)) continue;
      // Both ends already in aendern: the worker changes both anyway, a hint says nothing.
      if (entryNodes.some((e) => e.id === n.id)) continue;
      if (!n.structural) {
        hints.push(`Co-Change ohne Strukturkante: ${entry.label} <-> ${node.label} `
          + `(confidence ${n.confidence.toFixed(2)}, count ${n.count})`);
      }
      if (placedIds.has(n.id)) continue;
      placedIds.add(n.id);
      tiers.pruefen.push({ ...toItem(node), via: "cochange" });
    }
  }
  return hints;
}

function buildPackage({ repo, commit = "HEAD", questions = {}, budgetTokens = 12000, cochange = true }) {
  const sha = execFileSync("git", ["-C", repo, "rev-parse", commit], { encoding: "utf8" }).trim();
  const graph = loadGraph(repo);

  const entryNodes = withReceivers(graph, resolveEntries(graph, questions.symbols, questions.terms, questions.subsystems));
  const aendern = entryNodes.map(toItem);
  let { wahrscheinlich, pruefen } = neighbourTiers(graph, entryNodes);

  // Symbols the order names as affected, not as change targets, go in with their
  // signature (first real run: 6 of 9 aendern entries were only ever read).
  const aendernIds = new Set(entryNodes.map((n) => n.id));
  const affected = (questions.affected || [])
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => resolveSymbol(graph, s.trim(), questions.subsystems))
    .filter((n) => n && !aendernIds.has(n.id));
  const affectedIds = new Set(affected.map((n) => n.id));
  wahrscheinlich = [...affected.map(toItem), ...wahrscheinlich.filter((i) => !affectedIds.has(i.id))];
  pruefen = pruefen.filter((i) => !affectedIds.has(i.id));

  const ctorIds = new Set(constructorsOf(graph, entryNodes).map((n) => n.id));
  wahrscheinlich = [...[...ctorIds].map((id) => ({ ...toItem(graph.nodesById.get(id)), full: true })),
    ...wahrscheinlich.filter((i) => !ctorIds.has(i.id))];
  pruefen = pruefen.filter((i) => !ctorIds.has(i.id));

  const ccHints = cochange ? applyCochange(repo, graph, entryNodes, { aendern, wahrscheinlich, pruefen }) : [];

  extractCodeForItems(repo, sha, aendern, wahrscheinlich);
  const { feedback, hints: devHints } = deviation(aendern, wahrscheinlich, questions.subsystems);
  const hints = [...devHints, ...ccHints];

  const pkg = { commit: sha, graphCommit: graph.builtAtCommit, tiers: { aendern, wahrscheinlich, pruefen }, feedback, hints, files: {} };

  // Budget: cut from the bottom. aendern is never cut.
  const overBudget = () => renderMarkdown(pkg).length / 4 > budgetTokens;
  if (overBudget()) {
    pkg.tiers.pruefen = [];
    if (overBudget()) {
      for (const it of pkg.tiers.wahrscheinlich) { delete it.signature; delete it.code; }
      if (overBudget()) pkg.tiers.wahrscheinlich = [];
    }
  }

  // Only aendern/wahrscheinlich carry content the worker was already handed; pruefen is a
  // path+symbol pointer, so a read of it is not a re-read and the guard must not gate it.
  pkg.files = fileHashes(repo, [...pkg.tiers.aendern, ...pkg.tiers.wahrscheinlich]);
  pkg.ranges = codeRanges(repo, pkg.tiers.aendern);
  return pkg;
}

// 1-based inclusive line spans of the full code aendern carries, located in the working
// tree at dispatch. The Read guard refuses a ranged read wholly inside one: the worker
// already holds those lines. Code not found verbatim (tree differs from the commit)
// gets no span, so the guard lets that read through.
function codeRanges(repo, items) {
  const ranges = {};
  const texts = {};
  for (const it of items) {
    if (!it.code) continue;
    try { texts[it.file] ??= fs.readFileSync(path.join(repo, it.file), "utf8"); } catch { continue; }
    const at = texts[it.file].indexOf(it.code);
    if (at < 0) continue;
    const start = texts[it.file].slice(0, at).split("\n").length;
    (ranges[it.file] ??= []).push([start, start + it.code.split("\n").length - 1]);
  }
  return ranges;
}

const LANG_FENCE = { go: "go", ts: "ts", tsx: "tsx", js: "js", py: "python", rs: "rust" };
const fenceFor = (file) => LANG_FENCE[langFor(file)] || "";

function renderMarkdown(pkg) {
  const L = [];
  L.push("# Arbeitspaket", "");
  L.push(`Stand: ${pkg.commit}, Extraktion per tree-sitter (ast-grep)`, "");
  L.push("Startpunkte, nicht vollständig. Diese Stellen nicht erneut lesen. Wenn etwas fehlt, gezielt per Graph-Tool nachfragen.", "");

  L.push("## Ändern");
  for (const it of pkg.tiers.aendern) {
    L.push("", `### ${it.symbol} — ${it.file}:${it.line}`);
    if (it.code) L.push("```" + fenceFor(it.file), it.code, "```");
  }

  L.push("", "## Wahrscheinlich betroffen");
  for (const it of pkg.tiers.wahrscheinlich) {
    L.push("", `### ${it.symbol} — ${it.file}:${it.line}`);
    const snippet = it.code || it.signature;
    if (snippet) L.push("```" + fenceFor(it.file), snippet, "```");
  }

  L.push("", "## Prüfen");
  for (const it of pkg.tiers.pruefen) L.push(`- ${it.symbol} — ${it.file}:${it.line}`);

  L.push("", "## Hinweise");
  for (const h of pkg.hints) L.push(`- ${h}`);

  L.push("", "## Rückmeldung");
  for (const f of pkg.feedback) L.push(`- ${f.subsystem}: ${f.coupling}, Gewicht ${f.weight}`);

  return L.join("\n") + "\n";
}

// ---- check: diff the package's commit against the working tree -----------

function computeMetrics(repo, pkg, reads, diffText) {
  const filesInDiff = parseDiffFiles(diffText);
  const touchedMap = declarationsTouchedByDiff(repo, pkg.commit, diffText, { includeTestFiles: true });
  const pkgFiles = new Set(Object.keys(pkg.files || {}));

  const tierSymbolsByFile = new Map(); // file -> Set(bareSymbol)
  for (const it of [...pkg.tiers.aendern, ...pkg.tiers.wahrscheinlich, ...pkg.tiers.pruefen]) {
    if (!tierSymbolsByFile.has(it.file)) tierSymbolsByFile.set(it.file, new Set());
    tierSymbolsByFile.get(it.file).add(bareLabel(it.symbol));
  }

  const aendernOhneAenderung = [];
  for (const it of pkg.tiers.aendern) {
    const touched = touchedMap.get(it.file);
    if (!touched || !touched.has(bareLabel(it.symbol))) aendernOhneAenderung.push(it.symbol);
  }

  const aenderungenAusserhalb = [];
  for (const f of filesInDiff) {
    if (!pkgFiles.has(f)) { aenderungenAusserhalb.push(f); continue; }
    const touched = touchedMap.get(f) || new Set();
    const known = tierSymbolsByFile.get(f) || new Set();
    for (const name of touched) if (!known.has(name)) aenderungenAusserhalb.push(`${f}:${name}`);
  }

  const readCounts = new Map();
  for (const r of reads) readCounts.set(r.file, (readCounts.get(r.file) || 0) + 1);
  const leseZugriffeAusserhalb = [...readCounts.keys()].filter((f) => !pkgFiles.has(f));
  const erneutGelesen = [...readCounts.entries()].filter(([f, c]) => pkgFiles.has(f) && c >= 2).map(([f]) => f);

  return { aendernOhneAenderung, aenderungenAusserhalb, leseZugriffeAusserhalb, erneutGelesen };
}

// ---- decompose: cheap-model call, turns an auftrag into graph questions ---

function decompose(auftrag) {
  // --bare and no tools: in the full harness Haiku sees CLAUDE.md and hooks and
  // answers with a clarifying question instead of JSON (measured 2026-09-24).
  // symbols vs affected: the first real run put every function the order MENTIONED
  // into symbols, and 6 of 9 aendern entries were then only ever read.
  const system = "Du zerlegst einen Code-Änderungsauftrag in Graph-Fragen. symbols = exakte "
    + "Funktions-, Methoden- oder Typnamen, deren Code geändert werden muss (ohne Receiver, "
    + "ohne Klammern; Typ.Methode nur bei Mehrdeutigkeit). affected = Namen, die der Auftrag "
    + "nur als betroffen, wartend oder Symptom nennt, aber nicht ändert. terms = kurze "
    + "Suchbegriffe für Stellen, deren Namen nicht im Auftrag stehen. subsystems = "
    + "Package-Namen, in denen die Änderung erwartet wird. Nur Namen, die im Auftrag stehen "
    + "oder zwingend aus ihm folgen.";
  const list = { type: "array", items: { type: "string" } };
  const schema = { type: "object", properties: { symbols: list, affected: list, terms: list, subsystems: list },
    required: ["symbols", "affected", "terms", "subsystems"] };
  const r = spawnSync("claude", ["-p", `Auftrag: ${auftrag}`, "--model", "haiku", "--bare",
    "--tools", "", "--system-prompt", system, "--json-schema", JSON.stringify(schema),
    "--output-format", "json"], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error("decompose failed: " + (r.stderr || "").slice(0, 300));
  const outer = JSON.parse(r.stdout);
  const inner = outer.structured_output || JSON.parse(outer.result);
  return { symbols: inner.symbols || [], affected: inner.affected || [], terms: inner.terms || [],
    subsystems: inner.subsystems || [] };
}

// ---- CLI --------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { out[a.slice(2)] = argv[i + 1]; i++; } else out._.push(a);
  }
  return out;
}

function cliDispatch(args, cochange) {
  const repo = args.repo;
  const commit = args.commit || "HEAD";
  const out = args.out || path.join(repo, ".nord", "work-package");
  const budgetTokens = args.budget ? parseInt(args.budget, 10) : 12000;
  const questions = args.questions
    ? JSON.parse(fs.readFileSync(args.questions, "utf8"))
    : decompose(args._[0] || "");

  const pkg = buildPackage({ repo, commit, questions, budgetTokens, cochange });
  const run = `run-${Date.now()}`;
  const runDir = path.join(out, run);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "package.json"), JSON.stringify(pkg, null, 2));
  fs.writeFileSync(path.join(runDir, "package.md"), renderMarkdown(pkg));
  fs.writeFileSync(path.join(out, "active"), run + "\n");
  console.log(run);
}

function cliCheck(args) {
  const repo = args.repo;
  const out = args.out || path.join(repo, ".nord", "work-package");
  const run = args._[0];
  const runDir = path.join(out, run);
  const pkg = JSON.parse(fs.readFileSync(path.join(runDir, "package.json"), "utf8"));

  let reads = [];
  try {
    reads = fs.readFileSync(path.join(runDir, "reads.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { /* no reads logged yet */ }

  const diffText = args.diff
    ? fs.readFileSync(args.diff, "utf8")
    : execFileSync("git", ["-C", repo, "diff", pkg.commit], { encoding: "utf8", maxBuffer: 1 << 28 });

  const metrics = computeMetrics(repo, pkg, reads, diffText);
  fs.writeFileSync(path.join(runDir, "metrics.json"), JSON.stringify(metrics, null, 2));

  try {
    if (fs.readFileSync(path.join(out, "active"), "utf8").trim() === run) fs.writeFileSync(path.join(out, "active"), "");
  } catch { /* no active pointer */ }
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  const noCochangeAt = rest.indexOf("--no-cochange");
  const cochange = noCochangeAt === -1;
  if (noCochangeAt !== -1) rest.splice(noCochangeAt, 1);
  const args = parseArgs(rest);
  if (cmd === "dispatch") return cliDispatch(args, cochange);
  if (cmd === "check") return cliCheck(args);
  if (cmd === "decompose") return console.log(JSON.stringify(decompose(args._[0] || "")));
  console.error("usage: work-package.cjs dispatch|check|decompose ...");
  process.exit(1);
}

module.exports = {
  loadGraph, buildPackage, renderMarkdown, changedSymbols, extractSymbol, decompose,
  astGrepDeclarations, langFor, isTestFile, bareLabel, subsystemOf,
};

if (require.main === module) main();
