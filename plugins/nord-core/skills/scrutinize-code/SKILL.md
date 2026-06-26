---
name: scrutinize-code
description: "Quick single-pass codebase critique: architectural rot, tech debt, code smells, naming, fitness as a base. Use for 'review my project', 'audit this codebase', 'find tech debt', 'should we rewrite'."

---

# Scrutinizing Projects

## Overview

You are the project's most exacting critic. **Diagnose, don't grade.** Every finding must name a location (`file:line` or module), a principle violated, and a concrete fix.

Borrow lenses from the great critics:
- **Ousterhout** — complexity is the enemy; favor deep modules; "different is worse than complex"
- **Fowler** — code-smell taxonomy; refactoring is continuous, not seasonal
- **Metz** — TRUE: Transparent, Reasonable, Usable, Exemplary; duplication is cheaper than the wrong abstraction
- **Hickey** — *simple* ≠ *easy*; un-complect; data > methods
- **Martin** — SOLID; dependencies point inward

## When to Use

- "Review my project", "audit the codebase", "is this well structured", "where is the rot"
- After significant organic growth, before a rewrite decision, before onboarding
- Pre-extension: "is this a good base for feature X?"

**Don't use for:** single-diff review (use `code-review`), security audits (use `security-review`), performance profiling, or style-only nitpicks.

## Method — Five Passes

Each pass builds the next. Do not skip ahead to judgment.

### 1. Orient — *do not critique yet*
Read README, top-level tree, entry points, manifest (`package.json` / `pyproject.toml` / `Cargo.toml` / etc.), and recent git activity. Identify the **intended** architectural style. You can only judge drift from intent if you know intent.

### 2. Map
Trace one user-facing feature end-to-end (request → response, CLI → output, event → side effect). List packages/modules with their stated responsibility. Note the seams between them — rot accumulates at seams.

### 3. Sample
Read 1–2 representative files per major module. Capture: naming conventions, function-size distribution, comment-to-code ratio, test presence, error-handling style.

### 4. Probe Hotspots
- High-churn files: `git log --pretty=format: --name-only | sort | uniq -c | sort -rn | head -30`
- Largest files (often god modules): `find . -name '*.ext' -exec wc -l {} + | sort -rn | head -20`
- Cross-module imports (coupling): grep for the most-imported names
- Build / config (where conventions break down)
- Tests — or their absence

### 5. Synthesize
Group raw observations into themes. Rate severity. Propose a remediation **order** — what unblocks what.

## What to Look For

### Architecture & Boundaries
- Layering violations (UI reaches into DB; domain imports framework)
- Circular dependencies between modules
- Leaky abstractions (interface lies about the implementation)
- Premature flexibility: interfaces with one impl, plugin systems with one plugin
- Coupling hotspots: a module that everything imports

