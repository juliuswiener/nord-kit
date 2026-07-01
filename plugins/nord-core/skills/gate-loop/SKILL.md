---
name: gate-loop
description: "Orchestrator-worker loop — a cheap $0 worker (qwen3.6-plus via claude_bridge) implements, a DETERMINISTIC gate (pytest/ruff/compiler exit code) is the only verdict, the frontier (this Opus thread) escalates after 3 consecutive red gates. Use for code-gen / anything with a test, compiler, or lint gate. Requires CC launched through the bridge."
---

# gate-loop

You are the gate-loop orchestrator (frontier tier — you are Opus). You drive a cheap worker against a
DETERMINISTIC gate and escalate to yourself only when the worker stalls. Cheap workers do the volume,
an exit-code gate is the single source of truth, no self-verification. The full invariant:
`references/gate-pattern.md`. The worker substrate (bridge, ids, launch): `WORKERS.md` (nord-core).

INPUT: `$ARGUMENTS` — `<goal>  [gate: <command>]`

## 0. Preflight + setup

**Preflight (MUST pass before any worker spawn)** — the cheap `gate-worker` (`model: qwen3.6-plus`)
only routes to the $0 opencode-zen coder when CC is launched through the bridge:
```sh
test "${ANTHROPIC_BASE_URL%/}" = "http://127.0.0.1:8318" \
  && curl -sf --max-time 5 http://127.0.0.1:8318/healthz >/dev/null
```
On failure: STOP and tell the user `ANTHROPIC_BASE_URL=http://127.0.0.1:8318 claude`, or proceed with a
normal-tier worker — never let `qwen3.6-plus` 404 mid-loop. (See `WORKERS.md` for the id→provider table
+ fallback `glm-5.1`.)

Parse the GOAL and GATE command from the input. The gate MUST be a single deterministic command whose
exit code is the verdict (0 = green) — `pytest -q`, `ruff check .`, `cargo build`, `npm test`. If no
gate was given, STOP and ask for one — never invent a success criterion or self-judge. Prefer a
**middle gate** (target test + the touched module's sibling tests), not a single test (inflates
false-pass) nor the whole suite (collapses offload) — see `references/gate-pattern.md`.

Run the gate ONCE up front for the baseline (it may already be green → report and stop).

## 1. Loop

**Bug-fix goals — reproduction test FIRST** (Agentless localize→repair→validate). Before any fix,
write a test that REPRODUCES the failure (must fail now) and fold it into the gate command. That repro
test is the deterministic proof the bug is dead and re-ranks candidate fixes — it is the +4-5% lever
the loop lives on, and the reason a standalone `debugger` role is unneeded (this loop closes the debug
feedback itself). Skip only for greenfield/feature goals that already have a gate.

Repeat until the gate is green or you hit an escalation/stop condition:

1. SPAWN a `gate-worker` subagent (Task tool) with: the goal, the exact gate command, the FULL output
   of the latest failing gate run, AND the reflection buffer (below). One increment per spawn.
2. RUN the gate command yourself via Bash. Capture exit code + output. The gate is the ONLY verdict —
   ignore the worker's self-check claim.
3. GREEN (exit 0) → go to §2.
4. RED → record it. Append ONE reflection line — a concrete hypothesis (WHY it failed + what to change
   next, never "try again") — to the reflection buffer, then feed the gate output + buffer into the
   next spawn. If the worker returned "Blocked", resolve the blocker yourself then continue.

**Reflection buffer (Reflexion).** Persist to `.nord/reflect-<story>.md`, one line per red. Pass the
last 3 into every spawn so the worker learns from prior failures instead of blind-retrying — a cheap
accuracy lift before the 3-red frontier escalation. Delete the file on green.

## Escalation (frontier)

Count CONSECUTIVE red gates. After **3** consecutive reds, stop delegating and make the next fix
YOURSELF in this thread (you are the frontier tier) — read the failing code, fix directly, re-run the
gate. Drop back to the cheap worker once green is restored or the hard part is past. Do not escalate
before 3 reds. (A lateral tier is a wash; you/Opus are the genuinely stronger tier.)

## Loop discipline

