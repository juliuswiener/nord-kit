/**
 * Local documentation corpora on disk.
 *
 * Three sources, unioned and deduped by name:
 *   1. `~/.docrag/repos.json` — the docrag registry (name -> corpus directory)
 *   2. `~/.docrag/<name>_crawl` — crawled corpora that never made it into the registry
 *   3. sibling directories of every registered corpus — measured, `openclaw`
 *      exists under the same DOCS root as 14 registered corpora and is absent
 *      from repos.json. Enumerating the registry alone would hide it.
 *
 * Freshness comes from the newest file mtime, never from the name: only 2 of 15
 * corpora carry a date in a filename.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface LocalCorpus {
  name: string;
  path: string;
  files: number;
  bytes: number;
  /** Newest file mtime in the corpus, ISO-8601. */
  lastUpdate: string;
  /** Rough token estimate — 4 bytes per token. */
  tokens: number;
}

/** Directory scan is one level deep plus nested dirs; corpora are flat or shallow. */
const MAX_DEPTH = 4;
const DOC_EXTENSIONS = ['.md', '.markdown', '.txt', '.rst', '.mdx'];

function docragRoot(): string {
  return process.env.NORD_DOCRAG_ROOT || join(homedir(), '.docrag');
}

function isDocFile(name: string): boolean {
  return DOC_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
}

interface ScanResult {
  files: number;
  bytes: number;
  newestMs: number;
}

function scanCorpus(dir: string, depth = 0): ScanResult {
  const result: ScanResult = { files: 0, bytes: 0, newestMs: 0 };
  if (depth > MAX_DEPTH) return result;

  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = scanCorpus(full, depth + 1);
      result.files += nested.files;
      result.bytes += nested.bytes;
      result.newestMs = Math.max(result.newestMs, nested.newestMs);
      continue;
    }
    if (!entry.isFile() || !isDocFile(entry.name)) continue;
    try {
      const stat = statSync(full);
      result.files += 1;
      result.bytes += stat.size;
      result.newestMs = Math.max(result.newestMs, stat.mtimeMs);
    } catch {
      // Unreadable file — skip it rather than fail the whole listing.
    }
  }
  return result;
}

function readRegistry(): Array<{ name: string; path: string }> {
  const file = join(docragRoot(), 'repos.json');
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { path?: string }>;
    return Object.entries(parsed)
      .filter(([, value]) => typeof value?.path === 'string')
      .map(([name, value]) => ({ name, path: value.path as string }));
  } catch {
    return [];
  }
}

function crawlDirs(): Array<{ name: string; path: string }> {
  const root = docragRoot();
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.endsWith('_crawl'))
      .map(e => ({ name: e.name.slice(0, -'_crawl'.length), path: join(root, e.name) }));
  } catch {
    return [];
  }
}

function siblingsOf(registered: Array<{ path: string }>): Array<{ name: string; path: string }> {
  const parents = new Set(registered.map(entry => dirname(entry.path)));
  const found: Array<{ name: string; path: string }> = [];
  for (const parent of parents) {
    try {
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) found.push({ name: entry.name, path: join(parent, entry.name) });
      }
    } catch {
      // Parent unreadable — the registered entries themselves still list.
    }
  }
  return found;
}

/**
 * Every local corpus visible on this machine, newest first.
 * On a name collision the fresher copy wins — freshness is the deciding field.
 */
export function listLocalCorpora(): LocalCorpus[] {
  const registry = readRegistry();
  const candidates = [...registry, ...crawlDirs(), ...siblingsOf(registry)];

  const byName = new Map<string, LocalCorpus>();
  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) continue;
    const scan = scanCorpus(candidate.path);
    if (scan.files === 0) continue;

    const corpus: LocalCorpus = {
      name: candidate.name,
      path: candidate.path,
      files: scan.files,
      bytes: scan.bytes,
      lastUpdate: new Date(scan.newestMs).toISOString(),
      tokens: Math.round(scan.bytes / 4),
    };
    const existing = byName.get(corpus.name);
    if (!existing || corpus.lastUpdate > existing.lastUpdate) byName.set(corpus.name, corpus);
  }

  return [...byName.values()].sort((a, b) => b.lastUpdate.localeCompare(a.lastUpdate));
}

/** Case-insensitive substring match on the corpus name. Empty query matches all. */
export function matchLocalCorpora(query: string): LocalCorpus[] {
  const needle = query.trim().toLowerCase();
  const all = listLocalCorpora();
  if (!needle) return all;
  return all.filter(c => c.name.toLowerCase().includes(needle) || needle.includes(c.name.toLowerCase()));
}

export function findLocalCorpus(name: string): LocalCorpus | undefined {
  const wanted = name.trim().toLowerCase();
  return listLocalCorpora().find(c => c.name.toLowerCase() === wanted);
}

/** All doc files in a corpus, absolute paths. */
export function corpusFiles(dir: string, depth = 0): string[] {
  if (depth > MAX_DEPTH) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...corpusFiles(full, depth + 1));
    else if (entry.isFile() && isDocFile(entry.name)) files.push(full);
  }
  return files;
}
