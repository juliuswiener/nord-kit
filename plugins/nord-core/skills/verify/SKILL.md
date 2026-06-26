---
name: verify
description: "Completion verification — use before claiming done/fixed/passing. Triggers on: 'does this work', 'is it done', 'verify my fix', 'confirm it passes', 'check if tests pass', or any claim of completion without concrete evidence. Runs in-session (no subagent). Reports only what was actually checked."

---

# verify — in-session completion check

Lightweight in-session verification. No subagent spawn. Run checks, report evidence.

## Verification order

1. **Existing tests** — run the project test suite (or the narrowest relevant subset)
2. **Typecheck / build** — `tsc --noEmit`, `mypy`, `cargo check`, `go build`, or equivalent
3. **Narrow direct commands** — targeted CLI invocations that exercise the changed behavior
4. **Manual / interactive** — only if automation is impossible; document exact steps and observations

Stop at the first tier that either proves or disproves the claim. Do not run all four if tier 1 is conclusive.

## Rules

- Never say a change is complete without running at least one command and showing its output.
- If a check fails, report the failure verbatim — do not smooth it over.
- If no realistic verification path exists, say so explicitly.
- Prefer the narrowest command that is still decisive.
- Do not spawn subagents; do not delegate verification to a separate lane mid-skill.

## Output

Report only what was actually verified — no speculation about what "should" pass.

```
## Verification

**Commands run**
- `<command>` → <exit code / summary>

**Passed**
- <what passed>

**Failed / unverified**
- <what failed or could not be checked>

**Verdict**: PASS | FAIL | INCOMPLETE
```

If verdict is FAIL or INCOMPLETE, state the concrete next step to close the gap.
