---
name: codebase-audit
description: "Full architectural audit: 12+ parallel specialists (architecture/quality/tests/deps/security/perf/observability/CI/APIs/data/docs/resilience) + adversarial verify, severity-ranked. Use for pre-release, handover, due-diligence, 'is this safe to build on'. Heavier than scrutinizing-projects."

---

# Multi-Agent Codebase Audit

## Overview

An architect-level audit that fans across **~12 specialist lanes in parallel**, **adversarially verifies high-severity findings** (3 skeptics per finding, majority refute → drop), then **synthesizes a severity-ranked report**. Read-only by default. Cleaning is a separate follow-up after human review of findings — auto-fix in an unfamiliar codebase is unsafe.

The audit surfaces *what will hurt*, not *what could be prettier*. Findings have category, severity, file/line, impact, recommendation, and effort. Linter-grade nits are out of scope — formatters and CI already catch those.

## When to use vs alternatives

| Need | Use |
|---|---|
| Quick single-pass critique, one critique file | `scrutinize-code` |
| Review a single PR or diff | `/code-review` or `/review` |
| Verify a specific fix works | `/verify` |
| Find a bug or trace a failure | `superpowers:systematic-debugging` |
| Security-only deep dive | `oh-my-claudecode:security-reviewer` directly |
| **Pre-release / pre-handover / due-diligence / quarterly health** | **this skill** |

## Running it

You MUST invoke the bundled Workflow script with **absolute paths** and **args as a JSON object** (not a string):

```
Workflow({
  scriptPath: '/home/<user>/.claude/skills/multi-agent-codebase-audit/audit.workflow.js',
  args: { path: '/absolute/path/to/repo', archetype: 'auto' }
})
```

**Common failure modes — avoid these:**
- ❌ `scriptPath: '~/.claude/...'` — tilde may not expand. Use full absolute path.
- ❌ `args: '{"path": "..."}'` — args must be a JSON object, not a string.
- ❌ Omitting `args` — the script has no cwd access and cannot infer the target. `args.path` is required.

**Args:**
- `path` (REQUIRED) — absolute path to the repo root.
- `archetype` — `auto` | `library` | `service` | `frontend` | `monorepo` | `cli` | `ml` | `embedded`. Determines which conditional lanes activate. `auto` lets Phase 1 infer it.
- `extraLanes` — array of conditional lane keys to force-enable (e.g. `['a11y', 'i18n', 'compliance']`).
- `severityFloor` — `low` | `medium` | `high` (default `low`). Drops findings below this severity from the synthesis.
- `maxFindingsPerLane` — default 20. Caps lane output for tractable synthesis.
- `verifyIntensity` — `off` | `lite` | `standard` (default) | `thorough`. **The single biggest cost lever.** Phase 3 verification used to spawn 3 independent skeptics *per* high-severity finding (e.g. 11 highs → 33 agents, ~45% of total spend). The tiers:
  - `standard` (default) — one **batched** verifier per lane reviews all that lane's high+critical findings in a single call (reads cited files once). ~80% fewer verification agents than the old behaviour, same false-positive protection.
  - `lite` — batch-verify **criticals only**; high findings pass straight to synthesis (human reviews them anyway). Cheapest pass that still guards the showstoppers.
  - `off` — trust the lanes, no verification. Only for a fast first look.
  - `thorough` — the original 3-skeptics-per-finding, majority-refute-drops behaviour. Reserve for acquisition / high-stakes / multi-contributor audits where a false positive is genuinely costly.
- `lanes` — array of core lane keys to run *instead of* all core lanes (e.g. `['security', 'deps', 'tests']`) for a cheap targeted pass. Conditional/`extraLanes` still apply on top.

If the user only says "audit this repo," first determine the absolute repo root via `git rev-parse --show-toplevel` (fall back to `pwd` if not a git repo), then pass it as `args.path`.

The script honors `budget` if the user set a token target with `+Nk`.

