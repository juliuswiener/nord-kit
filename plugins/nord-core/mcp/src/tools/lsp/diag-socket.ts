/**
 * The MCP server's warm language servers, offered to the edit-diag hook.
 *
 * A hook is a fresh process per edit, so a pool it holds is always cold:
 * TypeScript 7.1 s per edit, measured. The MCP server lives for the whole
 * session and keeps its pool warm, so it answers on a Unix socket and the hook
 * asks there first. Vault: edit-diagnose-laeuft-ueber-den-warmen-mcp-server.
 *
 * One socket per server process: <tmpdir>/nord-lsp-<uid>/<pid>.sock. Any live
 * one will do -- servers are pooled per workspace root, not per session.
 * ponytail: the first socket that answers wins, no load spreading; add it if
 * several sessions ever queue up behind one server.
 *
 * Wire format: one JSON line in, one JSON line out, then close.
 */

import { createServer, createConnection } from 'net';
import { chmodSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { editDiagnostics } from './edit-diagnostics.js';
import type { EditDiagnosticsRequest, EditDiagnosticsResult } from './edit-diagnostics.js';

export function diagSocketDir(): string {
  return join(tmpdir(), `nord-lsp-${process.getuid ? process.getuid() : 0}`);
}

/** Start answering. Never throws: a diagnostics nicety must not break the MCP server. */
export function startDiagSocket(): void {
  try {
    const dir = diagSocketDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${process.pid}.sock`);
    if (existsSync(path)) unlinkSync(path);

    const server = createServer((conn) => {
      let buf = '';
      conn.setEncoding('utf8');
      conn.on('data', async (chunk) => {
        buf += chunk;
        const nl = buf.indexOf('\n');
        if (nl < 0) return;
        let reply: unknown;
        try {
          reply = await editDiagnostics(JSON.parse(buf.slice(0, nl)) as EditDiagnosticsRequest);
        } catch (e) {
          reply = { error: e instanceof Error ? e.message : String(e) };
        }
        conn.end(JSON.stringify(reply) + '\n');
      });
      conn.on('error', () => { /* the hook went away; nothing to answer */ });
    });
    server.on('error', () => { /* socket unusable; the hook falls back to in-process */ });
    server.listen(path, () => {
      try { chmodSync(path, 0o600); } catch { /* best effort */ }
    });
    // The socket must never be what keeps the MCP server alive after stdin closes.
    server.unref();

    // The MCP server's shutdown handlers end in process.exit, so 'exit' covers
    // them. A SIGKILLed server leaves the socket behind; requestEditDiagnostics
    // removes sockets of dead pids.
    process.once('exit', () => { try { unlinkSync(path); } catch { /* already gone */ } });
  } catch {
    // No socket: the hook computes in-process, slowly but correctly.
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function ask(path: string, req: EditDiagnosticsRequest, timeoutMs: number): Promise<EditDiagnosticsResult | null> {
  return new Promise((resolve) => {
    let buf = '';
    let done = false;
    const finish = (v: EditDiagnosticsResult | null) => { if (!done) { done = true; conn.destroy(); resolve(v); } };
    const conn = createConnection(path, () => conn.write(JSON.stringify(req) + '\n'));
    conn.setEncoding('utf8');
    conn.setTimeout(timeoutMs, () => finish(null));
    conn.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      try {
        const r = JSON.parse(buf.slice(0, nl));
        finish(r && Array.isArray(r.after) ? r as EditDiagnosticsResult : null);
      } catch { finish(null); }
    });
    conn.on('error', () => finish(null));
    conn.on('close', () => finish(null));
  });
}

/**
 * Ask a live MCP server. null = nobody answered; the caller computes in-process.
 * Sockets of dead processes are removed on the way.
 */
export async function requestEditDiagnostics(
  req: EditDiagnosticsRequest,
  timeoutMs: number,
): Promise<EditDiagnosticsResult | null> {
  const dir = diagSocketDir();
  let names: string[];
  try { names = readdirSync(dir); } catch { return null; }
  for (const name of names) {
    const m = /^(\d+)\.sock$/.exec(name);
    if (!m) continue;
    const path = join(dir, name);
    if (!alive(Number(m[1]))) {
      try { unlinkSync(path); } catch { /* raced */ }
      continue;
    }
    const r = await ask(path, req, timeoutMs);
    if (r) return r;
  }
  return null;
}
