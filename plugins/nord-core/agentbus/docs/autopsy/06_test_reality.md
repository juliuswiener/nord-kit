# 06 — Test reality

## What the harness claims

README: *"`bun e2e.ts` drives the real broker and the real `agent-channel.ts` as subprocesses and
asserts, deterministically and with no human in the loop."* `e2e.ts:2-6` repeats this.

## What it actually covers (fair credit)

`e2e.ts` is a genuinely good transport test. It spawns the real `bus.ts` and real
`agent-channel.ts` (`e2e.ts:56-66`) and asserts, against a live broker on an isolated port 9077:

- live directed delivery + sender exclusion (`:106-115`)
- symmetric reply path (`:117-121`)
- broadcast to all-but-sender (`:123-132`)
- offline durability with a real client redeliver+ack (`:136-145`)
- broker-restart durability on disk + in `/status` (`:148-160`)
- the self-heal reconnect after broker restart (`:165-187`)
- **identity: a once-announced name resolves to the session's current transport across
  reconnect+rename** (`:189-214`)

The identity test (`:189-214`) is the important one — and it PASSES. But note *how* it passes: it
uses `rawSubscriber(agent, session)` with an **explicit `session=` argument** (`e2e.ts:73-79`). It
tests the marketplace/session-centric path. It does **not** test the 1.4.0 legacy path the fleet
actually runs (no `session=`), and it does **not** test two distinct sessions claiming one name
(the collision of 02) — only one session reconnecting under a new alias. **The harness proves the
identity model works in the mode the fleet doesn't use, and never exercises the mode that failed in
production.**

## What "deterministic, no human" omits — the harness is red here

Running `bun e2e.ts` from inside this live CC session produces **3 failures**, reproducible and
identical on the parent commit (i.e. not caused by `48fd92c`):

```
FAIL  self-heal: client subscribed initially
FAIL  self-heal: idle client auto-reconnected after broker restart (no wedge)
FAIL  self-heal: delivers + acks after reconnect
```

**Root cause** (CONFIRMED from code): `spawnClient()` passes `env: { ...env, AGENT_ID: agentId }`
(`e2e.ts:62-64`), and `env` is `{ ...process.env, … }` (`e2e.ts:17-18`). So the spawned test client
inherits the **parent session's `CLAUDE_CODE_SESSION_ID`** (`b1d71401…`). The real client resolves
its name-file from that id (`agent-channel.ts:15` `NAME_FILE = /tmp/agentbus-name-${SESSION_ID}`),
and its 3-second name-file watcher (`:145-147`) sees the *parent's* name (`main`) ≠ its startup
`AGENT_ID` (`healer`) → it `/rename`s `healer → main` and re-subscribes as `main`. The broker log
during the failing run shows exactly this: `RENAME healer -> main` and
`registered name=main session=b1d71401…`. The assertion `s.connected.includes('healer')` can never
hold — the client renamed itself off `healer`.

**Implications**:
1. "Deterministic, no human in the loop" is true only in a clean shell with no
   `CLAUDE_CODE_SESSION_ID` / no matching name-file. Run by an agent inside a named session — the
   most likely way it gets run in this ecosystem — it is red on 3 assertions.
2. The failure is a **real, latent product bug wearing a test-isolation costume**: it demonstrates
   that any process inheriting a session's `CLAUDE_CODE_SESSION_ID` and running the channel client
   will hijack that session's busname. The test harness is the first victim; a subagent or spawned
   tool that inherits the env is the next.
3. The self-heal capability the 3 red assertions are meant to protect (`e3f5eec`, `2509b3b`) is
   almost certainly still working — the failures are identity contamination, not wedge regressions —
   but the harness can no longer *prove* it in this environment. A test you can't trust green is a
   test that has stopped protecting the thing it covers.

## Gaps in coverage (what no test asserts)

| Uncovered behavior | Why it matters |
|---|---|
| Legacy client (no `session=`) two-session name collision | This is the production failure mode (02). Untested. |
| Squatting: idle holder receives+acks, active session on another name | The reception-killer (02-2b, 03-1). Untested; no assertion that a live session actually *rendered* a message. |
| Ghost/broadcast unbounded growth | No test bounds `inbox.json` size or ghost count (04). |
| seq regression when SEQ_FILE is missing/unwritable | `6ae1220` fixed the happy path; no test for a wiped `AGENTBUS_HOME` (03-2). |
| The `48fd92c` war convergence | Verified this session by an ad-hoc repro (2 legacy clients → 35 rejects, 4 regs, incumbent stable, message received), **not** added to `e2e.ts`. The fix ships without a regression test in-tree. |

## Verdict

The harness is above-average for a personal tool and its transport assertions are trustworthy. But
its headline — deterministic, complete, green — is false in the environment it will usually run in,
and its coverage systematically avoids the identity-collision surface that is the system's actual
weakness. It tests the pipe thoroughly and the addressing barely.
