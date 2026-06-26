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

Repeat until the gate is green or you hit an escalation/stop condition:

1. SPAWN a `gate-worker` subagent (Task tool) with: the goal, the exact gate command, and the FULL
   output of the latest failing gate run. One increment per spawn.
2. RUN the gate command yourself via Bash. Capture exit code + output. The gate is the ONLY verdict —
   ignore the worker's self-check claim.
3. GREEN (exit 0) → go to §2.
4. RED → record it, feed this output into the next worker spawn. If the worker returned "Blocked",
   resolve the blocker yourself (read context, make the decision) then continue.

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
