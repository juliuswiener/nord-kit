---
name: pixel-read
description: "Render a web page or document to images (tiled JPEGs) so Claude can SEE layout that text extraction loses — charts, infographics, scanned forms, complex tables, visual diffs. Triggers on: 'look at this chart/figure', 'what does this dashboard show', 'read this scanned form', 'the layout matters', or when read-router / web-scrape / doc-extract flag that the meaning is visual. Local (pixelrag pixelshot), no backend. EXPENSIVE in tokens — use only when layout IS the information, not as a default reader."
argument-hint: "<url|pdf|html> [outdir]"
---

# pixel-read — render to images, give Claude eyes

Renders a URL, PDF, or HTML file to tiled JPEGs with pixelrag's `pixelshot`, then Claude reads the
images directly. Use when the **layout itself carries information** that text extraction destroys.
This is the costly reader — many× the tokens of markdown — so it is the exception, not the default.

Tool entrypoint:

```bash
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" pixel <url|pdf|html>           # → ./pixel-tiles/... JPEGs (paths printed)
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" pixel <url|pdf> <outdir>       # custom output dir
```

It prints the produced tile paths. **Read those JPEGs** (Read tool) to see the page.

## Use ONLY when layout is the meaning

| Input | pixel-read? |
|---|---|
| chart / infographic / data-viz where the figure is the point | **yes** |
| scanned form whose spatial arrangement = the data | **yes** |
| complex table that linearizes wrong in text | **yes** (that page) |
| visual diff / "does this render correctly" | **yes** |
| prose article, normal PDF, statement, paper | **no** → web-scrape / doc-extract |

## Rules

- **Text-first, always.** Try web-scrape (page) or doc-extract (document) first. Escalate to
  pixel-read only when the text result is demonstrably missing layout-bound meaning — never as the
  opening move, never "to be safe".
- **Scope the render.** Pixel cost scales with page count/size. Render only the page(s) that need
  eyes, not a whole document, when you can target them.
- **Local, no index.** This uses the lightweight `pixelshot` renderer only — not the full PixelRAG
  GPU+FAISS index (intentionally not installed; 217GB, out of scope). On-device, safe for sensitive
  inputs.
- **`--wait-network-idle` is on** by default in `nw pixel` (helps JS/SPA pages finish loading).

## When NOT to use

- Normal page → **web-scrape**. Normal/text PDF → **doc-extract**. Don't pay pixel tokens for
  content that markdown captures faithfully.
