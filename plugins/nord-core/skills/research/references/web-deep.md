> **GEPARKT — nicht aufrufbar.** Diese Pipeline verteilt an `nord-core:research-worker`
> und `nord-core:scrape-worker`. Am 2026-09-05 nachgemessen: **beide Agenten existieren
> nicht.** nord-core definiert `debugger`, `expert`, `implementer`, `researcher`,
> `reviewer` — sonst nichts. Der Command `/deep-research` war damit von Anfang an nicht
> lauffähig; er scheiterte erst beim Dispatch, weshalb es niemandem auffiel.
>
> Der Inhalt liegt hier, weil die Pipeline-Logik (gpt-researcher: planen, delegieren,
> Lücken schließen, deduplizieren, zitiert synthetisieren) gut ist und der einzige
> fehlende Teil zwei Agenten-Definitionen sind. `research --web --deep` wird bewusst
> NICHT im Router angeboten, solange das so ist — ein Modus, den man nicht ausführen
> kann, ist genau der Fehler, den dieser Umbau beseitigt.

---
description: Deep-research a topic via parallel research-worker subagents (Gemini grounded search), then synthesize one cited report (gpt-researcher logic, native Claude Code)
argument-hint: <topic or question>
---

You are the deep-research orchestrator. Replicate gpt-researcher's pipeline
natively. Division of labour is strict:

- YOU (Claude) do ONLY: planning, gap-analysis/refinement, dedup, and the final
  synthesis. You never do the bulk web research yourself.
- All high-volume searching/scraping is delegated to `nord-core:research-worker`
  subagents. They run on Gemini with built-in Google Search grounding
  (model `gemini-3.1-flash-lite`, cheap, parallel).

TOPIC: $ARGUMENTS

Run this pipeline now, end to end, in one go.

## 0. Cache setup

Pick a `<kebab-topic>` slug from the topic. Cache dir is
`.deep-research-cache/<kebab-topic>/`. Create it (`mkdir -p`). For every
subquery, derive a `<kebab-subquery>` slug. A cached worker result lives at
`.deep-research-cache/<kebab-topic>/<kebab-subquery>.md`.

Reuse rule: before spawning a worker for a subquery, check if its cache file
exists AND is newer than 7 days (`find <file> -mtime -7`). If so, read it and
skip the worker. After a worker returns a non-empty result, write it to its
cache file. This makes re-runs of the same topic cheap.

## 1. PLAN

Derive 4–6 specific, non-overlapping subqueries that together cover the topic
(definition, current state, key players, competing views, evidence/data, recent
developments, open problems). Keep it ≤6 — Gemini grounding has a per-minute
request burst limit; more parallel workers risk transient rate-limits. The
Antigravity quota is counted in REQUESTS, not tokens, so each subquery costs one
request regardless of size: prefer fewer, richer subqueries over many thin ones
(a worker can cover several facets of one aspect in a single grounded request).
One optional scoping `WebSearch` is allowed before planning, but do NOT do the
bulk research yourself.

## 1.5 PREFLIGHT (quota gate)

Before fanning out, run `llm-usage --json` (Bash) once and read the Antigravity
window for the worker model (`gemini-3.1-flash-lite (REQUESTS)` — `used_pct`).

- `used_pct` ≥ 90 → the daily request quota is nearly spent. Cut to the 2–3
  highest-value subqueries this run (or tell the user to retry after the window
  `resets_at`), and SKIP the refine round.
- `used_pct` ≥ 70 → trim to ≤4 subqueries.
- otherwise proceed with the full plan.

This is the daily/window quota gate. The separate per-minute burst limit is
handled by waving the fan-out below.

## 2. DELEGATE (parallel, in waves)

Spawn ONE `nord-core:research-worker` subagent per non-cached subquery via the Task tool.
Pass each worker exactly one subquery — never the whole topic. To avoid the
Gemini per-minute burst limit, fan out in WAVES of at most **3 concurrent
workers**: put ≤3 Task calls in a single message (they run concurrently), wait
for that wave to return, and if more subqueries remain start the next wave. With
≤6 subqueries that is 1–2 waves. Write each fresh result to its cache file
(step 0).

If a worker still comes back with a rate-limit / "exhausted capacity" message,
that is the per-minute burst — wait for its `reset after Ns` and retry that ONE
worker once.

## 3. REFINE (recursion, one round)

Read all collected summaries together and judge coverage against the topic.
Identify concrete GAPS: a sub-aspect no subquery hit, a contradiction between
two workers that needs a tie-breaker, or a subquery that came back thin/empty.
If gaps exist, formulate 1–4 targeted follow-up subqueries and spawn a second
parallel `nord-core:research-worker` round for them (cache them too). At most ONE refine
round — do not loop further.

## 3.5 DEEP READ (optional, depth pass)

If the grounded summaries are thin on specifics for a high-value aspect — you
need numbers/quotes/method detail a snippet only gestured at — spawn
`nord-core:scrape-worker` subagents on the 1–3 most authoritative cited URLs for that
aspect. Pass each worker ONE focus + its URL. These run on opencode-zen (not the
Gemini request quota), so they do not eat the burst limit; still cap at ≤3
concurrent. Skip this step entirely if the grounded coverage is already
specific, and skip it when PREFLIGHT told you to (quota ≥90%). Fold the
extractions into the same source pool for synthesis.

## 4. SYNTHESIZE

Write ONE cohesive report in your own words from all collected findings — do not
concatenate worker outputs. Resolve overlaps, surface agreements and
contradictions, lead with what matters.

Sources, structured: collect every `[n] <Title> — <URL>` line from all workers
into one list. Dedupe by URL (identical URLs collapse to one entry; treat the
Gemini `vertexaisearch.cloud.google.com/grounding-api-redirect/...` redirect
URLs as-is — same redirect string = same source). Renumber globally [1..N] and
rewrite every inline citation in the report body to the new global numbers.

Output the report in this format, AND write it to
`<kebab-topic>-report.md` in the current directory:

```
# <Topic>

## Summary
<3–6 sentence executive answer to the topic.>

## Findings
<Sectioned synthesis. Inline [1],[2]… mapped to References. Concrete: numbers,
dates, names. Note disagreements.>

## Open questions / gaps
<What the research could not settle, or what merits a deeper pass.>

## References
[1] <Title> — <URL>
...
```

Rule: every factual claim must trace to a worker-supplied source. Never invent
sources. Keep workers cheap and parallel — that is the whole point.
