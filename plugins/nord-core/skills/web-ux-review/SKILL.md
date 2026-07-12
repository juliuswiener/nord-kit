---
name: web-ux-review
description: "Accessibility-first UX review of a web page or frontend for citizen-facing / public-sector sites — WCAG 2.2 AA, BITV 2.0 / EN 301 549, plain language (Leichte/Einfache Sprache), usability heuristics, visual design, and DE legal-trust duties. Runs real a11y tooling (axe-core/pa11y/Lighthouse) as a deterministic gate, then parallel POUR + citizen-UX lenses, adversarially verified and severity-ranked with exact WCAG success-criterion tags. Triggers on review accessibility, is this barrierefrei, WCAG/BITV check, UX review of this page, bürgernah, government form review."
argument-hint: "<url | source-path | screenshot> [--source-only] [--live]"
---

# web-ux-review — accessible, citizen-centric web UX review

Invoking this skill IS opt-in to multi-agent orchestration. Reviews a web UI for **barrierefreie,
bürgernahe UX**: WCAG 2.2 AA + BITV 2.0 / EN 301 549 conformance, plain-language comprehensibility,
usability, visual design, and German public-sector legal-trust duties.

Why multi-agent over one reviewer: accessibility genuinely decomposes into independent lenses (the four
WCAG principles + citizen-UX concerns) that a single pass conflates and under-covers. Each lens reviews
in isolation; a real a11y tool decides the machine-checkable findings deterministically; the rest are
adversarially verified so plausible-but-wrong findings don't reach the user.

## Input modes (establish the target first, inline)

| Input | What to gather before the pipeline |
|---|---|
| **URL** (live/staging page) | Run the a11y tool gate against it (axe/pa11y/Lighthouse) **and** render tiles via `nord-web:visual-read` so the visual lenses can SEE it. Best signal — prefer this. |
| **Source path** (JSX/HTML/Vue/Svelte/templates) | Static-analyze markup. No live DOM → tool gate degrades to "coverage_gap (no rendered page)"; say so, don't fake a green. `--source-only` forces this. |
| **Screenshot / design mock** | Visual + plain-language + hierarchy lenses only via `visual-read` tiles. Cannot judge keyboard/robust/ARIA from a picture — mark those `not_assessable (image only)`. |

If the user names both a URL and source, do both: tool-gate + tiles from the URL, static analysis from source.

## Pre-pipeline: deterministic tool gate (mandatory when a page can be rendered)

Machine-checkable a11y failures are FACTS, not opinions — run the tool and let its output decide, exactly
like codebase-audit's tool gate. Two tiers, both in `references/tooling.md`:

- **Tier 1 — static rule scan** (axe-core default, else pa11y / Lighthouse a11y / measured contrast).
  Catches ~30–40%: contrast, missing alt/label, invalid ARIA, no `lang`, target size.
- **Tier 2 — browser-driven interactive pass** (Claude-in-Chrome preferred — you have it — else Playwright).
  Drives the criteria commonly (wrongly) called "manual": keyboard operability + focus order + traps
  (2.1.1/2.1.2/2.4.3), visible + unobscured focus (2.4.7/2.4.11), reflow@320 (1.4.10), zoom 200% (1.4.4),
  text-spacing (1.4.12), orientation (1.3.4), content-on-hover (1.4.13), status messages (4.1.3). These are
  interaction-verified, NOT coverage gaps — run them whenever the page is reachable.

- Any failure either tier reports → finding with `toolVerified:true` + the exact tool/procedure + the
  proving line. These **bypass** adversarial verify.
- Only what neither tier could exercise (no browser, source-only, SR-listening) → `coverage_gap`, related
  lens findings stay `toolVerified:false`. Absence of a run is NOT a pass.

The exhaustive WCAG 2.2 A/AA success-criteria checklist + BITV 2.0 / EN 301 549 mapping + Leichte-Sprache
criteria live in `references/wcag-bitv-checklist.md` — the lens agents read it; you don't restate it here.

