// Multi-Agent Codebase Audit — orchestrates 12 parallel specialist lanes,
// adversarially verifies high-severity findings, and synthesizes a severity-ranked report.
//
// Invoke: Workflow({ scriptPath: '<this file>', args: { path, archetype, extraLanes, severityFloor, maxFindingsPerLane } })
//
// See SKILL.md in the same directory for full documentation.

export const meta = {
  name: 'multi-agent-codebase-audit',
  description: 'Fan-out 12+ specialist lanes (architecture, tests, security, deps, perf, obs, CI, APIs, data, docs, config) with adversarial verification and severity-ranked synthesis.',
  phases: [
    { title: 'Vital Signs', detail: 'Repo demographics, archetype inference, churn baseline' },
    { title: 'Parallel Lanes', detail: '12 core lanes + conditional add-ons' },
    { title: 'Blast Radius', detail: '90-day change overlap with risk areas' },
    { title: 'Verify', detail: 'Adversarial refutation of high+ findings (batched per lane; intensity-scaled)' },
    { title: 'Synthesize', detail: 'Dedupe, cluster, severity-rank, write report' },
  ],
}

// ─── Args & defaults ───────────────────────────────────────────────────────────

// Defensive args parsing: accept object, JSON string, or null/undefined with a clear error.
let resolvedArgs = args
if (typeof resolvedArgs === 'string') {
  try { resolvedArgs = JSON.parse(resolvedArgs) } catch (e) {
    throw new Error(`audit.workflow.js: args was passed as a string but is not valid JSON. Pass as a JSON object, not a string. Got: ${JSON.stringify(args).slice(0, 200)}`)
  }
}

const path = resolvedArgs?.path
if (!path) {
  throw new Error(
    `audit.workflow.js: args.path is required (absolute path to repo root).\n\n` +
    `CORRECT INVOCATION:\n` +
    `  Workflow({\n` +
    `    scriptPath: '/home/julius/.claude/skills/multi-agent-codebase-audit/audit.workflow.js',\n` +
    `    args: { path: '/absolute/path/to/repo', archetype: 'auto' }\n` +
    `  })\n\n` +
    `Required: args.path (absolute path).\n` +
    `Optional: archetype ('auto'|'library'|'service'|'frontend'|'monorepo'|'cli'|'ml'|'embedded'),\n` +
    `          extraLanes (string[]), severityFloor ('low'|'medium'|'high'), maxFindingsPerLane (number).\n\n` +
    `Received args (type=${typeof args}): ${JSON.stringify(args)?.slice(0, 300)}`
  )
}

const archetype = resolvedArgs.archetype ?? 'auto'
const extraLanes = resolvedArgs.extraLanes ?? []
const severityFloor = resolvedArgs.severityFloor ?? 'low'
const maxFindingsPerLane = resolvedArgs.maxFindingsPerLane ?? 20

// Verification intensity — the single biggest cost lever. Phase 3 used to spawn
// 3 independent skeptics PER high-severity finding (e.g. 11 highs → 33 agents,
// ~45% of total spend). 'standard' instead runs ONE batched verifier per lane
// that reviews all of that lane's high+critical findings in a single call
// (reads the cited files once), cutting verification agents ~80% with the same
// false-positive protection. Tiers:
//   'off'      — trust lanes, no verification (fastest; use only for a quick look)
//   'lite'     — batch-verify CRITICAL findings only; high+ pass through
//   'standard' — batch-verify high+critical, one verifier per lane (DEFAULT)
//   'thorough' — original behaviour: 3 independent skeptics per high+ finding,
//                majority-refute drops (use for acquisition / high-stakes audits)
const verifyIntensity = resolvedArgs.verifyIntensity ?? 'standard'

// Optional lane subset: array of lane keys (see CORE_LANES) to run instead of
// all core lanes. Lets a caller scope a cheap targeted pass, e.g.
// lanes:['security','deps','tests']. Conditional/extra lanes still apply.
const laneFilter = Array.isArray(resolvedArgs.lanes) && resolvedArgs.lanes.length
  ? new Set(resolvedArgs.lanes)
  : null

log(`Audit starting · path=${path} · archetype=${archetype} · severityFloor=${severityFloor} · verify=${verifyIntensity} · maxFindingsPerLane=${maxFindingsPerLane}${laneFilter ? ` · lanes=${[...laneFilter].join(',')}` : ''}`)

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
const FLOOR = SEVERITY_RANK[severityFloor] ?? 1

// ─── Schemas ───────────────────────────────────────────────────────────────────

const FINDING = {
  type: 'object',
  required: ['id', 'title', 'severity', 'category', 'description', 'impact', 'recommendation', 'effort'],
  properties: {
    id: { type: 'string', description: 'Short stable slug, e.g. "sec-secrets-in-git-history"' },
    title: { type: 'string' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    category: { type: 'string', description: 'Lane key' },
    file: { type: ['string', 'null'], description: 'Path relative to repo root, or null if cross-cutting' },
    lines: { type: ['string', 'null'], description: 'e.g. "42-58" or null' },
    description: { type: 'string', description: 'What was observed' },
    impact: { type: 'string', description: 'Why it matters — concrete failure mode, not "best practice"' },
    recommendation: { type: 'string', description: 'Specific action, named tool/pattern' },
    effort: { type: 'string', enum: ['small', 'medium', 'large'] },
    evidence: { type: 'string', description: 'Quoted code, command output, or file ref supporting the claim' },
    toolVerified: { type: 'boolean', description: 'TRUE only if this finding is the output of a real deterministic tool run (exit code / parsed report) — a CVE from npm-audit/pip-audit, a type error from tsc/mypy, a lint error from ruff/eslint, a failing build. These are facts, not judgements: they bypass the adversarial-verify stage. FALSE (default) for pattern-matched / reasoned findings, which still get verified.' },
    toolEvidence: { type: ['string', 'null'], description: 'When toolVerified: the exact command run + the key output/exit-code line proving it (e.g. "npm audit → CVE-2024-x high in lodash@4.17.20"). Null otherwise.' },
  },
}

const LANE_OUTPUT = {
  type: 'object',
  required: ['lane', 'summary', 'findings'],
  properties: {
    lane: { type: 'string' },
    summary: { type: 'string', description: 'One paragraph: what was checked and overall verdict' },
    findings: { type: 'array', items: FINDING, maxItems: maxFindingsPerLane },
    skipped: { type: 'array', items: { type: 'string' }, description: 'Things deliberately not checked (with reason)' },
  },
}

const VITALS_SCHEMA = {
  type: 'object',
  required: ['archetype', 'languages', 'loc', 'demographics'],
  properties: {
    archetype: { type: 'string', enum: ['library', 'service', 'frontend', 'monorepo', 'cli', 'ml', 'embedded', 'unknown'] },
    languages: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, loc: { type: 'number' }, pct: { type: 'number' } } } },
    loc: { type: 'number' },
    demographics: {
      type: 'object',
      properties: {
        contributors_90d: { type: 'number' },
        commits_90d: { type: 'number' },
        churn_top_paths: { type: 'array', items: { type: 'string' } },
        bus_factor_concerns: { type: 'array', items: { type: 'string' } },
        branch_protection: { type: 'string' },
        age_first_commit: { type: 'string' },
      },
    },
    notable: { type: 'array', items: { type: 'string' }, description: 'Anything else lanes should know — e.g. "vendored dependency", "polyglot", "no tests directory found"' },
    framework_hints: { type: 'array', items: { type: 'string' }, description: 'e.g. ["react", "nextjs", "postgres", "prisma"]' },
    intent: {
      type: 'object',
      description: 'Stated intent extracted from project docs (README, ARCHITECTURE.md, ADRs, RFCs, CONTRIBUTING.md, design/, plans/). Flows into every lane via BASE_CONTEXT.',
      properties: {
        docs_found: { type: 'array', items: { type: 'string' }, description: 'Paths of docs that were read' },
        purpose: { type: 'string', description: 'What the project claims to be, for whom (1-2 sentences)' },
        non_goals: { type: 'array', items: { type: 'string' }, description: 'Things docs explicitly say are out of scope' },
        stated_architecture: { type: 'string', description: 'Claimed structure, layering rules, design principles. Say "docs silent" if absent.' },
        stated_quality_bar: { type: 'string', description: 'Claimed test discipline, observability requirements, SLOs, performance targets' },
        known_debt: { type: 'array', items: { type: 'string' }, description: 'Issues docs already acknowledge — do NOT surface as new findings' },
        constraints: { type: 'array', items: { type: 'string' }, description: 'Deployment targets, supported runtimes, downstream consumers, compliance posture' },
        in_flight_migrations: { type: 'array', items: { type: 'string' }, description: 'Half-finished work referenced in docs; findings in these areas are expected during migration' },
        doc_coverage_quality: { type: 'string', enum: ['comprehensive', 'partial', 'sparse', 'absent'] },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['isReal', 'confidence', 'reasoning'],
  properties: {
    isReal: { type: 'boolean', description: 'Did refutation succeed? false = refuted, true = survives' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    reasoning: { type: 'string' },
    counter_evidence: { type: ['string', 'null'] },
  },
}

// Batched verdicts — one verifier returns a verdict per reviewed finding in a
// single call (the 'standard'/'lite' path). Keyed by finding id.
const VERDICT_BATCH = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['findingId', 'isReal', 'reasoning'],
        properties: {
          findingId: { type: 'string' },
          isReal: { type: 'boolean', description: 'true = survives scrutiny; false = refuted (drop)' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          reasoning: { type: 'string' },
        },
      },
    },
  },
}

