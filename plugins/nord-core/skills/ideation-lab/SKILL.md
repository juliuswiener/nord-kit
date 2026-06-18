---
name: ideation-lab
description: "Generative idea-exploration roundtable (discuss<->research rounds) growing a shared idea board, then a ralplan-ready brief. Use for 'explore/generate ideas for X'; generative not ranked/critique. Hand output to ralplan."
triggers:
  - ideate
  - generate ideas
  - explore ideas
  - brainstorm together
  - research and ideate
  - ideation lab
---

# Ideation Lab

## What it is

A **generative** ideation engine. A panel of diverse thinkers builds ideas *together* — yes-and, combine, push further — while **online research** is woven between discussion rounds so the next round is informed by real prior art, products, and patterns. The shared idea board **grows**; nothing is killed. Output is a map of a rich idea space plus a brief you can hand straight to `ralplan`.

```
FRAME (1 agent)
  └─ inviting brief, directions, seed questions — stay open, do not converge
LOOP (default 3 discuss rounds, research woven between):
  DISCUSS (N thinkers, parallel)   → each yes-ands the board + adds new ideas + asks research_requests
  WEAVE   (1 curator)              → merge into one board (fuse dupes, keep lineage, drop nothing), rank next questions
  RESEARCH (M agents, parallel)    → chase the top questions ONLINE (web search + fetch): prior art, examples, feasibility
  ...feeds the next DISCUSS round
SYNTHESIZE (1 agent)
  └─ themes, most-promising (with research backing), most-novel, tensions, decisions-needed, ralplan_brief
```

## When to use vs alternatives

| Need | Use |
|---|---|
| Explore + generate a research-informed idea space, together | **this skill** |
| Pressure-test / cull a set of candidate ideas (kill the weak) | `adversarial-brainstorm` |
| Turn a chosen direction into a consensus plan | `ralplan` / `planner` |
| Pin vague requirements into a spec via Q&A | `deep-interview` |
| Pure web research report on a known question | `deep-research` |

The natural chain: **ideation-lab → pick a direction → `ralplan`**. Adversarial-brainstorm is the opposite tool — reach for it only once you have candidates and want them attacked.

## Running it

Opt-in multi-agent orchestration. Invoke the bundled Workflow with an **absolute path** and **args as a JSON object**:

```
Workflow({
  scriptPath: '/home/julius/.claude/skills/ideation-lab/lab.workflow.js',
  args: { topic: 'How should an LLM-supported email client present decisions instead of an inbox?' }
})
```

A bare string also works as the topic.

### Args

| Arg | Default | Effect |
|---|---|---|
| `topic` (REQUIRED) | — | What to explore. Open phrasing is fine — the lab is meant for wide questions. |
| `rounds` | 3 | Discussion rounds. Research runs between them, so `rounds-1` research phases. 2–5. |
| `thinkers` | 5 | Panel size per discuss round. 2–7 (first-principles, cross-pollinator, user-empath, futurist, synthesist, pragmatist, provocateur). |
| `researchers` | 4 | Open questions chased online per research round. 1–8. |
| `context` | none | Background to seed the panel (codebase facts, prior decisions, constraints to honour). |
| `research` | true | Set `false` to run discussion-only (no online research between rounds). |

Cost scales with `rounds × thinkers` (discussion) + `(rounds-1) × researchers` (research). Defaults ≈ 3×5 thinker calls + 3 curator + 2×4 research + frame + synth.

### Online research

Research agents use the session's web tools (Exa `web_search_exa`/`web_fetch_exa`, or `WebSearch`/`WebFetch`), loaded on demand via tool search. In a headless/cron run where web tools are unavailable, set `research: false` or expect thin findings.

### Keeping yourself in the loop (the "discuss together" part)

The workflow runs the full discuss→research→discuss cadence autonomously — the *panel* discusses together. To inject **your own** steer between rounds, run it in shorter hops and feed your reactions back as `context` on the next invocation:

```
# hop 1: open exploration
Workflow({ scriptPath, args: { topic, rounds: 2 } })
# you read the board, react, then:
# hop 2: continue with your direction folded in
Workflow({ scriptPath, args: { topic, rounds: 2, context: { board_so_far: <paste>, my_steer: 'lean into the card-deck framing, drop the dashboard angle' } } })
```

Or just run the full thing, then react and hand the `ralplan_brief` onward.

## After the workflow returns

The script returns structured data — **you (the invoking agent) present it generatively**, not as a verdict:

1. Open with the **themes** (clusters + the insight each reveals) — this is the shape of the space.
2. Show **most_promising** (with `research_backing`) and **most_novel** — the latter is often the real payoff of woven research.
3. Surface **tensions** and **decisions_needed** — the forks the user now gets to choose between.
4. Offer the **`ralplan_brief`** as the handoff: "want me to pipe this into `ralplan`?"
5. The full **board** and **research** are available on request — don't dump them unless asked; lead with the map.

Do not rank-and-cull in the presentation — that is `adversarial-brainstorm`'s job, offered as an optional next step if the user wants the space narrowed before planning.

## Design rationale

- **Generative, not adversarial.** Thinkers are told yes-and is the spirit and criticism is a separate later job; the curator is told to drop nothing and preserve lineage. The board grows monotonically across rounds.
- **Research is woven, not bolted on.** Each discussion emits `research_requests`; the curator ranks them; research answers them; the next discussion is seeded with the findings. Ideas compound on evidence instead of vibes.
- **Curator per round** keeps the shared board coherent (fuses duplicates, folds builds into their parents) so each new round reasons over a clean state, not a pile.
- **Ends in a map + a handoff, not a winner.** The synthesis organizes and illuminates; choosing and planning is the user's next move via `ralplan`.

## Honest limitations

- **Not a feasibility or decision tool.** It widens, it does not narrow. If you need the space culled, follow with `adversarial-brainstorm`.
- **Research quality depends on web tools** being present in the session and on the questions the panel asks — a vague round yields vague research.
- **Monotonic board can bloat** on high `rounds`; the curator fuses but a 5-round run produces a large landscape. Synthesis clusters it, but expect breadth.
- **Autonomous panel ≠ you.** The agents discuss together; to truly co-ideate, use the short-hop pattern above and feed your reactions via `context`.

## Customizing lenses

`THINKERS` is a plain array at the top of `lab.workflow.js`. Edit briefs or add lenses, then re-invoke `Workflow({ scriptPath })`. Resume an interrupted run with `resumeFromRunId` — unchanged agents return from cache.
