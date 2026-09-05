---
name: implement
description: "Build something behind a deterministic gate — a test, a linter or a compiler exit code is the only verdict, never a self-assessment and never a judge model. `--from task` for one story (the only mode a worker may drive), `--from goal` to decompose a goal and drive it until everything is green, `--from plan` to take the split from a finished plan, `+ --parallel` for disjoint stories at once. Use when the user says implement, build, fix, 'make the tests pass', 'bau das', 'mach das fertig', 'implementier das', 'setz den Plan um', or hands over a plan to execute. Cheap $0 workers do the volume and this thread takes over after three consecutive reds; needs Claude Code launched through claude_bridge."
---

# implement

A deterministic gate decides done — a test, a linter or a compiler exit code, never a
self-assessment and never a judge model. Cheap `worker`-class subagents do the volume;
this thread takes over when they stall. The full invariant is
`references/gate-pattern.md`; the worker substrate (bridge, ids, launch) is `WORKERS.md`.

## Pick the mode by what you were handed

One axis — the input — because it decides everything else. One story has one gate; a goal
must be split before anything can be gated; a plan already carries the split. "Keep going
until it is green" is not a mode, it is what the machine does as soon as there is more
than one story.

| you have | invoke | what runs |
|---|---|---|
| one acceptance criterion + a gate command | `--from task` *(default)* | **Part A**, once |
| a goal too big for one gate | `--from goal` | **Part B**: decompose, then Part A per story |
| a plan produced by `plan` | `--from plan` | Part B, with the split taken from the plan |
| either multi-story form | `+ --parallel` | disjoint stories concurrently |

`--parallel` is a modifier, not a value on the axis: it means nothing until there is more
than one story, and it never changes what a gate is or when the frontier steps in.

> **Who may run which.** `--from task` is the only cell a worker may drive — Part A needs
> nothing beyond one subagent spawn and a shell. Every multi-story form fans out through
> `Workflow` or several concurrent spawns, and a worker is denied both unconditionally, so
> `--from goal`, `--from plan` and `--parallel` are main-session only. **If you are a
> worker, Part B is not yours — report back rather than starting it.**

INPUT: `$ARGUMENTS` — `<goal>  [gate: <command>]  [--from task|goal|plan] [--parallel]`

The subagent spawn tool is `Agent` in current Claude Code and `Task` in older builds;
"spawn" below means whichever this session has.

---

# Part A — one story, one gate

This is the whole of `--from task`, and the only part a worker drives.

## A0. Preflight and setup

**Preflight, and it must pass before any worker spawn.** The cheap `implementer`
(`model: worker`) only routes to the $0 coder when Claude Code was launched through the
bridge:

```sh
test -n "$ANTHROPIC_BASE_URL" \
  && curl -sf --max-time 5 "${ANTHROPIC_BASE_URL%/}/healthz" >/dev/null
```

On failure, STOP and tell the user to relaunch with `ANTHROPIC_BASE_URL` pointing at the
bridge (`http://127.0.0.1:8318` locally, the Tailnet address from elsewhere — whichever the
bridge is bound to), or continue with a normal-tier worker.
Never let a worker id 404 mid-loop — `WORKERS.md` has the id→provider table.

Parse the goal and the gate from the input. **The gate is a single deterministic command
whose exit code is the verdict**, 0 = green: `pytest -q`, `ruff check .`, `cargo build`,
`npm test`. Given no gate, STOP and ask for one. Never invent a success criterion and
never self-judge — that is the entire point of this skill.

Prefer a **middle gate**: the target test plus the touched module's siblings. A single
test inflates false passes; the whole suite collapses the offload.
See `references/gate-pattern.md`.

Run the gate **once** up front for the baseline. It may already be green — then report
that and stop.

## A1. The loop

**A bug fix starts with a reproduction test.** Before any fix, write a test that fails
*now* and fold it into the gate command. That test is the deterministic proof the bug is
dead and it re-ranks candidate fixes; it is also why no separate debugger role is needed
here, because the loop closes that feedback itself. Skip it only for greenfield work that
already has a gate.

Repeat until the gate is green or a stop condition fires:

