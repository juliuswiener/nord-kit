# Workflow Invocation

Run the Workflow tool with the script below. Pass `args` as a JSON object.

```javascript
Workflow({
  script: `<embedded script below>`,
  args: {
    goal: '<research goal>',
    sessionId: '<session-id from pre-pipeline>',
    autoMode: false,                   // true for AUTO: prefix
    resumeStages: [],                  // array of already-completed stage ids on resume
  }
})
```

---

```javascript
export const meta = {
  name: 'nord-research',
  description: 'Parallel codebase investigation with tier-routed agents',
  phases: [
    { title: 'Decompose',   detail: 'break goal into 3-7 independent hypotheses' },
    { title: 'Investigate', detail: 'parallel tier-routed agents, cap 16 concurrent' },
    { title: 'Verify',      detail: 'cross-validation: contradictions / gaps / confidence' },
    { title: 'Synthesize',  detail: 'quality-gated findings, session state written' },
  ],
}

// --- Config ---
const goal          = (args && args.goal)          || 'the stated research goal'
const sessionId     = (args && args.sessionId)     || `research-${Date.now().toString(36)}`
const autoMode      = (args && args.autoMode)      || false
// EXPERIMENTAL (default OFF): args.cheapGather routes non-opus investigate stages to a $0 bridge
// worker; cross-validate stays frontier. Confident-wrong floor applies (../gate-loop/references/
// gate-pattern.md). Keep OFF until a no-regression A/B vs the haiku/sonnet baseline.
const cheapGather   = (args && args.cheapGather)   || false
const resumeStages  = (args && args.resumeStages)  || []

// --- Schemas ---
const STAGES_SCHEMA = {
  type: 'object',
  properties: {
    stages: {
      type: 'array', minItems: 3, maxItems: 7,
      items: {
        type: 'object',
        properties: {
          id:         { type: 'number' },
          name:       { type: 'string' },
          focus:      { type: 'string' },
          hypothesis: { type: 'string' },
          scope:      { type: 'string' },
          tier:       { type: 'string',  enum: ['LOW', 'MEDIUM', 'HIGH'] },
          model:      { type: 'string',  enum: ['haiku', 'sonnet', 'opus'] },
        },
        required: ['id', 'name', 'focus', 'tier', 'model'],
      },
    },
  },
  required: ['stages'],
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    stageId: { type: 'number' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id:               { type: 'string' },   // e.g. "2-3" = stage 2, finding 3
          title:            { type: 'string' },
          analysis:         { type: 'string' },
          evidence: {
            type: 'array', minItems: 1,
            items: {
              type: 'object',
              properties: {
                file:    { type: 'string' },      // ABSOLUTE path required
                lines:   { type: 'string' },
                content: { type: 'string' },
              },
              required: ['file'],
            },
          },
          confidence:       { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'], description: 'Anchored to evidence tier (B): HIGH = passed the citation gate AND a single unambiguous file:line; MEDIUM = derived / multi-site, no single snippet; LOW = pattern-level inference, no exact citation. Never the model\'s vibe.' },
          evidenceGrade:    { type: 'string', enum: ['explicit', 'derived', 'conflicts', 'source_unavailable'], description: 'Provenance (A — canonical vocab, see BEHAVIOUR.md). Computed by the Phase-3 citation gate: snippet found verbatim at cited path = explicit; inferred from code present, no single literal site = derived; snippet NOT at path = conflicts; path missing/unreadable = source_unavailable.' },
          confidenceReason: { type: 'string' },
        },
        required: ['id', 'title', 'evidence', 'confidence'],
      },
    },
  },
  required: ['stageId', 'findings'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdict:       { type: 'string', enum: ['VERIFIED', 'CONFLICTS'] },
    conflicts:     { type: 'array', items: { type: 'string' } },
    gaps:          { type: 'array', items: { type: 'string' } },
    qualityIssues: { type: 'array', items: { type: 'string' } },
    verifiedIds:   { type: 'array', items: { type: 'string' } },
    droppedIds:    { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'verifiedIds'],
}

// ── Phase 1: Decomposition (blocking) ────────────────────────────────────────
const decomp = await agent(
  `CODEBASE INVESTIGATION PLANNER — local analysis only, NO web search.

Research goal: "${goal}"

