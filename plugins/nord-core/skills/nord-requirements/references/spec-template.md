# nord-interview spec template

Phase 4 writes the crystallized spec to `.nord/specs/nord-interview-<slug>.md` using this exact structure.

```markdown
# Nord Interview Spec: <title>

## Metadata
- Interview ID: <id>
- Rounds: <count>
- Final Ambiguity: <score>%
- Type: greenfield | brownfield
- Generated: <ISO-8601>
- Threshold: <resolvedThreshold>
- Threshold Source: <resolvedThresholdSource>
- Initial Context Summarized: <yes|no>
- Status: PASSED | BELOW_THRESHOLD_EARLY_EXIT | HARD_CAP

## Clarity Breakdown
| Dimension          | Score | Weight | Weighted |
|--------------------|-------|--------|----------|
| Goal Clarity       | <s>   | <w>    | <s*w>    |
| Constraint Clarity | <s>   | <w>    | <s*w>    |
| Success Criteria   | <s>   | <w>    | <s*w>    |
| Context Clarity    | <s>   | <w>    | <s*w>    |
| **Total Clarity**  |       |        | **<total>** |
| **Ambiguity**      |       |        | **<1-total>** |

## Topology
| Component       | Status   | Description              | Coverage / Deferral Note            |
|-----------------|----------|--------------------------|-------------------------------------|
| <component.name>| active   | <component.description>  | <covered acceptance criteria>       |
| <component.name>| deferred | <component.description>  | <user-confirmed deferral reason + timestamp> |

## Goal
<crystal-clear goal statement covering every active topology component>

## Constraints
- <constraint 1>
- <constraint 2>

## Non-Goals
- <explicitly excluded scope>

## Acceptance Criteria
- [ ] <testable criterion 1>
- [ ] <testable criterion 2>

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| <assumption> | <how questioned> | <what was decided> |

## Technical Context
<!-- brownfield: relevant codebase findings from explore agent -->
<!-- greenfield: technology choices and constraints -->

## Ontology (Key Entities)
<!-- Populate from the FINAL round's ontology_snapshots[-1]; do not re-generate at crystallization time -->
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| <entity.name> | <entity.type> | <entity.fields> | <entity.relationships> |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1     | <n>         | <n> | -       | -      | -              |
| 2     | <n>         | <n> | <n>     | <n>    | <ratio>%       |
| ...   | ...         | ... | ...     | ...    | ...            |

## Interview Transcript
<details>
<summary>Full Q&A (<n> rounds)</summary>

### Round 1
**Q:** <question>
**A:** <answer>
**Ambiguity:** <score>% (Goal: <g>, Constraints: <c>, Criteria: <cr>)

...
</details>
```

Coverage rule: every confirmed topology component appears in the Topology section — active (with covered acceptance criteria) or deferred (with user-confirmed reason + timestamp). No silent drops.
