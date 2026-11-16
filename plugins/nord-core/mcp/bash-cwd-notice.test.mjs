#!/usr/bin/env node
/**
 * Pins what the MCP shell tells its caller when it discards a cd, and that its tool text
 * promises no more than the shell does.
 * Rule: vault ticket die-mcp-shell-meldet-einen-verworfenen-cd-im-kopf-des-aufrufs
 * (Julius 2026-11-10, d-54 option 1 "B-plus": the boundary stays, the shell reports the drop).
 *
 *   node bash-cwd-notice.test.mjs [--bundle <path>]
 *   exit 0 = every case holds, 1 = a case is red, 2 = the probe could not run; prints "N cases, M red"
 *
 * Probes the BUILT bundle (default ../bridge/mcp-server.cjs) over stdio JSON-RPC, like smoke.mjs
 * (TOOLING.md: probe the built artifact, not src/). Every experiment starts its own server with a
 * throwaway git repo as cwd; that repo is the server's worktree root, the boundary of the shell.
 * Needs Node >= 20 and git, installs nothing.
 *
 * NOTICE is the pinned prefix of the head line. What follows it is free, but the line must name
 * the discarded target and the directory the next call starts in.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTICE = '[cd discarded:';
const argv = process.argv.slice(2);
const bi = argv.indexOf('--bundle');
const bundle = resolve(bi >= 0 ? argv[bi + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', 'bridge', 'mcp-server.cjs'));
if (!existsSync(bundle)) {
  console.error(`bash-cwd-notice: bundle not found: ${bundle}`);
  process.exit(2);
}

// A git hook exports GIT_DIR and friends; with them the throwaway repo would not be the root.
const env = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];

let cases = 0;
let red = 0;
const check = (name, ok, got) => {
  cases++;
  if (!ok) { red++; console.log(`FAIL ${name}: ${got}`); }
};

/** One server per experiment, so no persisted directory leaks from one into the next. */
function withServer(root, body) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [bundle], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const waiting = new Map();
    let buf = '';
    let id = 10;
    const end = (err, value) => {
      clearTimeout(timer);
      try { child.kill(); } catch { /* gone */ }
      err ? fail(err) : done(value);
    };
    const timer = setTimeout(() => end(new Error('no answer within 30 s')), 30000);
    child.on('error', end);
    child.on('exit', (code) => end(new Error(`bundle exited early (code ${code})`)));
    child.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        waiting.get(msg.id)?.(msg);
      }
    });
    const rpc = (method, params) => new Promise((r) => {
      waiting.set(++id, r);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    const bash = async (command, extra = {}) => {
      const msg = await rpc('tools/call', { name: 'Bash', arguments: { command, ...extra } });
      return msg.result?.content?.[0]?.text ?? JSON.stringify(msg);
    };
    rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bash-cwd-notice', version: '1' } })
      .then(() => {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        return body({ rpc, bash });
      })
      .then((v) => end(null, v), (e) => end(e));
  });
}

/** An answer is a head (every line before "--- stdout ---") and the stdout section. */
const parts = (text) => {
  const lines = text.split('\n');
  const i = lines.indexOf('--- stdout ---');
  const out = i < 0 ? '' : lines.slice(i + 1).join('\n').split('\n--- stderr ---')[0].trim();
  return { head: i < 0 ? lines : lines.slice(0, i), out };
};
const notices = (head) => head.filter((l) => l.startsWith(NOTICE));

const base = realpathSync(mkdtempSync(join(tmpdir(), 'bash-cwd-notice-')));
const root = join(base, 'work');
mkdirSync(join(root, 'sub'), { recursive: true });
execFileSync('git', ['init', '-q', root], { env });

try {
  // A: a cd out of the worktree root is discarded, and the call that made it says so.
  await withServer(root, async ({ bash }) => {
    const first = parts(await bash('cd /tmp && pwd'));
    const n = notices(first.head);
    check('A1 one notice line in the head of the call that cd-ed out', n.length === 1, JSON.stringify(first.head));
    // the root is cut out first: when the scratch dir itself lies under /tmp, naming the root must not count as naming the target
    check('A2 the notice names the discarded target', n.length === 1 && n[0].split(root).join('').includes('/tmp'), JSON.stringify(n));
    check('A3 the notice names where the next call starts', n.length === 1 && n[0].includes(root), JSON.stringify(n));
    check('A4 the notice stands after the exit code line', first.head[0] === 'Exit code: 0' && first.head.indexOf(n[0]) > 0, JSON.stringify(first.head));
    check('A5 the command itself ran as before', first.out === '/tmp', JSON.stringify(first.out));
    const second = parts(await bash('pwd'));
    check('A6 the boundary stays: the next call starts in the worktree root', second.out === root, JSON.stringify(second.out));
    check('A7 the notice is not repeated on the next call', notices(second.head).length === 0, JSON.stringify(second.head));
  });

  // A': the next call starts in the last KEPT directory, which is not always the root.
  await withServer(root, async ({ bash }) => {
    await bash('cd sub');
    const first = parts(await bash('cd /tmp && pwd'));
    const n = notices(first.head);
    check('A8 after a kept cd into sub, the notice names sub as the next start', n.length === 1 && n[0].includes(join(root, 'sub')), JSON.stringify(first.head));
    const second = parts(await bash('pwd'));
    check('A9 and the next call does start in sub', second.out === join(root, 'sub'), JSON.stringify(second.out));
  });

  // B: a cd inside the worktree root is kept, and says nothing about a discard.
  await withServer(root, async ({ bash }) => {
    const first = parts(await bash('cd sub && pwd'));
    check('B1 a cd inside the root gives no notice', notices(first.head).length === 0, JSON.stringify(first.head));
    check('B2 control: the existing [cwd: ...] line is in that head', first.head.includes(`[cwd: ${join(root, 'sub')}]`), JSON.stringify(first.head));
    const second = parts(await bash('pwd'));
    check('B3 the next call starts inside the root, where the cd went', second.out === join(root, 'sub'), JSON.stringify(second.out));
  });

  // C: nothing moves, nothing is said. An explicit cwd scopes the call, so nothing is lost there either.
  await withServer(root, async ({ bash }) => {
    const plain = parts(await bash('pwd'));
    check('C1 a call without a cd gives no notice', notices(plain.head).length === 0, JSON.stringify(plain.head));
    const scoped = parts(await bash('cd /tmp && pwd', { cwd: 'sub' }));
    check('C2 a call with an explicit cwd argument gives no notice', notices(scoped.head).length === 0, JSON.stringify(scoped.head));
  });

  // T: the tool text names the limit it used to hide.
  await withServer(root, async ({ rpc }) => {
    const tool = (await rpc('tools/list', {})).result.tools.find((t) => t.name === 'Bash');
    const d = tool.description;
    const p = tool.inputSchema.properties.cwd.description;
    check('T1 the description says a cd outside is discarded', /outside/i.test(d) && /discard/i.test(d), JSON.stringify(d));
    check('T2 the description names the worktree as the limit', /worktree/i.test(d), JSON.stringify(d));
    check('T3 the cwd text names the worktree as the limit', /worktree/i.test(p), JSON.stringify(p));
  });
} catch (e) {
  console.error(`bash-cwd-notice: could not run: ${e?.stack ?? e}`);
  rmSync(base, { recursive: true, force: true });
  process.exit(2);
}
rmSync(base, { recursive: true, force: true });

console.log(`${cases} cases, ${red} red`);
process.exit(red ? 1 : 0);
