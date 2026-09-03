#!/usr/bin/env node
/**
 * Compare the three copies of the nord-core plugin.
 *
 *   source   this repo (nord-kit)          — where you edit
 *   payload  the marketplace clone         — what `/plugin marketplace update` fetched
 *   cache    ~/.claude/plugins/cache/...   — what Claude Code actually loads
 *
 * Moved here from the nord-core development repo on 2026-09-03, when that repo was
 * retired: ROOT is derived from this file's own location, so running it from there
 * compared a stale tree against the payload and reported 31 files as drifted.
 *
 * Editing only the source changes nothing at runtime. This reports which
 * shipped files differ, so a rollout can be verified instead of assumed.
 *
 * Usage: node scripts/plugin-copies-diff.mjs [--payload <dir>] [--cache <dir>] [--json]
 * Exit codes: 0 = all shipped files identical, 1 = drift found, 2 = could not compare.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PAYLOAD = join(homedir(), '.claude/plugins/marketplaces/nord/plugins/nord-core');
const INSTALLED = join(homedir(), '.claude/plugins/installed_plugins.json');

/**
 * Only these paths ship. `src/`, `docs/`, `scripts/` are repo-only by design.
 * Exported so the release script copies exactly the set this tool checks — two
 * copies of the list would drift, and the drift would show up as a release that
 * passes its own verification while shipping the wrong files.
 */
export const SHIPPED_DIRS = ['agents', 'skills', 'commands', 'hooks', 'hud'];

/**
 * One entry per shipped file, and each says whether the source copy is checked
 * in or produced by `npm run build`. The distinction is not cosmetic: for a
 * checked-in file, absent-from-source means WITHDRAWN and has to be reported;
 * for a build output it means the tree is not built, which in a fresh clone is
 * the normal state. Reporting the second as the first told a maintainer to roll
 * out a removal nobody asked for.
 *
 * One list, not two, so the two facts cannot drift apart.
 */
const SHIPPED_FILE_ENTRIES = [
  { path: 'BEHAVIOUR.md', generated: false },
  { path: 'ROUTING.md', generated: false },
  { path: 'WORKERS.md', generated: false },
  { path: 'TOOLING.md', generated: false },
  { path: 'prices.json', generated: false },
  { path: '.mcp.json', generated: false },
  { path: '.claude-plugin/plugin.json', generated: false },
  // The bundle every `mcp__plugin_nord-core_t__*` tool runs (`.mcp.json` names it)
  // and the script it spawns. Named as files, not as a SHIPPED_DIRS entry: the
  // source `bridge/` holds ten build outputs, the payload ships these two, and
  // walking the directory would report the other eight as permanent drift.
  // mcp-server.cjs is built and gitignored; gyoshu_bridge.py is tracked source
  // (38a2656b) and nothing generates it.
  { path: 'bridge/mcp-server.cjs', generated: true },
  { path: 'bridge/gyoshu_bridge.py', generated: false },
];

export const SHIPPED_FILES = SHIPPED_FILE_ENTRIES.map((entry) => entry.path);

/** Subset of SHIPPED_FILES that `npm run build` produces; absent from an unbuilt source. */
export const GENERATED_SHIPPED_FILES = new Set(
  SHIPPED_FILE_ENTRIES.filter((entry) => entry.generated).map((entry) => entry.path),
);

function parseArgs(argv) {
  const args = { payload: null, cache: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--payload') args.payload = argv[++i];
    else if (argv[i] === '--cache') args.cache = argv[++i];
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

/** The cache dir the running Claude Code is actually pointed at — read, never guessed. */
function resolveCacheFromInstalled() {
  if (!existsSync(INSTALLED)) return null;
  try {
    const j = JSON.parse(readFileSync(INSTALLED, 'utf8'));
    const entries = j.plugins?.['nord-core@nord'];
    return Array.isArray(entries) && entries[0]?.installPath ? entries[0].installPath : null;
  } catch {
    return null;
  }
}

function md5(path) {
  return createHash('md5').update(readFileSync(path)).digest('hex');
}

function walk(base, rel = '', out = []) {
  const abs = join(base, rel);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs)) {
    const childRel = rel ? join(rel, entry) : entry;
    const childAbs = join(base, childRel);
    if (statSync(childAbs).isDirectory()) walk(base, childRel, out);
    else out.push(childRel);
  }
  return out;
}

