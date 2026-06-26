---
name: nord-plan
description: "Parallel planning tournament: N lens-planners draft, judges score with on/off-task gate, synth winner + best-of-rest. Add --consensus for sequential Planner→Architect→Critic validation after tournament. Use for 'plan this with options', 'multi-agent plan', 'parallel plan'. Complements ralplan (sequential consensus)."
argument-hint: "[--consensus [--deliberate] [--interactive]] <task>"

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
  risks:{type:'array', items:{type:'string'}}, tradeoffs:{type:'string'},
  principles:{type:'array', items:{type:'string'}, description:'3-5 guiding principles (--consensus mode)'},
  decisionDrivers:{type:'array', items:{type:'string'}, description:'top 3 decision drivers (--consensus mode)'},
  viableOptions:{type:'array', items:{type:'object', properties:{name:{type:'string'},pros:{type:'array',items:{type:'string'}},cons:{type:'array',items:{type:'string'}}}}, description:'>=2 viable options with pros/cons (--consensus mode)'},
  preMortem:{type:'array', items:{type:'string'}, description:'3 failure scenarios (--deliberate mode)'},
  testPlan:{type:'object', properties:{unit:{type:'string'},integration:{type:'string'},e2e:{type:'string'},observability:{type:'string'}}, description:'unit/integration/e2e/observability (--deliberate mode)'} },
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

## --consensus Mode (post-tournament validation)

`--consensus` adds a sequential Planner→Architect→Critic loop **after** the parallel tournament. Default path (no flag) = tournament only, unchanged.

**Trigger**: pass `--consensus` flag.

**Steps** (run after synthesis returns `final`):

1. **Planner** receives the tournament `final` plan as its starting draft. Planner MUST produce a compact **RALPLAN-DR summary** alongside the revised plan containing:
   - **Principles** (3-5)
   - **Decision Drivers** (top 3)
   - **Viable Options** (>=2) with bounded pros/cons for each; if only one option remains, explicit invalidation rationale for alternatives
   - In deliberate mode: **pre-mortem** (3 failure scenarios) and **expanded test plan** (unit / integration / e2e / observability)

2. **Architect** reviews for architectural soundness — `Task(subagent_type="oh-my-claudecode:architect", ...)`. Review MUST include: strongest steelman antithesis against the favored option, at least one meaningful tradeoff tension, and (when possible) a synthesis path. **Await completion before step 3. Do NOT run steps 2 and 3 in parallel.**

3. **Critic** evaluates against quality criteria — `Task(subagent_type="oh-my-claudecode:critic", ...)`. Run only after step 2 completes. Critic MUST verify: principle-option consistency, fair alternative exploration, risk mitigation clarity, testable acceptance criteria, concrete verification steps. Critic MUST explicitly reject shallow alternatives, driver contradictions, vague risks, or weak verification. In deliberate mode, Critic MUST reject missing/weak pre-mortem or missing/weak expanded test plan.

4. **Re-review loop** (max 5 iterations): If Critic returns ANY non-APPROVE verdict (ITERATE or REJECT), collect Architect + Critic feedback → Planner revises → return to step 2. Repeat until Critic approves or 5 iterations reached. At max iterations, present best version via `AskUserQuestion` noting consensus was not reached.

5. **Apply improvements**: Merge accepted Architect + Critic suggestions into the plan. Final consensus output MUST include an **ADR** section:
   - **Decision** — what was chosen
   - **Drivers** — which decision drivers were decisive
   - **Alternatives considered** — options evaluated with reasons not chosen
   - **Why chosen** — argument for the selected option
   - **Consequences** — positive and negative outcomes
   - **Follow-ups** — open questions or future work

