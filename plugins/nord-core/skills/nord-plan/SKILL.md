---
name: nord-plan
description: "Parallel planning tournament: N lens-planners draft, judges score with on/off-task gate, synth winner + best-of-rest. Use for 'plan this with options', 'multi-agent plan', 'parallel plan'. Complements ralplan (sequential consensus)."

---

# nord-plan — parallel planning tournament

Invoking this skill IS opt-in to multi-agent orchestration. Run the Workflow tool with the
script below. Pass the task as `args.task` (fall back to the conversation).

**When NOT to use:** for a tightly-scoped refactor in a rich/active repo (dirty working tree,
many recently-touched files), the free multi-lens exploration tends to drift onto the most
salient local artifact instead of your task — prefer `ralplan` (sequential, focused) or direct
authoring. nord-plan shines on an OPEN solution space ("how should we approach X"), not on
"plan this precise change".

Why over ralplan: ralplan runs ONE plan through sequential Planner→Architect→Critic debate.
nord-plan explores the solution space in parallel, then synthesizes — better when the right
approach is not obvious.

The result is **pending approval** — hand off to `ralph`/`team` for execution.

> Anti-drift design (planners anchor on salient repo state, not the task): every draft must
> restate the task + name out-of-scope items first; the judge hard-gates off-task drafts to 0
> BEFORE scoring quality; synthesis re-checks the winner matches the task. If your `args.task`
> mentions a file only as an illustration, tag it `[EXAMPLE, not the target]`.

```javascript
export const meta = {
  name: 'nord-plan',
  description: 'Parallel multi-approach planning tournament (on/off-task gated)',
  phases: [
    { title: 'Draft', detail: 'parallel planners, different lenses' },
    { title: 'Judge', detail: 'on/off-task gate + quality score' },
    { title: 'Synthesize', detail: 'merge winner + best of rest' },
  ],
}
const task = (args && args.task) || 'the task described in the conversation'
const GUARD = `Plan ONLY the task above. IGNORE unrelated working-tree changes, recently-modified files, and prominent artifacts that are NOT named in the task. A file named only as an illustration is NOT the target. If your plan addresses anything other than the task heading, you are OFF-TASK and have failed.`
const LENSES = [
  { key:'mvp-first',          prompt:'Simplest path to working value. Minimize scope, ship fast, defer the rest.' },
  { key:'risk-first',         prompt:'Surface the highest risks/unknowns first and de-risk them early. Favor robustness.' },
  { key:'architecture-first', prompt:'Clean long-term design, the right abstractions and boundaries, maintainability.' },
]
const PLAN_SCHEMA = { type:'object', properties:{
  taskRestatement:{type:'string', description:'the task in ONE sentence, your own words'},
  outOfScope:{type:'array', items:{type:'string'}, description:'2-3 things explicitly NOT part of this task'},
  summary:{type:'string'}, steps:{type:'array', items:{type:'string'}},
  risks:{type:'array', items:{type:'string'}}, tradeoffs:{type:'string'} },
  required:['taskRestatement','outOfScope','summary','steps'] }
const SCORE_SCHEMA = { type:'object', properties:{
  onTask:{type:'boolean', description:'true ONLY if the plan addresses the requested task, not some other repo concern'},
  onTaskReason:{type:'string'},
  score:{type:'number', description:'0-10 quality, ASSUMING on-task'} },
  required:['onTask','onTaskReason','score'] }

const drafts = await parallel(LENSES.map(l => () =>
  agent(`TASK: ${task}\n\nFIRST: restate the task in one sentence (taskRestatement) and list 2-3 outOfScope items. THEN draft an implementation plan.\nLens: ${l.key} — ${l.prompt}\n${GUARD}\nGround steps in the actual codebase, but stay on the task.`,
        { label:`draft:${l.key}`, phase:'Draft', schema:PLAN_SCHEMA })
    .then(p => ({ lens:l.key, plan:p }))))
const valid = drafts.filter(Boolean).filter(d => d.plan)

const scored = await parallel(valid.map(d => () =>
  agent(`TASK (the ONLY thing that counts as on-task): ${task}\n\nStep 1 — BINARY GATE: does this plan address THE TASK above, or did it drift onto a different repo concern (a dirty-tree change, a recently-touched file, a salient artifact)? Set onTask=false if it addresses anything other than the task. An off-task plan is worthless no matter how good.\nStep 2 — only if on-task, score quality 0-10.\nPlan (${d.lens}): restatement="${d.plan.taskRestatement}" | ${JSON.stringify(d.plan)}`,
        { label:`judge:${d.lens}`, phase:'Judge', schema:SCORE_SCHEMA })
    .then(s => ({ ...d, onTask:!!(s&&s.onTask), score:(s&&s.score)||0, eff:(s&&s.onTask)?((s&&s.score)||0):0, review:s }))))

scored.sort((a,b) => b.eff - a.eff)
const winner = scored[0]
if (!winner || winner.eff === 0) {
  return { error: 'all drafts off-task or zero — task likely too narrow for nord-plan; use ralplan or author directly', ranked: scored.map(s => ({ lens:s.lens, onTask:s.onTask, score:s.score, reason:s.review&&s.review.onTaskReason })) }
}
const onTaskPlans = scored.filter(s => s.onTask)
const final = await agent(`Synthesize ONE final implementation plan for THIS TASK: ${task}\n\nGUARD: the final plan MUST address the task above. Before writing, confirm the winning plan matches the task heading — if it drifted, correct it to address the actual task, do NOT carry the drift forward.\nBase it on the winning "${winner.lens}" plan, grafting the best ideas from the other ON-TASK approaches. Note key tradeoffs. Mark it pending approval.\nWinner: ${JSON.stringify(winner.plan)}\nOther on-task plans: ${JSON.stringify(onTaskPlans.slice(1).map(s => ({ lens:s.lens, score:s.score, plan:s.plan })))}`,
      { label:'synthesize', phase:'Synthesize', schema:PLAN_SCHEMA })
return { winningLens: winner.lens, ranked: scored.map(s => ({ lens:s.lens, onTask:s.onTask, score:s.score, eff:s.eff })), plan: final }
```
