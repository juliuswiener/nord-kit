#!/usr/bin/env node
// edit-diag-batch.test.cjs — the edit-diag pair reports once per RESPONSE, not per edit.
// No framework. Run: node edit-diag-batch.test.cjs
//
// Calls the hooks the way Claude Code 2.1.296 does (measured 2026-10-12 in three
// `claude -p` runs): every edit of a response gets PreToolUse and PostToolUse in
// block order, then PostToolBatch fires ONCE with all calls. Which script runs on
// which event is read from hooks.json, so the registration is under test too;
// PostToolBatch ignores the matcher (measured: it fired for a batch of Reads).
// Real vscode-json-language-server, in-process (own TMPDIR, NORD_LSP_DAEMON=0).
// Needs dist/ built (cd mcp && npm run build).
// Vault: backlog nord/sprachserver-meldungen-kommen-veraltet-und-doppelt.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const HOOKS_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, "hooks.json"), "utf8")).hooks;

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${detail}`}`);
  if (!ok) failed++;
}

const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "edit-diag-batch-"));
const PROJ = fs.mkdtempSync(path.join(TMP, "proj-"));
const ENV = { ...process.env, TMPDIR: TMP, NORD_LSP_DAEMON: "0" };
const SID = `s-${process.pid}`;
const BROKEN = '{"a": 1 "b": 2}\n'; // "Expected comma"

// Every edit-diag command registered for the event, run with the payload; returns
// the additionalContext texts.
function fire(event, toolName, payload, env) {
  const out = [];
  for (const group of HOOKS_JSON[event] || []) {
    const m = group.matcher;
    if (event !== "PostToolBatch" && m && m !== "*" && !new RegExp(`^(?:${m})$`).test(toolName)) continue;
    for (const h of group.hooks) {
      if (!h.command.includes("edit-diag")) continue;
      const cmd = h.command.replace("${CLAUDE_PLUGIN_ROOT}", ROOT);
      const r = spawnSync("bash", ["-c", cmd], { input: JSON.stringify(payload), env, encoding: "utf8", timeout: 120000 });
      try { out.push(JSON.parse(r.stdout).hookSpecificOutput.additionalContext); } catch { /* silent */ }
    }
  }
  return out;
}

const perEdit = []; // everything PostToolUse said, over the whole run
const base = (prompt) => ({ session_id: SID, transcript_path: "/dev/null", cwd: PROJ, prompt_id: prompt });
const file = (name) => path.join(PROJ, name);

// One response: each edit is [name, newText] (Pre, write, Post), or [name, null, "failed"]
// for a call rejected by input validation (no Pre, no Post, an error in the batch).
function response(prompt, edits, env = ENV, { batch = true } = {}) {
  const calls = [];
  edits.forEach(([name, text, failedCall], i) => {
    const call = { tool_name: "Edit", tool_use_id: `${prompt}-${i}`, tool_input: { file_path: file(name), old_string: "o", new_string: "n" } };
    if (failedCall) {
      calls.push({ ...call, tool_response: "<tool_use_error>String to replace not found in file.</tool_use_error>" });
      return;
    }
    fire("PreToolUse", "Edit", { ...base(prompt), hook_event_name: "PreToolUse", ...call }, env);
    fs.writeFileSync(file(name), text);
    perEdit.push(...fire("PostToolUse", "Edit", { ...base(prompt), hook_event_name: "PostToolUse", ...call, tool_response: {} }, env));
    calls.push({ ...call, tool_response: "ok" });
  });
  if (!batch) return [];
  return fire("PostToolBatch", "", { ...base(prompt), hook_event_name: "PostToolBatch", tool_calls: calls }, env);
}

const names = (texts, name) => texts.filter((t) => t.includes(name));
const show = (x) => JSON.stringify(x);

check("vscode-json-language-server is installed", spawnSync("bash", ["-c", "command -v vscode-json-language-server"]).status === 0, "install it, or nothing below is checked");

// AK2: broken by the first edit, repaired by the second: the response ends clean.
fs.writeFileSync(file("x.json"), '{"a": 1}\n');
const r2 = response("p2", [["x.json", BROKEN], ["x.json", '{"a": 1, "b": 3}\n']]);
check("AK2 an error the same response repaired is not reported", names([...r2, ...perEdit], "x.json").length === 0, show([...r2, ...perEdit]));

