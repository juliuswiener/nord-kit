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
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" scrape <url>            # normal page → markdown (stdout)
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" scrape <url> --stealth  # anti-bot / login / heavy JS
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" scrape <url> --out page.md   # write to file instead of stdout
bash "$CLAUDE_PLUGIN_ROOT/bin/nw" scrape <url> --raw      # full markdown (default = pruned main content)
```

## Escalation ladder (lazy — cheapest rung that works)

```
1. nw scrape <url>            ← default, free, ~90% of pages
2. empty / blocked? add --stealth   ← on-device evasion (magic/simulate_user; patched-Firefox
                                       backend if installed via setup.sh --stealth)
3. STILL blocked + non-sensitive?   ← only then consider Firecrawl MCP (external, costs credits)
4. sensitive material?              ← stop at rung 2. Never send it to an external API.
```

Do not start at --stealth or Firecrawl prophylactically — escalate only when the cheaper rung
returns empty or obviously truncated content.

## Rules

- **Default to plain `scrape`.** `--stealth` is slower (full browser, evasion); use it only after a
  plain fetch comes back empty/blocked, or when read-router already flagged anti-bot/login.
- **Sensitive content stays local.** Legal/tax/client/internal URLs: rungs 1–2 only. Firecrawl and
  any external scrape API are forbidden for these — the whole point of the local stack.
- **Parallelize multiple URLs.** One `nw scrape` per URL, fired together — not a sequential loop.
- **Verify non-empty.** If output is empty or looks like a bot wall ("enable JavaScript",
  "verify you are human"), escalate one rung; don't silently return the wall as if it were content.
- **Markdown is cheap; keep it.** Don't screenshot a page that scraped fine. Pixel-read is for
  layout-bound content only (see pixel-read).

## When NOT to use

- PDF / Office / scanned document → **doc-extract** (MinerU).
- Chart / infographic / form where layout is the meaning → **pixel-read**.
- You don't have the URL yet → **external-context** / exa search first.
