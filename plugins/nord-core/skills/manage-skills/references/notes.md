# Notes

[Edge cases, gotchas]
```

**Example:**
```
> /nord-core:manage-skills add custom-logger

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
3. Scan conversation for skill-worthy patterns — analyze current context for repeatable workflows; route to `nord-core:author-skills` §6 (Extracting Skills from Sessions) for extraction
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