function shippedPaths(base) {
  const paths = [];
  for (const dir of SHIPPED_DIRS) paths.push(...walk(base, dir));
  for (const file of SHIPPED_FILES) if (existsSync(join(base, file))) paths.push(file);
  return paths;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = resolve(args.payload ?? DEFAULT_PAYLOAD);
  const cache = resolve(args.cache ?? resolveCacheFromInstalled() ?? '');

  if (!existsSync(payload)) {
    console.error(`plugin-copies: payload not found at ${payload}`);
    process.exit(2);
  }
  const haveCache = cache && existsSync(cache);
  if (!haveCache) console.error(`plugin-copies: WARNING — cache dir not found (${cache || 'unresolved'}); comparing source↔payload only`);

  // Compare over the union, so a file present in one copy and missing in another
  // is reported rather than silently skipped.
  const all = new Set([...shippedPaths(ROOT), ...shippedPaths(payload), ...(haveCache ? shippedPaths(cache) : [])]);

  const rows = [];
  for (const rel of [...all].sort()) {
    const paths = { source: join(ROOT, rel), payload: join(payload, rel) };
    if (haveCache) paths.cache = join(cache, rel);
    const hashes = {};
    for (const [copy, p] of Object.entries(paths)) hashes[copy] = existsSync(p) ? md5(p) : null;

    // Source-only files are expected (the payload ships a subset of agents/skills).
    const shippedSomewhere = hashes.payload !== null || (haveCache && hashes.cache !== null);
    if (!shippedSomewhere) continue;

    const shipped = [hashes.payload, ...(haveCache ? [hashes.cache] : [])];
    const payloadCacheAgree = shipped.every((h) => h === shipped[0]);
    // A file gone from the source but still shipped is a DELETION that has not
    // rolled out, and it used to be silently dropped: `sourceAgrees` began with
    // `hashes.source === null ||`, so an absent source counted as agreement.
    //
    // The comment above is about the opposite direction — a source file the
    // payload deliberately does not ship — and `shippedSomewhere` already handles
    // that one line earlier. The null test was doing a second, unrelated job and
    // hiding the case this tool exists to catch.
    //
    // Measured when it was added: two agent definitions removed from the source
    // stayed in the payload and in the cache, a running session kept offering
    // them, and this tool reported "1 shipped file(s) differ" — the one edit, not
    // the two deletions. A rollout checker that cannot see a removal reports a
    // partial rollout as a complete one.
    //
    // The one case where an absent source is NOT a withdrawal: a build output in
    // an unbuilt tree. `bridge/mcp-server.cjs` is gitignored, so a fresh clone
    // never has it, and reporting that as "removal not rolled out" sent whoever
    // ran the checker after a release from a clean clone chasing a deletion that
    // never happened. Narrow on purpose — it applies only to entries marked
    // `generated`, so a withdrawn checked-in file is still caught.
    const sourceIsUnbuiltArtifact = hashes.source === null && GENERATED_SHIPPED_FILES.has(rel);
    const sourceAgrees = sourceIsUnbuiltArtifact || hashes.source === hashes.payload;

    if (!payloadCacheAgree || !sourceAgrees) {
      // The two disagreements are independent, and `severity` used to be a
      // ternary chain that picked one: `!payloadCacheAgree` came first, so a
      // file that was BOTH never copied AND stale in the cache printed only
      // the cache gap. That is the harmless, expected state — a fresh release
      // always has it until the install lands — so the reading it produced was
      // "nothing to do here" while a missed copy sat in the same row. Wrong in
      // the dangerous direction, which is why both are named now rather than
      // the chain being reordered: reordering would just hide the other one.
      //
      // Source first: it is the one that needs an edit, the cache gap needs
      // only a `claude plugin update`. Callers must not classify on this string
      // — the hashes in the same row are unambiguous and plugin-release.mjs
      // uses those.
      const findings = [];
      if (!sourceAgrees) {
        findings.push(hashes.source === null
          ? 'deleted in source, still shipped (removal not rolled out)'
          : 'source≠payload (edit not shipped)');
      }
      if (!payloadCacheAgree) findings.push('payload≠cache (rollout incomplete)');

      rows.push({
        path: rel,
        source: hashes.source ? hashes.source.slice(0, 8) : 'MISSING',
        payload: hashes.payload ? hashes.payload.slice(0, 8) : 'MISSING',
        ...(haveCache ? { cache: hashes.cache ? hashes.cache.slice(0, 8) : 'MISSING' } : {}),
        severity: findings.join(' + '),
      });
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ source: ROOT, payload, cache: haveCache ? cache : null, drift: rows }, null, 2));
  } else if (rows.length === 0) {
    console.log(`plugin-copies: OK — every shipped file identical across ${haveCache ? 3 : 2} copies`);
  } else {
    console.error(`plugin-copies: ${rows.length} shipped file(s) differ`);
    for (const r of rows) {
      const cachePart = r.cache ? ` cache=${r.cache}` : '';
      console.error(`  ${r.path}\n      source=${r.source} payload=${r.payload}${cachePart}  — ${r.severity}`);
    }
  }
  process.exit(rows.length === 0 ? 0 : 1);
}

// Only when run as a script: importing this module must not compare and exit.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
