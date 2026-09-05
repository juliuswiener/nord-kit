---
name: plan-review
description: Reviews a plan, proposal, spec or ADR before anyone executes it — extracts and rates its assumptions, runs a pre-mortem, audits dependencies, scans for steps two developers would read differently, and returns a verdict with severity-rated findings. Use when asked to review or critique a plan, check a proposal before implementation, find holes in a spec, decide whether a design is ready to build, or when a plan came back from `plan` and needs a gate before work starts. For a diff or written code use the default cell of `review`; for "did it actually work" use verify.
---

# Plan review

A plan fails in execution for reasons that are visible before execution: an assumption
nobody checked, a step two people read differently, a dependency nobody sequenced. This
finds them.

Reviews evaluate what is present. Half of this procedure evaluates what is **absent**,
because that is what a plan omits and a reader supplies without noticing.

## Phase 1 — Predict before reading

Before reading the plan in detail, write down the 3–5 problem areas you expect, given the
domain. Then investigate each specifically.

This is not ceremony. A prediction turns passive reading into deliberate search, and
Phase 5 compares what you found against what you expected — a large gap in either
direction is itself information.

## Phase 2 — Verify every claim

Read it through, then extract **every** file reference, function name, API call and
technical claim, and check each against the actual source. A claim you did not verify is
the author's claim, not a finding and not a fact.

Then six passes:

**Assumptions.** List every assumption, explicit and implicit. Rate each:

| Rating | Means |
|---|---|
| VERIFIED | evidence in the codebase or docs |
| REASONABLE | plausible, untested |
| FRAGILE | could easily be wrong |

FRAGILE is where the failures live. Go there first.

**Pre-mortem.** "This plan was executed exactly as written and failed." Generate 5–7
concrete failure scenarios. For each, check whether the plan addresses it. One it does
not address is a finding.

**Dependencies.** Per step: inputs, outputs, what blocks it. Look for circular
dependencies, missing handoffs, implicit ordering, resource conflicts.

**Ambiguity.** Per step: could two competent developers read this differently? If yes,
write down both readings and what the wrong one costs.

**Feasibility.** Per step: does the executor have the access, knowledge, tools,
permissions and context to finish it without asking a question?

**Rollback.** If step N fails halfway, what is the recovery path — documented, or assumed?

**Devil's advocate.** For each major decision: what is the strongest argument against it?
What alternative was probably considered and dropped? If you cannot build a strong
counter-argument, the decision is likely sound. If you can, the plan should say why the
alternative lost.

Then simulate **every** step, not three of them. Would someone following only this plan
finish, or hit an undocumented wall?

## Phase 3 — Three perspectives

Each one surfaces a class of problem the others do not.

- **Executor** — can I do each step with only what is written? Where do I get stuck? What
  implicit knowledge is expected of me?
- **Stakeholder** — does this solve the stated problem? Are the success criteria
  measurable, or vanity metrics? Is the scope right?
- **Skeptic** — what is the strongest case that this fails? Was the rejected alternative
  rejected on reasoning, or waved away?

For a plan that contains code, add the code perspectives from `review-lenses`.

## Phase 4 — What is missing

Ask explicitly, because nothing in the document prompts you to:

- What would break this?
- Which edge case is unhandled?
- Which assumption could be wrong?
- What was conveniently left out?

## Phase 4.5 — Self-audit (mandatory)

Re-read your own findings. For each CRITICAL or MAJOR:

1. Confidence — HIGH / MEDIUM / LOW
2. Could the author refute this immediately with context you lack? YES / NO
3. Genuine flaw, or stylistic preference? FLAW / PREFERENCE

- LOW confidence → Open Questions
- Refutable and no hard evidence → Open Questions
- PREFERENCE → downgrade to Minor, or drop

## Phase 4.75 — Realist check (mandatory)

For each CRITICAL/MAJOR that survived, pressure-test the severity:

1. What is the realistic worst case — not the theoretical maximum?
2. What mitigates it that the review is ignoring: existing tests, deployment gates,
   monitoring, feature flags?
3. How fast would it be caught — immediately, within hours, or silently?
4. Are you inflating severity because you found momentum? (Hunting-mode bias.)

Recalibration:

- Realistic worst case is a minor inconvenience with easy rollback → CRITICAL becomes MAJOR
- Mitigations substantially contain the blast radius → downgrade one step
- Fast detection and straightforward fix → still a finding, but say so
- Survives all four at its current severity → correctly rated, keep it
- **Never** downgrade data loss, a security breach, or financial impact. Those earn it.

Every downgrade carries an explicit `Mitigated by: …`. No mitigation stated, no downgrade.

## Escalation

Start THOROUGH — precise, evidence-driven, measured. Escalate to ADVERSARIAL for the rest
of the review on any of:

- one CRITICAL finding
- three or more MAJOR findings
- a pattern suggesting something systemic rather than isolated

ADVERSARIAL means: assume more problems are hidden and hunt for them; challenge every
design decision, not only the obviously flawed; treat unchecked claims as guilty until
proven innocent; widen scope to adjacent steps that could be affected.

Say which mode you ended in and why.

## Evidence

Every CRITICAL or MAJOR finding carries concrete evidence. Without it, it is an opinion.

For a plan, evidence is:

- a backtick-quoted excerpt showing the gap or contradiction
- a step or section named by number
- a codebase reference that contradicts the plan (`file:line`)
- prior art the plan fails to account for
- a specific example showing why a step is ambiguous or infeasible

> Step 3 says `"migrate user sessions"` but does not say whether active sessions survive
> — `sessions.ts:47` has `SessionStore.flush()` destroying all of them.

## Output

```
VERDICT: REJECT | REVISE | ACCEPT-WITH-RESERVATIONS | ACCEPT

Overall assessment          2-3 sentences
Predictions vs findings     what you expected, what was actually there

Critical findings           blocks execution
  finding + evidence · confidence · why it matters · concrete fix
Major findings              causes significant rework
  same shape
Minor findings              suboptimal but functional

What's missing              gaps, unhandled edges, unstated assumptions
Ambiguity risks             quote -> reading A / reading B -> cost if wrong is chosen
Perspective notes           executor / stakeholder / skeptic, what the sections above missed

Verdict justification       why this verdict, what would change it, which mode you ended
                            in, any realist-check recalibrations
Open questions              speculative follow-ups + findings the self-audit moved here
```

If something is genuinely solid, say so in one line and move on. A review that finds only
problems in work that has few is a review nobody will trust the next time.
