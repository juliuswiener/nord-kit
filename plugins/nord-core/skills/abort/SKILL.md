---
name: abort
description: "Abort an active persistence loop started by `implement --from goal|plan`. Marks the mode inactive and clears the PRD so the gate-persist Stop-hook stops blocking. Use for 'cancel', 'stop the loop', 'abort the implement run', 'kill the persistence'."
---

# cancel — abort a persistence loop

Stops an active PRD/persistence loop so the `gate-persist` Stop-hook no longer blocks the session.
Pure file ops, no MCP.

## Run
1. Set `"active": false` in every `<repo>/.nord/state/*-state.json` (the Stop-hook treats `!active` as
   allow-stop). If the user named one mode, only that file; else all.
2. Remove `<repo>/.nord/prd.json` (the story SSOT) so no red stories remain to re-trigger blocking.
3. Confirm what was cancelled (which mode(s), how many stories were still red).

```sh
for f in .nord/state/*-state.json; do
  [ -e "$f" ] && python3 -c "import json,sys;p=sys.argv[1];d=json.load(open(p));d['active']=False;json.dump(d,open(p,'w'),indent=2)" "$f"
done
[ -e .nord/prd.json ] && safe-tmp-rm-equivalent  # remove prd.json via the normal file tool, not rm
```

Do NOT delete the state files themselves (nord-hud may still read them; `active:false` is enough). After
cancel, a fresh `implement --from goal|plan` writes a new prd.json + flips `active:true` again.

The `*-state.json` glob in step 1 is deliberate and is why this skill needed no change when
`ralph`/`team`/`autopilot` became `implement` on 2026-09-05: it cancels whatever modes it finds,
including an `implement-state.json` and any stale `ralph-state.json` left over from before.
