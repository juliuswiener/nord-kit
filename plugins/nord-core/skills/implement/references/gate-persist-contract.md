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
  `passes:true`, when there is no active state, when a state carries no `session_id`
  (not this session's loop), when the cap is hit, or when the state is stale. There is no
  other bypass: the Stop payload carries no stop-reason field to key one on (measured on
  CC 2.1.261 — ten keys, none of them a reason), and the host already ends the turn before
  this hook runs on prompt-too-long, API/auth errors and Ctrl+C, and overrides a Stop hook
  after `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP ?? 8` consecutive blocks.

## session_id is mandatory

Every writer of `state.json` **must** set `session_id`. A state without one is treated as
not-this-session's-loop and skipped (same as a genuine mismatch) — the alternative, an
empty `session_id` matching every session by omission, blocked every session in the repo
regardless of who started the loop.

## The iteration cap is capped at 8

`max` is clamped to `HARD_MAX = 8` in the hook (`Math.min(st.max, 8)`) — CC overrides a
Stop hook after 8 consecutive blocks regardless (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP ?? 8`),
so a state file writing anything above 8 has no effect; the skill writes 8.

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
