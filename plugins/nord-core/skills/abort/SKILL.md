---
name: abort
description: "Release an active persistence loop started by `implement --from goal|plan`, so the gate-persist Stop-hook stops refusing to let the session end. Use on 'cancel', 'stop the loop', 'abort the implement run', 'kill the persistence', 'abbrechen', 'stopp die Schleife', or when a session will not finish because stories are still red."
---

# abort — release a persistence loop

`implement --from goal|plan` registers a Stop hook that blocks the session from ending
while any story is red. This releases it. Pure file operations: no agents, no MCP.

## Run

1. Set `"active": false` in every `<repo>/.nord/state/*-state.json` — the hook treats
   `!active` as allow-stop. If the user named one mode, only that file; otherwise all.
2. Remove `<repo>/.nord/prd.json`, the story SSOT, so no red story can re-trigger the
   block.
3. Report which modes were released and how many stories were still red.

```sh
for f in .nord/state/*-state.json; do
  [ -e "$f" ] && python3 -c \
    "import json,sys;p=sys.argv[1];d=json.load(open(p));d['active']=False;json.dump(d,open(p,'w'),indent=2)" "$f"
done
```

Delete `prd.json` with the file tools, **not with `rm`** — this device's `guard-rm.py`
blocks a deletion whose target it cannot resolve against the protected list, and the loop
inside a shell variable is exactly that case.

## Verify

Re-read one state file and confirm `"active": false`, and confirm `prd.json` is gone.
The hook decides on file contents alone; if the write did not land, the session will
still refuse to stop and the reason will look like a hook bug.

## Do not delete the state files

`active:false` is enough, and nord-hud still reads them for the statusline. A later
`implement --from goal|plan` writes a fresh prd.json and flips `active:true` again.

The `*-state.json` glob is deliberate. The hook blocks on any state file it finds,
whatever the mode is called, so releasing only the one you expected leaves the session
still stuck with nothing on screen to explain why.
