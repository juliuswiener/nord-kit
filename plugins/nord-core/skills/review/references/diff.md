---
name: review --scope diff
description: Checklists and verdict rules for reviewing written code — a general pass plus four narrower lenses for API contracts, code style, performance, and release readiness. Use when reviewing a diff, a pull request, or a file that has already been implemented, when asked whether a change is safe to merge or ship, when checking an API for breaking changes, when a review should stay on style or on performance alone, or when a reviewer needs the severity and approval rules. For a plan or spec use review --scope plan; for orchestrating several reviewers at once use review --scope diff --deep.
---

# Review lenses

Pick the lens the request asks for. The general pass below always applies; the four
narrow lenses add to it and are worth naming explicitly, because a review asked for
"performance" that returns naming nits answered a different question.

Severity discipline — self-audit, realist check, escalation — is in `review --scope plan` and
applies here unchanged. This file is the checklists.

## General pass

**Security**

- no hardcoded secrets: API keys, passwords, tokens
- user input sanitised
- SQL/NoSQL injection prevented
- output escaped against XSS
- CSRF protection on state-changing operations
- authentication and authorisation actually enforced, not merely present

**Code quality**

- functions under ~50 lines
- cyclomatic complexity under 10
- nesting under 4 levels
- no duplicated logic
- names that say what the thing is

**Performance**

- no N+1 query patterns
- caching where it applies
- no O(n²) where O(n) exists
- no unnecessary re-renders (React/Vue)

**Practice**

- error handling present and appropriate to the failure
- logging at the right level
- public APIs documented
- critical paths tested
- no commented-out code

## Verdict

| Verdict | When |
|---|---|
| **APPROVE** | no CRITICAL or HIGH at HIGH confidence; minor improvements only |
| **REQUEST CHANGES** | CRITICAL or HIGH present at HIGH confidence |
| **COMMENT** | only LOW/MEDIUM, nothing blocking |

A CRITICAL or HIGH finding at LOW confidence goes under **Open Questions**. Surface it —
but a verdict does not rest on it alone.

## Lens: API contract

- **breaking changes** — removed fields, changed types, renamed endpoints, altered semantics
- **versioning** — is there a version bump for an incompatible change?
- **error semantics** — consistent codes, meaningful messages, no internals leaking out
- **backward compatibility** — can existing callers continue unchanged?
- **documentation** — is the new contract in the docs or the OpenAPI spec?

## Lens: style

Cite the project's conventions, never your own. Focus on CRITICAL (mixed tabs and spaces,
wildly inconsistent naming) and MAJOR (wrong case convention, non-idiomatic patterns). Do
not bikeshed trivia.

1. Read the config first — `.eslintrc`, `.prettierrc`, `tsconfig.json`, `pyproject.toml`.
   The conventions are stated there; guessing them is how a style review becomes an
   argument.
2. Formatting: indentation, line length, whitespace, brace style.
3. Naming: variables per language convention, constants `UPPER_SNAKE`, classes
   `PascalCase`, files per project convention.
4. Idiom: `const`/`let` over `var` in JS, comprehensions in Python, `defer` for cleanup in
   Go.
5. Imports: organised as the project organises them, none unused.
6. Mark what a tool can fix — `prettier`, `eslint --fix`, `gofmt`.

```
## Style review
**Overall**: PASS | MINOR ISSUES | MAJOR ISSUES
- `file.ts:42` [MAJOR] naming: `MyFunc` should be `myFunc` (project uses camelCase)
**Auto-fixable**: prettier --write src/
```

## Lens: performance

- algorithmic complexity — O(n²) loops, unnecessary re-renders, N+1 queries
- memory leaks, excessive allocation, GC pressure
- latency-sensitive paths and I/O bottlenecks
- where to put profiling instrumentation
- data structure and algorithm choice against the alternatives
- caching opportunities, and whether the invalidation is correct

Rate: CRITICAL (production impact) · HIGH (measurable degradation) · LOW (minor).

## Lens: release readiness

- test coverage against the risk surface: unit, integration, e2e
- missing regression tests for changed paths
- blocking defects, known regressions, untested paths
- which quality gates must pass before shipping
- monitoring and alerting coverage for anything new

Risk-tier the change on evidence: **SAFE** · **MONITOR** · **HOLD**.
