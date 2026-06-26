# NORD ROUTER — canonical task routing

Single source of truth for which tool to use. When several tools overlap, pick the named one;
do not improvise among duplicates. (Injected each session by the nord-router SessionStart hook.)

| Task | Default | When other | Do NOT use |
|---|---|---|---|
| **Plan** | `nord-plan` (parallel lens tournament) | `nord-plan --consensus` (vague/high-stakes → sequential Planner/Architect/Critic + ADR) · `nord-requirements` (pin vague requirements first) | omc plan, ralplan, make-plan, writing-plans, sw-planner, task_planner |
| **Brainstorm** | `brainstorm-adversarial` (decide between ideas) | `brainstorm` (explore idea space) | superpowers brainstorming |
| **Execute** | `nord-execute` (choose mode: parallel batch / `/loop` / ralph, optional `/goal`-gate) | `ralph` (completion loop) · `team` (parallel+coordination) · `autopilot` (full idea→code) · executor agent (one file) | do, executing-plans, subagent-driven-development |
| **Review** | `nord-review` (deep multi-agent) | `/code-review` (quick diff) · `/security-review` | elite-code-reviewer, requesting-code-review |
| **Cleanup** | `nord-cleanup` (multi-agent safe-delete) | `/simplify` (quick quality) | ai-slop-cleaner (superseded) |
| **Debug** | `trace` (causal, competing hypotheses) | debugger agent (single) | systematic-debugging |
| **Audit** | `codebase-audit` (full architectural) | `scrutinize-code` (quick single-pass) | adversarial-codebase-autopsy (removed) |
| **Research** | `external-context` (web + docs, parallel doc-specialists) | `nord-codebase-research` (codebase, parallel scientists + cross-validate) · native WebSearch/WebFetch | research, autoresearch |
| **Web data / Read** | `read-router` (pick paradigm per URL/file) → `web-scrape` (Crawl4AI local) · `pdf-extract` (MinerU PDF) · `visual-read` (visual) | `web-scrape --stealth` (anti-bot/login) · Firecrawl MCP (external, last resort) | raw WebFetch on a PDF, screenshotting normal pages |
| **Verify** | `verify` (before claiming done) | — | — |
| **Memory** | claude-mem `mem-search` (past work) | `wiki` (durable notes) | — |
| **Prime codebase** | `deepinit` | claude-mem `learn-codebase` | — |
| **EE / hardware** | `kicad-analyze`/`spice-sim`/`digikey-search`/`bom-manager`/… (nord-ee) | `ee-reference` (design), `emc-precheck`, `datasheet-extract` | — |
| **Rust** | `rust-coder` (+ `rust-unit-tester`) | — | — |
| **Python** | `python-ticket-implementer` (+ `python-debugger`) | — | — |

## Delegation rule (caveman everywhere)
When spawning ANY subagent (Task / Agent), prepend this one line to its prompt so its output is
cheap and fast — works even for upstream agents you cannot edit:
`Output caveman-style: drop articles/filler/pleasantries/hedging, fragments OK, keep ALL code/paths/identifiers/errors verbatim; normal prose for commits/PRs/security.`
(nord-kit's own agents already bake this in.)

## Memory rule (claude-mem)
claude-mem already auto-injects recent memory at session start and auto-captures observations —
no per-agent plumbing needed. For non-trivial planning/exec, additionally: `mem-search` prior work
BEFORE starting, and note key decisions AFTER. Do not hard-wire memory calls into every subagent.

Edit this file in `nord-kit/` → the hook reads it at session start, so changes propagate everywhere.
