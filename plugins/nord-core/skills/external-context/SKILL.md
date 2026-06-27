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

### Step 2: Parallel Agent Invocation

Fire independent facets in parallel via Task tool:

```
Task(subagent_type="nord-core:document-specialist", model="sonnet", prompt="Search for: <facet 1 description>. Use WebSearch and WebFetch to find official documentation and examples. Cite all sources with URLs.")

Task(subagent_type="nord-core:document-specialist", model="sonnet", prompt="Search for: <facet 2 description>. Use WebSearch and WebFetch to find official documentation and examples. Cite all sources with URLs.")
```

Maximum 5 parallel document-specialist agents.

### Step 2.5: Citation gate (deterministic — run before synthesis)

LLM synthesis hallucinates URLs and misattributes quotes. Gate every citation with an objective check,
not a judgement:

1. **URL resolves** — each cited URL must return a non-error status. Verify by actually fetching it
   (WebFetch / `curl -sI -o /dev/null -w '%{http_code}' <url>`); a URL that 404s/times out is dropped.
2. **Quote is real** — any quoted/paraphrased claim attributed to a source must appear in that source's
   fetched text (substring / near-substring match of the key phrase). If the phrase isn't in the page,
   the citation is hallucinated → drop the claim or re-fetch.
3. A finding whose only support is an unverifiable citation does NOT enter synthesis. Mark dropped cites
   in output as `⚠ unverifiable (excluded)` so the gap is visible, never silently kept.

The gate is the fetch result + substring match, not "does this look plausible". Run the checks in
parallel over the cited URLs (don't loop).

### Step 3: Synthesis Output Format

Present synthesized results in this format:

```markdown
## External Context: <query>

### Key Findings
1. **<finding>** - Source: [title](url)
2. **<finding>** - Source: [title](url)

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
