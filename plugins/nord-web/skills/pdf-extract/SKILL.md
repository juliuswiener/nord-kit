---
name: pdf-extract
description: "Convert a PDF / Office / scanned document to LLM-ready markdown locally via MinerU (GPU-accelerated on ROCm). Triggers on: 'read this PDF', 'extract from <file>.pdf', 'parse this document', 'get the tables out of', 'OCR this', after read-router picks a text+tables document. Output is TEXT (cheap downstream) — the default document reader, preferred over pixel-read whenever the document is mostly text and tables. Runs on-device; documents never leave the machine."
argument-hint: "<file.pdf|docx|...> [outdir]"
---

# doc-extract — document → markdown (MinerU, local GPU)

Converts PDFs and Office/scanned documents to clean markdown + extracted tables using MinerU on
this machine (torch-ROCm, AMD GPU). Output is **text**, so it's cheap in the model context — this
is the default document reader. Reach for pixel-read only when layout itself carries the meaning.

Tool entrypoint:

```bash
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" doc <file.pdf>             # → ./mineru-out/<name>/... markdown
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" doc <file.pdf> <outdir>    # custom output dir
```

After it runs, read the produced `*.md` under the output dir. MinerU also writes extracted tables
and a content-list JSON alongside the markdown.

## Why text-first (the token argument)

MinerU emits markdown; pixel-read holds pixels. A screenshot in context costs many× the tokens of
the same content as markdown. So for the typical document — reports, contracts, statements,
papers: mostly prose + tables — MinerU is both cheaper and more faithful. Default here; escalate to
pixel-read only for the layout-bound minority.

## When to use vs pixel-read

| Document is… | Reader |
|---|---|
| prose, tables, statements, papers, contracts | **doc-extract** (text, cheap) |
| charts/infographics where the figure is the point | **pixel-read** |
| scanned form whose spatial layout = data | **pixel-read** |
| scanned text pages (no layout meaning) | **doc-extract** (MinerU OCRs) |

## Rules

- **Text-first.** Don't pixel-read a document that MinerU parses cleanly. Check the markdown first.
- **GPU.** Runs on the AMD GPU via torch-ROCm; `nw` sets `HSA_OVERRIDE_GFX_VERSION=10.3.0` and
  `MINERU_DEVICE_MODE=cuda` (torch-ROCm presents as cuda). First run downloads MinerU models.
- **On-device.** Documents are never uploaded. Safe for sensitive/legal/tax/client PDFs.
- **Verify extraction.** Tables and multi-column PDFs are where parsers fail — spot-check the
  markdown against the source for the columns/figures you actually need before trusting it. If a
  critical table linearized wrong, escalate that page to pixel-read.

## When NOT to use

- A web page (HTML) → **web-scrape**.
- Pure chart/figure/visual-layout input → **pixel-read**.
