# 07 — Kill conditions, honesty matrix, verdict

## Kill conditions (scenarios that actually cause failure)

### KC-1 — Fork under a live busname → silent reception death (CERTAIN, CRITICAL)

**Path**: `--fork-session` derives the same busname (`agentbus-name.cjs:28`) → two name-files, one
busname → under the 1.4.0 client either a supersede war (02-2a) or, if one goes idle, squatting
(02-2b). In the squatting case, sender → busname → idle holder acks it (`agent-channel.ts:207-211`)
→ `pending: 0`, active session blind.

**Probability: Certain** — this is exactly what happened on 2026-07-18 and forks are routine in this
orchestration setup. **Mitigation in code: none for squatting.** The war half is now bounded by
`48fd92c`. Detection/prevention of the collision itself does not exist.

### KC-2 — Two sessions, same project or branch, no explicit name (HIGH, CRITICAL)

**Path**: `agentbus-name.cjs:29-37` derives the name from git branch or project-dir basename. Two
sessions in `~/00_projects/foo` both become `foo`. Same collision as KC-1, without needing a fork.

**Probability: High** — the fallback is the *default* for any session that doesn't set `AGENT_ID` or
a launch name. **Mitigation: none.** The hook actively creates the collision.

### KC-3 — `inbox.json` on wiped/unwritable `AGENTBUS_HOME` → seq regression → skip-and-ack (LOW, HIGH)

**Path**: SEQ_FILE lost or `persist()` write fails silently (`bus.ts:58-61` swallows nothing but is
not guarded) → `seq` reloads below live clients' `seen` high-water → new messages reuse seen ids →
`agent-channel.ts:205` acks-and-skips them.

**Probability: Low** (needs a wipe/permissions fault) **Severity: High** (silent loss, reopens
`6ae1220`). **Mitigation: partial** — the SEQ_FILE exists; nothing monitors that it persisted.

### KC-4 — Broadcast storm inflates `inbox.json` unboundedly (LOW-MEDIUM, MEDIUM)

**Path**: every broadcast queues into all 62+ ghosts (`bus.ts:164`); `persist()` rewrites the whole
file per send (`bus.ts:169`). Growth is monotonic; only `rm` + restart shrinks it. **Mitigation:
none** (no GC, 04).

### KC-5 — Env-inheriting child hijacks a session's busname (LOW, HIGH)

**Path**: any process that inherits `CLAUDE_CODE_SESSION_ID` and runs the channel client resolves the
parent's name-file and claims the parent's busname (proven by the e2e self-heal failure, 06). A
subagent, a spawned tool, or a test does this.

**Probability: Low in normal use, Certain for `e2e.ts`.** **Severity: High** if it hits a real
session pair. **Mitigation: none.**

## Honesty matrix

### TRUE (verified from code/live evidence)

1. **The transport layer is sound** — SSE + heartbeat + idle-watchdog + keep-until-ack durability all
   work as documented (`bus.ts:78-83,143`; `agent-channel.ts:190`). *(01)*
2. **The identity model is disabled for the live fleet** — the 1.4.0 client sends no `session=`
   (`1.4.0/agent-channel.ts:182`), collapsing the session-centric design to legacy name==transport.
   *(01, 02-3)*
3. **Squatting silently loses messages and has no code fix** — deterministic ack
   (`agent-channel.ts:207-211`) × deliver-to-nameOwner (`bus.ts:78-83`); confirmed live 2026-07-18.
   *(02-2b, 03-1)*
4. **The identity hook manufactures collisions** — git-branch/project-dir fallback
   (`agentbus-name.cjs:29-37`). *(02-1)*
5. **Ghost inboxes grow without bound; no GC exists** — 62 dead inboxes / 1041 stuck messages live;
   only `/ack` prunes (`bus.ts:189`); broadcast targets the full inbox keyset (`bus.ts:164`). *(04)*
6. **The supersede war is now bounded** — `48fd92c` flap-guard extension; repro converges (35
   rejects, 4 regs, incumbent stable, message delivered). *(02-2a, 06)*
7. **The README's identity claims are stale; its transport claims are accurate** — R8/R9 stale, C1
   aspirational for the fleet, C2 false as a state claim. *(05)*
