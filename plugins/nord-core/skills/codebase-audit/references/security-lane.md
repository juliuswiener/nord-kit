# Lane 5 Security — extended scope

The security lane's full mandate. Read when running or tuning Lane 5 (the actual lane prompt lives in `audit.workflow.js` as `LANE_SECURITY`).

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
