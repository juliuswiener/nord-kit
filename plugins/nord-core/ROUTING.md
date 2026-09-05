# NORD ROUTER

Where several tools overlap, pick the named one. Do not improvise among duplicates.

<!-- instructor-only -->
## Role — exactly one per worker

| The task is | Preset | Rights |
|---|---|---|
| judge code, change nothing | `reviewer` | read |
| answer from code + web | `researcher` | read + web |
| make the change, run the tests | `implementer` | read + edit + shell |
| reproduce and localise a failure | `debugger` | read + edit + shell |
| a cheaper worker already failed | `expert` | read, frontier model, high effort |

No row fits → the task is not sharp enough to hand over yet.

Roles exclude each other; skills add up. Anything that RESTRICTS is a role, never a skill.

## Memory

`mem-search` prior work before non-trivial planning or execution; note key decisions after.
Yours to run, not the worker's — a worker's context comes from its brief.

## Delegation — every spawn

- Pin four fields: **objective** · **output format** · **tools + budget** · **boundaries**.
- Distinct scope per subagent. Never two on overlapping work.
- Foreign agents you cannot edit — prepend: `Output caveman-style: drop articles/filler/pleasantries/hedging, fragments OK, keep ALL code/paths/identifiers/errors verbatim; normal prose for commits/PRs/security.`
<!-- /instructor-only -->

## Tool

`†` runs in the main session only: it fans out through `Workflow` or subagents, and a worker
is denied `Workflow` unconditionally and `Task`/`Agent` by every policy.

| Task | Default | When other | Do NOT use |
|---|---|---|---|
| **Plan** — what to build, and how | `plan` — the tournament, returns one plan | `--stage ideas` (idea board) · `--stage shortlist` (ranked, weak ones killed) · `--stage spec` (one question per round until requirements are pinned) · `--deep` (Planner→Architect→Critic after the tournament) | make-plan, ralplan, superpowers brainstorming |
| **Implement** — anything behind a test/compiler/lint gate | `implement` — `--from task` (one story; **the only cell a worker may drive**) | `--from goal` (decompose, run until all green) · `--from plan` (split comes from a finished plan) · `+ --parallel` (disjoint stories concurrently) | self-verify loops, LLM-judge gates, do, executing-plans |
| **Review** — a change, a codebase, or a plan | `review` — one pass over the diff | `--scope repo` (whole tree) · `--scope plan` (before anyone builds it) · `--lens security\|a11y\|claims` · `--deep` (parallel specialists, every finding adversarially verified) | `/code-review`, `/security-review` (denied — same job, three entry points), elite-code-reviewer, trusting a green suite, believing the docs |
| **Cleanup** | `nord-cleanup` † | `/simplify` | ai-slop-cleaner |
| **Debug** | `trace` | the `debugger` role, for a worker | systematic-debugging |
| **Research** | `nord-codebase-research` † (codebase) | `external-context` † (web + docs) · native WebSearch/WebFetch | research, autoresearch |
| **Orient in a repo** | `repo-map` | `smart_outline` (one file) · `deepinit` † (AGENTS.md) | `learn-codebase` — reads every file in full · reading files just to orient |
| **Verify** | `verify` | — | claiming done without evidence |
| **Commit message** | `commit` | — | writing one ad hoc |
| **Command needs a TTY** | `run-interactive` | — | asking the user to run it elsewhere |
| **Abort a loop** | `cancel` | — | deleting `.nord/state` by hand |
| **Change or replace a tool** | `TOOLING.md` | — | editing `src/` only, trusting a green suite |

## Not loaded

`nord-web` (read-router, web-scrape, pdf-extract, visual-read) · `nord-dev` (python-debugger,
rust-coder, dart/flutter) · `nord-ee` (kicad-analyze, spice-sim, digikey-search, bom-manager,
ee-reference, emc-precheck) are off in `settings.json`. Reaching for one fails. Enable the
plugin first.
