---
name: autopilot
description: "Full idea→code: decompose a vague idea into a verifiable PRD via nord-plan, then drive it to green through the deterministic gate-loop until done. Use for 'autopilot', 'build the whole thing', 'take this from idea to working code', 'full pipeline'. Needs CC launched through the bridge (cheap workers)."
---

# autopilot — idea→code PRD gate-loop

autopilot = **plan-first front-end on gate-loop PRD mode**: it delegates decomposition to `nord-plan`
(an idea is too vague to gate directly), materializes the result as a PRD, then drives it like ralph.
Engine + state contract: `../gate-loop/SKILL.md` (§ PRD mode) + the `gate-persist` Stop-hook;
substrate `../../WORKERS.md`; contract `../gate-loop/references/gate-pattern.md`.

INPUT: `<idea / feature request>` (vaguer than ralph/team accept).

## Run
1. **Preflight** the bridge (gate-loop §0).
2. **Plan → PRD.** Invoke `nord-plan` to decompose the idea into concrete steps; convert each into a story
   with a **deterministic gate** (test/compiler/lint command — verify it's runnable). Write `.nord/prd.json`
   (fields per gate-loop state contract). Then `.nord/state/autopilot-state.json`
   `{mode:"autopilot",active:true,iteration:0,max:<max(12,6*stories)>,startedAt:"<iso>"}` (prd.json first).
3. **Drive** like ralph (sequential, gate-loop PRD §1): per `passes:false` story → gate-worker → gate →
   escalate after 3 reds; `passes:true`+`redCount:0` on exit 0. **Never write `iteration` — the hook owns it.**
4. **Complete** when ALL stories green. Set `active:false`, report. `nord-core:cancel` aborts.

autopilot vs ralph: autopilot DELEGATES decomposition to nord-plan (idea→PRD); ralph expects a task you
can already split into stories. Both = same gate-loop PRD engine + Stop-hook persistence.
