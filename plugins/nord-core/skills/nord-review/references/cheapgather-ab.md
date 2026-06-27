# cheapGather A/B harness

`cheapGather` routes the GATHER lane (fact collection, file reading, finding-drafting — NOT the final
verdict) to a cheap `qwen3.6-plus` worker via the bridge. It ships **default-OFF** in `nord-review`,
`nord-codebase-research`, and `codebase-audit` because it was never measured against the frontier-only
baseline. Run this before flipping any default to ON.

## Procedure (deterministic, no LLM judge)
1. Pick ONE fixed input: a specific diff (`git show <sha>`) or a specific codebase subtree + ONE fixed
   review/research prompt. Keep both byte-identical across runs.
2. Run the skill twice on that input, capturing the findings JSON each time:
   - **A — baseline:** `cheapGather:false` (frontier does gather + verdict).
   - **B — cheap:** `cheapGather:true` (qwen gathers, frontier still does the verdict).
3. Compare:
   - **count** — total findings A vs B.
   - **recall** — of A's findings, how many B also surfaced (match by file:line + category).
   - **high-sev drop** — any `high`/`critical` finding A caught that B missed. This is the kill metric.
4. Repeat over **≥2–3 diverse inputs** (a bug-dense diff, a clean refactor, a security-relevant change).

## Decision rule
Flip a default to ON **only if** cheap drops **0 high-severity findings** across all sampled inputs and
recall stays ≥ ~90% on medium+. A single dropped high-sev finding = keep OFF for that skill.

## Revisit trigger
Re-run this harness before flipping any `cheapGather` default, OR when bridge/token cost becomes the
bottleneck on large reviews (then the cheap-gather token saving may justify a measured ON). Until then:
leave default OFF — the frontier-only path is the verified one.