8. **`e2e.ts` is red (3 self-heal fails) inside a named CC session** due to `CLAUDE_CODE_SESSION_ID`
   env inheritance (`e2e.ts:17-18,62-64`). *(06)*

### UNCERTAIN (evidence suggests, proof incomplete)

1. **Whether any *current* live session pair (beyond the resolved taxgraph case) is mis-delivering.**
   Right now 3 procs are named `main` but appear to be one session's duplicate spawns, not two
   distinct sessions — so probably asymptomatic. Resolving this needs mapping each `main` proc's
   parent to confirm they share one Claude session. *(02)*
2. **The true blast radius of KC-5.** It is proven for `e2e.ts`; whether normal subagent spawns
   inherit `CLAUDE_CODE_SESSION_ID` and run the channel client depends on CC's spawn env, which was
   not traced here. Would be resolved by inspecting a subagent process's env + whether it loads the
   `agentbus` MCP server.
3. **Frequency of loss mode 2 (seq/`seen`) in practice.** The high-water file makes it rare; whether
   `persist()` has ever failed silently on this host is unknown without log archaeology.
4. **Whether the `main` triple-spawn itself indicates a client-relaunch bug** (three channel procs
   for one session) or is benign leftover. Not traced.

### FALSE (contradicted by code/evidence)

1. **"Messages survive the recipient being busy, offline, or not yet started"** *as an unconditional
   guarantee* — false under name collision; delivered-and-acked to the wrong holder. *(R1, 03-1)*
2. **"Removes… the `${AGENT_ID}` unexpanded-var ghost peer"** — false as a state claim; the ghost is
   live in `/status`. *(C2, 04)*
3. **"Every name a session ever announces resolves to that session's current live transport"** — false
   for the live fleet (no `session=`). *(C1, 02-3)*
4. **`e2e.ts` "asserts deterministically" (as a general property)** — false in a named CC session.
   *(R10, 06)*
5. **Implicitly, that `list_peers`/`/status` is a usable pre-send check** — of 70 listed ids, 65 are
   dead; the tool's own description sells it as a typo guard (`agent-channel.ts:77-80`) but it is
   dominated by debris. *(04)*

## Verdict & fix priority

The bus is worth keeping — the transport is good and the design decisions in the README are correct.
The failure is isolated to identity, and the fixes are localized. In priority order:

1. **[CRITICAL] Detect + prevent squatting/collision (KC-1, KC-2).** Two sub-fixes: (a) make the
   hook derive a *unique* name (append a short session-id suffix to the branch/dir fallback, or
   refuse to reuse a name a live session already holds); (b) add broker-side squatting detection —
   if a name's live holder never sends and a distinct session addresses it, or on any fork, surface
   it rather than silently acking. Until (a), forks and same-project sessions will keep colliding.
2. **[HIGH] Kill the version skew (root of 02-3).** Either force the fleet onto a client that sends
   `session=`, or make the broker treat a legacy no-`session` subscribe on an already-owned name as a
   collision to reject, not a supersede. `48fd92c` is a workaround at this layer; the clean fix is
   the client sending `session=`.
3. **[HIGH] Move the ack behind a proof-of-render**, or at minimum have the broker *not* purge on an
   ack from a holder whose `session=` differs from the last known live claimant. Removes loss mode 1
   at the durability layer.
4. **[MEDIUM] GC ghosts + fix broadcast fan-out (KC-4).** TTL-evict idle names; broadcast only to
   live `nameOwner` entries, not the full `inbox` keyset (`bus.ts:164`).
5. **[MEDIUM] Fix `e2e.ts` isolation** (`delete env.CLAUDE_CODE_SESSION_ID` in `spawnClient`,
   `e2e.ts:62`) so green is trustworthy; add a legacy-collision and a squatting assertion; add the
   `48fd92c` war-convergence case in-tree.
6. **[LOW] Remove the shipped debug append** (`agentbus-name.cjs:13-15`) and reconcile the README
   with the name-file/hook/`/busname` reality (05, R8/R9).

**The one thing to internalize**: agentbus's durability is a strength that currently amplifies its
one weakness. It will faithfully, persistently, and untraceably deliver your message to the wrong
session. Fix identity before trusting it for anything a human won't independently verify arrived.
