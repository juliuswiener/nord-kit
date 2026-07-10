---
name: busname
description: "Rename this session's agentbus peer identity — the id other sessions address with send_message. Use when the user says 'busname X', 'rename my agent/bus id to X', 'set my agentbus name', or wants peers to reach this session under a new name. Writes the name-file the channel polls; the channel re-subscribes under the new id within seconds and the broker carries any pending inbox over. Does NOT change the Claude Code display title."
---

# busname

Set this session's **agentbus** peer identity (not the Claude Code display title).

The agentbus channel resolves its identity from `/tmp/agentbus-name-$CLAUDE_CODE_SESSION_ID` and
polls that file every ~3 seconds. Writing a new name there makes the channel re-subscribe under it
automatically; the broker migrates any pending inbox to the new id.

## Steps

1. Take the new name from the user's argument (the text after `/busname`). If none was given, ask
   for it. Keep it to a short, typo-resistant id (no spaces).
2. Write it with no trailing newline:
   ```bash
   printf '%s' "<name>" > "/tmp/agentbus-name-$CLAUDE_CODE_SESSION_ID"
   ```
3. Confirm to the user that the agentbus identity will switch within a few seconds, and that peers
   should now address this session as `<name>`.
4. Remind the user: this changes only the **agentbus** id. The Claude Code display title is
   separate — to rename that too, they must run `/rename <name>` themselves (a skill cannot invoke
   the built-in `/rename`).

## Notes

- Verify the switch with `curl -s http://127.0.0.1:9000/status` — the new id should appear under
  `connected` and the old one should drop.
- If `$CLAUDE_CODE_SESSION_ID` is empty, the channel can't map the file to this session; fall back
  to telling the user to relaunch with `AGENT_ID=<name>` set.
