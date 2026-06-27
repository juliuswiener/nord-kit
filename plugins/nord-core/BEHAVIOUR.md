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

## Skill/tool policy — adopt-in-place, one hand
- **nord IS the single home.** Don't install/stack external plugins for capabilities — high skill count +
  overlap degrades tool-selection (≤3-5 rule). When a technique/strategy/skill/MCP elsewhere is useful,
  **adopt it INTO nord** (reimplement in our style/infra, like gate-loop), then disable/uninstall the source.
- **Graft, don't vendor-dump.** Take the best techniques into the matching nord keeper skill; never copy a
  whole foreign plugin (its hooks/agents/MCP/scripts) just to relocate it.
- **One canonical skill per function.** If two skills overlap, merge the best of both into one nord skill
  and disable the other (`permissions.deny`/`skillOverrides`/`enabledPlugins:false` — these survive updates).

## Cheap-worker substrate
- nord's cheap-worker seams (gate-loop; optionally nord-execute + review/audit/research gather lanes)
  route `model:` ids through `claude_bridge` (:8318). Launch CC with
  `ANTHROPIC_BASE_URL=http://127.0.0.1:8318` or worker ids 404. Full substrate + id→provider table +
  preflight: see `WORKERS.md` (nord-core). Default worker `qwen3.6-plus`, frontier `claude-*`.

## Provenance & confidence vocabulary (canonical — every skill that emits a claim/score)
One vocabulary toolkit-wide so a claim/score reads the same everywhere. This block is the source of
truth; skills carry a one-line pointer + their domain subset + local anchor (don't restate the full table).

- **Evidence grade (A)** — tag every emitted claim with WHERE it came from:
  `explicit` (stated exactly in the source, with citation) · `derived` (computed/inferred from stated
  values, not directly stated) · `conditional` (stated but as a range/typ/condition-dependent) ·
  `not_mentioned` (absent from source → omit, never guess) · `conflicts` (asserted value does NOT match
  the source — likely hallucination) · `source_unavailable` (couldn't read the source). Code/verification
  skills use the subset `explicit | derived | conflicts | source_unavailable` (+ `not_mentioned` as the
  not-found/coverage-gap channel) — that subset is NOT invented vocab.
- **Anchored score (B)** — a score/confidence NEVER ships as a bare number. Tie it to evidence TIER and
  state what HIGH/≥0.9 vs LOW/0.4 means in that skill's domain. Nothing reaches the top tier without the
  strongest evidence (an executed reproduction, a verbatim source match) — not the model's vibe.
- **Refuted ≠ unavailable (C)** — `conflicts`/`refuted` (checked & wrong) MUST stay distinct from
  `source_unavailable`/`not_runnable`/`coverage_gap` (couldn't check). Flag both; silently drop neither
  (a wrong asserted value is worse than a flagged uncertainty).

(Reference implementations: datasheet-extract + kicad-analyze = A; trace + datasheet-extract = B;
trace/verify/nord-review = C. This pointer resolves because nord-router injects BEHAVIOUR.md every session.)

## Tooling discipline (web-data & beyond)
- **≤3–5 active tools per task.** Tool-selection accuracy drops with count: ~3–5 the model picks
  right, 10–15 systematic mistakes begin, 20+ it calls a tool just because the description sounds
  similar. Mount one tool per job, not every overlapping option "just in case".
- **Lazy fallback.** Expensive rungs (stealth browser, external scrape/search APIs, pixel render)
  only after the cheap local rung returns empty — never prophylactically.
- **Parallelize discovery and read.** Fan out URL/file reads concurrently; never a sequential loop.
- **Context-handoff on worker/model switch.** When handing a task to another agent or model mid-flight,
  inject a compact state summary (goal, decisions so far, what's already answered) so the new worker
  resumes instead of restarting or re-asking settled questions. Pair with the `.nord/state/<skill>-<slug>.json`
  files nord skills already persist — read that state and re-inject it, don't just leave it on disk.
