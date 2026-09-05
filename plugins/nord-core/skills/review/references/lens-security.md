---
name: security-checklist
description: Checklists and severity rules for a security pass over code — authentication, input validation, output encoding, secrets, and dependency CVEs — with CRITICAL/HIGH/MEDIUM/LOW definitions and a remediation clock per level. Use when reviewing code for vulnerabilities, checking a change for OWASP issues, hunting hardcoded credentials or injection paths, auditing an authentication or session flow, or when a security finding needs a defensible severity and deadline. For the general code pass use review-lenses.
---

# Security checklist

Five areas. Work them in order — a leaked secret outranks everything below it, because
rotating it is the only finding with a clock measured in minutes.

## Authentication and authorisation

- passwords hashed with bcrypt or argon2, not a general-purpose digest
- session tokens cryptographically random
- JWTs signed **and validated** — a token that is only decoded is not checked
- access control enforced on every protected resource, not only the ones with a UI

## Input validation

- every user input validated and sanitised
- SQL through parameterised queries
- file uploads checked on type, size **and content** — an extension is a claim, not a fact
- URLs validated against SSRF

## Output encoding

- HTML escaped against XSS
- JSON responses properly encoded
- no user data echoed into error messages
- `Content-Security-Policy` set

## Secrets

- no hardcoded API keys, passwords or tokens
- secrets from the environment
- secrets never logged and never surfaced in an error

## Dependencies

- no known CRITICAL or HIGH CVEs
- dependencies current
- sources verified

## Severity

| Level | Means |
|---|---|
| **CRITICAL** | exploitable with severe impact — data breach, RCE, credential theft |
| **HIGH** | serious impact, but needs specific conditions |
| **MEDIUM** | real weakness, limited impact or difficult to exploit |
| **LOW** | best-practice violation or minor concern |

## Remediation clock

| Priority | Deadline |
|---|---|
| rotate an exposed secret | within the hour |
| CRITICAL | within 24 hours |
| HIGH | within a week |
| MEDIUM | within a month |
| LOW | backlog |

Rotation comes first and is not a fix in itself: the secret is already out, so the clock
started when it was committed, not when it was found. Fix the leak afterwards.
