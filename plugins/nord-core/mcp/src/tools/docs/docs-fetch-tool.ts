/**
 * docs_fetch — the SPAWNED agent's retrieval tool. Never registered for the caller.
 *
 * It is gated on NORD_DOCS_AGENT=1, which only docs_chat sets on the child it
 * spawns — as is docs_sources, its resolution counterpart. The caller's `t`
 * therefore holds docs_chat and neither of these two: 39 -> 40, not 42.
 *
 * The `topic` lives here, on the agent side, deliberately. Measured against
 * openclaw with an identical budget, all four topics returned the same 613
 * sections and only the question-derived ones surfaced the answer:
 *
 *   topic="configuration file options settings"  -> `--profile` on 1 line
 *   topic="profile"                              -> 22 lines
 *   topic="profile state dir env"                -> 22 lines, env mechanism on 18
 *
 * A caller writing a topic before knowing what matters writes the first one.
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { TOOL_CATEGORIES } from '../../constants/names.js';
import type { ToolDefinition } from '../types.js';
import { DEFAULT_TOKENS, fetchContext7Docs, isContext7Id } from './context7.js';
import { corpusFiles, findLocalCorpus } from './local-corpora.js';

/** Bytes per token, for turning the token budget into a character budget locally. */
const BYTES_PER_TOKEN = 4;

/** The env flag docs_chat sets on the spawned agent. */
export const DOCS_AGENT_ENV = 'NORD_DOCS_AGENT';

export function isDocsAgentProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DOCS_AGENT_ENV] === '1';
}

function scoreFile(text: string, terms: string[]): number {
  const haystack = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(term, from);
      if (at === -1) break;
      score += 1;
      from = at + term.length;
    }
  }
  return score;
}

/** Rank a local corpus's files by topic-term hits and concatenate up to the budget. */
function fetchLocalDocs(name: string, topic: string, tokens: number): string {
  const corpus = findLocalCorpus(name);
  if (!corpus) {
    throw new Error(
      `no local corpus named "${name}" — run docs_sources to see what is on disk`,
    );
  }

  const terms = topic.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const budget = tokens * BYTES_PER_TOKEN;

  const scored = corpusFiles(corpus.path)
    .map(file => {
      try {
        const text = readFileSync(file, 'utf8');
        return { file, text, score: terms.length ? scoreFile(text, terms) : 1 };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { file: string; text: string; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score);

  const hits = scored.filter(entry => entry.score > 0);
  if (hits.length === 0) {
    throw new Error(
      `local corpus "${name}" (${scored.length} files) contains none of the topic terms: ${terms.join(', ')}`,
    );
  }

  const chunks: string[] = [];
  let used = 0;
  for (const hit of hits) {
    if (used >= budget) break;
    const room = budget - used;
    const body = hit.text.length > room ? `${hit.text.slice(0, room)}\n[...truncated]` : hit.text;
    chunks.push(`### ${hit.file.split('/').pop()}\nSource: ${hit.file}\n\n${body}`);
    used += body.length;
  }
  return chunks.join('\n\n----------------------------------------\n\n');
}

export const docsFetchTool: ToolDefinition<{
  source: z.ZodString;
  topic: z.ZodString;
  tokens: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'docs_fetch',
  description:
    'Fetch a documentation slice for a resolved source. `topic` reranks within a fixed budget — it does not ' +
    'truncate — so derive the topic from the question you were actually asked, not from the library name, and ' +
    'fetch again with different terms if the first slice did not contain the answer. Each section carries a ' +
    '`Source:` line; cite it.',
  category: TOOL_CATEGORIES.DOCS,
  annotations: { readOnlyHint: true, openWorldHint: true },
  schema: {
    source: z.string().describe('context7 library id (/org/repo) or local:<name>, as returned by docs_sources'),
    topic: z
      .string()
      .describe('Retrieval terms derived from the question. Specific nouns beat generic ones.'),
    tokens: z
      .number()
      .int()
      .min(1000)
      .optional()
      .describe(`Retrieval budget (default ${DEFAULT_TOKENS}). Overshooting is harmless; ~100-130k is the real per-request ceiling.`),
  },
  handler: async ({ source, topic, tokens }) => {
    const budget = tokens ?? DEFAULT_TOKENS;
    try {
      const text = isContext7Id(source)
        ? await fetchContext7Docs(source, topic, budget)
        : fetchLocalDocs(source.replace(/^local:/, ''), topic, budget);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Source: ${source}  |  topic: ${topic}  |  ${text.length} chars\n\n${text}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `docs_fetch failed for ${source}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
};
