# 06 — Migration under version skew

## The constraint

Long-lived sessions pin the plugin/client version active at their launch (`.mcp.json` resolves
`${CLAUDE_PLUGIN_ROOT}` per session). A v2 broker that *requires* `session=` would instantly break
every currently-running legacy (1.4.0) session — a flag-day outage. Migration must be **dual-mode
first, cutover later**, with the cutover gated on the fleet draining naturally.

## Phased rollout

### Phase 0 — deploy dual-mode (no breakage)

- Ship v2 broker with `strict_identity = false` (default). In this mode it:
  - accepts `session=` subscribers → full v2 identity (uniqueness, session-keyed inbox, receipts);
  - accepts legacy no-`session` subscribers → keyed by `session = name` (today's behavior), **with the
    `48fd92c` war-guard retained** so legacy collisions stay bounded during the transition;
  - runs GC, `/close`, `/kill`, `/receipt`, enriched `/status` for **both** kinds.
- Ship v2 client, the rewritten hook, the SessionEnd hook, and the CLI. New sessions and any
  relaunched session immediately run v2.
- Data: on first v2 start, **archive** the old name-keyed `inbox.json` to `inbox.json.bak` and start
  clean. The 1041 stuck messages (autopsy 04) are debris; converting them to `pendingByName` is
  possible but not worth it. (Config `migrate_old_inbox = archive | convert | drop`, default
  `archive`.)

### Phase 1 — drain (observe, don't force)

- `client_version` in `/status` (05) shows the mix of v2 vs legacy peers.
- As sessions close and relaunch, they pick up v2. No action needed beyond a one-line notice to the
  operator/fleet: "relaunch when convenient to get read-receipts + clean identity."
- The war-guard keeps legacy sessions safe until they relaunch. Nothing regresses.

### Phase 2 — cutover (flip strict, delete band-aids)

When `/status` shows no legacy clients (or a chosen cutoff date):

- Flip `strict_identity = true`. Now a no-`session` subscribe gets a control frame
  `{type:"upgrade_required"}` and is refused; uniqueness is enforced with no legacy fallback.
- **Delete** the per-model classifier-style dead code that the legacy path needed: the `48fd92c`
  war-guard in `bus.ts` and the `bus.ts:98` `sessionKey = … ?? name` legacy branch become
  unreachable — remove them. (Note: this is the agentbus war-guard, *not* the claude_bridge classifier
  fail-close from earlier today — different codebase.)

## Config surface (new)

```toml
strict_identity    = false     # Phase 2 flips to true
grace_ms           = 45000     # SSE-drop reconnect window before GC
pending_ttl_ms     = 3600000   # name-pending (pre-launch send) TTL
sweep_ms           = 30000     # GC sweep interval
receipt_cap        = 10000     # bounded receipts map
migrate_old_inbox  = "archive" # archive | convert | drop
```

## Rollback

- The v2 broker is a single file; tag the pre-v2 `bus.ts` (`git tag agentbus-v1`). If v2 misbehaves,
  `systemctl --user stop agentbus`, restore v1 + `inbox.json.bak`, restart. In-flight SSE clients
  reconnect within seconds either way (transport unchanged).
- Because Phase 0 is non-breaking and additive, rollback risk is confined to the new state model, not
  the transport.

## Fleet coordination

One broadcast on the bus at Phase 0 ("v2 live, dual-mode, relaunch for receipts") and one at Phase 2
("strict mode on <date>, legacy clients will be refused — relaunch now"). Same playbook as the
2026-07-18 AUTH-OFF rollout. Sessions relaunch at their own convenience during the drain.
