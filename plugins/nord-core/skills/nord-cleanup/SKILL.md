---
name: nord-cleanup
description: "Multi-agent cleanup: parallel detectors (dead code, duplication, AI-slop, over-abstraction, unused deps) + verify-safe-to-remove, deletion-first plan. Use for 'cleanup', 'deslop', 'remove dead code', 'tidy this codebase'."

---

# nord-cleanup — multi-agent deletion-first cleanup

Invoking this skill IS opt-in to multi-agent orchestration. Run the Workflow tool with the
script below. Default scope: recently changed files / the path the user named — pass as
`args.target`.

This is REPORT-FIRST: the workflow returns a verified deletion plan. Present it, then apply
removals only after the user confirms (or if they said "apply"/"--fix"). Never delete on a
candidate that wasn't marked `safeToRemove`.

```javascript
export const meta = {
  name: 'nord-cleanup',
  description: 'Parallel detect + verify-safe code cleanup',
  phases: [
    { title: 'Detect', detail: 'parallel detectors' },
    { title: 'VerifySafe', detail: 'confirm each removal is safe' },
  ],
}
const target = (args && args.target) || 'this codebase (prefer recently changed files if a git diff exists)'
const DETECTORS = [
  { key:'dead-code',        prompt:'Unreachable / unused functions, variables, exports, whole files.' },
  { key:'duplication',      prompt:'Duplicated logic that should be unified into one implementation.' },
  { key:'ai-slop',          prompt:'AI-generated slop: redundant comments restating code, needless defensive cruft, ceremonial wrappers, dead scaffolding.' },
  { key:'over-abstraction', prompt:'Premature/single-use abstraction, indirection with one caller, config for things that never vary.' },
  { key:'unused-deps',      prompt:'Unused imports and package dependencies.' },
  { key:'ui-design',          prompt:'UI/design defaults: body text set at 11-12px without dense-data rationale, shadow on every surface (logo, card, background, icon), repetitive eyebrow/title/description/extra-<p> hierarchy stuffing, default AI palette (#3B82F6) without brand rationale, enforced uniform 3/4-col grids ignoring rhythm or emphasis, extreme gradients without brand ownership.' },
  { key:'boundary-violations', prompt:'Hidden coupling, misplaced responsibilities, wrong-layer imports, cross-layer side effects — code that violates its architectural boundary.' },
  { key:'missing-tests',      prompt:'Behavior not covered by tests: uncovered public functions, edge cases with no assertions, weak regression surface for the changed area.' },
]
const CAND_SCHEMA = { type:'object', properties:{ candidates:{ type:'array', items:{ type:'object',
  properties:{ file:{type:'string'}, lines:{type:'string'}, what:{type:'string'}, why:{type:'string'} },
  required:['file','what','why'] } } }, required:['candidates'] }
const SAFE_SCHEMA = { type:'object', properties:{ safeToRemove:{type:'boolean'}, reason:{type:'string'},
  refsFound:{type:'integer', description:'count of real references found by grep (0 required for symbol removals)'},
  refCmd:{type:'string', description:'the exact grep/search command you ran'},
  references:{type:'string'} }, required:['safeToRemove','reason','refsFound','refCmd'] }

const found = await parallel(DETECTORS.map(d => () =>
  agent(`Scan ${target} for ${d.key}: ${d.prompt} Report concrete removable candidates with file and line range. Only real, removable items.`,
        { label:`detect:${d.key}`, phase:'Detect', schema:CAND_SCHEMA })
    .then(r => ((r && r.candidates) || []).map(c => ({ ...c, detector:d.key })))))
const cands = found.filter(Boolean).flat()
const verified = await parallel(cands.map(c => () =>
  agent(`Verify SAFE TO REMOVE — DETERMINISTIC gate, not a judgement call.\n` +
        `1. RUN a real reference search (grep -rn / rg) for the symbol/file across the WHOLE repo (incl. dynamic uses: strings, configs, re-exports, DI, reflection). Report the exact command in refCmd and the real hit count in refsFound.\n` +
        `2. safeToRemove=true ONLY if refsFound==0 (for a symbol/file removal) AND it is not an external/public API / entrypoint. ANY real reference, doubt, or public surface → safeToRemove=false. Dead-code with 0 refs is the clean case.\n` +
        `Candidate (${c.detector}): "${c.what}" in ${c.file} ${c.lines||''} — ${c.why}`,
        { label:`safe:${c.file}`, phase:'VerifySafe', schema:SAFE_SCHEMA })
    .then(v => ({ ...c, ...v }))))
// deterministic gate: drop anything the grep didn't clear, regardless of the agent's own boolean
const safe = verified.filter(Boolean).filter(c => c.safeToRemove && (c.refsFound === 0 || c.refsFound == null && false))
return { totalCandidates: cands.length, safeToRemove: safe.length, plan: safe }
```

## When to Use

Use this skill when:
- the user explicitly says `deslop`, `anti-slop`, or `AI slop`
- the request is to clean up or refactor code that feels noisy, repetitive, or overly abstract
- follow-up implementation left duplicate logic, dead code, wrapper layers, boundary leaks, or weak regression coverage
- the user wants a reviewer-only anti-slop pass via `--review`
- the goal is simplification and cleanup, not new feature delivery

