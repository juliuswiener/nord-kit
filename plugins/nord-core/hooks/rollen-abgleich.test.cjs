#!/usr/bin/env node
// rollen-abgleich.test.cjs — do the texts a worker reads name only what its role may call?
// Run: node rollen-abgleich.test.cjs   (from plugins/nord-core, or by path)
//
// orch gives each preset a fixed set of tools. A text that tells a worker to use a tool its
// preset lacks is worse than no text: the worker follows it, the call fails, and nothing says
// why (orch_tui internal/preset/preset.go:22-29). One case per known text, C1..C15; the ids
// are those of the ticket "rollen-und-skilltexte-nennen-werkzeuge-die-die-rolle-nicht-aufrufen-darf".
//
// ponytail: RIGHTS is still a hand copy of orch_tui's presets. D2 holds it to rollen-abgleich.preset-rights.tsv
// (a verbatim cp of orch_tui's golden table), D1 holds that copy to the source file. `edit` is not read from
// the table: it lists Edit/Write as allowed for read-only roles too (the scratch place). "table = code" is
// orch_tui's TestThePresetRightsMatchTheTableOnFile. Upgrade path: orch exports the table as JSON.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const HOOK = path.join(__dirname, "nord-router.js");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// What each orch preset may call. src = where the right is decided (orch_tui/internal/...).
const RIGHTS = {
  reviewer:    { edit: false, shell: false, skill: false, workflow: false, web: true,  src: "preset/preset.go:344 DefaultPolicy; permit/policy.go:221" },
  researcher:  { edit: false, shell: false, skill: true,  workflow: false, web: true,  src: "preset/preset.go:360, researchPolicy 324-328" },
  expert:      { edit: false, shell: false, skill: false, workflow: false, web: true,  src: "preset/preset.go:433 DefaultPolicy" },
  implementer: { edit: true,  shell: true,  skill: true,  workflow: false, web: true,  src: "preset/preset.go:380; permit/policy.go:339-341" },
  debugger:    { edit: true,  shell: true,  skill: true,  workflow: false, web: true,  src: "preset/preset.go:396" },
  qualifier:   { edit: true,  shell: true,  skill: true,  workflow: true,  web: true,  src: "preset/preset.go:410, qualifierPolicy 330-339" },
};
// ---- the table: a verbatim copy of orch_tui's golden file (cp, never typed) ----
const TSV = path.join(__dirname, "rollen-abgleich.preset-rights.tsv");
const TSV_SOURCE = process.env.ORCH_PRESET_RIGHTS_TSV ||
  path.join(os.homedir(), "00_projects/169_orch_tui/orch_tui/internal/router/testdata/preset-rights.tsv");
const table = {}; // table[preset][tool] = true when the row says allowed
for (const l of fs.readFileSync(TSV, "utf8").split("\n").filter(Boolean)) {
  const [p, t, v] = l.split("\t");
  (table[p] = table[p] || {})[t] = v === "allowed";
}
const EXA_AGENT = "mcp__plugin_exa_exa__agent_run"; // billed per run: denied to every role
// RIGHTS key -> the rows that must all be allowed for the preset to hold it. `edit` is not here (ponytail above).
const ROWS = {
  skill: ["Skill"], workflow: ["Workflow"], shell: ["mcp__plugin_nord-core_t__Bash"],
  web: ["WebSearch", "WebFetch"], exa: ["mcp__plugin_exa_exa__web_search_exa", "mcp__plugin_exa_exa__web_fetch_exa"],
};
const holds = (preset, right) => ROWS[right].every((t) => (table[preset] || {})[t] === true);
const anyLacks = (right) => Object.values(RIGHTS).some((r) => !r[right]);

// Known and open elsewhere; may only get shorter. reviewer + skill rows: the decision gives the
// reviewer the Skill right, orch_tui builds it (backlog rollenkarten-zeigen-werkzeuge-...).
const KNOWN_OPEN = [{ id: "K1", name: "reviewer x skill rows (ROUTING.md:43)" }];
const MAX_KNOWN_OPEN = 1;

function render(env) {
  const base = { ...process.env };
  delete base.ORCH_CAN_SPAWN;
  const r = spawnSync("node", [HOOK], { env: { ...base, ...env }, encoding: "utf8", input: JSON.stringify({ source: "startup" }) });
  if (r.status !== 0) throw new Error(`hook exit ${r.status}: ${r.stderr}`);
  return r.stdout;
}
const worker = render({});
const instructor = render({ ORCH_CAN_SPAWN: "1" });

let red = 0;
let total = 0;
let skipped = 0;
function kase(id, name, ok, detail = []) {
  total++;
  console.log(`${ok ? "ok  " : "FAIL"} ${id} ${name}`);
  if (!ok) { red++; for (const d of detail) console.log(`       ${d}`); }
}

