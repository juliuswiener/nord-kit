# nord — Claude Code marketplace

A personal Claude Code marketplace + the **nord-kit** plugin: curated skills, agents, a
canonical task-routing hook, a custom statusline (nord-hud), and MCP servers.

## Install

```sh
claude plugin marketplace add juliuswiener/nord-kit
claude plugin install nord-core@nord          # multi-agent skills, router, statusline (everyone)
claude plugin install nord-ee@nord            # optional: KiCad/SPICE/EE/hardware suite
claude plugin install nord-dev@nord           # optional: Rust/Python/Dart/Flutter helpers
```
Then restart your Claude Code session (skills/hooks/statusline load at session start).

The kit is split into three plugins so you only load the descriptions you need:
**nord-core** (always), **nord-ee** (electronics), **nord-dev** (language helpers).

### Optional: enable the statusline (nord-hud)
The nord-router hook auto-copies `nord-hud.mjs` to `~/.claude/hud/`. To use it, set in
`~/.claude/settings.json`:
```json
"statusLine": { "type": "command", "command": "node $HOME/.claude/hud/nord-hud.mjs" }
```
Shows: `host · dir · ⎇branch · model · ctx% · 4h% ↻reset · wk% ↻reset · ▶agent · ⚙mode`.

### Optional: MCP keys
`nord-kit/.mcp.json` ships `filesystem`, `exa`, `github`, `caveman-shrink`. `exa` and `github`
read their keys from the environment — set them (e.g. in `~/.claude/settings.json` under `env`,
or your shell profile) if you want those servers:
```json
"env": { "EXA_API_KEY": "your-exa-key", "GITHUB_PERSONAL_ACCESS_TOKEN": "your-pat" }
```
No keys → those two servers just fail to start; everything else works. The `filesystem` server
is pinned to `/home/julius` — edit `.mcp.json` for your own home if you want it.

## What's inside (nord-kit)

- **Multi-agent skills** (Workflow-based): `nord-review` (adversarial dimension review),
  `nord-cleanup` (parallel safe-delete), `nord-plan` (parallel planning tournament),
  `nord-exec` (parallel/loop/goal executor).
- **nord-router** SessionStart hook — injects a canonical task-routing policy (one tool per job).
- **nord-hud** custom statusline.
- EE/hardware suite (KiCad, SPICE, distributor search, BOM, …), Rust/Python/Dart helpers,
  brainstorming + audit skills, caveman-styled agents.

## Update

```sh
claude plugin marketplace update nord
claude plugin update nord-kit@nord
```

The marketplace also lists common upstream plugins (oh-my-claudecode, claude-mem, superpowers,
the official LSP/dev plugins, …) by reference, so `claude plugin install <name>@nord` pulls them
from their upstream repos.
