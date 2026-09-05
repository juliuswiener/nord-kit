---
name: plan
description: "Decide what to build and how, and stop at whatever maturity you actually need. `--stage ideas` for an idea board, `--stage shortlist` for a ranked set with the weak ones killed, `--stage spec` for pinned requirements via one question per round; with no stage it runs the planning tournament and returns a plan. Add `--deep` for post-tournament Planner→Architect→Critic validation on vague or expensive work. Use for planning a change, exploring options, deciding between ideas, or pinning down what is actually being asked."
---

# plan

One axis: **which artifact you want**. The stages form a maturity ladder, and you enter
at the rung where your uncertainty actually sits — running an earlier one when you
already have its output is the most common waste here.

| you want | invoke | reference | it returns |
|---|---|---|---|
| the space of options | `--stage ideas` | `references/ideas.md` | an idea board from alternating discussion and research rounds. Generative, **not** ranked |
| one option out of several | `--stage shortlist` | `references/shortlist.md` | a ranked shortlist plus hybrids: persona ideators diverge, a red team kills the weak by majority, champions steelman the survivors |
| to know exactly what is asked | `--stage spec` | `references/spec.md` | a spec, reached by **one question per round** with an ambiguity gate, topology-first scoping and an approval gate before handoff |
| a plan | *(no stage)* | `references/plan.md` | one plan: N planners draft under different lenses, judges score them **against each other**, a synth step merges the winner with the best of the rest |
| a plan you can bet on | `+ --deep` | `references/deep.md` | the same tournament, then a sequential Planner→Architect→Critic pass. Auto-widens to a pre-mortem and expanded test plan on auth, migration, destructive, PII or API-break signals |

`--deep` is the depth axis, spelled the same as in `review --deep`: same task, more
instances, an adversarial or sequential check on top. It was `--consensus` until
nord-core 1.47.0 — a name that described the mechanism and described it wrongly, because
Planner→Architect→Critic is a chain, not a vote.

## Which rung

- Nothing written down yet, and several directions are plausible → `--stage ideas`.
- Several directions already on the table, need one → `--stage shortlist`.
- One direction agreed, but "what exactly" would get two different answers from two
  people → `--stage spec`. This is the rung people skip, and the skipping is what
  produces a tournament of five plans for the wrong problem.
- The what is settled, the how is open → no stage.
- Being wrong is expensive, or the request is vague → `+ --deep`.

Stages are not a pipeline you must walk. `--stage spec` does not need an idea board
first, and a plan does not need a spec — each rung is an entry point, and each returns
its artifact and stops.

## What every stage shares

1. **The result is pending approval, always.** No stage hands its output to execution on
   its own. Handoff is `implement --from plan`, and it is the human who says go.
2. **A decomposition job is not a tournament.** When the work is "apply X to N places"
   and the N are already known, this skill is the wrong tool — that is
   `implement --from goal`, which splits into stories that each carry a deterministic
   gate. Reach for the tournament only when the N is not known, or when the approach
   itself is in question.
3. **The pre-execution gate guards all of it** — see `references/pre-execution-gate.md`.
   An execution keyword with a short prompt and no concrete anchor (file path, symbol,
   issue number, code block, error text, numbered steps) is underspecified and gets
   redirected here before anything runs. Bypass with a `force:` or `!` prefix.

## Reviewing a plan is not here

`plan` produces; judging a finished plan against reality is `review --scope plan` —
assumptions extracted and rated, pre-mortem, dependency audit, ambiguity scan, returning
findings and a verdict rather than a plan. The distinction is load-bearing rather than
tidy: the judges inside the tournament score the drafts **against each other**, so a
winner has only beaten the other four. Whether it survives contact with reality is a
different question, asked by a different verb.

## Where the old names went

Until nord-core 1.47.0 these were four skills: `nord-plan`, `brainstorm`,
`brainstorm-adversarial` and `nord-requirements`. Their names described techniques — a
roundtable, a dialectic, a socratic interview — so choosing among them meant knowing how
each was built. The modes name the artifact instead, which is the thing you actually
want. Reasoning and the naming rules: vault
`decisions/skills-nach-fragen-statt-nach-mechanismen.md`.
