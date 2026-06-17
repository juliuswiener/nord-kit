# NORD BEHAVIOUR — global rules

Synced across all devices via nord-core (injected each session by the nord-router hook).
Edit here → `git push` → every device picks it up next session. Personal global conventions
live here instead of per-device `~/.claude/CLAUDE.md`.

## Rules
- Never use mock LLM calls unless specifically demanded.
- Verify before claiming done — run it / show evidence, don't assume.
- Prefer editing existing files over creating new ones; no stray docs unless asked.
- When something is destructive or outward-facing (delete, publish, push, send), confirm first
  unless already authorized in this turn.
- Keep secrets out of git — use `${ENV}` placeholders in committed config, real keys in each
  device's `~/.claude/settings.json` `env`.