6. **Persist** final plan to `.omc/plans/ralplan-<timestamp>.md` (exact naming required — `autopilot`'s glob `.omc/plans/ralplan-*.md` depends on it).

7. **Approval routing** — use `AskUserQuestion` (never plain text) with options:
   - **Approve execution via team** (Recommended) — invokes `Skill("oh-my-claudecode:team")` with the plan path
   - **Approve execution via ralph** — invokes `Skill("oh-my-claudecode:ralph")` with the plan path
   - **Compact then return for execution approval** — invokes compact to shrink accumulated planning context, then re-presents the pending-approval plan without auto-executing (recommended when context is 50%+ full after planning)
   - **Request changes** — return to step 1 with user feedback
   - **Reject** — discard plan entirely
   On approve, invoke the chosen execution skill. Do NOT implement directly in the planning agent. Before approval, mark plan `pending approval` and MUST NOT mutate files, commit, push, or delegate implementation.

   If `--interactive` is NOT set: output final plan marked `pending approval`, skip step 7 prompt, and stop without auto-executing.

## --deliberate Flag

Auto-enabled when `--consensus` is active AND any of these signals are detected: auth/security, migrations, destructive/irreversible changes, production incidents, compliance/PII, public API breakage. Manually forced with `--deliberate`.

In deliberate mode:
- Planner MUST include `preMortem` (exactly 3 failure scenarios) in the RALPLAN-DR summary
- Planner MUST include `testPlan` with unit / integration / e2e / observability coverage
- Architect MUST explicitly flag principle violations
- Critic MUST reject if `preMortem` is missing, has fewer than 3 scenarios, or scenarios are too generic; MUST reject if `testPlan` is missing or lacks any of the four coverage areas

## Quality Floors

Apply in **--consensus mode** (Critic enforces):

| Check | Floor | Reject if |
|---|---|---|
| File/path citations | 80% of steps name a file or path | < 80% steps cite a concrete file/path |
| Acceptance criteria testability | ≥ 90% of criteria are concrete and verifiable | < 90% criteria concrete/verifiable (vague terms like "fast", "better", "improved" without metrics) |
| Viable options | ≥ 2 options OR explicit invalidation rationale | Single option with no rationale |
| Pre-mortem (deliberate) | 3 distinct failure scenarios | < 3 or scenarios are generic/trivial |
| Test plan (deliberate) | All four areas covered | Missing unit, integration, e2e, or observability |

These floors are Critic-enforced within the re-review loop. Architect feedback is advisory; Critic verdict is binding.

## Plan Output Format

Required sections per mode:

| Mode | Required sections |
|---|---|
| Tournament (default) | `taskRestatement`, `outOfScope`, `summary`, `steps`, `risks`, `tradeoffs` |
| Consensus (`--consensus`) | All tournament sections + **RALPLAN-DR summary** (Principles, Decision Drivers, Viable Options) + **ADR** (Decision, Drivers, Alternatives considered, Why chosen, Consequences, Follow-ups) |
| Deliberate (`--deliberate`) | All consensus sections + **pre-mortem** (3 failure scenarios) + **expanded test plan** (unit / integration / e2e / observability) |

Plans are saved to `.omc/plans/ralplan-<timestamp>.md` (naming required — autopilot glob `.omc/plans/ralplan-*.md` depends on it). Drafts go to `.omc/drafts/`.

## State Persistence (nord-native, no omc dep)

In `--consensus` mode, manage lifecycle state via a plain JSON file — no `state_write` MCP required:

- **On entry**: create `.omc/state/nord-plan-<slug>.json` with `{ "active": true, "phase": "planning", "slug": "<slug>", "startedAt": "<iso-timestamp>" }`
- **On approval handoff** (→ ralph/team): set `active: false` (do NOT delete — execution mode may reference it)
- **On reject or error/abort**: delete the file entirely

`<slug>` = first 3 meaningful words of the task, lowercased, hyphenated (e.g., `add-user-auth`).

This replaces `state_write`/`state_clear` from omc — nord-plan is self-contained and carries no omc state-hook dependency.

## Provider Overrides (optional)

`--architect codex` and `--critic codex` swap a Claude pass for a Codex pass in consensus mode:

```
nord-plan --consensus --architect codex "task"
nord-plan --consensus --critic codex "task"
nord-plan --consensus --architect codex --critic codex "task"
```

Implementation: invoke `omc ask codex --agent-prompt <role> "<full review prompt>"` for that step.
If `omc ask codex` is unavailable, briefly note the fallback and continue with default Claude for that stage — do NOT abort.

## Pre-Execution Gate

### Why the Gate Exists

Execution modes (ralph, autopilot, team, nord-exec) spin up heavy multi-agent orchestration. Vague requests like `ralph improve the app` give agents no bounded target — cycles waste on scope discovery that belongs in planning. The gate intercepts underspecified execution requests and redirects them through `nord-plan --consensus`.

### Gate Logic

Gate fires when **all three** conditions hold:

1. An execution keyword is present: `ralph`, `autopilot`, `team`, `nord-execute`, `ultrawork`, `ultrapilot`
2. Prompt is ≤ 15 effective words (stop-words excluded)
3. NO concrete anchor is detected

**Concrete anchors — any ONE passes the gate:**

| Anchor type | Example |
|---|---|
| File path | `src/hooks/bridge.ts` or any `/`-containing path |
| Issue / PR number | `#42`, `PR-123` |
| camelCase symbol | `processKeywordDetector` |
| PascalCase symbol | `UserModel` |
| snake_case symbol | `user_model` |
| Test runner invocation | `npm test`, `pytest`, `cargo test` |
| Numbered steps | `1. Add X\n2. Test Y` |
| Acceptance criteria block | `acceptance criteria:` or `ac:` followed by content |
| Error reference | `TypeError`, `AssertionError`, stack-trace fragment |
| Code block | fenced ` ``` ` block with content |
| Escape prefix | `force:` or `!` anywhere before the execution keyword |

### On Gate Fire

Redirect to `nord-plan --consensus` with a brief explanation:

> "Prompt is underspecified for direct execution — routing through nord-plan consensus to scope the work first."

Bypass: prefix the original message with `force:` or `!` (e.g., `force: ralph fix it`).

### Gate Does NOT Fire

- Any concrete anchor present (one is enough)
- `--consensus` already requested (already in planning mode)
- Explicitly called as `nord-plan` (planning, not execution)

### Good vs Bad Prompts

**Passes** (concrete anchor present):
- `ralph fix src/hooks/bridge.ts:326` — file path
- `autopilot implement #42` — issue number
- `team add validation to processKeywordDetector` — camelCase symbol
- `ralph do:\n1. Add input validation\n2. Write tests` — numbered steps

**Gated** (redirected to nord-plan --consensus):
- `ralph fix this`
- `autopilot build the app`
- `team improve performance`
- `ralph add authentication`

**Bypass**:
- `force: ralph refactor the auth module`
- `! autopilot optimize everything`

## Quality techniques (adopted)
Apply to every plan (grafted from make-plan / writing-plans / task_planner):
- **Phase 0 — doc discovery first.** Read docs/examples/existing patterns; build an "Allowed APIs" list
  citing sources; flag non-existent/deprecated APIs. Fact-gathering subagents MUST return sources + exact
  signatures/paths + copy-ready snippet locations + confidence/gaps — reject & redeploy any that conclude
  without sources.
- **Frame steps as "COPY exact pattern from file:lines"**, not "transform existing code". Ban invented
  APIs / undocumented params.
- **No placeholders.** Ban TBD/TODO/"add error handling"/"similar to Task N"; each code step shows actual
  code + exact command + expected output.
- **Per-task Interfaces block** (Consumes/Produces, exact signatures+types) + **Global Constraints header**
  (version floors / naming / platform rules, once, applied to all).
- **Bite-sized TDD steps** with `- [ ]`: failing test → confirm fail → minimal impl → confirm pass → commit.
- **Master-ticket fields**: Definition of Done, Interface Contracts, NFRs (security/perf/logging),
  PR-reviewer checklist, "blueprint not production code".
- **Post-plan self-review**: spec-coverage gap scan, placeholder scan, cross-task type/name consistency.
- **`--interactive`**: ask targeted questions for critical gaps, STOP before generating.
