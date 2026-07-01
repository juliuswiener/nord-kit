# Pre-Execution Gate

Intercepts underspecified execution requests (ralph/autopilot/team/nord-execute) and redirects them through `nord-plan --consensus` to scope the work first. Read when an execution keyword is present.

## Why the Gate Exists

Execution modes (ralph, autopilot, team, nord-exec) spin up heavy multi-agent orchestration. Vague requests like `ralph improve the app` give agents no bounded target — cycles waste on scope discovery that belongs in planning.

## Gate Logic

Gate fires when **all three** conditions hold:

1. An execution keyword is present: `ralph`, `autopilot`, `team`, `nord-execute`, `ultrawork`, `ultrapilot`
2. Prompt is ≤ 15 effective words (stop-words excluded)
3. NO concrete anchor is detected

**Concrete anchors — any ONE passes the gate:**

| Anchor type | Example |
|---|---|
| File path | `src/hooks/bridge.ts` or any `/`-containing path |
| Issue / PR number | `#42`, `PR-123` |
| camelCase symbol | `processKeywordDetector` |
| PascalCase symbol | `UserModel` |
| snake_case symbol | `user_model` |
| Test runner invocation | `npm test`, `pytest`, `cargo test` |
| Numbered steps | `1. Add X\n2. Test Y` |
| Acceptance criteria block | `acceptance criteria:` or `ac:` followed by content |
| Error reference | `TypeError`, `AssertionError`, stack-trace fragment |
| Code block | fenced ` ``` ` block with content |
| Escape prefix | `force:` or `!` anywhere before the execution keyword |

## On Gate Fire

Redirect to `nord-plan --consensus` with a brief explanation:

> "Prompt is underspecified for direct execution — routing through nord-plan consensus to scope the work first."

Bypass: prefix the original message with `force:` or `!` (e.g., `force: ralph fix it`).

## Gate Does NOT Fire

- Any concrete anchor present (one is enough)
- `--consensus` already requested (already in planning mode)
- Explicitly called as `nord-plan` (planning, not execution)

## Good vs Bad Prompts

**Passes** (concrete anchor present):
- `ralph fix src/hooks/bridge.ts:326` — file path
- `autopilot implement #42` — issue number
- `team add validation to processKeywordDetector` — camelCase symbol
- `ralph do:\n1. Add input validation\n2. Write tests` — numbered steps

**Gated** (redirected to nord-plan --consensus):
- `ralph fix this`
- `autopilot build the app`
- `team improve performance`
- `ralph add authentication`

**Bypass**:
- `force: ralph refactor the auth module`
- `! autopilot optimize everything`
