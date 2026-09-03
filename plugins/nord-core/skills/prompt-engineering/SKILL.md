---
name: prompt-engineering
description: Writes and repairs prompts for language models — the section order a prompt needs, which technique fits which signal, per-model formatting, and how to diagnose one that gives inconsistent results. Use when writing a prompt for a model, optimizing or rewriting one, designing an agent or skill instruction, or when a prompt produces varying output and the cause is unclear. For a Claude Code skill, subagent or CLAUDE.md, the artifact rules differ — see the artifact section below.
---

# Prompt engineering

Produces the prompt text, not a description of it.

**Always show the complete prompt in a marked block.** A summary of a prompt cannot be
copied, cannot be diffed, and hides exactly the wording that decides the output.

## When invoked

1. **Pin the target**: which model, what input shape, what output shape, and what counts
   as a good answer. If the request does not say, state your assumption in one line and
   continue.
2. **Get a failing example** when improving an existing prompt. One bad output localises
   the problem faster than any amount of reading.
3. **Pick techniques from the signal table**, not by habit. Every technique added costs
   tokens on every call.
4. **Write the sections in order** (below), omitting the ones that do not apply.
5. **Check against the list** at the end of this file.
6. **Propose two or three test inputs**, including one that should NOT produce the
   behaviour — that is what catches an over-broad prompt.

## Section order

Include only what applies; keep the order.

```
Role            only when a stance changes the answer — "expert X", not "helpful assistant"
Context         background the model cannot infer
Task            one specific, actionable command. Strong verb first.
Input format    what arrives, and how it is delimited
Instructions    the steps, numbered when order matters
Examples        omit for zero-shot
Output format   exact schema or template, with one filled example
Constraints     short and specific; long lists dilute
```

Reasoning instructions go **before** the output instruction. A model told to answer first
and reason after will answer first.

## Which technique for which signal

| Signal | Technique |
|---|---|
| multi-step reasoning | chain-of-thought before the answer |
| typed or structured output | explicit schema plus one filled example |
| ambiguous task, many edge cases | 2–5 few-shot examples, one of them an edge case |
| the model must hold a stance | a concrete role |
| the model calls tools | name the tools and the order |
| critical accuracy | self-consistency: several solutions, pick the consistent one |
| a task too big for one prompt | chain prompts, each with one output |
| output that can spiral | an explicit stop condition and attempt limit |
| behaviour that must be guaranteed | not a prompt — a hook or a deterministic check |

The last row is the one people skip. A prompt is advisory; if the behaviour must happen
every time, wording it more forcefully does not make it deterministic.

## Per model

| Target | What changes |
|---|---|
| Claude | XML tags for sections; reasoning before output; long context tolerates full examples |
| GPT | Markdown headers; JSON schema inline; system/user/assistant split |
| Open-weight (Llama, Mistral) | more explicit formatting, simpler language, stronger role framing |

## Claude Code artifacts are different

A skill, subagent or CLAUDE.md is Markdown with YAML frontmatter. **Do not wrap those
bodies in XML tags** — they are read as Markdown. And their description field, not their
body, decides whether they are ever selected: write it in third person, lead with the main
use case, and include the literal phrases a user would type.

For a delegation prompt to a subagent, pin all four fields — objective · output format ·
tools and budget · boundaries. A subagent sees only its own body, this message, CLAUDE.md
and the git status; it does not see the conversation.

## Diagnosing a prompt that misbehaves

| Symptom | Likely cause | Fix |
|---|---|---|
| inconsistent output shape | format described, not shown | add one filled example |
| ignores a rule | rule buried mid-paragraph | own line, or move it before the task |
| everything emphasised | many MUSTs and IMPORTANTs | keep one; the rest lose their force |
| right answer, wrong reasoning | output instruction precedes reasoning | reorder |
| refuses or hedges | role or constraints over-restrictive | narrow the constraint to the real risk |
| drifts on long input | task stated once, at the top | restate the task after the input |

## Before delivering

- [ ] The complete prompt is shown, not described
- [ ] One specific actionable instruction, strong verb first
- [ ] Output format defined exactly, with an example if the shape is non-obvious
- [ ] Reasoning instructions precede output instructions
- [ ] Every technique present earns its tokens
- [ ] A stop condition exists for anything that loops
- [ ] Test inputs proposed, including one that should not trigger the behaviour

## References

- `references/templates.md` — ready prompt shapes (analysis, extraction, classification,
  generation, review) and one worked example end to end. Read when the task matches a
  shape rather than starting from blank.