Decompose into 3-7 INDEPENDENT investigation stages. Rules:
- Each stage must be independently executable (no stage relies on another's findings)
- Each stage must target concrete codebase artifacts: files, functions, call sites, data flows, config, schemas
- Diversify perspectives — don't slice one axis N ways. Cover distinct lenses (data flow, control flow, error/edge paths, config & wiring, tests, recent git history) so stages surface what a single angle would miss (STORM perspective-discovery)
- Assign tier and model strictly by task complexity:

| Tier   | Model  | Use for                                                              |
|--------|--------|----------------------------------------------------------------------|
| LOW    | haiku  | File enumeration, pattern counting, grep lookups, "find all X"      |
| MEDIUM | sonnet | Code analysis, pattern detection, doc review, "how does X work"     |
| HIGH   | opus   | Architecture analysis, cross-cutting concerns, "why does X happen"  |

${resumeStages.length > 0 ? `Already completed stage ids (skip these): ${resumeStages.join(', ')}` : ''}

Output structured JSON with exactly the stages array.`,
  { label: 'decompose', phase: 'Decompose', model: 'sonnet', schema: STAGES_SCHEMA }
)

const stages = decomp.stages.filter(s => !resumeStages.includes(s.id))

// ── Phase 2: Parallel investigation (cap 16 concurrent) ───────────────────────
const stageResults = await parallel(
  stages.slice(0, 16).map(s => () => // 16 deliberate (resource budget)
    agent(
      `[RESEARCH_STAGE:${s.id}] CODEBASE INVESTIGATION — local analysis only, NO web search.
Use Read, Bash (grep, find, git log, wc), and file analysis. Never fetch URLs.

Stage:      ${s.name}
Tier:       ${s.tier} (model: ${s.model})
Focus:      ${s.focus}
Hypothesis: ${s.hypothesis || 'None stated — discover what is actually present'}
Scope:      ${s.scope || 'Entire codebase'}

Investigate thoroughly. Return a JSON object matching this schema (output mode: JSON — no free-text tags):

{
  "stageId": ${s.id},
  "findings": [
    {
      "id": "<stageId-N>",              // e.g. "${s.id}-1", "${s.id}-2"
      "title": "<concise descriptive title>",
      "analysis": "<detailed: what you found, what it means, how it works>",
      "evidence": [
        {
          "file": "<ABSOLUTE path — required; relative paths fail quality gate>",
          "lines": "<start-end>",
          "content": "<exact excerpt, 5-line context window where relevant>"
        }
      ],
      "confidence": "HIGH|MEDIUM|LOW",
      "confidenceReason": "<why this confidence; what would change it>"
    }
  ]
}

QUALITY GATE (schema-validated; findings that fail are DROPPED):
  - Every finding must have >= 1 evidence entry with an absolute file path (starts with /)
  - Every finding must have confidence: HIGH | MEDIUM | LOW
  - No speculative findings without direct code evidence`,
      { label: `investigate:${s.name}`, phase: 'Investigate', model: (cheapGather && s.model !== 'opus') ? 'worker' : s.model, schema: FINDING_SCHEMA }
    ).then(r => ({ ...(r || { stageId: s.id, findings: [] }), stageName: s.name, stageTier: s.tier, stageModel: s.model }))
  )
)

// ── MID-EXECUTION CHECKPOINT: persist partial state before cross-validation ───────
// After Phase 2 completes and BEFORE cross-validation runs, the orchestrating agent
// must write per-stage markdown + a partial state.json (status: 'in_progress') so
// a crash here leaves a resumable session. See 'Post-Pipeline Steps → Write Session State'
// for the exact format; emit status:'in_progress' and omit verification/totalFindings fields.
// ────────────────────────────────────────────────────────────────────────────────
// ── Phase 3: Cross-validation (sequential, after all parallel) ────────────────
const allFindings = stageResults.flatMap(r => (r && r.findings) || [])

const stageSummaries = stageResults.map((r, i) =>
  `Stage ${stages[i] ? stages[i].id : i+1} (${r.stageName || '?'}, ${r.stageTier || '?'}): ${(r.findings || []).length} raw findings`
).join('\n')

const validation = await agent(
  `[CROSS_VALIDATION] Verify consistency across all codebase investigation findings.

Goal: "${goal}"
Session: ${sessionId}

Stage summary:
${stageSummaries}

All findings:
${JSON.stringify(allFindings, null, 2)}

Cross-validate for:
0. CITATION GATE (deterministic — RUN it, don't eyeball) + PROVENANCE GRADE (A, canonical vocab — see
   BEHAVIOUR.md). For each finding's evidence run \`test -f <path>\` and \`grep -nF "<cited snippet/symbol>"
   <path>\`, and set its \`evidenceGrade\`:
   - snippet found verbatim at the cited path → \`explicit\`.
   - inferred from code that IS present but no single literal site → \`derived\`.
   - snippet NOT found at an existing path → \`conflicts\` (hallucinated citation — checked & wrong).
   - path missing/unreadable → \`source_unavailable\` (couldn't check).
   C rule: \`conflicts\` and \`source_unavailable\` must NOT be silently dropped into the same bucket as a
   coverage gap — SURFACE them as flagged items (in droppedIds with their grade noted) so "checked & wrong"
   stays distinct from "couldn't check" and from "not investigated". This exit-code check overrides the LLM
   checks below.
1. CONTRADICTIONS — Stage A claims X; Stage B claims not-X or the opposite. Flag the finding id pair and which evidence is stronger.
2. MISSING CONNECTIONS — A finding logically implies another stage should have found Y but didn't. Flag the gap.
3. COVERAGE GAPS — Sub-questions implied by the goal that no stage addressed.
4. EVIDENCE QUALITY — Findings with relative paths, zero evidence blocks, or HIGH confidence unsupported by code.

Decide which findings to drop (failed citation gate, weakest side of a contradiction, or quality violations).
Output [VERIFIED] if no significant contradictions, [CONFLICTS:<list of finding ids>] otherwise.`,
  { label: 'cross-validate', phase: 'Verify', model: 'sonnet', schema: VERIFY_SCHEMA }
)

// ── Quality gate: filter findings ─────────────────────────────────────────────
const dropped = new Set(validation.droppedIds || [])
const qualityFindings = allFindings.filter(f =>
  !dropped.has(f.id) &&
  Array.isArray(f.evidence) && f.evidence.length > 0 &&
  f.evidence.some(e => e.file && e.file.startsWith('/')) &&
  f.confidence
)

return {
  sessionId,
  goal,
  autoMode,
  stages:           decomp.stages.map(s => ({ id: s.id, name: s.name, tier: s.tier, model: s.model })),
  totalStages:      stages.length,
  totalFindings:    qualityFindings.length,
  droppedFindings:  allFindings.length - qualityFindings.length,
  findings:         qualityFindings,
  verification:     validation,
  coverageGaps:     validation.gaps     || [],
  conflicts:        validation.conflicts || [],
}
```

---
