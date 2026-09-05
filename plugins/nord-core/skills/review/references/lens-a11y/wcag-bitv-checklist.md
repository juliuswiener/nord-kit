# WCAG 2.2 AA + BITV 2.0 / EN 301 549 + Leichte Sprache — review checklist

Score every finding against the exact success criterion (SC) below. Tag it `SC-number name (level)`,
e.g. `1.4.3 Contrast (Minimum) (AA)`. German public bodies are bound by **BITV 2.0**, which references
**EN 301 549**, which adopts **WCAG 2.1 AA** as its web core — treat WCAG 2.2 AA as the working target
(2.2 adds the criteria marked ★ below; they are best practice for DE public sites and required under the
2025 EN 301 549 update cycle). AAA criteria are noted only where citizen services commonly need them.

## Principle 1 — Perceivable

- **1.1.1 Non-text Content (A)** — every `img`/`svg`/icon-button/chart has a text alternative; decorative
  images are `alt=""` / `aria-hidden`. CAPTCHAs offer an alternative.
- **1.2.x Time-based Media (A/AA)** — captions for prerecorded (1.2.2) and live (1.2.4) audio; audio
  description (1.2.5) for video. A transcript for audio-only.
- **1.3.1 Info & Relationships (A)** — semantic HTML: real headings (`h1..h6` in order), lists, `table`
  with `th/scope`, `fieldset/legend`, programmatic label↔field association. Not div-soup styled to look
  structured.
- **1.3.2 Meaningful Sequence (A)** — DOM/reading order matches visual order.
- **1.3.4 Orientation (AA)** — not locked to portrait/landscape.
- **1.3.5 Identify Input Purpose (AA)** — `autocomplete` on name/email/address/etc. fields.
- **1.4.1 Use of Color (A)** — colour is never the ONLY cue (error state, link, required field also has
  text/icon/underline).
- **1.4.3 Contrast (Minimum) (AA)** — text ≥ 4.5:1; large text (≥24px, or ≥18.7px bold) ≥ 3:1. Measure, don't guess.
- **1.4.4 Resize Text (AA)** — usable at 200% text zoom, no loss of content/function.
- **1.4.5 Images of Text (AA)** — real text, not text baked into images (except logos).
- **1.4.10 Reflow (AA)** — no 2-D scrolling / no loss at 320 CSS px width (≈400% zoom on 1280px).
- **1.4.11 Non-text Contrast (AA)** — UI components (input borders, buttons, focus indicator) and
  meaningful graphics ≥ 3:1 against adjacent colour.
- **1.4.12 Text Spacing (AA)** — no clipping when line-height/letter/word/paragraph spacing is increased.
- **1.4.13 Content on Hover or Focus (AA)** — hover/focus popups are dismissible, hoverable, persistent.

## Principle 2 — Operable

- **2.1.1 Keyboard (A)** — every function operable by keyboard alone.
- **2.1.2 No Keyboard Trap (A)** — focus can always move away (modals, embeds, date-pickers).
- **2.1.4 Character Key Shortcuts (A)** — single-key shortcuts can be turned off/remapped.
- **2.2.1 Timing Adjustable (A)** — session/timeouts can be extended or are ≥20h; warn before expiry.
- **2.2.2 Pause, Stop, Hide (A)** — auto-moving/blinking/carousels can be paused.
- **2.3.1 Three Flashes (A)** — nothing flashes > 3×/sec.
- **2.4.1 Bypass Blocks (A)** — a working "skip to content" link, or landmarks.
- **2.4.2 Page Titled (A)** — unique, descriptive `title`.
- **2.4.3 Focus Order (A)** — logical, meaningful tab order.
- **2.4.4 Link Purpose (A)** — link text (with context) says where it goes; no bare "hier"/"mehr"/"click here".
- **2.4.6 Headings & Labels (AA)** — descriptive headings and form labels.
- **2.4.7 Focus Visible (AA)** — a clearly visible focus indicator on every focusable element (never `outline:none` with no replacement).
- **★ 2.4.11 Focus Not Obscured (Minimum) (AA)** — focused element not fully hidden by sticky headers/footers.
- **2.5.3 Label in Name (A)** — the visible label text is contained in the accessible name (voice control).
- **2.5.4 Motion Actuation (A)** — motion-triggered functions have a non-motion alternative.
- **★ 2.5.8 Target Size (Minimum) (AA)** — interactive targets ≥ 24×24 CSS px (or adequate spacing).

