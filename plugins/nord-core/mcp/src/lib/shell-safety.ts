/**
 * Safety validation for shell commands, applied inside the tool handler.
 *
 * Ported from hooks/pretooluse-validate-bash.py, which shipped in the plugin
 * payload but was never registered in hooks/hooks.json — it looked like active
 * protection and was dead code. That file was deleted when this one landed; the
 * logic lives here instead, so it applies to every call of the MCP shell rather
 * than to a hook nobody wired up. The original is in git history.
 *
 * The port is NOT literal. Four defects in the original were corrected, each
 * pinned by a test in __tests__/shell-safety.test.ts:
 *
 *  1. check_protected_paths built `\brm\s+.*{path}(/|\s|$)` for every protected
 *     path, and `/` is one of them. Measured against the original:
 *         'rm -rf dist/'  -> ['/']
 *         'rm -rf build/' -> ['/']
 *     Routine build cleanup was flagged as deletion of the root filesystem.
 *     Replaced by a token walk that only matches ABSOLUTE operands.
 *  2. Flag detection was `-[rf]{2}`, which misses `-r -f`, `-Rf`, `-rvf` and
 *     `--recursive --force`. The original still denied those against protected
 *     paths — but only via the same over-broad regex as (1). Measured:
 *         original: 'rm -r -f /etc' -> DENY, 'rm -rf dist/' -> DENY
 *     Remove the false positive and that incidental coverage goes with it, so
 *     correction 1 is only safe together with a per-token flag scan.
 *  3. `$HOME` and `~` were only recognised bare. Measured: the original returns
 *     ASK for `rm -rf "$HOME"` — and an MCP handler has no channel to ask, so
 *     ASK means "execute". Quotes are stripped before the operand is judged.
 *  4. analyze_rm_command deferred to `target.startswith(protected)` with `/`
 *     in the set, so every absolute path was "a protected system path".
 *     Containment is now `t === p || t.startsWith(p + '/')`.
 *
 * Verdicts: 'deny' blocks, 'warn' executes with a warning line prepended.
 * The original's ASK bucket contains every `rm -rf <anything>`; treating that
 * as a block would refuse `rm -rf node_modules` and take the gate-loop with it.
 * Set NORD_SHELL_STRICT=1 to promote 'warn' to 'deny'.
 */

import { posix } from 'node:path';

export type ShellVerdict = 'allow' | 'warn' | 'deny';

export interface ShellSafetyResult {
  verdict: ShellVerdict;
  /** Human-readable reason, present for 'warn' and 'deny'. */
  reason?: string;
  /** Which check produced the verdict, so a refusal can be argued with. */
  rule?: string;
}

const ALLOW: ShellSafetyResult = { verdict: 'allow' };

/** Paths that must never be the target of a recursive delete. */
export const PROTECTED_PATHS: ReadonlySet<string> = new Set([
  '/', '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64',
  '/proc', '/root', '/sbin', '/sys', '/usr', '/var',
  '/usr/bin', '/usr/lib', '/usr/sbin', '/etc/passwd',
  '/etc/shadow', '/etc/group', '/boot/grub',
]);

/** Carried over from the original, which had these right. */
const DANGEROUS_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/rm\s+(-[A-Za-z]*\s+)*(-[A-Za-z]*r[A-Za-z]*|--recursive)\s+.*(--no-preserve-root)/i, 'recursive deletion with --no-preserve-root'],
  [/find\s+\/\s+.*-delete/i, 'find with delete starting from root'],
  [/find\s+.*-exec\s+rm\s+-[A-Za-z]*r/i, 'find with recursive delete'],
  [/find\s+\/.*-execdir\s+rm/i, 'find execdir with rm starting from root'],
  [/\|\s*xargs\s+rm\s+-[A-Za-z]*r/i, 'piping to xargs with recursive delete'],
  [/dd\s+.*of=\/dev\/(sd|hd|nvme)/i, 'writing directly to a disk device'],
  [/mkfs\.\w+\s+\/dev\//i, 'formatting a disk partition'],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, 'fork bomb'],
  [/>\s*\/dev\/sd[a-z]/i, 'redirecting output to a raw disk'],
  [/chmod\s+-R\s+000/i, 'recursive permission removal'],
  [/>\s*\/etc\/(passwd|shadow|group|sudoers)/i, 'overwriting a critical system file'],
];