const BLAST_SCHEMA = {
  type: 'object',
  required: ['hotspots'],
  properties: {
    hotspots: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, commits_90d: { type: 'number' }, contributors_90d: { type: 'number' }, notes: { type: 'string' } } } },
    coverage_gaps: { type: 'array', items: { type: 'string' }, description: 'High-churn paths that appear untested' },
    knowledge_concentration: { type: 'array', items: { type: 'string' }, description: 'Files where blame is single-author' },
  },
}

const NEEDS_DECISION_ITEM = {
  type: 'object',
  required: ['finding_id', 'decision', 'options'],
  properties: {
    finding_id: { type: 'string' },
    decision: { type: 'string', description: 'What the user needs to decide, in one sentence' },
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        required: ['name', 'pros', 'cons', 'effort'],
        properties: {
          name: { type: 'string' },
          pros: { type: 'string' },
          cons: { type: 'string' },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
        },
      },
    },
    recommendation: { type: ['string', 'null'], description: 'Name of recommended option, or null if no clear winner' },
  },
}

const MAJOR_CHANGE_ITEM = {
  type: 'object',
  required: ['finding_id', 'why_major', 'suggested_approach', 'estimated_effort'],
  properties: {
    finding_id: { type: 'string' },
    why_major: { type: 'string' },
    suggested_approach: { type: 'string', description: 'High-level approach (e.g. "incremental strangler migration over 3 sprints")' },
    estimated_effort: { type: 'string', description: 'e.g. "2-3 sprints"' },
  },
}

const DEFERRED_ITEM = {
  type: 'object',
  required: ['finding_id', 'reason'],
  properties: { finding_id: { type: 'string' }, reason: { type: 'string' } },
}

const INVESTIGATE_ITEM = {
  type: 'object',
  required: ['finding_id', 'what_to_investigate'],
  properties: { finding_id: { type: 'string' }, what_to_investigate: { type: 'string' } },
}

const PARALLEL_GROUP = {
  type: 'object',
  required: ['name', 'finding_ids', 'estimated_effort'],
  properties: {
    name: { type: 'string', description: 'Short label, e.g. "Test coverage backfill"' },
    finding_ids: { type: 'array', items: { type: 'string' } },
    estimated_effort: { type: 'string', description: 'e.g. "2 days" or "1 sprint"' },
    can_parallelize_with: { type: 'array', items: { type: 'string' }, description: 'Other group names safe to run concurrently' },
    blocking_dependencies: { type: 'array', items: { type: 'string' }, description: 'Group names that must complete first' },
    rationale: { type: 'string', description: 'Why these findings group together / why this ordering' },
  },
}

const REPORT_SCHEMA = {
  type: 'object',
  required: [
    'verdict', 'executive_summary', 'top_risks', 'clusters',
    'triage', 'parallelization', 'effort_summary', 'summary_markdown',
  ],
  properties: {
    verdict: { type: 'string', enum: ['green', 'yellow', 'red'] },
    verdict_rationale: { type: 'string' },
    executive_summary: { type: 'string' },
    top_risks: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    clusters: {
      type: 'array',
      description: 'Files/modules touched by findings from multiple lanes',
      items: { type: 'object', properties: { path: { type: 'string' }, lane_count: { type: 'number' }, finding_ids: { type: 'array', items: { type: 'string' } } } },
    },
    triage: {
      type: 'object',
      description: 'Every finding sorted into exactly one bucket',
      required: ['no_brainer', 'quick_win', 'needs_decision', 'major_change', 'defer_accept', 'investigate'],
      properties: {
        no_brainer: { type: 'array', items: { type: 'string' }, description: 'Finding IDs that are trivially correct, <1h, no design decision, no regression risk' },
        quick_win: { type: 'array', items: { type: 'string' }, description: 'Finding IDs: clear fix, <1 day, low coordination, real value' },
        needs_decision: { type: 'array', items: NEEDS_DECISION_ITEM, description: 'Findings requiring user judgment between viable options' },
        major_change: { type: 'array', items: MAJOR_CHANGE_ITEM, description: 'Findings needing >1 week or coordinated migration' },
        defer_accept: { type: 'array', items: DEFERRED_ITEM, description: 'Real findings not worth fixing now (with justification)' },
        investigate: { type: 'array', items: INVESTIGATE_ITEM, description: 'Findings needing deeper analysis before action' },
      },
    },
    parallelization: {
      type: 'object',
      required: ['groups'],
      properties: {
        groups: { type: 'array', items: PARALLEL_GROUP },
        critical_path: { type: 'array', items: { type: 'string' }, description: 'Ordered group names on the longest sequential chain' },
        notes: { type: 'string', description: 'Coordination caveats — shared files, deploy order, etc.' },
      },
    },
    effort_summary: {
      type: 'object',
      properties: {
        no_brainer_total: { type: 'string', description: 'e.g. "1-2 days total"' },
        quick_win_total: { type: 'string', description: 'e.g. "2-3 sprints if sequential, 1 sprint if parallelized"' },
        major_change_total: { type: 'string', description: 'e.g. "8-12 weeks across all major changes"' },
      },
    },
    quarter_plan: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Top items to fix this quarter, ordered by value/effort' },
    methodology_notes: { type: 'string', description: 'What was sampled, what was skipped, honest caveats' },
    summary_markdown: {
      type: 'string',
      description: 'Self-contained user-facing markdown summary, skim-readable in 30 seconds. See SYNTH_PROMPT for required structure.',
    },
  },
}