### Right-sizing the run (cost vs value)

The full default fan-out is calibrated for **due-diligence / acquisition / multi-contributor** repos. For a smaller or lower-stakes target, dial it down — the heavy run's marginal findings (low-sev doc nits, near-duplicate drift entries) rarely justify the tokens:

| Target | Recommended args |
|---|---|
| Personal / hobby / single-user, <100k LOC | `severityFloor: 'medium'`, `verifyIntensity: 'lite'` |
| Standard team service, pre-release | defaults (`verifyIntensity: 'standard'`) |
| Acquisition / compliance / high-stakes | `verifyIntensity: 'thorough'` |
| Targeted question ("is the security/deps story ok?") | `lanes: ['security','deps','config']`, `verifyIntensity: 'lite'` |

If the repo is small, single-author, and low-stakes, prefer `scrutinize-code` (single-pass) outright — see *When NOT to use this skill*.

### Operational note — don't fire-and-forget on an interruptible session

This is a long workflow (tens of minutes). If the launching session is suspended/closed mid-run the background workflow can orphan with no completion notification. It IS resumable: re-invoke with `resumeFromRunId: '<runId from the launch result>'` and completed agents return from cache. For unattended/cron use prefer a tighter config (above) so the wall-clock is short.

## The 5-phase topology

```
Phase 1: VITAL SIGNS + INTENT EXTRACTION (1 agent, blocking)
  ├─ Repo demographics, churn, branch protection, infer archetype
  ├─ Read README, ARCHITECTURE.md, ADRs/RFCs/design docs, CONTRIBUTING.md, CHANGELOG
  └─ Produce `vitals` + `intent` — flows into every lane's context. Findings get evaluated
     against stated intent (not generic best practice), drastically reducing false positives

Phase 2: PARALLEL LANES (12 agents + N conditional, all concurrent)
  ├─ Each lane gets the vital-signs context + its scope
  ├─ Returns structured findings list (capped)
  └─ Output streams into Phase 3 per-lane as it completes (pipeline, not barrier)

Phase 3: ADVERSARIAL VERIFICATION (3 agents per high-severity finding, concurrent)
  ├─ Each verifier prompted to REFUTE the finding
  ├─ ≥2/3 refute → finding dropped
  ├─ Reduces false positives from pattern-matching lanes
  └─ Lane 5 (Security) HIGH/CRITICAL findings: use `oh-my-claudecode:security-reviewer` subagent type for cross-validation — security-domain prompt, not a generic skeptic

Phase 4: BLAST RADIUS (1 agent, concurrent with Phase 2)
  └─ 90-day churn heatmap, hotspot overlap with low-coverage modules

Phase 5: SYNTHESIS (1 agent, blocking after 2+3+4)
  ├─ Dedupe findings across lanes (security and deps both flag the same CVE)
  ├─ Cluster by file/module (which files have findings from 4+ lanes?)
  ├─ Severity calibration & effort estimate
  └─ Final report: "Top fix this quarter" rollup + full appendix
```

## The 13 core lanes

