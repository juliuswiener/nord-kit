#!/usr/bin/env node
/**
 * Smoke test for the BUILT standalone MCP server bundle.
 *
 * Why this exists: from 1.18.0 until 2026-08-09 the server answered every
 * `tools/list` with JSON-RPC -32603 ("Cannot convert undefined or null to
 * object") because one tool shipped a raw `inputSchema` where the registry
 * reads `schema`. All tools were unreachable for the whole period and no
 * test noticed, because every test ran against `src/` and nobody ever spoke
 * JSON-RPC to `bridge/mcp-server.cjs`. This probe does, in about a second.
 *
 * Usage:
 *   node smoke.mjs [--bundle <path>] [--self-test]
 *
 * Exit codes: 0 = healthy, 1 = a check failed, 2 = could not run the probe.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Tools that must be present. A count floor cannot catch the loss of one
 * specific tool — losing `Bash` while gaining two others keeps the count
 * healthy and the shell gone. Name what must survive.
 */
const REQUIRED_NAMES = [
  'Bash',
  'lsp_hover',
  'ast_grep_search',
  'python_repl',
  'memory_save',
  'docs_chat',
];

// Floor, not an exact count: it catches mass loss, REQUIRED_NAMES catches the
// single tool you cared about. 24 ship after the skills cut (list_nord_skills /
// load_nord_skills_local / load_nord_skills_global — readers of `.nord/skills/`,
// a directory that exists nowhere), so 22 leaves room for two deliberate
// removals before the floor has to be revisited.
//
// The floor must stay above the surface that any single NORD_DISABLE_TOOLS
// group leaves behind, or it stops being a control: disabling `custom` drops
// the three shell tools to 21, and a run that still passes would prove the
// floor had been lowered until it could no longer fail.
const MIN_TOOLS = 22;

/** Schema budget for the shell tool — the gate-loop drives it with a cheap model. */
const SHELL_BUDGET = { name: 'Bash', maxProperties: 7, maxRequired: 1, maxDescriptionChars: 200 };

function parseArgs(argv) {
  const args = { bundle: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--bundle') args.bundle = argv[++i];
    else if (argv[i] === '--self-test') args.selfTest = true;
  }
  return args;
}

function resolveBundle(explicit) {
  if (explicit) return resolve(explicit);
  const candidate = join(ROOT, 'bridge', 'mcp-server.cjs');
  if (existsSync(candidate)) return candidate;
  return null;
}

/** Speak the real MCP handshake over stdio and return the tools/list response. */
function probe(bundlePath, timeoutMs = 30000) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [bundlePath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
      resolvePromise(result);
    };

    const timer = setTimeout(
      () => finish({ ok: false, fatal: `no tools/list response within ${timeoutMs}ms`, stderr }),
      timeoutMs,
    );

    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish({ ok: false, fatal: `could not spawn bundle: ${e.message}`, stderr }));
    child.on('exit', (code) =>
      finish({ ok: false, fatal: `bundle exited (code ${code}) before answering tools/list`, stderr }));

    child.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
        }
        if (msg.id === 2) finish({ ok: true, response: msg, stderr });
      }
    });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mcp-smoke', version: '1' },
      },
    }) + '\n');
  });
}

/**
 * Assertions over a tools/list response. Pure, so --self-test can drive it with
 * a canned error payload and prove the checks are capable of failing.
 */
export function checkResponse(response) {
  const failures = [];

  if (response?.error) {
    failures.push(`tools/list returned JSON-RPC error ${response.error.code}: ${response.error.message}`);
    return failures; // nothing further is meaningful
  }

  const tools = response?.result?.tools;
  if (!Array.isArray(tools)) {
    failures.push('tools/list response has no result.tools array');
    return failures;
  }

  if (tools.length < MIN_TOOLS) {
    failures.push(`only ${tools.length} tools exposed, expected at least ${MIN_TOOLS}`);
  }

  const names = new Set(tools.map((t) => t.name));
  for (const required of REQUIRED_NAMES) {
    if (!names.has(required)) failures.push(`required tool missing: ${required}`);
  }

  const dupes = tools.map((t) => t.name).filter((n, i, a) => a.indexOf(n) !== i);
  if (dupes.length) failures.push(`duplicate tool names: ${[...new Set(dupes)].join(', ')}`);

  for (const tool of tools) {
    const s = tool.inputSchema;
    if (!s || s.type !== 'object' || typeof s.properties !== 'object' || !Array.isArray(s.required)) {
      failures.push(`tool ${tool.name} has a malformed inputSchema`);
    }
  }

  const shell = tools.find((t) => t.name === SHELL_BUDGET.name);
  if (shell?.inputSchema) {
    const props = Object.keys(shell.inputSchema.properties ?? {}).length;
    const req = (shell.inputSchema.required ?? []).length;
    const desc = (shell.description ?? '').length;
    if (props > SHELL_BUDGET.maxProperties) {
      failures.push(`${SHELL_BUDGET.name} has ${props} properties, budget is ${SHELL_BUDGET.maxProperties} (cheap models degrade on verbose schemas)`);
    }
    if (req > SHELL_BUDGET.maxRequired) {
      failures.push(`${SHELL_BUDGET.name} has ${req} required properties, budget is ${SHELL_BUDGET.maxRequired}`);
    }
    if (desc > SHELL_BUDGET.maxDescriptionChars) {
      failures.push(`${SHELL_BUDGET.name} description is ${desc} chars, budget is ${SHELL_BUDGET.maxDescriptionChars}`);
    }
  }

  return failures;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selfTest) {
    // Positive control: the checks must reject a broken payload. Without this,
    // a green run only proves the probe ran, not that it can judge.
    const cases = [
      ['jsonrpc error', { error: { code: -32603, message: 'Cannot convert undefined or null to object' } }],
      ['no tools array', { result: {} }],
      ['tool surface gutted', { result: { tools: [{ name: 'Bash', description: 'x', inputSchema: { type: 'object', properties: {}, required: [] } }] } }],
    ];
    let bad = 0;
    for (const [label, payload] of cases) {
      const failures = checkResponse(payload);
      if (failures.length === 0) {
        console.error(`SELF-TEST FAILED: "${label}" was accepted as healthy`);
        bad++;
      } else {
        console.log(`self-test ok: "${label}" rejected (${failures.length} failure(s), first: ${failures[0]})`);
      }
    }
    process.exit(bad === 0 ? 0 : 1);
  }

  const bundlePath = resolveBundle(args.bundle);
  if (!bundlePath || !existsSync(bundlePath)) {
    console.error(`mcp-smoke: bundle not found${args.bundle ? ` at ${args.bundle}` : ''}. Run: npm run build`);
    process.exit(2);
  }

  const result = await probe(bundlePath);
  if (!result.ok) {
    console.error(`mcp-smoke: ${result.fatal}`);
    if (result.stderr.trim()) console.error(result.stderr.trim());
    process.exit(2);
  }

  const failures = checkResponse(result.response);
  const count = result.response?.result?.tools?.length ?? 0;

  if (failures.length) {
    console.error(`mcp-smoke: FAILED against ${bundlePath}`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(`mcp-smoke: OK — ${count} tools, all ${REQUIRED_NAMES.length} required names present (${bundlePath})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`mcp-smoke: unexpected error: ${e?.stack ?? e}`);
    process.exit(2);
  });
}
