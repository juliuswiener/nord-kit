"""Source-grounding verifier for datasheet extractions (M8, script-enforced).

Stamps a deterministic provenance `evidence` grade onto each extracted field by
substring-matching it against the datasheet's OWN text — closing the gap that
`datasheet_verify.py` leaves (that one checks extraction-vs-schematic-usage; this
checks extraction-vs-SOURCE-PDF).

Source text MUST be MinerU markdown, not `pdftotext`: datasheet specs live in
TABLES and figures that a flat text layer mangles or drops. The caller produces
it once via nord-web:  `bash <nord-web>/bin/nw doc <datasheet.pdf>`  → markdown
under ./mineru-out/<name>/, then passes that markdown path here. This script is
pure text-matching (no subprocess, no GPU) so it is fast and unit-testable.

Grades (canonical vocab — see nord BEHAVIOUR.md):
  explicit          field value found verbatim (normalized) in the MinerU markdown
  conflicts         markdown present but the value is NOT found — a likely
                    hallucination OR a table-extraction miss; FLAGGED for review,
                    never silently dropped (distinct from source_unavailable)
  source_unavailable markdown empty/missing (scanned image-only PDF, MinerU failed)
                    — couldn't check; this is INCOMPLETE, not a refutation

Usage:
  python datasheet_source_verify.py <extraction.json> --markdown <mineru.md> [--write]
  python datasheet_source_verify.py <extraction.json> --markdown <mineru.md> --json
"""

import argparse
import json
import re
import sys


def _norm(s):
    """Normalize for substring matching: lowercase, collapse whitespace, unify
    common unit glyphs, drop separators that vary between datasheet and extraction."""
    s = str(s).lower()
    s = s.replace("µ", "u").replace("μ", "u")   # µ / μ -> u
    s = s.replace("Ω", "ohm").replace("Ω", "ohm")  # Ω -> ohm
    s = s.replace("–", "-").replace("—", "-")    # en/em dash -> -
    s = re.sub(r"\s+", "", s)
    return s


def _num_variants(val):
    """For a numeric value, yield string forms a datasheet might use:
    '1.2', '1.20', '12' (and the bare digits) so 1.2 matches '1.2 V' / '1.20V'."""
    out = set()
    m = re.search(r"-?\d+\.?\d*", str(val))
    if not m:
        return out
    num = m.group(0)
    out.add(num)
    if "." in num:
        out.add(num.rstrip("0").rstrip("."))   # 1.20 -> 1.2
    else:
        out.add(num + ".0")
    return out


def _found(value, hay_norm):
    """Is `value` present in the normalized markdown? Try the whole normalized
    token, then numeric variants. Returns True/False. Empty/None values are
    not checkable -> caller treats as not_mentioned."""
    if value is None or value == "":
        return None
    v = _norm(value)
    if len(v) >= 2 and v in hay_norm:
        return True
    # numeric fallback (values like 1.229, 3.3, 100 that carry units in the PDF)
    for nv in _num_variants(value):
        if nv and _norm(nv) in hay_norm:
            return True
    return False


# Fields graded per extraction, with how to pull the value(s) out.
def _critical_claims(extraction):
    """Yield (path, value) for every critical field worth source-grounding."""
    for p in extraction.get("pins", []) or []:
        num = p.get("number", "?")
        if p.get("name"):
            yield (f"pin[{num}].name", p["name"])
        for k in ("voltage_abs_max", "voltage_operating_max", "voltage_operating_min"):
            if p.get(k) is not None:
                yield (f"pin[{num}].{k}", p[k])
    ec = extraction.get("electrical", {}) or extraction.get("electrical_characteristics", {}) or {}
    for k, v in ec.items():
        if isinstance(v, (str, int, float)) and v not in (None, ""):
            yield (f"electrical.{k}", v)
    app = extraction.get("application_circuit", {}) or {}
    for k in ("input_cap_recommended", "output_cap_recommended", "decoupling_cap", "vref", "vref_V"):
        if app.get(k):
            yield (f"application_circuit.{k}", app[k])
    # top-level vref if present
    for k in ("vref", "vref_V", "reference_voltage"):
        if extraction.get(k) is not None:
            yield (f"{k}", extraction[k])


