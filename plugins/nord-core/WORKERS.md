# NORD WORKERS — cheap-worker substrate (claude_bridge)

The shared substrate that nord's cheap-worker seams (`implement`, and the gather lanes of
review/audit/research) assume. Bench-verified — see
`/home/julius/00_projects/local-llm-harness-research/BENCH-FINDINGS.md`.

## How it works
Claude Code forwards a subagent's (or Workflow `agent({model})`'s) **`model:` id verbatim** to
`ANTHROPIC_BASE_URL`. `claude_bridge` (HTTP proxy on **:8318**, serving the Anthropic Messages API)
matches that id against its `[routing]` model-glob rules → provider:

| model id (glob) | provider | cost | use |
|---|---|---|---|
| `worker`, `worker-gemini` | bridge-resolved | **$0** flatrate | cheap workers (volume) |
| `gemini-2.5-flash`, `gemini-3*-preview` | `google` | subscription | grounded web research |
| `claude-*` (opus/sonnet) | `claude_max` | subscription | frontier / escalation |

Canonical worker = **`worker`**. Ask the bridge rather than this table: `curl -s $ANTHROPIC_BASE_URL/v1/models`
lists what is routable. Measured 2026-08-10, the catalog holds claude-* plus the classes `compact`,
`orchestrator`, `researcher`, `worker`, `worker-gemini` — every raw vendor id that used to stand here
(`qwen3.6-plus`, `glm-5.1`, `deepseek*`, `kimi*`, `minimax*`) now fails with "may not exist or you may
not have access to it".
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
`bridge/mcp-server.cjs` (the `t` server) ships **24** tools (`lsp_*`, `ast_grep_*`, `python_repl`,
`memory_save`, `docs_chat`, `Bash`/`BashOutput`/`KillShell`). That does NOT violate the ≤3-5
active-tools rule: they surface to the model as **ToolSearch-DEFERRED** (e.g.
`mcp__plugin_nord-core_t__lsp_*`), so they cost ~0 active-budget tokens until explicitly searched
and loaded. The rule is about *active* tools per task.

There is no MCP entrance to `.nord/state` or to skill loading, and none is needed: the skills and
the `gate-persist` hook read and write `.nord/state/*.json` directly, and
`scripts/skill-injector.mjs` loads skills from the prompt hook.

- **Env-slim is available.** `NORD_DISABLE_TOOLS` is wired (`disable-tools.ts`); measured,
  `=custom` removes exactly `{Bash, BashOutput, KillShell}` and `=python` exactly `{python_repl}`.
- **The bundle has source.** `node scripts/build-mcp-server.mjs` builds it from
  `src/mcp/standalone-server.ts` (esbuild). Rebuild it; never hand-edit the bundle.

Verify the surface with `npm run mcp:smoke` before and after any change to it.

## Cache mirror + version label
The live copy CC loads is whatever `installed_plugins.json` names in nord-core's `installPath` —
read it, never assume it. Any hook/skill/doc/bundle edit must be mirrored into that dir or the running
copy is stale. `node scripts/plugin-copies-diff.mjs`, run from THIS directory, compares source
(this repo), marketplace payload and live cache over the shipped paths and reports what differs;
run it before and after a rollout, since only the diff between the two runs distinguishes new drift
from old. It derives its source from its own location, so where it runs from decides what it
compares — the `npm run plugin:copies` wrapper this line used to name lived in the nord-core
development repo, retired 2026-09-03.
