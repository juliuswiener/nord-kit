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
- Destructive commands are gated by `dcg` (deterministic shell-AST guard, PreToolUse Bash hook):
  `rm -rf` under `/tmp` and `/var/tmp` runs unprompted, elsewhere it asks, and anything under
  `$HOME` plus raw-device `dd` / `mkfs` / `git push --force` / `gh repo delete` is denied.
  No wrapper needed — `safe-tmp-rm` is retired. For a legitimate blocked case use `dcg allow-once`
  (short-code approval), don't loosen the rule. Call it bare: a pipe or redirect on the same line
  drops the self-inspection exemption and the escape hatch blocks itself.
  Working with the grain beats fighting it — most blocks have a cleaner form anyway:
  `cargo clean --profile dev` instead of `rm -rf target/debug` (it keeps `release`), a literal
  path instead of a shell variable before `git` (a variable trips alias-semantic analysis), and
  a commit message written to a file via `git commit -F` when the text itself names destructive
  commands (dcg scans the whole string, heredoc bodies included).
  Device note: `dcg` must be installed and wired in `settings.json` for this to hold. Where it is
  absent (legacy device), plain `rm` under `/tmp` may still stall on the old ask-rule — install `dcg`.
- Repos with a build step go to `~/02_Software/`, never `/tmp` — `/tmp` is tmpfs (RAM, 16G,
  `usrquota`). One Rust target fills it, and once it is full every Bash command fails with
  exit 1 (heredocs and pipes need `/tmp`), which reads like a broken hook, not a full disk.
  The error is `Disk quota exceeded (os error 122)`, not ENOSPC — so a bare `df` that still
  shows free space elsewhere is not reassurance. Check `df -h /tmp` first when Bash dies wholesale.
  Same trap without a build: any step that bursts scratch writes — a full test suite, a large
  extraction, a pre-push hook — can hit the quota on its own. Point those at quota-free disk
  first: `export TMPDIR="${TMPDIR:-$HOME/.cache/<proj>-tmp}"; mkdir -p "$TMPDIR"`. Do this per
  heavy step, not as a global default — `/home` runs near full, and moving all scratch there
  trades a quota failure for a disk-full one.

## Build discipline
The YAGNI ladder in `CLAUDE.md` says what to skip. These say what makes skipping safe —
without them "fewest lines" is code-golfing. Measured on ponytail's own agentic benchmark
(Haiku 4.5, 12 feature + 6 safety tasks, n=4, scored on real `git diff`): the full ruleset
cut LOC 54%, tokens 22%, cost 20%, time 27% at 100% safety, while a bare "YAGNI + one-liners"
prompt cut less and dropped a path-traversal guard in one run of four.

- **Reuse before stdlib.** Before reaching for the standard library, check whether this
  codebase already has the helper, util or pattern. A second implementation of something
  already here is worse than a slightly awkward call into the existing one.
- **Non-trivial logic leaves ONE runnable check.** A branch, a loop, a parser, a money or
  security path — leave the smallest thing that fails if the logic breaks: an assert-based
  `demo()`/`__main__` self-check, or one small `test_*.py`. No frameworks, no fixtures, no
  per-function suites unless asked. Trivial one-liners need no test. Lazy code without its
  check is unfinished.
- **Fix the root cause, not the call site.** When fixing a bug, grep every caller of the
  function you touch and fix the shared function once. One guard there is a smaller diff
  than one guard per caller — and the callers you did not find stay broken otherwise.
- **Mark deliberate simplifications** with a `ponytail:` comment naming the ceiling and the
  upgrade path: `# ponytail: global lock, per-account locks if throughput matters`. An
  admitted limit is a decision; an unmarked one is a bug waiting to be discovered.

## Delegation routing (reach for the tool before working inline)
On a task matching a shape below, the named skill/agent is the DEFAULT — working inline is the
exception you justify in one line, not the reverse. Simplicity / ponytail / caveman govern the
ARTIFACT (fewest lines of code, terse prose), never the PROCESS: spawning an agent or running a skill
is not over-engineering. Note the two are not the same lever: ponytail cuts tokens because it skips
work, caveman only shortens prose. Measured against a normal baseline, terse-prose-only came out at
−20% LOC but **+7% tokens and +3% cost** — it is a readability preference worth keeping on its own
terms, not an efficiency measure. Don't reach for caveman to save budget; reach for the ladder. Threshold — delegate when the work is multi-file, multi-step, adversarial-worth,
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
