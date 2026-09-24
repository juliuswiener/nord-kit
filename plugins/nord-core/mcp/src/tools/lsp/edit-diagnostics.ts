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
}

export interface EditDiagnosticsResult {
  before: Diagnostic[];
  after: Diagnostic[];
  answered: boolean;
  indexState: IndexState;
}

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
    if (beforeText === null) {
      await client.openDocument(file);
      after = await client.collectDiagnostics(file, budgetMs);
    } else {
      // baseSeq is -1 on a fresh open and the current publish counter when the
      // document was already open (a reused client), so the baseline is never
      // satisfied by the previous edit's publish.
      const baseSeq = await client.openDocumentWithText(file, beforeText);
      before = await client.collectDiagnostics(file, budgetMs, baseSeq);
      const sentAt = client.changeDocument(file, afterText);
      after = await client.collectDiagnostics(file, budgetMs, sentAt);
    }
    return { before, after, answered: client.diagnosticsAnswered(file), indexState: client.indexState };
  });
}
