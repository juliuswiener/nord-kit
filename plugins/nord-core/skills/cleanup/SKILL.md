---
name: cleanup
description: "Make a repository tidier, in one of two ways that are never mixed. `--remove` runs parallel detectors for dead code, duplication, AI slop, over-abstraction and unused dependencies, verifies each candidate is safe to delete, and returns a deletion-first plan. `--move files|modules` relocates instead: docs, scripts and tests out of the root into conventional folders, or modules regrouped vertically by feature. There is no default — you have to say which."
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

One half of this skill deletes and the other half moves. A move is reversible by moving
back; a deletion is reversible only through git, and only if the work was committed.
Making the destructive half the flagless default would put the irreversible operation
behind the shortest command — which is backwards, and is the rule this plugin applies to
every hook and skill that can destroy something: **a destructive mode names its verb.**

So the friction is deliberate. It costs one word and it removes the case where somebody
types `cleanup` meaning "tidy up the folders" and gets a deletion plan.

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

## Where the old names went

Until nord-core 1.48.0 this was `nord-cleanup` (delete) and `organize-project` (move),
plus `organize-modules` in the nord-dev plugin. Two names for one verb meant the reader
had to know which was which before choosing; the mode list answers it in place. Reasoning
and the naming rules: vault `decisions/skills-nach-fragen-statt-nach-mechanismen.md`.