## When Not to Use

Do not invoke nord-cleanup when:
- the task is primarily a new feature build or product change
- the user wants a broad redesign instead of an incremental cleanup pass
- the request is a generic refactor with no simplification or slop intent
- behavior is too unclear to protect with tests or a concrete verification plan

## Execution Posture

These fire every turn:

- Preserve behavior unless the user explicitly asks for behavior changes.
- Lock behavior with focused regression tests first whenever practical.
- Write a cleanup plan before editing code.
- Prefer deletion over addition.
- Reuse existing utilities and patterns before introducing new ones.
- Avoid new dependencies unless the user explicitly requests them.
- Keep diffs small, reversible, and smell-focused.
- Stay concise and evidence-dense: inspect, edit, verify, and report.
- Treat new user instructions as local scope updates without dropping earlier non-conflicting constraints.

## Phase 0 — Behavior Lock (before Detect)

Before running the parallel detectors, establish a safety baseline:

1. Identify the behavioral contract: public APIs, expected outputs, test coverage.
2. Run the narrowest existing regression tests for the target scope.
3. If tests cannot run first, record an explicit verification plan before touching code — what to check, how, and when.

## `--review` Mode

Reviewer-only pass — no file edits. Use for writer/reviewer separation after cleanup is drafted.

1. **Do not start by editing files.**
2. Review the cleanup plan, changed files, and regression coverage.
3. Check specifically for:
   - leftover dead code or unused exports
   - duplicate logic that should have been consolidated
   - needless wrappers or abstractions that still blur boundaries
   - missing tests or weak verification for preserved behavior
   - cleanup that appears to have changed behavior without intent
4. Produce a reviewer verdict with required follow-ups.
5. Hand needed changes back to a separate writer pass instead of fixing and approving in one step.

## Cleanup Plan Before Code

Before applying any removals, produce and present a plan ordered safest-deletion-first. The plan must list: smell category, file(s), specific item to remove, and risk per item. Apply only after the plan is presented and (if not `--fix`) confirmed.

## Sequential Apply Passes (after VerifySafe)

Run one smell-focused pass at a time. Re-verify after each pass. Do not bundle unrelated refactors.

- **Pass 1** — Dead code deletion
- **Pass 2** — Duplicate removal
- **Pass 3** — Naming and error-handling cleanup
- **Pass 4** — Test reinforcement: add or strengthen tests to lock the surviving behavior

## Deterministic delete gate (the verdict — no LLM judge)

Deletion is the one place where "looks safe" is not good enough — a wrong delete is data loss. Two
deterministic gates, both exit-code, gate the plan AND each apply pass:

1. **Reference gate (per candidate, in VerifySafe):** a real `grep -rn`/`rg` for the symbol/file over the
   whole repo must return **0** real references (incl. dynamic: strings, configs, re-exports, DI,
   reflection) before it's eligible. The workflow drops any candidate whose `refsFound != 0` regardless of
   the agent's own opinion. Public API / entrypoints are never auto-safe.
2. **Build/test gate (per apply pass):** capture a GREEN baseline (`build` + the narrowest relevant
   `test`/`lint`/`typecheck`) BEFORE deleting. After each pass re-run the SAME commands —
   - still exit 0 → keep the pass.
   - non-zero → **revert that pass** (`git checkout`/restore), it was not safe. Never "fix forward" a
     cleanup regression; back it out.

Baseline must be green first — if the suite is red before cleanup, record that and only gate on *new*
failures. The gate is the exit code, not anyone's judgement.

## Scoped File-List Semantics

When `args.target` is an explicit file list, the workflow is bounded to those files. Do not silently expand a file-list scope into broader cleanup work unless the user explicitly asks for it.

## UI/Design Reviewer Checklist

Applies when the `ui-design` detector fires. Use as review prompts, not absolute bans — keep intentional brand, accessibility, product-density, or design-system choices that have a clear rationale.

- **Body text sizing:** flag text at 11-12px; Korean body copy generally needs ≥14px unless a validated dense-data exception applies.
- **Shadow restraint:** question box shadows on every surface, logo, background, card, or icon; keep shadows only where they clarify elevation or interaction.
- **Content hierarchy:** remove repetitive eyebrow/title/description/extra `<p>` stuffing when the title already carries the message; avoid generic emoji badges unless they are part of the product voice.
- **Palette rationale:** challenge default AI blue/purple palettes, especially Tailwind-like `#3B82F6`, when no brand or system rationale exists.
- **Layout rhythm:** avoid overly perfect 3- or 4-column uniform grids when rhythm, emphasis, asymmetry, or varied card weights would serve better.
- **Gradient restraint:** tone down extreme gradients unless the brand deliberately owns that visual language.

## Final Report Fields

Always report:
- **Changed files**
- **Simplifications**
- **Behavior lock / verification run** — which tests ran or what was explicitly recorded before editing
- **Remaining risks**

## Ralph Integration

When Ralph invokes nord-cleanup as a post-pass cleanup step:
- Run in standard mode (not `--review`) on the Ralph session's changed files only
- Caller (Ralph) re-runs regression verification after nord-cleanup completes
- `--review` remains a reviewer-only follow-up mode, not the default Ralph integration path

Invoke: `Skill("nord-cleanup")` scoped to session changed files only.
