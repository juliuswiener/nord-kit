---
name: test-strategy
description: The red-green-refactor discipline and the rules that keep it honest, plus the pyramid a suite should hold and what a coverage gap or a flaky test needs before it counts as diagnosed. Use when writing tests before code, driving a change test-first, deciding which level a test belongs at, judging whether a suite's coverage is adequate to the risk, or when a test is flaky and needs a root cause rather than a retry.
---

# Test strategy

## The iron law

**No production code without a failing test first.**

Wrote the code before the test? Delete it and start over. The discipline is the value;
a shortcut removes the thing the practice was for — evidence that the test can fail.

## Red, green, refactor

1. **RED** — write the test for the next piece of behaviour. Run it. It **must fail.** A
   test that passes on its first run is testing something else.
2. **GREEN** — write only enough code to pass it. No extras, no "while I'm here". Run it;
   it must pass.
3. **REFACTOR** — improve the code. Run the tests after every change. They stay green.
4. Repeat with the next failing test.

| If you see | Do |
|---|---|
| code written before its test | stop, delete the code, write the test |
| a test that passes on the first run | the test is wrong — make it fail first |
| several features in one cycle | stop, one test, one feature |
| refactor skipped | go back and clean up before the next feature |

## The pyramid

```
  e2e          10%     few, slow, whole-system
  integration  20%     boundaries between parts
  unit         70%     fast, one behaviour each
```

A suite inverted from this is slow to run and vague about what broke.

## What a test owes

- one behaviour per test
- a name that states the expected behaviour, so a failure reads as a sentence
- **fresh output shown, never assumed.** "Tests pass" without a run is a claim about the
  past.

## Coverage gaps

A gap is reported with a risk level, not as a percentage. Which paths are uncovered, and
what happens if one is wrong, is the finding — a number is not.

## Flaky tests

A flaky test is diagnosed when the root cause is named and the fix applied. Retrying,
raising a timeout, or marking it skipped is not a diagnosis; it moves the failure to a
day when nobody is looking for it.
