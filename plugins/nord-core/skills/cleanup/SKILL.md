---
name: cleanup
description: "Make a repository tidier, in one of two ways that are never mixed. `--remove` runs parallel detectors for dead code, duplication, AI slop, over-abstraction and unused dependencies, verifies each candidate is safe to delete, and returns a deletion-first plan. `--move files|modules` relocates instead: docs, scripts and tests out of the root into conventional folders, or modules regrouped vertically by feature. There is no default — you have to say which. Use on 'clean this up', 'remove dead code', 'reorganise the repo', 'räum das auf', 'aufräumen', 'toten Code raus', 'sortier das Repo'."
---

# cleanup

Two jobs under one verb, and **no default**: `cleanup` on its own does nothing until you
say `--remove` or `--move`.

| you want | invoke | reference |
|---|---|---|
| less code | `--remove` | `references/remove.md` |
| the same code, better placed | `--move files` | `references/move.md` |
| modules grouped by feature instead of by layer | `--move modules` | `references/move.md` |

## Why there is no default

A move is reversible by moving back; a deletion is reversible only through git, and only
if the work was committed. A flagless default would put the irreversible half behind the
shortest command. **A destructive mode names its verb** — one word of friction, in
exchange for nobody typing `cleanup` meaning "tidy the folders" and getting a deletion
plan.

## `--remove`

Parallel detectors — dead code, duplication, AI slop, over-abstraction, unused
dependencies — then a **verify-safe-to-remove** pass before anything is proposed, then a
deletion-first plan. The verification is the load-bearing half: a detector that finds an
unreferenced symbol has found a candidate, not a fact, and dynamic dispatch, reflection,
string-built imports and test-only entry points all defeat a naive reference count.

## `--move files` and `--move modules`

`files` is the repository root: docs, scripts and tests into conventional folders,
redundant documentation consolidated. `modules` is the deeper cut — regroup modules
**vertically by feature domain** rather than horizontally by layer, which is a change to
how the tree is read rather than to where files sit.

Both produce a plan and a completion report; the templates are in
`references/move-templates.md`.
