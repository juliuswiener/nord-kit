/**
 * Registry for background shell jobs.
 *
 * Deliberately NOT built on src/mcp/job-management.ts, whose JobStatus is hard
 * typed to provider 'codex' | 'gemini' and whose ALLOWED_SIGNALS excludes
 * SIGKILL by design. A shell that cannot stop a runaway process is not a
 * replacement for native Bash, so this registry owns its own lifecycle — but it
 * reuses the process primitives from src/platform/process-utils.ts rather than
 * adding a third hand-rolled process-group kill to the codebase.
 *
 * Restart-safe by construction, which matters because the MCP server is a child
 * of the session and may be restarted under a job:
 *   - the child writes straight to output.log via an inherited fd, so output
 *     keeps accumulating with no parent in the loop;
 *   - the exit code is written by a `trap … EXIT` inside the child, not by a
 *     parent 'close' handler;
 *   - liveness after a restart is re-derived from pid + start identity, so a
 *     recycled PID is reported as 'unknown' and never signalled.
 */

import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicWriteJsonSync } from './atomic-write.js';
import { getNordRoot } from './worktree-paths.js';
import { isProcessIdentityLive } from '../platform/process-utils.js';
import {
  createStreamCollector,
  DEFAULT_STDOUT_MAX_BYTES,
  type HeadTailLimits,
  type TruncatedOutput,
} from './truncate-output.js';

/** Job ids are short so a model can copy one without mangling it. */
const JOB_ID_RE = /^[0-9a-f]{8}$/;

/** Stop growing a log forever; a watcher left running for a day must not fill the disk. */
export const MAX_JOB_LOG_BYTES = 8 * 1024 * 1024;
const MAX_TERMINAL_JOBS = 50;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ShellJobStatus = 'running' | 'exited' | 'killed' | 'unknown';

export interface ShellJobRecord {
  jobId: string;
  command: string;
  cwd: string;
  pid: number;
  /** PID-reuse guard. null when the platform could not supply one. */
  startIdentity: string | null;
  startedAt: string;
  /** Byte offset already handed to the caller, so polls are incremental. */
  readOffset: number;
  status: ShellJobStatus;
  exitCode?: number;
  endedAt?: string;
}

export function getShellJobsDir(root?: string): string {
  return join(getNordRoot(root), 'state', 'shell-jobs');
}

export function newShellJobId(): string {
  return randomBytes(4).toString('hex');
}

/** Validated before any path join — the same defence findJobStatusFile applies. */
export function isValidJobId(jobId: string): boolean {
  return JOB_ID_RE.test(jobId);
}

function assertJobId(jobId: string): void {
  if (!isValidJobId(jobId)) throw new Error(`invalid job id: ${jobId}`);
}

export function jobDir(jobId: string, root?: string): string {
  assertJobId(jobId);
  return join(getShellJobsDir(root), jobId);
}

export const jobLogPath = (jobId: string, root?: string): string => join(jobDir(jobId, root), 'output.log');
export const jobExitPath = (jobId: string, root?: string): string => join(jobDir(jobId, root), 'exit');
export const jobMetaPath = (jobId: string, root?: string): string => join(jobDir(jobId, root), 'meta.json');

export function createJobDir(jobId: string, root?: string): string {
  const dir = jobDir(jobId, root);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Open the log for append and hand the fd to the child as stdout and stderr. */
export function openJobLog(jobId: string, root?: string): number {
  return openSync(jobLogPath(jobId, root), 'a');
}

export function writeJobRecord(rec: ShellJobRecord, root?: string): void {
  atomicWriteJsonSync(jobMetaPath(rec.jobId, root), rec);
}

export function readJobRecord(jobId: string, root?: string): ShellJobRecord | null {
  try {
    const raw = readFileSync(jobMetaPath(jobId, root), 'utf8');
    const parsed = JSON.parse(raw) as ShellJobRecord;
    return parsed && typeof parsed.pid === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

export function listJobRecords(root?: string): ShellJobRecord[] {
  const dir = getShellJobsDir(root);
  if (!existsSync(dir)) return [];
  const records: ShellJobRecord[] = [];
  for (const entry of readdirSync(dir)) {
    if (!JOB_ID_RE.test(entry)) continue;
    const rec = readJobRecord(entry, root);
    if (rec) records.push(rec);
  }
  return records;
}

export function countRunningJobs(root?: string): number {
  return listJobRecords(root).filter((r) => r.status === 'running').length;
}

/**
 * Re-derive a job's real state from the filesystem and the process table.
 *
 * The 'dead + no exit file' case is what makes a SIGKILLed job distinguishable
 * from one that exited on its own: the EXIT trap cannot run under SIGKILL, so
 * the missing file IS the signal.
 */
export async function reconcileJob(rec: ShellJobRecord, root?: string): Promise<ShellJobRecord> {
  if (rec.status !== 'running') return rec;

  const liveness = rec.startIdentity
    ? await isProcessIdentityLive(rec.pid, rec.startIdentity)
    : ('unknown' as const);

  if (liveness === 'live') return rec;
  if (liveness === 'unknown') return rec; // retry on the next poll rather than guess
  if (liveness === 'mismatch') {
    return { ...rec, status: 'unknown', endedAt: new Date().toISOString() };
  }

  const exitFile = jobExitPath(rec.jobId, root);
  if (existsSync(exitFile)) {
    const code = Number.parseInt(readFileSync(exitFile, 'utf8').trim(), 10);
    return {
      ...rec,
      status: 'exited',
      exitCode: Number.isFinite(code) ? code : undefined,
      endedAt: new Date().toISOString(),
    };
  }
  return { ...rec, status: 'killed', endedAt: new Date().toISOString() };
}

/**
 * Read whatever arrived since the last poll, truncated to the budget.
 *
 * Note the single shared cursor: two concurrent pollers of the same job split
 * the output between them rather than each seeing all of it.
 */
export function readNewOutput(
  rec: ShellJobRecord,
  limits: HeadTailLimits = { maxBytes: DEFAULT_STDOUT_MAX_BYTES },
  root?: string,
): { chunk: TruncatedOutput; nextOffset: number; capped: boolean } {
  const logPath = jobLogPath(rec.jobId, root);
  const collector = createStreamCollector(limits);

  if (!existsSync(logPath)) {
    return { chunk: collector.result(), nextOffset: rec.readOffset, capped: false };
  }

  const size = statSync(logPath).size;
  const capped = size > MAX_JOB_LOG_BYTES;
  const from = Math.min(rec.readOffset, size);
  if (size <= from) {
    return { chunk: collector.result(), nextOffset: from, capped };
  }

  const fullBuffer = readFileSync(logPath);
  collector.push(fullBuffer.subarray(from, size));
  return { chunk: collector.result(), nextOffset: size, capped };
}

/** Drop terminal jobs that are old or in excess, so the directory stays bounded. */
export function pruneShellJobs(root?: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS): void {
  const terminal = listJobRecords(root)
    .filter((r) => r.status !== 'running')
    .sort((a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt));

  const cutoff = Date.now() - maxAgeMs;
  terminal.forEach((rec, index) => {
    const endedMs = Date.parse(rec.endedAt ?? rec.startedAt);
    const tooOld = Number.isFinite(endedMs) && endedMs < cutoff;
    if (tooOld || index >= MAX_TERMINAL_JOBS) {
      try { rmSync(jobDir(rec.jobId, root), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });
}
