---
name: cleanup --move files
description: Reorganizes a cluttered repository — moves docs, scripts and tests out of the root into conventional folders, consolidates redundant documentation, and updates every reference so nothing breaks. Use when the user says the root is a mess, asks to organize, restructure or tidy project files, consolidate docs, or clean up a tree before handover. For deleting dead code use cleanup --remove.
disable-model-invocation: true
---

# Organizing a project

Moves files and rewrites the references to them. Every move can break an import, a script
path or a CI config, so the order below is not negotiable: find the references first, get
approval, then move.

## When invoked

1. **Map.** Walk the directory tree. Record every root-directory entry and its type:
   documentation, script, test, source, config, build artefact, runtime file.
2. **Find every reference** to each file you intend to move. Grep for the filename, the
   import path, and the path without extension. Keep the list — it is the input to step 5,
   not a check you do once.
3. **Categorise** into: stays in root · moves to a folder · merges into another document ·
   is generated and belongs in `.gitignore`.
4. **Present the plan and stop.** Findings, the categorised changes, the dependency impact
   from step 2, the risk. Wait for explicit approval. Move nothing before it.
5. **Execute one category at a time**, updating that category's references immediately
   after its moves — not at the end. A half-finished batch with stale references is harder
   to reason about than either end state.
6. **Verify**: re-grep every old path (expect zero hits outside git history), run the
   project's build and test command, confirm the entry points still resolve.
7. **Report** what moved, what merged, what was left alone and why, with the verification
   output.

## Rules

- Never move a file before finding its references. A rename that breaks an import is the
  failure this procedure exists to prevent.
- Never delete without explicit confirmation, even for something obviously generated.
- Never touch `.git/`, `.github/`, `.gitlab/`. Change `.gitignore` only when that change
  is the point.
- Build artefacts (`__pycache__/`, `node_modules/`, build directories) do not move.
  Confirm they are ignored and say so; that is the whole action.
- Runtime files (`*.pid`, cache directories) get confirmed as generated, then deleted —
  in that order.
- Use absolute paths in plans and reports. A relative path in a document about moving
  files is ambiguous exactly where it matters.
- Stay inside the organizational scope. If a file's content needs changing rather than its
  location, say so and leave it.

## Consolidating documents

Decide which case applies before editing:

| Overlap | Action |
|---|---|
| 90 %+ redundant | keep the most complete version, delete the other |
| complementary | merge into one, preserving every unique section |
| obsolete but historical | move to an archive folder, do not delete |

Read both files completely before merging. A merge that drops a section nobody re-read is
indistinguishable from a deletion.

## Output format

The plan, before approval:

```
## Findings
<what the tree looks like now, and what is wrong with it>

## Plan
| From | To | Why | References to update |

## Risk
<what could break, and what protects against it>

## Approval
<the explicit question>
```

The report, after execution:

```
## Moved / merged / left alone
<each with its reason>

## Verification
- grep for old paths: N hits (expect 0)
- build: [command] -> pass/fail
- tests: [command] -> X passed
```

## References

- `move-templates.md` — the full plan and completion-report templates, and the
  conventions for where each file type belongs. Read when writing either document.
