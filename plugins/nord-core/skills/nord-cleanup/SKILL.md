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
]
const CAND_SCHEMA = { type:'object', properties:{ candidates:{ type:'array', items:{ type:'object',
  properties:{ file:{type:'string'}, lines:{type:'string'}, what:{type:'string'}, why:{type:'string'} },
  required:['file','what','why'] } } }, required:['candidates'] }
const SAFE_SCHEMA = { type:'object', properties:{ safeToRemove:{type:'boolean'}, reason:{type:'string'}, references:{type:'string'} }, required:['safeToRemove','reason'] }

const found = await parallel(DETECTORS.map(d => () =>
  agent(`Scan ${target} for ${d.key}: ${d.prompt} Report concrete removable candidates with file and line range. Only real, removable items.`,
        { label:`detect:${d.key}`, phase:'Detect', schema:CAND_SCHEMA })
    .then(r => ((r && r.candidates) || []).map(c => ({ ...c, detector:d.key })))))
const cands = found.filter(Boolean).flat()
const verified = await parallel(cands.map(c => () =>
  agent(`Verify SAFE TO REMOVE. Search the whole codebase for references/uses and check tests. Be conservative: safeToRemove=false on any doubt or external/public API. Candidate (${c.detector}): "${c.what}" in ${c.file} ${c.lines||''} — ${c.why}`,
        { label:`safe:${c.file}`, phase:'VerifySafe', schema:SAFE_SCHEMA })
    .then(v => ({ ...c, ...v }))))
const safe = verified.filter(Boolean).filter(c => c.safeToRemove)
return { totalCandidates: cands.length, safeToRemove: safe.length, plan: safe }
```

## When Not to Use

Do not invoke nord-cleanup when:
- the task is primarily a new feature build or product change
- the user wants a broad redesign instead of an incremental cleanup pass
- the request is a generic refactor with no simplification or slop intent
- behavior is too unclear to protect with tests or a concrete verification plan

## Phase 0 — Behavior Lock (before Detect)

Before running the parallel detectors, establish a safety baseline:

1. Identify the behavioral contract: public APIs, expected outputs, test coverage.
2. Run the narrowest existing regression tests for the target scope.
3. If tests cannot run first, record an explicit verification plan before touching code — what to check, how, and when.

## `--review` Mode

Reviewer-only pass — no file edits. Use for writer/reviewer separation after cleanup is drafted.

Inspect the cleanup plan, changed files, and regression coverage for:

1. Leftover dead code or unused exports
2. Duplicate logic that should have been consolidated
3. Needless wrappers or abstractions that still blur boundaries
4. Missing tests or weak verification for preserved behavior
5. Cleanup that appears to have changed behavior without intent

Produce a reviewer verdict with required follow-ups. Hand needed changes to a separate writer pass — do not fix and approve in one step.

## Sequential Apply Passes (after VerifySafe)

Run one smell-focused pass at a time. Re-verify after each pass. Do not bundle unrelated refactors.

- **Pass 1** — Dead code deletion
- **Pass 2** — Duplicate removal
- **Pass 3** — Naming and error-handling cleanup
- **Pass 4** — Test reinforcement: add or strengthen tests to lock the surviving behavior

## Quality Gates (after each pass)

After every pass:
- Run lint and typecheck for the touched area
- Run unit/integration tests
- Run existing static or security checks when available
- Gate fails → fix the issue or back out the risky cleanup; never force it through

## Scoped File-List Semantics

When `args.target` is an explicit file list, the workflow is bounded to those files. Do not silently expand a file-list scope into broader cleanup work unless the user explicitly asks for it.

## UI/Design Reviewer Checklist

Applies when the `ui-design` detector fires. Use as review prompts, not absolute bans — keep intentional brand, accessibility, product-density, or design-system choices that have a clear rationale.

- **Body text sizing:** flag text at 11-12px; Korean body copy generally needs ≥14px unless a validated dense-data exception applies.
- **Shadow restraint:** question box shadows on every surface, logo, background, card, or icon; keep shadows only where they clarify elevation or interaction.
- **Content hierarchy:** remove repetitive eyebrow/title/description/extra `<p>` stuffing when the title already carries the message.
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
