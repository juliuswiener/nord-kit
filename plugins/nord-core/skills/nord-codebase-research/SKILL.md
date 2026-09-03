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
| `/nord-core:nord-codebase-research <goal>` | Standard run with user checkpoints after decompose |
| `/nord-core:nord-codebase-research AUTO: <goal>` | Fully autonomous until `[PROMISE:RESEARCH_COMPLETE]` |
| `/nord-core:nord-codebase-research status` | Show current session progress from state.json |
| `/nord-core:nord-codebase-research resume [<session-id>]` | Resume most-recent (or named) interrupted session |
| `/nord-core:nord-codebase-research list` | List all sessions in `.nord/research/` |
| `/nord-core:nord-codebase-research report <session-id>` | Regenerate report from existing session state |
| `/nord-core:nord-codebase-research cancel` | Cancel current session (preserves state for resume) |

---

## Pre-Pipeline Steps (mandatory)

### 1. Command Routing

Parse `args` before touching the Workflow:

- **`status`** — `cat .nord/research/$(ls -t .nord/research | head -1)/state.json` and display progress.
- **`list`** — `ls -lt .nord/research/` + read each `state.json` for id/goal/status summary; display table.
- **`resume [id]`** — load `.nord/research/<id>/state.json` (or most-recent if id omitted); restore `goal`, `sessionId`, completed stage ids; pass to Workflow as `args`.
- **`report <id>`** — read `.nord/research/<id>/state.json` + all stage markdown files; generate report inline without re-running Workflow.
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
mkdir -p ".nord/research/$SESSION_ID/stages"
mkdir -p ".nord/research/$SESSION_ID/findings/raw"
mkdir -p ".nord/research/$SESSION_ID/findings/verified"
```

Pass `sessionId` to Workflow via `args`.

---

## Workflow Invocation

The full Workflow script: stage construction, tier routing, the agent prompts and the
cross-validation pass. Read when changing how the pipeline is built, not to run it.

See `references/workflow-invocation.md`.

## Post-Pipeline Steps (mandatory)

### 0. Mid-Pipeline Checkpoint (write BEFORE Workflow returns)

After Phase 2 parallel results arrive and BEFORE cross-validation runs, write partial state so a crash leaves a resumable session:

```bash
# Per-stage markdown — one file per stage
for each stageResult: write ".nord/research/$SESSION_ID/stages/stage-<id>.md" with raw findings JSON

# Partial state.json with status: in_progress
cat > ".nord/research/$SESSION_ID/state.json" << 'EOF'
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
cat > ".nord/research/$SESSION_ID/state.json" << 'EOF'
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
for each stage result: write ".nord/research/$SESSION_ID/stages/stage-<id>.md"
# Write verified findings: ".nord/research/$SESSION_ID/findings/verified/findings.md"
# Write report: ".nord/research/$SESSION_ID/report.md"
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

`.nord/research/<session-id>/state.json`:

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
.nord/research/<session-id>/
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

Written to `.nord/research/<session-id>/report.md` — structure in `references/report-template.md` (read at write-time).

---

## Tier Routing

Tier/model assignment table is in the Phase-1 decompose prompt above (LOW/haiku, MEDIUM/sonnet, HIGH/opus).

**Never down-tier to save cost on HIGH tasks.** Opus for architecture/causality is not optional — wrong model tier produces shallow findings with HIGH confidence, which the quality gate cannot catch.

---

## Troubleshooting

Common failure modes (verification loop, low-quality findings, AUTO-mode exhaustion, missing absolute paths) and fixes: `references/troubleshooting.md`.
