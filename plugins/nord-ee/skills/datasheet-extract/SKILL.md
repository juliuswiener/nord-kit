---
name: datasheet-extract
description: "Extract structured specs from component datasheet PDFs: pinouts, electrical characteristics, peripherals, topology. Triggers: 'extract datasheet', specs for MPN X, verify extraction, check pin functions."

---

# Datasheets Skill

## Purpose

Extract structured, machine-readable specifications from component datasheet PDFs and make them available to analyzer skills. Works on whatever PDFs are downloaded under `<project>/datasheets/` (downloads are owned by distributor skills like `digikey-search`, `mouser-search`, `lcsc-search`, `element14-search`).

## Scope

This skill owns:
- **Extraction schema** — the canonical JSON structure for per-MPN specs. Versioned via `EXTRACTION_VERSION` in `scripts/datasheet_extract_cache.py`.
- **PDF page selection** — heuristics to pick pages most likely to contain pinouts, e-chars, applications, SPICE models.
- **Quality scoring** — weighted rubric (pin coverage, voltage ratings, application info, electrical chars, SPICE specs).
- **Consumer API** — helpers in `scripts/datasheet_features.py` for other skills to query specific fields (e.g., `get_regulator_features(mpn)`, `get_mcu_features(mpn)`).
- **Verification** — consistency checks between extracted data and schematic/PCB usage.

## Non-goals

- **No PDF downloading.** That is owned by distributor skills (`digikey-search`, `mouser-search`, `lcsc-search`, `element14-search`).
- **No global library.** Each project's extractions live in `<project>/datasheets/extracted/`. There is no shared cross-project cache.

## Cache location

```
<project>/
  design.kicad_sch
  datasheets/
    TPS61023DRLR.pdf        # downloaded by distributor skills
    extracted/
      manifest.json         # extraction manifest (legacy name: index.json)
      TPS61023DRLR.json     # structured extraction (this skill's output)
```

## Reference guides

- `references/extraction-schema.md` — canonical schema, every field defined
- `references/field-extraction-guide.md` — how to find each field in datasheets from common vendors (TI, ST, NXP, Espressif, Microchip)
- `references/quality-scoring.md` — rubric details, score thresholds
- `references/consumer-api.md` — how kicad/emc/spice/thermal consume extractions

## Entry-point scripts

- `scripts/datasheet_extract_cache.py` — cache manager, resolver, indexer
- `scripts/datasheet_page_selector.py` — page selection heuristics
- `scripts/datasheet_score.py` — extraction quality scoring
- `scripts/datasheet_verify.py` — cross-check extraction vs schematic usage
- `scripts/datasheet_features.py` — consumer helper API (new in v1.3)

## Extraction workflow

