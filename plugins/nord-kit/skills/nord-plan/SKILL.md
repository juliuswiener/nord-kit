---
name: nord-plan
description: Parallel multi-approach planning tournament — N planners draft independently through different lenses (MVP-first, risk-first, architecture-first), parallel judges score them, then one final plan is synthesized from the winner grafting the best ideas of the runners-up. Use for "plan this with options", "multi-agent plan", "parallel plan", "give me planning options". Complements ralplan (sequential consensus debate) with a parallel tournament.
---

# nord-plan — parallel planning tournament

Invoking this skill IS opt-in to multi-agent orchestration. Run the Workflow tool with the
script below. Pass the task description as `args.task` (fall back to the conversation).

Why this over ralplan: ralplan runs ONE plan through sequential Planner→Architect→Critic
debate. nord-plan explores the solution space in parallel (multiple independent approaches),
scores them, then synthesizes — better when the right approach is not obvious.

The result is a plan marked **pending approval** — do not execute it without explicit approval.
Hand off to `ralph` (sequential) or `team` (parallel) for execution.

```javascript
export const meta = {
  name: 'nord-plan',
  description: 'Parallel multi-approach planning tournament',
  phases: [
    { title: 'Draft', detail: 'parallel planners, different lenses' },
    { title: 'Judge', detail: 'parallel scoring' },
    { title: 'Synthesize', detail: 'merge winner + best of rest' },
  ],
}
const task = (args && args.task) || 'the task described in the conversation'
const LENSES = [
  { key:'mvp-first',          prompt:'Simplest path to working value. Minimize scope, ship fast, defer the rest.' },
  { key:'risk-first',         prompt:'Surface the highest risks/unknowns first and de-risk them early. Favor robustness.' },
  { key:'architecture-first', prompt:'Clean long-term design, the right abstractions and boundaries, maintainability.' },
]
const PLAN_SCHEMA = { type:'object', properties:{ summary:{type:'string'}, steps:{type:'array', items:{type:'string'}},
  risks:{type:'array', items:{type:'string'}}, tradeoffs:{type:'string'} }, required:['summary','steps'] }
const SCORE_SCHEMA = { type:'object', properties:{ score:{type:'number'}, strengths:{type:'string'}, weaknesses:{type:'string'} }, required:['score'] }

const drafts = await parallel(LENSES.map(l => () =>
  agent(`Draft an implementation plan for: ${task}\nLens: ${l.key} — ${l.prompt}\nGround steps in the actual codebase where possible. Be concrete.`,
        { label:`draft:${l.key}`, phase:'Draft', schema:PLAN_SCHEMA })
    .then(p => ({ lens:l.key, plan:p }))))
const valid = drafts.filter(Boolean).filter(d => d.plan)
const scored = await parallel(valid.map(d => () =>
  agent(`Score this plan 0-10 on correctness, feasibility, completeness, and risk-coverage. Give strengths and weaknesses. Plan (${d.lens}): ${JSON.stringify(d.plan)}`,
        { label:`judge:${d.lens}`, phase:'Judge', schema:SCORE_SCHEMA })
    .then(s => ({ ...d, score:(s && s.score) || 0, review:s }))))
scored.sort((a,b) => b.score - a.score)
const winner = scored[0]
const final = await agent(`Synthesize ONE final implementation plan for: ${task}\nBase it on the winning "${winner.lens}" plan, grafting the best ideas from the other approaches. Note key tradeoffs. Mark it pending approval.\nWinner: ${JSON.stringify(winner.plan)}\nAll plans+scores: ${JSON.stringify(scored.map(s => ({ lens:s.lens, score:s.score, plan:s.plan })))}`,
      { label:'synthesize', phase:'Synthesize', schema:PLAN_SCHEMA })
return { winningLens: winner ? winner.lens : null, ranked: scored.map(s => ({ lens:s.lens, score:s.score })), plan: final }
```
