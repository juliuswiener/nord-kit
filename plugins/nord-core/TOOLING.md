# NORD TOOLING — changing, disabling or replacing a tool

How to touch the tool surface without silently breaking it. NOT injected per session — this is
a rare activity and does not belong in every context window; ROUTING.md carries the pointer.
Edit here in nord-core → copy to the nord-kit payload → the cache, or the running copy is stale
(same three-copy rule as WORKERS.md).

Every rule below is here because it already failed once, and each carries the measurement.

## Probe first, then change, then probe again

```sh
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"p","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 | node bridge/mcp-server.cjs
```

`npm run mcp:smoke` wraps this with assertions; `npm run mcp:smoke:selftest` proves those
assertions can fail. It runs inside `npm run build`, right after the bundle is produced.

**Receipt:** from 1.18.0 until 2026-08-09 that request answered JSON-RPC -32603 and all 55 tools
were unreachable. Nobody noticed for three releases. The probe finds it in under a second.

## Rules

- **Probe the BUILT artifact, not `src/`.** Every test ran against `src/`; nobody ever spoke
  JSON-RPC to `bridge/mcp-server.cjs`, so a completely dead surface was invisible to a green suite.
- **A guard must not build its fixture at collection time.** `standalone-listtools.test.ts` called
  `buildListToolsResponse('')` in the describe body. When the bug hit, the file crashed during
  collection and its 13 tests never registered — the guard was disabled by the exact bug it existed
  to catch. In `beforeAll` the same failure reports 2 failed / 16 skipped of 18 registered tests.
- **Floor the COUNT and pin the NAMES.** The shipped surface went 49 (1.9.0) → 15 (1.14.2–1.17.0)
  → 0 (1.18.0+) and no test caught either transition; the floor said 33 while the truth was 55. A
  floor catches mass loss, named assertions catch the one tool you cared about. Both, always.
- **`schema`, never `inputSchema`.** Both servers read `.schema`, and it must be a Zod raw shape,
  not `z.object(...)`. A raw JSON-Schema object here is what took the registry down.
- **One malformed tool must not take the registry down.** `zodToJsonSchema` now degrades to an
  empty schema instead of throwing, so the blast radius of a bad tool is that tool.
- **A category IS a kill-switch blast radius.** `customTools` was tagged `PYTHON`, so
  `NORD_DISABLE_TOOLS=python` silently dropped the shell along with `python_repl`. Name a category
  for what you would want to turn off together, not for what the code imports. Verify with a set
  difference, never a count: a count-only check is green when the wrong tool disappears.
- **Two name forms, one per path. Never write both in one file.**

  | path | form | appears in |
  |---|---|---|
  | Agent SDK (`src/index.ts`) | `mcp__t__X` | `allowedTools`, `getNordToolNames()` |
  | plugin-loaded Claude Code | `mcp__plugin_nord-core_t__X` | `agents/*.md`, settings allow/deny, external consumers |

  Measured over `~/.claude/projects`: ~179k tool_use blocks carry the plugin form, zero carry the
  bare form. A consumer that guesses wrong emits an allow-list entry matching nothing — and an
  allow-list that matches nothing fails silently, in the direction of no capability at all.
- **Frontmatter `tools:` is an ALLOWLIST, not an addition.** Removing a tool without adding its
  replacement leaves that agent with nothing. 11 agents pin native `Bash`. Agents with no `tools:`
  line inherit everything, which is a different rule — check which kind you are editing.
- **Disabling a native tool disables everything keyed to its NAME.** Enumerate before flipping:
  hook matchers, `permissions.deny` patterns, env skip-lists. Measured here with an isolated
  project-level hook:

  ```
  matcher "Bash"                                → fired for Bash only
  matcher "Bash|mcp__plugin_nord-core_t__Bash"  → fired for both
  ```

  So `guard-rm.py`, the graphify hook, ~17 `Bash(...)` deny rules and `CLAUDE_MEM_SKIP_TOOLS` do
  **not** cover an MCP shell until their matcher names it. Write down what is no longer enforced,
  in the document the user actually reads.
- **Port logic, do not transcribe it.** `pretooluse-validate-bash.py` looked like protection and
  was never registered in `hooks.json`. Its protected-path regex interpolates `/`, so measured
  against the original: `rm -rf dist/` → DENY, `rm -rf build/` → DENY, while `rm -rf "$HOME"` →
  ASK — and an MCP handler has no channel to ask, so ASK means execute. A literal port would have
  blocked routine cleanup and permitted the one thing worth blocking.
- **Budget the schema for your CHEAPEST consumer.** ≤1 required parameter, ≤7 properties, a short
  description. `gate-worker` runs on `qwen3.6-plus`; see
  `skills/gate-loop/references/gate-pattern.md` on verbose schemas and tool selection. Verify by
  A/B with a deliberately bloated third arm — if that arm does not score worse, the harness is not
  sensitive enough for "no difference" to mean anything.
- **Delete the dead guard in the same commit.** Unregistered protection reads as active protection
  to the next auditor.
- **The version travels with the payload.** `marketplace.json` advertised 1.18.0 while
  `plugin.json` said 1.20.0. Bump both in one commit.

## Checklist

1. `npm run mcp:smoke` — record the BEFORE surface.
2. `npm run plugin:copies` — record existing drift, so new drift is distinguishable.
3. Make the change in `src/`; add or update the named assertion for it.
4. `npx tsc --noEmit`, then the targeted test files. **`npm test` is not a gate** — 206
   pre-existing failures.
5. `node scripts/build-mcp-server.mjs`.
6. `npm run mcp:smoke` — diff against step 1. An unexplained count change is the finding.
7. Copy the changed shipped files into the nord-kit payload; bump `plugin.json` **and**
   `marketplace.json` in the same commit.
8. Commit and push **nord-kit only** — nord-core's only remote is `upstream`
   (Yeachan-Heo/oh-my-claudecode) and is not where this ships.
9. Copy to a new versioned cache dir; point `installed_plugins.json` at it. Keep the previous dir
   until every running session has restarted.
10. `npm run mcp:smoke -- --bundle <cache>/bridge/mcp-server.cjs` — the cache copy is what runs.
11. `npm run plugin:copies` — only the intended files may differ from step 2.
12. Restart a session and confirm the tool is listed and callable.

## Do NOT

- Do NOT ship a tool-surface change without a before/after probe diff.
- Do NOT edit only the source repo. Three copies exist; the CACHE is what runs.
- Do NOT rename a tool and re-categorise it in the same commit — you lose the ability to tell
  which one moved the surface.
- Do NOT `git push` from nord-core.
- Do NOT trust a green suite as evidence that a tool works. It says the code compiles and the unit
  behaves; it says nothing about whether the shipped server can answer.
