# The gate pattern (reusable contract)

The one invariant behind nord's cheap-worker seams. Bench-verified
(`local-llm-harness-research/BENCH-FINDINGS.md`). Cite this file; don't restate it.

## Contract
1. **LLM proposes → DETERMINISTIC gate verifies → human decides.** No LLM judge in the $0 loop.
2. **The gate is a single command whose exit code is the ONLY verdict** — `pytest -q`, `ruff check`,
   `cargo build`, `npm test`. Never self-verify, never invent a success criterion.
3. **Escalate to a genuinely STRONGER frontier** (Claude/Opus, the orchestrator thread) after **3
   consecutive red gates** — never before. Lateral escalation (same-tier, e.g. gemini≈qwen) is a wash
   (+1pp); only a stronger tier converts a flagged step into a real fix.
4. **The gate MUST match the spec — use a MIDDLE gate.** Target test + the touched module's *sibling*
   tests, named in the worker's spec. A single-test gate inflates offload AND false-pass (narrow
   1.87× / 45-64% fp); the full suite collapses offload (1.03×). Never report offload without naming
   the gate regime.
5. **Worker prompts stay terse** — "smallest change to green", JSON/exact schema only. Verbose
   schema/CoT prompts are flat-to-NEGATIVE for cheap workers (P2) and can break tool-selection.
6. **Workers are the cheap tier; routing & prompt are NOT levers.** The lever is the gate executing
   the work + escalation. Pick the best cheap worker (`qwen3.6-plus`), don't agonize.

## The floor (know it)
Where **no runtime gate exists** (tool-call/judgment steps), ~15-20% of cheap-worker steps are
**confident-wrong** (right tool, valid args, wrong *value*). No $0 deterministic signal (schema
validity = blind, 0% recall) catches them. The only gold-free signal that fires is **self-consistency
k=3 @temp0.7** → escalate disagreers (~15-19% of steps, ~65% recall). The confident-wrong floor
remains — closing it needs the gold, a judge, or a real runtime gate. **If the job has no
deterministic gate AND stakes are high, do not trust the cheap tier alone.**

## Picks
- Cheap worker: `qwen3.6-plus` (default), `glm-5.1` (fallback). Avoid `minimax-m3`.
- Frontier / escalation: `claude-*` (Opus orchestrator / sonnet via bridge). NOT a lateral tier.
- Substrate + launch + preflight: see `WORKERS.md` (nord-core).
