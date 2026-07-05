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
- Deleting anything under `/tmp`: use `safe-tmp-rm <absolute-path>` — never plain `rm`. Plain `rm`
  hits the ask-rule and stalls on a permission prompt; the wrapper is allowlisted and runs unprompted.
  One absolute path per call, no flags, no `&&`/`;`/pipes, no preceding `cd`; multiple targets = multiple calls.

## Delegation routing (reach for the tool before working inline)
On a task matching a shape below, the named skill/agent is the DEFAULT — working inline is the
exception you justify in one line, not the reverse. Simplicity / ponytail / caveman govern the
ARTIFACT (fewest lines of code, terse prose), never the PROCESS: spawning an agent or running a skill
is not over-engineering. Threshold — delegate when the work is multi-file, multi-step, adversarial-worth,
or a read-heavy fan-out; stay inline for single-file / trivial / conversational (over-triggering wastes
~15× tokens — see Agent orchestration below). Match the shape, don't force it.

| Task shape | Route to |
|---|---|
| Review a written diff/PR, line-level bugs | `nord-core:code-reviewer` (quick) · `/nord-review` (thorough/pre-merge, multi-dim adversarial) |
| Pre-release / handover / due-diligence full audit | `/codebase-audit` |
| "How does X work across the repo", trace data/auth flow, find all patterns of Y | `/nord-codebase-research` |
| Plan an approach in an open solution space | `/nord-plan` |
| Vague idea needs a spec before building | `/nord-requirements` |
| "Did it actually work" completion check (independent) | `nord-core:verifier` · `/verify` |
| Causal debugging of a failure (competing hypotheses) | `nord-core:tracer` · `/trace` |
| Adversarial critique of a plan/diff pre-merge | `nord-core:critic` |
| Security vuln scan | `nord-core:security-reviewer` |
| Broad codebase search — locate, not review | `Explore` · `nord-core:explore` |
| Iterative build-to-green behind a deterministic gate | `/gate-loop` (`ralph`) |
| Organize / clean up project files | `nord-core:project-organizer` · `/nord-cleanup` |
| Command needs a TTY / human input (sudo password, ssh passphrase, installer prompt) | `/run-interactive` (tmux pane — never ask the user to run it manually first) |

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

## Agent orchestration (multi-agent = for BREADTH, not everything)
- **Task-shape gate before fanning out.** Parallel subagents help only when the work DECOMPOSES into
  independent parts (research, review dimensions, per-file edits) — measured +80% on parallelizable
  tasks. On SEQUENTIAL / planning / shared-context work every multi-agent variant DEGRADES (−39% to
  −70%): use ONE agent, or fan out to read only and synthesize in a single thread. Coding is sequential
  → single-agent + subagents-for-reads, never a debating swarm. Multi-agent burns ~15× the tokens.
- **Centralize, don't peer-swarm.** A central orchestrator that fans out and synthesizes contains
  errors (~4×); decentralized handoff-only topologies amplify them (~17×). Keep the lead thread as the
  single synthesizer; subagents return condensed results, never drive each other.
- **Six canonical modes (name the one you're using, don't improvise):** Prompt-Chaining (fixed steps +
  gate between) · Routing (classify → dispatch) · Parallelization (independent fan-out + merge) ·
  Orchestrator-Workers (lead plans → spawns → synthesizes = the Workflow default) · Evaluator-Optimizer
  (generate → judge → refine, e.g. gate-loop) · Autonomous (open loop, deterministic gate + hard stop).
- **Graft ideas, not runtimes.** Adopt patterns (checkpointing, triage-routing, reflection) as native
  Workflow/skill features; do NOT import LangGraph/CrewAI/AutoGen runtimes (single-CLI + local-first).
