/**
 * docs_chat — free text in, cited answer out.
 *
 * It spawns `claude -p` as its own OS process. That is the point: a 100k-token
 * documentation slice is held in the child's context and never enters the
 * caller's, and an MCP tool has no other way to get a subagent.
 *
 * The child gets two tools — `docs_sources` to resolve which library, `docs_fetch`
 * to read it — and decides its own source, retrieval topic, budget and whether to
 * fetch again. There is deliberately NO `topic` and NO `source` parameter here.
 *
 * The topic: an identical budget against openclaw returned the same 613 sections
 * for every topic, and only the topics derived from the question surfaced the
 * answer. The source: `?query=picom` returns `/micromatch/picomatch` first, a
 * JavaScript glob matcher rather than the X11 compositor, so results[0] cannot be
 * taken — but the disambiguation needs the intent, and the intent is the prompt
 * the child already holds. Both are the same step, and both belong to whoever
 * read the question.
 *
 * The child is the same MCP bundle this process runs, re-spawned with the other
 * nine tool categories denied via NORD_DISABLE_TOOLS and NORD_DOCS_AGENT=1 —
 * verified: the deny list takes the 40-tool surface to the docs family alone, and
 * the agent gate swaps docs_chat out for the retrieval pair, so it cannot recurse.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { TOOL_CATEGORIES } from '../../constants/names.js';
import type { ToolDefinition } from '../types.js';
import { DOCS_AGENT_ENV } from './docs-fetch-tool.js';

/**
 * Every tool category except `docs`. Denying these leaves the spawned bundle
 * with the docs family alone — measured over JSON-RPC against the built bundle
 * with this exact list: the 40-tool caller surface drops to 1 (docs_chat), and
 * the same list inside the agent (NORD_DOCS_AGENT=1) leaves exactly 2,
 * docs_sources and docs_fetch. Nothing from the other categories survives.
 */
export const NON_DOCS_CATEGORIES = 'lsp,ast,python,custom,state,memory,trace,deepinit';

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MODEL = 'sonnet';
const CHILD_MCP_SERVER = 'docs';
/** Resolve, then read. Both live on the agent side; neither is caller-facing. */
export const CHILD_TOOLS = ['docs_sources', 'docs_fetch'].map(
  name => `mcp__${CHILD_MCP_SERVER}__${name}`,
);

/**
 * Env the retrieval child genuinely needs: a home directory for the local
 * corpora, a PATH, and the proxy settings — without those last four a machine
 * behind a proxy would see every context7 fetch fail from inside the agent
 * while the same fetch succeeded from the parent.
 */
const CHILD_ENV_PASSTHROUGH = [
  'HOME',
  'PATH',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
  'NODE_USE_ENV_PROXY',
  'NODE_EXTRA_CA_CERTS',
] as const;

function childServerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_PASSTHROUGH) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env[DOCS_AGENT_ENV] = '1';
  env.NORD_DISABLE_TOOLS = NON_DOCS_CATEGORIES;
  return env;
}

/** Path of the MCP server bundle to re-spawn for the child. */
export function resolveServerEntry(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.NORD_DOCS_MCP_ENTRY;
  if (explicit) return explicit;
  const own = process.argv[1];
  if (own && existsSync(own)) return own;
  throw new Error(
    'cannot locate the MCP server entry to spawn the docs agent — set NORD_DOCS_MCP_ENTRY',
  );
}

export function buildSystemPrompt(): string {
  return [
    'You answer the question you were asked from library documentation and from nothing else.',
    '',
    'STEP 1 — resolve the source. The question names a library or tool. Call docs_sources with that',
    'name; it lists candidates from context7 and from the local corpora on disk. Judge them by title',
    'and description, never by rank or score. context7 has no "not found": a name it does not index',
    'still comes back as a full page of confident-looking rows, and its own score sorts backwards —',
    'a nonsense query scored 424 while the genuine `picom` scored -28. results[0] is routinely the',
    'wrong library: `picom` returns /micromatch/picomatch, a JavaScript glob matcher, while the X11',
    'compositor of the same name exists only in the local corpora. Read the question for which one',
    'it means, and search a different name if the first list does not contain it.',
    '',
    'context7 returning rows is NOT evidence that the library exists. The local corpora are the honest',
    'signal — they answer 0 when they hold nothing. If no candidate is actually the thing the question',
    'is about, say that its documentation is not available and stop there. Never invent a library id,',
    'never settle for the closest-looking row, and never answer from memory about a library you could',
    'not resolve.',
    '',
    'STEP 2 — read it. Call docs_fetch on the source you chose. Choose its `topic` yourself, from the',
    'question you were asked: the topic reranks a fixed budget rather than truncating it, so specific',
    'nouns from the question find answers that generic words like "configuration options" bury. If the',
    'returned slice does not contain the answer, fetch again with different terms — and reconsider',
    'whether you resolved the right source — before concluding anything.',
    '',
    'Open your answer with one line naming the source you resolved to and why that one.',
    'Every claim you make must cite the `Source:` line of the section it rests on — quote the URL or path.',
    'If the documentation does not answer the question, say so plainly and say what you did look at.',
    'Never fill a gap from memory, and never invent a source line.',
    'If a tool reports a failure, report that failure — a failed fetch is not an empty answer.',
  ].join('\n');
}

