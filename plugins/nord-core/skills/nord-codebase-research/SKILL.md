---
name: nord-codebase-research
description: "Parallel codebase investigation: decomposes a research goal into 3-7 staged hypotheses, tier-routes each stage to haiku/sonnet/opus based on complexity, fires up to 16 agents concurrently, cross-validates findings for contradictions and gaps, and emits a structured report. Use for 'deep investigate', 'parallel research codebase', 'how does X work across the repo', 'find all patterns of Y', 'analyze authentication system', 'trace data flow', 'comprehensive codebase analysis'. CODEBASE-ONLY — no web search; local file reads, grep, and code analysis only."
argument-hint: "[AUTO:] <research goal> | status | resume [<session-id>] | list | report <session-id> | cancel"
---

# nord-research — parallel codebase investigation

Decomposes a codebase research goal into independent hypotheses, routes each to the right model tier, fires them concurrently, then cross-validates findings before synthesizing a structured report.

**Scope: CODEBASE ONLY.** This skill investigates local source code via file reads, grep, bash, and git. It does NOT search the web. For web/ideation research use `brainstorm`. For architectural audit with security/perf/CI lanes use `codebase-audit`.

---

## When to use vs alternatives

| Need | Use |
|---|---|
| "How does X work across the whole codebase?" | **nord-research** |
| "Find all usages/patterns of Y" | **nord-research** |
| "Trace data flow / auth flow / error path" | **nord-research** |
| "What does this module do?" (single file) | Read + Claude inline |
| Full pre-release health audit (12+ lanes) | `codebase-audit` |
| Quick single-pass critique | `scrutinize-code` |
| Web / industry / concept research | `brainstorm` |

---

## Commands

| Invocation | Action |
|---|---|
| `/nord-core:nord-research <goal>` | Standard run with user checkpoints after decompose |
| `/nord-core:nord-research AUTO: <goal>` | Fully autonomous until `[PROMISE:RESEARCH_COMPLETE]` |
| `/nord-core:nord-research status` | Show current session progress from state.json |
| `/nord-core:nord-research resume [<session-id>]` | Resume most-recent (or named) interrupted session |
| `/nord-core:nord-research list` | List all sessions in `.omc/research/` |
| `/nord-core:nord-research report <session-id>` | Regenerate report from existing session state |
| `/nord-core:nord-research cancel` | Cancel current session (preserves state for resume) |

---

## Pre-Pipeline Steps (mandatory)

### 1. Command Routing

Parse `args` before touching the Workflow:

- **`status`** — `cat .omc/research/$(ls -t .omc/research | head -1)/state.json` and display progress.
- **`list`** — `ls -lt .omc/research/` + read each `state.json` for id/goal/status summary; display table.
- **`resume [id]`** — load `.omc/research/<id>/state.json` (or most-recent if id omitted); restore `goal`, `sessionId`, completed stage ids; pass to Workflow as `args`.
- **`report <id>`** — read `.omc/research/<id>/state.json` + all stage markdown files; generate report inline without re-running Workflow.
- **`cancel`** — write `"status": "cancelled"` into the current `state.json`. Stop.
- **`AUTO: <goal>`** — strip prefix, set `autoMode: true`, proceed to Workflow.
- **anything else** — treat entire input as `goal`, `autoMode: false`.

Do NOT run the Workflow for status/list/report/cancel.

### 2. AUTO Mode Setup

If `autoMode` is true, state the iteration counter upfront:

```
[RESEARCH + AUTO — ITERATION 1/10]
Goal: <goal>
Proceeding autonomously until [PROMISE:RESEARCH_COMPLETE] or max iterations.
```

### 3. Session Directory

Before invoking Workflow, create the session directory:

```bash
SESSION_ID="research-$(date +%Y%m%d)-$(openssl rand -hex 3)"
mkdir -p ".omc/research/$SESSION_ID/stages"
mkdir -p ".omc/research/$SESSION_ID/findings/raw"
mkdir -p ".omc/research/$SESSION_ID/findings/verified"
```

Pass `sessionId` to Workflow via `args`.

---

