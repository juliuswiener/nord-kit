/**
 * Shell tools: Bash, BashOutput, KillShell.
 *
 * This tool exists to be usable as the ONLY shell — the native Bash tool is
 * withdrawn from the agents that use it. The previous implementation was a
 * `promisify(exec)` one-liner with three measured defects, each fixed here:
 *
 *   1. Output above exec's 1 MB maxBuffer was LOST, not truncated
 *      ("Error: stdout maxBuffer length exceeded", 39 chars back).
 *      → spawn + a bounded head/tail collector, so size is irrelevant.
 *   2. The timeout killed only the direct shell; a backgrounded grandchild
 *      survived as an orphan (verified with a positive control).
 *      → detached:true makes the child a process-group leader, which is what
 *        lets gracefulKill's process.kill(-pid) reach the whole tree.
 *   3. On a non-zero exit, stdout was dropped and the exit code never reported
 *      (only e.message, which carries stderr).
 *      → both streams and `Exit code: N` are rendered on every path. This is
 *        the one that mattered most: the gate-loop's verdict IS the exit code,
 *        and test runners write their result to stdout.
 *
 * Parameter names follow the NATIVE Bash tool (`command`, `timeout`,
 * `run_in_background`) rather than this repo's snake_case, because the tool's
 * contract is "be the native shell": src/hooks/bridge.ts reads `command` and
 * `run_in_background` literally, src/hud/transcript.ts reads `command`, and
 * every model has strong priors for those names. The old PascalCase
 * `CommandLine`/`Cwd` appeared nowhere outside this file.
 *
 * `schema` must stay a Zod RAW SHAPE — not z.object(...). Both the standalone
 * server (zodToJsonSchema) and the in-process SDK server (tool()) read it
 * directly; shipping a raw `inputSchema` here once took down all 55 tools.
 */

import { spawn } from 'node:child_process';
import { closeSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve as resolvePath } from 'node:path';
import { z } from 'zod';
import type { ToolDefinition } from '../../tools/types.js';
import { validateWorkingDirectory } from '../../lib/worktree-paths.js';
import { gracefulKill, isProcessAlive, getProcessStartIdentity, isProcessIdentityLive } from '../../platform/process-utils.js';
import { validateShellCommand } from '../../lib/shell-safety.js';
import {
  createStreamCollector,
  DEFAULT_STDERR_MAX_BYTES,
  DEFAULT_STDOUT_MAX_BYTES,
} from '../../lib/truncate-output.js';
import {
  countRunningJobs,
  createJobDir,
  jobExitPath,
  isValidJobId,
  newShellJobId,
  openJobLog,
  pruneShellJobs,
  readJobRecord,
  readNewOutput,
  reconcileJob,
  writeJobRecord,
  type ShellJobRecord,
} from '../../lib/shell-jobs.js';

// 2 min was short enough to kill work that was going fine. The case that moved it:
// a `git commit` in a repo whose pre-commit hook runs the full test gate (~3 min)
// was killed at 120_000 with exit 124, mid-commit — and a caller who did not know
// the hook was there reads that as the commit failing, not as the timeout firing.
// Anything gate-shaped (a test suite, a build, a hook that runs either) sits in
// exactly this band. MAX is unchanged, so a caller who knows better still passes one.
export const DEFAULT_TIMEOUT_MS = 300_000;
export const MAX_TIMEOUT_MS = 600_000;
export const MIN_TIMEOUT_MS = 1_000;

const DEFAULT_MAX_BACKGROUND_JOBS = 5;
const IS_WINDOWS = process.platform === 'win32';

/** Working directory carried between calls, like the native tool. */
let sessionCwd: string | null = null;

/** Test seams. */
export function _resetShellSession(): void { sessionCwd = null; }
export function _getShellSessionCwd(): string | null { return sessionCwd; }
export function _clampTimeout(ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(ms)));
}

const text = (s: string, isError = false) => ({
  content: [{ type: 'text' as const, text: s }],
  ...(isError ? { isError: true } : {}),
});

/** Single-quote a path for safe interpolation into the shell prelude. */
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Resolve a per-call cwd inside the worktree.
 *
 * validateWorkingDirectory cannot do this: it always returns the git top level
 * (and rejects a path whose top level differs), so handing it a subdirectory
 * silently yields the root. It is used for the trusted root only; containment
 * of the subdirectory is checked here.
 */
