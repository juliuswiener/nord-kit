---
name: deepinit
description: "Generates hierarchical AGENTS.md files across a codebase — one per significant directory, each linking to its parent, describing what lives there and how it fits together. Use when onboarding a repository that has no agent-facing documentation, or when the user says 'deepinit', 'generate AGENTS.md', 'set this repo up for Claude', 'dokumentier das Repo für Agenten'. To orient yourself without writing files, use `orient` instead."

disable-model-invocation: true   # writes files across the whole tree; a one-shot setup action nobody wants auto-triggered
---

# deepinit — hierarchical AGENTS.md across a tree

Writes one AGENTS.md per significant directory, each carrying a parent link, so an agent
that enters any subdirectory can walk up to the root. **It writes files across the whole
tree** — which is why only the user starts it.

To orient yourself without writing anything, use `orient`.

## The template

Every file except the root opens with a parent tag. That tag *is* the hierarchy.

```markdown
<!-- Parent: ../AGENTS.md -->
<!-- Generated: {date} | Updated: {date} -->

# {Directory Name}

## Purpose
{One paragraph: what lives here, and what role it plays in the whole.}

## Key Files
| File | Description |
|------|-------------|
| `file.ts` | one line, what it is for |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `subdir/` | what it holds (see `subdir/AGENTS.md`) |

## For AI Agents
### Working in this directory
{Conventions that differ from the obvious. Omit the section when there are none.}
### Testing requirements
{How to test a change made here — the actual command.}
### Common patterns
{Patterns actually used here, each with a file that demonstrates one.}

## Dependencies
### Internal
### External

<!-- MANUAL: notes below this line survive regeneration -->
```

Write nothing generic. "Contains utility functions" describes every `utils/` ever written
and is worth less than an absent section — a reader who trusts it has been misled, and one
who does not has paid for it anyway.

## Run

1. **Map the tree.** One `researcher` agent on haiku: *list all directories recursively,
   excluding `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.venv`, `coverage`,
   `.next`, `.nuxt`.*
2. **Order by depth** — level 0 is the root, then level 1, and so on.
3. **Generate parent levels before child levels.** A child's parent tag must point at a
   file that already exists.
4. **Per directory**: read the files, then write AGENTS.md with the correct relative parent
   path. Same-level directories run in parallel, different levels never do. Batch small
   directories into one agent; give a large one its own.
5. **Where a file already exists, merge**: keep everything below `<!-- MANUAL -->`
   verbatim, refresh the generated sections above it, update the `Updated:` stamp.
6. **Validate** (below), then report how many files were written, updated and skipped.

Delegate mapping and reading to `researcher`, the writes to `implementer`. nord-core
defines exactly five agents — `debugger`, `expert`, `implementer`, `researcher`,
`reviewer` — and any other name fails at dispatch without a useful error.

## Empty and near-empty directories

| what is in it | what to do |
|---|---|
| no files, no subdirectories | **skip** — write nothing |
| no files, but subdirectories | minimal file: parent tag, purpose, subdirectory table |
| only generated output (`*.min.js`, `*.map`) | skip |
| only configuration | write one, describing what is configured |

## Validate before reporting

```bash
find . -name AGENTS.md -type f | wc -l          # how many exist now
grep -rL "<!-- Parent:" --include=AGENTS.md .   # files with no parent tag
```

The root AGENTS.md is the only legitimate hit in the second command; every other hit is a
broken link. Then confirm each `<!-- Parent: -->` path actually resolves, that every
non-excluded directory with content has a file, and that no AGENTS.md survives in a
directory that no longer exists. Fix or delete what fails, and report anything you could
not resolve rather than leaving it silent.