interface ChildResult {
  answer: string;
  costUsd?: number;
  durationMs?: number;
  turns?: number;
  isError: boolean;
}

function parseChildOutput(stdout: string): ChildResult {
  try {
    const parsed = JSON.parse(stdout) as {
      result?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      num_turns?: number;
      is_error?: boolean;
    };
    return {
      answer: parsed.result ?? '',
      costUsd: parsed.total_cost_usd,
      durationMs: parsed.duration_ms,
      turns: parsed.num_turns,
      isError: parsed.is_error === true,
    };
  } catch {
    return { answer: stdout, isError: false };
  }
}

function runChild(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise(resolve => {
    const child = spawn('claude', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }, timeoutMs);

    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('error', e => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\nspawn failed: ${e.message}`, timedOut });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

export const docsChatTool: ToolDefinition<{
  prompt: z.ZodString;
  timeout_ms: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'docs_chat',
  description:
    'Ask a free-text question about a library or tool and get a cited answer from its documentation. Name ' +
    'the library and the situation in the question itself — "picom, the X11 compositor, how do I exclude ' +
    'windows from shadows" — because a separate agent process resolves which documentation that is, reads ' +
    'it, and answers. None of the documentation enters this context. Ask the real question, in full: the ' +
    'agent derives both the source and its retrieval terms from it, and names in one line which source it ' +
    'chose.',
  category: TOOL_CATEGORIES.DOCS,
  annotations: { readOnlyHint: true, openWorldHint: true },
  schema: {
    prompt: z
      .string()
      .describe(
        'The question, in free text. Name the library and enough context to tell it from a same-named one.',
      ),
    timeout_ms: z
      .number()
      .int()
      .min(10_000)
      .max(900_000)
      .optional()
      .describe(`Give up after this long (default ${DEFAULT_TIMEOUT_MS}).`),
  },
  handler: async ({ prompt, timeout_ms }) => {
    const timeoutMs = timeout_ms ?? DEFAULT_TIMEOUT_MS;

    let entry: string;
    try {
      entry = resolveServerEntry();
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: (error as Error).message }],
        isError: true,
      };
    }

    const configDir = mkdtempSync(join(tmpdir(), 'nord-docs-chat-'));
    const configPath = join(configDir, 'mcp.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          [CHILD_MCP_SERVER]: {
            command: process.execPath,
            args: [entry],
            // Deliberately not `...process.env`: this file lands in a temp dir,
            // and the retrieval tool needs a home directory, a PATH and proxies.
            env: childServerEnv(),
          },
        },
      }),
    );

    const args = [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--model',
      process.env.NORD_DOCS_CHAT_MODEL || DEFAULT_MODEL,
      '--mcp-config',
      configPath,
      '--strict-mcp-config',
      '--allowedTools',
      CHILD_TOOLS.join(','),
      '--append-system-prompt',
      buildSystemPrompt(),
    ];

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      [DOCS_AGENT_ENV]: '1',
      NORD_DISABLE_TOOLS: NON_DOCS_CATEGORIES,
    };

    const started = Date.now();
    let run: Awaited<ReturnType<typeof runChild>>;
    try {
      run = await runChild(args, childEnv, timeoutMs);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
    const wallMs = Date.now() - started;

    if (run.timedOut) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `docs_chat timed out after ${timeoutMs}ms.\n${run.stderr.trim().slice(-2000)}`,
          },
        ],
        isError: true,
      };
    }

    if (run.code !== 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `docs_chat failed (claude -p exited ${run.code}).\n` +
              `${run.stderr.trim().slice(-2000)}\n${run.stdout.trim().slice(-2000)}`,
          },
        ],
        isError: true,
      };
    }

    const result = parseChildOutput(run.stdout);
    const cost = result.costUsd !== undefined ? `$${result.costUsd.toFixed(4)}` : 'unknown';
    // No `source:` here any more — the agent resolved it, so it is the agent that
    // reports which one, in the answer itself.
    const footer =
      `\n\n---\nagent turns: ${result.turns ?? '?'} | ` +
      `cost: ${cost} | ${Math.round((result.durationMs ?? wallMs) / 1000)}s`;

    return {
      content: [{ type: 'text' as const, text: (result.answer || '(empty answer)') + footer }],
      isError: result.isError,
    };
  },
};
