---
name: local-skill-manager
description: "Manage local skills — list, add, remove, edit, search, sync, and set up skill directories. Use when user says 'manage skills', 'local skills', 'add skill', 'remove skill', 'edit skill', 'skill wizard', or wants to create/inspect/copy skills across user and project scopes."
argument-hint: "<subcommand> [args]"
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
[Edge cases, gotchas]
```

**Example:**
```
> /nord-core:local-skill-manager add custom-logger

Slug: custom-logger
Description: Structured JSON logging for this service
Triggers: log, logger, logging
Argument hint (optional): <level> [message]
Scope (user/project): user
Template (error-solution/workflow/code-pattern/integration/blank): blank

Created: ~/.claude/skills/custom-logger/SKILL.md
```

---

### remove <name>

Remove a skill with confirmation gate.

**Steps:**
1. Search both scopes for `<name>/SKILL.md`
2. If found: display name, description, scope, full path
3. Ask: `Delete '<name>' from <scope>? (yes/no)`
4. On confirmation: delete the entire skill directory
5. Report success or cancellation

**Safety:** Never delete without explicit `yes`. Built-in skills (harness-bundled) are blocked from removal.

**Example:**
```
Found 'old-logger' (user scope):
  Description: Legacy logging utility
  Path: ~/.claude/skills/old-logger/

Delete 'old-logger' from user scope? (yes/no): yes
Removed ~/.claude/skills/old-logger/
```

---

### edit <name>

Field-level interactive edit for an existing skill.

**Steps:**
1. Find skill by name (both scopes)
2. Read and display current frontmatter values
3. Ask what to change: `description | triggers | argument-hint | content | rename | cancel`
4. For the chosen field: show current value → ask for new value → write back
5. For `rename`: move directory, update `name` field in frontmatter
6. Report summary of changes

**Editable fields:** `description`, `triggers`, `argument-hint`, full markdown `content`, `rename` (directory + frontmatter).

**Example:**
```
Skill 'custom-logger' (user):
  description: Structured JSON logging for this service
  triggers: log, logger, logging
  argument-hint: <level> [message]

Edit field (description/triggers/argument-hint/content/rename/cancel): triggers

Current: log, logger, logging
New: log, logger, logging, trace

Updated triggers for 'custom-logger'.
```

---

### search <query>

Full-text ranked search across all local skills.

**Steps:**
1. Scan both scopes
2. Match query (case-insensitive) against: name, description, triggers, full body
3. Rank: name/trigger matches first, then description, then body
4. Display matches with matched field highlighted

**Output:**
```
Found 2 skills matching "typescript error":

1. ts-module-error (user)
   Description: Fix "Cannot find module" in dist/ after build
   Match: name, triggers

2. lint-fix (project)
   Description: Auto-fix ESLint errors
   Match: "TypeScript ESLint error resolution" (body)
```

---

### info <name>

Detailed view of a single skill.

**Output:**
```
Skill:       custom-logger
Scope:       user
Path:        ~/.claude/skills/custom-logger/SKILL.md
Description: Structured JSON logging for this service
Triggers:    log, logger, logging
Arg hint:    <level> [message]
Quality:     N/A
Usage:       N/A

--- CONTENT ---
[full markdown body]
```

Fallback: show "N/A" for Quality and Usage when stats are not available.

If not found: suggest `search`.

---

### sync

Cross-scope copy (user ↔ project) with diff view.

**Steps:**
1. Scan both scopes; categorize into: user-only, project-only, common (in both)
2. Display sync report
3. Offer options: copy user→project | copy project→user | view diff for common | cancel
4. For copy: confirm each skill before writing
5. For diff: show side-by-side frontmatter + body diff for common skills with diverged content

**Never overwrite without confirmation.**

**Sync report format:**
```
SYNC REPORT
User-only (3): error-handler, api-builder, custom-logger
Project-only (1): test-runner
Common (2): planner, git-master (1 diverged)

Options:
  [1] Copy user skill to project
  [2] Copy project skill to user
  [3] View diff for diverged common skills
  [4] Cancel
```

---

### setup

Guided first-time setup wizard.

**Steps:**

**Step 1 — Directory check:**
```bash
# Create user skills dir if missing
mkdir -p ~/.claude/skills

# Create project skills dir if missing
mkdir -p .claude/skills
```
Report which existed vs. were created.

**Step 2 — Inventory scan:**
Same as `scan` — count and list all found skills in both scopes with name, description, modification date.

**Step 3 — Quick actions menu:**
Ask what to do next:
1. Add new skill — invoke `add` wizard
2. List all skills with details — invoke `list`
3. Scan conversation for skill-worthy patterns — analyze current context for repeatable workflows; route to `nord-core:advanced-skill-authoring` §6 (Extracting Skills from Sessions) for extraction
4. Import skill from URL or pasted content — validate frontmatter, ask scope, write
5. Done

**Import flow:** Ask user whether to provide a URL or paste content directly. For URL: fetch and validate. For paste: accept raw markdown. In both cases: validate YAML frontmatter → ask scope → write to chosen dir. Reject malformed frontmatter with specific error.

---

### scan

Quick inventory without the wizard — runs Step 2 of `setup` only.

**Output:**
```
=== USER SKILLS (~/.claude/skills/) ===
Total: 3
  - error-handler    | Fix aiohttp proxy crash on ClientDisconnectedError | 2026-01-20
  - api-builder      | Generate REST API endpoints                        | 2026-01-19

=== PROJECT SKILLS (.claude/skills/) ===
Total: 2
  - test-runner      | Run integration suite with real DB                 | 2026-01-22

TOTAL: 5 skills
```

---

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