1. User runs an analyzer or requests extraction.
2. This skill checks the cache (`<project>/datasheets/extracted/<MPN>.json`).
3. On cache miss / stale / low score: Claude reads selected PDF pages and extracts structured data.
3.5. **Source-grounding gate (M8 — SCRIPT-ENFORCED, run before scoring/caching).** This skill is the trust
   anchor for the whole EE chain — a hallucinated pin/Vref/Vmax here silently poisons kicad-analyze,
   emc-precheck, spice-sim, and bom. Quality scoring measures COVERAGE, not correctness, and
   `datasheet_verify.py` only cross-checks against schematic USAGE — neither checks the **source PDF**.
   Gate every extracted field against the datasheet's own text, deterministically:
   1. Get the source text with **MinerU** (NOT `pdftotext` — datasheet specs live in TABLES/figures that a
      flat text layer mangles or drops). Run nord-web's reader once:
      `bash <nord-web>/bin/nw doc <datasheet.pdf>` → markdown under `./mineru-out/<name>/`.
   2. Run the verifier: `python scripts/datasheet_source_verify.py <MPN>.json --markdown <mineru.md> --write`.
      It substring/numeric-matches each critical field (pin names, Vmax/Vmin/Vref, application caps) against
      the MinerU markdown and stamps an `evidence` grade per field + a `meta.source_grounding` summary.
      Exit 1 if any field is `conflicts`.
   - **explicit** = value found in the markdown. **conflicts** = markdown present but value NOT found →
     likely hallucination OR a table-extraction miss → FLAGGED (exit 1), a human/LLM eyeballs it vs the PDF
     page; never auto-dropped. **source_unavailable** = MinerU produced no usable text (scanned image-only
     PDF) → FLAG, do **not** treat as verified and do **not** drop (a correct extraction false-negated by a
     bad scan must not vanish — a respin from a missing pin is worse than a flagged uncertainty).
   - Keep `conflicts` (checked & wrong) distinct from `source_unavailable` (couldn't check) — the script
     already separates them and so must the report.
4. Extraction is scored from the per-field grades (below); if score ≥ 6.0, cached. The M8 gate is a prior
   correctness check — fields graded `conflicts` are dropped/flagged and earn NO coverage credit, so a high
   score on hallucinated fields cannot pass.
5. Consumers query via `datasheet_features.py`.

## Per-field evidence grade (anchor — tied to what the datasheet says, NOT a vibe)

Every extracted field carries `"evidence"` = one of these concrete states. The grade is decided by the
datasheet text, with the exact citation:

| grade | meaning — what the datasheet actually shows | example (store value + cite) |
|---|---|---|
| `explicit` | exact value + units stated in a spec table / labeled pinout / typical-application figure | `Vref = 1.229 V` (Electrical Char. table, p.6) · `pin 3 = GND` (pinout, p.1) · `Cin = 10 µF X5R required` (Typical App, p.12) · "12 V @ 30 mA out with 100 µF cap" stated in the app circuit |
| `conditional` | stated but as a **range / min-typ-max / condition-dependent**, no single fixed value | `Iq = 5–18 µA (typ 8 µA over temp)` · `Vout adjustable 0.8–5.5 V via divider` |
| `derived` | NOT stated directly; computed from other stated values/a datasheet formula | `Vout ≈ 12 V` derived from `Vref·(1+R1/R2)` with R's read from the app circuit — mark it derived, not explicit |
| `not_mentioned` | field simply absent from the datasheet → **omit / null, never guess** | (no thermal-pad spec on this part) → field omitted |
| `conflicts` | extracted value does NOT substring-match the cited page (likely hallucination) | drop or flag; earns no score |
| `source_unavailable` | the relevant page is a scan / garbled / unreadable text layer | flag, keep for re-extraction; earns no score |

Report uses the grade verbatim so a consumer sees "Vref 1.229 V (explicit, p.6)" vs "Vout ~12 V (derived)"
vs "thermal limit (not_mentioned)" — never a bare number with unknown provenance.

## Coverage score 0–10 (aggregate of the grades above)

The score is COVERAGE, computed from how many critical fields reached a trustworthy grade — NOT a
correctness measure (correctness is the per-field grade itself). Critical fields = pinout, abs-max +
key electrical (V/I/Vref), topology/application values, SPICE-relevant params.

- Each critical field: `explicit` = full credit, `conditional`/`derived` = half credit, `not_mentioned`
  = no credit (real gap), `conflicts`/`source_unavailable` = no credit (untrusted).
- **9–10** — nearly all critical fields `explicit`; the part is fully characterised from the datasheet.
- **6–7 (cache floor)** — core pinout + key ratings `explicit`; the rest `conditional`/`derived`/missing.
- **4–6** — major sections `not_mentioned` or only `derived`. Below floor → re-extract more pages first.
- **0–4** — near-empty / mostly `source_unavailable`. Don't cache; fall back to heuristics and say so.

## When to trigger this skill

- **Immediately after downloading datasheets** via `sync_datasheets_digikey.py`, `sync_datasheets_lcsc.py`, or equivalent. Without extraction, IC-aware checks (VM-001 rail voltage, PS-001 power-good, PR-004 USB, DP-002 USB speed classification) fall back to heuristics on unknown ICs.
- **Before running analyzers on a new project** where datasheets are present but `datasheets/extracted/` is empty — the analyzers won't produce the extractions themselves.
- **When a review flags low trust level** due to missing manufacturer evidence: extracting the ICs referenced by power regulators, MCUs, and high-speed peripherals typically flips `trust_level: low` → `mixed` or `high`.
- **When a user asks for pin verification** ("verify U1 pin names match datasheet") — this skill's cached extraction is the authoritative source.
