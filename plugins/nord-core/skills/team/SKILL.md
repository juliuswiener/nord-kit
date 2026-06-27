---
name: team
description: "Parallel multi-story execution — decompose into independent (disjoint-file) stories and run them concurrently, each gated by its own deterministic command, until ALL pass. Use for 'team', 'parallel agents', 'do these in parallel', 'coordinate workers'. Needs CC launched through the bridge (cheap workers)."
---

# team — parallel PRD gate-loop

team = **gate-loop PRD mode, parallel branch**: independent stories run concurrently, each with its own
deterministic gate. Same engine + state contract as `../gate-loop/SKILL.md` (§ PRD mode) and the
`gate-persist` Stop-hook; substrate `../../WORKERS.md`; contract `../gate-loop/references/gate-pattern.md`.

INPUT: `<goal>` (work-list of independent items).

## Run
1. **Preflight** the bridge (gate-loop §0).
2. **Decompose** into `.nord/prd.json` stories, each with a deterministic `gate` AND a `files` list (the
   files it touches — used for disjointness). Write `.nord/state/team-state.json`
   `{mode:"team",active:true,iteration:0,max:<max(12,6*stories)>,startedAt:"<iso>"}` (write prd.json first).
3. **Drive parallel:** dispatch stories whose `files` are **disjoint** concurrently — one `gate-worker`
   (qwen3.6-plus) per story via `parallel()` / multiple Task spawns in one message. Stories that share
   files run sequentially. Gate each independently (exit 0 = `passes:true` + `redCount:0`; red = `redCount++`);
   escalate a story to the frontier after 3 reds. **Never write `iteration` — the hook owns it.**
4. **Complete** when ALL stories `passes:true` (each gate re-run to exit 0). Set `active:false`, report per
   story + cumulative diff. `nord-core:cancel` aborts.

team vs ralph: team runs independent stories **concurrently**; ralph runs sequentially. Both = same PRD
engine + Stop-hook persistence. Conflicting (shared-file) stories always serialize.
