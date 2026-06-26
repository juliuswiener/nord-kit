---
name: read-router
description: "Pick the right web-data READ paradigm per URL or file before fetching — never default to one tool for everything. Triggers on: 'scrape this', 'read this page/PDF', 'extract from <url>', 'get the data from', 'pull this document', 'what does this site say', or any time content must be pulled from a web URL or a document file. Routes to web-scrape (HTML→markdown, local), doc-extract (PDF/Office→markdown, local GPU), pixel-read (visual/layout→images), or search (external-context/exa) when the URL is unknown. Local-first and data-sovereign by default."
argument-hint: "<url | file | intent>"
---

# read-router — choose the read paradigm per input

"Get web data" is not one task. Picking the wrong reader is the most common and most
expensive mistake: a screenshot in context costs many times the tokens of clean markdown,
and an HTML parser can throw away 40%+ of the recoverable text. Decide per input, then call
exactly one reader. Do not pipe everything through the same tool.

This skill is a **router**: it classifies the input and hands off. It does not fetch itself.

---

## Decision tree (classify, then hand off)

```
INPUT
  │
  ├─ No URL yet — need to FIND sources?
  │     → search first: external-context (web) or exa (mcp). Then re-enter with the URLs.
  │
  ├─ Document file (PDF / Office / scanned)?
  │     ├─ mostly text + tables        → doc-extract   (MinerU → markdown, CHEAP)
  │     └─ layout carries meaning       → pixel-read    (charts/forms/scans, images, costly)
  │
  ├─ Web page (URL)?
  │     ├─ normal page                  → web-scrape           (Crawl4AI local, free)
  │     ├─ anti-bot / login / heavy JS  → web-scrape --stealth (on-device stealth)
  │     └─ layout/chart IS the content  → pixel-read           (render to image)
  │
  └─ Social platform (X / Reddit / YT / GitHub thread)?
        → native tools / WebFetch. (No bulk social-scraper wired; ToS-gray, out of scope.)
```

## Cost order — prefer the cheapest reader that captures the information

1. **Text markdown** (web-scrape, doc-extract) — cheapest. Default for prose, articles, docs, tables.
2. **Stealth text** (web-scrape --stealth) — same token cost, slower; only when the normal fetch is blocked/empty.
3. **Pixel** (pixel-read) — many× the tokens. ONLY when the layout itself is the information:
   charts, infographics, scanned forms, complex tables that linearize wrong, visual diffs.

Rule: never reach for pixel-read because text *might* be incomplete. Try text first; escalate to
pixel only when the text result is demonstrably missing layout-bound meaning.

## Sovereignty rule (load-bearing)

For sensitive material (legal, tax, client, internal): query and content **must not leave the
device**. Use only the local readers — web-scrape (incl. --stealth) and doc-extract run fully
on-device. Do NOT route sensitive inputs to any external scrape/search API. If discovery needs
an API for sensitive work, prefer an EU-resident one and flag it to the user first.

## Handoff fan-out (multiple inputs)

Given N URLs/files, classify each, then read them **in parallel** (one Bash call per input, or a
batch) — discovery and read should never be a sequential loop. Escalate the expensive paradigm
(stealth, pixel) lazily, per input, only when the cheap one returns empty.

## Tool discipline

Keep ≤3–5 active tools per task. Pick ONE reader per input from the tree above; do not mount every
reader "just in case". Naming the reader up front is the whole point of this router.

## What this skill outputs

A one-line routing decision per input, then the actual handoff call(s), e.g.:

```
report.pdf       → doc-extract   (text+tables)
dashboard.png    → pixel-read    (chart layout)
https://news/... → web-scrape    (normal article)
https://portal/  → web-scrape --stealth (login wall)
```

Then invoke the chosen reader(s). The reader skills own the actual fetch and the exact `nw` command.
