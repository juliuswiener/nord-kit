/**
 * Context7 HTTP client.
 *
 * Plain HTTP against context7.com, NOT the context7 MCP server: on 2026-08-10
 * `mcp.context7.com` answered 504 twice while `context7.com/api/v1/search` and
 * `.../llms.txt` both answered 200. Two endpoints, no SDK, no session.
 *
 * Both functions THROW on failure. A failed fetch must reach the caller as a
 * failure — an empty answer and a dead network must never look the same.
 */

/** One search hit as context7 returns it (fields we actually render). */
export interface Context7Hit {
  id: string;
  title: string;
  description: string;
  lastUpdateDate: string;
  totalTokens: number;
  totalSnippets: number;
  trustScore: number;
}

const SEARCH_URL = 'https://context7.com/api/v1/search';
const LIBRARY_BASE = 'https://context7.com';

export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * A `tokens` value larger than the library holds is harmless — 120k, 250k,
 * 500k and 1M returned byte-identical bodies for the same topic. It is NOT a
 * completeness guarantee: openclaw reports 1,408,528 total tokens and no single
 * request ever returned more than ~98k. The real ceiling is per-request content.
 */
export const DEFAULT_TOKENS = 500_000;

async function getText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'nord-docs-tools' },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const detail = controller.signal.aborted ? `timed out after ${timeoutMs}ms` : reason;
    throw new Error(`context7 request failed (${url}): ${detail}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`context7 request failed (${url}): HTTP ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

/** Search the context7 index. Returns [] for "no such library" — that is not an error. */
export async function searchContext7(
  query: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Context7Hit[]> {
  const body = await getText(`${SEARCH_URL}?query=${encodeURIComponent(query)}`, timeoutMs);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`context7 search returned non-JSON for "${query}" (${body.slice(0, 120)})`);
  }

  const results = (parsed as { results?: unknown })?.results;
  if (!Array.isArray(results)) {
    throw new Error(`context7 search response has no results array for "${query}"`);
  }
  return results as Context7Hit[];
}

/** True for a context7 library id such as `/openclaw/openclaw`. */
export function isContext7Id(source: string): boolean {
  return source.startsWith('/');
}

/**
 * Fetch the topic-reranked documentation slice for a library.
 *
 * `topic` reranks within a fixed budget, it does not truncate: four different
 * topics against openclaw all returned 613 sections, but only the ones derived
 * from the actual question surfaced `--profile`. That is why the topic is
 * chosen by the agent that read the question.
 */
export async function fetchContext7Docs(
  libraryId: string,
  topic: string,
  tokens: number = DEFAULT_TOKENS,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const id = libraryId.startsWith('/') ? libraryId.slice(1) : libraryId;
  const url =
    `${LIBRARY_BASE}/${id}/llms.txt` +
    `?topic=${encodeURIComponent(topic)}&tokens=${encodeURIComponent(String(tokens))}`;
  const text = await getText(url, timeoutMs);

  if (!text.trim()) {
    throw new Error(`context7 returned an empty body for ${libraryId} (topic "${topic}")`);
  }
  return text;
}
