---
name: web-scrape
description: "Fetch a web page to clean markdown locally via Crawl4AI — no external API, no per-request cost, content never leaves the device. Triggers on: 'scrape <url>', 'get the text/content of this page', 'read this website', 'extract the article', after read-router picks a normal or anti-bot web page. Default for ~90% of pages. Use --stealth for anti-bot/login/heavy-JS sites. Firecrawl (external) is only a last-resort fallback for the rare page local can't crack."
argument-hint: "<url> [--stealth]"
---

# web-scrape — local-first page → markdown

Pulls a URL to clean markdown with Crawl4AI running on this machine. Free, no API key, the page
content never leaves the device. This is the default reader for normal web pages.

Tool entrypoint (dispatcher over the local venv):

```bash
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" scrape <url>             # plain → auto-escalates to stealth if blocked
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" scrape <url> --stealth   # force stealth (skip plain): known anti-bot/login
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" scrape <url> --no-escalate  # plain only, never retry stealth
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" scrape <url> --out page.md   # write to file instead of stdout
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" scrape <url> --raw       # full markdown (default = pruned main content)
```

## Escalation ladder (auto — cheapest rung that works)

```
1. nw scrape <url>            ← plain Crawl4AI, free, ~90% of pages
   └─ result empty or a bot-wall ("just a moment", "enable JavaScript", captcha, cloudflare…)?
2.    → AUTO-retries once with --stealth   ← invisible_playwright patched Firefox, on-device
3. STILL blocked + non-sensitive?          ← only then consider Firecrawl MCP (external, credits)
4. sensitive material?                      ← stays at rung 2. Never send it to an external API.
```

`nw scrape` does rungs 1→2 automatically: plain first, and only if the result looks blocked/empty
does it fetch again with stealth. So **just call `scrape`** — you don't decide per page. Use
`--stealth` only to skip straight to stealth on a known-hard site (saves the failed plain attempt);
use `--no-escalate` to forbid the stealth retry. Never start at Firecrawl prophylactically.

## Rules

- **Just call `scrape`.** It auto-escalates plain→stealth on a block/empty result, so you don't
  pick per page. Pass `--stealth` only to skip the failed plain attempt on a known-hard site;
  `--no-escalate` to forbid the retry. `--stealth` is slower (full Firefox), so it's not the default.
- **Sensitive content stays local.** Legal/tax/client/internal URLs: rungs 1–2 only. Firecrawl and
  any external scrape API are forbidden for these — the whole point of the local stack.
- **Parallelize multiple URLs.** One `nw scrape` per URL, fired together — not a sequential loop.
- **Still empty after auto-escalation?** Don't return a bot wall as if it were content — say it was
  blocked, then (non-sensitive only) consider Firecrawl, or read-router → pixel-read.
- **Markdown is cheap; keep it.** Don't screenshot a page that scraped fine. Pixel-read is for
  layout-bound content only (see pixel-read).

## When NOT to use

- PDF / Office / scanned document → **doc-extract** (MinerU).
- Chart / infographic / form where layout is the meaning → **pixel-read**.
- You don't have the URL yet → **external-context** / exa search first.
