---
name: repo-map
description: "Whole-repo symbol skeleton ranked by PageRank over tree-sitter tags — orientation before a task without reading files. Use for 'map this repo', 'what are the key symbols', 'where's the important code', 'orient me in this codebase', or before planning a change in an unfamiliar tree. Local, data-sovereign (no network, no cloud). Complements per-file lsp/ast_grep/smart_search — this gives the cross-file IMPORTANCE ranking they can't."
---

# repo-map — symbol-ranked whole-repo skeleton

Emits the most important symbols across a repo as a compact `file: line: signature` skeleton, ranked by **PageRank over a tree-sitter def/reference graph** (vendored from Aider's `get_ranked_tags`, Apache-2.0). The cross-file orientation primitive that reading files or per-file outlines can't give cheaply: it tells you *which* symbols matter, not just what exists.

**Tool-surface cost: zero** — this is a skill calling a local script, NOT an MCP tool. Stays inside the ≤3-5-active-tools discipline.

## When to use vs alternatives

| Need | Use |
|---|---|
| "What are the key symbols / where's the important code across the whole repo" | **repo-map** (this) |
| Definition / references / rename of a known symbol | `t` lsp_goto_definition / lsp_find_references / lsp_rename |
| Structural pattern across files (shape, not importance) | `t` ast_grep_search |
| Outline / structure of ONE file | claude-mem smart_outline / smart_search |
| Did directory structure change (for AGENTS.md regen) | `t` deepinit_manifest |

Reach for it **before planning a change in an unfamiliar tree** or when orienting — one cheap call beats reading a dozen files.

## How to run

```bash
nord-repomap [ROOT] --map-tokens N
```

- `ROOT` — repo root (default: cwd). Uses `git ls-files` when available (respects `.gitignore`), else walks with sane excludes.
- `--map-tokens N` — token budget for the map (default `1024`). Bump to `2048`–`4096` for large repos, drop to `~300` for a quick top-of-mind.
- `--lang-info` — list supported languages.

Examples:

```bash
nord-repomap                          # map cwd, ~1024 tok
nord-repomap ~/00_projects/foo --map-tokens 2048
nord-repomap . --map-tokens 300       # just the top symbols
```

## Output

```
# repo-map: <root>  (<N> top symbols / <M> files, ~<budget> tok budget)
path/to/file.py:
  41: class JLCPCBClient:
  82: def _request(self, method, path, body=None):
plugins/.../sexp_parser.py:
  15: def parse(text: str) -> list:
  ...
```

Symbols are ordered by importance (PageRank), grouped by file, capped at the token budget. Read the named files / use lsp on a symbol from here to go deeper.

## Properties

- **Local & data-sovereign** — pure tree-sitter + networkx, no network, code never leaves the machine.
- **Languages (15):** bash, c, cpp, csharp, dart, elixir, go, java, javascript, lua, ocaml, python, ruby, rust, swift. Unsupported files (e.g. TypeScript — no Aider tag query) are silently skipped.
- **Fast:** ~1s on a ~100-file repo.
- **Install:** venv at `~/02_Software/nord-tools/repomap/` (deps pinned in `requirements.txt`); launcher `~/.local/bin/nord-repomap`. Tag queries vendored under `queries/` (Aider, Apache-2.0). Rebuild: `python -m venv .venv && .venv/bin/pip install -r requirements.txt`.