1. **Spawn** an `implementer` subagent with the goal, the exact gate command, the FULL
   output of the latest failing run, and the reflection buffer. One increment per spawn.
2. **Run the gate yourself**, capturing exit code and output. The gate is the only
   verdict — ignore what the worker claims about its own work.
3. **Green (exit 0)** → A2.
4. **Red** → append one reflection line: a concrete hypothesis naming *why* it failed and
   what to change next, never "try again". Feed gate output plus buffer into the next
   spawn. If the worker returned "Blocked", clear the blocker yourself, then continue.

**Reflection buffer.** `.nord/reflect-<story>.md`, one line per red. Pass the last 3 into
every spawn so the worker learns from earlier failures instead of blind-retrying — a cheap
accuracy lift before the frontier has to step in. Delete the file on green.

## A1b. Stop conditions

- **Three consecutive reds** → stop delegating and make the next fix yourself in this
  thread. Read the failing code, fix it directly, re-run the gate. Drop back to the cheap
  worker once green is restored or the hard part is behind you. Do not escalate earlier:
  a lateral tier is a wash, and this thread is the genuinely stronger one.
- **Every 8 worker rounds** → run `/compact` before continuing.
- **12 rounds without green** → hard stop; report the last gate output and what remains.
- Pass into each spawn only the goal, the gate command and the latest gate output. Never
  the transcript.

## A2. Report

```
## implement result
- Goal: <goal>
- Gate: <command> → <PASS exit 0 | STOPPED after N rounds>
- Rounds: <n worker rounds, m escalated to this thread>

### Final gate output
<tail of the green run, or of the last red run if stopped>

### Change summary
<what changed, as file:line refs — the cumulative diff, deduped>

### Remaining (if stopped)
<what is still failing, and the likely next step>
```

**The gate exit code is the truth. Never report green unless you ran the gate and saw
exit 0 in this session.**

---

# Part B — many stories · main session only

A goal too big for one gate becomes a **PRD**: a list of stories, each with its own
deterministic gate. Then Part A runs per story until all are green. The registered
`gate-persist` Stop hook enforces the persistence — it refuses to let the session quit
while stories are red, bumps the iteration counter, and forces escalation. No judge model
anywhere in the loop. Its block/allow contract and how to test it live in
`references/gate-persist-contract.md`.

## The state contract — single writer per field

Violating this is the one way to corrupt a run that no gate can catch.

**`.nord/prd.json` — owned by this skill.** The story SSOT. Stories live only here, never
mirrored into the state file. Per story:

| field | meaning |
|---|---|
| `id`, `desc` | one acceptance criterion |
| `gate` | deterministic command, exit 0 = done |
| `passes` | true **only** after you re-ran *that* gate to exit 0 this session |
| `redCount` | ++ on red, reset to 0 on green |
| `escalated` | true on the green that follows a frontier fix after ≥3 reds; false on a normal green |
| `files?` | `--parallel` disjointness |
| `lastFail?` | one-line carry-over, overwritten each red |
| `failSig?` | deterministic signature of the last failing output (its first error line, or a hash) — the progress signal |
| `stallCount` | ++ when a new red has the SAME `failSig` as the prior red; reset to 0 when it changes, or on green |
| `replans` | how often this story was re-planned |

**`.nord/state/<mode>-state.json` — mixed ownership.** This skill writes `mode`, `active`
(true at start, false on complete or cancel), `max`, `startedAt`, optional `session_id`.
**The hook owns `iteration` and `updatedAt`: initialise `iteration: 0` and never bump it**,
or every round counts twice. No stories embedded here. nord-hud reads both, read-only;
keep the flat `.nord/state/<mode>-state.json` path.

## B0. Decompose

Split the goal into stories and write `<repo>/.nord/prd.json`:

```json
{ "goal": "<goal>", "stories": [
  { "id": "s1", "desc": "<one acceptance criterion>", "gate": "pytest -q tests/test_x.py",
    "passes": false, "redCount": 0, "escalated": false, "stallCount": 0, "replans": 0 }
] }
```

