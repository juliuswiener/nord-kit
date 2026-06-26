#!/usr/bin/env python3
"""nw scrape — fetch a URL to clean markdown via Crawl4AI (local, no API).

  scrape.py <url> [--stealth] [--out FILE] [--raw]

Default path: Crawl4AI (chromium) → fit_markdown (pruned main content); --raw = full markdown.

--stealth path: fetch the page on-device with invisible_playwright's patched Firefox
(C++-level fingerprint stealth, for anti-bot/login/sensitive sites), then convert the HTML to
markdown via Crawl4AI's raw:// generator. Falls back to Crawl4AI's own evasion (magic/
simulate_user) if invisible_playwright isn't installed or fails to launch.
"""
import asyncio
import argparse
import sys


def _pick_md(md, raw):
    if raw:
        return getattr(md, "raw_markdown", None) or str(md)
    return getattr(md, "fit_markdown", None) or getattr(md, "raw_markdown", None) or str(md)


def stealth_fetch_html(url):
    """Sync — patched-Firefox fetch, runs fully before any asyncio loop. Returns HTML or raises."""
    from invisible_playwright import InvisiblePlaywright
    with InvisiblePlaywright(headless=True) as browser:
        page = browser.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        html = page.content()
    return html


async def html_to_md(html, raw):
    from crawl4ai import AsyncWebCrawler, CrawlerRunConfig
    async with AsyncWebCrawler() as c:
        res = await c.arun(url="raw://" + html, config=CrawlerRunConfig())
    return _pick_md(res.markdown, raw)


async def crawl_url(url, raw, stealth_evasion):
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
    try:
        bcfg = BrowserConfig(headless=True, verbose=False,
                             **({"enable_stealth": True} if stealth_evasion else {}))
    except TypeError:
        bcfg = BrowserConfig(headless=True)
    run_kw = {"magic": True, "simulate_user": True, "override_navigator": True} if stealth_evasion else {}
    try:
        rcfg = CrawlerRunConfig(**run_kw)
    except TypeError:
        rcfg = CrawlerRunConfig()
    async with AsyncWebCrawler(config=bcfg) as c:
        res = await c.arun(url=url, config=rcfg)
    if not getattr(res, "success", False):
        print(f"[scrape-failed] {url}: {getattr(res, 'error_message', 'unknown')}", file=sys.stderr)
        return None
    return _pick_md(res.markdown, raw)


# Bot-wall / block markers — if a plain fetch returns these (or nothing), escalate to stealth.
_WALL_MARKERS = (
    "enable javascript", "verify you are human", "are you a robot", "captcha",
    "checking your browser", "just a moment", "access denied", "403 forbidden",
    "cloudflare", "ddos protection", "request blocked", "unusual traffic",
)


def is_wall(text):
    """True if the result looks like a block page or empty — worth a stealth retry."""
    if text is None:
        return True
    t = text.strip()
    if not t:
        return True
    low = t.lower()
    return any(m in low for m in _WALL_MARKERS)


def fetch_stealth(args):
    try:
        html = stealth_fetch_html(args.url)                   # sync, completes before asyncio
        return asyncio.run(html_to_md(html, args.raw))
    except Exception as e:
        print(f"[stealth] invisible_playwright unavailable ({e}); "
              f"falling back to Crawl4AI evasion", file=sys.stderr)
        return asyncio.run(crawl_url(args.url, args.raw, stealth_evasion=True))


def get_markdown(args):
    if args.stealth:
        return fetch_stealth(args)
    # Default: plain local fetch, auto-escalate to stealth once on a block/empty result.
    text = asyncio.run(crawl_url(args.url, args.raw, stealth_evasion=False))
    if not args.no_escalate and is_wall(text):
        print("[escalate] plain fetch looks blocked/empty — retrying with --stealth", file=sys.stderr)
        return fetch_stealth(args)
    return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--stealth", action="store_true", help="force stealth fetch (skip plain)")
    ap.add_argument("--no-escalate", action="store_true",
                    help="plain only; do not auto-retry stealth on a block/empty result")
    ap.add_argument("--out")
    ap.add_argument("--raw", action="store_true")
    args = ap.parse_args()

    text = get_markdown(args)
    if text is None:
        sys.exit(1)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text)
        print(args.out)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
