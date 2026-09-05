# plan --deep

Read this only when `--deep` is set. The default tournament path does not use any of it.

## `--deep` — post-tournament validation

`--deep` adds a sequential Planner→Architect→Critic loop **after** the parallel tournament. Default path (no flag) = tournament only, unchanged.

**Trigger**: pass `--deep` flag.

**Steps** (run after synthesis returns `final`):

1. **Planner** receives the tournament `final` plan as its starting draft. Planner MUST produce a compact **RALPLAN-DR summary** alongside the revised plan containing:
   - **Principles** (3-5)
   - **Decision Drivers** (top 3)
   - **Viable Options** (>=2) with bounded pros/cons for each; if only one option remains, explicit invalidation rationale for alternatives
   - In the widened pass: **pre-mortem** (3 failure scenarios) and **expanded test plan** (unit / integration / e2e / observability)

2. **Architect** reviews for architectural soundness — `Task(subagent_type="nord-core:expert", ...)`. Review MUST include: strongest steelman antithesis against the favored option, at least one meaningful tradeoff tension, and (when possible) a synthesis path. **Await completion before step 3. Do NOT run steps 2 and 3 in parallel.**

3. **Critic** evaluates against quality criteria — `Task(subagent_type="nord-core:expert", ...)`. Run only after step 2 completes. Critic MUST verify: principle-option consistency, fair alternative exploration, risk mitigation clarity, testable acceptance criteria, concrete verification steps. Critic MUST explicitly reject shallow alternatives, driver contradictions, vague risks, or weak verification. In the widened pass, Critic MUST reject missing/weak pre-mortem or missing/weak expanded test plan.

4. **Re-review loop** (max 5 iterations): If Critic returns ANY non-APPROVE verdict (ITERATE or REJECT), collect Architect + Critic feedback → Planner revises → return to step 2. Repeat until Critic approves or 5 iterations reached. At max iterations, present best version via `AskUserQuestion` noting consensus was not reached.

5. **Apply improvements**: Merge accepted Architect + Critic suggestions into the plan. Final consensus output MUST include an **ADR** section:
   - **Decision** — what was chosen
   - **Drivers** — which decision drivers were decisive
   - **Alternatives considered** — options evaluated with reasons not chosen
   - **Why chosen** — argument for the selected option
   - **Consequences** — positive and negative outcomes
   - **Follow-ups** — open questions or future work

6. **Persist** final plan to `.nord/plans/ralplan-<timestamp>.md` — exact naming required, because `implement --from plan` globs `.nord/plans/ralplan-*.md`.

7. **Approval routing** — use `AskUserQuestion` (never plain text) with options:
   - **Approve execution via implement** (Recommended) — invokes `Skill("nord-core:implement")` with the plan path and `--from plan --parallel`
   - **Approve execution (sequential)** — invokes `Skill("nord-core:implement")` with the plan path
   - **Compact then return for execution approval** — invokes compact to shrink accumulated planning context, then re-presents the pending-approval plan without auto-executing (recommended when context is 50%+ full after planning)
   - **Request changes** — return to step 1 with user feedback
   - **Reject** — discard plan entirely
   On approve, invoke the chosen execution skill. Do NOT implement directly in the planning agent. Before approval, mark plan `pending approval` and MUST NOT mutate files, commit, push, or delegate implementation. Nothing here hands work to execution on its own — the human says go.

## The widened pass

Not a flag. It switches itself on when `--deep` is active AND any of these signals is present: auth/security, migrations, destructive or irreversible changes, production incidents, compliance/PII, public API breakage.

When it is on:
- Planner MUST include `preMortem` (exactly 3 failure scenarios) in the RALPLAN-DR summary
- Planner MUST include `testPlan` with unit / integration / e2e / observability coverage
- Architect MUST explicitly flag principle violations
- Critic MUST reject if `preMortem` is missing, has fewer than 3 scenarios, or scenarios are too generic; MUST reject if `testPlan` is missing or lacks any of the four coverage areas

## Quality Floors

Apply in **--deep mode** (Critic enforces):

| Check | Floor | Reject if |
|---|---|---|
| File/path citations | 80% of steps name a file or path | < 80% steps cite a concrete file/path |
| Acceptance criteria testability | ≥ 90% of criteria are concrete and verifiable | < 90% criteria concrete/verifiable (vague terms like "fast", "better", "improved" without metrics) |
| Viable options | ≥ 2 options OR explicit invalidation rationale | Single option with no rationale |
| Pre-mortem (widened) | 3 distinct failure scenarios | < 3 or scenarios are generic/trivial |
| Test plan (widened) | All four areas covered | Missing unit, integration, e2e, or observability |

These floors are Critic-enforced within the re-review loop. Architect feedback is advisory; Critic verdict is binding.

## Plan Output Format

Required sections per mode:

| Mode | Required sections |
|---|---|
| Tournament (default) | `taskRestatement`, `outOfScope`, `summary`, `steps`, `risks`, `tradeoffs` |
| `--deep` | All tournament sections + **RALPLAN-DR summary** (Principles, Decision Drivers, Viable Options) + **ADR** (Decision, Drivers, Alternatives considered, Why chosen, Consequences, Follow-ups) |
| `--deep`, widened | All `--deep` sections + **pre-mortem** (3 failure scenarios) + **expanded test plan** (unit / integration / e2e / observability) |

Plans are saved to `.nord/plans/ralplan-<timestamp>.md` (naming required — the `implement --from plan` glob `.nord/plans/ralplan-*.md` depends on it). Drafts go to `.nord/drafts/`.

## State Persistence (nord-native, no nord dep)

In `--deep` mode, manage lifecycle state via a plain JSON file:

- **On entry**: create `.nord/state/nord-plan-<slug>.json` with `{ "active": true, "phase": "planning", "slug": "<slug>", "startedAt": "<iso-timestamp>" }`
- **On approval handoff** (→ `implement --from plan`): set `active: false` (do NOT delete — execution mode may reference it)
- **On reject or error/abort**: delete the file entirely

`<slug>` = first 3 meaningful words of the task, lowercased, hyphenated (e.g., `add-user-auth`).

This file is the only reader of that state file. It is **not** one of the `*-state.json` files the `gate-persist` Stop hook watches, so it never blocks a session from ending.

## Provider Overrides (optional)

`--architect codex` and `--critic codex` swap a Claude pass for a Codex pass in deep mode:

```
plan --deep --architect codex "task"
plan --deep --critic codex "task"
plan --deep --architect codex --critic codex "task"
```

Implementation: invoke `nord ask codex --agent-prompt <role> "<full review prompt>"` for that step.
If `nord ask codex` is unavailable, briefly note the fallback and continue with default Claude for that stage — do NOT abort.
