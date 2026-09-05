---
name: manage-skills
description: "Inspect and edit the skills already on this machine — list, add, remove, edit, search, copy between scopes, or set up the directories. Use on 'manage skills', 'local skills', 'add skill', 'remove skill', 'edit skill', 'welche Skills habe ich', 'Skill anlegen'. This is local CRUD; to find a skill in a marketplace use `search-skills` or `install-skill`, to write a good one use `author-skills`."
argument-hint: "<subcommand> [args]"
disable-model-invocation: true
---

# manage-skills — local skill CRUD

Skills are plain directories holding a `SKILL.md` with YAML frontmatter.

| scope | path | precedence |
|---|---|---|
| user | `~/.claude/skills/<slug>/SKILL.md` | enterprise > user > project |
| project | `.claude/skills/<slug>/SKILL.md` | committed with the repo |
| plugin | `<plugin>/skills/<slug>/SKILL.md` | namespaced `plugin:skill`, cannot collide |

## Subcommands

```
list                 table of all skills by scope
add [slug]           interactive creation wizard
remove <slug>        confirm-gated deletion
edit <slug>          field-level interactive edit
search <query>       ranked full-text search over name, description and body
info <slug>          full detail for one skill
sync                 copy across scopes, showing the diff first
setup                guided first-time wizard
scan                 quick inventory, no wizard
```

### list

Scan both scopes, parse each frontmatter, print one section per scope with
`name · description · scope`, then a one-line summary (`3 user | 2 project | 5 total`).
Show `N/A` for a field that is missing rather than omitting the row — an unparseable
SKILL.md is the thing worth seeing.

### add

Ask in one message: slug (lowercase and hyphens only, no spaces), one-line description,
scope, and whether it has side effects. Then write the scaffold, report the path, and say
it activates at the next session start.

```yaml
---
name: <slug>
description: "<what it does. Then: use when …, or when the user says '<phrase>'.>"
# when_to_use: <extra trigger phrases, appended to description>
# argument-hint: "<args>"
# disable-model-invocation: true   # side effects: only the user may run it
---
```

**`triggers:` is not a Claude Code frontmatter field** and is ignored by the harness. The
trigger is the `description`, optionally extended by `when_to_use`. Older skills in this
tree carry `triggers:` blocks that have never done anything.

For what belongs in the body, and how to write a description that actually fires, use
`author-skills` — it holds the quality gate, the templates and the composition rules, and
duplicating them here would mean maintaining both.

### remove

Confirm with the resolved path before deleting anything, and delete through the file
tools rather than `rm` — `guard-rm.py` blocks deletions it cannot resolve.

### sync

Show the diff between the two copies before writing. Never overwrite the destination
silently; a project skill and a user skill with the same slug are a precedence question,
not a duplicate.

## Errors

Handle: directory or file missing, permission denied, invalid or absent frontmatter,
duplicate slug (warn, then ask to overwrite or rename), invalid slug format.

```
Error: <what went wrong>
Suggestion: <the next step>
```

## Verify

After any write, read the file back and confirm the frontmatter parses and `name` matches
the directory. A skill whose frontmatter is malformed does not fail loudly — it is simply
never offered, which is indistinguishable from a description that does not match.

## Notes

`references/notes.md` — scopes, precedence, plugin layout and the edge cases behind these
subcommands. Read it when a subcommand behaves unexpectedly.