### Modules
- **Shallow modules** (Ousterhout): broad interface, thin behavior — favor deep modules
- God modules; shotgun-surgery shape (one change → many files)
- Feature envy (a function repeatedly reaches into another module's data)
- Modules whose name and contents disagree

### Naming
- Vague suffixes: `Manager`, `Handler`, `Helper`, `Util`, `Service`, `Processor`, `Data`, `Info`
- Same concept under multiple names (`User` / `Account` / `Customer` mixed)
- Negative booleans (`notReady`), naked flags (`flag`, `enabled`)
- Encoded prefixes / hungarian residue (`m_`, `I` for interfaces in non-COM code)
- Functions that under-promise (name says less than the body does) or lie

### Functions / Methods
- > ~40 lines, > 3 parameters, mixed levels of abstraction
- Boolean-flag parameters that change behavior → split into two functions
- Hidden side effects under pure-looking names
- Output parameters; mutating arguments
- Optional parameters whose combinations multiply behavior modes

### Classes
- Anemic data with procedural managers elsewhere
- God classes (many unrelated responsibilities)
- Inheritance used for code reuse rather than polymorphism
- Constructors doing real work; static stateful helpers
- Singletons where the domain isn't actually singular

### Residues & Drift
- Commented-out code; `_old`, `_v2`, `.bak` files
- TODOs older than ~6 months
- Feature flags permanently on or off
- Compat shims for migrations long since complete
- Polyfills for retired runtimes/browsers
- Unused exports, dead branches, dependencies in the manifest that nothing imports

### Tests
- Coverage gaps on critical paths; mocks of mocks
- Tests asserting structure instead of behavior
- Slow or flaky suites
- Snapshot tests where unit tests belong

### Future-Extensibility
- Load-bearing types touched by everything (changing them is impossible)
- Brittle assumptions (single tenant, single user, single currency, single timezone)
- Missing anti-corruption layers at external boundaries
- Hard-to-change configuration (compiled-in constants, magic numbers)

### Documentation & Onboarding
- README accuracy — does the setup *actually* work?
- Entry-point discoverability
- Stale or aspirational comments
- Absence of decision records (ADRs) where decisions were non-obvious

## Five Questions a Great Critic Always Asks

1. **If a new dev joined tomorrow, what would silently confuse them?**
2. **Where does the code lie about itself?** (names vs. reality)
3. **What is each module's half-life?** Which is rewritten first, and why?
4. **Where is complexity accidental vs. essential?**
5. **What would have to be true for this to be a great codebase?** Inverse: what specifically prevents that?

## Severity Calibration

| Severity | Meaning |
|---|---|
| **Critical** | Blocks future work, has high blast radius, or risks correctness/security |
| **High** | Causes recurring friction; will compound; lives on hot paths |
| **Medium** | Real cost but contained; address in normal flow |
| **Low** | Polish; safe to defer |

Be honest. Inflated severity destroys trust; deflated severity hides real risk. **If everything is Critical, nothing is.**

## Output — One Critique File + Chat TL;DR

### The file
Write **one** markdown file. Default path: `SCRUTINY.md` at the repo root. Use a different path if the user requests, or if the repo already has a `SCRUTINY.md`/`CRITIQUE.md` — append a timestamp. Structure:

```markdown
# Project Scrutiny: <name>
Date: <YYYY-MM-DD>
Scope: <what was reviewed; explicitly what was NOT>
Stance: This is the honest view, not the gentle one.

## TL;DR
3–5 sentences. Overall verdict. Top 3 problems. 1–2 genuine strengths.

## Critical
### <Finding title>
- **Where:** `path/to/file.ts:42`, or module `pkg/foo`
- **What:** one paragraph, concrete
- **Why it's bad:** principle violated; observable consequence
- **How to fix:** numbered steps; first move; rough sketch of end state
- **Effort:** S / M / L

## High
…

## Medium
…

## Low / Nitpicks
…

## Strengths (Don't Break These)
- <thing that is working; future changes must preserve it>

## Recommended Order of Operations
1. <why this first — what it unblocks>
2. …

## Open Questions
- <things needing human input: product intent, deprecation policy, deadlines>
```

### The chat TL;DR
After writing the file, post a 5–10 line chat message:
- 1 line: overall verdict
- 3 bullets: top problems (each ≤ 1 line, with `file:line` or module)
- 1 bullet: a real strength
- 1 line: path to the full critique file

## Anti-Patterns — Critic Failure Modes

| Failure | Reality |
|---|---|
| Generic complaints ("needs more tests") | Name the file and the missing case. |
| Style nitpicks dressed as architecture | Keep style in Low; don't bury real findings. |
| Recommending a rewrite | Rewrites destroy embedded knowledge. Propose a refactor path first; rewrite is an Open Question. |
| Imported principles without evidence | Quote or cite the line that violates the principle. |
| "Looks good to me" | If you found nothing, you didn't look. Sample more. |
| Recommending patterns alien to the codebase | Match the project's idiom unless the idiom *is* the problem. |
| Severity inflation | If half the findings are Critical, recalibrate. |
| Confusing personal taste with rot | Taste goes in Nitpicks, if at all. |

## Red Flags — Stop and Reread

- 20+ findings but you've read fewer than 10 files → pattern-matching, not looking
- Every finding boils down to "should be more modular" → one hammer
- You can't point to a `file:line` for a claim → it's a vibe, not a finding
- You're proposing a framework switch → out of scope; move it to Open Questions
- You haven't named a single strength → you've slipped from critic to cynic
- The report doesn't say what to do **first** → you produced a list, not a critique
