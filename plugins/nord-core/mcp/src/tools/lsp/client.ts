/**
 * LSP Client Implementation
 *
 * Manages connections to language servers using JSON-RPC 2.0 over stdio.
 * Handles server lifecycle, message buffering, and request/response matching.
 */

import { spawn, ChildProcess } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, parse, join, basename } from 'path';
import { pathToFileURL } from 'url';
import {
  resolveDevContainerContext,
  hostUriToContainerUri,
  containerUriToHostUri
} from './devcontainer.js';
import type { DevContainerContext } from './devcontainer.js';
import type { LspServerConfig } from './servers.js';
import { getServerForFile, commandExists } from './servers.js';

/** Default timeout (ms) for LSP requests. Override with NORD_LSP_TIMEOUT_MS env var. */
export const DEFAULT_LSP_REQUEST_TIMEOUT_MS: number = (() => {
  return readPositiveIntEnv('NORD_LSP_TIMEOUT_MS', 15_000);
})();

/**
 * LSP `ContentModified` (spec error code). The server's state changed between
 * request and response — typically because the file was edited while the
 * request was in flight. The spec calls this out as expected and transient:
 * the client is supposed to ask again, not to report a failure.
 */
export const LSP_CONTENT_MODIFIED = -32801;

/**
 * LSP `ServerCancelled` (spec error code). The server abandoned the request of
 * its own accord; the spec says the client should re-send it.
 *
 * Measured on rust-analyzer, cold crate, 12 consecutive edit-diagnostics rounds
 * against ONE long-lived client: requests 3, 4 and 5 came back -32802 "server
 * cancelled the request", and 6 onwards succeeded. It fires while the crate
 * graph is being (re)loaded, so a client that is discarded after every request
 * never lives long enough to see it — which is why it only surfaced once
 * language servers started being reused across edits.
 */
export const LSP_SERVER_CANCELLED = -32802;

/**
 * JSON-RPC "method not found". A server that advertises `diagnosticProvider`
 * and then answers `textDocument/diagnostic` with this is contradicting its own
 * capability reply — measured on vscode-json-language-server, which advertises
 * the provider and responds -32601 "Unhandled method textDocument/diagnostic".
 */
export const LSP_METHOD_NOT_FOUND = -32601;

/**
 * How long a push-model server must stay quiet before its latest
 * publishDiagnostics is taken as final.
 *
 * Measured today, timed from didOpen: taplo publishes TWICE for a file with a
 * duplicate key — `count=0` and then `count=2`, both inside the same
 * millisecond — and three times (all empty) for a clean file. Waking on the
 * first publish therefore returns whichever set happened to land before the
 * waiter's microtask ran; on broken.toml that was the empty one, and TOML
 * reported "No error diagnostics" for a file with a conflicting key.
 *
 * No server observed sends `version` on publishDiagnostics, so the publish
 * cannot be matched to the document revision that caused it. A quiet period is
 * what is left. It costs nothing on a warm repeat: the last publish is already
 * older than the window, so the check passes immediately.
 */
export const DIAGNOSTICS_SETTLE_MS = readPositiveIntEnv('NORD_LSP_DIAGNOSTICS_SETTLE_MS', 150);

/** How many times a ContentModified response is re-sent before giving up. */
export const CONTENT_MODIFIED_MAX_ATTEMPTS = 3;

/** Backoff before each ContentModified retry, in ms. */
const CONTENT_MODIFIED_BACKOFF_MS = [50, 150];

/**
 * Codes the spec defines as transient, meaning "ask again", not "this failed".
 * Matched numerically; the accompanying message is server-chosen prose.
 */
const RETRYABLE_LSP_CODES = new Set([LSP_CONTENT_MODIFIED, LSP_SERVER_CANCELLED]);

/**
 * How long an index-dependent method keeps re-asking while the server reports
 * it is still indexing. Measured against rust-analyzer on a cold crate: the
 * index becomes usable ~2.1s after connect, so this leaves headroom without
 * turning a genuinely empty answer into a long stall.
 */
export const INDEX_READY_RETRY_BUDGET_MS = readPositiveIntEnv('NORD_LSP_INDEX_RETRY_BUDGET_MS', 5_000);

/**
 * With no readiness signal from the server at all (clangd, gopls), treat the
 * first few seconds after connect as possibly-still-indexing. Only used to
 * qualify an EMPTY answer — never to delay a good one.
 */
export const INDEX_COLD_WINDOW_MS = readPositiveIntEnv('NORD_LSP_COLD_WINDOW_MS', 5_000);

/**
 * What the server has told us about its index, at the moment an answer came back.
 *
 * - `ready`    — the server said it is quiescent, or it offers no signal and the
 *                cold window has passed. An empty answer is a fact about the code.
 * - `indexing` — the server explicitly said it is still working. An empty answer
 *                is a fact about the server, not about the code.
 * - `unknown`  — the server offers no readiness signal and we are still inside
 *                the cold window. An empty answer cannot be trusted either way.
 */
export type IndexState = 'ready' | 'indexing' | 'unknown';

/**
 * An error carried back from a JSON-RPC error response, with the numeric code
 * preserved.
 *
 * The code is the only reliable way to recognise ContentModified: the message
 * is server-chosen prose ("content modified", "document was modified", a
 * localised string) and matching on it breaks the moment a server rephrases it.
 */
export class LspResponseError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'LspResponseError';
    this.code = code;
    this.data = data;
  }
}

/** Methods whose answer is drawn from the crate-wide index rather than the open file.
 *
 * Measured against rust-analyzer on a cold crate: every method below returns an
 * empty result with no error until the index is built, while
 * textDocument/documentSymbol (purely syntactic) is correct immediately.
 * hover and definition are deliberately absent — they resolve from local context
 * within ~100ms, and an empty answer from them reads as "nothing at this
 * position", not as a claim about the whole codebase. */
const INDEX_DEPENDENT_METHODS = new Set([
  'textDocument/implementation',
  'textDocument/references',
  'textDocument/prepareCallHierarchy',
  'callHierarchy/incomingCalls',
  'callHierarchy/outgoingCalls',
  'workspace/symbol'
]);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** An LSP result that carries no information: null, undefined, or an empty array. */
function isEmptyLspResult(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return Array.isArray(value) && value.length === 0;
}

export function getLspRequestTimeout(
  serverConfig: Pick<LspServerConfig, 'initializeTimeoutMs'>,
  method: string,
  baseTimeout = DEFAULT_LSP_REQUEST_TIMEOUT_MS
): number {
  if (method === 'initialize' && serverConfig.initializeTimeoutMs) {
    return Math.max(baseTimeout, serverConfig.initializeTimeoutMs);
  }

  return baseTimeout;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const env = process.env[name];
  if (!env) {
    return fallback;
  }

  const parsed = parseInt(env, 10);
  return !isNaN(parsed) && parsed > 0 ? parsed : fallback;
}

