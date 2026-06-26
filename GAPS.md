# Gap Audit — nord skills vs omc originals (8 independent auditors, 2026-06-26)

Each auditor grounded in skill-as-prompt quality first, then compared nord vs pristine omc 4.14.7.

## A. TRUE BUGS (functional — fix first)

| # | Skill | Bug | Fix |
|---|---|---|---|
| B1 | nord-research | **schema/tag format mismatch**: Workflow passes `FINDING_SCHEMA` (JSON) to stage agents BUT prompt tells them emit `[FINDING:]/[EVIDENCE:]/[CONFIDENCE:]` tags. Mutually exclusive — whichever agent picks breaks the other parser. Won't run correctly. | Drop schema from stage calls + keep tags, OR rewrite prompt to JSON + drop tag regex. Pick one output mode. |
| B2 | skill-auth | **path incompatibility**: advanced-skill-authoring §6 + skillify-derived save to `~/.claude/skills/omc-learned/`, but local-skill-manager scans `~/.claude/skills/<slug>/` + `.claude/skills/`. Within same plugin → skills created by §6 invisible to manager. | Canonicalize ONE path (recommend `<slug>/SKILL.md` dir-based), align §6 + local-skill-manager. |

## B. REGRESSIONS — lost guardrails/output (fix)

**nord-plan** (← plan+ralplan):
- Pre-execution GATE absent (the vague-ralph interceptor: anchor heuristics — file path/issue#/camelCase/≤15-word threshold/`force:` bypass). ralplan's defining feature. MAJOR.
- Critic ITERATE vs REJECT verdict collapsed to "rejects" — loses loop-trigger signal. MAJOR.
- 90% testable-criteria floor missing (only 80% file-cite floor ported). MAJOR.
- "Compact then return" approval option dropped. MAJOR.
- Plan output-format template (required sections) unspecified. MAJOR.

**nord-cleanup** (← ai-slop-cleaner):
- "Execution Posture" 9 behavioral bullets gone (deletion-first, no-new-deps, small-reversible-diffs, behavior-lock). HIGH — fire every turn.
- `missing-tests` not a parallel DETECTOR (only an apply pass). HIGH — weak-coverage smell unscanned.
- `--review` numbered procedure collapsed to prose (lost step1 `**Do not edit files.**` anti-substitution). HIGH.

**nord-review** (← code-reviewer+critic):
- Output format gutted: no APPROVE/REQUEST-CHANGES verdict, no "What's Missing", no Multi-Perspective Notes section. HIGH — consumer can't act.
- `lsp_diagnostics` mandate on modified files absent. HIGH — type errors silently pass.
- Per-finding `confidence` missing from FINDINGS_SCHEMA (severity×confidence collapsed) → Self-Audit Phase A has no structured data. HIGH.
- SOLID + named anti-patterns, complexity thresholds (>50 lines / cyclomatic >10), positive observations, API-contract checklist, gap-analysis phase. MED.

**multi-agent-codebase-audit Lane 5** (← security-reviewer):
- `ast_grep_search` for structural injection patterns dropped (regex grep misses multi-line/template injections). HIGH.
- `Failure_Modes_To_Avoid` (5 anti-patterns) gone. HIGH.
- Cross-validation uses generic skeptics, not security-specialist second opinion. MED-HIGH.

**verifier agent** (← omc verifier):
- `Final_Checklist` (5-point pre-verdict scan) dropped. HIGH — primary self-correction.
- Good/Bad Examples dropped (the "APPROVED. No fresh evidence" anti-pattern anchor). HIGH.
- Explicit stopping condition dropped. MED.
- (verify SKILL.md itself = nord BETTER; only "concise evidence over noisy logs" minor regression.)

**nord-interview** (← deep-interview):
- Step 3.5 midpoint threshold re-verification gate dropped → Phase 0 vars can fall out of context. HIGH.
- `$CLAUDE_CONFIG_DIR` absent from settings lookup → wrong threshold for non-default config dirs. HIGH.
- Round 0 four-component anti-collapse fixture gone → LLM collapses multi-component ideas. MED.
- Spec `Initial Context Summarized: yes|no` field missing. MED.

## C. INTENTIONAL DROPS (omc-runtime-specific — lower priority / by design)

- State persistence via `state_write`/`state_read` MCP (plan, interview) — omc state MCP. **Mitigation: write to `.omc/state/<skill>-<slug>.json` file instead** (keeps resume without omc dep). Worth doing for interview (CRIT in original) + plan.
- `companyContext` MCP call (plan, interview) — omc enterprise config. Optional, skip.
- Provider overrides `--architect/--critic codex` (plan) — needs `omc ask codex` CLI (omc still installed, callable). Could re-add.
- `--autoresearch` handoff (interview) — depends omc autoresearch. Stub/redirect or document unsupported.

## Priority for round-2 fixes
1. B1 + B2 (functional bugs) — mandatory.
2. Output/guardrail regressions that change behavior: review output+confidence+lsp, verify checklist+examples, cleanup posture+missing-tests, interview midpoint-gate+config-dir, plan pre-exec-gate+iterate/reject+floor, audit ast_grep+failure-modes.
3. File-based state persistence (interview, plan) as nord-native replacement for state_write MCP.
4. Skip: companyContext. Optional: provider-overrides, --autoresearch redirect.