// ─── Lane definitions ──────────────────────────────────────────────────────────

const BASE_CONTEXT = (vitals) => `
You are auditing the codebase at: ${path}

## Vital signs (from Phase 1)
${JSON.stringify({ archetype: vitals.archetype, languages: vitals.languages, loc: vitals.loc, demographics: vitals.demographics, notable: vitals.notable, framework_hints: vitals.framework_hints }, null, 2)}

## Project intent (extracted from docs in Phase 1)
${JSON.stringify(vitals.intent ?? {}, null, 2)}

**Evaluation rule:** A "violation of generic best practice" that the project docs explicitly accept is NOT a finding. A "violation of what the docs claim" IS a finding (drift between stated intent and code reality). Findings in areas listed under \`intent.in_flight_migrations\` are "expected during migration" unless they introduce new risk beyond what the docs acknowledge. If \`intent.doc_coverage_quality\` is 'sparse' or 'absent', fall back to archetype-appropriate best practices and say so explicitly in your lane summary.

## Operating rules
- Use Read for files, Grep for symbols/patterns, Bash for read-only commands (git log, language-specific audit tools).
- Quote evidence in findings (file path + line range + a short snippet or command output).
- Cap output to ${maxFindingsPerLane} findings. If you find more, keep the highest-severity / highest-impact and list what you dropped in 'skipped'.
- Severity rubric:
  - critical: data loss, security breach, or production outage waiting to happen
  - high: significant ongoing cost (velocity, reliability, security), or a foreseeable bad incident
  - medium: meaningful debt with bounded blast radius
  - low: hygiene; matters for long-term maintainability
  - info: noteworthy but not a defect (use sparingly)
- "Best practice" alone is NOT impact. State the concrete failure mode.
- Effort: small=<1 day, medium=<1 week, large=>1 week or coordinated migration.
- If your lane doesn't apply to this archetype, return findings=[] and explain in 'summary' + 'skipped'.
- **Deterministic tool gate (M1).** If a real tool can produce the finding objectively — \`npm/pnpm/yarn audit\`, \`pip-audit\`, \`cargo audit\`, \`govulncheck\` (CVEs); \`tsc --noEmit\`, \`mypy\`, \`go build\`, \`cargo check\` (type/compile errors); \`ruff\`/\`eslint\`/\`golangci-lint\` (lint); the test runner (failures) — RUN it via Bash and treat its exit code / parsed output as the verdict. For each such finding set \`toolVerified:true\` and put the exact command + the proving output line in \`toolEvidence\`. A real CVE or compiler error is a FACT — it bypasses adversarial verification. Set \`toolVerified:false\` (default) for anything you reasoned out or pattern-matched. If the tool isn't installed, attempt install via the project's package manager; if that fails, do NOT fabricate a green — list it in \`skipped\` as "unverified (tool absent)" and leave related findings toolVerified:false.

Return a single LaneOutput object.
`

const LANE_ARCHITECTURE = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Architecture & Module Boundaries

