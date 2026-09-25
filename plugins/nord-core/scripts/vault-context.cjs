#!/usr/bin/env node
// vault-context.cjs — pulls a short "Entscheidungen und Vorgeschichte" section from the
// knowledge vault (~/00_projects/vault) into an implementer work package: full-text
// search over the auftrag, plus decisions whose applies_to matches a package file,
// merged and deduped (applies_to ranks above search). Vault: a git repo of markdown
// notes with YAML frontmatter (title, project, repo, commit, type, applies_to).
//
// Historical replay (work-package dispatch against an old commit) needs the vault
// content AS IT WAS at that point, not today's — a note written after the replayed
// commit that documents its own fix must not leak the answer in. `before` (unix
// seconds) resolves each note to the vault commit in effect at that time instead of
// the working tree; a note that did not exist yet there (including one only reachable
// under a later rename) is skipped, not backdated to empty.
//
// Vault: backlog/nord/implementierer-paket-aus-dem-graphen (AP-vault).
//
// vaultContext({ auftrag, repo, files, before, maxTokens = 1500 }) -> { notes, markdown }

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// ponytail: one vault, not a per-call setting — matches the rest of the harness, where
// the vault path is a fixed convention.
const VAULT = path.join(os.homedir(), "00_projects", "vault");
const SEARCH_BIN = path.join(VAULT, "bin", "search");

const PREFERRED_SECTIONS = ["Worum es geht", "Entschieden", "Was aufgefallen ist"];
const EXCERPT_CHARS = 350 * 4; // ~350 tokens, chars/4 like work-package's own budget

// ---- frontmatter ------------------------------------------------------------

// Single-line "key: value" and "key: [json array]" frontmatter, the only shapes the
// vault's own notes use (checked: no multi-line applies_to array exists). A trailing
// `  # comment` after a value is stripped; array values are valid JSON as written.
function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { front: {}, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { front: {}, body: text };
  const front = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2];
    if (val.startsWith("[")) {
      const close = val.indexOf("]");
      try { front[m[1]] = close === -1 ? [] : JSON.parse(val.slice(0, close + 1)); }
      catch { front[m[1]] = []; }
      continue;
    }
    const hash = val.indexOf(" #");
    if (hash !== -1) val = val.slice(0, hash);
    front[m[1]] = val.trim().replace(/^"(.*)"$/, "$1");
  }
  return { front, body: text.slice(end + 5) };
}