/** Convert a file path to a valid file:// URI (cross-platform) */
function fileUri(filePath: string): string {
  return pathToFileURL(resolve(filePath)).href;
}

// LSP Protocol Types
export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

export interface Hover {
  contents: string | { kind: string; value: string } | Array<string | { kind: string; value: string }>;
  range?: Range;
}

export interface Diagnostic {
  range: Range;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

export interface DocumentSymbol {
  name: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

export interface SymbolInformation {
  name: string;
  kind: number;
  location: Location;
  containerName?: string;
}

export interface WorkspaceEdit {
  changes?: Record<string, Array<{ range: Range; newText: string }>>;
  documentChanges?: Array<{ textDocument: TextDocumentIdentifier; edits: Array<{ range: Range; newText: string }> }>;
}

export interface CodeAction {
  title: string;
  kind?: string;
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  edit?: WorkspaceEdit;
  command?: { title: string; command: string; arguments?: unknown[] };
}

export interface CallHierarchyItem {
  name: string;
  kind: number;
  detail?: string;
  uri: string;
  range: Range;
  selectionRange: Range;
  /** Server-defined opaque state. Only meaningful to the server that issued it. */
  data?: unknown;
}

export interface CallHierarchyIncomingCall {
  /** The caller. */
  from: CallHierarchyItem;
  /** Where inside `from` the call sites are. */
  fromRanges: Range[];
}

export interface CallHierarchyOutgoingCall {
  /** The callee. */
  to: CallHierarchyItem;
  /** Where inside the queried symbol the call sites are. */
  fromRanges: Range[];
}

/**
 * A call-hierarchy answer plus the symbol it was answered for.
 *
 * `null` (no result) and `{ calls: [] }` are different answers: the first means
 * the position resolved to no symbol, the second means the symbol has no calls.
 * Collapsing them would make a still-indexing server look exactly like a leaf
 * function — measured against rust-analyzer, prepareCallHierarchy returns null
 * for ~2-3s after connect before returning the symbol.
 */
export interface CallHierarchyResult<T> {
  item: CallHierarchyItem;
  calls: T[];
}

/**
 * JSON-RPC Request/Response types
 */
/** Inbound server request IDs may be strings or integer numbers. */
type JsonRpcServerRequestId = number | string;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcServerRequest {
  jsonrpc: '2.0';
  id: JsonRpcServerRequestId;
  method: string;
  params?: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcServerRequestId;
  error: { code: number; message: string };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

/**
 * LSP Client class
 */
export class LspClient {
  private static readonly MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private buffer = Buffer.alloc(0);
  private openDocuments = new Set<string>();
  private diagnostics = new Map<string, Diagnostic[]>();
  private diagnosticWaiters = new Map<string, Array<() => void>>();
  /** When the newest publishDiagnostics for a URI arrived. Basis for the settle window. */
  private diagnosticsUpdatedAt = new Map<string, number>();
  /**
   * How many publishDiagnostics have arrived for a URI.
   *
   * A counter, not a timestamp: Date.now() has millisecond granularity and the
   * publish answering a didChange routinely lands in the SAME millisecond the
   * change was sent, so "newer than sentAt" was false for an answer that had
   * already arrived. Measured cost of that off-by-one-millisecond: a TOML edit
   * that should take ~600ms sat for the full 4s budget and then returned the
   * right answer anyway.
   */
  private diagnosticsSeq = new Map<string, number>();
  /** Latest didChange version per open document, for full-text replacements. */
  private documentVersions = new Map<string, number>();
  /** URIs the server has actually answered about. See diagnosticsAnswered(). */
  private diagnosticsAnsweredFor = new Set<string>();
  private workspaceRoot: string;
  private serverConfig: LspServerConfig;
  private devContainerContext: DevContainerContext | null;
  private initialized = false;
  private _serverCapabilities: Record<string, unknown> | null = null;
  private _supportsPullDiagnostics = false;
  /** Set once a server that advertised pull diagnostics has refused the request. */
  private pullDiagnosticsRefused = false;
  /** When `initialize` completed. Basis for the cold window when a server offers no readiness signal. */
  private connectedAt = 0;
  /** Whether this server has ever sent a readiness notification we understand. */
  private sawReadinessSignal = false;
  /** Latest readiness the server reported. Only meaningful once sawReadinessSignal is true. */
  private serverQuiescent = false;

  constructor(workspaceRoot: string, serverConfig: LspServerConfig, devContainerContext: DevContainerContext | null = null) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.serverConfig = serverConfig;
    this.devContainerContext = devContainerContext;
  }

  /**
   * Start the LSP server and initialize the connection
   */
  async connect(): Promise<void> {
    if (this.process) {
      return; // Already connected
    }

    const spawnCommand = this.devContainerContext ? 'docker' : this.serverConfig.command;

    if (!commandExists(spawnCommand)) {
      throw new Error(
        this.devContainerContext
          ? `Docker CLI not found. Required to start '${this.serverConfig.command}' inside container ${this.devContainerContext.containerId}.`
          : `Language server '${this.serverConfig.command}' not found.\nInstall with: ${this.serverConfig.installHint}`
      );
    }

    return new Promise((resolve, reject) => {
      // On Windows, npm-installed binaries are .cmd scripts that require
      // shell execution. Without this, spawn() fails with ENOENT. (#569)
      // Safe: server commands come from a hardcoded registry (servers.ts),
      // not user input, so shell metacharacter injection is not a concern.
      const command = this.devContainerContext ? 'docker' : this.serverConfig.command;
      const args = this.devContainerContext
        ? ['exec', '-i', '-w', this.devContainerContext.containerWorkspaceRoot, this.devContainerContext.containerId, this.serverConfig.command, ...this.serverConfig.args]
        : this.serverConfig.args;

      this.process = spawn(command, args, {
        cwd: this.workspaceRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: !this.devContainerContext && process.platform === 'win32'
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleData(data);
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        // Log stderr for debugging but don't fail
        console.error(`LSP stderr: ${data.toString()}`);
      });

      this.process.on('error', (error) => {
        reject(new Error(`Failed to start LSP server: ${error.message}`));
      });

      this.process.on('exit', (code) => {
        this.process = null;
        this.initialized = false;
        if (code !== 0) {
          console.error(`LSP server exited with code ${code}`);
        }
        // Reject all pending requests to avoid unresolved promises
        this.rejectPendingRequests(new Error(`LSP server exited (code ${code})`));
      });

      // Send initialize request
      this.initialize()
        .then(() => {
          this.initialized = true;
          this.connectedAt = Date.now();
          resolve();
        })
        .catch(reject);
    });
  }

  /**
   * Pid of the language server this client owns, if it is running.
   *
   * Exposed so the daemon can report which processes it is responsible for, and
   * so a leak probe can count language servers by ownership rather than by
   * pattern-matching a process list.
   */
  get serverPid(): number | undefined {
    return this.process?.pid;
  }

  /**
   * Synchronously kill the LSP server process.
   * Used in process exit handlers where async operations are not possible.
   */
  forceKill(): void {
    if (this.process) {
      try {
        this.process.kill('SIGKILL');
      } catch {
        // Ignore errors during kill
      }
      this.process = null;
      this.initialized = false;
      // Wake diagnostic waiters to prevent resource leaks
      for (const waiters of this.diagnosticWaiters.values()) {
        for (const wake of waiters) wake();
      }
      this.diagnosticWaiters.clear();
    }
  }

  /**
   * Disconnect from the LSP server
   */
  async disconnect(): Promise<void> {
    if (!this.process) return;

    try {
      // Short timeout for graceful shutdown — don't block forever
      await this.request('shutdown', null, 3000);
      this.notify('exit', null);
    } catch {
      // Ignore errors during shutdown
    } finally {
      // Always kill the process regardless of shutdown success
      if (this.process) {
        this.process.kill();
        this.process = null;
      }
      this.initialized = false;
      this.rejectPendingRequests(new Error('Client disconnected'));
      this.openDocuments.clear();
      this.diagnostics.clear();
      // Wake all diagnostic waiters so their setTimeout closures can be GC'd
      for (const waiters of this.diagnosticWaiters.values()) {
        for (const wake of waiters) wake();
      }
      this.diagnosticWaiters.clear();
    }
  }

  /**
   * Reject all pending requests with the given error.
   * Called on process exit to avoid dangling unresolved promises.
   */
  private rejectPendingRequests(error: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Handle incoming data from the server
   */
  private handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    // Prevent unbounded buffer growth from misbehaving LSP server
    if (this.buffer.length > LspClient.MAX_BUFFER_SIZE) {
      console.error('[LSP] Response buffer exceeded 50MB limit, resetting');
      this.buffer = Buffer.alloc(0);
      this.rejectPendingRequests(new Error('LSP response buffer overflow'));
      return;
    }

    while (true) {
      // Look for Content-Length header
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.subarray(0, headerEnd).toString();
      const contentLengthMatch = header.match(/Content-Length: (\d+)/i);
      if (!contentLengthMatch) {
        // Invalid header, try to recover
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.buffer.length < messageEnd) {
        break; // Not enough data yet
      }

      const messageJson = this.buffer.subarray(messageStart, messageEnd).toString();
      this.buffer = this.buffer.subarray(messageEnd);

      try {
        const message = JSON.parse(messageJson);
        this.handleMessage(message);
      } catch {
        // Invalid JSON, skip
      }
    }
  }

  /**
   * Handle a parsed JSON-RPC message
   */
  private handleMessage(message: JsonRpcResponse | JsonRpcNotification | JsonRpcServerRequest): void {
    const record = message as unknown as Record<string, unknown>;
    const hasOwnMethod = Object.prototype.hasOwnProperty.call(message, 'method');
    const hasOwnId = Object.prototype.hasOwnProperty.call(message, 'id');

    if (hasOwnMethod && typeof record.method === 'string') {
      const id = record.id;
      if (hasOwnId) {
        if (typeof id === 'string' || (typeof id === 'number' && Number.isInteger(id))) {
          this.handleServerRequest(message as JsonRpcServerRequest);
        }
        return;
      }

      this.handleNotification(message as JsonRpcNotification);
      return;
    }

    if (!hasOwnMethod && hasOwnId && typeof record.id === 'number') {
      // Response to a request
      const response = message as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);

        if (response.error) {
          // Keep the numeric code: request() needs it to tell a transient
          // ContentModified apart from a real failure.
          pending.reject(new LspResponseError(
            response.error.code,
            response.error.message,
            response.error.data
          ));
        } else {
          pending.resolve(response.result);
        }
      }
    }
  }

