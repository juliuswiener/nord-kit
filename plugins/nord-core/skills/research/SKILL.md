---
name: research
description: "Answer a question that needs searching rather than deciding. By default it investigates THIS repository: a goal is split into 3-7 staged hypotheses, each stage routed by complexity, up to 16 agents concurrently, cross-validated for contradictions and gaps — local files, grep and git only, never the web. `--web` instead decomposes the question into 2-5 parallel lookups against documentation, APIs, specs and standards, for what this repository cannot answer."
---

# research

One axis: **where the answer lives.**

| the answer is in | invoke | reference |
|---|---|---|
| this repository | *(default)* | `references/codebase.md` |
| documentation, an API, a spec, a standard | `--web` | `references/web.md` |

## Default — the codebase

Splits the goal into 3-7 staged hypotheses, routes each stage by complexity, fires up to
16 agents concurrently, then cross-validates the returns against each other for
contradictions and gaps. Local only: file reads, grep, bash, git. **It does not search
the web**, and that limit is the point — a codebase question answered from a blog post is
worse than no answer.

## `--web`

Decomposes one question into 2-5 parallel lookups against documentation, APIs, specs and
standards. Use it when the answer cannot be in this tree: a library's current behaviour, a
protocol's wording, whether an API still has the shape your code assumes.

## Not this skill

- **"Where is the important code" / "what is this repo"** → `orient`. It ranks symbols by
  PageRank over tree-sitter tags and returns immediately with no reasoning. `research`
  forms hypotheses and dispatches agents; using it to get oriented is paying for a
  cross-validation you did not need.
- **"What could we do about X"** → `plan --stage ideas`. That is idea generation with
  research rounds inside it, not research with an idea at the end.
- **"Why is this broken"** → `diagnose`. Competing hypotheses against each other and one
  decisive probe, not a survey.

## `--web --deep` is parked, not available

`references/web-deep.md` holds a gpt-researcher-shaped pipeline — plan, delegate the bulk
searching, close gaps, dedupe, synthesise one cited report. It is **not offered as a mode**,
because it dispatches to `nord-core:research-worker` and `nord-core:scrape-worker`, and
neither agent exists: nord-core defines `debugger`, `expert`, `implementer`, `researcher`
and `reviewer`. Measured 2026-09-05.

It came from a `/deep-research` command in `~/.claude/commands/`, **deleted the same day**.
The command had never run past its first dispatch, and nobody noticed for the whole time it
existed — which is the strongest evidence available that the need was not pressing. The
file is kept here, not the command, so the catalogue stops advertising it while the design
survives.

The logic is worth keeping and the gap is two agent definitions, so the file stays with a
header saying so. A mode the router advertises and the runtime cannot execute is the exact
failure this restructuring exists to remove — so it is not advertised until the agents are
written.

## Where the old names went

Until nord-core 1.48.0 this was `nord-codebase-research` and `external-context`. Both
names described their machinery rather than the question; the axis is simply whether the
answer is inside this tree or outside it. Reasoning and the naming rules: vault
`decisions/skills-nach-fragen-statt-nach-mechanismen.md`.
