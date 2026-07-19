# 02 — The identity crisis (central finding)

Everything the bus does well at the transport layer is undermined by one fact: **a message is
addressed to a name, and nothing in the system guarantees a name maps to exactly one live session
— or to the session the sender means.** Three independent mechanisms produce name collisions, and
the one defense that was designed for it is disabled in the live fleet (01, skew).

## Mechanism 1 — the identity hook is a collision factory

`agentbus-name.cjs:25-37` derives the busname with this fallthrough:

```js
function pick() {
  const env = process.env.AGENT_ID
  if (env && env !== '${AGENT_ID}') return env      // 1. explicit env
  if (launchName) return String(launchName)         // 2. session title / --name
  try { const b = git branch --show-current; if (b) return b } catch {}  // 3. GIT BRANCH
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  return dir.split('/').filter(Boolean).pop() || 'agent'   // 4. PROJECT DIR  → 5. 'agent'
}
```

**Status in code**: CONFIRMED collision source — `agentbus-name.cjs:29-37`.

Steps 3–5 derive identity from **shared** properties. Two sessions on the same git branch get the
same name. Two sessions in the same project directory get the same name. Any session that reaches
the final fallback becomes `agent`. None of these are unique per session, yet each becomes a bus
identity that other sessions address and that the broker treats as a routable target.

**Empirical corroboration** (`/status` right now): the ghost inbox names include `agent` (27 stuck
messages), `gplan`, `smoke`, `diag`, `julius-test`, `debugtest1` — i.e. project/branch/fallback-derived
names, exactly what steps 3–5 mint. The hook comment claims it "removes… the `${AGENT_ID}`
unexpanded-var ghost peer" (`agentbus-name.cjs:5`), yet `/status` still lists a live-registry entry
for the literal `${AGENT_ID}` — the ghost it claims to have removed is present. The removal is real
for *new* sessions; the claim that the ghost is gone is FALSE as a statement about system state.

## Mechanism 2 — `--fork-session` duplicates a busname

A `--fork-session` gets a new `session_id` but resumes another session's history and title. On
SessionStart the hook derives the *same* name (via `launchName`, step 2) and writes it to the
fork's own name-file. Result: two live sessions, two name-files, **one busname**.

**Status in code**: CONFIRMED by live evidence during the 2026-07-18 incident — four distinct
session UUIDs all wrote `taxgraph-instructor` to their name-files; the broker log shows
`registered name=taxgraph-instructor session=taxgraph-instructor` once per second (the war). The
fork's parent cmdline: `--session-id b4f888c6 --fork-session --resume …/7b118de8-….jsonl`.

Under the 1.4.0 client (no `session=`), both collapse to `sessionKey = taxgraph-instructor`. This
produces two failure sub-modes:

### 2a — Supersede war (both sessions active)

Each `/subscribe` calls `sessions.get(sessionKey)?.closer()` (`bus.ts:118`) to supersede the prior
stream of the same key. Two distinct streams under one key close each other; each client reconnects
in ~1 s and re-supersedes → a 1 Hz war. A message delivered mid-flip is acked by the dying copy and
lost.

**Fix status: PARTIALLY FIXED** by `48fd92c` (this session). The flap guard now also rejects a
storming newcomer when `sessions.has(sessionKey)` (`bus.ts`, guard extended past the original
`owner !== sessionKey` condition). Verified to converge in a repro (2 legacy clients → 35 rejects,
4 registrations, incumbent stable, message delivered — see 06). **It bounds the war; it does not
prevent the collision.**

### 2b — Squatting (one session idle, one active) — THE reception-killer, UNFIXED

If the name-holder is an *idle* fork (never sends, still subscribed) and the *active* session runs
under a different name (its own uuid, because it never re-claimed the busname), then:

- Sender → busname → delivered live to the **idle** holder → its client acks (`:207-211`,
  deterministic) → `inbox[busname]` drains to 0 → the active session never sees it.
- Active session → devs → sent under its uuid → devs receive → "works the other direction."

**Status in code**: CONFIRMED by live evidence — the busname `taxgraph-instructor` was held by an
idle `SNl` fork (`b4f888c6`, never a SEND source), while the interactive instructor spoke as raw
uuid `dc376067`. There is **no code that detects or prevents this.** The only remedy applied was
manual: rewrite the squatter's name-file to release the name, then write the active session's
name-file to claim it. That remedy lives in an operator's head and this autopsy, not in the system.

## Mechanism 3 — the session-param defense is undelivered

The broker's flap guard *can* distinguish two distinct sessions claiming one name — but only when
they present distinct `sessionKey`s, i.e. when the client sends `session=` (`bus.ts:110`
`owner !== sessionKey`). The marketplace client does (`agent-channel.ts:185-186`). The live 1.4.0
client does not (01). So on the live fleet, a genuine two-session collision is indistinguishable at
the broker from one session reconnecting, and the flap guard's original clause never fires. My
`48fd92c` patch works *around* this by keying on `sessions.has(sessionKey)` instead — deliberately,
because it cannot rely on the client sending `session=`.

**Status**: CONFIRMED. The identity fix `a4f409d` is architecturally correct and effectively dead
for the fleet until every long-lived session is relaunched onto a client that sends `session=`.

## Why this is the central finding

| Layer | Quality |
|-------|---------|
| Transport (SSE, heartbeat, watchdog, durability) | Solid — genuinely well built |
| Identity (who is this name, is it unique, does it follow the right session) | **Structurally unsound** |

The transport is a reliable pipe to a name. The system has no reliable notion of what a name *is*.
Every catastrophic symptom (message loss, dead reception, the multi-hour taxgraph outage) is an
identity failure wearing a transport costume.

**Right now, on this host**: three live processes are named `main` (`/status` + proc scan). That is
an active, unresolved collision as this report is being written — the same disease, asymptomatic
only because those three happen to be the same underlying session's duplicate channel spawns.