/** Risky expansions: an unset variable turns these into something much worse. */
const EXPANSION_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/rm\s+-[A-Za-z]*r[A-Za-z]*\s+["']?\$\{[^}]*\}/i, 'rm with a variable that may be unset'],
  [/rm\s+-[A-Za-z]*r[A-Za-z]*\s+["']?\$[A-Z_]+\/?\s*$/i, 'rm with an environment variable that may be unset'],
  [/rm\s+-[A-Za-z]*r[A-Za-z]*\s+\*/i, 'rm with an unquoted wildcard'],
];

export function checkDangerousPatterns(command: string): ShellSafetyResult {
  for (const [pattern, reason] of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return { verdict: 'deny', reason, rule: 'dangerous-pattern' };
  }
  return ALLOW;
}

export function checkVariableExpansionRisk(command: string): ShellSafetyResult {
  for (const [pattern, reason] of EXPANSION_PATTERNS) {
    if (pattern.test(command)) return { verdict: 'warn', reason, rule: 'variable-expansion' };
  }
  return ALLOW;
}

/** Split a command line into segments that each start a fresh command. */
function splitSegments(command: string): string[] {
  return command
    .split(/\n|;|&&|\|\||\||&/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1);
    }
  }
  return token.replace(/["']/g, '');
}

interface RmInvocation {
  recursive: boolean;
  force: boolean;
  operands: string[];
}

/**
 * Find `rm` invocations and split flags from operands.
 *
 * Correction 2: a token is a recursive flag if it is `--recursive` or a short
 * cluster containing r/R, so `-r -f`, `-Rf` and `-rvf` are all caught.
 */
function findRmInvocations(command: string): RmInvocation[] {
  const found: RmInvocation[] = [];

  for (const segment of splitSegments(command)) {
    const tokens = segment.split(/\s+/).filter(Boolean);
    let i = 0;
    // Skip leading env assignments and privilege wrappers.
    while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || tokens[i] === 'sudo' || tokens[i] === 'doas')) i++;
    if (i >= tokens.length) continue;

    const cmd = stripQuotes(tokens[i]);
    if (cmd !== 'rm' && !cmd.endsWith('/rm')) continue;

    const invocation: RmInvocation = { recursive: false, force: false, operands: [] };
    let flagsDone = false;

    for (let j = i + 1; j < tokens.length; j++) {
      const raw = tokens[j];
      if (raw === '--') { flagsDone = true; continue; }

      if (!flagsDone && raw.startsWith('-') && raw.length > 1) {
        if (raw.startsWith('--')) {
          if (raw === '--recursive') invocation.recursive = true;
          if (raw === '--force') invocation.force = true;
        } else {
          if (/[rR]/.test(raw)) invocation.recursive = true;
          if (/f/.test(raw)) invocation.force = true;
        }
        continue;
      }
      invocation.operands.push(stripQuotes(raw));
    }

    found.push(invocation);
  }

  return found;
}

/** Correction 3: recognise the home directory through quotes and braces. */
function isHomeTarget(operand: string): boolean {
  return /^(~|\$HOME|\$\{HOME\})\/?$/.test(operand);
}

/** Correction 1 + 4: only ABSOLUTE operands are compared, with real containment. */
function protectedHit(operand: string): string | null {
  if (!operand.startsWith('/')) return null;
  const normalized = posix.normalize(operand.replace(/\/\*+$/, '/')).replace(/\/+$/, '') || '/';
  for (const p of PROTECTED_PATHS) {
    if (normalized === p) return p;
    if (p !== '/' && normalized.startsWith(p + '/')) return p;
  }
  // A bare wildcard directly under root is root deletion by another spelling.
  if (/^\/\*+$/.test(operand)) return '/';
  return null;
}

export function checkProtectedPaths(command: string): ShellSafetyResult {
  for (const rm of findRmInvocations(command)) {
    for (const operand of rm.operands) {
      const hit = protectedHit(operand);
      if (hit) {
        return {
          verdict: 'deny',
          reason: `deletes the protected system path ${hit} (target: ${operand})`,
          rule: 'protected-path',
        };
      }
    }
  }
  return ALLOW;
}

export function analyzeRmCommand(command: string): ShellSafetyResult {
  for (const rm of findRmInvocations(command)) {
    for (const operand of rm.operands) {
      if (isHomeTarget(operand)) {
        return { verdict: 'deny', reason: `recursive delete of the home directory (${operand})`, rule: 'rm-home' };
      }
      if (operand === '/' || /^\/\*+$/.test(operand)) {
        return { verdict: 'deny', reason: `recursive delete of the root filesystem (${operand})`, rule: 'rm-root' };
      }
      if (rm.recursive && (operand === '.' || operand === '..')) {
        return { verdict: 'deny', reason: `recursive delete of ${operand}`, rule: 'rm-relative-root' };
      }
    }
    if (rm.recursive && rm.force && rm.operands.length > 0) {
      return {
        verdict: 'warn',
        reason: `recursive force delete of: ${rm.operands.join(' ')}`,
        rule: 'rm-recursive-force',
      };
    }
  }
  return ALLOW;
}

/**
 * Run every check. Order matters: the hard denials run before the advisory
 * ones, so a refusal names the most specific rule rather than the first match.
 */
export function validateShellCommand(
  command: string,
  opts: { strict?: boolean } = {},
): ShellSafetyResult {
  const strict = opts.strict ?? process.env.NORD_SHELL_STRICT === '1';

  const checks = [
    checkDangerousPatterns(command),
    analyzeRmCommand(command),
    checkProtectedPaths(command),
    checkVariableExpansionRisk(command),
  ];

  const denial = checks.find((c) => c.verdict === 'deny');
  if (denial) return denial;

  const warning = checks.find((c) => c.verdict === 'warn');
  if (warning) {
    return strict
      ? { ...warning, verdict: 'deny', reason: `${warning.reason} (NORD_SHELL_STRICT=1)` }
      : warning;
  }

  return ALLOW;
}
