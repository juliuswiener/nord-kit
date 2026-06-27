---
name: ralph
description: "Persistence loop — keep working until the task is fully done, verified by deterministic gates. Decomposes the task into a PRD (stories, each with its own gate) and drives gate-loop per story until ALL pass. Use for 'ralph', 'don't stop', 'keep going until done', 'must complete', 'finish this'. Needs CC launched through the bridge (cheap workers)."
---

# ralph — deterministic persistence loop

ralph = **gate-loop PRD mode** with a persistence flavor: it does not stop until every story's
deterministic gate is green. No LLM-reviewer, no Stop-hook — the frontier (this thread) drives the loop
and escalates on stall. Full engine: `../gate-loop/SKILL.md` (§ PRD mode); contract:
`../gate-loop/references/gate-pattern.md`; worker substrate: `../../WORKERS.md`.

INPUT: `<task>` (+ optional `gate:` per story is derived during decompose).

## Run
1. **Preflight** the bridge (see gate-loop §0) — cheap `gate-worker` (qwen3.6-plus) needs it.
2. **Decompose** the task into `.omc/prd.json` stories (fields per gate-loop state contract:
   id/desc/gate/passes/redCount/escalated). Write `.omc/state/ralph-state.json`
   `{mode:"ralph",active:true,iteration:0,max:<max(12,6*stories)>,startedAt:"<iso>"}` (exact filename —
   nord-hud reads it; write prd.json BEFORE active:true; NO embedded stories).
3. **Drive sequentially** (gate-loop PRD §1, ralph = sequential persistence): per `passes:false` story run
   the single-story gate-loop (gate-worker → run its gate → escalate to frontier after 3 reds). On exit 0
   set `passes:true` + reset `redCount:0`; on red `redCount++`. **NEVER write `iteration` — the
   gate-persist Stop-hook owns it** (it bumps on every blocked stop = the real cap). Re-read prd.json each
   round (resume-safe across `/compact`). The hook also blocks premature stop + forces escalation at 3 reds.
4. **Complete** only when ALL stories `passes:true` and each gate re-run to exit 0 THIS session. Set
   `active:false`. Report per story + cumulative diff. Hard-stop at 12 rounds → list red stories + next step.

`nord-core:cancel` aborts (clears `.omc/state/*.json` + prd.json). For a single-gate task, just use
`gate-loop` directly — ralph is for multi-story "don't stop until everything's green".
