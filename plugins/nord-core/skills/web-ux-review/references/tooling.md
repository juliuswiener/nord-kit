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

**Authenticated / SPA routes** (real citizen portals are behind login) — `@axe-core/cli` can't log in.
Drive axe through a real browser session instead: log in via Claude-in-Chrome (or Playwright), then inject
axe and collect results. Same violations JSON, but on the actual authenticated page:

```js
// after navigating + logging in with the browser:
//   inject https://cdn.jsdelivr.net/npm/axe-core/axe.min.js, then
await window.axe.run(document, { runOnly: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] })
```

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

## Browser-driven checks — the "beyond axe" gate (Claude-in-Chrome / Playwright)

axe/pa11y catch only ~30–40% of WCAG failures. The rest are widely believed "manual" but are in fact
**scriptable through a real browser** — drive them with Claude-in-Chrome (preferred; already available) or
Playwright MCP. Each result is `checked:confirmed`/`refuted` (interaction-verified), NOT a coverage gap.
(Technique grafted from the open-source `benry-products/wcag-auditor` manual-check procedures and
`masuP9/a11y-specialist-skills` Playwright detectors.)

| SC | Procedure (navigate first, then:) |
|---|---|
| **2.1.1 / 2.1.2 Keyboard, no trap (A)** | `Tab`/`Shift+Tab`/`Enter`/`Esc`/arrows through the page; every control reachable + operable; focus can always leave (modals, date-pickers, embeds). |
| **2.4.3 Focus Order (A)** | log `document.activeElement` after each Tab; order matches visual/logical flow. |
| **2.4.7 Focus Visible (AA)** + **2.4.11 Focus Not Obscured (AA)** | after each Tab, check the focused element has a visible indicator (computed outline/box-shadow) and isn't hidden behind a sticky header/footer (`getBoundingClientRect` vs viewport). |
| **1.4.10 Reflow (AA)** | resize viewport to 320 CSS px; assert no horizontal scroll / clipped content (`scrollWidth <= clientWidth`). |
| **1.4.4 Resize Text (AA)** | zoom to 200%; content + function intact, nothing clipped. |
| **1.4.12 Text Spacing (AA)** | inject the WCAG spacing override CSS (line 1.5×, letter .12em, word .16em, para 2×); assert no clipping/overlap. |
| **2.5.8 Target Size (AA)** | `getBoundingClientRect` on interactive elements ≥ 24×24 px (or adequate spacing). |
| **1.3.4 Orientation (AA)** | resize to portrait AND landscape; no lock, no loss. |
| **1.4.13 Content on Hover/Focus (AA)** | hover a tooltip trigger; popup is dismissible (Esc), hoverable, persistent. |
| **1.3.5 Identify Input Purpose (AA)** | `browser_evaluate` autocomplete attrs on name/email/address fields. |
| **4.1.3 Status Messages (AA)** | trigger a validation/toast; assert an `aria-live`/`role=status` region announces it without moving focus. |
| **1.3.2 Meaningful Sequence (A)** | compare accessibility-tree order vs screenshot; flag CSS (`order`, `row-reverse`, grid placement) that reorders visually but not in DOM. |

Screen-reader *output* quality (does the announced name make sense) still needs human ears — note those as
`coverage_gap (SR listening required)`, don't claim what you didn't hear.

## Multi-page / whole-portal scope

Reviewing one page ≠ auditing a service. For a portal, enumerate pages first (fetch `sitemap.xml`, or crawl
the main nav + footer + the primary task flow), then run the gate per page and report per-page + rolled-up.
The Barrierefreiheitserklärung applies site-wide, so check it once.

## Degradation rule

If none of the tools can run (no Node, no browser, no renderable page, offline): say so explicitly, mark the
machine-checkable criteria as `coverage_gap (tool absent)`, and let the lens agents static-analyse the
source with `toolVerified:false`. A gate that didn't run is never reported as a pass.