- After every 8 worker rounds, run `/compact` before continuing.
- Pass into each worker spawn ONLY: goal + gate command + latest gate output. Never the full transcript.
- Hard stop after 12 total rounds without green → report the last gate output + what remains.

## 2. Report

```
## Gate-loop result
- Goal: <goal>
- Gate: <command> → <PASS exit 0 | STOPPED after N rounds>
- Rounds: <n worker rounds, m escalated to frontier>

### Final gate output
<tail of the green run, or the last red run if stopped>

### Change summary
<what changed, as file:line refs. The cumulative diff, deduped.>

### Remaining (if stopped)
<what is still failing and the likely next step.>
```

Rule: the gate exit code is the truth. Never report green unless you ran the gate and saw exit 0 in
this session.

---

## PRD mode (multi-story persistence) — the ralph/team/autopilot engine

For a goal too big for one gate, decompose into a **PRD** = a list of stories, each with its OWN
deterministic gate, then run the single-story loop above per story until ALL are green. The
`gate-persist` Stop-hook (registered) enforces persistence: it refuses to let the session quit while
stories are red, bumps the iteration counter, and forces escalation — replacing omc's persistent-mode +
LLM-reviewer with a deterministic-gate loop, no judge (per `references/gate-pattern.md`).

### State contract (single-writer — do not violate)
- **`.nord/prd.json` — SKILL-owned (you).** The story SSOT. Stories live ONLY here (NOT mirrored into
  state.json). Fields per story: `id`, `desc`, `gate` (deterministic cmd, exit 0 = done), `passes` (bool —
  true ONLY after you re-ran THAT gate to exit 0 this session), `redCount` (int — ++ on red, reset 0 on
  green), `escalated` (bool — true on the green that follows a frontier fix after ≥3 reds; reset false on a
  normal green), `files?` (string[], team-mode disjointness), `lastFail?` (one-line carry-over, overwrite each red).
  **Progress-ledger (stall detection):** `failSig?` (deterministic signature of the last failing gate
  output — e.g. its first error line / a hash; the progress signal), `stallCount` (int — ++ when a new red
  has the SAME `failSig` as the prior red = stuck; reset 0 when `failSig` changes = progress, or on green),
  `replans` (int — how many times this story was re-planned).
- **`.nord/state/<mode>-state.json` — MIXED, single-writer-per-field.** SKILL writes `mode`, `active`
  (true@start / false@complete+cancel), `max`, `startedAt`, optional `session_id`. **The gate-persist HOOK
  owns `iteration` + `updatedAt` — you init `iteration:0` at start and NEVER bump it** (double-count
  otherwise). NO embedded stories.
- nord-hud reads both (read-only). Keep the flat `.nord/state/<mode>-state.json` path.

### 0. Decompose (frontier = you)
Split the goal into stories and write `<repo>/.nord/prd.json`:
```json
{ "goal": "<goal>", "stories": [
  { "id": "s1", "desc": "<one acceptance criterion>", "gate": "pytest -q tests/test_x.py", "passes": false, "redCount": 0, "escalated": false, "stallCount": 0, "replans": 0 },
  { "id": "s2", "desc": "...", "gate": "ruff check . && pytest -q tests/test_y.py", "passes": false, "redCount": 0, "escalated": false, "stallCount": 0, "replans": 0 }
] }
```
Every story's `gate` MUST be a deterministic, **runnable** command — at decompose time verify each gate
parses / its test path exists (a non-existent or flaky gate never goes green → the hook blocks until the
cap). A story with no runnable gate is NOT a story; fold it in or make it a real gate
(e.g. placeholder check `! grep -rnE "TODO|\.skip\(" src`). Prefer a **middle gate** (target + sibling
tests), not a single test. Then write the state file:
`.nord/state/<mode>-state.json` = `{ "mode":"<ralph|team|autopilot>", "active":true, "iteration":0, "max":<max(12, 6*stories)>, "startedAt":"<iso>" }`
(write prd.json BEFORE flipping `active:true`).

### 1. Drive
- **ralph / autopilot (sequential):** for each `passes:false` story, run the §1 single-story loop
  (gate-worker → run its gate → escalate to frontier after 3 reds). On exit 0 set `passes:true` + reset
  `redCount:0` + `stallCount:0`; on red `redCount++`, set `lastFail`, and update the progress-ledger:
  compute `failSig` from the gate output — if it equals the prior `failSig`, `stallCount++` (stuck);
  else `stallCount=0` + store the new `failSig` (progress, keep going). **Never write `iteration` — the hook does.**
