---
name: nord-execute
description: "Execution router: parallel batch (Workflow), sequential (/loop or ralph), optional /goal-gate. Use for 'execute this batch', 'run this work-list', 'apply X across N files'. Not for exploratory work needing judgment."

---

# nord-exec — execution router (parallel | sequential | goal-gated)

Pick the execution strategy by work shape. Do NOT default-spawn ad-hoc; choose one mode.

## Step 0 — (optional) goal-gate with `/goal`
If the END STATE must provably match intent (refactor must keep tests green, migration must
leave zero old-API calls), first define a **`/goal`** with concrete success criteria. The native
goal evaluator then verifies convergence after execution. Use when "done" is objectively checkable.

## Step 1 — classify the work, pick a mode

| Work shape | Mode | Tool |
|---|---|---|
| Known work-list, N **independent** items (disjoint files), mechanical | **Parallel** | the Workflow below (per-item implement→verify, resumable) |
| One thread, iterate-until-done, light/no state | **Sequential** | core **`/loop`** (self-paced) driving the task |
| One thread, needs persistence/resume/cancel + verify loop | **Sequential-heavy** | **ralph** |
| Needs coordination / shared state across workers | — | **team** (defer, not nord-exec) |
| Full idea→code autonomy | — | **autopilot** (defer) |

## Step 2 — run

**Parallel** → invoke the Workflow tool with the script below. Pass `args.items =
[{id, task, files?}]`. Items MUST touch disjoint files (parallel agents edit the real repo;
overlapping files = conflicts → run those sequentially instead). Set `args.isolate=true` only for
risky same-file work (runs each in a worktree — changes do NOT auto-merge; you merge manually).

**Sequential** → run `/loop` with the task prompt (omit interval for self-paced), or invoke `ralph`
for the persistent/verified variant. Stop when the goal/criteria are met.

## Step 3 — verify
Confirm against the `/goal` (if set) or the success criteria before claiming done.

**Per-item deterministic gate (preferred).** Give an item a `gate` = a single command whose exit code
is the verdict (`{id, task, files?, gate:"pytest -q tests/test_x.py"}`). The batch then runs that
command and treats **exit 0 = pass**, non-zero = **fail** (no LLM judge — see
`../gate-loop/references/gate-pattern.md`). A gated item that fails is returned with
`escalate:"gate-loop"` — hand it to the `gate-loop` skill (cheap worker + gate + frontier escalation)
rather than retrying blindly here. An item with **no `gate` is marked `unverified`**, never reported as
green. Gated verify uses a `qwen3.6-plus` runner → needs CC launched through the bridge (see
`../../WORKERS.md`); without a bridge, pass items without `gate` (they'll be `unverified`).

```javascript
export const meta = {
  name: 'nord-exec',
  description: 'Deterministic parallel batch executor (implement -> per-item gate: exit code, else UNVERIFIED)',
  phases: [
    { title: 'Execute', detail: 'one agent per work item' },
    { title: 'Verify', detail: 'confirm each item works' },
  ],
}
const items = (args && args.items) || []
const isolate = !!(args && args.isolate)   // default false: edit real repo (disjoint files)
if (!items.length) { log('nord-exec: pass args.items = [{id, task, files?}]'); return { error: 'no items' } }
const R = { type:'object', properties:{ done:{type:'boolean'}, summary:{type:'string'}, filesTouched:{type:'array', items:{type:'string'}} }, required:['done','summary'] }
// gated verify = exit code is the verdict (no LLM judge). Gateless = UNVERIFIED, never a false green.
const G = { type:'object', properties:{ exitCode:{type:'number'}, tail:{type:'string'} }, required:['exitCode'] }
const results = await pipeline(
  items,
  (it) => agent(`Implement this task fully and correctly:\n${it.task}\n${it.files ? ('Likely files: ' + JSON.stringify(it.files)) : ''}\nMake the actual edits. Report what you did and which files you touched.`,
    { label:`exec:${it.id||''}`, phase:'Execute', schema:R, ...(isolate ? { isolation:'worktree' } : {}) }),
  (res, it) => {
    if (it.gate) {  // deterministic gate: run the command, exit code = verdict (gate-pattern.md)
      return agent(`Run EXACTLY this command and report only its result — do NOT fix anything:\n${it.gate}\nReturn {exitCode (the shell exit status), tail (last ~15 lines of output)}.`,
        { label:`gate:${it.id||''}`, phase:'Verify', schema:G, model:'qwen3.6-plus' })
        .then(g => { const ok = !!g && g.exitCode === 0
          return { id: it.id, ...res, gate: it.gate, status: ok ? 'pass' : 'fail', exitCode: g && g.exitCode, gateTail: g && g.tail } })
    }
    return Promise.resolve({ id: it.id, ...res, status: 'unverified' })  // no gate -> not a green
  }
)
const flat = results.filter(Boolean)
const failed = flat.filter(r => r.status === 'fail')         // gate red -> hand to gate-loop
const unverified = flat.filter(r => r.status === 'unverified')
return {
  total: items.length,
  passed: flat.filter(r => r.status === 'pass').length,
  failed: failed.map(f => ({ id:f.id, exitCode:f.exitCode, tail:f.gateTail, escalate:'gate-loop' })),
  unverified: unverified.map(u => u.id),
  results: flat,
}
```

## Execution discipline (adopted)
Grafted from subagent-driven-development / executing-plans / claude-mem:do:
- **Durable progress ledger.** Write completed items to `$(git rev-parse --git-path nord-exec)/progress.md`
  so a resume after `/compact` does NOT re-dispatch done tasks (keeper had no resume-safety).
- **Two-stage review when no deterministic gate.** First spec-compliance, then code-quality — richer
  fallback than pass/fail when an item has no `gate` (instead of just UNVERIFIED).
- **File-based handoffs.** Pass task-brief / report / review-diff as files, not pasted into the controller
  context, to keep it clean on big batches.
- **Per-role model.** Cheapest tier ($0 bridge worker) for mechanical 1-2 file transcription; capable
  model for review/design. State the model explicitly per role.
- **Never implement on main/master** without explicit user consent — branch first.
- **Pre-flight + stop-and-ask.** Review the plan critically first; on a blocker (missing dep, unclear
  instruction, repeated verify-fail) STOP and ask, don't guess.
- **Anti-pattern grep + source-citing.** After a phase, grep for the plan's known-bad patterns; copy
  patterns from docs and verify an API exists before assuming it.
