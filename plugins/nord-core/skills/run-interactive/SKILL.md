---
name: run-interactive
description: "Run a command that needs a real TTY or human input — sudo password, ssh passphrase, installer questions, TUI — in a tmux pane the user types into directly. Agent subprocesses have no TTY, so such commands fail ('sudo: a terminal is required to read the password'). Use whenever a command prompts interactively, needs privilege escalation, or already failed for lack of a TTY. Triggers: sudo needs password, interactive prompt, terminal required error, ssh passphrase, installer asks y/n."
argument-hint: "<command>"
---

# run-interactive — TTY commands via tmux pane

Agent Bash has no TTY, so interactive prompts can't read input. Run the command in a tmux pane instead: real TTY, and the user types secrets directly into the pane — input never passes through the agent or the transcript.

## Rules
- Never send a password/secret via `send-keys` — that would put it in your context and the transcript. The user types it in the pane. If a secret would have to pass through you, stop and hand the whole command to the user.
- Wait for the `NORD_RC=` marker before concluding; partial output is not success.
- Spawn panes with an explicit `bash` (user's default shell may be fish, where `$?` breaks the marker).

## Procedure

1. **Pane** (first match wins):
   - CC inside tmux (`$TMUX` set): `PANE=$(tmux split-window -dv -PF '#{pane_id}' bash)` — appears in the user's current window.
   - tmux server running, CC outside: `SESH=$(tmux ls -F '#{session_name}' | head -1); PANE=$(tmux new-window -adt "$SESH" -PF '#{pane_id}' bash)` — tell the user which session/window.
   - No server: `tmux new-session -ds nord-run bash; PANE=$(tmux list-panes -t nord-run -F '#{pane_id}')` — tell the user: run `tmux attach -t nord-run` in another terminal.
2. **Send** (escape `$` so the marker carries digits at runtime; the echoed command line shows literal `$?` and can't false-match):
   ```bash
   tmux send-keys -t "$PANE" "<cmd>; echo NORD_RC=\$?" Enter
   ```
3. **Poll** every ~3s, up to 300s (a human is in the loop — be patient):
   ```bash
   tmux capture-pane -pt "$PANE" -S -100 | grep -oE 'NORD_RC=[0-9]+' | tail -1
   ```
   - Capture shows a pending prompt (`[sudo] password`, `(yes/no)`, …) → tell the user what is being asked and where to type (pane/session), keep polling.
   - Timeout → report the last ~20 captured lines, leave the pane open, stop.
4. **Done**: `RC=0` → `tmux kill-pane -t "$PANE"`, report. `RC≠0` → leave the pane open for inspection, report RC + last ~20 lines.

## Notes
- **Long output**: `capture-pane` only sees the last ~100 scrollback lines — fine for prompts and short results, lossy for anything bigger. When you need the full output, redirect inside the pane and read the file after the marker: `send-keys "<cmd> > /tmp/nord-run-out.txt 2>&1; echo NORD_RC=\$?"`, then `Read /tmp/nord-run-out.txt`. Only the prompt needs the TTY, the output doesn't.
- Captured output contains no secrets — password input isn't echoed.
- Several privileged steps? One pane running the whole sequence (one password entry, sudo caches per-TTY) beats N panes.
- This solves the general class (sudo, ssh, installers, TUIs) with zero sudoers changes; prefer it over NOPASSWD/askpass infrastructure.
