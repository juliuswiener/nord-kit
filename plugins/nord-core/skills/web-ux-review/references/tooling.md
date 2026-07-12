# Deterministic a11y tool gate — commands

Run at least one machine checker against a rendered page before the pipeline; feed its output into the
workflow as `args.toolFindings` (those findings get `toolVerified:true` and bypass adversarial verify).
Local-first, no account needed — all run via `npx` (Node) with a headless Chromium the tools fetch on
first use. Pick by what's installed; **axe-core is the default** (best signal-to-noise).

## Get a rendered page first (for URL or local source)

- **Live/staging URL** — use it directly with the tools below.
- **Local dev server** — start it, then point the tools at `http://localhost:<port>`.
- **Static HTML file** — serve it: `npx --yes http-server <dir> -p 8080` (or `python3 -m http.server 8080`),
  then target `http://localhost:8080/<file>`.
- **Behind auth / needs a real browser session** — drive it with `nord-web:visual-read` / Claude-in-Chrome
  to reach the page, or run axe via a Puppeteer snippet after login.

## axe-core (default)

```bash
# whole page, JSON report
npx --yes @axe-core/cli <URL> --exit --save axe.json
# scope to a region / stricter tags
npx --yes @axe-core/cli <URL> --tags wcag2a,wcag2aa,wcag21aa,wcag22aa
```

Parse `axe.json` → each `violations[]` entry gives `id`, `impact` (critical/serious/moderate/minor),
`help`, `helpUrl`, and `nodes[].target` (CSS selector) + `nodes[].failureSummary`. Map `impact`→severity,
put the selector in `where`, and the WCAG SC from the rule's tags into `wcagSC`.

## pa11y (alternative / second opinion)

```bash
npx --yes pa11y <URL> --standard WCAG2AA --reporter json > pa11y.json
# runner axe + htmlcs together:
npx --yes pa11y <URL> --runner axe --runner htmlcs --reporter json > pa11y.json
```

Each result: `code` (the WCAG SC, e.g. `WCAG2AA.Principle1.Guideline1_4.1_4_3...`), `type`
(error/warning), `selector`, `context`, `message`.

## Lighthouse (accessibility category + Core Web Vitals context)

```bash
npx --yes lighthouse <URL> --only-categories=accessibility \
  --output=json --output-path=lh.json --chrome-flags="--headless"
```

`lh.json` → `categories.accessibility.score` (0–1) + `audits[]` (each failing audit has a `title`,
`description`, and `details.items` with node selectors). Good for a single conformance-score anchor;
axe/pa11y give finer per-node findings.

## Contrast (when a tool disagrees or you need a specific pair)

Measure the exact ratio for a reported pair rather than eyeballing:

```bash
# ratio of two hex colours (foreground, background); prints WCAG pass/fail
npx --yes wcag-contrast-cli "#333333" "#767676"
```

Ratio ≥ 4.5 → normal text passes AA; ≥ 3 → large text / UI component passes. A measured ratio is a
`toolVerified:true` fact.

## Rendered tiles for the visual / plain-language / hierarchy lenses

```bash
# nord-web visual-read → tiled JPEGs of the actual page; Read them, pass paths as args.tiles
bash "$CLAUDE_PLUGIN_ROOT/../nord-web/bin/nw" pixel <URL> ./ux-tiles
```

(Or invoke the `nord-web:visual-read` skill.) The visual lenses need to SEE the page; source-only reviews
skip them and report `not_assessable (no rendered page)`.

## Keyboard / screen-reader passes (not fully automatable)

No CLI proves keyboard-operability or SR output end-to-end. For a live URL, drive a Tab-through with
Claude-in-Chrome (observe focus ring + order + traps) and note it as `checked:confirmed` when inspected,
`coverage_gap` when you could only static-analyse. Do not claim keyboard conformance you didn't exercise.

## Degradation rule

If none of the tools can run (no Node, no renderable page, offline): say so explicitly, mark the
machine-checkable criteria as `coverage_gap (tool absent)`, and let the lens agents static-analyse the
source with `toolVerified:false`. A gate that didn't run is never reported as a pass.
