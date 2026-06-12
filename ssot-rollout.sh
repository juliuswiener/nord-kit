#!/usr/bin/env bash
set -u
# All non-local plugins are mirrored in the nord marketplace (SSOT). Install missing-by-name from @nord.
CATALOG=(
oh-my-claudecode caveman claude-mem superpowers claude-session-driver double-shot-latte
github claude-md-management skill-creator claude-code-setup lua-lsp rust-analyzer-lsp
plugin-dev clangd-lsp agent-sdk-dev circleback frontend-design create-worktrees claude-hud
)
INST=$(python3 -c "import json,os;print(chr(10).join(k.split('@')[0] for k in json.load(open(os.path.expanduser('~/.claude/plugins/installed_plugins.json')))['plugins'].keys()))" 2>/dev/null)
claude plugin marketplace update nord >/dev/null 2>&1
for name in "${CATALOG[@]}"; do
  if printf '%s\n' "$INST" | grep -qx "$name"; then echo "have: $name"; continue; fi
  out=$(claude plugin install "${name}@nord" 2>&1 | tail -1)
  echo "install ${name}@nord => $out"
done
echo "DONE"