```javascript
export const meta = {
  name: 'web-ux-review',
  description: 'Accessibility-first, citizen-centric web UX review (WCAG 2.2 AA / BITV 2.0)',
  phases: [
    { title: 'Review', detail: 'parallel POUR + citizen-UX lenses' },
    { title: 'Verify', detail: 'tool-verified findings bypass; reasoned findings adversarially refuted' },
  ],
}
const target = (args && args.target) || 'the page/source described in the conversation'
const toolFindings = (args && args.toolFindings) || 'none supplied (tool gate not run or page not renderable)'
const tiles = (args && args.tiles) || 'no rendered tiles supplied'
const CHECKLIST = 'Score against the exact success criteria in references/wcag-bitv-checklist.md. Tag every finding with its WCAG SC number + level (e.g. "1.4.3 Contrast (Minimum)" AA) and, where it maps, the BITV 2.0 / EN 301 549 clause.'
const DIMENSIONS = [
  { key:'perceivable',    prompt:`WCAG Principle 1 — Perceivable. Text alternatives (1.1), time-based media captions/audio-desc (1.2), adaptable: semantic structure + meaningful sequence + identify-input-purpose (1.3), distinguishable: colour-not-sole-cue + contrast (text ≥4.5:1, large/UI ≥3:1) + resize 200% + reflow at 320px CSS px + text-spacing + content-on-hover (1.4). ${CHECKLIST}` },
  { key:'operable',       prompt:`WCAG Principle 2 — Operable. Keyboard, no trap (2.1), enough time (2.2), no >3 flashes/sec (2.3), navigable: skip link + page title + focus order + link purpose + headings/labels + visible focus + focus-not-obscured 2.4.11 (2.4), input modalities: target size ≥24px 2.5.8 + pointer gestures + label-in-name (2.5). ${CHECKLIST}` },
  { key:'understandable', prompt:`WCAG Principle 3 — Understandable. Language of page/parts (3.1), predictable: no surprise on focus/input + consistent nav/identification + consistent help 3.2.6 (3.2), input assistance: error identification + labels/instructions + error suggestion + error prevention for legal/financial + redundant-entry 3.3.7 + accessible-authentication 3.3.8 (3.3). FORMS are the citizen-service heart — scrutinise form-error UX hardest: is every error identified in text, tied to its field, and does it say how to fix it? ${CHECKLIST}` },
  { key:'robust',         prompt:`WCAG Principle 4 — Robust. Name/role/value: every custom control exposes correct name+role+state to assistive tech (4.1.2), status messages via aria-live (4.1.3). ARIA correctness: native HTML before ARIA, no aria-hidden on focusable, no redundant/conflicting roles. ${CHECKLIST}` },
  { key:'plain-language', prompt:`Bürgernähe / Verständlichkeit. Reading level: citizen services should aim Einfache Sprache (~B1 or lower). Flag Amtsdeutsch/Behördendeutsch, nominal style, over-long compound sentences, passive voice, and every unexplained Fachbegriff. Is a "Leichte Sprache" version offered and linked (expected of German public bodies)? Meaningful headings, key info front-loaded, active voice, concrete verbs. Quote the worst offending sentences with a plainer rewrite.` },
  { key:'usability',      prompt:`Nielsen heuristics + citizen task-flow. Is the primary task (apply, pay, book, find info) reachable in few clear steps? Visibility of system status, real-world language, user control/undo, consistency, error prevention, recognition-over-recall, flexibility, minimalist design, error recovery, help. Findability of Bürgerservices (search, clear IA). Mobile task completion. Flag any dark patterns.` },
  { key:'visual-design',  prompt:`Visual hierarchy, consistency, whitespace, typographic scale, responsive integrity (no overflow/overlap at 320px width and at 200% zoom), touch-target spacing, intentional-not-generic-template design, consistent component states. Judge from the rendered tiles: ${tiles}. NOTE: contrast is scored under 'perceivable' — do NOT re-score it here; judge hierarchy, legibility and polish.` },
  { key:'legal-trust',    prompt:`German public-sector duties. Barrierefreiheitserklärung present, reachable, current, stating conformance status + a feedback mechanism + the Schlichtungsstelle (BITV 2.0). Impressum, Datenschutzerklärung, a working contact/feedback path. Gebärdensprache + Leichte-Sprache entry points (federal sites). Trust signals: official domain/branding, no placeholder/broken content, consent banner is not itself a barrier or a dark pattern.` },
]
const FINDINGS_SCHEMA = { type:'object', properties:{ findings:{ type:'array', items:{ type:'object', properties:{
  title:{type:'string'}, detail:{type:'string'}, fix:{type:'string'},
  where:{type:'string', description:'selector / file:line / tile-path / page region'},
  wcagSC:{type:'string', description:'exact success criterion e.g. "1.4.3 Contrast (Minimum)" — empty for non-WCAG UX/plain-language/trust findings'},
  level:{type:'string', enum:['A','AA','AAA','n/a'], description:'WCAG conformance level; n/a for UX/plain-language/trust'},
  bitv:{type:'string', description:'BITV 2.0 / EN 301 549 clause if it maps, else empty'},
  severity:{type:'string', enum:['blocker','critical','high','medium','low']},
  confidence:{type:'string', enum:['high','medium','low']},
  toolVerified:{type:'boolean', description:'true ONLY if this came from a real a11y tool run (axe/pa11y/Lighthouse/measured contrast) — a fact, bypasses verify'} },
  required:['title','detail','where','severity','confidence'] } } }, required:['findings'] }
const VERDICT_SCHEMA = { type:'object', properties:{ isReal:{type:'boolean'}, reason:{type:'string'},
  checked:{type:'string', enum:['confirmed','refuted','na'], description:'confirmed = re-ran the tool / inspected the actual DOM-or-tile and it holds; refuted = it does not hold; na = judgement finding, fall back to adversarial refute'} },
  required:['isReal','reason','checked'] }

const results = await pipeline(
  DIMENSIONS,
  d => agent(`Review this web UI for ${d.key} issues.\nTARGET: ${target}\nA11y tool-gate output already collected (treat as ground truth, tag toolVerified:true, do not re-argue): ${toolFindings}\n${d.prompt}\nReport concrete findings with a precise location (selector / file:line / tile-path). Severity: blocker = fails a Level A criterion AND blocks a core citizen task; critical = Level A failure or task-blocking UX; high = Level AA failure; medium/low = lesser. No praise, no nits.`,
        { label:`review:${d.key}`, phase:'Review', schema:FINDINGS_SCHEMA }),
  (review, d) => parallel(((review && review.findings) || []).map(f => () =>
    (f.toolVerified
      ? Promise.resolve({ ...f, dimension:d.key, verdict:{ isReal:true, checked:'confirmed', reason:'tool-verified' } })
      : agent(`Verify this ${d.key} finding. If it is machine-checkable (contrast, alt/label presence, ARIA validity, lang, target size), RE-CHECK it against the actual page/DOM/tile — holds → checked="confirmed", does not → checked="refuted". If it is a judgement (usability, plain-language, visual, trust), set checked="na" and adversarially REFUTE it — default isReal=false if the impact is overstated or the citizen would not actually be blocked.\nFinding: "${f.title}" @ ${f.where}${f.wcagSC ? ' ['+f.wcagSC+']' : ''} — ${f.detail}`,
            { label:`verify:${d.key}`, phase:'Verify', schema:VERDICT_SCHEMA })
        .then(v => ({ ...f, dimension:d.key, verdict:v }))) ))
)
const order = { blocker:0, critical:1, high:2, medium:3, low:4 }
const confirmed = results.flat().filter(Boolean).filter(f => {
  const v = f.verdict; if (!v) return false
  if (v.checked === 'confirmed') return true
  if (v.checked === 'refuted') return false
  return !!v.isReal
})
confirmed.sort((a,b) => (order[a.severity]??9) - (order[b.severity]??9))
return { count: confirmed.length, findings: confirmed }
```

