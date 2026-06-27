---
name: author-skills
description: "Patterns for authoring/revising skills beyond basics: structure (XML vs markdown), tool-preference phrasing, composition, compliance monitoring, choosing skill vs hook vs CLAUDE.md vs command/subagent. Use when writing or revising a skill."

---

# Advanced Skill Authoring

Self-contained — nord's single home for skill authoring (foundation + advanced patterns).

## 0. Foundation (adopted from writing-skills)
The basics this skill builds on (grafted so it stands alone):
- **A skill = a focused capability**: `SKILL.md` with YAML frontmatter (`name`, `description`, optional
  `triggers`) + concise body. Name = gerund-first (`writing-plans`). Description = when it fires (symptoms),
  NOT a workflow summary (else the body is skipped).
- **Concise output (CSO).** Body is reference the model reads under load — terse, scannable, no filler.
  Tables/lists over prose. Every line earns its tokens.
- **TDD for skills (the Iron Law).** Before trusting a skill, pressure-test it: write 3+ representative
  prompts, run in a fresh session, confirm the right behavior fires; adversarially test that adjacent
  prompts don't mis-trigger it. A skill with no eval evidence is a hypothesis, not a validated tool.
- **Plugin distribution**: a plugin's skills live in `<plugin>/skills/<name>/SKILL.md`, auto-discovered
  (no ZIP/packaging — scan for SKILL.md); add an optional `version:` frontmatter field for plugin skills;
  test locally via `cc --plugin-dir /path/to/plugin`.

The five sections below fill gaps beyond the basics. These patterns are **not** adversarially eval-tested —
treat as starting hypotheses; run baselines for anything you depend on.

---

## 1. XML Tags vs Markdown Structure

**Decision rule:** Markdown for the document outline. XML tags for content Claude must distinguish from instructions.

Claude is trained on XML-tagged inputs. Tags create harder boundaries than `##` headers and resist instruction-bleed. Markdown remains better for navigable structure — Claude Code's own system prompt is markdown-heavy.

| Content | Use | Why |
|---|---|---|
| Section outline | Markdown headers | Greppable, cheap |
| Embedded examples | `<example>` | Anthropic's canonical wrapper; Claude won't read the example as an instruction |
| Contrastive pairs | Markdown Bad/Good (house style) OR `<example type="bad">` | Either works |
| Reasoning scaffold | `<thinking>` / `<answer>` | Trained tags |
| Embedded user data, transcripts | `<document>`, `<input>` | Blocks instruction injection from data |
| Procedures | Numbered lists | Tags add no value |
| Lookup tables | Markdown tables | Scannable, token-cheap |

Anthropic's docs assert tags improve parsing but cite no public benchmark; third-party "20-40% improvement" claims are not from Anthropic and shouldn't be quoted as official. Benefit grows with prompt complexity (multiple data types in one prompt) and shrinks for single-purpose instructional docs. **Don't tag-spam — reserve tags for content that needs a hard boundary.**

---

## 2. Tool-Preference Phrasing: the IRAE Pattern

**Decision rule:** Imperative + Rationale + Alternative tool name + Exception clause. Vague preferences ("consider using X") are reliably ignored under load.

```
<Imperative> <object>, <rationale>. <Alternative>. <Exception>.
```