  /** Reply to unsupported server requests without claiming they succeeded. */
  private handleServerRequest(request: JsonRpcServerRequest): void {
    const error = request.method === 'client/registerCapability'
      ? { code: -32803, message: 'Dynamic capability registration is not supported' }
      : { code: -32601, message: 'Method not found' };
    const response: JsonRpcErrorResponse = { jsonrpc: '2.0', id: request.id, error };
    const content = JSON.stringify(response);
    this.process?.stdin?.write(`Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`);
  }

  /**
   * Handle server notifications
   */
  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method === 'textDocument/publishDiagnostics') {
      const params = this.translateIncomingPayload(notification.params) as { uri: string; diagnostics: Diagnostic[] };
      this.diagnostics.set(params.uri, params.diagnostics);
      this.diagnosticsUpdatedAt.set(params.uri, Date.now());
      this.diagnosticsSeq.set(params.uri, (this.diagnosticsSeq.get(params.uri) ?? 0) + 1);
      // Wake any waiters registered via waitForDiagnostics()
      const waiters = this.diagnosticWaiters.get(params.uri);
      if (waiters && waiters.length > 0) {
        this.diagnosticWaiters.delete(params.uri);
        for (const wake of waiters) wake();
      }
      return;
    }

    // rust-analyzer's readiness signal, enabled by the
    // experimental.serverStatusNotification capability we advertise.
    //
    // `quiescent` is the flag that matters: measured on a cold crate it turns
    // true 39ms BEFORE textDocument/implementation starts returning results,
    // so an answer taken while it is false is not yet trustworthy.
    //
    // $/progress is deliberately NOT used for this. Measured on the same crate,
    // every progress token had closed by t+144ms while the index stayed unusable
    // until t+2104ms — gating on "no progress in flight" would have declared the
    // server ready ~2 seconds early and reported the same false empty answer.
    if (notification.method === 'experimental/serverStatus') {
      const params = notification.params as { quiescent?: boolean } | undefined;
      if (typeof params?.quiescent === 'boolean') {
        this.sawReadinessSignal = true;
        this.serverQuiescent = params.quiescent;
      }
      return;
    }
    // Handle other notifications as needed
  }

  /**
   * What we currently know about the server's index.
   *
   * Reading this is free — it never talks to the server — so a warm, non-empty
   * answer costs nothing to qualify.
   */
  get indexState(): IndexState {
    if (this.sawReadinessSignal) {
      return this.serverQuiescent ? 'ready' : 'indexing';
    }
    // Not connected yet: we know nothing, and defaulting to 'ready' would let a
    // client claim an empty answer is a fact before it has even asked anything.
    if (this.connectedAt === 0) {
      return 'unknown';
    }
    // No signal from this server. Assume it needed a moment after connect, then
    // stop second-guessing it — otherwise every empty answer forever carries a
    // hedge it hasn't earned.
    if (Date.now() - this.connectedAt < INDEX_COLD_WINDOW_MS) {
      return 'unknown';
    }
    return 'ready';
  }

  /**
   * Send a request to the server, retrying transient failures.
   *
   * `ContentModified` (-32801) means the server's state changed between request
   * and response — a file was edited while the request was in flight. The spec
   * treats it as expected and transient. Surfacing it verbatim produced
   * "Error in goto implementation: content modified", which reads as a dead end
   * and pushes a caller back to grep; re-asking is what it actually calls for.
   *
   * `ServerCancelled` (-32802) is the same deal from the other side: the server
   * dropped the request itself and the spec says to re-send. It only became
   * reachable once clients started outliving a single request — see the constant.
   *
   * Matching is on the numeric code, never the message: the message is
   * server-chosen prose and may be reworded or localised.
   */
  private async request<T>(method: string, params: unknown, timeout?: number): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.sendRequestOnce<T>(method, params, timeout);
      } catch (error) {
        const retryable = error instanceof LspResponseError
          && RETRYABLE_LSP_CODES.has(error.code);

        if (!retryable) {
          throw error;
        }

        if (attempt >= CONTENT_MODIFIED_MAX_ATTEMPTS) {
          // Persistent — say so, rather than letting it look like a one-off.
          // The surviving code is the one the server actually sent: reporting a
          // ServerCancelled storm as "content kept changing" would send the
          // reader looking for a writer that does not exist.
          const wasCancelled = error.code === LSP_SERVER_CANCELLED;
          throw new LspResponseError(
            error.code,
            wasCancelled
              ? `the server cancelled request '${method}' (LSP ServerCancelled) on all ` +
                `${CONTENT_MODIFIED_MAX_ATTEMPTS} attempts. This normally happens while a ` +
                `workspace is being loaded and clears once indexing settles.`
              : `the server reported its content kept changing under request '${method}' ` +
                `(LSP ContentModified) on all ${CONTENT_MODIFIED_MAX_ATTEMPTS} attempts. ` +
                `This is normally transient and clears on its own; if the file is being ` +
                `written to continuously, retry once it settles.`
          );
        }

        await sleep(CONTENT_MODIFIED_BACKOFF_MS[attempt - 1] ?? 150);
      }
    }
  }

  /**
   * Ask an index-dependent method, re-asking while the server says it is still
   * indexing and the answer is empty.
   *
   * The shape matters: a non-empty answer returns on the first pass, and so does
   * an empty one from a server that reports itself ready. Only the combination
   * "empty AND the server SAYS it is indexing" waits — which is the one case
   * where today's answer is simply wrong.
   *
   * A server that reports nothing ('unknown') is deliberately NOT retried. We
   * have no evidence it is busy, and blindly re-asking cost a measured 5.2s on a
   * genuinely empty clangd query instead of 0.23s. The caller is told the answer
   * is inconclusive instead — see indexCaveat() — which is what we actually know.
   */
  private async requestIndexed<T>(method: string, params: unknown, timeout?: number): Promise<T> {
    let result = await this.request<T>(method, params, timeout);

    if (!isEmptyLspResult(result) || !INDEX_DEPENDENT_METHODS.has(method)) {
      return result;
    }

    const deadline = Date.now() + INDEX_READY_RETRY_BUDGET_MS;
    let backoff = 150;

    while (this.indexState === 'indexing' && Date.now() < deadline) {
      await sleep(Math.min(backoff, Math.max(0, deadline - Date.now())));
      backoff = Math.min(backoff * 2, 1000);

      result = await this.request<T>(method, params, timeout);
      if (!isEmptyLspResult(result)) {
        return result;
      }
    }

    return result;
  }

  /**
   * Send a request to the server (single attempt)
   */
  private async sendRequestOnce<T>(method: string, params: unknown, timeout?: number): Promise<T> {
    if (!this.process?.stdin) {
      throw new Error('LSP server not connected');
    }

    const effectiveTimeout = timeout ?? getLspRequestTimeout(this.serverConfig, method);

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    const content = JSON.stringify(request);
    const message = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP request '${method}' timed out after ${effectiveTimeout}ms`));
      }, effectiveTimeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timeoutHandle
      });

      this.process?.stdin?.write(message);
    });
  }

  /**
   * Send a notification to the server (no response expected)
   */
  private notify(method: string, params: unknown): void {
    if (!this.process?.stdin) return;

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params
    };

    const content = JSON.stringify(notification);
    const message = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;
    this.process.stdin.write(message);
  }

  /**
   * Initialize the LSP connection
   */
  private async initialize(): Promise<void> {
    const initResult = await this.request<{ capabilities?: Record<string, unknown> }>('initialize', {
      processId: process.pid,
      rootUri: this.getWorkspaceRootUri(),
      rootPath: this.getServerWorkspaceRoot(),
      // We advertise workspace.workspaceFolders below, so a server is entitled
      // to read this list — and omitting it is not the same as not supporting
      // folders. Measured on taplo: with the field absent it logs "using
      // detached workspace" and answers every .toml with the single hint
      // "this document has been excluded" instead of linting it, so a file with
      // a duplicate key reported clean. Sending the one folder we already know
      // about turns the same file into "conflicting keys" (severity 1).
      workspaceFolders: [{
        uri: this.getWorkspaceRootUri(),
        name: basename(this.getServerWorkspaceRoot()) || 'workspace'
      }],
      capabilities: {
        textDocument: {
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: true },
          implementation: { linkSupport: true },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: [] } } },
          rename: { prepareSupport: true },
          // Omitting dynamicRegistration means false, which is what we want:
          // handleServerRequest rejects client/registerCapability.
          callHierarchy: {},
          publishDiagnostics: {
            relatedInformation: true,
            tagSupport: { valueSet: [1, 2] }
          }
        },
        workspace: {
          symbol: {},
          workspaceFolders: true
        },
        // Opt in to rust-analyzer's readiness notification. Without this the
        // server sends nothing at all and a still-indexing answer is
        // indistinguishable from an empty one. Servers that don't know the
        // capability ignore it.
        experimental: {
          serverStatusNotification: true
        }
      },
      initializationOptions: this.serverConfig.initializationOptions || {}
    }, getLspRequestTimeout(this.serverConfig, 'initialize'));

    this._serverCapabilities = initResult?.capabilities ?? null;
    this._supportsPullDiagnostics = !!this._serverCapabilities?.diagnosticProvider;

    this.notify('initialized', {});
  }

  /**
   * Open a document for editing
   */
  async openDocument(filePath: string): Promise<void> {
    const hostUri = fileUri(filePath);
    const uri = this.toServerUri(hostUri);

    if (this.openDocuments.has(hostUri)) return;

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = readFileSync(filePath, 'utf-8');
    const languageId = this.getLanguageId(filePath);

    this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content
      }
    });

    this.openDocuments.add(hostUri);

    // Wait a bit for the server to process the document
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Close a document
   */
  closeDocument(filePath: string): void {
    const hostUri = fileUri(filePath);
    const uri = this.toServerUri(hostUri);

    if (!this.openDocuments.has(hostUri)) return;

    this.notify('textDocument/didClose', {
      textDocument: { uri }
    });

    this.openDocuments.delete(hostUri);
  }

  /**
   * Get the language ID for a file
   */
  private getLanguageId(filePath: string): string {
    // parse().ext correctly handles dotfiles: parse('.eslintrc').ext === ''
    // whereas split('.').pop() returns 'eslintrc' for dotfiles (incorrect)
    const ext = parse(filePath).ext.slice(1).toLowerCase();
    const langMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescriptreact',
      'js': 'javascript',
      'jsx': 'javascriptreact',
      'mts': 'typescript',
      'cts': 'typescript',
      'mjs': 'javascript',
      'cjs': 'javascript',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'c': 'c',
      'h': 'c',
      'cpp': 'cpp',
      'cc': 'cpp',
      'hpp': 'cpp',
      'java': 'java',
      'json': 'json',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'yaml': 'yaml',
      'yml': 'yaml',
      'php': 'php',
      'phtml': 'php',
      'rb': 'ruby',
      'rake': 'ruby',
      'gemspec': 'ruby',
      'erb': 'ruby',
      'lua': 'lua',
      'kt': 'kotlin',
      'kts': 'kotlin',
      'ex': 'elixir',
      'exs': 'elixir',
      'heex': 'elixir',
      'eex': 'elixir',
      'cs': 'csharp'
    };
    return langMap[ext] || ext;
  }

  /**
   * Convert file path to URI and ensure document is open
   */
  private async prepareDocument(filePath: string): Promise<string> {
    await this.openDocument(filePath);
    return this.toServerUri(fileUri(filePath));
  }

  // LSP Request Methods

  /**
   * Get hover information at a position
   */
  async hover(filePath: string, line: number, character: number): Promise<Hover | null> {
    const uri = await this.prepareDocument(filePath);
    const result = await this.request<Hover | null>('textDocument/hover', {
      textDocument: { uri },
      position: { line, character }
    });
    return this.translateIncomingPayload(result) as Hover | null;
  }

  /**
   * Go to definition
   */
  async definition(filePath: string, line: number, character: number): Promise<Location | Location[] | null> {
    const uri = await this.prepareDocument(filePath);
    const result = await this.request<Location | Location[] | null>('textDocument/definition', {
      textDocument: { uri },
      position: { line, character }
    });
    return this.translateIncomingPayload(result) as Location | Location[] | null;
  }

  /**
   * Go to implementation
   */
  async implementation(filePath: string, line: number, character: number): Promise<Location | Location[] | null> {
    const uri = await this.prepareDocument(filePath);
    const result = await this.requestIndexed<Location | Location[] | null>('textDocument/implementation', {
      textDocument: { uri },
      position: { line, character }
    });
    return this.translateIncomingPayload(result) as Location | Location[] | null;
  }

  /**
   * Find all references
   */
  async references(filePath: string, line: number, character: number, includeDeclaration = true): Promise<Location[] | null> {
    const uri = await this.prepareDocument(filePath);
    const result = await this.requestIndexed<Location[] | null>('textDocument/references', {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration }
    });
    return this.translateIncomingPayload(result) as Location[] | null;
  }

  /**
   * Get document symbols
   */
  async documentSymbols(filePath: string): Promise<DocumentSymbol[] | SymbolInformation[] | null> {
    const uri = await this.prepareDocument(filePath);
    const result = await this.request<DocumentSymbol[] | SymbolInformation[] | null>('textDocument/documentSymbol', {
      textDocument: { uri }
    });
    return this.translateIncomingPayload(result) as DocumentSymbol[] | SymbolInformation[] | null;
  }

  /**
   * Search workspace symbols
   */
  async workspaceSymbols(query: string): Promise<SymbolInformation[] | null> {
    const result = await this.requestIndexed<SymbolInformation[] | null>('workspace/symbol', { query });
    return this.translateIncomingPayload(result) as SymbolInformation[] | null;
  }

  /**
   * Get diagnostics for a file
   */
  getDiagnostics(filePath: string): Diagnostic[] {
    const uri = fileUri(filePath);
    return this.diagnostics.get(uri) || [];
  }

  /**
   * Whether the server supports LSP 3.17 pull diagnostics (textDocument/diagnostic).
   */
  get supportsPullDiagnostics(): boolean {
    return this._supportsPullDiagnostics;
  }

  /**
   * Request diagnostics via the LSP 3.17 pull model (textDocument/diagnostic).
   * Only call when supportsPullDiagnostics is true.
   */
  async pullDiagnostics(filePath: string): Promise<Diagnostic[]> {
    const uri = this.toServerUri(fileUri(filePath));
    const result = await this.request<{ kind?: string; items?: Array<Record<string, unknown>> }>(
      'textDocument/diagnostic',
      { textDocument: { uri } }
    );
    return ((result?.items) || []).map((d: Record<string, unknown>) => ({
      range: d.range as Range,
      message: d.message as string,
      severity: d.severity as number | undefined,
      source: d.source as string | undefined,
      code: d.code as string | number | undefined,
    }));
  }

  /**
   * Diagnostics for a file, by whichever model the server actually honours.
   *
   * Capability advertisement is not a promise. Measured today:
   *   - vscode-json-language-server advertises `diagnosticProvider` and answers
   *     `textDocument/diagnostic` with -32601 "Unhandled method". The pull-only
   *     path turned that into "Error in diagnostics: ..." and reported nothing,
   *     while the very same server was pushing "Trailing comma" over
   *     publishDiagnostics the whole time.
   *   - taplo and yaml-language-server advertise no provider at all and are
   *     push-only.
   *
   * So: try pull when it is advertised, and on a *method not found* refusal fall
   * back to the push cache and stop asking for the rest of the connection. Only
   * -32601 is treated this way — a timeout or ContentModified is a real failure
   * and must not be silently downgraded into "the server had nothing to say".
   */
  async collectDiagnostics(filePath: string, pushWaitMs = 30_000, publishedAfterSeq = -1): Promise<Diagnostic[]> {
    if (this._supportsPullDiagnostics && !this.pullDiagnosticsRefused) {
      try {
        const pulled = await this.pullDiagnostics(filePath);
        this.diagnosticsAnsweredFor.add(fileUri(filePath));
        return pulled;
      } catch (error) {
        const refused = error instanceof LspResponseError
          && error.code === LSP_METHOD_NOT_FOUND;
        if (!refused) {
          throw error;
        }
        this.pullDiagnosticsRefused = true;
      }
    }

    await this.waitForDiagnosticsSettled(filePath, pushWaitMs, DIAGNOSTICS_SETTLE_MS, publishedAfterSeq);
    if (this.diagnosticsUpdatedAt.has(fileUri(filePath))) {
      this.diagnosticsAnsweredFor.add(fileUri(filePath));
    }
    return this.getDiagnostics(filePath);
  }

  /**
   * Whether the server has actually said anything about this file — a pull
   * response, or at least one publishDiagnostics.
   *
   * An empty diagnostic list is ambiguous on its own: it is what a clean file
   * and a server that has not looked yet both produce. This separates the two,
   * so a caller can decline to claim "clean" rather than guess. It is about
   * diagnostics specifically, unlike indexState, which describes the
   * workspace-wide index that reference/implementation queries depend on.
   */
  diagnosticsAnswered(filePath: string): boolean {
    return this.diagnosticsAnsweredFor.has(fileUri(filePath));
  }

  /**
   * Wait for a push-model server's diagnostics to stop changing.
   *
   * First publish, then quiet for DIAGNOSTICS_SETTLE_MS. See that constant for
   * the measurement this exists for: the first publish is routinely a stale or
   * empty placeholder, and returning on it reports "clean" for a broken file.
   */
  async waitForDiagnosticsSettled(
    filePath: string,
    timeoutMs = 30_000,
    settleMs = DIAGNOSTICS_SETTLE_MS,
    publishedAfterSeq = -1
  ): Promise<void> {
    const uri = fileUri(filePath);
    const deadline = Date.now() + timeoutMs;

    // A publish counted before `publishedAfterSeq` describes content the server
    // has since been told to replace, so it does not count as an answer here.
    while ((this.diagnosticsSeq.get(uri) ?? 0) <= publishedAfterSeq && Date.now() < deadline) {
      await this.awaitPublish(uri, deadline - Date.now());
    }

    if (!this.diagnostics.has(uri)) {
      await this.waitForDiagnostics(filePath, Math.max(0, deadline - Date.now()));
    }

    // Nothing ever arrived — waitForDiagnostics timed out. There is no publish
    // to settle, and sleeping the full window would only add delay to a miss.
    if (!this.diagnosticsUpdatedAt.has(uri)) {
      return;
    }

    for (;;) {
      const quietFor = Date.now() - (this.diagnosticsUpdatedAt.get(uri) ?? 0);
      const remaining = deadline - Date.now();
      if (quietFor >= settleMs || remaining <= 0) {
        return;
      }
      await sleep(Math.min(settleMs - quietFor, remaining));
    }
  }

  /**
   * Open a document using text we supply rather than the bytes on disk.
   *
   * LSP treats the client as the owner of an open document's content, so this
   * is how the server can be asked about a version of the file that is not (or
   * is no longer) on disk — without ever writing that version to the real path.
   * The real path is still used, so imports, tsconfig and crate layout resolve
   * exactly as they do for the actual file.
   */
  async openDocumentWithText(filePath: string, text: string): Promise<number> {
    const hostUri = fileUri(filePath);
    const uri = this.toServerUri(hostUri);

    // Already open? Replace the content instead of opening it again.
    //
    // A second didOpen for an open document is invalid LSP and servers respond
    // by ignoring it, keeping whatever text they already had. That is harmless
    // while every request gets a brand-new client, and wrong the moment clients
    // are reused across edits. Measured on typescript-language-server through
    // the daemon: round N opened with the clean baseline while the server still
    // held round N-1's broken text, so "before" already contained the error,
    // "after" contained the same error, and the set difference was empty -- an
    // edit that genuinely introduced a type error was reported as "no new
    // errors", the one output this hook must never produce.
    //
    // didClose+didOpen also fixes that, and was measurably worse: the close
    // makes the server publish an EMPTY set for the document, which arrives
    // first and is indistinguishable from an answer about the new text. That
    // turned a pre-existing error into "before: 0 errors", which reports an old
    // error as newly introduced. didChange has no such side effect.
    if (this.openDocuments.has(hostUri)) {
      return this.changeDocument(filePath, text);
    }

    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: this.getLanguageId(filePath), version: 1, text }
    });

    this.openDocuments.add(hostUri);
    this.documentVersions.set(hostUri, 1);
    return -1;
  }

  /**
   * Replace the content of an already-open document (full-text didChange).
   * Returns the moment the change was sent, so a caller can tell a publish that
   * answers this change apart from one that answered the previous content.
   */
  changeDocument(filePath: string, text: string): number {
    const hostUri = fileUri(filePath);
    const uri = this.toServerUri(hostUri);
    const version = (this.documentVersions.get(hostUri) ?? 1) + 1;

    const seenSeq = this.diagnosticsSeq.get(hostUri) ?? 0;
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }]
    });
    this.documentVersions.set(hostUri, version);
    return seenSeq;
  }

  /**
   * Wait for the server to publish diagnostics for a file.
   * Resolves as soon as textDocument/publishDiagnostics fires for the URI,
   * or after `timeoutMs` milliseconds (whichever comes first).
   * This replaces fixed-delay sleeps with a notification-driven approach.
   */
  waitForDiagnostics(filePath: string, timeoutMs = 2000): Promise<void> {
    const uri = fileUri(filePath);

    // If diagnostics are already present, resolve immediately.
    if (this.diagnostics.has(uri)) {
      return Promise.resolve();
    }

    return this.awaitPublish(uri, timeoutMs);
  }

  /**
   * Wait for the NEXT publishDiagnostics for a URI, whether or not one is
   * already cached. Needed after a didChange: the cache still holds the answer
   * to the previous content, so the cached-value shortcut would return a
   * verdict about text the server has already been told to forget.
   */
  private awaitPublish(uri: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.diagnosticWaiters.delete(uri);
          resolve();
        }
      }, timeoutMs);

      // Store the resolver so handleNotification can wake it up.
      const existing = this.diagnosticWaiters.get(uri) || [];
      existing.push(() => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve();
        }
      });
      this.diagnosticWaiters.set(uri, existing);
    });
  }

  /**
   * Prepare rename (check if rename is valid)
   */
  async prepareRename(filePath: string, line: number, character: number): Promise<Range | null> {
    const uri = await this.prepareDocument(filePath);
    try {
      const result = await this.request<Range | { range: Range; placeholder: string } | null>('textDocument/prepareRename', {
        textDocument: { uri },
        position: { line, character }
      });
      if (!result) return null;
      return 'range' in result ? result.range : result;
    } catch {
      return null;
    }
  }

  /**
   * Rename a symbol
   */
  async rename(filePath: string, line: number, character: number, newName: string): Promise<WorkspaceEdit | null> {
    const uri = await this.prepareDocument(filePath);
    const result = await this.request<WorkspaceEdit | null>('textDocument/rename', {
      textDocument: { uri },
      position: { line, character },
      newName
    });
    return this.translateIncomingPayload(result) as WorkspaceEdit | null;
  }

  /**
   * Get code actions
   */
  async codeActions(filePath: string, range: Range, diagnostics: Diagnostic[] = []): Promise<CodeAction[] | null> {
    const uri = await this.prepareDocument(filePath);
    const result = await this.request<CodeAction[] | null>('textDocument/codeAction', {
      textDocument: { uri },
      range,
      context: { diagnostics }
    });
    return this.translateIncomingPayload(result) as CodeAction[] | null;
  }

  /**
   * Resolve the call-hierarchy symbol at a position, leaving URIs untranslated.
   *
   * The raw item is what has to go back to the server on the follow-up request:
   * translateIncomingPayload rewrites `uri` to the host namespace, and a
   * container-hosted server would not recognise a host URI it never issued.
   */
  private async prepareCallHierarchyRaw(filePath: string, line: number, character: number): Promise<CallHierarchyItem[] | null> {
    const uri = await this.prepareDocument(filePath);
    return this.requestIndexed<CallHierarchyItem[] | null>('textDocument/prepareCallHierarchy', {
      textDocument: { uri },
      position: { line, character }
    });
  }

  /**
   * Resolve the call-hierarchy item(s) at a position.
   */
  async prepareCallHierarchy(filePath: string, line: number, character: number): Promise<CallHierarchyItem[] | null> {
    const result = await this.prepareCallHierarchyRaw(filePath, line, character);
    return this.translateIncomingPayload(result) as CallHierarchyItem[] | null;
  }

  /**
   * Find the callers of the symbol at a position.
   *
   * Takes a position and re-prepares internally rather than accepting a
   * CallHierarchyItem, even though that costs one extra round-trip against an
   * already-open document. Two reasons, in order of weight:
   *
   *   1. CallHierarchyItem.data is server-defined opaque state. Clients are
   *      pooled and evicted after IDLE_TIMEOUT_MS, so an item handed back later
   *      can reach a *different* server process than the one that minted it.
   *      A position always means the same thing; an opaque blob does not.
   *   2. A caller that has to thread JSON from one tool call into the next will
   *      eventually thread it wrong, and a malformed item fails as an obscure
   *      server error rather than as "no symbol there".
   */
  async incomingCalls(filePath: string, line: number, character: number): Promise<CallHierarchyResult<CallHierarchyIncomingCall> | null> {
    const items = await this.prepareCallHierarchyRaw(filePath, line, character);
    const item = items?.[0];
    if (!item) return null;

    const result = await this.requestIndexed<CallHierarchyIncomingCall[] | null>('callHierarchy/incomingCalls', { item });
    return this.translateIncomingPayload({ item, calls: result ?? [] }) as CallHierarchyResult<CallHierarchyIncomingCall>;
  }

  /**
   * Find what the symbol at a position calls. Position-based for the same
   * reasons as incomingCalls().
   */
  async outgoingCalls(filePath: string, line: number, character: number): Promise<CallHierarchyResult<CallHierarchyOutgoingCall> | null> {
    const items = await this.prepareCallHierarchyRaw(filePath, line, character);
    const item = items?.[0];
    if (!item) return null;

    const result = await this.requestIndexed<CallHierarchyOutgoingCall[] | null>('callHierarchy/outgoingCalls', { item });
    return this.translateIncomingPayload({ item, calls: result ?? [] }) as CallHierarchyResult<CallHierarchyOutgoingCall>;
  }

  private getServerWorkspaceRoot(): string {
    return this.devContainerContext?.containerWorkspaceRoot ?? this.workspaceRoot;
  }

  private getWorkspaceRootUri(): string {
    return this.toServerUri(pathToFileURL(this.workspaceRoot).href);
  }

  private toServerUri(uri: string): string {
    return hostUriToContainerUri(uri, this.devContainerContext);
  }

  private toHostUri(uri: string): string {
    return containerUriToHostUri(uri, this.devContainerContext);
  }

  private translateIncomingPayload<T>(value: T): T {
    if (!this.devContainerContext || value == null) {
      return value;
    }

    return this.translateIncomingValue(value) as T;
  }

  private translateIncomingValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.translateIncomingValue(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const record = value as Record<string, unknown>;
    const translatedEntries = Object.entries(record).map(([key, entryValue]) => {
      if ((key === 'uri' || key === 'targetUri' || key === 'newUri' || key === 'oldUri') && typeof entryValue === 'string') {
        return [key, this.toHostUri(entryValue)];
      }

      if (key === 'changes' && entryValue && typeof entryValue === 'object' && !Array.isArray(entryValue)) {
        const translatedChanges = Object.fromEntries(
          Object.entries(entryValue as Record<string, unknown>).map(([uri, changeValue]) => [
            this.toHostUri(uri),
            this.translateIncomingValue(changeValue)
          ])
        );
        return [key, translatedChanges];
      }

      return [key, this.translateIncomingValue(entryValue)];
    });

    return Object.fromEntries(translatedEntries);
  }
}

/** Idle timeout: disconnect LSP clients unused for 5 minutes */
export const IDLE_TIMEOUT_MS = readPositiveIntEnv('NORD_LSP_IDLE_TIMEOUT_MS', 5 * 60 * 1000);
/** Check for idle clients every 60 seconds */
export const IDLE_CHECK_INTERVAL_MS = readPositiveIntEnv('NORD_LSP_IDLE_CHECK_INTERVAL_MS', 60 * 1000);

/**
 * Client manager - maintains a pool of LSP clients per workspace/server
 * with idle eviction to free resources and in-flight request protection.
 */
export class LspClientManager {
  private clients = new Map<string, LspClient>();
  private lastUsed = new Map<string, number>();
  private inFlightCount = new Map<string, number>();
  private idleDeadlines = new Map<string, ReturnType<typeof setTimeout>>();
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startIdleCheck();
    this.registerCleanupHandlers();
  }

  /**
   * Register process exit/signal handlers to kill all spawned LSP server processes.
   * Prevents orphaned language server processes (e.g. kotlin-language-server)
   * when the MCP bridge process exits or a claude session ends.
   */
  private registerCleanupHandlers(): void {
    const forceKillAll = () => {
      if (this.idleTimer) {
        clearInterval(this.idleTimer);
        this.idleTimer = null;
      }
      for (const timer of this.idleDeadlines.values()) {
        clearTimeout(timer);
      }
      this.idleDeadlines.clear();
      for (const client of this.clients.values()) {
        try {
          client.forceKill();
        } catch {
          // Ignore errors during cleanup
        }
      }
      this.clients.clear();
      this.lastUsed.clear();
      this.inFlightCount.clear();
    };

    // 'exit' handler must be synchronous — forceKill() is sync
    process.on('exit', forceKillAll);

    // For signals, force-kill LSP servers but do NOT call process.exit()
    // to allow other signal handlers (e.g., Python bridge cleanup) to run
    for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
      process.on(sig, forceKillAll);
    }
  }

  /**
   * Get or create a client for a file
   */
  async getClientForFile(filePath: string): Promise<LspClient | null> {
    const workspaceRoot = this.findWorkspaceRoot(filePath);
    const serverConfig = getServerForFile(filePath, workspaceRoot);
    if (!serverConfig) {
      return null;
    }

    const devContainerContext = resolveDevContainerContext(workspaceRoot);
    const key = `${workspaceRoot}:${serverConfig.command}:${devContainerContext?.containerId ?? 'host'}`;

    let client = this.clients.get(key);
    if (!client) {
      client = new LspClient(workspaceRoot, serverConfig, devContainerContext);
      try {
        await client.connect();
        this.clients.set(key, client);
      } catch (error) {
        throw error;
      }
    }

    this.touchClient(key);

    return client;
  }

  /**
   * Run a function with in-flight tracking for the client serving filePath.
   * While the function is running, the client is protected from idle eviction.
   * The lastUsed timestamp is refreshed on both entry and exit.
   */
  async runWithClientLease<T>(filePath: string, fn: (client: LspClient) => Promise<T>): Promise<T> {
    const workspaceRoot = this.findWorkspaceRoot(filePath);
    const serverConfig = getServerForFile(filePath, workspaceRoot);
    if (!serverConfig) {
      throw new Error(`No language server available for: ${filePath}`);
    }

    const devContainerContext = resolveDevContainerContext(workspaceRoot);
    const key = `${workspaceRoot}:${serverConfig.command}:${devContainerContext?.containerId ?? 'host'}`;

    let client = this.clients.get(key);
    if (!client) {
      client = new LspClient(workspaceRoot, serverConfig, devContainerContext);
      try {
        await client.connect();
        this.clients.set(key, client);
      } catch (error) {
        throw error;
      }
    }

    // Touch timestamp and increment in-flight counter
    this.touchClient(key);
    this.inFlightCount.set(key, (this.inFlightCount.get(key) || 0) + 1);

    try {
      return await fn(client);
    } finally {
      // Decrement in-flight counter and refresh timestamp
      const count = (this.inFlightCount.get(key) || 1) - 1;
      if (count <= 0) {
        this.inFlightCount.delete(key);
      } else {
        this.inFlightCount.set(key, count);
      }
      this.touchClient(key);
    }
  }

  private touchClient(key: string): void {
    this.lastUsed.set(key, Date.now());
    this.scheduleIdleDeadline(key);
  }

  private scheduleIdleDeadline(key: string): void {
    this.clearIdleDeadline(key);

    const timer = setTimeout(() => {
      this.idleDeadlines.delete(key);
      this.evictClientIfIdle(key);
    }, IDLE_TIMEOUT_MS);

    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }

    this.idleDeadlines.set(key, timer);
  }

  private clearIdleDeadline(key: string): void {
    const timer = this.idleDeadlines.get(key);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.idleDeadlines.delete(key);
  }

  /**
   * Find the workspace root for a file
   */
  private findWorkspaceRoot(filePath: string): string {
    let dir = dirname(resolve(filePath));
    const markers = [
      'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
      'pom.xml', 'package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml',
      'go.mod', '.git'
    ];

    // Cross-platform root detection
    while (true) {
      const parsed = parse(dir);
      // On Windows: C:\ has root === dir, On Unix: / has root === dir
      if (parsed.root === dir) {
        break;
      }

      for (const marker of markers) {
        const markerPath = join(dir, marker);
        if (existsSync(markerPath)) {
          return dir;
        }
      }
      dir = dirname(dir);
    }

    return dirname(resolve(filePath));
  }

  /**
   * Start periodic idle check
   */
  private startIdleCheck(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      this.evictIdleClients();
    }, IDLE_CHECK_INTERVAL_MS);
    // Allow the process to exit even if the timer is running
    if (this.idleTimer && typeof this.idleTimer === 'object' && 'unref' in this.idleTimer) {
      this.idleTimer.unref();
    }
  }

  /**
   * Evict clients that haven't been used within IDLE_TIMEOUT_MS.
   * Clients with in-flight requests are never evicted.
   */
  private evictIdleClients(): void {
    for (const key of this.lastUsed.keys()) {
      this.evictClientIfIdle(key);
    }
  }

  private evictClientIfIdle(key: string): void {
    const lastUsedTime = this.lastUsed.get(key);
    if (lastUsedTime === undefined) {
      this.clearIdleDeadline(key);
      return;
    }

    const idleFor = Date.now() - lastUsedTime;
    if (idleFor <= IDLE_TIMEOUT_MS) {
      const hasDeadline = this.idleDeadlines.has(key);
      if (!hasDeadline) {
        this.scheduleIdleDeadline(key);
      }
      return;
    }

    // Skip eviction if there are in-flight requests
    if ((this.inFlightCount.get(key) || 0) > 0) {
      this.scheduleIdleDeadline(key);
      return;
    }

    const client = this.clients.get(key);
    this.clearIdleDeadline(key);
    this.clients.delete(key);
    this.lastUsed.delete(key);
    this.inFlightCount.delete(key);

    if (client) {
      client.disconnect().catch(() => {
        // Ignore disconnect errors during eviction
      });
    }
  }

  /**
   * Disconnect all clients and stop idle checking.
   * Uses Promise.allSettled so one failing disconnect doesn't block others.
   * Maps are always cleared regardless of individual disconnect failures.
   */
  async disconnectAll(): Promise<void> {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }

    for (const timer of this.idleDeadlines.values()) {
      clearTimeout(timer);
    }
    this.idleDeadlines.clear();

    const entries = Array.from(this.clients.entries());
    const results = await Promise.allSettled(
      entries.map(([, client]) => client.disconnect())
    );

    // Log any per-client failures at warn level
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        const key = entries[i][0];
        console.warn(`LSP disconnectAll: failed to disconnect client "${key}": ${result.reason}`);
      }
    }

    // Always clear maps regardless of individual failures
    this.clients.clear();
    this.lastUsed.clear();
    this.inFlightCount.clear();
  }

  /** Expose in-flight count for testing */
  getInFlightCount(key: string): number {
    return this.inFlightCount.get(key) || 0;
  }

  /** Expose client count for testing */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Pids of every language server currently pooled.
   *
   * The daemon reports these so "did this run leak a language server" can be
   * answered by ownership instead of by grepping ps for command names, which
   * cannot tell our servers from an editor's.
   */
  getServerPids(): number[] {
    const pids: number[] = [];
    for (const client of this.clients.values()) {
      const pid = client.serverPid;
      if (pid !== undefined) pids.push(pid);
    }
    return pids;
  }

  /** Trigger idle eviction manually (exposed for testing) */
  triggerEviction(): void {
    this.evictIdleClients();
  }
}

const LSP_CLIENT_MANAGER_KEY = '__nordLspClientManager';
type GlobalWithLspClientManager = typeof globalThis & {
  [LSP_CLIENT_MANAGER_KEY]?: LspClientManager;
};

// Export a process-global singleton instance. This protects against duplicate
// manager instances if the module is loaded more than once in the same process
// (for example after module resets in tests or bundle indirection).
const globalWithLspClientManager = globalThis as GlobalWithLspClientManager;
export const lspClientManager = globalWithLspClientManager[LSP_CLIENT_MANAGER_KEY]
  ?? (globalWithLspClientManager[LSP_CLIENT_MANAGER_KEY] = new LspClientManager());

/**
 * Disconnect all LSP clients and free resources.
 * Exported for use in session-end hooks.
 */
export async function disconnectAll(): Promise<void> {
  return lspClientManager.disconnectAll();
}
