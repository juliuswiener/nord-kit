# NORD WORKERS — cheap-worker substrate (claude_bridge)

The shared substrate that nord's cheap-worker seams (gate-loop, optionally nord-execute and the
gather lanes of review/audit/research) assume. Bench-verified — see
`/home/julius/00_projects/local-llm-harness-research/BENCH-FINDINGS.md`.

## How it works
Claude Code forwards a subagent's (or Workflow `agent({model})`'s) **`model:` id verbatim** to
`ANTHROPIC_BASE_URL`. `claude_bridge` (HTTP proxy on **:8318**, serving the Anthropic Messages API)
matches that id against its `[routing]` model-glob rules → provider:

| model id (glob) | provider | cost | use |
|---|---|---|---|
| `qwen3.6-plus` (default), `glm-5.1` (fallback), `deepseek*`, `kimi*`, `mimo*`, `minimax*` | `opencode_zen` | **$0** flatrate | cheap workers (volume) |
| `gemini-2.5-flash`, `gemini-3*-preview` | `google` | subscription | grounded web research |
| `claude-*` (opus/sonnet) | `claude_max` | subscription | frontier / escalation |

Canonical worker = **`qwen3.6-plus`** (HARD 84 / best cheap, P1-verified); fallback **`glm-5.1`**.
Avoid `minimax-m3` (weakest). Both dispatch paths verified: Task subagent `model:` (gate-worker) AND
Workflow `agent({model})` forward arbitrary ids to the bridge.

## Hard requirement — launch through the bridge
Cheap-worker ids only resolve when the session is launched through the bridge:

```sh
ANTHROPIC_BASE_URL=http://127.0.0.1:8318 claude
```

(or set it globally: `set -Ux ANTHROPIC_BASE_URL http://127.0.0.1:8318`). Without it, CC resolves
`qwen3.6-plus` against `api.anthropic.com` → **404 "model not found"**. A mid-loop 404 is worse than
no offload, so every cheap-worker seam MUST **preflight** (below) and fail loud.

## Preflight (run before any cheap dispatch)
```sh
test "${ANTHROPIC_BASE_URL%/}" = "http://127.0.0.1:8318" \
  && curl -sf --max-time 5 http://127.0.0.1:8318/healthz >/dev/null
```
On failure: STOP and tell the user the launch line above, OR fall back to a normal model — never let
a `qwen3.6-plus`/`glm-5.1` worker id 404 mid-loop.

## Notes
- Antigravity must stay open only if a `gemini*` worker is used (token refresh); zen + claude_max
  need no IDE open.
- The bridge `[routing]`/`[mapping]` rules live in `/home/julius/00_projects/165_claude_bridge/config.toml`
  and are already wired + bench-verified. nord **consumes** them — never edit bridge internals here.

## `t` MCP bundle — tool count vs the ≤3-5 active-budget rule
`bridge/mcp-server.cjs` (the `t` server) ships **57** tools (`lsp_*`, `ast_grep_*`, `trace_*`, `wiki_*`,
`state_*`, `notepad_*`, `project_memory_*`, `shared_memory_*`, `deepinit_manifest`, `python_repl`,
`Bash`/`BashOutput`/`KillShell`). That does NOT violate the ≤3-5 active-tools rule: those tools surface
to the model as **ToolSearch-DEFERRED** (e.g. `mcp__plugin_nord-core_t__lsp_*`), so they cost ~0
active-budget tokens until explicitly searched/loaded. The ≤3-5 rule is about *active* tools per task.

Two claims that used to stand here were wrong, and both mattered:
- Env-slim IS available. `NORD_DISABLE_TOOLS` is wired (`disable-tools.ts`); measured,
  `=custom` removes exactly `{Bash, BashOutput, KillShell}` and `=python` exactly `{python_repl}`.
- The bundle DOES have source. `node scripts/build-mcp-server.mjs` builds it from
  `src/mcp/standalone-server.ts` (esbuild). The old "no source to rebuild" note is why a dead
  `tools/list` survived three releases unexamined — see TOOLING.md.

Verify the surface with `npm run mcp:smoke` before and after any change to it.

## Cache mirror + version label
The live copy CC loads is whatever `installed_plugins.json` names in nord-core's `installPath` —
read it, never assume it. Any hook/skill/doc/bundle edit must be mirrored into that dir or the running
copy is stale. `npm run plugin:copies` compares source, marketplace payload and live cache over the
shipped paths and reports what differs; run it before and after a rollout, since only the diff between
the two runs distinguishes new drift from old.
