/**
 * docs_sources — the SPAWNED agent's resolution tool. SHOWS candidates, never picks.
 * Never registered for the caller; gated on NORD_DOCS_AGENT=1 alongside docs_fetch.
 *
 * `results[0]` is not the answer: `?query=picom` returns `/micromatch/picomatch`
 * first — a JavaScript glob matcher, not the X11 compositor — and the X11
 * compositor is not in the context7 index at all. A wrong hit shaped exactly
 * like a right one. So this tool lists candidates from both context7 and the
 * local corpora and hands the choice to whoever read the question — which is the
 * agent, since the question is the prompt it was spawned with. Asking the caller
 * to pre-resolve made it do this work with no better information than the
 * question it had already written.
 *
 * Freshness is the deciding field and is therefore always rendered: measured,
 * context7 is fresher than the local copy for 16 of 17 corpora, once by ten months.
 *
 * context7 has no "not found": `?query=zzqqxwv-not-a-real-library` returns 30
 * confident-looking rows, and its own `score` cannot separate them — that query
 * scored 424 while `fastapi` scored 410 and the genuine `picom` scored -28. So
 * no threshold is applied and none should be; the rendered candidates are named
 * as candidates and the judgement is left where the question is.
 */

import { z } from 'zod';
import { TOOL_CATEGORIES } from '../../constants/names.js';
import type { ToolDefinition } from '../types.js';
import { searchContext7, type Context7Hit } from './context7.js';
import { matchLocalCorpora, type LocalCorpus } from './local-corpora.js';

const DEFAULT_LIMIT = 12;

function day(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

function kTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

function renderContext7(hits: Context7Hit[]): string[] {
  return hits.map(
    hit =>
      `- ${hit.id}  [context7]  updated ${day(hit.lastUpdateDate)}  ` +
      `${kTokens(hit.totalTokens)} tokens  trust ${hit.trustScore}\n` +
      `    ${hit.title} — ${(hit.description || '').slice(0, 160)}`,
  );
}

function renderLocal(corpora: LocalCorpus[]): string[] {
  return corpora.map(
    corpus =>
      `- local:${corpus.name}  [local]  updated ${day(corpus.lastUpdate)}  ` +
      `~${kTokens(corpus.tokens)} tokens  trust n/a\n` +
      `    ${corpus.files} files at ${corpus.path}`,
  );
}

export const docsSourcesTool: ToolDefinition<{
  query: z.ZodString;
  limit: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'docs_sources',
  description:
    'List documentation sources matching a library name, from context7 and from local corpora on disk. ' +
    'Returns CANDIDATES — it never picks one. The first hit is routinely the wrong library (query "picom" ' +
    'returns the JavaScript glob matcher picomatch, not the X11 compositor), so read the candidates and ' +
    'choose the one the question is actually about. Pass the chosen `source` to docs_fetch. Shows last ' +
    'update, size in tokens, and trust score; the local copy is usually the older one.',
  category: TOOL_CATEGORIES.DOCS,
  annotations: { readOnlyHint: true, openWorldHint: true },
  schema: {
    query: z.string().describe('Library or tool name to look for, e.g. "picom", "openclaw", "rich"'),
    limit: z.number().int().min(1).max(30).optional().describe(`Max context7 candidates (default ${DEFAULT_LIMIT})`),
  },
  handler: async ({ query, limit }) => {
    const max = limit ?? DEFAULT_LIMIT;
    const lines: string[] = [];

    const local = matchLocalCorpora(query);

    let remoteLines: string[] = [];
    let remoteStatus: string;
    if (!query.trim()) {
      // context7 answers a blank query with HTTP 400; reporting that as a failed
      // request would blame the network for a question nobody asked.
      remoteStatus = 'context7: not queried (a blank query is a local-corpus listing)';
    } else {
      try {
        const hits = await searchContext7(query);
        remoteLines = renderContext7(hits.slice(0, max));
        remoteStatus =
          hits.length === 0
            ? 'context7: 0 matches (the index has no library under that name)'
            : `context7: ${hits.length} fuzzy matches, showing ${remoteLines.length} ` +
              '(context7 never answers "not found" — a name it does not index still returns ' +
              'a full page of plausible rows, so judge by title and description, not by rank)';
      } catch (error) {
        // A dead network and an empty index must not read the same.
        remoteStatus = `context7: REQUEST FAILED — ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    lines.push(`Documentation sources for "${query}"`, '');
    lines.push(remoteStatus);
    if (remoteLines.length) lines.push('', ...remoteLines);

    lines.push(
      '',
      local.length === 0
        ? 'local: 0 matching corpora on disk'
        : `local: ${local.length} matching corpora on disk`,
    );
    if (local.length) lines.push('', ...renderLocal(local));

    const nothing = remoteLines.length === 0 && local.length === 0;
    lines.push(
      '',
      nothing
        ? 'No candidate matched. Do not guess a library id — try another name, or report that no documentation exists for it.'
        : 'Pick one `source` from the list above (a context7 id like /org/repo, or local:<name>) and pass it to ' +
          'docs_fetch. Do not assume the first entry is right. context7 rows are not evidence the library exists — ' +
          'if none of these is the thing the question is actually about, report that no documentation exists for it ' +
          'rather than taking the nearest-looking row.',
    );

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  },
};
