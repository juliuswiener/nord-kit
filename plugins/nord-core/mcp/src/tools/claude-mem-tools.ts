/**
 * Deliberate note-taking into claude-mem.
 *
 * claude-mem captures tool usage automatically; this is the other half — the
 * thing an agent decides to write down. It forwards to the worker and stores
 * nothing of its own: no format, no file, no second index.
 *
 * Why this endpoint and not the obvious alternatives (all measured 2026-08-10
 * against worker 13.14.0):
 *
 *   POST /api/memory/save          → storeObservation() straight into the
 *                                    canonical `observations` table, marked
 *                                    subtitle="Manual memory", synced to the
 *                                    vector index, answers {success,id}.
 *                                    Read back by the existing MCP search
 *                                    tools and the session-start injection.
 *
 *   POST /api/sessions/observations → a QUEUE, not a store. Answers
 *                                    {"status":"queued"} and hands the payload
 *                                    to an extraction model that may discard
 *                                    it ("No observations to record." — three
 *                                    attempts, zero durable rows).
 *
 *   POST /v1/memories              → writes `memory_items`, a compat adapter
 *                                    with its own FTS index that no MCP tool
 *                                    reads, scheduled to be retired in favour
 *                                    of observations. Needs auth; this one
 *                                    does not.
 *
 * The success signal is `{success:true, id}` and nothing weaker. A 2xx alone
 * is not proof: both alternatives above answer 200 while storing nothing.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ToolDefinition } from './types.js';

const SETTINGS = join(homedir(), '.claude-mem', 'settings.json');
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Resolve the worker address. The port is per-user — the documented default is
 * `37700 + (uid % 100)` — so it must never be hard-coded. Order: explicit env,
 * then the settings file the worker itself writes, then the formula.
 */
function workerBaseUrl(): string {
  const host = process.env.CLAUDE_MEM_WORKER_HOST ?? readSetting('CLAUDE_MEM_WORKER_HOST') ?? '127.0.0.1';
  const port =
    process.env.CLAUDE_MEM_WORKER_PORT ??
    readSetting('CLAUDE_MEM_WORKER_PORT') ??
    String(37700 + ((process.getuid?.() ?? 77) % 100));
  return `http://${host}:${port}`;
}

function readSetting(key: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS, 'utf8')) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Project name convention is the cwd basename, not a UUID. */
function defaultProject(): string | undefined {
  const base = process.cwd().split(/[\\/]/).filter(Boolean).pop();
  return base || undefined;
}

const text = (s: string, isError = false) => ({
  content: [{ type: 'text' as const, text: s }],
  ...(isError ? { isError: true } : {}),
});

interface SaveResponse {
  success?: boolean;
  id?: number;
  title?: string;
  project?: string;
  message?: string;
  error?: string;
}

export const memorySaveTool: ToolDefinition<{
  text: z.ZodString;
  title: z.ZodOptional<z.ZodString>;
  project: z.ZodOptional<z.ZodString>;
}> = {
  name: 'memory_save',
  description:
    'Write a note into claude-mem so later sessions find it. Use for decisions, gotchas and constraints worth keeping — not for what the transcript already records.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  schema: {
    text: z.string().describe('The note. Write it so it is useful without this conversation: what was decided or found, and why.'),
    title: z.string().describe('Short headline. Defaults to the first 60 characters of the note.').optional(),
    project: z.string().describe('Project to file it under. Defaults to the current directory name.').optional(),
  },

  async handler(args): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const note = String(args?.text ?? '').trim();
    if (!note) return text('text is required — an empty note cannot be filed.', true);

    const project = args?.project?.trim() || defaultProject();
    const base = workerBaseUrl();

    let response: Response;
    try {
      response = await fetch(`${base}/api/memory/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: note,
          ...(args?.title?.trim() ? { title: args.title.trim() } : {}),
          ...(project ? { project } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return text(
        `Could not reach the claude-mem worker at ${base}: ${reason}\nThe note was NOT saved. Check it is running (GET ${base}/api/health).`,
        true,
      );
    }

    let body: SaveResponse | null = null;
    try {
      body = (await response.json()) as SaveResponse;
    } catch {
      body = null;
    }

    // A 2xx is not proof. The sibling endpoints answer 200 while storing
    // nothing, so require the id the worker only emits after the row exists.
    if (!response.ok || body?.success !== true || typeof body.id !== 'number') {
      const detail = body?.error ?? body?.message ?? `HTTP ${response.status}`;
      return text(`claude-mem did not confirm the write: ${detail}\nThe note was NOT saved.`, true);
    }

    return text(
      `Saved as observation #${body.id} in project "${body.project ?? project ?? 'unknown'}".\nFind it later with the claude-mem search tools.`,
    );
  },
};

export const claudeMemTools = [memorySaveTool];
