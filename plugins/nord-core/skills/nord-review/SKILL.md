---
name: nord-review
description: "Multi-dimension adversarial code review: parallel reviewers (correctness/security/performance/reuse), each finding adversarially verified, deduped + severity-ranked. Use for 'deep review', 'multi-agent review', 'review my diff thoroughly', pre-merge."

---

# nord-review — multi-agent adversarial review

Invoking this skill IS opt-in to multi-agent orchestration. Run the Workflow tool with the
script below. First, inline, establish the review target (default: `git diff HEAD`; or the
files/PR the user named) and pass it as `args.target`.

Why this over a single reviewer: one model misses failure modes. Independent per-dimension
reviewers catch more; adversarial verification kills plausible-but-wrong findings before they
reach the user.

---

## Pre-Pipeline Steps (mandatory, run before the JS workflow)

### Pre-Commitment Predictions

Before reading the diff, based on domain + change type, write down 3-5 likely problem areas.
Investigate each one deliberately during the pipeline. Activates deliberate search, not passive reading.

### Stage 0 — Spec-Compliance Gate

Does the diff implement what was requested? Check intent alignment, not just code correctness:
- What was requested? (user message / PR description / linked ticket)
- Does the diff target the right problem at the right scope?
- Missing requirements? Scope creep? Wrong abstraction level?

**If Stage 0 fails: stop immediately. Report misalignment. Do NOT run the 4-dimension pipeline on off-target code.**

For trivial changes (single-line typo fix, no behavior change): Stage 0 is a quick sanity check, not a full compliance matrix.

### Mode Detection

`--plan` — input is a plan/proposal/spec, not code. Skip the JS pipeline; use the Plan Review Protocol below instead.
`--quality-strategy` / `--release-readiness` — run pipeline normally, then append Quality-Strategy assessment.
`--fix` — apply confirmed findings after pipeline (existing behavior).
`--comment` — post findings as inline PR comments (existing behavior).

### Discovery / Filtering Separation Doctrine

Dimension reviewers surface ALL findings annotated with `severity` + `confidence`. Never pre-filter during discovery. The adversarial-verify stage is the filter. When soft filter language appears in the request ("only important issues", "be conservative"), treat it as ranking guidance for output ordering, not a directive to silently drop findings. Recall is the reviewer's responsibility; precision is adversarial-verify's.

---

After the workflow returns, present `findings` grouped by severity (critical→low) as
`path:line — title. fix.`; if `--fix` was requested, apply the confirmed findings.

```javascript
export const meta = {
  name: 'nord-review',
  description: 'Multi-dimension adversarial code review',
  phases: [
    { title: 'Review', detail: 'parallel per-dimension reviewers' },
    { title: 'Verify', detail: 'adversarially verify each finding' },
  ],
}
const target = (args && args.target) || 'the current git diff (run: git diff HEAD)'
const DIMENSIONS = [
  { key: 'correctness', prompt: 'Logic bugs, off-by-one, null/undefined, error handling, race conditions, broken edge cases.' },
  { key: 'security',    prompt: 'Injection, authz/authn gaps, secret leakage, unsafe deserialization, path traversal, SSRF.' },
  { key: 'performance', prompt: 'N+1, needless allocation, sync-in-hot-path, missing indexes, accidental O(n^2).' },
  { key: 'reuse',       prompt: 'Duplicated logic, reinvented stdlib/lib, needless abstraction, simpler equivalent.' },
]
const FINDINGS_SCHEMA = { type:'object', properties:{ findings:{ type:'array', items:{ type:'object',
  properties:{ file:{type:'string'}, line:{type:'number'}, severity:{type:'string', enum:['critical','high','medium','low']},
  title:{type:'string'}, detail:{type:'string'}, fix:{type:'string'} }, required:['file','severity','title','detail'] } } }, required:['findings'] }
const VERDICT_SCHEMA = { type:'object', properties:{ isReal:{type:'boolean'}, confidence:{type:'string', enum:['high','medium','low']}, reason:{type:'string'} }, required:['isReal','reason'] }

const results = await pipeline(
  DIMENSIONS,
  d => agent(`Review ${target} for ${d.key} issues. ${d.prompt} Report concrete findings with exact file:line and a one-line fix. No praise, no nits.`,
        { label:`review:${d.key}`, phase:'Review', schema:FINDINGS_SCHEMA }),
  (review, d) => parallel(((review && review.findings) || []).map(f => () =>
    agent(`Adversarially verify this ${d.key} finding — actively try to REFUTE it. Default isReal=false if uncertain or unreproducible. Finding: "${f.title}" at ${f.file}:${f.line||'?'} — ${f.detail}`,
          { label:`verify:${f.file}`, phase:'Verify', schema:VERDICT_SCHEMA })
      .then(v => ({ ...f, dimension:d.key, verdict:v }))))
)
const order = { critical:0, high:1, medium:2, low:3 }
const confirmed = results.flat().filter(Boolean).filter(f => f.verdict && f.verdict.isReal)
confirmed.sort((a,b) => (order[a.severity]??9) - (order[b.severity]??9))
return { count: confirmed.length, findings: confirmed }
```

---

## Post-Pipeline Phases (mandatory for non-trivial changes)

### Phase A — Self-Audit

