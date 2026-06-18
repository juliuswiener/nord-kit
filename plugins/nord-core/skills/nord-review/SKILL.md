---
name: nord-review
description: "Multi-dimension adversarial code review: parallel reviewers (correctness/security/performance/reuse), each finding adversarially verified, deduped + severity-ranked. Use for 'deep review', 'multi-agent review', 'review my diff thoroughly', pre-merge."

---

# nord-review — multi-agent adversarial review

Invoking this skill IS opt-in to multi-agent orchestration. Run the Workflow tool with the
script below. First, inline, establish the review target (default: `git diff HEAD`; or the
files/PR the user named) and pass it as `args.target`.

Why this over a single reviewer: one model misses failure modes. Independent per-dimension
reviewers catch more; adversarial verification kills plausible-but-wrong findings before they
reach the user.

After the workflow returns, present `findings` grouped by severity (critical→low) as
`path:line — title. fix.`; if `--fix` was requested, apply the confirmed findings.

```javascript
export const meta = {
  name: 'nord-review',
  description: 'Multi-dimension adversarial code review',
  phases: [
    { title: 'Review', detail: 'parallel per-dimension reviewers' },
    { title: 'Verify', detail: 'adversarially verify each finding' },
  ],
}
const target = (args && args.target) || 'the current git diff (run: git diff HEAD)'
const DIMENSIONS = [
  { key: 'correctness', prompt: 'Logic bugs, off-by-one, null/undefined, error handling, race conditions, broken edge cases.' },
  { key: 'security',    prompt: 'Injection, authz/authn gaps, secret leakage, unsafe deserialization, path traversal, SSRF.' },
  { key: 'performance', prompt: 'N+1, needless allocation, sync-in-hot-path, missing indexes, accidental O(n^2).' },
  { key: 'reuse',       prompt: 'Duplicated logic, reinvented stdlib/lib, needless abstraction, simpler equivalent.' },
]
const FINDINGS_SCHEMA = { type:'object', properties:{ findings:{ type:'array', items:{ type:'object',
  properties:{ file:{type:'string'}, line:{type:'number'}, severity:{type:'string', enum:['critical','high','medium','low']},
  title:{type:'string'}, detail:{type:'string'}, fix:{type:'string'} }, required:['file','severity','title','detail'] } } }, required:['findings'] }
const VERDICT_SCHEMA = { type:'object', properties:{ isReal:{type:'boolean'}, confidence:{type:'string', enum:['high','medium','low']}, reason:{type:'string'} }, required:['isReal','reason'] }

const results = await pipeline(
  DIMENSIONS,
  d => agent(`Review ${target} for ${d.key} issues. ${d.prompt} Report concrete findings with exact file:line and a one-line fix. No praise, no nits.`,
        { label:`review:${d.key}`, phase:'Review', schema:FINDINGS_SCHEMA }),
  (review, d) => parallel(((review && review.findings) || []).map(f => () =>
    agent(`Adversarially verify this ${d.key} finding — actively try to REFUTE it. Default isReal=false if uncertain or unreproducible. Finding: "${f.title}" at ${f.file}:${f.line||'?'} — ${f.detail}`,
          { label:`verify:${f.file}`, phase:'Verify', schema:VERDICT_SCHEMA })
      .then(v => ({ ...f, dimension:d.key, verdict:v }))))
)
const order = { critical:0, high:1, medium:2, low:3 }
const confirmed = results.flat().filter(Boolean).filter(f => f.verdict && f.verdict.isReal)
confirmed.sort((a,b) => (order[a.severity]??9) - (order[b.severity]??9))
return { count: confirmed.length, findings: confirmed }
```