**Coverage gate.** First enumerate the goal's acceptance criteria, then confirm each maps
to at least one story. A requirement that never becomes a story is silently never built:
the loop reports "all stories green" while missing it, and no per-story gate can catch a
requirement that has no gate. This is the one coverage bug the deterministic gates cannot
see, so it is checked here, by you, at decompose time.

**Every gate must be runnable, and you verify that now** — the command parses and its test
path exists. A non-existent or flaky gate never goes green, so the hook blocks until the
cap and the run looks like a model failure instead of a typo. A story with no runnable
gate is not a story: fold it into another, or give it a real one (a placeholder check like
`! grep -rnE "TODO|\.skip\(" src` counts). Prefer a middle gate here too.

Then write the state file — prd.json **before** flipping `active`:

```json
{ "mode": "implement", "active": true, "iteration": 0, "max": <max(12, 6*stories)>, "startedAt": "<iso>" }
```

The hook is name-agnostic by construction: it finds state files by suffix
(`readdirSync(stateDir).filter(f => f.endsWith("-state.json"))`) and reads
`st.mode || f.replace("-state.json","")`. So **any** leftover `*-state.json` in
`.nord/state/` is picked up and keeps blocking, whatever it is called. `abort` clears it.

## B0b. Decompose from a plan — `--from plan`

A plan document is too vague to gate directly, so the split is delegated rather than
invented: invoke `plan`, or read the plan you were handed, then turn each of its steps
into a story with a deterministic gate — verifying each gate is runnable exactly as in B0.
From there it is `--from goal`: same prd.json, same drive loop, same completion rule. The
only difference is who produced the split.

## B1. Drive

**Sequential** (no `--parallel`): for each `passes:false` story, run Part A. On exit 0 set
`passes:true` and reset `redCount` and `stallCount` to 0. On red, `redCount++`, set
`lastFail`, and update the progress ledger: compute `failSig` from the gate output — equal
to the prior one means `stallCount++` (stuck), different means `stallCount=0` and store
the new signature (progress). **Never write `iteration`; the hook does.**

**`--parallel`:** dispatch stories with disjoint `files` concurrently, one gate-worker
each, gated independently. Stories sharing a file run sequentially, so `--parallel`
degrades to the sequential branch rather than failing when nothing is disjoint. This is
the mode that needs `files` per story; without it disjointness cannot be decided and the
run must serialise.

Re-read prd.json each round. That is what makes the run resume-safe: a `passes:true` story
is skipped, so the loop survives `/compact` and a restart.

## B1b. Stall → replan

Escalating harder is useless when the failure never *changes* — that means the approach or
the gate is wrong, not the effort. The progress ledger separates grinding from stuck:

- **Grinding** — `failSig` changes each red. That is progress; keep looping.
- **Stuck** — `failSig` unchanged, `stallCount` climbing. At **`stallCount` ≥ 2** the same
  failure has survived a cheap round *and* a frontier escalation. Stop re-fixing and
  **replan**: re-read `desc`, the reflection buffer and `failSig`, then change a
  *different* lever — re-scope or split the story, fix a wrong or flaky gate, or pick
  another implementation strategy. Then `replans++`, reset `redCount` and `stallCount`,
  and resume.
- **Replan cap.** At `replans` ≥ 2 and stalling again, mark the story `blocked` and move
  on. One hard story must not sink the whole run; report blocked stories at completion
  with their `failSig` and the likely next step.

No model decides that a run has stalled — a byte comparison of gate output does.

## B2. Complete

Done only when every story is `passes:true` **and** you re-ran each gate to exit 0 in this
session. Set `active:false`. Report per story (gate → PASS, round count) plus the
cumulative diff. If the hook's iteration cap is hit first it allows the stop — then report
the still-red stories and the next step. `abort` cancels a run.

## References

- `references/gate-pattern.md` — the full gate invariant, and why the middle gate.
- `references/test-strategy.md` — choosing what the gate should actually test.
- `references/gate-persist-contract.md` — the Stop hook's block/allow contract, repo-root
  resolution, the cache-mirror rule, and how to verify the hook without a live session.
  Read when the loop will not stop, will not continue, or after editing the hook.