- **team (parallel):** dispatch INDEPENDENT stories (disjoint `files`) concurrently — one gate-worker each
  via `parallel()` / multiple Task spawns — gate each independently. Shared-file stories run sequentially.
- Re-read prd.json each round (resume-safe: a `passes:true` story is skipped — survives `/compact` + restart).

### 1b. Stall → replan (recovery)
Escalating harder is useless when the failure never *changes* — that means the APPROACH or the GATE is
wrong, not the effort. Use the progress-ledger to tell grinding (making progress) from stuck:
- **Grinding** — `failSig` changes each red (different error each round). Progress. Keep looping.
- **Stuck** — `failSig` unchanged: `stallCount` climbs. When **`stallCount` ≥ 2** (the same failure
  survived a cheap round AND a frontier escalation), STOP re-fixing and **replan** (this is the recovery
  action): frontier (you) re-reads `desc` + the reflection buffer + `failSig`, then changes a *different*
  lever — re-scope/split the story, fix a wrong or flaky `gate`, or pick a new implementation strategy.
  Then `replans++`, reset `redCount:0` + `stallCount:0`, and resume with the new approach.
- **Replan cap (recovery-of-recovery):** if `replans` ≥ 2 and it stalls again, mark the story `blocked`
  (terminal red) and move to the next story — one hard story must not sink the whole run. Report blocked
  stories at Complete with their `failSig` + likely next step.

This is a deterministic task-ledger (prd.json stories) + progress-ledger (`failSig`/`stallCount`) — no
LLM judge decides stall; a byte-comparison of gate output does.

### 2. Complete
Done only when ALL stories `passes:true` AND you re-ran each gate to exit 0 THIS session. Set
`active:false`. Report per story (gate → PASS / round-count) + cumulative diff. If the hook's iteration
cap is hit first, it allows the stop — report the still-red stories + next step. `nord-core:cancel` aborts.

**Why over a PRD + LLM-reviewer:** the story gate is a deterministic command, not a reviewer agent —
objectively done, no judge in the $0 loop; cheap workers do the volume, frontier escalates on stall; the
hook guarantees it can't quit early AND can't loop forever (iteration cap + 2h staleness + safety bypasses).

## Stop-hook block contract (gate-persist.cjs)

The continuation guarantee is a CC **Stop hook** (`hooks/gate-persist.cjs`). Contract:
- **Block** (keep going): print `{"decision":"block","reason":"<directive>"}` to stdout, exit 0. CC does
  NOT stop; it re-injects `reason` as the next instruction and re-invokes with `stop_hook_active:true`.
  gate-persist deliberately ignores that flag — it relies on deterministic story state + iteration cap +
  2h staleness, so the flag alone can't trick it into an infinite loop.
- **Allow** (let stop): print nothing, exit 0. Emitted when all stories `passes:true`, no active state,
  cap hit, stale, or a safety bypass fires (context-limit / ≥95% / user-abort / auth-error).
- **Repo-root resolution:** the hook walks up from `input.cwd` to the dir holding `.nord` (preferred) or
  `.git` before reading `.nord/state` + `.nord/prd.json` — so a nested cwd / git-worktree still finds the
  loop's root (bounded 40-iter walk, fallback = cwd).
- **Mirror:** the served copy is `cache/nord/nord-core/<ver>/hooks/gate-persist.cjs` — any edit must land
  in BOTH the marketplace source and the cache mirror or the running hook is stale.

Verify the schema deterministically (no live session needed): pipe a fake stop event —
`printf '{"cwd":"<repo>","session_id":"t"}' | node hooks/gate-persist.cjs` — a red story prints the
`block` JSON, all-green prints nothing. Live-confirm by launching CC in a scratch dir with one
`passes:false` story + `active:true` state, ending the turn (CC must re-inject, not stop), flipping to
`passes:true` (CC stops), then `nord-core:cancel`. **Only one Stop hook may be active** for a clean
verdict — a second continuation hook (e.g. double-shot-latte's LLM judge) masks this one.
