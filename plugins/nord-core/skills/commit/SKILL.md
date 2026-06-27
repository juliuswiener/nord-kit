---
name: commit
description: "Write a tight, exact commit message — Conventional Commits, subject ≤50 chars, body only when the 'why' isn't obvious. Use when the user says 'write a commit', 'commit message', 'generate commit', or when staging changes. Outputs the message; does not run git commit."
---

# commit

Terse, exact commit messages. Conventional Commits. Why over what. No fluff. (Commit prose stays
normal/clear even under caveman mode.)

## Subject
- `<type>(<scope>): <imperative summary>` — scope optional
- types: `feat fix refactor perf docs test chore build ci style revert`
- imperative ("add", "fix", "remove" — not "added"/"adds"); ≤50 chars (hard cap 72); no trailing period
- match project capitalization after the colon

## Body (only if needed)
- skip when the subject is self-explanatory
- add only for: non-obvious *why*, breaking changes, migration notes, linked issues
- wrap 72; bullets `-`; reference issues at end (`Closes #42`)
- **Always** include a body for: breaking changes, security fixes, data migrations, reverts

## Never put in
- "this commit does X", "I/we/now/currently" — the diff says what
- restating the filename when scope already says it
- emoji (unless project convention)

## Trailers (this environment's convention — REQUIRED)
End every commit with the harness trailers (these are NOT the banned "AI attribution" noise — they are
the required provenance for this setup):
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MWfnPf1DFqSi9irBcYnx1r
```

## Examples
```
feat(api): add GET /users/:id/profile

Mobile client needs profile data without the full user payload to cut
LTE bandwidth on cold-launch.

Closes #128
```
```
feat(api)!: rename /v1/orders to /v1/checkout

BREAKING CHANGE: clients must migrate before 2026-06-01; old route 410s after.
```

## Boundary
Generates the message only — does NOT stage, commit, or amend (the caller runs git). Output a paste-ready
code block. Commit/PR prose is always normal, never caveman-compressed.
