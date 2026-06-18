---
name: nord-cleanup
description: "Multi-agent cleanup: parallel detectors (dead code, duplication, AI-slop, over-abstraction, unused deps) + verify-safe-to-remove, deletion-first plan. Use for 'cleanup', 'deslop', 'remove dead code', 'tidy this codebase'."

---

# nord-cleanup — multi-agent deletion-first cleanup

Invoking this skill IS opt-in to multi-agent orchestration. Run the Workflow tool with the
script below. Default scope: recently changed files / the path the user named — pass as
`args.target`.

This is REPORT-FIRST: the workflow returns a verified deletion plan. Present it, then apply
removals only after the user confirms (or if they said "apply"/"--fix"). Never delete on a
candidate that wasn't marked `safeToRemove`.

```javascript
export const meta = {
  name: 'nord-cleanup',
  description: 'Parallel detect + verify-safe code cleanup',
  phases: [
    { title: 'Detect', detail: 'parallel detectors' },
    { title: 'VerifySafe', detail: 'confirm each removal is safe' },
  ],
}
const target = (args && args.target) || 'this codebase (prefer recently changed files if a git diff exists)'
const DETECTORS = [
  { key:'dead-code',        prompt:'Unreachable / unused functions, variables, exports, whole files.' },
  { key:'duplication',      prompt:'Duplicated logic that should be unified into one implementation.' },
  { key:'ai-slop',          prompt:'AI-generated slop: redundant comments restating code, needless defensive cruft, ceremonial wrappers, dead scaffolding.' },
  { key:'over-abstraction', prompt:'Premature/single-use abstraction, indirection with one caller, config for things that never vary.' },
  { key:'unused-deps',      prompt:'Unused imports and package dependencies.' },
]
const CAND_SCHEMA = { type:'object', properties:{ candidates:{ type:'array', items:{ type:'object',
  properties:{ file:{type:'string'}, lines:{type:'string'}, what:{type:'string'}, why:{type:'string'} },
  required:['file','what','why'] } } }, required:['candidates'] }
const SAFE_SCHEMA = { type:'object', properties:{ safeToRemove:{type:'boolean'}, reason:{type:'string'}, references:{type:'string'} }, required:['safeToRemove','reason'] }

const found = await parallel(DETECTORS.map(d => () =>
  agent(`Scan ${target} for ${d.key}: ${d.prompt} Report concrete removable candidates with file and line range. Only real, removable items.`,
        { label:`detect:${d.key}`, phase:'Detect', schema:CAND_SCHEMA })
    .then(r => ((r && r.candidates) || []).map(c => ({ ...c, detector:d.key })))))
const cands = found.filter(Boolean).flat()
const verified = await parallel(cands.map(c => () =>
  agent(`Verify SAFE TO REMOVE. Search the whole codebase for references/uses and check tests. Be conservative: safeToRemove=false on any doubt or external/public API. Candidate (${c.detector}): "${c.what}" in ${c.file} ${c.lines||''} — ${c.why}`,
        { label:`safe:${c.file}`, phase:'VerifySafe', schema:SAFE_SCHEMA })
    .then(v => ({ ...c, ...v }))))
const safe = verified.filter(Boolean).filter(c => c.safeToRemove)
return { totalCandidates: cands.length, safeToRemove: safe.length, plan: safe }
```