Re-evaluate each CRITICAL/HIGH confirmed finding before output:
1. Confidence: HIGH / MEDIUM / LOW
2. "Could the author immediately refute this with context I'm missing?" YES / NO
3. "Is this a genuine flaw or a stylistic preference?" FLAW / PREFERENCE

Rules:
- LOW confidence → move to **Open Questions** (not blocking verdict)
- Author-could-refute + no hard evidence → move to **Open Questions**
- PREFERENCE → downgrade to LOW or remove

### Phase B — Realist Check

For each CRITICAL/HIGH surviving Self-Audit, pressure-test severity:
1. Realistic worst case — not theoretical max; what would actually happen?
2. Mitigating factors — existing tests, deployment gates, monitoring, feature flags, traffic volume?
3. Detection time — immediate, within hours, or silent?
4. Hunting-mode bias — am I inflating severity because I found review momentum?

Recalibration rules:
- Realistic worst case = minor inconvenience + easy rollback → downgrade CRITICAL→HIGH
- Mitigating factors substantially contain blast radius → downgrade one level
- Fast detection + straightforward fix → note it in the finding (still a finding)
- Data loss / security breach / financial impact → NEVER downgrade; these earn their severity
- **Every downgrade MUST include "Mitigated by: ..." — no silent recalibrations**

Report all recalibrations in the verdict justification.

### Phase C — Adaptive Harshness

Start in **THOROUGH** mode (precise, evidence-driven, measured). Auto-escalate to **ADVERSARIAL** if:
- Any CRITICAL finding confirmed, OR
- 3+ HIGH/MAJOR findings confirmed, OR
- Systemic pattern detected (not isolated mistakes)

ADVERSARIAL mode: assume more hidden problems; hunt actively; challenge every design decision;
apply guilty-until-proven-innocent to unchecked claims; expand scope to adjacent code.

Report operating mode (THOROUGH / ADVERSARIAL) and reason in final output.

### Role-Based Lenses

Apply after the pipeline to surface issues dimension reviewers may miss:

**Code review:**
- **Security Engineer**: Trust boundaries crossed? Input not validated? What could be exploited?
- **New Hire**: Could someone unfamiliar follow this? What context is assumed but not stated?
- **Ops Engineer**: What happens at scale, under load, when dependencies fail? Blast radius?

**Plan review (--plan mode):**
- **Executor**: Can I do each step with only what's written? Where will I get stuck?
- **Stakeholder**: Does this solve the stated problem? Are success criteria measurable?
- **Skeptic**: Strongest argument this approach fails? Is the rejection rationale sound?

---

## --plan Mode Protocol

When `--plan` is active, skip the JS pipeline entirely.

**Step 1 — Key Assumptions Extraction**: List every assumption (explicit + implicit). Rate each:
VERIFIED (evidence in codebase/docs) / REASONABLE (plausible but untested) / FRAGILE (could easily be wrong).
Fragile assumptions are highest-priority targets.

**Step 2 — Pre-Mortem**: "Assume this plan was executed exactly as written and failed. Generate
5-7 specific, concrete failure scenarios." Check: does the plan address each? Unaddressed → finding.

**Step 3 — Dependency Audit**: For each step: inputs, outputs, blocking dependencies. Flag:
circular deps, missing handoffs, implicit ordering, resource conflicts.

**Step 4 — Ambiguity Scan**: "Could two competent developers interpret this differently?" If yes →
document both interpretations + risk of choosing the wrong one.

**Step 5 — Feasibility Check**: "Does the executor have everything needed (access, knowledge, tools,
permissions) to complete this without asking questions?"

**Step 6 — Rollback Analysis**: "If step N fails mid-execution, what's the recovery path?
Documented or assumed?"

**Devil's Advocate**: For each major decision: "What is the strongest argument AGAINST this approach?"
If constructible and the plan doesn't address it → finding.

Apply Self-Audit (Phase A) and Realist Check (Phase B) to all plan findings.

Evidence format for plans: backtick-quoted excerpts + step references, not just assertions.
Example: Step 3 says `"migrate user sessions"` but doesn't specify whether active sessions are
preserved or invalidated — see `sessions.ts:47` where `SessionStore.flush()` destroys all active sessions.

**Plan verdict**: REJECT / REVISE / ACCEPT-WITH-RESERVATIONS / ACCEPT

---

## Quality-Strategy / Release-Readiness Mode

Triggered by `--quality-strategy`, `--release-readiness`, or explicit shipping-decision context.
Run after the normal pipeline; append to output.

- Evaluate test coverage vs risk surface (unit, integration, e2e) for changed paths
- Identify missing regression tests for changed code paths
- Flag blocking defects, known regressions, untested paths
- Evaluate monitoring/alerting coverage for new features

**Risk-tier the change:**
- **SAFE** — evidence of coverage, no blocking defects; proceed normally
- **MONITOR** — ship with alerts armed; known gap but contained blast radius
- **HOLD** — must not ship until specific defect or coverage gap is fixed

Include risk-tier in final output.

---

## Final Output Additions

Append after the confirmed findings list:

**Open Questions** (low-confidence findings — surfaced, not blocking):
```
[severity] file:line — title (reason for low confidence)
```

**Operating Mode**: THOROUGH or ADVERSARIAL — reason if escalated

**Risk Tier** (quality-strategy mode only): SAFE / MONITOR / HOLD

**Realist Check recalibrations** (if any):
```
Finding #N downgraded critical→high — Mitigated by: <specific real-world factor>
```
