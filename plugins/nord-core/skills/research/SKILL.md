---
name: research
description: "Answer a question that needs searching rather than deciding. By default it investigates THIS repository: a goal is split into 3-7 staged hypotheses, each stage routed by complexity, up to 16 agents concurrently, cross-validated for contradictions and gaps — local files, grep and git only, never the web. `--web` instead decomposes the question into 2-5 parallel lookups against documentation, APIs, specs and standards, for what this repository cannot answer. Use on 'find out how X works', 'research this', 'wie funktioniert das hier', 'finde raus', 'recherchier das'."
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

## There is no `--web --deep`

`references/web-deep.md` holds a designed-but-unrunnable pipeline: it dispatches to
`research-worker` and `scrape-worker`, and neither agent exists — nord-core defines
`debugger`, `expert`, `implementer`, `researcher` and `reviewer`. Do not offer it as a
mode and do not try to run it. Writing those two agents is what would unpark it.
