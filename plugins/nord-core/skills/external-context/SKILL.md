---
name: external-context
description: Invoke parallel document-specialist agents for external web searches and documentation lookup
argument-hint: <search query or topic>
level: 4
---

# External Context Skill

Fetch external documentation, references, and context for a query. Decomposes into 2-5 facets and spawns parallel document-specialist Claude agents.

## Usage

```
/nord-core:external-context <topic or question>
```

### Examples

```
/nord-core:external-context What are the best practices for JWT token rotation in Node.js?
/nord-core:external-context Compare Prisma vs Drizzle ORM for PostgreSQL
/nord-core:external-context Latest React Server Components patterns and conventions
```

## Protocol

The loop is: **SCALE → FIND→FETCH fan-out → SELF-REFLECT gap-check → CITATION gate → SYNTHESIZE.** Breadth-first web research only — if the task is sequential or needs shared context, do not fan out.

### Step 0: Scale to query complexity (gate first)

Match agent count to the question — fixed fan-out wastes tokens on simple queries and starves hard ones. Multi-agent burns ~15× the tokens of a single chat (Anthropic, [explicit]), so only fan out when breadth justifies it.

| Query shape | Agents | Search calls/agent |
|---|---|---|
| Single fact / one source | 1 (inline, no fan-out) | 2-3 |
| Comparison / 2-3 angles | 2-4 | 3-5 |
| Broad / survey / "everything about X" | 5 (max) | 5+ |

### Step 1: Facet Decomposition

Given a query, decompose into 2-5 independent search facets:

```markdown
## Search Decomposition

**Query:** <original query>

### Facet 1: <facet-name>
- **Search focus:** What to search for
- **Sources:** Official docs, GitHub, blogs, etc.

### Facet 2: <facet-name>
...
```

### Step 2: Parallel fan-out — FIND then FETCH (force real reads)

Each facet agent runs a two-stage protocol. The split is load-bearing: a specialist told only "research X" answers from memory (0 fetches, fabricated URLs/numbers). Separating FIND from FETCH and demanding a verbatim quote per source forces real reads — empirically the difference between 0 and dozens of real fetches.

Fire independent facets in parallel via Task:

```
Task(subagent_type="nord-core:document-specialist", model="sonnet", prompt="FACET: <facet description>.
STAGE 1 FIND: run 2-4 real WebSearch / web_search_exa queries; collect >=5 candidate URLs (prefer official docs, primary sources, arXiv, 2024-2026).
STAGE 2 FETCH: WebFetch the 3-5 highest-value URLs. For EVERY source you cite you MUST include a verbatimQuote — one sentence copied EXACTLY from the fetched page (proof the fetch happened). If a URL fails, mark it and pick another. Answering from memory without fetched quotes = FAILURE.
Return: findings + sources[{url, verbatimQuote, supports}]. Tag each numeric/claim explicit|derived per BEHAVIOUR.md.")
```

- Maximum 5 parallel document-specialist agents.
- Source-breadth target: ~10-30 fetched sources across all facets (GPT-Researcher default). Thin coverage → widen in the gap-check, don't ship it.

### Step 2.4: Self-reflect gap-check (one pass, before citation gate)

Before synthesizing, spawn ONE gap-check pass: *"Given the original query and the findings so far, what is still unanswered, contradicted, or thin?"* If it names concrete gaps, fire ONE more targeted facet round to fill them — **max 1 extra round, do not loop**. This is the single highest-leverage addition over plain fan-out (Together AI / GPT-Researcher both converge on an explicit gap-check before synthesis).

### Step 2.5: Citation gate (deterministic — run before synthesis)

LLM synthesis hallucinates URLs and misattributes quotes. Gate every citation with an objective check,
not a judgement:

1. **URL resolves** — each cited URL must return a non-error status. Verify by actually fetching it
   (WebFetch / `curl -sI -o /dev/null -w '%{http_code}' <url>`); a URL that 404s/times out is dropped.
2. **Quote is real** — any quoted/paraphrased claim attributed to a source must appear in that source's
   fetched text (substring / near-substring match of the key phrase). If the phrase isn't in the page,
   the citation is hallucinated → drop the claim or re-fetch.
3. Tag each finding with its provenance grade (A — canonical vocab, see BEHAVIOUR.md): quote
   substring-matches the fetched page → `explicit`; synthesized across sources, in no single one →
   `derived`; sources disagree → `conflicts`; URL 404/timeout or quote not found → `source_unavailable`.
4. C rule — keep "checked & wrong" distinct from "couldn't check": a quote that loaded but did NOT match
   the page is `conflicts` (refuted); a URL that never loaded is `source_unavailable`. Do NOT lump both
   into one `⚠ unverifiable` tag — flag each with its grade; never silently keep a `conflicts` claim.

The gate is the fetch result + substring match, not "does this look plausible". Run the checks in
parallel over the cited URLs (don't loop).

### Step 3: Synthesis Output Format

Present synthesized results in this format:

```markdown
## External Context: <query>

### Key Findings
1. **<finding>** (explicit) - Source: [title](url)
2. **<finding>** (derived) - Source: [title](url)
<!-- tag each: (explicit|derived|conflicts|source_unavailable). conflicts/source_unavailable findings listed separately as flagged, not asserted. -->

### Detailed Results

#### Facet 1: <name>
<aggregated findings with citations>

#### Facet 2: <name>
<aggregated findings with citations>

### Sources
- [Source 1](url)
- [Source 2](url)
```

## Configuration

- Maximum 5 parallel document-specialist agents
- No magic keyword trigger - explicit invocation only
