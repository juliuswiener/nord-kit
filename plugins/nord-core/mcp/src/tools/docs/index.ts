/**
 * Documentation tools.
 *
 * One tool is the caller's: docs_chat, free text in, cited answer out. The other
 * two — docs_sources to resolve which library, docs_fetch to read it — belong to
 * the agent docs_chat spawns and are registered only in that child process.
 *
 * docs_sources moved to the agent side because resolution needs whoever knows the
 * intent, and that is the agent: the intent is in the prompt it receives.
 * `?query=picom` returns `/micromatch/picomatch`, a JavaScript glob matcher rather
 * than the X11 compositor, so the choice cannot be automated — but it also cannot
 * be asked of a caller who has no better information than the question it already
 * wrote. Same step as choosing the retrieval topic, same owner.
 */

import type { ToolDefinition } from '../types.js';
import { docsSourcesTool } from './docs-sources-tool.js';
import { docsChatTool } from './docs-chat-tool.js';
import { docsFetchTool, isDocsAgentProcess } from './docs-fetch-tool.js';

export { docsSourcesTool, docsChatTool, docsFetchTool, isDocsAgentProcess };

/** Caller-facing docs tools: one question-shaped entry point, nothing else. */
const CALLER_TOOLS = [docsChatTool] as unknown as ToolDefinition<never>[];

/** The spawned agent's tools: resolve, then read. */
const AGENT_TOOLS = [docsSourcesTool, docsFetchTool] as unknown as ToolDefinition<never>[];

/**
 * The docs tools this process should expose.
 * In the spawned agent (NORD_DOCS_AGENT=1) that is docs_sources and docs_fetch —
 * which also removes docs_chat from the child, so it cannot spawn another agent.
 */
export function getDocsTools(env: NodeJS.ProcessEnv = process.env): ToolDefinition<never>[] {
  return isDocsAgentProcess(env) ? AGENT_TOOLS : CALLER_TOOLS;
}

export const docsTools = getDocsTools();
