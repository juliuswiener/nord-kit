# nord-web

Local-first, data-sovereign web-data layer for Claude Code. Picks the right **read paradigm**
per URL/file and pulls content on-device — no external API, content never leaves the machine.

## Skills

| Skill | Job | Engine |
|---|---|---|
| `read-router` | classify each input, hand off to the right reader | (router, no fetch) |
| `web-scrape` | web page → clean markdown | Crawl4AI (local) + optional stealth |
| `pdf-extract` | PDF/Office/scanned → markdown + tables | MinerU (torch-ROCm, AMD GPU) |
| `visual-read` | render to images when layout IS the meaning | pixelrag `pixelshot` |

Cost order: text markdown (scrape/doc) ≪ pixel. Default to text; escalate to stealth or pixel
lazily, only when the cheap rung returns empty or layout-bound meaning is lost.

## Tools (local venvs)

Skills call `bin/nw`, a dispatcher over three venvs in `$NORD_WEB_TOOLS`
(default `~/02_Software/nord-web-tools`):

```bash
bin/nw scrape <url> [--stealth] [--out f] [--raw]   # Crawl4AI → markdown
bin/nw doc    <pdf>  [outdir]                        # MinerU → markdown (GPU)
bin/nw pixel  <url|pdf|html> [outdir]                # pixelshot → JPEG tiles
bin/nw doctor                                        # venv health
```

## Setup (per device)

```bash
bash bin/setup.sh            # crawl4ai + mineru(ROCm) + pixelrag
bash bin/setup.sh --stealth  # also invisible_playwright (patched-Firefox stealth backend)
```

Requirements: `uv`; AMD ROCm stack for GPU MinerU (torch wheel index `rocm7.2`, gfx1030 uses
`HSA_OVERRIDE_GFX_VERSION=10.3.0`, set automatically by `nw doc`). Crawl4AI needs a Playwright
chromium (`playwright install chromium` if `crawl4ai-setup` skips it). pixelrag PDF rendering needs
`pdf2image` + system `poppler`.

## Sovereignty

Sensitive material (legal/tax/client/internal): use only `web-scrape` (incl. `--stealth`) and
`pdf-extract` / `visual-read` — all fully on-device. Never route sensitive inputs to an external
scrape/search API. Firecrawl/external is a non-sensitive last-resort fallback only.

## Not installed (by design)

- Full PixelRAG GPU+FAISS index (217 GB) — only the lightweight `pixelshot` renderer is used.
- Unlimited-OCR — deferred; MinerU covers document OCR.
- Bulk social scrapers (Agent-Reach etc.) — ToS-gray, out of scope.
