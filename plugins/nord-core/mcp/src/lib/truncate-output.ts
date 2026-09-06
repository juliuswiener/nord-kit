/**
 * Head+tail truncation for captured process output.
 *
 * Every other truncator in this repo keeps the head and drops the rest
 * (src/mcp/job-management.ts, python-repl's stderr cap,
 * src/lib/truncate-prompt.ts). For command output that is the wrong
 * policy: stack traces, assertion diffs and test summaries live at the END, so
 * head-only truncation throws away the part that says what went wrong. The tail
 * therefore gets the larger share of the budget.
 *
 * The collector holds at most head + 2×tail bytes regardless of how much the
 * process emits, which is what makes multi-megabyte output survivable at all —
 * the previous implementation buffered everything through exec's 1 MB maxBuffer
 * and lost the entire output when it overflowed.
 *
 * Budgets are in BYTES, not characters: streams deliver Buffers, and counting
 * characters would mean decoding every chunk. Byte accounting follows the
 * precedent in src/lib/payload-limits.ts.
 *
 * Not migrated here, but candidates to converge on this helper later:
 * src/mcp/job-management.ts, state-tools' cap,
 * python-repl/bridge-manager.ts:415. truncate-prompt.ts should stay head-only —
 * a prompt echo genuinely wants its beginning.
 */

export const DEFAULT_STDOUT_MAX_BYTES = 30_000;
export const DEFAULT_STDERR_MAX_BYTES = 10_000;
export const DEFAULT_HEAD_FRACTION = 0.4;

export interface HeadTailLimits {
  /** Total byte budget for the rendered text, excluding the elision marker. */
  maxBytes: number;
  /** Share of the budget given to the head. Default 0.4 — the tail matters more. */
  headFraction?: number;
}

export interface TruncatedOutput {
  /** Rendered text, with an elision marker in the middle when truncated. */
  text: string;
  /** Bytes the process actually produced. */
  totalBytes: number;
  /** Bytes dropped from the middle. 0 when nothing was truncated. */
  omittedBytes: number;
  truncated: boolean;
}

export interface StreamCollector {
  push(chunk: Buffer): void;
  totalBytes(): number;
  result(): TruncatedOutput;
}

function splitBudget(limits: HeadTailLimits): { headBytes: number; tailBytes: number } {
  const maxBytes = Math.max(0, Math.floor(limits.maxBytes));
  const fraction = Math.min(1, Math.max(0, limits.headFraction ?? DEFAULT_HEAD_FRACTION));
  const headBytes = Math.floor(maxBytes * fraction);
  return { headBytes, tailBytes: maxBytes - headBytes };
}

/**
 * Move the cut to a line boundary so the rendered halves start and end on whole
 * lines. This also removes any UTF-8 sequence split by the byte-level cut, so
 * no separate multi-byte handling is needed.
 */
function snapHeadToLine(head: Buffer): Buffer {
  const idx = head.lastIndexOf(0x0a); // '\n'
  return idx > 0 ? head.subarray(0, idx) : head;
}

function snapTailToLine(tail: Buffer): Buffer {
  const idx = tail.indexOf(0x0a);
  return idx >= 0 && idx < tail.length - 1 ? tail.subarray(idx + 1) : tail;
}

function render(
  head: Buffer,
  tail: Buffer,
  totalBytes: number,
  omittedBytes: number,
): TruncatedOutput {
  if (omittedBytes <= 0) {
    return {
      text: Buffer.concat([head, tail]).toString('utf8'),
      totalBytes,
      omittedBytes: 0,
      truncated: false,
    };
  }

  const headText = snapHeadToLine(head).toString('utf8');
  const tailText = snapTailToLine(tail).toString('utf8');
  const marker = `\n... [${omittedBytes} bytes elided of ${totalBytes} total] ...\n`;

  return { text: headText + marker + tailText, totalBytes, omittedBytes, truncated: true };
}

/**
 * Collect a stream, keeping only the head and the tail of the byte budget.
 *
 * Retained memory is bounded: the head stops growing once its share is full,
 * and the tail is compacted whenever it exceeds twice its share.
 */
export function createStreamCollector(limits: HeadTailLimits): StreamCollector {
  const { headBytes, tailBytes } = splitBudget(limits);

  const head: Buffer[] = [];
  let headLen = 0;
  let tail: Buffer[] = [];
  let tailLen = 0;
  let total = 0;
  let omitted = 0;

  const compactTail = (): void => {
    if (tailLen <= tailBytes) return;
    const joined = Buffer.concat(tail, tailLen);
    const keep = joined.subarray(joined.length - tailBytes);
    omitted += joined.length - keep.length;
    tail = [keep];
    tailLen = keep.length;
  };

  return {
    push(chunk: Buffer): void {
      if (chunk.length === 0) return;
      total += chunk.length;

      let rest = chunk;
      if (headLen < headBytes) {
        const take = Math.min(headBytes - headLen, rest.length);
        head.push(rest.subarray(0, take));
        headLen += take;
        rest = rest.subarray(take);
      }
      if (rest.length === 0) return;

      tail.push(rest);
      tailLen += rest.length;
      // Amortise: only compact once the tail has grown to twice its budget.
      if (tailLen > tailBytes * 2) compactTail();
    },

    totalBytes: () => total,

    result(): TruncatedOutput {
      compactTail();
      return render(Buffer.concat(head, headLen), Buffer.concat(tail, tailLen), total, omitted);
    },
  };
}

/** One-shot form for output that is already fully in memory. */
export function truncateHeadTail(input: Buffer, limits: HeadTailLimits): TruncatedOutput {
  const collector = createStreamCollector(limits);
  collector.push(input);
  return collector.result();
}