function resolveUnderRoot(root: string, candidate: string): string {
  const real = realpathSync(resolvePath(root, candidate));
  if (!statSync(real).isDirectory()) throw new Error(`not a directory: ${candidate}`);
  const rel = relative(realpathSync(root), real);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`cwd '${candidate}' is outside the worktree root '${root}'`);
  }
  return real;
}

/**
 * Prelude prepended to every command.
 *
 * Prepended, never appended: an appended trailer would land inside a trailing
 * heredoc or line continuation and break the user's command. The cost is that
 * bash's own `line N:` diagnostics are offset by two lines.
 *
 * The EXIT trap fires on normal termination and on an explicit `exit N`, which
 * is what makes the background exit code survive without a parent. It does NOT
 * fire under SIGKILL — and that asymmetry is exactly what lets a missing exit
 * file mean "killed" rather than "still running".
 */
function foregroundPrelude(): string {
  return `__nord_r() { printf '%s' "$PWD" >&3 2>/dev/null; }\ntrap __nord_r EXIT\n`;
}

function backgroundPrelude(exitPath: string): string {
  return `__nord_r() { __rc=$?; printf '%s' "$__rc" > ${shq(exitPath)} 2>/dev/null; }\ntrap __nord_r EXIT\n`;
}

interface ForegroundResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: ReturnType<ReturnType<typeof createStreamCollector>['result']>;
  stderr: ReturnType<ReturnType<typeof createStreamCollector>['result']>;
  reportedCwd: string | null;
  timedOut: boolean;
}

function runForeground(command: string, cwd: string, timeoutMs: number): Promise<ForegroundResult> {
  return new Promise((resolveRun) => {
    const child = IS_WINDOWS
      ? spawn('cmd.exe', ['/c', command], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn('/bin/bash', ['-c', foregroundPrelude() + command], {
          cwd,
          windowsHide: true,
          // fd 3 carries the final $PWD back without a temp file.
          stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
          // Process-group leader — the single line that makes the timeout able
          // to reach grandchildren.
          detached: true,
        });

    const stdout = createStreamCollector({ maxBytes: DEFAULT_STDOUT_MAX_BYTES });
    const stderr = createStreamCollector({ maxBytes: DEFAULT_STDERR_MAX_BYTES });
    const cwdChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;

    child.stdout?.on('data', (b: Buffer) => stdout.push(b));
    child.stderr?.on('data', (b: Buffer) => stderr.push(b));
    const side = child.stdio[3];
    if (side && typeof (side as NodeJS.ReadableStream).on === 'function') {
      (side as NodeJS.ReadableStream).on('data', (b: Buffer) => cwdChunks.push(b));
    }

    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drainTimer);
      const reported = Buffer.concat(cwdChunks).toString('utf8').trim();
      resolveRun({
        code,
        signal,
        stdout: stdout.result(),
        stderr: stderr.result(),
        reportedCwd: reported || null,
        timedOut,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) void gracefulKill(child.pid, 2000);
    }, timeoutMs);

    // 'close' waits for every stdio pipe to drain, which is what we want — but a
    // backgrounded grandchild can hold the pipe open forever. Fall back to the
    // exit code a short while after 'exit' rather than hanging past our timeout.
    let drainTimer: NodeJS.Timeout = setTimeout(() => undefined, 0);
    child.on('exit', (code, signal) => {
      clearTimeout(drainTimer);
      drainTimer = setTimeout(() => finish(code, signal), 2000);
    });
    child.on('close', (code, signal) => finish(code, signal));
    child.on('error', (err) => {
      stderr.push(Buffer.from(`failed to start command: ${err.message}\n`));
      finish(null, null);
    });
  });
}

function renderForeground(
  result: ForegroundResult,
  timeoutMs: number,
  warning: string | null,
  cwdChanged: string | null,
): { rendered: string; isError: boolean } {
  const lines: string[] = [];
  if (warning) lines.push(`[safety] ${warning}`);

  const exitCode = result.timedOut ? 124 : (result.code ?? (result.signal ? 137 : 0));
  // Literal form matches /exit code: [1-9]/i in src/openclaw/signal.ts, so a
  // failing command is classified as failed there without extra plumbing.
  lines.push(`Exit code: ${exitCode}`);
  if (result.timedOut) lines.push(`[timed out after ${timeoutMs} ms — process group killed]`);
  if (result.signal && !result.timedOut) lines.push(`[terminated by signal ${result.signal}]`);
  if (cwdChanged) lines.push(`[cwd: ${cwdChanged}]`);

  lines.push('--- stdout ---');
  lines.push(result.stdout.text.length ? result.stdout.text : '(empty)');
  if (result.stderr.text.length) {
    lines.push('--- stderr ---');
    lines.push(result.stderr.text);
  }

  return { rendered: lines.join('\n'), isError: result.timedOut || exitCode !== 0 };
}