| # | Lane | Specialist agent | Primary scope |
|---|------|------------------|---------------|
| 1 | Architecture & Module Boundaries | `architect` | Coupling, cycles, layering violations, stated-vs-actual structure |
| 2 | Code Quality & Smells | `code-reviewer` | Complexity hotspots, duplication, dead code, god classes, TODO age |
| 3 | Test Health | `test-engineer` | Coverage by tier, flakiness, isolation, mock drift, untested critical paths |
| 4 | Dependencies & Supply Chain | (general) | Versions, CVEs, licenses, abandoned packages, lockfile drift |
| 5 | Security | `security-reviewer` | Secrets (current + git history), OWASP A01–A10 full coverage, crypto, authn/authz centralization, dependency audit (npm/pip/cargo/govulncheck); findings prioritized by severity × exploitability × blast-radius |
| 6 | Performance & Scalability | (general) | Algorithmic hotspots, N+1, sync I/O, index coverage, bundle size |
| 7 | Observability & Operations | (general) | Logging coverage, metrics, tracing, health checks, idempotency |
| 8 | Build, CI/CD & Release | (general) | Pipeline correctness, reproducibility, deploy, rollback, FF hygiene |
| 9 | API & Contract Design | (general) | Versioning, consistency, OpenAPI coverage, error response shape |
| 10 | Data & Schema | (general) | Migration safety, constraints, PII, retention, event versioning |
| 11 | Documentation & Onboarding | `document-specialist` | README, ADRs, runbooks, comment quality, tribal-knowledge files |
| 12 | Configuration, Secrets & Resilience | (general) | Config validation, secret mgmt, timeouts, circuit breakers, degradation |
| 13 | **Stated vs Actual Drift** | `architect` | **Claims in docs vs reality in code** — architecture drift, quality-bar drift, API/schema drift, stalled migrations, doc rot, compliance-claim drift |

Plus meta-lanes M1 (Vital Signs + Intent Extraction), M2 (Blast Radius), M3 (Synthesis), M4 (Adversarial Verification — runs per finding, not as a separate phase).

### Lane 5 Security — Extended Scope

Beyond the basic OWASP pattern scan, the security lane MUST:

**Read-only guard:** MUST NOT call Write or Edit; read and report only.

1. **Git-history secrets scan** — `git log -p --since="2 years ago" | grep -iE 'api[_-]?key|password|secret|token'` to surface secrets committed then later removed. Complements current-code grep. (Extend `--since` to full history for compliance/acquisition audits.)
2. **Current-code secrets grep** — `grep -rniE 'api[_-]?key|password|secret|token'` across source files (exclude `node_modules`, `.git`, test fixtures).
3. **Structural injection patterns** — use `ast_grep_search` for multi-line and template-literal patterns that regex grep misses: `exec($CMD + $INPUT)`, `query($SQL + $INPUT)`, `innerHTML = $X`. Grep catches simple string patterns; AST grep catches structural composition across line boundaries.
4. **Dependency audit** — run whichever tools apply to the project: `npm audit`, `pip-audit`, `cargo audit`, `govulncheck`. Flag CRITICAL and HIGH CVEs.
5. **OWASP Top 10 (A01–A10) full checklist** — every category evaluated, not just pattern-matched:
   - A01 Broken Access Control — authorization on every route, CORS configured
   - A02 Cryptographic Failures — strong algorithms (AES-256, RSA-2048+), secrets in env vars, PII encrypted
   - A03 Injection (SQL/NoSQL/Command/XSS) — parameterized queries, input sanitization, output escaping
   - A04 Insecure Design — threat modeling, secure design patterns
   - A05 Security Misconfiguration — defaults changed, debug disabled, security headers set
   - A06 Vulnerable Components — dependency audit, no CRITICAL/HIGH CVEs in runtime deps
   - A07 Authentication Failures — bcrypt/argon2 hashing, secure sessions, JWT validation
   - A08 Software & Data Integrity Failures — signed updates, verified CI/CD pipelines
   - A09 Security Logging & Monitoring Failures — security events logged, monitoring in place
   - A10 SSRF — URL validation, allowlists for outbound requests

   Each finding includes: location (`file:line`), OWASP category, severity, exploitability (remote/local, authed/unauthed), blast-radius, and a secure-code remediation example in the same language as the vulnerable code.
6. **Granular sub-checks** beyond the OWASP categories:
   - Session-token entropy — tokens must be cryptographically random (≥128 bits); check generation sites
   - File-upload validation — verify type (magic bytes, not just extension), size limits, and content scanning
   - Secrets-not-logged — secrets, tokens, and PII MUST NOT appear in log statements or error messages
   - JSON-response encoding — check for XSS via `Content-Type` mismatch and unescaped user data in JSON