## After the workflow returns

1. **Conformance verdict** — estimate against WCAG 2.2 AA:
   `Fails A` (any unmitigated Level A failure) · `Fails AA` (A ok, AA gaps) · `AA with gaps` (minor/edge) ·
   `Meets AA` (no Level A/AA failures found — state the coverage limits honestly). Add a one-line
   BITV 2.0 note (Barrierefreiheitserklärung present & valid?) and a citizen-usability grade
   (can a first-time user complete the primary task without help?).
2. **Triage** each confirmed finding into one bucket: **NO-BRAINER** (add alt, fix a label, bump a
   contrast token — <1h, no design decision) · **QUICK WIN** (form-error UX, focus order, a plain-language
   rewrite pass) · **NEEDS DECISION** (IA restructure, component-library swap — surface 2-4 options) ·
   **MAJOR** (a Leichte-Sprache edition, a full design-system a11y retrofit).
3. **Never auto-fix.** Read-only review; hand fixes to the user / `nord-execute` / `ralph` after they pick.

## Confidence + provenance (anchored — A/B/C, see BEHAVIOUR.md)
- **high** = `toolVerified` (axe/pa11y/Lighthouse/measured contrast — a fact) OR `checked:confirmed`
  (re-inspected the actual DOM/tile). **medium** = judgement finding that survived adversarial refute.
  **low** → Open Questions, not asserted. Nothing is `high` on argument alone.
