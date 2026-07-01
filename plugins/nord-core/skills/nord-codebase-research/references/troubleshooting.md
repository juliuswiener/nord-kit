# Troubleshooting

**Stuck in verification loop (AUTO mode)?**
- Check `state.json` for specific conflict ids
- Re-run with `resumeStages` listing completed ids — only conflicted stages re-run
- If conflict is unresolvable, verification passes with `CONFLICTS` verdict and both findings are included with a conflict note

**Stages returning low-quality findings?**
- Check tier assignment — architecture questions need HIGH/opus, not MEDIUM/sonnet
- Narrow `scope` in decomposition — too-broad stages get shallow coverage
- Check if research goal is too vague; decompose manually and pass custom stages

**AUTO mode exhausted 10 iterations without PROMISE?**
- Read `state.json` → check which stages have `status: "pending"` still
- Inspect stage markdowns for "no relevant files found" — goal may not apply to this codebase
- Consider splitting into two smaller research goals

**Missing absolute paths in evidence?**
- Stage agents occasionally use relative paths — these are automatically dropped by quality gate
- Increase specificity in scope: `"src/auth/*.ts and src/middleware/*.ts"` instead of `"authentication code"`
- Re-run failed stage with explicit note: "All evidence must use absolute file paths starting with /"
