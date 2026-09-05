---
name: review
description: "Judge finished work and return severity-rated findings, each anchored to a file:line that was actually read. Three axes: `--scope diff|repo|plan` (what is under review — a change, a whole codebase, or a plan before anyone builds it), `--lens security|a11y|claims` (narrow to one question), `--deep` (parallel specialists with every finding adversarially verified, instead of one pass). Defaults to a single pass over the current diff. Use for reviewing a diff or PR, auditing a codebase, checking whether a plan is sound, asking whether the documentation is true, or on 'schau dir das mal an', 'review das', 'ist der Code gut', 'stimmt das so'."
---

# review

One skill, three axes. Pick the cell, then read the one reference it names — everything
below the selection table lives in `references/` and is not loaded until you choose it.

## Pick the cell

**`--scope`** — what is under review. Default `diff`.

| | one pass | `--deep` |
|---|---|---|
| **`diff`** *(default)* | `references/diff.md` — general pass plus four lenses (API contract, style, performance, release readiness), verdict rules | `references/diff-deep.md` — parallel reviewers (correctness / security / performance / reuse), **every finding adversarially verified**, deduped, severity-ranked |
| **`repo`** | `references/repo.md` — single-pass critique of the whole tree: architectural rot, tech debt, code smells, naming, fitness as a base | `references/repo-deep.md` — 12+ parallel specialists across architecture, quality, tests, deps, security, performance, observability, CI, APIs, data, docs, resilience |
| **`plan`** | `references/plan.md` — assumptions extracted and rated, pre-mortem, dependency audit, ambiguity scan. Output is findings and a verdict, **not a plan** | — |

**`--lens`** — narrow to one question instead of the general pass. Composes with `--scope`.

| lens | reference | the question |
|---|---|---|
| `security` | `references/lens-security.md` | auth, input validation, output encoding, secrets, dependency CVEs — with a remediation deadline per severity |
| `a11y` | `references/lens-a11y.md` | WCAG 2.2 AA / BITV 2.0 / EN 301 549 and plain language for citizen-facing pages, with real tooling (axe-core/pa11y/Lighthouse) as a deterministic gate before any judgement |
| `claims` | `references/lens-claims.md` | **not whether the documentation is good — whether it is true.** Every conclusion traced back to running code, never to a doc. Normally `--scope repo --lens claims` |

## What every cell shares

These three hold for whatever cell you picked:

1. **A finding you cannot anchor is not a finding.** Every finding names a `file:line`
   you actually read. Drop it, or say in the summary that you could not anchor it and
   what would settle that. This is the rule `--deep` mechanises with its verifier pass;
   at one pass you enforce it yourself.
2. **One severity vocabulary.** CRITICAL / HIGH / MEDIUM / LOW, and the verdict follows
   from it: APPROVE (no CRITICAL or HIGH at high confidence) · REQUEST CHANGES
   (CRITICAL or HIGH at high confidence) · COMMENT (only LOW/MEDIUM). A CRITICAL or HIGH
   at LOW confidence goes under **Open Questions** — surfaced, but a verdict never rests
   on it alone. The table lives in `references/diff.md`; every other cell uses it.
3. **Read-only.** No cell edits, and none of them auto-fixes. Applying a finding is
   `implement` — a review that returns findings and then rewrites the code has no
   independent judge left.

## Choosing when the request is vague

- "review this" with uncommitted changes present → `--scope diff`, one pass.
- "is this codebase any good", "can we build on this", "due diligence" → `--scope repo`.
- "the docs say X, is that real", "what is actually true here" → `--scope repo --lens claims`.
- "check this before we start" on a plan, spec or ADR → `--scope plan`.
- Add `--deep` when being wrong is expensive: before a release, before a handover, or
  when a cheap pass already found something and you need to know what else is there.
  It costs parallel agents plus a verification round; do not reach for it by default.

`--deep` and `--scope` are orthogonal on purpose: breadth and depth are separate
questions, and `--scope repo --deep` says so where two booleans would not.

`references/lens-claims.md` is MIT-licensed work by Joseph Cumines; the notice travels
with it in `references/lens-claims/LICENSE`.