**Bad (ignored):** "Prefer the Read tool when possible."
**Bad (Pink Elephant — primes the wrong tool):** "Don't use cat or head or tail."
**Good (from Claude Code's own Bash prompt):** "Avoid using this tool to run `cat`, `head`, `tail`, `sed`, `awk`, or `echo`, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool ... Read files: Use Read (NOT cat/head/tail)."

Packs five things in one rule: prohibition + specific banned commands + explicit exception + named replacement + parenthetical reinforcement.

| Situation | Framing | Example |
|---|---|---|
| Default tool choice | Positive imperative | "Use Read for files." |
| Hard prohibition | Negative + named replacement on same line | "NEVER bash `sed` for edits; use Edit." |
| Soft preference with exceptions | Hybrid | "Use Edit. Fall back to Write only for new files or full rewrites." |

Anthropic officially endorses positive framing because negation forces the model to process the forbidden concept first. But Claude Code's production prompt uses both — negative when the wrong tool is the model's likely first instinct (bash for file ops), so the prohibition acts as a stop sign before the positive replacement.

**Specificity:**
- **Deny-list** when the bad path is small and enumerable. "Don't use bash" is too broad; enumerate (`cat`, `head`, `tail`).
- **Allow-list** when the good path is small. "For file edits: Edit, Write, NotebookEdit. Nothing else."
- **Name exact tools, not categories.** "Use file tools" gets ignored — agent has no concrete substitution.

**Rationale matters under pressure.** A one-line *why* converts an arbitrary rule into a self-evidently-correct one. "Use Read instead of `cat` — provides better UX and the harness tracks file state for Edit." Without the rationale, agents under load (long context, retry loops, conflicting hints) treat the rule as ceremony. Matters more for Sonnet/Haiku than Opus.

Reserve maximum-strength "no exceptions" framing for catastrophic-violation rules (data loss, security). Over-applying it dilutes signal across all rules in the skill.

---

## 3. Skill Composition

**The load model (Claude Code):** every installed skill's `name + description` (combined, ~1,536-char budget) is preloaded into the system prompt at session start. The body loads only when the model invokes the skill via the `Skill` tool, and then **stays in context for the rest of the session**. After auto-compaction, the most recent invocation of each skill is re-attached — up to ~5,000 tokens each within a ~25,000-token combined budget. Plugin skills are namespaced (`plugin:skill`) and can't collide across plugins. Same-name conflicts at personal/project/enterprise levels resolve **enterprise > personal > project**.

**There is no documented precedence between two differently-named skills with overlapping triggers** — the model arbitrates. Authors must engineer non-overlap.

**Patterns:**
1. **Narrow the trigger surface.** "Use when reviewing code" collides with every code-review skill. Use specific symptoms.
2. **Gerund-first names.** `writing-skills`, not `skill-writing-helper`.
3. **Never summarize workflow in description** (parent skill documents this trap — Claude follows the description and skips the body).
4. **Defer explicitly to sibling skills by name:** "This skill does NOT cover X — use `plugin:other-skill` for that."
5. **Add a "When NOT to use" section.** Closes loopholes where a broadly-phrased description over-fires.
6. **Use `paths:` glob scoping** for file-type-specific skills — only loads when files match.
7. **Use `disable-model-invocation: true`** for side-effectful skills, so the model can't auto-trigger when an adjacent skill's domain partially overlaps.

**Failure modes:**
- Description keyword spam → matches too eagerly; adjacent skills lose
- Workflow-summary description → body silently skipped
- Silent contradictions with CLAUDE.md → inconsistent behavior, not clean override (CLAUDE.md "wins" but model may half-follow either)
- Post-compaction drop → standing rules belong in CLAUDE.md, not skills
- Redundant skills → waste description budget; model oscillates or merges incorrectly

**Testing composition:** write 5–10 representative prompts; in a fresh session with the full skill set loaded, confirm the right skill fires for each. Adversarially test that prompts intended for adjacent skills don't pull yours. **There is no platform mechanism to detect "skill A suppresses skill B."**

---

## 4. Post-Deployment Compliance

Pre-deployment TDD proves a skill survives 3+ pressure scenarios. Production proves whether it survives the long tail. Two cheap feedback loops close the gap.

**Weekly grep (≈15 min):**
```bash
# 1. Invocation rate — is the skill credited at all?
find ~/.claude/projects -name "*.jsonl" -mtime -7 | xargs \
  jq -r 'select(.attributionSkill) | .attributionSkill' 2>/dev/null \
  | sort | uniq -c | sort -rn

# 2. Body-following — skill cited but rationalizations appearing nearby?
grep -rh -E "just this once|already (manually )?tested|spirit not letter|being pragmatic|keep as reference|I'll add tests after" \
  ~/.claude/projects --include="*.jsonl" -l | head
```

**Two failure modes, two detectors:**

| Failure | Signal | Detector |
|---|---|---|
| Skill never loads | `attributionSkill` count near zero | jq counter; cross-reference with sessions that *should* have triggered (grep symptom keywords from description) |
| Loaded but body bypassed | Skill cited but rationalizations within ~50 lines | Grep rationalization phrases; manually read surrounding context |

Self-reporting ("Announce: using skill X") gives a lower bound on **invocation**, never proof of **compliance** — agents announce and then violate.

**Drift patterns to watch for:**
1. **Paraphrase miss** — fires on exact tested scenarios, misses synonyms. Fix: widen description with synonyms harvested from real prompts.
2. **Compaction amnesia** — skill loaded turn 5, ignored by turn 80 after auto-compaction. Fix: move iron-law rules to a hook reminder, not just SKILL.md.
3. **Subagent bypass** — main agent loads skill, dispatches a subagent that never sees it. Violations cluster in `agent-*.jsonl` sidechain files. Fix: have the parent skill explicitly require subagents to load it.

Skip enterprise eval platforms (Langfuse, Braintrust, LangSmith) for solo authors — local jsonl + jq + grep runs in under a minute and is sufficient.

---

## 5. Choosing the Right Mechanism

Before writing a skill, verify a skill is the right primitive.

| Goal | Mechanism | Why |
|---|---|---|
| Enforce a rule **every turn** regardless of context | `CLAUDE.md` / `AGENTS.md` | Always loaded; per-turn token cost |
| Activate **only when a situation arises** | Skill | Description-matched, loads on demand |
| Run **deterministically on a tool event** (PreToolUse, PostToolUse, SessionStart, Stop) | Hook in `settings.json` | Harness-enforced, not model judgment |
| **Explicit named entry point** | Slash command | User-typed, no auto-trigger |
| **Fresh-context specialist** | Subagent | Isolated context window |
| Pre-approve/deny tool calls without prompting | `permissions` block | Harness-level allow/deny |
| External capability | MCP server | Out-of-process |

**Real "chose wrong" cases:**

1. **Skill saying "always run tests after edits."** Model judgment is unreliable under pressure. This is a `PostToolUse` hook matched on `Edit|Write`. The superpowers plugin uses a `SessionStart` hook to bootstrap `using-superpowers` rather than trusting the model.
2. **TDD doctrine in CLAUDE.md.** Bloats every conversation about unrelated topics. Belongs in a skill keyed on "implementing any feature or bugfix."
3. **Slash command for something that should auto-trigger.** Users forget to type it. Superpowers deprecated `/brainstorm`, `/write-plan`, `/execute-plan` in favor of skills for exactly this reason.
4. **CLAUDE.md as a reviewer prompt.** Reviewers need independent context. Use a subagent.

**Hybrid patterns:**
- **Hook → skill pointer.** A hook injects `<system-reminder>` naming the relevant skill, letting the model load it without bloating CLAUDE.md.
- **Slash command → skill → subagent.** User types `/review`; the command body invokes the reviewer skill; the skill dispatches the reviewer subagent for a fresh-context pass.
- **Skill → MCP.** Skill describes *when* to call an MCP tool; MCP server provides the *capability*.

**Cost trade-offs:**

| Mechanism | Cost paid | When |
|---|---|---|
| CLAUDE.md / AGENTS.md | Tokens | Every turn |
| Skill | Tokens | Only when description matches and skill is invoked |
| Hook | Shell latency + injected tokens | On matched event |
| Subagent | Fresh ~200k context window | On Task dispatch |
| Slash command body | Tokens | When user invokes |
| MCP tool listing | Tokens | Every turn (tool schemas) |

**Rule of thumb:** push always-on rules into hooks (deterministic, cheap per-call); conditional knowledge into skills (token-free until needed); short project-wide invariants into CLAUDE.md; isolation work into subagents. **If a rule is enforceable by regex / lint / validation, automate it via hook — save skill prose for judgment calls.** This extends the parent skill's "Mechanical constraints… automate it" guidance across all five mechanisms.

---

## 6. Extracting Skills from Sessions

Use this when a session produced a repeatable, hard-won workflow worth capturing. The canonical implementation is `nord-core:author-skills` (deprecated alias: `learner`). The patterns below apply whenever you draft a skill file directly.

### Quality Gate — ALL three MUST be true

| Clause | Question | Required answer |
|---|---|---|
| Not-googleable | Could someone find this in 5 min with a search engine? | **No** |
| Codebase-specific | Does this reference actual files, errors, or patterns from this project? | **Yes** |
| Hard-won effort | Did this take real debugging, design, or operational effort to discover? | **Yes** |

If any clause fails, document in normal prose (comments, README, ADR) — not a skill.

### Anti-Patterns — do NOT extract

- Generic programming patterns (belong in docs)
- Refactoring techniques (universal; not codebase-specific)
- Library usage examples (belong in library docs)
- Type definitions or boilerplate
- Anything a junior dev could Google in 5 minutes

### Session Analysis Checklist

Before drafting, extract:
1. **Repeatable task** — what specific task did the session accomplish?
2. **Inputs** — what does the skill consumer need to supply?
3. **Ordered steps** — what did you actually do, in sequence?
4. **Success criteria** — how do you know it worked?
5. **Constraints / pitfalls** — what breaks if you deviate?
6. **Verification evidence** — what output confirmed success?
7. **Best save location** — user-level or project-level (see Save-Path below)?

### Expertise vs. Workflow Classification

Before writing the body, classify the learning:

| Type | Definition | File suffix convention |
|---|---|---|
| **Expertise** | Domain knowledge, gotcha, pattern, heuristic — can be updated as understanding deepens | `{topic}-expertise.md` |
| **Workflow** | Operational procedure, fixed step sequence — stability is a feature | `{topic}-workflow.md` |

This separation lets expertise evolve independently without destabilising frozen procedures.

### Open-Questions Flag

If the workflow still has unresolved branching decisions, name them explicitly **before** drafting the skill body. Fuzzy extractions produce unreliable skills. Surface ambiguity as open questions; resolve them (or scope the skill narrowly) before writing.

### Skill Body Template

```markdown
---
name: <skill-name>
description: <one-line description>
triggers:
  - <trigger-1>
  - <trigger-2>
---

# [Skill Name]

## The Insight
What is the underlying PRINCIPLE you discovered? Not the code — the mental model.

## Why This Matters
What goes wrong if you don't know this? What symptom brought you here?

## Recognition Pattern
How do you know when this skill applies? What are the signs?

## The Approach
The decision-making heuristic, not just code. How should Claude THINK about this problem class?
```

**Key:** A skill is reusable if Claude can apply it to NEW situations, not just identical ones. Prefer mental-model framing over copy-paste code blocks.

### Save-Path Decision Rule

| Scope | Path | When |
|---|---|---|
| **User-level** | `${CLAUDE_CONFIG_DIR:-~/.claude}/skills/<slug>/SKILL.md` | Truly portable insight — applies across projects |
| **Project-level** | `.claude/skills/<slug>/SKILL.md` | Codebase-local gotcha; commit with the repo so the team keeps it |

**Worktree caveat:** uncommitted project-level skills are worktree-local. If the worktree is deleted before the skill is committed or copied to a user-level directory, the skill is lost.

### YAML Frontmatter — Required

Every learned skill file **must** start with YAML frontmatter so directory-based discovery can load it. Never emit plain markdown without frontmatter.

Minimum required:

```yaml
---
name: <skill-name>
description: <one-line description>
triggers:
  - <trigger-1>
  - <trigger-2>
---
```

### Self-Improving Skill Architecture (Learner Pattern)

For skills that encode accumulating domain knowledge, split the body into two sections with explicit stability contracts:

```markdown
## Expertise
> This section contains domain knowledge that improves over time.
> It CAN be updated when new patterns are discovered.

[Heuristics, gotchas, decision guides]

---

## Workflow
> This section contains the stable extraction procedure.
> It should NOT be updated during improvement cycles.

[Fixed ordered steps]
```

**Why this works:** Expertise evolves (new patterns surface); Workflow must stay stable (self-modification of procedures introduces drift). The Expertise/Workflow split lets a skill update itself safely — only the knowledge half changes, the procedure half is frozen. This is a general skill-architecture pattern for any self-improving skill, not just learner.

---

## When NOT to Use This Skill

- You just need to drop a quick note — document in prose (comments/README/ADR), not a skill (see §6 quality gate).
- You want to extract a skill from a session automatically — use `nord-core:author-skills`.
- You want to find/install an existing skill instead of authoring — use `search-skills` / `install-skill`.
