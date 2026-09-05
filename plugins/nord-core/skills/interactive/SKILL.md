---
name: interactive
description: "Run a command that needs a real TTY or human input — sudo password, ssh passphrase, installer questions, TUI — somewhere the user can actually type. Agent subprocesses have no TTY, so such commands fail ('sudo: a terminal is required to read the password'). For a plain sudo command it uses `sudo -A` with a GUI password dialog and needs no terminal at all; for anything else it opens a real pane, preferring the tmux the user is already in and falling back to spawning a terminal window. Triggers: sudo needs password, interactive prompt, terminal required error, ssh passphrase, installer asks y/n."
argument-hint: "<command>"
---

# interactive — commands that need a human at a keyboard

Agent Bash has no TTY, so interactive prompts cannot read input. This gets the command
somewhere a TTY exists and the user can type.

**The secret never passes through you.** Not via `send-keys`, not as an argument, not in
a variable you construct. The user types it into a dialog or a pane. If a design would
require a secret to travel through your context, stop and hand the whole command over.

## Pick the lowest rung that applies

| # | when | what happens |
|---|---|---|
| **0** | the command is `sudo <something>` **and** a GUI is present | `sudo -A` with a password dialog. **No terminal, no tmux**, and stdout/stderr come back to you normally |
| 1 | `$TMUX` is set — you are inside the user's tmux | split a pane in their current window |
| 2 | `$HERDR_PANE_ID` is set | a herdr pane |
| 3 | a tmux server is running, you are outside it | new window in the first session, and say which |
| 4 | none of the above, but `$DISPLAY` or `$WAYLAND_DISPLAY` is set | create a detached tmux session **and spawn a terminal attached to it**, so it appears on screen |
| 5 | no GUI at all (headless, ssh without X) | detached tmux session; tell the user to run `tmux attach -t nord-run` |

Rungs 1–5 all end with a tmux pane, so the send/poll procedure below is identical for
each — only how the pane becomes visible differs.

## Rung 0 — `sudo -A`, the zero-window path

This is the canonical answer to "no TTY, needs a sudo password", and for the common case
(one privileged command) it is strictly better than a pane: no window to find, no
100-line capture limit, and the exit code and full output arrive the ordinary way.

```sh
# One stable helper at a literal path, created if absent. It holds NO secret — only the
# call that asks for one — so there is nothing to clean up and nothing to delete.
mkdir -p ~/.cache/nord
printf '#!/bin/sh\nzenity --password --title="sudo password for Claude Code" 2>/dev/null\n' \
  > ~/.cache/nord/askpass.sh
chmod 700 ~/.cache/nord/askpass.sh

SUDO_ASKPASS=~/.cache/nord/askpass.sh sudo -A <cmd>
```

**Why a fixed path and not `mktemp` plus cleanup.** The obvious version ends in
`rm -f "$ASKPASS"`, and this device's `guard-rm.py` refuses that — a deletion whose target
is a runtime variable cannot be checked against the protected list, and unknown is a block.
That rule has stopped two real accidents here, so the skill bends around it rather than the
other way. Measured 2026-09-05, while testing this very procedure.

`zenity --password` writes the typed password on stdout, `sudo -A` reads it there, and
neither ever touches your context. Alternatives if `zenity` is absent, same contract:
`ssh-askpass`, `ksshaskpass`, `lxqt-openssh-askpass`. `systemd-ask-password` also works
but prompts on the console, not in a window — check it is visible before relying on it.

**Rung 0 covers sudo and nothing else.** An ssh passphrase, an installer asking `y/n`, or
a TUI needs a real terminal — go to rung 1.

> This reverses the old advice at the bottom of this file ("prefer a pane over askpass
> infrastructure"). That was written when askpass meant *installing* something and editing
> sudoers. It does not here: the helper is three lines in a temp file, deleted immediately,
> and nothing persistent changes.

## Rungs 1–5 — get a pane

```sh
# 1  inside tmux
PANE=$(tmux split-window -dv -PF '#{pane_id}' bash)

# 3  server running, we are outside
SESH=$(tmux ls -F '#{session_name}' | head -1)
PANE=$(tmux new-window -adt "$SESH" -PF '#{pane_id}' bash)

# 4  no session, but a GUI — create one AND make it visible
tmux new-session -ds nord-run bash
PANE=$(tmux list-panes -t nord-run -F '#{pane_id}')
if   command -v kitty     >/dev/null; then kitty --detach -e tmux attach -t nord-run
elif command -v alacritty >/dev/null; then setsid -f alacritty -e tmux attach -t nord-run
elif command -v xterm     >/dev/null; then setsid -f xterm -e tmux attach -t nord-run
fi

# 5  headless — same session, no window; tell the user to attach
tmux new-session -ds nord-run bash
PANE=$(tmux list-panes -t nord-run -F '#{pane_id}')
```

Spawn panes with an explicit `bash`: the user's default shell is fish, where `$?` does
not carry and the marker below breaks.

Rung 4 is why a terminal is spawned rather than the command being run in it directly —
the window is only how the user *reaches* the pane. Everything else keeps working
unchanged, and if the user closes the window the session survives.

## Send, poll, finish

```sh
# escape $ so the marker carries digits at runtime; the echoed command line then shows a
# literal $? and cannot false-match the grep below
tmux send-keys -t "$PANE" "<cmd>; echo NORD_RC=\$?" Enter
```

Poll every ~3 s, up to 300 s — a human is in the loop, be patient:

```sh
tmux capture-pane -pt "$PANE" -S -100 | grep -oE 'NORD_RC=[0-9]+' | tail -1
```

- Capture shows a pending prompt (`[sudo] password`, `(yes/no)`, …) → say what is being
  asked and **where to type it** (which session, window, or that a terminal just opened),
  then keep polling.
- Timeout → report the last ~20 captured lines, leave the pane open, stop.
- `RC=0` → `tmux kill-pane -t "$PANE"` and report. `RC≠0` → leave the pane open for
  inspection, report the code and the last ~20 lines.

## Notes

- **Long output.** `capture-pane` sees only the last ~100 scrollback lines — fine for
  prompts and short results, lossy beyond that. Redirect inside the pane and read the file
  after the marker: `send-keys "<cmd> > /tmp/nord-run-out.txt 2>&1; echo NORD_RC=\$?"`,
  then read that file. Only the prompt needs the TTY; the output does not. Rung 0 has no
  such limit.
- Captured output contains no secrets — password input is not echoed.
- Several privileged steps? One pane running the whole sequence beats N panes: sudo caches
  per-TTY, so the user types once. On rung 0, chain them in a single `sudo -A sh -c '...'`
  for the same reason.
- No sudoers change is needed on any rung, and none is made.
