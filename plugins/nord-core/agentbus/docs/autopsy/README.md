# agentbus — Adversarial Autopsy (2026-07-19)

Forensic post-mortem of the nord-core **agentbus** peer message bus for Claude Code sessions.
Source of truth is the running code, not the README, comments, or prior claims. Every finding is
anchored to a file and line.

## Scope

- `bus.ts` — the standalone broker (HEAD `48fd92c`, 14.8 KB).
- `agent-channel.ts` — the per-session MCP channel client. **Two versions in play**: the
  marketplace/deployed copy and the `1.4.0` cache copy the live fleet actually runs.
- `agentbus-name.cjs` — the SessionStart hook that derives each session's bus identity.
- `busname/SKILL.md`, `.mcp.json`, `hooks.json`, `e2e.ts`, `README.md`.
- Live runtime state on this host (broker PID 631561→2393277, ~5 live sessions, taxgraph fleet).

Path root: `/home/julius/.claude/plugins/marketplaces/nord/plugins/nord-core/agentbus/`
(a checkout of the operator's own `juliuswiener/nord-kit` repo).

## One-sentence verdict

**agentbus is a well-engineered transport layer bolted onto a fundamentally unsafe identity
layer: the broker faithfully delivers messages to a *name*, but nothing guarantees that name maps
to the session the sender means — so under the routine conditions of this deployment (forks,
same-project sessions, a client-version skew that disables the identity fix) messages are silently
delivered to the wrong session or an idle ghost, which the durability machinery then dutifully
acks into the void.**

## Reading order

| # | Document | What it establishes |
|---|----------|--------------------|
| — | `README.md` | This index + verdict + caveats |
| 01 | `01_anatomy.md` | How the transport actually works, and the version-skew reality |
| 02 | `02_identity_crisis.md` | **The central finding**: name collision, fork duplication, dead session-param |
| 03 | `03_message_loss.md` | Three concrete loss modes vs the "messages survive" durability claim |
| 04 | `04_ghost_accumulation.md` | Unbounded ghost inboxes + broadcast amplification (empirical: 62 / 1041) |
| 05 | `05_claim_verification.md` | README/comment/test claims traced to code — confirmed / false / stale |
| 06 | `06_test_reality.md` | Why "e2e passes deterministically" is conditional and currently red here |
| 07 | `07_kill_conditions_verdict.md` | Kill conditions + True/Uncertain/False honesty matrix + fix priorities |

If you read one document, read **02** (the disease) and the honesty matrix in **07** (the diagnosis).

## Critical caveats — what this analysis does and does not trust

- **Trusted**: the source files above, live `/status` output, live `journalctl` from the broker,
  the running process table, and the git log. These agree with each other.
- **Not trusted, and demolished where it conflicts**: the `README.md` (predates the current
  identity system — see 05), the "Known limits" section (understates the identity failure to a
  one-line "clobber"), and code comments that claim a bug was *removed* when a ghost of it is still
  live in `/status` (the `${AGENT_ID}` peer).
- **What this cannot tell you**: whether a given delivered-but-unread message was *seen by a human*
  — the render inside a live CC session is out-of-band (the one thing the test harness also can't
  assert). Findings about "the session didn't receive it" are inferred from ack/transport state
  plus the operator's direct report during the 2026-07-18 incident, not from reading a CC UI.
- **Author's disclosure of involvement**: earlier this same session I shipped `48fd92c` (the
  supersede-war flap-guard) and performed the live squatter-release that restored the taxgraph
  instructor. This autopsy treats those as part of the system under examination, not as settled
  wins — the war-guard is verified (06), but it fixes only *one* of the identity failure modes; the
  squatting mode has **no code fix at all**, only a manual operational remedy (02, 07).

## The uncomfortable one-liner

The README's headline promise — *"Messages survive the recipient being busy, offline, or not yet
started"* — is true. The promise it does **not** make, and the one that actually bit, is that the
message reaches the *right* recipient. The bus has no concept of session identity strong enough to
guarantee that, and the deployed client version throws away the one mechanism (`session=`) that
was built to provide it.