7. **Prioritization** — rank by `severity × exploitability × blast-radius`, not severity alone. A remotely exploitable unauthenticated SQLi with full DB access outranks a local-only information disclosure even if both are labeled HIGH.

**Remediation timelines** — self-tag every finding with its urgency tier at the point of discovery (do not defer to synthesis):

| Timeline | Applies to |
|---|---|
| **Immediate** | Exposed secrets (rotate before anything else) |
| **24 h** | CRITICAL vulnerabilities (RCE, unauthenticated data breach, credential theft) |
| **1 week** | HIGH vulnerabilities (exploitable under specific conditions, serious impact) |
| **1 month** | MEDIUM vulnerabilities (limited impact or hard to exploit) |
| **Backlog** | LOW / best-practice violations (schedule when convenient) |

**Failure modes to avoid:**
- **Surface-level scan** — Only checking for `console.log` while missing SQL injection. Follow the full OWASP checklist.
- **Flat prioritization** — Listing all findings as "HIGH." Differentiate by severity × exploitability × blast-radius.
- **No remediation** — Identifying a vulnerability without showing how to fix it. Always include secure code examples.
- **Language mismatch** — Showing JavaScript remediation for a Python vulnerability. Match the language.
- **Ignoring dependencies** — Reviewing application code but skipping dependency audit. Always run the audit.

**Per-lane Final Checklist** (verify before returning results):
- Evaluated all A01–A10?
- Ran secrets scan (`git log -p --since="2 years ago"` + current-code grep) + dependency audit?
- Every finding has: `file:line` + severity + OWASP category + exploitability + blast-radius + same-language secure-code example?
- All findings self-tagged with remediation timeline (Immediate / 24h / 1w / 1mo / Backlog)?
- Used `ast_grep_search` for structural injection patterns (not just grep)?
- Granular sub-checks completed (session-token entropy, file-upload type/size/content, secrets-not-logged, JSON encoding)?

**Intent flows everywhere.** Phase 1 produces a structured `intent` object (purpose, non-goals, stated architecture, stated quality bar, known debt, constraints, in-flight migrations) extracted from README/ARCHITECTURE/ADRs/CONTRIBUTING/design docs. Every lane evaluates findings against this — a "best practice violation" the docs accept is not a finding; a "violation of what the docs claim" is. Lane 13 explicitly hunts for the latter.

## Conditional add-on lanes

Activated by archetype detection or `extraLanes` arg:

| Key | Lane | Trigger |
|---|---|---|
| `a11y` | Frontend Accessibility | `frontend` archetype |
| `bundle` | Bundle & Render Perf | `frontend` archetype |
| `i18n` | Internationalization | Detected `i18n`/`locale` directories |
| `compliance` | Regulatory Touchpoints | Explicit opt-in (GDPR/HIPAA/PCI/SOC2 context) |
| `ml` | ML Pipeline Health | `ml` archetype |
| `embedded` | Memory & Real-time | `embedded` archetype |

## Project-archetype adaptations

`auto` mode infers archetype from manifest files & layout:

- `package.json` + framework (React/Vue/Next) → `frontend`
- `package.json` no framework + `bin/` → `cli`
- `pyproject.toml` + Dockerfile + service entry → `service`
- Multiple manifests in subdirs → `monorepo`
- `setup.py` + no service entry → `library`
- `notebooks/` + `pyproject.toml` with `torch`/`tensorflow` → `ml`

Each archetype tunes which lanes are mandatory vs deprioritized. A library has different test-pyramid expectations than a service; a frontend can skip Lane 10 (Data); a monorepo runs each lane per package.

## Output

The workflow returns structured data. **You (the invoking agent) then write three files** under `<repo>/.audit/<YYYY-MM-DD>/` and run the post-audit decision flow.

