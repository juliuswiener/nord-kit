/**
 * Before/after diagnostics for one edit -- the work the edit-diag hook needs.
 *
 * ONE implementation, two callers: the MCP server answers it over its socket
 * with servers it already keeps warm (diag-socket.ts), and the hook runs it
 * in-process when no socket answers. Vault:
 * edit-diagnose-laeuft-ueber-den-warmen-mcp-server.
 *
 * Both versions are asked about the REAL path over one connection, using the
 * in-memory document model (didOpen with the pre-edit text, didChange to the
 * post-edit text), so imports and project config resolve as on disk and the
 * file on disk is never touched.
 */

import { lspClientManager } from './client.js';
import type { Diagnostic, IndexState } from './client.js';

export interface EditDiagnosticsRequest {
  file: string;
  /** null = no baseline was captured; only the after-picture is collected. */
  beforeText: string | null;
  afterText: string;
  budgetMs: number;
  waitReadyMs: number;
  /**
   * How long to wait for the compiler check a save triggers (rust-analyzer:
   * cargo check). 0/absent = never send didSave, the behaviour of every other
   * language. Only servers with a flycheck concept ever see it.
   */
  flycheckMs?: number;
}

export interface EditDiagnosticsResult {
  before: Diagnostic[];
  after: Diagnostic[];
  answered: boolean;
  indexState: IndexState;
  /** 'n/a' = no save was sent; 'timeout' = rustc's verdict is NOT in `after`. */
  flycheck?: 'n/a' | 'done' | 'timeout';
  /** False = `before` holds no rustc verdict, so rustc errors in `after` may predate the edit. */
  rustcBaselineKnown?: boolean;
  /** Milliseconds from didSave: to the end of the flycheck, and to the first publish. */
  timing?: { flycheckMs: number; firstPublishMs: number };
}

// Longest wait for a flycheck to BEGIN after a save. Beyond that none is coming
// (file outside any crate, checkOnSave off) and waiting on only adds delay.
const FLYCHECK_START_GRACE_MS = 1500;

export async function editDiagnostics(req: EditDiagnosticsRequest): Promise<EditDiagnosticsResult> {
  const { file, beforeText, afterText, budgetMs, waitReadyMs } = req;
  return lspClientManager.runWithClientLease(file, async (client) => {
    if (waitReadyMs > 0) {
      const until = Date.now() + waitReadyMs;
      // Wait for POSITIVE readiness, not for the absence of "indexing": a server
      // that has not sent its first status yet reports "unknown".
      while (client.indexState !== 'ready' && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    let before: Diagnostic[] = [];
    let after: Diagnostic[];
    // rust-analyzer only: didSave starts cargo check, and rustc's errors (E0425,
    // E0599 ...) come from nowhere else. They arrive as publishDiagnostics with
    // source "rustc", never in the pull answer.
    const flycheckMs = client.supportsFlycheck ? (req.flycheckMs ?? 0) : 0;
    let rustcBefore: Diagnostic[] | null = null;
    if (beforeText === null) {
      await client.openDocument(file);
    } else {
      // baseSeq is -1 on a fresh open and the current publish counter when the
      // document was already open (a reused client), so the baseline is never
      // satisfied by the previous edit's publish.
      const baseSeq = await client.openDocumentWithText(file, beforeText);
      before = await client.collectDiagnostics(file, budgetMs, baseSeq);
      // The baseline costs no second flycheck: cargo check reads the file from
      // disk, which already holds the post-edit text, so the pre-edit text cannot
      // be checked without writing it. Baseline = the verdict of the previous
      // flycheck this warm client saw finish (null on a cold client). Limit: an
      // edit made behind this client's back (Bash, another tool) is not in it,
      // and then rustc errors that predate the edit are blamed on it.
      rustcBefore = flycheckMs > 0 ? client.rustcBaseline(file) : null;
      if (rustcBefore) before = before.concat(rustcBefore);
    }
    const sentAt = beforeText === null ? -1 : client.changeDocument(file, afterText);
    // Save before pulling, so cargo check runs while rust-analyzer answers the pull.
    const beginsAtSave = flycheckMs > 0 ? client.saveDocument(file) : 0;
    after = await client.collectDiagnostics(file, budgetMs, sentAt);
    let flycheck: EditDiagnosticsResult['flycheck'] = 'n/a';
    let timing: EditDiagnosticsResult['timing'];
    if (flycheckMs > 0) {
      const f = await client.awaitFlycheck(file, beginsAtSave, flycheckMs, FLYCHECK_START_GRACE_MS);
      flycheck = f.done ? 'done' : 'timeout';
      timing = { flycheckMs: f.flycheckMs, firstPublishMs: f.firstPublishMs };
      // Only a finished flycheck speaks for the post-edit text.
      if (f.done) after = after.concat(client.rustcDiagnostics(file));
    }
    return {
      before, after, answered: client.diagnosticsAnswered(file), indexState: client.indexState,
      flycheck, rustcBaselineKnown: flycheckMs > 0 && beforeText !== null ? rustcBefore !== null : undefined, timing,
    };
  });
}
