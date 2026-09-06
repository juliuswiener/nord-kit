import { TOOL_CATEGORIES, type ToolCategory } from '../constants/index.js';

/**
 * Map from user-facing NORD_DISABLE_TOOLS group names to ToolCategory values.
 * Supports both canonical names and common aliases.
 */
export const DISABLE_TOOLS_GROUP_MAP: Record<string, ToolCategory> = {
  'lsp': TOOL_CATEGORIES.LSP,
  'ast': TOOL_CATEGORIES.AST,
  'python': TOOL_CATEGORIES.PYTHON,
  'python-repl': TOOL_CATEGORIES.PYTHON,
  'custom': TOOL_CATEGORIES.CUSTOM,
  'bash': TOOL_CATEGORIES.CUSTOM,
  'memory': TOOL_CATEGORIES.MEMORY,
  'docs': TOOL_CATEGORIES.DOCS,
  'interop': TOOL_CATEGORIES.INTEROP,
  'codex': TOOL_CATEGORIES.CODEX,
  'gemini': TOOL_CATEGORIES.GEMINI,
  'antigravity': TOOL_CATEGORIES.ANTIGRAVITY,
};

/**
 * Parse NORD_DISABLE_TOOLS env var value into a Set of disabled ToolCategory values.
 *
 * Accepts a comma-separated list of group names (case-insensitive).
 * Unknown names are silently ignored.
 *
 * @param envValue - The env var value to parse. Defaults to process.env.NORD_DISABLE_TOOLS.
 * @returns Set of ToolCategory values that should be disabled.
 *
 * @example
 * // NORD_DISABLE_TOOLS=lsp,python-repl,project-memory
 * parseDisabledGroups(); // Set { 'lsp', 'python', 'memory' }
 */
export function parseDisabledGroups(envValue?: string): Set<ToolCategory> {
  const disabled = new Set<ToolCategory>();
  const value = envValue ?? process.env.NORD_DISABLE_TOOLS;
  if (!value || !value.trim()) return disabled;

  for (const name of value.split(',')) {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) continue;
    const category = DISABLE_TOOLS_GROUP_MAP[trimmed];
    if (category !== undefined) {
      disabled.add(category);
    }
  }
  return disabled;
}

export function tagCategory<T extends { name: string }>(
  tools: T[],
  category: ToolCategory,
): (T & { category: ToolCategory })[] {
  return tools.map(t => ({ ...t, category }));
}

export function filterDisabledTools<T extends { category?: ToolCategory }>(
  tools: T[],
  envValue?: string,
): T[] {
  const disabledGroups = parseDisabledGroups(envValue);
  if (disabledGroups.size === 0) return tools;

  return tools.filter(tool => !tool.category || !disabledGroups.has(tool.category));
}