// "- Needs `Skill`: ..." / "- Needs a shell: ..." / "- Needs `Workflow` (reason): ..."
function needs(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^- Needs (`Skill`|a shell|`Workflow`)(?: \(([^)]*)\))?: (.+)$/.exec(line);
    if (m) out[m[1]] = { reason: m[2] || "", rows: m[3] };
  }
  return out;
}
const N = needs(worker);

// ---- C1..C4: the router names what each row needs (ROUTING.md:41-53) ----
kase("C1", "skill rows need `Skill`; expert has none (ROUTING.md:41-53)",
  !anyLacks("skill") || (N["`Skill`"] && /skill row/.test(N["`Skill`"].rows)));
for (const [id, row, line] of [["C2", "bin/context", 48], ["C3", "verify", 49], ["C4", "interactive", 51]]) {
  kase(id, `\`${row}\` needs a shell; reviewer, researcher, expert have none (ROUTING.md:${line})`,
    !anyLacks("shell") || (N["a shell"] && N["a shell"].rows.includes("`" + row + "`")));
}

// ---- C5..C8: fan-out modes need Workflow, in the router and in the skill's own reference ----
const NEED_SENTENCE = /Needs the Workflow tool in your tool list\./;
const NO_RETRY = /do not retry/;
function refNamesNeed(rel) {
  const head = read(rel).split("\n").slice(0, 40).join("\n");
  return NEED_SENTENCE.test(head) && NO_RETRY.test(head);
}
for (const [id, mode, files] of [
  ["C5", "plan", ["skills/plan/references/plan.md"]],
  ["C6", "research", ["skills/research/references/codebase.md"]],
  ["C7", "cleanup --remove", ["skills/cleanup/references/remove.md"]],
  ["C8", "review --deep", ["skills/review/references/diff-deep.md", "skills/review/references/repo-deep.md"]],
]) {
  const inRouter = !anyLacks("workflow") || (N["`Workflow`"] && N["`Workflow`"].rows.includes("`" + mode + "`"));
  kase(id, `${mode}: the router and ${files.map((f) => path.basename(f)).join(" + ")} say it needs Workflow`,
    Boolean(inRouter) && files.every(refNamesNeed));
}
// C9: a worker never reads the instructor-only block, so the router must give the reason itself.
kase("C9", "worker router says who holds Workflow (ROUTING.md:35-36 is instructor-only)",
  Boolean(N["`Workflow`"]) && /only the instructor and the qualifier/.test(N["`Workflow`"].reason));

// ---- C10..C12: agent cards vs presets (agents/*.md:4) ----
function cardClaims(name) {
  const text = read(`agents/${name}.md`);
  const tools = (/^tools:\s*(.+)$/m.exec(text) || [, ""])[1];
  const denied = (/^disallowedTools:\s*(.+)$/m.exec(text) || [, ""])[1];
  return {
    shell: tools.includes("mcp__plugin_nord-core_t__Bash"),
    skill: tools.includes("Skill"),
    edit: /\b(Edit|Write)\b/.test(tools) && !/\b(Edit|Write)\b/.test(denied),
    text,
  };
}
const CARD_IDS = { reviewer: "C10", researcher: "C11", expert: "C12" };
for (const name of ["reviewer", "researcher", "expert", "implementer", "debugger"]) {
  const card = cardClaims(name);
  const claimsMore = ["shell", "skill", "edit"].some((r) => card[r] && !RIGHTS[name][r]);
  const noted = card.text.includes(`In orch the preset \`${name}\` sets your tools, not this list.`) &&
    /skip/.test(card.text);
  kase(CARD_IDS[name] || `C10-12:${name}`,
    `agents/${name}.md ${claimsMore ? "claims more than the preset gives, so it says the preset rules in orch" : "claims no more than the preset gives"}`,
    !claimsMore || noted);
}

// ---- C13, C14: the role table (instructor-only) ----
function roleTable(text) {
  const rows = {};
  for (const line of text.split("\n")) {
    const m = /^\| .+? \| `(\w+)` \| (.+) \|$/.exec(line);
    if (m && RIGHTS[m[1]]) rows[m[1]] = m[2];
  }
  return rows;
}
const R = roleTable(instructor);
const claimsOf = (rights) => ["edit", "shell", "web", "skill", "workflow"].filter((r) => new RegExp(`\\b${r}\\b`, "i").test(rights));
const falseClaim = Object.keys(R).some((p) => claimsOf(R[p]).some((r) => !RIGHTS[p][r]));
kase("C13", "role table: no row claims a right its preset lacks, and reviewer/expert name `web` (ROUTING.md:10,14)",
  !falseClaim && ["reviewer", "expert"].every((p) => R[p] && /\bweb\b/i.test(R[p])));
kase("C14", "role table has a row for every preset, qualifier included, naming Workflow (ROUTING.md:8-14)",
  Object.keys(RIGHTS).every((p) => R[p]) && Boolean(R.qualifier) && /Workflow/.test(R.qualifier));