| File | Audience | Contents |
|---|---|---|
| `findings.json` | LLM / tooling | All findings + triage + parallelization + vitals + blast, machine-readable |
| `report.md` | Engineers reading async | Full report: verdict, executive summary, every finding with evidence, hotspot map, methodology, security remediation timelines |
| `summary.md` | Decision-maker, 30-second scan | `report.summary_markdown` verbatim — verdict, Top 3, bucket counts, no-brainer list, quick-win groups, needs-decision options |

**Security remediation timelines** — the synthesis agent MUST include this table in `report.md` whenever the security lane returns findings:

| Timeline | Applies to |
|---|---|
| **Immediate** | Exposed secrets (rotate before anything else) |
| **24 h** | CRITICAL vulnerabilities (RCE, unauthenticated data breach, credential theft) |
| **1 week** | HIGH vulnerabilities (exploitable under specific conditions, serious impact) |
| **1 month** | MEDIUM vulnerabilities (limited impact or hard to exploit) |
| **Backlog** | LOW / best-practice violations (schedule when convenient) |

## Post-audit triage

The synthesis agent classifies every finding into exactly one bucket:

| Bucket | Criterion |
|---|---|
| **NO BRAINER** | Trivially correct, <1h each, no design decision, no regression risk. Pin lockfile; bump known-safe CVE patch; add missing timeout; delete unused export. "Would you do it in 30 seconds without asking?" |
| **QUICK WIN** | Clear fix, <1 day each, low coordination, real value. "Add test for X", "centralize Y", "validate Z at boundary." |
| **NEEDS DECISION** | Requires user judgment between viable options. 2-4 options surfaced with pros/cons/effort + a recommendation only when one is clearly superior. |
| **MAJOR CHANGE** | >1 week or coordinated migration. Plan it, don't just do it. |
| **DEFER / ACCEPT** | Real finding, not worth fixing now. Justified per-item. |
| **INVESTIGATE** | Insufficient info — needs deeper analysis or data before acting. |

Every finding lives in exactly one bucket. The user is shown the breakdown before any work is done.

## Parallelization analysis

The synthesis groups Quick Wins and Major Changes into work-clusters and labels:

- **Concurrent groups** — independent file scopes, no logical dependency; safe to fan out across agents/contributors
- **Blocking dependencies** — e.g. "upgrade lib X first, then use new API"
- **Critical path** — longest blocking chain, determines minimum wall-clock for the cleanup
- **Coordination caveats** — shared-file conflicts, migration windows, deploy ordering

This lets the user compress remediation by dispatching parallel agents (`superpowers:dispatching-parallel-agents` or `oh-my-claudecode:ultrawork`) against independent groups.

## After the workflow returns: required steps

When the workflow completes, you (the invoking agent) **MUST** do the following in order:

### 1. Write outputs to disk

```bash
DATE=$(date -I)  # YYYY-MM-DD
mkdir -p "<repo>/.audit/$DATE"
```

- `findings.json` ← `JSON.stringify({ vitals, blast, findings, report, laneSummaries }, null, 2)`
- `report.md` ← assemble from `report.{verdict, verdict_rationale, executive_summary, top_risks, clusters, quarter_plan, methodology_notes}` + a markdown table of every finding (id, severity, lane, file:lines, title)
- `summary.md` ← `report.summary_markdown` verbatim

### 2. Show the summary to the user

Display the contents of `summary.md` in chat. This is the only thing the user needs to read end-to-end.

### 3. Present next-step options

Use `AskUserQuestion` with these options (multi-select where applicable):

