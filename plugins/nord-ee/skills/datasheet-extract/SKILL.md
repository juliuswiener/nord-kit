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
3.5. **Source-grounding gate (M8 — run before scoring/caching).** This skill is the trust anchor for the
   whole EE chain — a hallucinated pin/Vref/Vmax here silently poisons kicad-analyze, emc-precheck,
   spice-sim, and bom. Quality scoring measures COVERAGE, not correctness, and `datasheet_verify.py` only
   cross-checks against schematic USAGE — neither checks the **source PDF**. So gate each extracted field
   against the page it claims to come from:
   - For every critical field (pin N = name/function, Vmax/Vmin/Vref, key application/topology values),
     substring/near-match the value (and ideally the pin name or parameter symbol) against the extracted
     text of the cited PDF page (`pdftotext -f <page> -l <page>` / the MinerU text, not from memory).
   - **Match** → keep the field. **No match** → the field is a likely hallucination: drop it OR mark it
     `"verified": false` so consumers can down-weight it; never cache an unmatched field as authoritative.
   - **Source unavailable** (scanned/garbled PDF, lossy extraction) → mark the field
     `"verified": "source_unavailable"` and FLAG, do **not** drop — a correct extraction false-negated by a
     bad text layer must not vanish (a respin caused by a missing pin is worse than a flagged uncertainty).
     Distinguish "refuted by source" from "source unavailable".
4. Extraction is scored; if score ≥ 6.0, cached. (Score = coverage. The M8 gate is a separate, prior
   correctness check — a high coverage score on hallucinated fields must NOT pass.)
5. Consumers query via `datasheet_features.py`.

## Quality score scale (anchor — what the number means)

The 0–10 quality score is a COVERAGE measure (how complete the extraction is), not a correctness measure
(M8 above gates correctness). Anchored bands:

- **9–10** — pinout + electrical chars + application/topology + SPICE-relevant params all present and
  source-grounded. Full-trust extraction.
- **7–9** — pinout + electrical chars present; some application/SPICE detail missing. Solid for most checks.
- **6–7 (cache floor)** — core pinout + key ratings present; partial elsewhere. Usable, flag the gaps.
- **4–6** — sparse; major sections missing. Below cache floor → re-extract more pages before relying on it.
- **0–4** — near-empty / failed extraction. Do not cache; fall back to heuristics and say so.

A field that fails the M8 source-grounding gate does not earn coverage credit — correctness gates score.

## When to trigger this skill

- **Immediately after downloading datasheets** via `sync_datasheets_digikey.py`, `sync_datasheets_lcsc.py`, or equivalent. Without extraction, IC-aware checks (VM-001 rail voltage, PS-001 power-good, PR-004 USB, DP-002 USB speed classification) fall back to heuristics on unknown ICs.
- **Before running analyzers on a new project** where datasheets are present but `datasheets/extracted/` is empty — the analyzers won't produce the extractions themselves.
- **When a review flags low trust level** due to missing manufacturer evidence: extracting the ICs referenced by power regulators, MCUs, and high-speed peripherals typically flips `trust_level: low` → `mixed` or `high`.
- **When a user asks for pin verification** ("verify U1 pin names match datasheet") — this skill's cached extraction is the authoritative source.