def grade_extraction(extraction, markdown):
    """Return {claims:[{path,value,evidence,found}], summary:{...}}.

    markdown empty -> every checkable claim is source_unavailable (couldn't check).
    """
    text_norm = _norm(markdown or "")
    have_source = len(text_norm) >= 50   # MinerU produced real text, not a blank/failed run
    claims = []
    counts = {"explicit": 0, "conflicts": 0, "source_unavailable": 0, "not_mentioned": 0}
    for path, value in _critical_claims(extraction):
        if not have_source:
            grade = "source_unavailable"
        else:
            f = _found(value, text_norm)
            if f is None:
                grade = "not_mentioned"
            elif f:
                grade = "explicit"
            else:
                grade = "conflicts"   # value not in an available source -> flag (review)
        counts[grade] = counts.get(grade, 0) + 1
        claims.append({"path": path, "value": value, "evidence": grade})
    return {
        "claims": claims,
        "summary": {
            "source": "mineru_markdown" if have_source else "unavailable",
            "total": len(claims),
            **counts,
            # conflicts are auto-flagged: could be hallucination OR a table-extraction
            # miss — a human/LLM should eyeball them against the PDF page, never auto-drop.
            "note": ("source_unavailable: MinerU produced no usable text (scanned PDF?) — "
                     "re-run `nw doc` or flag the extraction, do NOT treat as verified"
                     if not have_source else
                     "conflicts are auto-flags (verify vs the PDF table; may be a MinerU miss)"),
        },
    }


def _apply_grades(extraction, result):
    """Write the evidence grade back onto the matching fields in-place (best-effort)."""
    by_path = {c["path"]: c["evidence"] for c in result["claims"]}
    for p in extraction.get("pins", []) or []:
        num = p.get("number", "?")
        if f"pin[{num}].name" in by_path:
            p["name_evidence"] = by_path[f"pin[{num}].name"]
    # coarse: stamp an overall source-grounding block on meta
    meta = extraction.setdefault("meta", {})
    meta["source_grounding"] = result["summary"]
    return extraction


def main():
    ap = argparse.ArgumentParser(description="Source-ground a datasheet extraction against MinerU markdown")
    ap.add_argument("extraction", help="path to <MPN>.json extraction")
    ap.add_argument("--markdown", required=True, help="path to MinerU markdown (from `nw doc <pdf>`)")
    ap.add_argument("--write", action="store_true", help="write grades back into the extraction JSON")
    ap.add_argument("--json", action="store_true", help="emit the full result as JSON")
    args = ap.parse_args()

    with open(args.extraction) as f:
        extraction = json.load(f)
    try:
        with open(args.markdown, encoding="utf-8", errors="replace") as f:
            markdown = f.read()
    except OSError:
        markdown = ""

    result = grade_extraction(extraction, markdown)

    if args.write:
        _apply_grades(extraction, result)
        with open(args.extraction, "w") as f:
            json.dump(extraction, f, indent=2)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        s = result["summary"]
        print(f"source={s['source']}  total={s['total']}  "
              f"explicit={s['explicit']}  conflicts={s['conflicts']}  "
              f"source_unavailable={s['source_unavailable']}  not_mentioned={s['not_mentioned']}")
        for c in result["claims"]:
            if c["evidence"] in ("conflicts", "source_unavailable"):
                print(f"  [{c['evidence']}] {c['path']} = {c['value']!r}")
        print("  " + s["note"])
    # exit non-zero if any conflict (a CI/gate can key off it)
    sys.exit(1 if result["summary"]["conflicts"] else 0)


if __name__ == "__main__":
    main()