## Workflow Invocation

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
          confidence:       { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
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
      { label: `investigate:${s.name}`, phase: 'Investigate', model: (cheapGather && s.model !== 'opus') ? 'qwen3.6-plus' : s.model, schema: FINDING_SCHEMA }
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
1. CONTRADICTIONS — Stage A claims X; Stage B claims not-X or the opposite. Flag the finding id pair and which evidence is stronger.
2. MISSING CONNECTIONS — A finding logically implies another stage should have found Y but didn't. Flag the gap.
3. COVERAGE GAPS — Sub-questions implied by the goal that no stage addressed.
4. EVIDENCE QUALITY — Findings with relative paths, zero evidence blocks, or HIGH confidence unsupported by code.

Decide which findings to drop (weakest side of a contradiction, or quality violations).
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

## Post-Pipeline Steps (mandatory)

### 0. Mid-Pipeline Checkpoint (write BEFORE Workflow returns)

After Phase 2 parallel results arrive and BEFORE cross-validation runs, write partial state so a crash leaves a resumable session:

```bash
# Per-stage markdown — one file per stage
for each stageResult: write ".omc/research/$SESSION_ID/stages/stage-<id>.md" with raw findings JSON

# Partial state.json with status: in_progress
cat > ".omc/research/$SESSION_ID/state.json" << 'EOF'
{
  "id": "<sessionId>",
  "goal": "<goal>",
  "status": "in_progress",
  "stages": [ ... each with status:"complete" and findingsCount ],
  "verification": { "status": "pending" },
  "updatedAt": "<ISO>"
}
EOF
```

### 1. Write Session State

After Workflow returns, persist state before presenting results:

```bash
# Write state.json
cat > ".omc/research/$SESSION_ID/state.json" << 'EOF'
{
  "id": "<sessionId>",
  "goal": "<goal>",
  "status": "complete",
  "mode": "standard|auto",
  "iteration": 1,
  "maxIterations": 10,
  "stages": [ ... ],
  "verification": { "status": "passed|failed", "conflicts": [], "gaps": [] },
  "totalFindings": N,
  "droppedFindings": N,
  "createdAt": "<ISO>",
  "updatedAt": "<ISO>"
}
EOF

# Write per-stage markdown
for each stage result: write ".omc/research/$SESSION_ID/stages/stage-<id>.md"
# Write verified findings: ".omc/research/$SESSION_ID/findings/verified/findings.md"
# Write report: ".omc/research/$SESSION_ID/report.md"
```

### 2. Present Findings

Group quality-gated findings by confidence (HIGH → MEDIUM → LOW):

```
## Research Findings — <goal>
Session: <sessionId> | Stages: N | Findings: M (dropped: K)
Verification: VERIFIED | CONFLICTS: [...]

### HIGH Confidence
[FINDING:1-1] <title>
Evidence: <file>:<lines>

### MEDIUM Confidence
...

### Coverage Gaps
- <gap 1>
- <gap 2>
```

### 3. AUTO Mode Promise

If `autoMode` is true:

- All stages complete, verification passed, report written → emit `[PROMISE:RESEARCH_COMPLETE]`
- Missing critical evidence, access blocked, circular contradiction → emit `[PROMISE:RESEARCH_BLOCKED]`

---

## AUTO Mode Protocol

Loop control (max 10 iterations):

```
[RESEARCH + AUTO — ITERATION {{N}}/10]
State: {{status from state.json}}
Completed stages: {{ids}}
Pending stages: {{ids or 'none'}}
```

On each iteration:
1. Load state.json
2. Run only pending stages (pass `resumeStages` of completed ids)
3. Merge new findings with existing
4. Re-run cross-validation over combined set
5. Update state.json
6. Check promise conditions

Promise conditions:
| Tag | Condition |
|---|---|
| `[PROMISE:RESEARCH_COMPLETE]` | All stages done + verification passed + report written |
| `[PROMISE:RESEARCH_BLOCKED]` | 3+ consecutive iterations yield 0 new findings, OR critical access blocked |

If max iterations hit without a promise: write partial report, emit `[PROMISE:RESEARCH_BLOCKED]` with summary of what's missing.

---

## Output Mode: JSON Schema (not free-text tags)

Stage agents return structured JSON validated against `FINDING_SCHEMA` — NOT free-text `[FINDING]`/`[EVIDENCE]`/`[CONFIDENCE]` tags. The schema is the single source of truth; no regex extraction is performed.

Expected agent response shape:

```json
{
  "stageId": 2,
  "findings": [
    {
      "id": "2-1",
      "title": "Auth tokens stored in localStorage",
      "analysis": "...",
      "evidence": [
        { "file": "/abs/path/src/auth.ts", "lines": "45-52", "content": "..." }
      ],
      "confidence": "HIGH",
      "confidenceReason": "Direct code evidence at cited lines"
    }
  ]
}
```

Quality gate — a finding is DROPPED if ANY of these fail:

| Check | Requirement |
|---|---|
| Evidence present | `evidence` array length >= 1 |
| Absolute path | `evidence[].file` starts with `/` |
| Confidence stated | `confidence` is `HIGH`, `MEDIUM`, or `LOW` |
| Reproducible | Another agent could verify from file + lines alone |

Dropped findings are counted (`droppedFindings`) but never shown in the report.

---

## Session State Format

`.omc/research/<session-id>/state.json`:

```json
{
  "id": "research-20240115-abc123",
  "goal": "Original research goal",
  "status": "in_progress | complete | blocked | cancelled",
  "mode": "standard | auto",
  "iteration": 3,
  "maxIterations": 10,
  "stages": [
    {
      "id": 1,
      "name": "Stage name",
      "tier": "LOW | MEDIUM | HIGH",
      "model": "haiku | sonnet | opus",
      "status": "pending | complete | failed",
      "findingsCount": 4,
      "findingsFile": "stages/stage-1.md",
      "completedAt": "ISO timestamp"
    }
  ],
  "verification": {
    "status": "pending | passed | failed",
    "conflicts": [],
    "gaps": [],
    "completedAt": "ISO timestamp"
  },
  "totalFindings": 12,
  "droppedFindings": 3,
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

Directory layout:

```
.omc/research/<session-id>/
  state.json
  stages/
    stage-1.md          # raw findings from stage 1 agent
    stage-2.md
    ...
  findings/
    verified/
      findings.md       # quality-gated, cross-validated findings
  report.md             # final synthesized report
```

---

## Report Template

Written to `.omc/research/<session-id>/report.md`:

```markdown
# Research Report: <goal>

**Session:** <session-id>
**Date:** <ISO date>
**Status:** complete | partial | blocked
**Stages:** N | **Findings:** M (dropped: K) | **Verification:** VERIFIED | CONFLICTS

## Executive Summary

<2-3 paragraphs: key findings, confidence levels, main patterns discovered>

## Methodology

| Stage | Name | Tier | Model | Findings |
|-------|------|------|-------|----------|
| 1 | <name> | LOW | haiku | 3 |
| 2 | <name> | HIGH | opus | 5 |

## Key Findings

### [FINDING:1-1] <title>
**Confidence:** HIGH
**Stage:** <name>

<analysis>

**Evidence:**
- `/absolute/path/to/file.ts:45-52`
  ```typescript
  <excerpt>
  ```

---

## Coverage Gaps

- <gap 1 — areas the goal implied but no stage addressed>

## Conflicts Resolved

- <conflict description — which finding was dropped and why>

## Limitations

- Sampling, not exhaustive — each stage reads files, not entire trees
- Static analysis only — no runtime verification
- <other scope constraints>

## Appendix

- Session state: `.omc/research/<session-id>/state.json`
- Raw stage findings: `.omc/research/<session-id>/stages/`
- Verified findings: `.omc/research/<session-id>/findings/verified/findings.md`
```

---

## Tier Routing Reference

| Task | Tier | Model |
|---|---|---|
| Count occurrences of X | LOW | haiku |
| Find all files matching Y | LOW | haiku |
| List all usages of Z | LOW | haiku |
| Analyze error handling patterns | MEDIUM | sonnet |
| Document how auth flow works | MEDIUM | sonnet |
| Review data model relationships | MEDIUM | sonnet |
| Explain why race conditions occur | HIGH | opus |
| Compare approaches A vs B | HIGH | opus |
| Identify architectural violations | HIGH | opus |

**Never down-tier to save cost on HIGH tasks.** Opus for architecture/causality is not optional — wrong model tier produces shallow findings with HIGH confidence, which the quality gate cannot catch.

---

## Troubleshooting

**Stuck in verification loop (AUTO mode)?**
- Check `state.json` for specific conflict ids
- Re-run with `resumeStages` listing completed ids — only conflicted stages re-run
- If conflict is unresolvable, verification passes with `CONFLICTS` verdict and both findings are included with a conflict note

**Stages returning low-quality findings?**
- Check tier assignment — architecture questions need HIGH/opus, not MEDIUM/sonnet
- Narrow `scope` in decomposition — too-broad stages get shallow coverage
- Check if research goal is too vague; decompose manually and pass custom stages

**AUTO mode exhausted 10 iterations without PROMISE?**
- Read `state.json` → check which stages have `status: "pending"` still
- Inspect stage markdowns for "no relevant files found" — goal may not apply to this codebase
- Consider splitting into two smaller research goals

**Missing absolute paths in evidence?**
- Stage agents occasionally use relative paths — these are automatically dropped by quality gate
- Increase specificity in scope: `"src/auth/*.ts and src/middleware/*.ts"` instead of `"authentication code"`
- Re-run failed stage with explicit note: "All evidence must use absolute file paths starting with /"