// ---- applies_to glob ---------------------------------------------------------

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
    else if (c === "*") re += "[^/]*";
    else if ("+.^${}()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}

function matchesAny(globs, files) {
  return (globs || []).some((g) => { const re = globToRegExp(g); return files.some((f) => re.test(f)); });
}

// ---- excerpt --------------------------------------------------------------

function sectionBody(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^##\\s+${escaped}\\s*$`, "m");
  const m = re.exec(body);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

// Title + first ~350 tokens of the body, preferring the section a worker actually
// wants (the "what/why" headings) over whatever comes first (Kontext, a belegt-durch
// dump, ...). Exported so a test can reproduce a historical excerpt directly from a
// `git show <sha>:<path>` blob without going through vaultContext.
function excerptOf(content, maxChars = EXCERPT_CHARS) {
  const { front, body } = parseFrontmatter(content);
  const title = front.title || "";
  let picked = null;
  for (const h of PREFERRED_SECTIONS) { picked = sectionBody(body, h); if (picked) break; }
  if (!picked) picked = body.replace(/^#[^\n]*\n/, "").trim();
  const budget = Math.max(0, maxChars - title.length - 2);
  if (picked.length > budget) picked = picked.slice(0, budget);
  return title ? `${title}\n\n${picked}` : picked;
}

// ---- note content, working tree or historical ------------------------------

function readWorkingTree(relPath) {
  return fs.readFileSync(path.join(VAULT, relPath), "utf8");
}

// Content of a note as of the last vault commit before `before` (unix seconds), or
// null if the note did not yet exist at this exact path then. A note only reachable
// under a later rename (the ticket -> backlog/archive move) is null here too: the
// path git log is run against is the current one, and no commit touched it yet.
function historicalContent(relPath, before) {
  const sha = execFileSync(
    "git", ["-C", VAULT, "log", `--before=@${before}`, "-1", "--format=%H", "--", relPath],
    { encoding: "utf8" },
  ).trim();
  if (!sha) return null;
  return execFileSync("git", ["-C", VAULT, "show", `${sha}:${relPath}`], { encoding: "utf8" });
}

function contentAt(relPath, before) {
  return before === undefined || before === null ? readWorkingTree(relPath) : historicalContent(relPath, before);
}

// ---- candidates -------------------------------------------------------------

function searchCandidates(auftrag) {
  if (!auftrag || !auftrag.trim()) return [];
  const raw = execFileSync(SEARCH_BIN, ["--json", "--limit", "12", auftrag], { encoding: "utf8" });
  return JSON.parse(raw).map((r) => r.path);
}

function decisionFiles() {
  return fs.readdirSync(path.join(VAULT, "decisions"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => `decisions/${f}`);
}

// Eligibility (repo/project, applies_to) is read off the CURRENT frontmatter — only
// existence and excerpt content go through the `before` filter. Only decisions/*.md,
// per spec; backlog/audits/etc. never carry applies_to and are search-only.
function appliesToCandidates(repo, files) {
  if (!files || !files.length) return [];
  const repoBase = path.basename(repo);
  const out = [];
  for (const rel of decisionFiles()) {
    let front;
    try { front = parseFrontmatter(readWorkingTree(rel)).front; } catch { continue; }
    if (front.repo !== repo && front.project !== repoBase) continue;
    if (!matchesAny(front.applies_to, files)) continue;
    out.push(rel);
  }
  return out;
}

// ---- budget: drop lowest-ranked notes first, truncate the last survivor ----

function renderNotes(notes) {
  if (!notes.length) return "";
  const L = ["## Entscheidungen und Vorgeschichte"];
  for (const n of notes) L.push("", `### ${n.path} (${n.source})`, "", n.excerpt);
  return L.join("\n") + "\n";
}

function fitToBudget(notes, maxTokens) {
  const cap = maxTokens * 4;
  const list = notes.slice();
  let md = renderNotes(list);
  while (list.length > 1 && md.length > cap) { list.pop(); md = renderNotes(list); }
  if (list.length === 1 && md.length > cap) {
    const overhead = md.length - list[0].excerpt.length;
    list[0] = { ...list[0], excerpt: list[0].excerpt.slice(0, Math.max(0, cap - overhead)) };
    md = renderNotes(list);
  }
  return { notes: list, markdown: list.length ? md : "" };
}

// ---- entry point ------------------------------------------------------------

function vaultContext({ auftrag, repo, files = [], before, maxTokens = 1500 }) {
  try {
    const applies = appliesToCandidates(repo, files);
    let search = [];
    try { search = searchCandidates(auftrag); } catch { search = []; }

    const seen = new Set();
    const ranked = [];
    for (const rel of applies) if (!seen.has(rel)) { seen.add(rel); ranked.push({ path: rel, source: "applies_to" }); }
    for (const rel of search) if (!seen.has(rel)) { seen.add(rel); ranked.push({ path: rel, source: "search" }); }

    const notes = [];
    for (const cand of ranked) {
      let content;
      try { content = contentAt(cand.path, before); } catch { content = null; }
      if (content === null) continue;
      const { front } = parseFrontmatter(content);
      if (front.type === "ticket") continue;
      notes.push({
        path: cand.path,
        title: front.title || path.basename(cand.path, ".md"),
        source: cand.source,
        excerpt: excerptOf(content),
      });
    }

    return fitToBudget(notes, maxTokens);
  } catch {
    return { notes: [], markdown: "" };
  }
}

module.exports = { vaultContext, excerptOf, parseFrontmatter, matchesAny, VAULT };