export const bashTool: ToolDefinition<{
  command: z.ZodString;
  timeout: z.ZodOptional<z.ZodNumber>;
  run_in_background: z.ZodOptional<z.ZodBoolean>;
  cwd: z.ZodOptional<z.ZodString>;
}> = {
  name: 'Bash',
  description:
    'Run a bash command. Returns the exit code plus stdout and stderr on success and failure alike. The working directory persists between calls.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  schema: {
    command: z.string().describe('The bash command to run.'),
    timeout: z
      .number()
      .int()
      .describe('Timeout in milliseconds (default 300000, max 600000). On timeout the whole process group is killed and partial output is returned.')
      .optional(),
    run_in_background: z
      .boolean()
      .describe('Run detached and return a bash_id immediately. Poll with BashOutput, stop with KillShell.')
      .optional(),
    cwd: z
      .string()
      .describe('Directory for this call only. Otherwise the directory persists from the previous call.')
      .optional(),
  },

  async handler(args): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const command = String(args?.command ?? '').trim();
    if (!command) return text('command is required.', true);

    const safety = validateShellCommand(command);
    if (safety.verdict === 'deny') {
      return text(
        `Blocked by shell safety policy: ${safety.reason}\nRule: ${safety.rule}\nNo command was executed.`,
        true,
      );
    }
    const warning = safety.verdict === 'warn' ? `${safety.reason} (rule: ${safety.rule})` : null;

    let root: string;
    try {
      root = validateWorkingDirectory();
    } catch (error) {
      return text(`Could not resolve the worktree root: ${error instanceof Error ? error.message : String(error)}`, true);
    }

    let cwd: string;
    try {
      cwd = args?.cwd ? resolveUnderRoot(root, args.cwd) : (sessionCwd ?? root);
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), true);
    }

    const timeoutMs = _clampTimeout(args?.timeout);

    if (args?.run_in_background === true) {
      return startBackground(command, cwd, root, warning);
    }

    try {
      const result = await runForeground(command, cwd, timeoutMs);

      // An explicit `cwd` argument scopes the whole call, so the reported $PWD
      // must not leak into the persisted session directory — otherwise a
      // one-off `cwd:"other"` silently relocates every later call.
      let cwdChanged: string | null = null;
      if (!args?.cwd && !result.timedOut && result.reportedCwd) {
        try {
          const resolved = resolveUnderRoot(root, result.reportedCwd);
          if (resolved !== (sessionCwd ?? root)) {
            sessionCwd = resolved;
            cwdChanged = resolved;
          }
        } catch {
          // A command writing to fd 3 itself, or cd-ing outside the worktree:
          // keep the previous directory rather than trusting the report.
        }
      }

      const { rendered, isError } = renderForeground(result, timeoutMs, warning, cwdChanged);
      return text(rendered, isError);
    } catch (error) {
      return text(`Error running command: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  },
};

async function startBackground(
  command: string,
  cwd: string,
  root: string,
  warning: string | null,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (IS_WINDOWS) return text('run_in_background is not supported on Windows.', true);

  pruneShellJobs(root);
  const limit = Number(process.env.NORD_MAX_BACKGROUND_TASKS) || DEFAULT_MAX_BACKGROUND_JOBS;
  const running = countRunningJobs(root);
  if (running >= limit) {
    return text(`Background limit reached (${running}/${limit}). Stop one with KillShell or wait.`, true);
  }

  const jobId = newShellJobId();
  createJobDir(jobId, root);
  const exitPath = jobExitPath(jobId, root);
  const logFd = openJobLog(jobId, root);

  try {
    const child = spawn('/bin/bash', ['-c', backgroundPrelude(exitPath) + command], {
      cwd,
      windowsHide: true,
      // The kernel writes the child's output straight into the log, so it keeps
      // accumulating even if this MCP server is restarted mid-job.
      stdio: ['ignore', logFd, logFd],
      detached: true,
    });
    child.unref();

    const pid = child.pid ?? 0;
    if (!pid) return text('Could not start the background command.', true);

    const record: ShellJobRecord = {
      jobId,
      command,
      cwd,
      pid,
      startIdentity: await getProcessStartIdentity(pid),
      startedAt: new Date().toISOString(),
      readOffset: 0,
      status: 'running',
    };
    writeJobRecord(record, root);

    const lines = [];
    if (warning) lines.push(`[safety] ${warning}`);
    lines.push('Started in background.');
    lines.push(`bash_id: ${jobId}`);
    lines.push(`pid: ${pid}`);
    lines.push(`Poll with BashOutput(bash_id="${jobId}"), stop with KillShell(shell_id="${jobId}").`);
    return text(lines.join('\n'));
  } finally {
    closeSync(logFd);
  }
}

export const bashOutputTool: ToolDefinition<{ bash_id: z.ZodString }> = {
  name: 'BashOutput',
  description: 'Read new output from a background command started by Bash. Each call returns only what arrived since the previous call.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  schema: { bash_id: z.string().describe('The bash_id returned when the command was started.') },

  async handler(args): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const root = validateWorkingDirectory();
    const bashId = String(args?.bash_id ?? '');
    // Checked separately from the lookup so a mistyped id is distinguishable
    // from an unknown one — and so a traversal attempt says what it was.
    if (!isValidJobId(bashId)) return text(`invalid job id: ${bashId}`, true);
    const record = readJobRecord(bashId, root);
    if (!record) return text(`No such background job: ${bashId}`, true);

    const reconciled = await reconcileJob(record, root);
    const { chunk, nextOffset, capped } = readNewOutput(reconciled, { maxBytes: DEFAULT_STDOUT_MAX_BYTES }, root);
    writeJobRecord({ ...reconciled, readOffset: nextOffset }, root);

    const lines = [`Status: ${reconciled.status}`];
    if (reconciled.exitCode !== undefined) lines.push(`Exit code: ${reconciled.exitCode}`);
    if (capped) lines.push('[log has reached its size cap; older output was not retained]');
    lines.push('--- new output ---');
    lines.push(chunk.text.length ? chunk.text : '(no new output)');

    const isError = reconciled.status === 'killed' || (reconciled.exitCode ?? 0) !== 0;
    return text(lines.join('\n'), isError);
  },
};

export const killShellTool: ToolDefinition<{ shell_id: z.ZodString }> = {
  name: 'KillShell',
  description: 'Stop a background command started by Bash, terminating its whole process group.',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  schema: { shell_id: z.string().describe('The bash_id returned when the command was started.') },

  async handler(args): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const root = validateWorkingDirectory();
    const shellId = String(args?.shell_id ?? '');
    if (!isValidJobId(shellId)) return text(`invalid job id: ${shellId}`, true);
    const record = readJobRecord(shellId, root);
    if (!record) return text(`No such background job: ${shellId}`, true);

    const reconciled = await reconcileJob(record, root);
    if (reconciled.status !== 'running') {
      writeJobRecord(reconciled, root);
      return text(`Job ${reconciled.jobId} is already ${reconciled.status}.`);
    }

    // PID-reuse guard: never signal a pid whose start identity has changed.
    if (reconciled.startIdentity) {
      const liveness = await isProcessIdentityLive(reconciled.pid, reconciled.startIdentity);
      if (liveness === 'mismatch') {
        writeJobRecord({ ...reconciled, status: 'unknown' }, root);
        return text(`Refusing to signal pid ${reconciled.pid}: it no longer belongs to job ${reconciled.jobId}.`, true);
      }
    }

    const outcome = await gracefulKill(reconciled.pid, 3000);
    const after = await reconcileJob({ ...reconciled, status: 'running' }, root);
    const finalRecord: ShellJobRecord =
      after.status === 'running' && !isProcessAlive(reconciled.pid)
        ? { ...after, status: 'killed', endedAt: new Date().toISOString() }
        : after;
    writeJobRecord(finalRecord, root);

    return text(
      `Killed job ${finalRecord.jobId} (pid ${finalRecord.pid}): ${outcome}. Status: ${finalRecord.status}.`,
      outcome === 'failed',
    );
  },
};
