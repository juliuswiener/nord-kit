---
name: commit-message
description: "Write one commit message — Conventional Commits, subject ≤50 characters, a body only where the 'why' is not obvious. It outputs the message and nothing else: no staging, no commit, no amend, no push, which is what the `-message` in the name is for. Use on 'write a commit', 'commit message', 'generate commit', 'schreib einen Commit', 'Commit-Nachricht', or when changes are staged and the text is missing."
---

# commit-message

Terse, exact, why over what. Produce a paste-ready block and stop — the caller runs git.

## Subject

- `<type>(<scope>): <imperative summary>`, scope optional
- types: `feat fix refactor perf docs test chore build ci style revert`
- imperative — "add", "fix", "remove", never "added" or "adds"
- ≤50 characters, hard cap 72, no trailing period
- match the project's capitalisation after the colon

## Body — only where it earns its place

Skip it when the subject already says everything. Write one for a non-obvious *why*, and
**always** for breaking changes, security fixes, data migrations and reverts.

Wrap at 72, bullets with `-`, issue references last (`Closes #42`).

## Never

- "this commit does X", or "I / we / now / currently" — the diff says what changed
- restating the filename when the scope already names it
- emoji, unless the project already uses them

## Check before handing it over

The subject length is the one thing here that is mechanically checkable, and going over
is the failure this skill exists to prevent:

```sh
printf '%s' '<subject line>' | wc -c
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

## Trailers

**No attribution trailer by default.** Not one commit in nord-kit, claude_bridge or the
vault carries a `Co-Authored-By:` or `Claude-Session:` line (0 of 70, measured
2026-09-05), so adding one makes this commit the odd one out.

Add them only when the user asks, and never type a session id by hand — the variable is
substituted when this skill loads, so the correct value is already here:

```
Claude-Session: ${CLAUDE_SESSION_ID}
```

Commit and PR prose stays normal and clear, never caveman-compressed.
