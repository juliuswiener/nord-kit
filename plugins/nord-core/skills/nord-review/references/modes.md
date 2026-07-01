# nord-review flag-gated modes

Read the relevant section only when its flag is active. Default code-review (no flag) needs none of this.

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

Plan-review role lenses (substitute for the code-review lenses): **Executor** (can I do each step with only what's written? where will I get stuck?), **Stakeholder** (does this solve the stated problem? are success criteria measurable?), **Skeptic** (strongest argument this approach fails? is the rejection rationale sound?).

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

## API-Contract Review

Triggered by `--api-contract` or auto-detected when the diff touches routes, exported types, OpenAPI/GraphQL schemas, client SDKs, or versioned protocol surfaces. Run after the normal pipeline; append to output.

- **Breaking changes**: removed or renamed fields/endpoints, changed types, altered semantics, removed error codes
- **Versioning**: is there a version bump (semver / URL version / header) for any incompatible change?
- **Error semantics**: consistent error codes, meaningful messages, no leaking of internals; same error shape as existing API?
- **Backward compatibility**: can existing callers continue without changes? If not, is a migration path documented?
- **Spec / doc updates**: are new or changed contracts reflected in OpenAPI specs, GraphQL schema, or API docs?

Flag any breaking change as CRITICAL unless a migration path is explicitly provided.
