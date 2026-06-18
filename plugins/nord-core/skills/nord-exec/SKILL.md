---
name: nord-exec
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

```javascript
export const meta = {
  name: 'nord-exec',
  description: 'Deterministic parallel batch executor (implement -> verify per item)',
  phases: [
    { title: 'Execute', detail: 'one agent per work item' },
    { title: 'Verify', detail: 'confirm each item works' },
  ],
}
const items = (args && args.items) || []
const isolate = !!(args && args.isolate)   // default false: edit real repo (disjoint files)
if (!items.length) { log('nord-exec: pass args.items = [{id, task, files?}]'); return { error: 'no items' } }
const R = { type:'object', properties:{ done:{type:'boolean'}, summary:{type:'string'}, filesTouched:{type:'array', items:{type:'string'}} }, required:['done','summary'] }
const V = { type:'object', properties:{ passed:{type:'boolean'}, reason:{type:'string'} }, required:['passed','reason'] }
const results = await pipeline(
  items,
  (it) => agent(`Implement this task fully and correctly:\n${it.task}\n${it.files ? ('Likely files: ' + JSON.stringify(it.files)) : ''}\nMake the actual edits. Report what you did and which files you touched.`,
    { label:`exec:${it.id||''}`, phase:'Execute', schema:R, ...(isolate ? { isolation:'worktree' } : {}) }),
  (res, it) => agent(`Verify the change for task "${it.task}" actually works — build/test/inspect the relevant files. passed=false if incomplete, broken, or not done. Implementer report: ${JSON.stringify(res)}`,
    { label:`verify:${it.id||''}`, phase:'Verify', schema:V })
    .then(v => ({ id: it.id, ...res, verify: v }))
)
const flat = results.filter(Boolean)
const failed = flat.filter(r => !(r.verify && r.verify.passed))
return { total: items.length, passed: flat.length - failed.length, failed: failed.map(f => ({ id:f.id, reason: f.verify && f.verify.reason })), results: flat }
```
