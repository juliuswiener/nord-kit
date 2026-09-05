# gate-persist.cjs — the Stop-hook contract

Read this when a `--from goal|plan` loop will not stop, will not continue, or after
editing the hook. It is maintenance detail, not runtime instruction, which is why it is
not in SKILL.md.

The continuation guarantee behind Part B is a Claude Code **Stop hook**,
`hooks/gate-persist.cjs`.

## Block / allow

- **Block** — keep going. Print `{"decision":"block","reason":"<directive>"}` on stdout,
  exit 0. Claude Code does not stop; it re-injects `reason` as the next instruction and
  re-invokes with `stop_hook_active: true`. gate-persist deliberately ignores that flag —
  it relies on deterministic story state, the iteration cap and a 2 h staleness window, so
  the flag alone cannot trick it into an infinite loop.
- **Allow** — let it stop. Print nothing, exit 0. Emitted when every story is
  `passes:true`, when there is no active state, when the cap is hit, when the state is
  stale, or when a safety bypass fires (context limit, ≥95 %, user abort, auth error).

## Repo-root resolution

The hook walks up from `input.cwd` to the directory holding `.nord` (preferred) or `.git`
before reading `.nord/state` and `.nord/prd.json`. A nested cwd or a git worktree still
finds the loop's root. The walk is bounded at 40 iterations and falls back to cwd.

## The mirror

The served copy is `cache/nord/nord-core/<version>/hooks/gate-persist.cjs`. An edit must
land in **both** the marketplace source and the cache mirror, or the running hook is the
old one — and the plugin cache is version-nested, so a plugin update creates a new
directory rather than overwriting the edit. The symptom is a fix that provably works in
the source file and changes nothing at runtime.

## Verify without a live session

Pipe a fake stop event:

```sh
printf '{"cwd":"<repo>","session_id":"t"}' | node hooks/gate-persist.cjs
```

A red story prints the `block` JSON; all-green prints nothing.

Live confirmation: launch Claude Code in a scratch directory with one `passes:false` story
and `active:true`, end the turn (it must re-inject rather than stop), flip the story to
`passes:true` (it must stop), then run `abort`.

**Only one Stop hook may be active** for a clean verdict — a second continuation hook,
such as double-shot-latte's LLM judge, masks this one and every result is ambiguous.