// AK3: the response ends broken: one report, after the batch.
fs.writeFileSync(file("z.json"), '{"a": 1}\n');
const r3 = response("p3", [["z.json", '{"a": 2}\n'], ["z.json", '{"a": 2 "c": 1}\n']]);
check("AK3 an error in the end state is reported once, after the batch",
  r3.length === 1 && /z\.json:1:\d+ \S+ Expected comma/.test(r3[0]) && /introduced 1 new error/.test(r3[0]), show(r3));

// AK5: the first edit breaks, the second keeps the break: compared with the state
// before the FIRST edit, so it is new.
fs.writeFileSync(file("w.json"), '{"a": 1}\n');
const r5 = response("p5", [["w.json", BROKEN], ["w.json", '{"a": 5 "b": 2}\n']]);
check("AK5 the baseline is the state before the first edit", names(r5, "w.json").length === 1, show(r5));

// AK6: two files broken in one response: one report names both.
fs.writeFileSync(file("u1.json"), '{"a": 1}\n');
fs.writeFileSync(file("u2.json"), '{"a": 1}\n');
const r6 = response("p6", [["u1.json", BROKEN], ["u2.json", BROKEN]]);
check("AK6 one report names every broken file", r6.length === 1 && r6[0].includes("u1.json") && r6[0].includes("u2.json"), show(r6));

// AK7 (guard): a call rejected by input validation changed nothing; the file's old
// error is not reported.
fs.writeFileSync(file("v.json"), BROKEN);
const r7 = response("p7", [["v.json", null, "failed"]]);
check("AK7 an edit rejected before it ran reports nothing", names(r7, "v.json").length === 0, show(r7));

// AK8 (guard): a batch that never reported (interrupted) leaves its slot. The next
// prompt's baseline is the state before ITS first edit, not that old slot.
fs.writeFileSync(file("s.json"), '{"a": 1}\n');
response("p8a", [["s.json", BROKEN]], ENV, { batch: false });
const r8 = response("p8b", [["s.json", '{"a": 7 "b": 2}\n']]);
check("AK8 a slot from an earlier prompt is not the baseline", names(r8, "s.json").length === 0, show(r8));

// AK4: "not checked" once per session and file, saying that silence is no all-clear;
// the first answer after it says the file is checked again, then silence again.
const SLOW = { ...ENV, NORD_EDIT_DIAG_BUDGET_MS: "1" };
fs.writeFileSync(file("y.json"), '{"y": 1}\n');
const before4 = perEdit.length;
const r4a = response("p4a", [["y.json", '{"y": 2}\n']], SLOW);
const r4b = response("p4b", [["y.json", '{"y": 3}\n']], SLOW);
const unchecked = names([...r4a, ...r4b, ...perEdit.slice(before4)], "y.json").filter((t) => /not checked/.test(t));
check("AK4 'not checked' comes exactly once per session and file", unchecked.length === 1, show(unchecked));
check("AK4 and says silence is no all-clear",
  /Further edits to y\.json in this session stay unchecked until the server answers; silence about y\.json is not an all-clear\./.test(unchecked[0] || ""), show(unchecked));
const r4c = response("p4c", [["y.json", '{"y": 4}\n']]);
check("AK4 the first answer after it says the file is checked again", names(r4c, "y.json").length === 1 && /y\.json is checked again/.test(r4c.join("\n")), show(r4c));
const r4d = response("p4d", [["y.json", '{"y": 5}\n']]);
check("AK4 then silence again", names(r4d, "y.json").length === 0, show(r4d));

// AK9: the report keeps its own time limit below the hook timeout, so a slow batch
// ends with "not checked" for the files it did not reach, never with silence.
fs.writeFileSync(file("t1.json"), '{"t": 1}\n');
fs.writeFileSync(file("t2.json"), '{"t": 1}\n');
const r9 = response("p9", [["t1.json", '{"t": 2}\n'], ["t2.json", '{"t": 2}\n']], { ...ENV, NORD_EDIT_DIAG_REPORT_MS: "1" });
check("AK9 a file beyond the report's time limit is 'not checked', the first is checked",
  names(r9, "t2.json").some((t) => /not checked/.test(t)) && !names(r9, "t1.json").some((t) => /not checked/.test(t)), show(r9));

// AK1: nothing is reported per edit.
check("AK1 no report per edit (PostToolUse)", perEdit.length === 0, show(perEdit));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nedit-diag-batch: all ok");
process.exit(failed ? 1 : 0);
