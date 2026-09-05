---
name: diagnose
description: "Find WHY something behaves as it does by running competing explanations against each other — evidence for and against each, a rebuttal round, then the one probe that would settle what is left, executed if it can be. Use when a test fails for reasons that are not obvious, when a measurement or benchmark result needs explaining, when two explanations both fit the facts, or on 'warum passiert das', 'wieso ist die Zahl anders', 'was ist da los', 'trace this'. When you can already reproduce and localise the failure, the `debugger` agent is enough. It ends at the decisive probe — applying the fix is `implement`."
argument-hint: "<the observation to explain>"
---

# diagnose — competing explanations, one decisive probe

Explains why something behaves as it does. It does not fix it.

Reach for it when two explanations both fit the facts and neither has been ruled out. If
you can already reproduce and localise the failure, this is overhead — hand it to the
`debugger` agent instead.

**Spawning lanes is main-session work.** Without the ability to spawn, run the three lanes
yourself in sequence: the discipline is the value, the parallelism is only the speed.

## The contract

Seven things stay distinct from the first note to the final answer. Collapsing any two is
how a trace becomes a guess with a table around it.

| | |
|---|---|
| **Observation** | what was actually observed, restated exactly |
| **Hypotheses** | competing explanations, deliberately different |
| **Evidence for** | what supports each |
| **Evidence against / gaps** | what contradicts it, and what is still missing |
| **Best explanation** | the leader right now |
| **Critical unknown** | the one missing fact keeping the top two apart |
| **Discriminating probe** | the cheapest step that would collapse the uncertainty |

Never return a fix-it loop, a generic debugger summary, raw worker output, or confidence
the evidence does not carry.

## Run

1. **Restate the observation** precisely and name the tracing target.
2. **Generate three deliberately different hypotheses.** Use this partition unless the
   problem suggests a better one:
   - **code path** — the implementation itself
   - **config / environment / orchestration** — what surrounds it
   - **measurement / assumption mismatch** — the *verification* is defective, not the
     system. One key reused across distinct entities, tenants or streams; a filter whose
     grain does not match the schema; a catalog or column name assumed portable across
     runtimes. A cross-entity discrepancy gets this premise audit **before** anyone
     escalates: enumerate the entity dimensions and check whether a zero-row result came
     from applying one key across many entities.
3. **One lane per hypothesis, one `debugger` agent each.** Each lane owner restates its
   hypothesis, gathers evidence for *and against* it, ranks that evidence by tier, names
   its critical unknown and its best lane-specific probe, and does not slide into
   implementing. Lanes must pursue different explanations — three agents chasing the same
   one buy nothing.
4. **Rebuttal round.** The strongest non-leading lane attacks the leader; the leader
   answers with evidence, not assertion. If the rebuttal lands, re-rank.
5. **Run the probe** (below).
6. **Synthesise** — do not concatenate the lane reports.

## Evidence tiers

Ranked, never flat. Down-rank a hypothesis resting mostly on the lower tiers while a rival
has something higher.

1. controlled reproduction, direct experiment, uniquely discriminating artifact
2. primary artifacts with tight provenance — traces, logs, metrics, benchmark output,
   configs, git history, `file:line` behaviour
3. several independent sources converging
4. single-source code-path or behavioural inference
5. circumstantial — timing, naming, stack order, resemblance to an earlier bug
6. intuition, analogy, speculation

## Run the probe

Tier 1 is a controlled reproduction, and *recommending* a probe produces no tier-1
evidence at all. So before the final synthesis, **run the discriminating probe whenever it
is runnable**:

- It reduces to a command, a test or a measurement — a failing test, an instrumented log
  plus a re-run, toggling the suspected cause — so execute it. The result is evidence, not
  an argument.
- **Confirms the leader** → lock it. **Refutes it** → the rival becomes leader, and you run
  *its* probe next.
- **Not runnable** — a post-mortem, an architecture question, something needing production
  data or a destructive action — record `probe not executed: <reason>` and fall back to
  the argued verdict. Never fabricate a reproduction.
- Record the exact command and its observed output.

## Confidence — what the number means

Never a bare number; tie it to the evidence tier.

| | |
|---|---|
| **0.9–1.0 locked** | a run probe confirmed it — the mechanism was demonstrated, not argued |
| **0.7–0.9 strong** | independent streams agree, no surviving rebuttal, no executed repro yet |
| **0.4–0.7 leaning** | best available, but largely circumstantial or single-stream, or a rebuttal partly landed |
| **0.2–0.4 weak** | plausible, but a rival is comparably supported |
| **0.0–0.2 unlikely** | contradicted, or lost the rebuttal; kept for completeness |

Nothing reaches ≥0.9 without an executed reproduction.

## Down-ranking and convergence

Say *why* a hypothesis moved down: contradicted by stronger evidence, missing the
observation it predicted, needing an extra ad hoc assumption, explaining fewer facts,
losing the rebuttal, or absorbed into a stronger parent. A reader who cannot see why one
explanation outranks another has been handed a verdict, not a diagnosis.

Two hypotheses converge only when they share a root mechanism, or when independent
evidence streams point at the same explanation. Similar wording from two lanes is not
convergence. Where two still imply *different next probes*, keep them apart however alike
they sound.

Pressure-test the leaders with these lenses where one can surface something new:
**systems** (queues, retries, backpressure, feedback loops, boundary failures),
**premortem** (assume the leader is incomplete — what would embarrass this trace later),
**science** (controls, confounders, measurement bias, falsifiable predictions).

## Output

```
### Observed result
### Ranked hypotheses
| rank | hypothesis | confidence | evidence tier | why it leads |
### Evidence for / against, per hypothesis
### Rebuttal round
    the best rebuttal to the leader, and whether it held
### Probe execution
    the exact command and its output — or `probe not executed: <reason>`
### Convergence notes
### Most likely explanation
### Critical unknown
### Next discriminating probe
    only if uncertainty survived the probe that was run
```