// ---- C15: a row must not name its own default in "Do NOT use" (ROUTING.md:46) ----
function toolRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!/^\| \*\*/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    if (cells.length === 4) rows.push(cells);
  }
  return rows;
}
// A parser that finds nothing makes every check above pass for the wrong reason.
kase("S1", "the parsers found the role rows (>=5) and the Tool rows (>=10)",
  Object.keys(R).length >= 5 && toolRows(instructor).length >= 10);
const dupes = toolRows(instructor).filter(([, def, , dont]) => {
  const name = ((/`([^`]+)`/.exec(def) || [, ""])[1]).trim();
  return name && dont.split(/[,·]/).map((i) => i.replace(/`/g, "").trim()).includes(name);
});
kase("C15", "no Tool row lists its own default under Do NOT use (ROUTING.md:46)", dupes.length === 0);

// ---- S3, D1..D5: the kit against the table copy ----
// A parser that finds nothing makes D2..D4 pass for the wrong reason.
const NOTE = /A step that needs (.+?) is skipped/;
kase("S3", "the table copy has every preset and every row D2/D3 look up, and the three orch notes are found",
  Object.keys(RIGHTS).every((p) => [...Object.values(ROWS).flat(), EXA_AGENT].every((t) => t in (table[p] || {}))) &&
  ["reviewer", "researcher", "expert"].every((n) => NOTE.test(read(`agents/${n}.md`))));
// D1: the source not being here must be said, never passed over in silence.
if (fs.existsSync(TSV_SOURCE)) {
  kase("D1", "rollen-abgleich.preset-rights.tsv equals orch_tui's preset-rights.tsv (stale: cp it, then redo D2..D5)",
    fs.readFileSync(TSV).equals(fs.readFileSync(TSV_SOURCE)), [`cp ${TSV_SOURCE} ${TSV}`]);
} else {
  skipped++;
  console.log(`skip D1 orch_tui source not found at ${TSV_SOURCE}: drift of the copy NOT checked`);
}
const drift = [];
for (const p of Object.keys(RIGHTS)) for (const r of Object.keys(ROWS)) {
  const kit = Boolean(RIGHTS[p][r]);
  if (kit !== holds(p, r)) drift.push(`${p}: ${r} kit=${kit} table=${holds(p, r)}`);
}
kase("D2", "RIGHTS (skill, workflow, shell, web, exa) equals the table copy for every preset", drift.length === 0, drift);
const billed = Object.keys(table).filter((p) => table[p][EXA_AGENT] !== false);
kase("D3", "the table copy denies the billed Exa agent (agent_run) to every role", billed.length === 0,
  billed.map((p) => `${p}: agent_run is not denied`));
const lies = [];
for (const name of ["reviewer", "researcher", "expert", "implementer", "debugger"]) { // the roles that have a card
  const m = NOTE.exec(read(`agents/${name}.md`));
  if (!m) continue; // implementer, debugger: no note, they hold what their card lists
  for (const [right, re] of [["shell", /\bshell\b/], ["skill", /\bSkill\b/], ["workflow", /\bWorkflow\b/]])
    if (re.test(m[1]) && holds(name, right)) lies.push(`agents/${name}.md says a step needing ${right} may be skipped; the table gives ${name} ${right}`);
}
kase("D4", "a card's orch note names a missing right only where the table denies it to that role", lies.length === 0, lies);
// D5: the cards list the Exa pair exactly for the roles the table gives it to, never the billed agent.
const cardExa = [];
for (const name of ["reviewer", "researcher", "expert", "implementer", "debugger"]) {
  const tools = (/^tools:\s*(.+)$/m.exec(read(`agents/${name}.md`)) || [, ""])[1];
  for (const x of ROWS.exa) if (tools.includes(x) !== (table[name][x] === true))
    cardExa.push(`agents/${name}.md tools: ${tools.includes(x) ? "lists" : "lacks"} ${x}; the table ${table[name][x] ? "allows" : "denies"} it to ${name}`);
  if (tools.includes(EXA_AGENT)) cardExa.push(`agents/${name}.md tools: lists the billed agent ${EXA_AGENT}`);
}
kase("D5", "a card lists the Exa search and fetch tools exactly for the roles the table gives them to, never the billed agent", cardExa.length === 0, cardExa);

// ---- known-open: counted, not red ----
kase("K0", `known-open list has at most ${MAX_KNOWN_OPEN} entr${MAX_KNOWN_OPEN === 1 ? "y" : "ies"}`, KNOWN_OPEN.length <= MAX_KNOWN_OPEN);
for (const k of KNOWN_OPEN) console.log(`open ${k.id} ${k.name}`);

console.log(`${total} cases, ${red} red, ${skipped} skipped, ${KNOWN_OPEN.length} known-open`);
process.exit(red ? 1 : 0);
