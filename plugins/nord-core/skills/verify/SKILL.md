---
name: verify
description: "Prove a change works before anyone claims it does — run the narrowest decisive command and report only what it actually showed. Use before saying done, fixed or passing, and when the user asks 'does this work', 'is it done', 'verify my fix', 'confirm it passes', 'check if tests pass', 'läuft das', 'ist das fertig', 'hast du das geprüft'. Runs in this session and spawns nothing."
---

# verify — evidence before the claim

**No completion claim without a command run fresh in THIS message.** Output from an
earlier turn does not count, and neither does an agent's own success report — a dead
worker reports green on an unchanged tree.

## Order

Stop at the first tier that settles the question. Do not run all four.

1. **Existing tests** — the project suite, or the narrowest relevant subset.
2. **Typecheck / build** — `tsc --noEmit`, `mypy`, `cargo check`, `go build`.
   A passing linter is not a passing build; never substitute one for the other.
3. **A narrow direct command** that exercises the changed behaviour.
4. **Manual**, only when automation is impossible — write down the exact steps taken and
   what was observed.

## Rules

- **Delegated work is verified by `git diff --stat`**, not by what the agent reported.
- A failing check is quoted verbatim. Do not smooth it over or summarise it away.
- **To prove a test catches the bug**: write it, run it green, revert the fix, run it and
  require RED, restore the fix, run it green. A test that never went red proves nothing.
- **Against a plan or spec**: re-read it, build a line-by-line checklist, check each item,
  and name the ones you could not check.
- When no realistic verification path exists, say so. That is a valid result; inventing
  one is not.
- Spawn nothing. A separate lane would need its own verification, which is the problem
  this skill exists to end.

## Output

```
## Verification

**Commands run**
- `<command>` → <exit code / one-line result>

**Passed**
- <what passed>

**Failed / unverified**
- <what failed, verbatim, or what could not be checked>

**Verdict**: PASS | FAIL | INCOMPLETE
```

On FAIL or INCOMPLETE, name the concrete next step that would close the gap.