## Principle 3 — Understandable

- **3.1.1 Language of Page (A)** — `<html lang="de">`.
- **3.1.2 Language of Parts (AA)** — `lang` on foreign-language passages.
- **3.2.1 On Focus (A)** / **3.2.2 On Input (A)** — no unexpected context change on focus or on changing a control.
- **3.2.3 Consistent Navigation (AA)** / **3.2.4 Consistent Identification (AA)** — nav and component naming consistent across pages.
- **★ 3.2.6 Consistent Help (A)** — help/contact appears in a consistent location across pages.
- **3.3.1 Error Identification (A)** — errors identified in **text**, describing the problem (not colour alone).
- **3.3.2 Labels or Instructions (A)** — every field has a persistent visible label + needed instructions
  (format hints). Placeholder-as-label is a failure.
- **3.3.3 Error Suggestion (AA)** — when the fix is known, suggest it ("Datum als TT.MM.JJJJ").
- **3.3.4 Error Prevention (Legal/Financial) (AA)** — submissions that are legal/financial/data-deleting
  are reversible, checked, or confirmed. Core for Bürgeranträge.
- **★ 3.3.7 Redundant Entry (A)** — don't re-ask info already given in the same process (or auto-fill it).
- **★ 3.3.8 Accessible Authentication (Minimum) (AA)** — no cognitive-function test (puzzle, transcription)
  with no alternative; allow paste/password-manager.

## Principle 4 — Robust

- **4.1.2 Name, Role, Value (A)** — every control (incl. custom widgets) exposes a correct accessible
  **name**, **role**, and current **state/value** to assistive tech. Prefer native elements; ARIA only to fill gaps.
- **★ 4.1.3 Status Messages (AA)** — status/toast/validation updates announced via `aria-live`/`role=status`
  without moving focus.
- (4.1.1 Parsing was removed in WCAG 2.2 — do not report duplicate-id/unclosed-tag as a 4.1.1 failure; if it
  breaks AT, report it under 4.1.2 instead.)
- ARIA hygiene: no `aria-hidden="true"` on a focusable element; no role that conflicts with the native
  element; `aria-*` references point to existing IDs.

## Bürgernähe / Verständlichkeit (plain language — beyond WCAG)

WCAG 3.1.5 (Reading Level) is AAA, but for citizen services it is effectively expected. Assess:

- **Reading level** — aim **Einfache Sprache** (~B1 or lower). Flag Amtsdeutsch/Behördendeutsch: nominal
  style ("Antragstellung erfolgt unter Verwendung..."), passive voice, nested subordinate clauses, sentences
  > ~15–20 words, Fachbegriffe/Abkürzungen without explanation.
- **Leichte Sprache** — is a Leichte-Sprache version offered and linked from the main page? (Expected of
  German federal/public bodies alongside Gebärdensprache.)
- **Structure for scanning** — meaningful headings, key info and the primary action front-loaded, short
  paragraphs, active voice, concrete verbs, "you"-address (Sie/du consistent).
- **For each worst offender, quote the sentence and give a plainer rewrite** — that is the actionable output.

## Tool ↔ criterion coverage (what the machine gate can and cannot decide)

Automated tools catch ~30–40% of WCAG issues. Use them for the machine-checkable set; the lenses cover the rest.

| Tool-decidable (`toolVerified:true`) | Human/lens judgement (adversarial verify) |
|---|---|
| 1.4.3 / 1.4.11 contrast, 1.1.1 missing alt, 3.3.2 missing label, 1.3.1 some structure, `lang`, ARIA validity, duplicate IDs, target size | 1.1.1 alt *quality*, 2.4.3 focus *order sense*, 2.4.4 link-text *clarity*, all of 3.3 error *UX*, keyboard *flow*, plain-language, usability, visual hierarchy, trust |

## BITV 2.0 / legal (DE public sector)

- **Barrierefreiheitserklärung** (accessibility statement) — present, linked from every page/footer, states
  conformance status, lists known non-accessible content, gives a **feedback mechanism** and names the
  **Schlichtungsstelle BGG**. Dated within the last 12 months.
- **Impressum** and **Datenschutzerklärung** present and reachable.
- Federal sites: **Erklärung in Leichter Sprache** and **Gebärdensprache** (DGS) entry points.
- Consent/cookie banner must not itself be a keyboard trap, a contrast failure, or a dark pattern.
