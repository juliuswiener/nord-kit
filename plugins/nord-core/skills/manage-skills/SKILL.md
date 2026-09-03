---
name: manage-skills
description: "Manage local skills — list, add, remove, edit, search, sync, and set up skill directories. Use when user says 'manage skills', 'local skills', 'add skill', 'remove skill', 'edit skill', 'skill wizard', or wants to create/inspect/copy skills across user and project scopes."
argument-hint: "<subcommand> [args]"
disable-model-invocation: true
---

# Local Skill Manager

CRUD and discovery CLI for local Claude Code skills across user and project scopes. Distinct from external skill discovery (which searches marketplaces) — this manages skills you already have or are creating on this machine.

## Canonical Paths

| Scope   | Path                              |
|---------|-----------------------------------|
| User    | `~/.claude/skills/<slug>/SKILL.md` |
| Project | `.claude/skills/<slug>/SKILL.md`   |

Skills are plain directories containing a `SKILL.md` file with YAML frontmatter.

---

## Subcommands

### list

Show all skills organized by scope.

**Steps:**
1. Scan user skills at `~/.claude/skills/`
2. Scan project skills at `.claude/skills/`
3. Parse YAML frontmatter (`name`, `description`, `triggers`) from each `SKILL.md`
4. Display three-section table: built-in (read from harness plugin dirs if detectable), user, project

**Output format:**
```
USER SKILLS (~/.claude/skills/):
| Name              | Description                        | Quality | Usage | Scope |
|-------------------|------------------------------------|---------|-------|-------|
| error-handler     | Fix aiohttp proxy crash on ...     | N/A     | N/A   | user  |

PROJECT SKILLS (.claude/skills/):
| Name              | Description                        | Quality | Usage | Scope   |
|-------------------|------------------------------------|---------|-------|---------|
| test-runner       | Run integration suite with ...     | N/A     | N/A   | project |

SUMMARY: 3 user | 2 project | 5 total
```

Fallback: show "N/A" when frontmatter field (including Quality/Usage stats) is missing.

---

### add [name]

Interactive wizard for creating a new skill.

**Steps:**
1. Ask for slug if not provided — validate: lowercase, hyphens only, no spaces
2. Ask for one-line description
3. Ask for trigger keywords (comma-separated)
4. Ask for argument hint (optional, e.g. `<file> [options]`)
5. Ask for scope: `user` → `~/.claude/skills/<slug>/` | `project` → `.claude/skills/<slug>/`
6. Offer quick-start template (see [Skill Templates](#skill-templates))
7. Write `SKILL.md` with scaffolded frontmatter and body
8. Report path, suggest editing content

**Scaffold written:**
```yaml
---
name: <slug>
description: "<description>"
triggers:
  - <trigger1>
  - <trigger2>
argument-hint: "<args>"
---

# <Name>

## Purpose
[What this skill does]

## When to Activate
[Triggers and conditions]

## Workflow
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Examples
[Concrete usage examples]

## Notes

Background notes: scopes, precedence, plugin layout and the edge cases behind the
subcommands above. Read when a subcommand behaves unexpectedly.

See `references/notes.md`.

## Skill Templates

Offer these when running `add` or `setup → import`.

### Error Solution

```markdown
---
name: <slug>
description: "Solution for <specific error> in <specific context>"
triggers:
  - "<exact error fragment>"
  - "<file or symptom>"
---

# <Error Name>

## The Insight
Underlying cause and principle discovered.

## Why This Matters
What breaks if you don't know this.

## Recognition Pattern
- Error message: `<exact error>`
- File: `<specific path>`
- Context: <when this occurs>

## The Approach
1. <Specific action with file/line ref>
2. <Specific action with file/line ref>
3. <Verification step>

## Example
```diff
- // Before (broken)
+ // After (fixed)
```
```

### Workflow

```markdown
---
name: <slug>
description: "Process for <specific task> in this codebase"
triggers:
  - "<task description>"
  - "<goal keyword>"
---

# <Workflow Name>

## The Insight
What makes this different from the obvious approach.

## Why This Matters
What fails without this process.

## Recognition Pattern
- Task type: <specific task>
- Files: <specific patterns>

## The Approach
1. <Step with specific commands/files>
2. <Step with specific commands/files>
3. <Verification>

## Gotchas
- <Common mistake and how to avoid>
```

### Code Pattern

```markdown
---
name: <slug>
description: "Pattern for <specific use case> in this codebase"
triggers:
  - "<code pattern>"
  - "<problem domain>"
---

# <Pattern Name>

## The Insight
Key principle behind this pattern.

## Recognition Pattern
- File types: <specific files>
- Problem: <specific problem>

## The Approach
1. <Principle-based step>
2. <Principle-based step>

## Example
```typescript
// Correct application
```

## Anti-Pattern
```typescript
// Common mistake — and why it breaks
```
```

### Integration

```markdown
---
name: <slug>
description: "How <system A> integrates with <system B> in this codebase"
triggers:
  - "<system name>"
  - "<integration point>"
---

# <Integration Name>

## The Insight
What's non-obvious about how these systems connect.

## Why This Matters
What breaks without understanding this.

## Recognition Pattern
- Files: <integration-specific paths>
- Config: <config locations>
- Symptoms: <integration failure indicators>

## The Approach
1. <Configuration step with paths>
2. <Setup step>
3. <Verification>

## Gotchas
- <Integration-specific pitfall>
```

---

## Skill Quality Guidelines

Good skills are:

1. **Non-Googleable** — can't find via search
   - Bad: "How to read files in TypeScript"
   - Good: "This repo uses custom `fileURLToPath` path resolution in `src/utils/paths.ts`"

2. **Context-Specific** — references actual files/errors from this codebase
   - Bad: "Use try/catch for error handling"
   - Good: "The aiohttp proxy in `server.py:42` crashes on `ClientDisconnectedError` — catch and return 502"

3. **Actionable with Precision** — tells exactly what and where
   - Bad: "Handle edge cases"
   - Good: "When seeing 'Cannot find module' in `dist/`, check `tsconfig.json moduleResolution`"

4. **Hard-Won** — required significant investigation effort
   - Bad: Generic programming patterns
   - Good: "Race condition in `worker.ts` — `Promise.all` at line 89 needs explicit `await`"

---

## Error Handling

All subcommands handle:
- Directory or file not found
- Permission errors
- Invalid or missing YAML frontmatter
- Duplicate skill slugs (warn, ask to overwrite or rename)
- Invalid slug format (spaces, special chars)

Error format:
```
Error: <clear message>
Suggestion: <helpful next step>
```

---

## Benefits of Local Skills

**Automatic Application:** Claude detects trigger keywords and applies skills without prompting.

**Version Control:** Project-level skills (`.claude/skills/`) can be committed so the whole team benefits.

**Reduced Re-solving:** Known patterns apply immediately — no re-investigation.

**Codebase Memory:** Preserves hard-won institutional knowledge beyond conversation history.

---

## Usage Reference

```
list                    — table of all skills by scope
add [slug]              — interactive creation wizard
remove <slug>           — confirm-gated deletion
edit <slug>             — field-level interactive edit
search <query>          — ranked full-text search
info <slug>             — full detail view
sync                    — cross-scope copy with diff
setup                   — guided first-time wizard
scan                    — quick inventory, no wizard
```