| Option | What happens |
|---|---|
| **Apply NO BRAINER fixes** (recommended) | Create branch `audit/<date>-no-brainers`. Apply each no-brainer fix one at a time using the right tool (Edit for code, Bash for tooling like lockfile pin or `npm pkg fix`). After each, run any cheap local check. **Show the diff and stop for user review before committing.** Never push without explicit approval. |
| **Walk through NEEDS DECISION items** (recommended) | Interactive loop: for each item, present options via `AskUserQuestion`, capture choice, append it to `findings.json` as `triage.needs_decision[i].user_decision`. Resolved items then route into a QUICK WIN sprint or a MAJOR CHANGE plan based on the chosen option's effort. |
| **Plan a QUICK WIN sprint** | Invoke `superpowers:writing-plans` with `report.parallelization.groups` as input — produces a fan-out-ready plan honoring blocking dependencies and the critical path. |
| **Plan a MAJOR CHANGE** | Pick one or more items from `report.triage.major_change`; invoke `superpowers:writing-plans` per change, seeding the plan with `suggested_approach` and `estimated_effort`. |
| **Save and exit** | No further action — user will triage manually from the report. |

These are NOT mutually exclusive. The default recommended sequence is: **apply no-brainers → walk through decisions → plan quick-win sprint** in one pass.

### 4. Safety rules during cleanup

- **One branch per bucket.** Don't intermix no-brainers with major changes.
- **Stop for review at every commit boundary**, not just at the end.
- **Run cheap local verification** after each fix (linter, type check, the tests touching the changed file).
- **No force-push, no `--no-verify`, no `--amend` on shared history.**
- **If a "no brainer" turns out to need judgment** (linter cascade reveals deeper issue), reclassify it and stop. Move it to NEEDS DECISION and surface for the user.

## Adapting lane prompts

Lane prompts live inside `audit.workflow.js` as top-level constants (`LANE_ARCHITECTURE`, `LANE_SECURITY`, etc.). To customize for your project:

1. Edit the constants directly — they're plain template strings
2. Re-invoke Workflow with the modified `scriptPath`
3. Resume with `resumeFromRunId` if you only edited one lane — the others return cached results instantly

## Honest limitations

- **Sampling, not exhaustive.** Each lane has a finding cap (default 20) and reads excerpts, not entire trees. Large repos get represented, not surveyed.
- **No runtime verification.** Findings are static-analysis-grade. The audit can flag "no health check endpoint" but won't probe a running service.
- **Adversarial verification is necessary but not sufficient.** Skeptics can miss subtle real findings just as the original lane can produce false positives.
- **Untested for codebases >500k LOC.** Token budget and synthesis quality degrade.
- **Polyglot monorepos are harder.** Lane prompts default to language-agnostic prose; specific tool invocations (linters, audit tools) are best-effort per language.
- **The skill itself has not been adversarially baseline-tested per `superpowers:writing-skills` discipline.** Pattern-matching from prior architectural reviews; expect tuning iterations.

## Re-auditing

After major remediation, re-run the workflow. Track findings closed quarter-over-quarter as a tech-debt health metric. The triage buckets give you a stable taxonomy across runs — a quarter where NEEDS DECISION shrinks but MAJOR CHANGE doesn't is a quarter spent on decisions without acting.

## When NOT to use this skill

- **Single-PR review** — use `/code-review` or `oh-my-claudecode:code-reviewer`
- **Quick critique with one output file** — use `scrutinize-code`
- **Debugging a specific bug** — use `superpowers:systematic-debugging`
- **You want a security scan only** — invoke `oh-my-claudecode:security-reviewer` directly, skip the orchestration
- **Codebase under ~5k LOC** — overhead exceeds value; a single careful pass is faster
- **No git history available** — Phase 1 (Vital Signs) and Phase 4 (Blast Radius) become near-useless; consider skipping or using a lighter critique
- **The user wants automated cleanup** — this skill is read-only; remediation is a separate workflow with human-in-the-loop triage

## Related skills

- `superpowers:writing-skills` & `author-skills` — how this skill was authored
- `scrutinize-code` — lighter alternative
- `superpowers:dispatching-parallel-agents` — meta-skill for parallel work
- `oh-my-claudecode:omc-teams` — alternative orchestration (process-based, not workflow-based)
- `oh-my-claudecode:security-reviewer`, `test-engineer`, `architect`, etc. — the underlying specialist agents this skill orchestrates
