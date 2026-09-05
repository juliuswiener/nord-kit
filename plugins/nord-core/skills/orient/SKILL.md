---
name: orient
description: "Find out where you are in an unfamiliar repository without reading files — returns the whole-repo symbol skeleton ranked by PageRank over tree-sitter tags, so the answer is 'here is the important code' rather than 'here is all the code'. No network, no build step, no reasoning pass; about a second in any tree. Use before planning a change in a repo you do not know, when asked to map or explain a codebase, or on 'wo bin ich hier', 'was ist das für ein Repo', 'zeig mir die wichtigsten Stellen'. For ONE file use smart_outline; for what depends on what use the graphify skill."
---

# orient — the ranked symbol skeleton

## Run it

```bash
nord-repomap [ROOT] --map-tokens N
```

- `ROOT` — repo root, default cwd. Uses `git ls-files` where available, so `.gitignore`
  is respected; otherwise walks the tree with sane excludes.
- `--map-tokens N` — budget for the map. Default `1024`, `2048`–`4096` for a large repo,
  `~300` for just the top.

```bash
nord-repomap                              # cwd, ~1024 tok
nord-repomap ~/00_projects/foo --map-tokens 2048
nord-repomap . --map-tokens 300           # top symbols only
```

Output is `file: line: signature`, grouped by file, ordered by PageRank over a tree-sitter
def/reference graph (vendored from Aider's `get_ranked_tags`, Apache-2.0), capped at the
budget:

```
# repo-map: <root>  (<N> top symbols / <M> files, ~<budget> tok budget)
path/to/file.py:
  41: class JLCPCBClient:
  82: def _request(self, method, path, body=None):
```

Then read the named files, or run lsp on a symbol from the list, to go deeper. **Reading
files in order to orient is what this replaces** — one call beats a dozen Reads at a
fraction of the tokens.

## What it is not

Reach for something else when the question is one of these:

| the question | the tool | why not orient |
|---|---|---|
| what depends on what, what breaks if X changes | the `graphify` skill | both extract with tree-sitter; **orient ranks, graphify relates**. graphify needs a built `graphify-out/graph.json`, orient needs nothing |
| the structure of ONE file | `smart_outline`, then `smart_unfold` | orient is the cross-file primitive; on a single file it is strictly worse |
| definition, references or rename of a known symbol | `t` lsp_goto_definition / lsp_find_references / lsp_rename | orient ranks, it does not resolve |
| a structural pattern across files | `t` ast_grep_search | shape, not importance |
| how does this work, why does it behave that way | `research` | orient does no reasoning at all, which is what makes it cheap enough to run before you know whether you need it |
| write AGENTS.md across the tree | `deepinit` | that writes files; everything here is read-only |

## Properties

- **Local.** Pure tree-sitter plus networkx — no network, no build, code never leaves the
  machine. Tool-surface cost is zero: a skill calling a local script, not an MCP tool.
- **15 languages:** bash, c, cpp, csharp, dart, elixir, go, java, javascript, lua, ocaml,
  python, ruby, rust, swift. Everything else is skipped silently — including TypeScript,
  which has no Aider tag query, **so a TS-only repo returns an empty map**. Fall back to
  `smart_search` there rather than concluding the repo has no important code.
- **Install**, only if `nord-repomap` is missing: venv at `~/02_Software/nord-tools/repomap/`
  with deps pinned in `requirements.txt`, launcher at `~/.local/bin/nord-repomap`, tag
  queries under `queries/`. Rebuild with
  `python -m venv .venv && .venv/bin/pip install -r requirements.txt`.
