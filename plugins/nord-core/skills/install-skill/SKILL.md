---
name: install-skill
description: "Find + install Agent Skills from the prompts.chat registry via MCP (search_skills/get_skill). Use to discover/install an existing skill before hand-rolling one. Requires the prompts.chat MCP connected."
license: MIT
---

# skill-lookup

Search the prompts.chat registry and install a skill instead of writing one from scratch.

**Prereq:** the prompts.chat MCP must be connected (provides `search_skills`, `get_skill`). If those
tools are absent, say so and stop — do not fabricate results.

## Flow
1. **Search** — `search_skills({ query, limit, category?, tag? })` with keywords from the request.
   `limit` default 10 (max 50); optional `category` slug ("coding", "automation"), `tag` slug.
2. **Present** — per hit: title, description, author, file list (SKILL.md + refs/scripts), category/tags.
   Zero hits → broaden the query once, then report "nothing found". Never invent skills.
3. **Retrieve** — on user pick: `get_skill({ id })` → metadata + all file contents.
4. **Install** — choose scope deliberately:
   - project → `.claude/skills/{slug}/` · global → `~/.claude/skills/{slug}/`
   - If `{slug}/` already exists, confirm overwrite — never clobber silently.
   - Write `SKILL.md` + every accompanying file to the chosen dir.
5. **Verify** — read back `SKILL.md`, confirm frontmatter intact, state what it does + when it triggers.
   Skills load at session start → tell the user to restart for it to activate.

## Example
```
search_skills({ "query": "code review", "limit": 5, "category": "coding" })
get_skill({ "id": "abc123" })
```

## Rules
- Search before suggesting the user author a new skill.
- Never overwrite an existing skill dir without confirmation.
- Don't claim install success until `SKILL.md` is read back from disk.
