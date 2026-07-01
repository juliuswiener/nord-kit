# nord-plan --consensus / --deliberate

Read this only when `--consensus` (or `--deliberate`) is set. The default tournament path does not use any of it.

## --consensus Mode (post-tournament validation)

`--consensus` adds a sequential Planner→Architect→Critic loop **after** the parallel tournament. Default path (no flag) = tournament only, unchanged.

**Trigger**: pass `--consensus` flag.

**Steps** (run after synthesis returns `final`):

1. **Planner** receives the tournament `final` plan as its starting draft. Planner MUST produce a compact **RALPLAN-DR summary** alongside the revised plan containing:
   - **Principles** (3-5)
   - **Decision Drivers** (top 3)
   - **Viable Options** (>=2) with bounded pros/cons for each; if only one option remains, explicit invalidation rationale for alternatives
   - In deliberate mode: **pre-mortem** (3 failure scenarios) and **expanded test plan** (unit / integration / e2e / observability)

2. **Architect** reviews for architectural soundness — `Task(subagent_type="nord-core:architect", ...)`. Review MUST include: strongest steelman antithesis against the favored option, at least one meaningful tradeoff tension, and (when possible) a synthesis path. **Await completion before step 3. Do NOT run steps 2 and 3 in parallel.**

3. **Critic** evaluates against quality criteria — `Task(subagent_type="nord-core:critic", ...)`. Run only after step 2 completes. Critic MUST verify: principle-option consistency, fair alternative exploration, risk mitigation clarity, testable acceptance criteria, concrete verification steps. Critic MUST explicitly reject shallow alternatives, driver contradictions, vague risks, or weak verification. In deliberate mode, Critic MUST reject missing/weak pre-mortem or missing/weak expanded test plan.

4. **Re-review loop** (max 5 iterations): If Critic returns ANY non-APPROVE verdict (ITERATE or REJECT), collect Architect + Critic feedback → Planner revises → return to step 2. Repeat until Critic approves or 5 iterations reached. At max iterations, present best version via `AskUserQuestion` noting consensus was not reached.

5. **Apply improvements**: Merge accepted Architect + Critic suggestions into the plan. Final consensus output MUST include an **ADR** section:
   - **Decision** — what was chosen
   - **Drivers** — which decision drivers were decisive
   - **Alternatives considered** — options evaluated with reasons not chosen
   - **Why chosen** — argument for the selected option
   - **Consequences** — positive and negative outcomes
   - **Follow-ups** — open questions or future work

6. **Persist** final plan to `.nord/plans/ralplan-<timestamp>.md` (exact naming required — `autopilot`'s glob `.nord/plans/ralplan-*.md` depends on it).

7. **Approval routing** — use `AskUserQuestion` (never plain text) with options:
   - **Approve execution via team** (Recommended) — invokes `Skill("nord-core:team")` with the plan path
   - **Approve execution via ralph** — invokes `Skill("nord-core:ralph")` with the plan path
   - **Compact then return for execution approval** — invokes compact to shrink accumulated planning context, then re-presents the pending-approval plan without auto-executing (recommended when context is 50%+ full after planning)
   - **Request changes** — return to step 1 with user feedback
   - **Reject** — discard plan entirely
   On approve, invoke the chosen execution skill. Do NOT implement directly in the planning agent. Before approval, mark plan `pending approval` and MUST NOT mutate files, commit, push, or delegate implementation.

   If `--interactive` is NOT set: output final plan marked `pending approval`, skip step 7 prompt, and stop without auto-executing.

## --deliberate Flag

Auto-enabled when `--consensus` is active AND any of these signals are detected: auth/security, migrations, destructive/irreversible changes, production incidents, compliance/PII, public API breakage. Manually forced with `--deliberate`.

In deliberate mode:
- Planner MUST include `preMortem` (exactly 3 failure scenarios) in the RALPLAN-DR summary
- Planner MUST include `testPlan` with unit / integration / e2e / observability coverage
- Architect MUST explicitly flag principle violations
- Critic MUST reject if `preMortem` is missing, has fewer than 3 scenarios, or scenarios are too generic; MUST reject if `testPlan` is missing or lacks any of the four coverage areas

## Quality Floors

Apply in **--consensus mode** (Critic enforces):

| Check | Floor | Reject if |
|---|---|---|
| File/path citations | 80% of steps name a file or path | < 80% steps cite a concrete file/path |
| Acceptance criteria testability | ≥ 90% of criteria are concrete and verifiable | < 90% criteria concrete/verifiable (vague terms like "fast", "better", "improved" without metrics) |
| Viable options | ≥ 2 options OR explicit invalidation rationale | Single option with no rationale |
| Pre-mortem (deliberate) | 3 distinct failure scenarios | < 3 or scenarios are generic/trivial |
| Test plan (deliberate) | All four areas covered | Missing unit, integration, e2e, or observability |

These floors are Critic-enforced within the re-review loop. Architect feedback is advisory; Critic verdict is binding.

## Plan Output Format

Required sections per mode:

| Mode | Required sections |
|---|---|
| Tournament (default) | `taskRestatement`, `outOfScope`, `summary`, `steps`, `risks`, `tradeoffs` |
| Consensus (`--consensus`) | All tournament sections + **RALPLAN-DR summary** (Principles, Decision Drivers, Viable Options) + **ADR** (Decision, Drivers, Alternatives considered, Why chosen, Consequences, Follow-ups) |
| Deliberate (`--deliberate`) | All consensus sections + **pre-mortem** (3 failure scenarios) + **expanded test plan** (unit / integration / e2e / observability) |

Plans are saved to `.nord/plans/ralplan-<timestamp>.md` (naming required — autopilot glob `.nord/plans/ralplan-*.md` depends on it). Drafts go to `.nord/drafts/`.

## State Persistence (nord-native, no omc dep)

In `--consensus` mode, manage lifecycle state via a plain JSON file — no `state_write` MCP required:

- **On entry**: create `.nord/state/nord-plan-<slug>.json` with `{ "active": true, "phase": "planning", "slug": "<slug>", "startedAt": "<iso-timestamp>" }`
- **On approval handoff** (→ ralph/team): set `active: false` (do NOT delete — execution mode may reference it)
- **On reject or error/abort**: delete the file entirely

`<slug>` = first 3 meaningful words of the task, lowercased, hyphenated (e.g., `add-user-auth`).

This replaces `state_write`/`state_clear` from omc — nord-plan is self-contained and carries no omc state-hook dependency.

## Provider Overrides (optional)

`--architect codex` and `--critic codex` swap a Claude pass for a Codex pass in consensus mode:

```
nord-plan --consensus --architect codex "task"
nord-plan --consensus --critic codex "task"
nord-plan --consensus --architect codex --critic codex "task"
```

Implementation: invoke `omc ask codex --agent-prompt <role> "<full review prompt>"` for that step.
If `omc ask codex` is unavailable, briefly note the fallback and continue with default Claude for that stage — do NOT abort.
