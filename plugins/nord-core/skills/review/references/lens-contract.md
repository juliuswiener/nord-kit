---
name: review --lens contract
description: Check a change against the judgment-class rules in the harness rule register — the rules no hook can enforce because they need interpretation, such as the simplicity ladder, surgical changes, fixing the root cause, and the provenance rules. Reads the rules from ~/00_projects/vault/contract/rules.yaml rather than restating them, so the lens cannot drift from the register. Use when reviewing a diff for the standards that a linter cannot express, before shrinking CLAUDE.md, or on 'hält sich das an unsere Regeln'.
---

# The judgment rules

## Why this lens exists

The register at `~/00_projects/vault/contract/rules.yaml` classifies every harness rule
into one of four classes, and the class decides who enforces it:

| class | enforcer |
|---|---|
| invariant | PreToolUse hook, may refuse |
| evidence | PostToolUse or a check, warns |
| **judgment** | **this lens, at a boundary — nothing else can** |
| identity | the prompt itself |

21 of 59 rules are `judgment`. No hook can decide whether a simpler approach existed or
whether every changed line traces back to the request — that needs reading the change
against the intent. Until this lens runs them, those 21 are prompt text that nothing ever
checks, and they decay with context length the way every unenforced rule does (measured
twice on this machine: `report{}` 0 calls in 253 sessions, the confidence field 20 of 20
wrong after a rewrite that forbade the exact failure in words).

## Get the rules from the register, never from here

```
python3 - <<'PY'
import yaml, os
p = os.path.expanduser("~/00_projects/vault/contract/rules.yaml")
for r in yaml.safe_load(open(p))["rules"]:
    if r["class"] == "judgment":
        print(f"{r['id']}\n    {' '.join(r['text'].split())}\n")
PY
```

**Do not paste the rule texts into this file.** Two wordings drift, and the register is
the one with the ids that findings, exceptions and measurements refer to. If the command
above fails — no vault mounted, no register — say so and fall back to the general diff
pass rather than reviewing against a half-remembered list.

`scope` narrows where a rule can fire: absent means everywhere, `vault` means only inside
the vault, `aina-repo` only where an `aina.yaml` of version 1.x sits. Drop the rules whose
scope does not match the repo under review before you start.

## How to run it

One pass over the diff, per rule, in register order. For each rule, either a finding or
nothing — a rule you looked at and found nothing on produces no output.

**A finding needs all four:**

1. the rule id in brackets, e.g. `[simplicity.nothing_speculative]`
2. `file:line` you actually read
3. what the rule asks for versus what the change does
4. the smaller change that would satisfy it

Without (4) the finding is an opinion. `fix.root_not_call_site` without naming the callers
that stay broken is not a finding, it is a feeling.

## Severity, and why most of these are LOW

| severity | when |
|---|---|
| HIGH | the rule protects against data loss, a security hole, or a wrong result — `simplicity.never_at_the_cost_of`, `claim.verify_before_done` on a claim that is false |
| MEDIUM | the change will cost someone real time later — `fix.root_not_call_site` with named unfixed callers, `reuse.check_this_tree_first` with the existing helper named |
| LOW | style and economy — most of `surgical.*`, `simplicity.*` |

**A judgment finding never blocks.** AINA 1.0 D8 allows gating a review at a status
transition; this harness does not, and the reason is measured: `tick_055` in AINA's own
archive is a Stop-hook that called a model to check compliance and hung the session on
invalid JSON. Model judgment is advice. The deterministic gate decides done.

## What this lens must not do

- **Not restate the register.** Read it at runtime.
- **Not invent rules.** A finding whose id is not in the register is out of scope — say
  what you saw and leave it unlabelled, or propose a new rule to the human.
- **Not report a rule as satisfied.** Silence is the pass. A list of 21 green checks is
  noise that hides the two findings that matter.
- **Not review process rules against a diff.** `plan.ask_when_unclear` and
  `plan.state_assumptions` happened in the conversation, not in the code. They are in the
  register because they are rules, not because a diff can show them. Skip them and say you
  skipped them.

## Output

Findings, most severe first, then one line:

```
21 judgment rules, N in scope for this repo, M skipped as not visible in a diff.
```

That line is the honest part: it says what was not looked at, which a list of findings on
its own never does.
