# Report template

Written to `.nord/research/<session-id>/report.md` in Post-Pipeline step 1.

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

- Session state: `.nord/research/<session-id>/state.json`
- Raw stage findings: `.nord/research/<session-id>/stages/`
- Verified findings: `.nord/research/<session-id>/findings/verified/findings.md`
```