Investigate:
- Module/package coupling: afferent (incoming) and efferent (outgoing) for top-level modules. Hotspots where instability is high.
- Cyclic dependencies between modules. Use language tooling where possible (\`madge\` for JS/TS, \`pydeps\` for Python, \`go list -deps\`, etc.).
- Layering violations: does the persistence layer reach into UI? Does domain code import from infrastructure? Compare against any stated architecture (clean/hexagonal/DDD/MVC).
- Component size distribution: god modules (>2000 LOC single file), anemic modules (<50 LOC with one export).
- Public API surface vs internal surface. Are internals exposed accidentally (no \`__all__\`, no barrel re-exports, default-public package layout)?
- Cross-cutting concerns: are logging/auth/transactions scattered, or centralized?
- Stated architecture vs actual: read README/ARCHITECTURE.md/ADRs for claimed structure, then verify against file layout and imports.

Findings should name the module/file and the specific structural problem, not vague "could be better organized."
`

const LANE_CODE_QUALITY = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Code Quality & Smells

Investigate:
- Cyclomatic / cognitive complexity hotspots. Use language tools (\`radon\` for Python, \`eslint complexity\`, \`gocyclo\`, etc.) where available.
- Duplicate / near-duplicate code blocks (try \`jscpd\` or grep for repeated identifiers across files).
- Dead code, unreachable branches, unused exports. Language-aware (\`ts-prune\`, \`vulture\`, \`unused\` linters).
- God classes / long methods / deep nesting.
- Primitive obsession, feature envy, shotgun-surgery patterns.
- TODO / FIXME / HACK comments: density and age (use \`git blame\` to age them — TODOs from >1 year ago are a red flag).
- Magic numbers / hardcoded values that should be config.
- Commented-out code blocks (long-form, not single-line annotations).

Skip pure style issues a formatter handles. Focus on structural and semantic smells.
`

const LANE_TEST_HEALTH = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Test Health

Investigate:
- Coverage by tier: unit / integration / e2e. Read coverage reports if present (\`coverage/\`, \`.coverage\`, jest output). If absent, note that and infer tier from test file locations.
- Test pyramid shape: ratio of unit:integration:e2e. Inverted pyramid is a red flag.
- Critical paths without tests: authentication, payments, data writes, migrations.
- Flaky test history: search CI configs and recent commits for \`retry\`, \`flaky\`, \`skip\`, \`xit\`, \`@pytest.mark.skip\`, quarantine markers.
- Test isolation: shared global state, fixture pollution, order-dependent tests (look for \`beforeAll\` mutating shared objects, module-level setup).
- Mock usage: over-mocking (every collaborator mocked), mock drift (mocks of interfaces that have changed in production code).
- Snapshot rot: \`__snapshots__/\` size, last update vs source change.
- Test execution time: look for slowest-test reports; investigate any single test >5s.
- Naming consistency: arrange/act/assert structure, descriptive names.

For a library archetype, expect heavier unit coverage. For a service, expect more integration. For a frontend, expect component + a few e2e.
`

const LANE_DEPENDENCIES = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Dependencies & Supply Chain

Investigate via the appropriate ecosystem tool — npm/yarn/pnpm audit, \`pip-audit\`, \`cargo audit\`, \`govulncheck\`, \`bundle audit\`:
- Total direct vs transitive dependency count; depth distribution.
- Outdated direct deps: how many majors behind? (\`npm outdated\`, \`pip list --outdated\`).
- EOL runtime: is the language/runtime version still supported?
- Known CVEs in transitive deps. Report severity from the advisory.
- License compatibility: any GPL/AGPL in a non-GPL project? Any "UNKNOWN" or missing licenses?
- Abandoned packages: last release >2 years ago, or archived on GitHub.
- Duplicate deps at different versions in the lockfile (\`npm ls\`, \`pip check\`).
- Dependencies imported once or unused entirely (\`depcheck\`, \`pip-extra-reqs\`).
- Native/binary deps and their reproducibility risk.
- Lockfile integrity: does it exist? Is it committed? Drift from manifest?

If a dep tool isn't installed, attempt installation via the project's package manager; if that fails, list what couldn't be checked in 'skipped'.
`

const LANE_SECURITY = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Security

Investigate:
- Secrets in git history: run gitleaks/trufflehog if available, otherwise grep for typical patterns (\`AKIA\`, \`api_key\`, \`-----BEGIN\`, \`bearer\`, password literals).
- Dangerous patterns: \`eval\`, \`exec\`, raw SQL string concatenation, shell exec on user input, deserialize-from-untrusted (\`pickle.load\`, \`yaml.load\` without SafeLoader, \`marshal\`).
- Authentication/authorization centralization. Is auth checked at one boundary or scattered across handlers? Are there endpoints with no auth annotation/middleware that should have one?
- Crypto usage: MD5/SHA1 in non-checksum contexts, hardcoded keys, weak randomness for security (\`Math.random()\`, \`random.random()\` for tokens), ECB mode, custom crypto.
- Input validation at trust boundaries. Output encoding for user-rendered content (XSS surface).
- OWASP top patterns: SSRF (URL fetch from user input), XXE (XML parse without disabled entities), path traversal, insecure deserialization.
- Auth token handling: storage location, rotation strategy, scope.
- CORS / CSP / security headers configuration.
- Dependency CVEs with REACHABLE code paths (cross-reference Lane 4 output if available; otherwise flag as "potentially reachable").

For each finding, name the file:line and the specific vulnerable pattern. Severity calibration: any unauthenticated remote attacker path = critical; insider/local-only = high or medium depending on blast radius.
`

const LANE_PERFORMANCE = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Performance & Scalability

Investigate:
- Algorithmic hotspots: O(n²) or worse on user-scaled inputs. Look for nested loops over collections that could grow unbounded.
- N+1 query patterns: ORM .find/.get inside loops, lazy-loaded relations accessed in iteration.
- Synchronous I/O on request/event paths: blocking file reads, sync HTTP calls in an async runtime, blocking DB calls in a request handler.
- Memory: large in-memory buffers, no streaming for file processing, leak suspects (event listeners not removed, growing maps without eviction).
- Caching layers: presence, hit/miss telemetry, invalidation correctness. Stale-while-revalidate? Cache stampedes?
- Database: index coverage vs actual queries (EXPLAIN if a SQL dump or local DB is available). Missing indexes on FK columns, unused indexes.
- Bundle size (frontend): production bundle, code-splitting, tree-shaking effectiveness.
- Cold-start time: serverless/edge functions, container boot path.
- Pagination: any unbounded list endpoints? Offset pagination on large tables (a known performance trap).

Static-analysis-grade only. Don't claim runtime measurements you didn't take.
`

const LANE_OBSERVABILITY = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Observability & Operations

Investigate:
- Logging: coverage in critical paths, level discipline, structured (JSON) vs string concatenation, secrets in logs.
- Metrics: are RED (Rate, Errors, Duration) or USE (Utilization, Saturation, Errors) covered for the service? Custom business metrics?
- Distributed tracing: presence, sample rate, propagation across service boundaries (W3C traceparent, B3).
- Error tracking integration (Sentry/Bugsnag/Rollbar): present? capture rate? PII scrubbed?
- Health checks: liveness vs readiness distinction. Deep vs shallow health.
- Graceful shutdown: in-flight request draining, SIGTERM handling.
- Dead-letter handling for queues; retry/backoff policies.
- Idempotency: write operations that should be idempotent (and aren't): payment, email send, webhook delivery.
- Correlation IDs: present? threaded through async boundaries?

For a library archetype, most of this is N/A — say so in 'skipped' and focus on what makes sense (e.g. logging hygiene at log-emission points).
`

const LANE_CICD = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Build, CI/CD & Release Engineering

Investigate:
- Build reproducibility: deterministic output? Pinned tool versions? Network access during build?
- CI pipeline structure: caching effectiveness, parallelization, fan-out for matrix builds.
- Test partitioning: are tests sharded? Slowest job dominate wall-clock?
- Deploy mechanism: blue/green, canary, rolling, or yolo? Manual?
- Rollback path: documented? Single-command? Data-compatible (forward-compat migrations)?
- Feature flag hygiene: stale flags, dead branches under flags, flag count growth.
- Environment parity: dev/staging/prod drift in dependencies, configs, infra.
- Container image: multi-stage build? Base image age? Image size? Unnecessary contents (sources, build tooling)?
- Secrets in CI: are they pulled from a vault, or stored as plain env vars in CI config?

If CI config files aren't present (no \`.github/workflows/\`, \`.gitlab-ci.yml\`, etc.), that itself is a high-severity finding for any non-toy project.
`

const LANE_API = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: API & Contract Design

Investigate:
- Style consistency: is the codebase REST, GraphQL, gRPC, or a mix? Are conventions followed throughout?
- Versioning strategy: URL versioning, header versioning, none? Breaking changes shipped without a version bump?
- Backwards-compat track record: git log for "BREAKING:" or major-version bumps in the last year.
- Pagination / filtering / sorting consistency: each endpoint shouldn't reinvent the patterns.
- Error response shape: same envelope across endpoints? HTTP status codes used semantically?
- Rate limiting & quotas: per-user, per-IP, per-key? At which layer?
- Schema coverage: OpenAPI/Protobuf/GraphQL schema present and synced with code? Auto-generated or hand-maintained?
- Contract tests: do consumers verify against the schema, or only against examples?
- Auth at the API layer: applied uniformly, or sprinkled?

For internal APIs or library projects with no external API, scope to the public package interface.
`

const LANE_DATA = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Data & Schema

Investigate:
- Migration safety: forward and backward compatible? Locking risk on large tables? Online vs blocking migrations?
- DB constraints: FK presence, unique constraints, check constraints, NOT NULL discipline.
- Indexes vs query patterns: missing indexes on common WHERE/JOIN columns; unused indexes; indexes on low-cardinality boolean columns.
- PII inventory: which columns hold PII? Encrypted at rest? Masked in logs? In analytics dumps?
- Data retention: enforced in code (delete jobs, TTLs), or only in policy docs?
- Event schema versioning (if event-driven): how are schema changes coordinated with consumers?
- Backup & restore: automated backups configured? Restore tested in the last quarter?
- Multi-tenancy isolation (if applicable): row-level security, schema-per-tenant, or shared-schema with tenant-id discipline?

For a frontend or library archetype, this lane often returns 'findings=[]' with skipped='no persistence layer in scope'.
`

const LANE_DOCS = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Documentation & Onboarding

Investigate:
- README quality: can a new developer install, run, and test in <5 minutes following only the README?
- ARCHITECTURE.md / ADRs: present? Current? Or last updated 18 months ago and contradicting the code?
- Inline comment quality: explains WHY (non-obvious constraint, surprising behavior) vs WHAT (well-named code is self-documenting). Comment rot — comments contradicting code.
- API docs: synced with code? Auto-generated and current?
- Runbooks for on-call scenarios: rollback, restart, common alerts.
- Contribution guide, code of conduct.
- Onboarding time estimate: gap between repo clone and first useful PR. (Sample by reading the most recent first-contribution PRs if accessible.)
- Tribal knowledge: files that only one person has ever touched (cross-reference with vital signs bus_factor_concerns).

Distinguish "missing docs" (medium) from "wrong docs" (high — actively misleads).
`

const LANE_CONFIG = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Configuration, Secrets & Resilience

Investigate:
- Config schema validation at startup: fail-fast on missing/malformed config, or fail-late at first use?
- Env var documentation: every required env var listed in README/\`.env.example\`?
- Secret management: pulled from vault/KMS, or \`.env\` files committed? Any plaintext secrets in code?
- 12-factor compliance: config-in-env, stateless processes, dev/prod parity.
- Retry & backoff: present on every external call? Exponential with jitter, or naive fixed-interval?
- Timeouts: every external call has one? (Default to "no" if not explicitly set — many SDKs have unlimited default timeouts.)
- Circuit breakers / bulkheads on critical integrations.
- Graceful degradation: what happens when X is down? Documented fallbacks?
- Idempotency of side-effectful operations.

For each finding, name the specific call site (file:line) where a timeout/retry/circuit-breaker is missing.
`

const LANE_DRIFT = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Stated vs Actual Drift

Compare claims in project documentation against codebase reality. Phase 1 already extracted what the docs SAY (\`intent\` above). Your job is to find where reality diverges from claim.

This lane is HIGHEST VALUE when \`intent.doc_coverage_quality\` is 'comprehensive' or 'partial'. If 'sparse' or 'absent', return findings=[] with a summary explaining low signal and skip aggressively.

Investigate (cross-reference \`intent\` with code):

1. **Architecture drift** — stated layering/structure vs imports and file layout. If ARCHITECTURE.md says "domain layer must not import infrastructure", grep for violations.
2. **Quality-bar drift** — stated test coverage vs actual; stated observability vs missing instrumentation; stated SLOs vs lack of latency measurement code; stated performance targets vs evident pessimization.
3. **Stack drift** — docs mention library/framework X as primary; grep shows mixed use with Y and Z that aren't documented. Or: docs reference deprecated tech that's still pervasive.
4. **Process drift** — CONTRIBUTING.md says "all changes must include tests"; recent commits in high-churn paths add no tests. CI must pass; recent merges show overrides or skipped jobs.
5. **API drift** — OpenAPI/Protobuf/GraphQL schema files vs actual endpoint implementations. CHANGELOG promises endpoint X; not present.
6. **Doc rot** — files, modules, commands, env vars referenced in docs that no longer exist; tutorials that no longer work; example code that references removed APIs.
7. **In-flight migration honesty** — docs say "migrating to X"; check git log for the migration directory in last 90 days. Stalled migrations (referenced but no activity) are a high-severity finding.
8. **Known-debt staleness** — docs list known debt items; check whether any have been silently fixed (good — should remove from docs) or actively gotten worse.
9. **Compliance/security claim drift** — SECURITY.md says "secrets are managed via Vault"; grep finds \`.env\` files with literals. README says "PII encrypted at rest"; DB schema shows plaintext columns.

For each finding, name the SPECIFIC claim (with source path + line) and the SPECIFIC code that contradicts it. "Docs say A (README.md:45); code does B (services/foo.ts:120)."

Severity rubric for this lane:
- **critical**: drift creates active risk — README claims encryption, code shows plaintext storage; SECURITY.md claims auth on all endpoints, public endpoint exists.
- **high**: drift misleads new contributors or external integrators — docs ship a wrong mental model; API docs disagree with actual responses.
- **medium**: stale claims that aren't actively harmful but rot trust — outdated tutorial, deprecated paths still documented.
- **low**: minor inconsistencies, formatting issues, dead links to internal resources.

Drift findings have outsized value because the fix is often cheap (update doc OR fix code, depending on which is correct) but the underlying confusion is expensive.
`

// Conditional add-on lanes ──────────────────────────────────────────────────────

const LANE_A11Y = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Frontend Accessibility (a11y)

Investigate WCAG 2.1 AA-level concerns:
- Semantic HTML vs div-soup
- Keyboard navigation (visible focus, focus traps, tab order)
- ARIA usage correctness (over-aria'd or missing roles)
- Color contrast on text elements
- Form labels and error association
- Image alt text discipline
- Skip-to-content link presence
- Reduced-motion respect

Run \`axe-core\` or \`pa11y\` if available against a built version; otherwise static-analyze JSX/templates.
`

const LANE_BUNDLE = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Bundle & Render Performance

Investigate:
- Bundle size: total, by route, by chunk
- Largest dependencies contributing to the bundle (\`webpack-bundle-analyzer\`, \`rollup-plugin-visualizer\`, \`source-map-explorer\`)
- Code-splitting: route-level, component-level, dynamic imports
- Tree-shaking effectiveness (CommonJS imports defeating it)
- Render performance: unnecessary re-renders, missing memoization, large lists without virtualization
- Image optimization: lazy-loaded? Modern formats? Properly sized?
- Core Web Vitals baseline if Lighthouse output is available
`

const LANE_I18N = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Internationalization

Investigate:
- i18n framework integration completeness; hardcoded strings outside the framework
- Locale-aware ops: dates, numbers, currency, sorting, pluralization rules
- Right-to-left language support
- Translation file currency: keys in code without translations, or stale translations
- Pluralization handled correctly (ICU MessageFormat or equivalent), not naive ternaries
`

const LANE_COMPLIANCE = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Regulatory Compliance Touchpoints

Investigate (note: this is touchpoint detection, NOT legal certification):
- GDPR: data subject rights endpoints (export, delete), consent flows, data processing records
- CCPA: do-not-sell flags, privacy notice
- HIPAA: PHI handling, audit logs, access controls (if healthcare context)
- PCI: cardholder data scope, encryption, tokenization (if payments)
- SOC 2: audit trail completeness, access reviews, change management

Flag anything that looks like a compliance touchpoint without corresponding code (e.g., "user data" stored, but no deletion endpoint).
`

const LANE_ML = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: ML Pipeline Health

Investigate:
- Training/serving skew: same preprocessing in both paths?
- Data leakage: train/test split done before or after feature engineering?
- Model versioning: model artifacts pinned with code? Rollback path for models?
- Reproducibility: pinned random seeds, deterministic ops where claimed, environment locks
- Eval coverage: held-out test set, distribution shift detection, regression tests on key slices
- PII in training data: handled per data governance?
- Notebook hygiene: notebooks vs library code separation; promotion path from notebook to production
`

const LANE_EMBEDDED = (vitals) => `${BASE_CONTEXT(vitals)}
## Lane: Embedded / Real-Time

Investigate:
- Memory bounds: stack depth, heap allocation policy, fragmentation risk
- Real-time guarantees: ISR vs main-loop discipline, lock-free where needed
- Hardware abstraction layer: peripheral access centralized?
- Power management: sleep/wake paths covered by tests?
- Build flags / linker scripts: optimization, debug info handling
- Failure modes: watchdog, brown-out, error recovery paths
`

// ─── Lane registry ─────────────────────────────────────────────────────────────

const CORE_LANES = [
  { key: 'architecture', label: 'Architecture & Module Boundaries', prompt: LANE_ARCHITECTURE, agentType: 'nord-core:architect' },
  { key: 'code-quality', label: 'Code Quality & Smells', prompt: LANE_CODE_QUALITY, agentType: 'nord-core:code-reviewer' },
  { key: 'tests', label: 'Test Health', prompt: LANE_TEST_HEALTH, agentType: 'nord-core:test-engineer' },
  { key: 'deps', label: 'Dependencies & Supply Chain', prompt: LANE_DEPENDENCIES },
  { key: 'security', label: 'Security', prompt: LANE_SECURITY, agentType: 'nord-core:security-reviewer' },
  { key: 'perf', label: 'Performance & Scalability', prompt: LANE_PERFORMANCE },
  { key: 'obs', label: 'Observability & Operations', prompt: LANE_OBSERVABILITY },
  { key: 'cicd', label: 'Build, CI/CD & Release', prompt: LANE_CICD },
  { key: 'api', label: 'API & Contract Design', prompt: LANE_API },
  { key: 'data', label: 'Data & Schema', prompt: LANE_DATA },
  { key: 'docs', label: 'Documentation & Onboarding', prompt: LANE_DOCS, agentType: 'nord-core:document-specialist' },
  { key: 'config', label: 'Configuration, Secrets & Resilience', prompt: LANE_CONFIG },
  { key: 'drift', label: 'Stated vs Actual Drift', prompt: LANE_DRIFT, agentType: 'nord-core:architect' },
]

const CONDITIONAL_LANES = {
  a11y: { key: 'a11y', label: 'Accessibility', prompt: LANE_A11Y },
  bundle: { key: 'bundle', label: 'Bundle & Render Perf', prompt: LANE_BUNDLE },
  i18n: { key: 'i18n', label: 'Internationalization', prompt: LANE_I18N },
  compliance: { key: 'compliance', label: 'Compliance', prompt: LANE_COMPLIANCE },
  ml: { key: 'ml', label: 'ML Pipeline', prompt: LANE_ML },
  embedded: { key: 'embedded', label: 'Embedded / Real-Time', prompt: LANE_EMBEDDED },
}

// ─── PHASE 1: Vital Signs ──────────────────────────────────────────────────────

phase('Vital Signs')

const VITALS_PROMPT = `You are profiling the repository at: ${path}

Determine archetype, demographics, and context that all downstream audit lanes will use. Run read-only commands only.

Required investigation (use Bash with read-only commands, Read for files, Grep for patterns):
1. **Archetype detection** (requested: ${archetype}). If 'auto', infer from:
   - Manifests at root: package.json (and framework deps), pyproject.toml/setup.py, Cargo.toml, go.mod, pom.xml, etc.
   - Layout: src/, lib/, app/, services/, packages/, notebooks/, firmware/, etc.
   - Entry points: bin/, cmd/, server entry files, library exports
   - Pick from: library | service | frontend | monorepo | cli | ml | embedded | unknown

2. **Language & LOC breakdown**: use \`tokei\` or \`cloc\` if available; otherwise \`find\` + \`wc -l\` grouped by extension.

3. **Demographics** (last 90 days unless noted):
   - commits_90d: \`git log --since=90.days --oneline | wc -l\`
   - contributors_90d: \`git log --since=90.days --format='%ae' | sort -u | wc -l\`
   - churn_top_paths: \`git log --since=90.days --name-only --pretty=format: | sort | uniq -c | sort -rn | head -20\`
   - bus_factor_concerns: files where single author has >80% of blame. Sample top 10 highest-churn files; if any are single-author, list them.
   - branch_protection: read .github/CODEOWNERS, .github/workflows/, settings if visible; describe what's enforced
   - age_first_commit: \`git log --reverse --format=%ad --date=short | head -1\`

4. **Framework hints**: pick out the 3-10 most architecturally significant dependencies (e.g., react, nextjs, django, fastapi, prisma, postgres, kafka). These help downstream lanes.

5. **Notable observations**: anything lanes should know — polyglot, vendored deps, no tests directory, monorepo subprojects, etc.

6. **Intent extraction** — read project documentation to extract stated intent. This flows into every downstream lane via BASE_CONTEXT and is the single biggest lever for reducing false-positive findings. Sources, in priority order:
   - \`README.md\` (root + any \`docs/README.md\`, \`packages/*/README.md\` for monorepos)
   - \`ARCHITECTURE.md\`, \`DESIGN.md\`, \`OVERVIEW.md\`
   - \`docs/\`, \`design/\`, \`plans/\`, \`rfc/\`, \`rfcs/\`, \`adr/\`, \`ADRs/\`, \`.adr/\` directories — list contents, then Read the top-level + most-recent files (last 6 months)
   - \`CONTRIBUTING.md\` (process expectations, stated quality bar)
   - \`CHANGELOG.md\` (recent direction; what was promised in recent releases)
   - \`.github/PULL_REQUEST_TEMPLATE.md\`, \`SECURITY.md\`, \`COMPLIANCE.md\`, \`CODE_OF_CONDUCT.md\`
   - Any prior \`.audit/\` output from previous runs (what was promised to fix)

   Use Read for individual docs; Bash \`ls\` or Glob to discover doc directories. Cap doc reading at ~50k tokens — sample largest / most-recent if more. Quote the source path when stating a claim (e.g., "ARCHITECTURE.md line 42 says X").

   Populate the \`intent\` object on the returned Vitals. Each field:
   - **purpose**: 1-2 sentences on what the project claims to be, for whom.
   - **non_goals**: explicit out-of-scope items, from docs only — don't infer.
   - **stated_architecture**: claimed principles, layering, patterns. If docs are silent, return "docs silent".
   - **stated_quality_bar**: tests, observability, SLOs, performance targets explicitly stated. "We commit to 80% line coverage" / "All endpoints must return within 200ms p95" / etc.
   - **known_debt**: things docs already acknowledge as suboptimal — downstream lanes will use this to AVOID surfacing them as new findings.
   - **constraints**: deployment targets, supported runtimes, downstream consumers, compliance posture (GDPR/HIPAA/PCI/SOC2 etc.).
   - **in_flight_migrations**: half-finished work referenced in docs. Findings in these areas are flagged "expected during migration" by downstream lanes.
   - **doc_coverage_quality**: comprehensive / partial / sparse / absent — honest assessment. Tells downstream lanes how much weight to give stated intent.
   - **docs_found**: paths actually read.

   Be honest about doc quality. A "sparse" coverage signal is more valuable than fabricated intent.

Return a single Vitals object. Be specific — "12 contributors" not "small team."
`

const vitals = await agent(VITALS_PROMPT, { schema: VITALS_SCHEMA, label: 'vitals', phase: 'Vital Signs' })

log(`Archetype: ${vitals.archetype} • LOC: ${vitals.loc} • Contributors (90d): ${vitals.demographics.contributors_90d}`)

// Decide conditional lanes
const archetypeConditionals = {
  frontend: ['a11y', 'bundle'],
  service: [],
  library: [],
  monorepo: [],
  cli: [],
  ml: ['ml'],
  embedded: ['embedded'],
  unknown: [],
}

const conditionalsToRun = new Set([
  ...(archetypeConditionals[vitals.archetype] ?? []),
  ...extraLanes,
])

// Add i18n if the repo seems to have locale dirs
const i18nHints = (vitals.notable ?? []).some(n => /i18n|locale|translation/i.test(n))
if (i18nHints && !conditionalsToRun.has('i18n')) conditionalsToRun.add('i18n')

const selectedCore = laneFilter ? CORE_LANES.filter(l => laneFilter.has(l.key)) : CORE_LANES

const activeLanes = [
  ...selectedCore,
  ...Array.from(conditionalsToRun).map(k => CONDITIONAL_LANES[k]).filter(Boolean),
]

log(`Running ${activeLanes.length} lanes (${selectedCore.length} core${laneFilter ? ` of ${CORE_LANES.length}, filtered` : ''} + ${activeLanes.length - selectedCore.length} conditional)`)

// ─── PHASE 2 + 3: Parallel lanes with per-finding adversarial verification ────

phase('Parallel Lanes')

// Pipeline: each lane streams into per-finding verification as soon as it completes,
// no barrier between phases. Lane A's high-severity findings can be verified while
// Lane B is still running.

const REFUTE_PROMPT = (finding, vitals) => `You are an adversarial verifier. Your job is to TRY TO REFUTE the following audit finding. Default to refuted=true (isReal=false) if the evidence is weak, the impact is overstated, or the recommendation doesn't match the problem.

## Finding under review
${JSON.stringify(finding, null, 2)}

## Repo context
- Path: ${path}
- Archetype: ${vitals.archetype}
- Languages: ${vitals.languages.map(l => l.name).join(', ')}

## Your task
1. Read the cited file(s) and surrounding code to verify the claim is accurate.
2. Check whether the impact statement is concrete or hand-wavy. "Best practice violation" without a named failure mode is hand-wavy.
3. Check whether the recommendation actually addresses the problem.
4. Consider whether the finding is project-archetype-appropriate (e.g., "no health check" is N/A for a library).
5. If evidence is sampling-based, check whether the sample is representative.

Return a Verdict:
- isReal=true ONLY if: evidence is solid AND impact is concrete AND recommendation matches.
- isReal=false if: evidence is missing/incorrect, impact is hand-wavy, recommendation is generic, or the finding doesn't apply to this archetype.

Be skeptical. False positives are costly.
`

// Batched verifier: one agent reviews ALL of a lane's high+critical findings in
// a single pass, reading each cited file once instead of re-establishing repo
// context per finding. This is the 'standard'/'lite' path.
const REFUTE_BATCH_PROMPT = (findings, vitals) => `You are an adversarial verifier reviewing a batch of audit findings from one lane. For EACH finding, try to REFUTE it. Default to refuted (isReal=false) when evidence is weak, impact is overstated, the recommendation doesn't match the problem, or the finding doesn't fit this project's archetype.

## Repo context
- Path: ${path}
- Archetype: ${vitals.archetype}
- Languages: ${vitals.languages.map(l => l.name).join(', ')}

## Findings to verify (${findings.length})
${JSON.stringify(findings.map(f => ({ id: f.id, severity: f.severity, title: f.title, file: f.file, lines: f.lines ?? f.line, impact: f.impact, recommendation: f.recommendation ?? f.fix })), null, 2)}

## Your task
For each finding: Read the cited file(s) and surrounding code. Judge whether the claim is accurate, the impact is concrete (not "best practice" hand-waving), the recommendation addresses it, and it's archetype-appropriate. Reuse what you learn across findings that touch the same files.

Return a VerdictBatch: one entry per finding id above.
- isReal=true ONLY if evidence is solid AND impact is concrete AND recommendation matches.
- isReal=false otherwise. Be skeptical — false positives are costly.
Every finding id MUST appear exactly once in verdicts.
`

const laneResults = await pipeline(
  activeLanes,
  // Stage 1: run the lane
  async (lane) => {
    const result = await agent(
      lane.prompt(vitals),
      {
        label: `find:${lane.key}`,
        phase: 'Parallel Lanes',
        schema: LANE_OUTPUT,
        ...(lane.agentType ? { agentType: lane.agentType } : {}),
      }
    )
    return { lane, result }
  },
  // Stage 2: adversarial verification, scaled by verifyIntensity (see args).
  async ({ lane, result }) => {
    if (!result?.findings?.length) return { lane, result, verified: [] }
    const sev = f => SEVERITY_RANK[f.severity] ?? 0

    // M1 deterministic tool gate: findings backed by a real tool run (exit code /
    // parsed report) are FACTS — they bypass the adversarial-verify skeptic entirely.
    // You cannot refute a real CVE or a compiler error. Only reasoned/pattern-matched
    // findings go through verification.
    const toolFacts = result.findings.filter(f => f.toolVerified === true)
    const judgedFindings = result.findings.filter(f => f.toolVerified !== true)

    if (verifyIntensity === 'off') {
      return { lane, result, verified: result.findings }
    }
    if (!judgedFindings.length) return { lane, result, verified: toolFacts }

    // Which findings get verified depends on intensity. 'lite' only scrutinizes
    // criticals; everything else verifies high+critical.
    const threshold = verifyIntensity === 'lite' ? SEVERITY_RANK.critical : SEVERITY_RANK.high
    const toVerify = judgedFindings.filter(f => sev(f) >= threshold)
    const passThrough = [...toolFacts, ...judgedFindings.filter(f => sev(f) < threshold)]
    if (!toVerify.length) return { lane, result, verified: passThrough }

    if (verifyIntensity === 'thorough') {
      // High-stakes path: 3 independent skeptics per finding, majority-refute drops.
      const verdicts = await parallel(
        toVerify.flatMap(f =>
          [0, 1, 2].map(i => () =>
            agent(REFUTE_PROMPT(f, vitals), {
              label: `verify:${lane.key}:${f.id}:${i}`,
              phase: 'Verify',
              schema: VERDICT,
              agentType: 'nord-core:verifier',
            }).then(v => ({ findingId: f.id, verdict: v }))
          )
        )
      )
      const surviving = toVerify.filter(f => {
        const vs = verdicts.filter(Boolean).filter(v => v.findingId === f.id).map(v => v.verdict)
        return vs.filter(v => v.isReal).length >= 2 // default to refuted if uncertain
      })
      return { lane, result, verified: [...surviving, ...passThrough] }
    }

    // 'standard' / 'lite': ONE batched verifier reviews all of this lane's
    // to-verify findings in a single call (reads cited files once).
    const batch = await agent(REFUTE_BATCH_PROMPT(toVerify, vitals), {
      label: `verify:${lane.key}`,
      phase: 'Verify',
      schema: VERDICT_BATCH,
      agentType: 'nord-core:verifier',
    })
    const byId = new Map((batch?.verdicts ?? []).map(v => [v.findingId, v]))
    const surviving = toVerify.filter(f => {
      const v = byId.get(f.id)
      // Drop only on an explicit refutation. A missing verdict (verifier omission)
      // keeps the finding — losing a real finding is worse than one stray nit
      // surviving into the human-reviewed report.
      return v ? v.isReal !== false : true
    })
    return { lane, result, verified: [...surviving, ...passThrough] }
  }
)

// ─── PHASE 4: Blast Radius (concurrent with parallel lanes — runs in its own phase) ─

phase('Blast Radius')

const BLAST_PROMPT = `You are analyzing 90-day blast radius for the codebase at: ${path}

## Vital signs context
${JSON.stringify({ archetype: vitals.archetype, loc: vitals.loc, languages: vitals.languages, demographics: vitals.demographics }, null, 2)}

Investigate (read-only git + filesystem):
1. **Hotspots**: top 20 files by commit count in the last 90 days. Annotate each with contributor count.
2. **Coverage gaps**: cross-reference hotspot paths against test paths. Any high-churn file with no obvious test counterpart?
3. **Knowledge concentration**: high-churn files where blame is concentrated in a single author.
4. **Hotspot × risk overlap**: hotspots that also live in security-sensitive or data-write paths (heuristic: directories matching /auth|payment|user|account|admin/i).

Return a BlastRadius object.
`

const blast = await agent(BLAST_PROMPT, { schema: BLAST_SCHEMA, label: 'blast-radius', phase: 'Blast Radius' })

// ─── PHASE 5: Synthesis ───────────────────────────────────────────────────────

phase('Synthesize')

const allFindings = laneResults
  .filter(Boolean)
  .flatMap(r => (r.verified ?? []).map(f => ({ ...f, lane: r.lane.key })))
  .filter(f => (SEVERITY_RANK[f.severity] ?? 0) >= FLOOR)

log(`Synthesis input: ${allFindings.length} findings across ${laneResults.filter(Boolean).length} lanes`)

const laneSummaries = laneResults.filter(Boolean).map(r => ({
  lane: r.lane.key,
  label: r.lane.label,
  summary: r.result?.summary ?? '(no summary)',
  finding_count: (r.verified ?? []).length,
  skipped: r.result?.skipped ?? [],
}))

const SYNTH_PROMPT = `You are synthesizing a codebase audit report.

## Repo
- Path: ${path}
- Archetype: ${vitals.archetype}
- LOC: ${vitals.loc}
- Languages: ${vitals.languages.map(l => `${l.name} (${l.pct}%)`).join(', ')}

## Inputs
- ${allFindings.length} verified findings across ${laneSummaries.length} lanes (severity floor: ${severityFloor})
- Blast radius analysis attached
- Per-lane summaries attached

## All findings (JSON)
${JSON.stringify(allFindings, null, 2)}

## Blast radius
${JSON.stringify(blast, null, 2)}

## Lane summaries
${JSON.stringify(laneSummaries, null, 2)}

## Your task
1. **Dedupe**: when multiple lanes flag the same root cause (e.g. security and deps both flag a CVE), merge into one finding with category=primary lane and note the cross-reference.
2. **Cluster**: group findings by file/module. Files with findings from 4+ lanes are the most fragile and should be called out.
3. **Verdict**: green / yellow / red. Rationale should reference critical+high counts, hotspot×risk overlap, and any single-finding showstoppers.
4. **Top 3 risks**: the things that, if not addressed, will hurt most.
5. **Quarter plan**: ordered list of up to 10 items to fix this quarter, considering both severity and effort (favor high-severity small-effort wins early).
6. **Methodology notes**: honest list of what was sampled, what was skipped, language-specific tools that weren't available, archetype-N/A lanes, etc.
7. **Triage classification.** Sort EVERY finding into exactly one bucket. Use finding IDs:
   - **no_brainer**: trivially correct fix, <1 hour each, no design decision, no regression risk. Examples: pin lockfile; bump patch versions for known-safe CVEs; add missing timeout to external call; delete a clearly unused export; fix obvious typo in error message. If the agent reading this would do it in 30 seconds without asking — no_brainer.
   - **quick_win**: clear fix, <1 day each, low coordination, real value. Most "add test for X" / "add validation for Y" / "centralize Z" findings live here.
   - **needs_decision**: requires user judgment between viable options (architectural fork, accept-debt-vs-refactor, library swap, etc.). Surface 2-4 concrete options with pros/cons/effort. Provide a recommendation only when one is clearly superior; otherwise leave null.
   - **major_change**: >1 week effort, architectural impact, cross-cutting refactor, or coordinated migration. Should be planned, not just done. Suggest a high-level approach (incremental, big-bang, strangler, etc.).
   - **defer_accept**: real finding but not worth fixing now given context (e.g., feature being deprecated, file untouched by anyone in 18 months, cost of fix exceeds remaining lifetime). Justify in one sentence.
   - **investigate**: not enough info to act — needs deeper analysis or data first. Specify what to investigate.

   Every finding ID must appear in exactly one bucket. Do not skip findings.

8. **Parallelization analysis.** Group quick_win + major_change findings into work-clusters that can be executed concurrently. Rules:
   - Findings in the same group share scope/skill — they're naturally done by one person/agent in one session.
   - Findings in different groups that touch independent files and have no logical dependency can run in parallel — note via \`can_parallelize_with\`.
   - Groups with explicit dependencies (e.g., "upgrade lib X first, then use new API") must declare \`blocking_dependencies\`.
   - Identify the critical path (longest blocking chain).
   - Note coordination caveats: shared-file conflicts, deploy ordering, migration windows.

9. **Effort summary.** Sum estimated effort per bucket. Reflect parallelization in quick_win_total ("2-3 sprints if sequential, 1 sprint if parallelized to 4 streams").

10. **Summary markdown** (the \`summary_markdown\` field). Produce a self-contained markdown document a busy user can scan in 30 seconds. REQUIRED structure:

\`\`\`
# Audit Summary — <repo-name>

**Verdict:** <GREEN | YELLOW | RED> — <one-line rationale>

## Top 3 risks
1. <risk 1>
2. <risk 2>
3. <risk 3>

## Findings at a glance

| Bucket | Count | Effort |
|---|---|---|
| NO BRAINER | <n> | <effort> |
| QUICK WIN | <n> | <effort> |
| NEEDS DECISION | <n> | varies |
| MAJOR CHANGE | <n> | <effort> |
| DEFER / ACCEPT | <n> | – |
| INVESTIGATE | <n> | research first |

**Total:** <n> findings across <m> lanes.

## No-brainers (apply these now)
- <finding-id>: <one-line action>
- ...

## Quick wins (1-2 sprints, parallelizable)
**Group A — <name>** (<effort>, can run concurrent with B,C):
- <finding-id>: <action>
- ...

**Group B — <name>** ...

## Needs your call
### 1. <decision title> (<finding-id>)
**Options:**
- **<option name>** (<effort>): <pros> / <cons>
- **<option name>** (<effort>): <pros> / <cons>
**Recommendation:** <name or "no clear winner — depends on X">

### 2. ...

## Major changes (need planning)
- **<finding-id>** — <why_major>. Suggested approach: <suggested_approach> (<estimated_effort>)
- ...

## Hotspot map
Files touched by 4+ lanes (highest risk):
- \`<path>\` — <n> findings from <lanes>

## Methodology
<one paragraph: what was sampled, what was skipped, honest caveats>
\`\`\`

Be concrete. Every claim must reference a finding ID. No "should be considered" — say what to do, who decides, how long it takes.
`

const report = await agent(SYNTH_PROMPT, { schema: REPORT_SCHEMA, label: 'synthesis', phase: 'Synthesize' })

// ─── Return ────────────────────────────────────────────────────────────────────

return {
  path,
  archetype: vitals.archetype,
  vitals,
  blast,
  laneSummaries,
  findings: allFindings,
  report,
  // Caller (the skill's invoking agent) is responsible for writing this to disk
  // at <repo>/.audit/<ISO-date>/{report.md, findings.json, vitals.json} per SKILL.md.
}