- **coverage_gap ≠ pass:** a criterion you could not assess (source-only, image-only, tool absent) is
  reported as a gap, never silently as conformant.

## Final output (last message MUST carry the full structure)

**Conformance verdict** — `Fails A` / `Fails AA` / `AA with gaps` / `Meets AA` + BITV note + citizen-usability grade

**WCAG principle summary** (one line each: Perceivable / Operable / Understandable / Robust — worst finding + count)

**Confirmed findings** (severity-grouped: blocker → low)
```
[SEVERITY | conf] where — [WCAG SC, level] title. fix.
```

**Bürgernähe / plain-language** (worst sentences quoted + plainer rewrite; Leichte-Sprache offer present?)

**Usability & task-flow** (can the primary citizen task be completed? friction points)

**Legal-trust** (Barrierefreiheitserklärung / Impressum / Datenschutz / feedback path — present & valid?)

**What's missing / not assessable** (coverage gaps — source-only, image-only, tool-absent — stated, never passed silently)

**Triage** (each finding → NO-BRAINER / QUICK WIN / NEEDS DECISION / MAJOR)

**Open Questions** (low-confidence — surfaced, not blocking)

## Failure modes to avoid
- **Eyeballing contrast/ARIA instead of running the tool** — machine-checkable criteria get the tool gate, always.
- **Passing a criterion you couldn't assess** — source-only/image-only/tool-absent is a coverage gap, not a pass.
- **Generic "improve accessibility"** — every finding needs a location, the exact WCAG SC, and a concrete fix.
- **Scoring contrast twice** — it lives under Perceivable; visual-design judges hierarchy/polish only.
- **Ignoring Bürgernähe** — a page can pass WCAG and still be unusable Amtsdeutsch; plain-language is a first-class lens.
- **Severity inflation** — reserve `blocker` for a Level A failure that blocks a core citizen task.

## Related
- `nord-web:visual-read` — renders the page to tiles for the visual/plain-language lenses (and its visual-verdict rubric).
- `codebase-audit` (`extraLanes:['a11y']`) — repo-wide static a11y as one lane of a full architectural audit; this skill is the focused, tool-gated, citizen-UX-aware page/flow review.
- `nord-review` — line-level code review of a diff (this skill reviews the rendered/authored UI, not the diff).
