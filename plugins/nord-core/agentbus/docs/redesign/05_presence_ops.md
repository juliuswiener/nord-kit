# 05 — Presence, investigation & kill

## `/status` — the honest peer view

```jsonc
{
  "peers": [
    {
      "session": "dc376067-…",
      "names": ["taxgraph-instructor"],
      "state": "live",              // live | dropped | (GC'd never appear)
      "last_seen_ms": 1200,         // age since last heartbeat/ack — a large value on a "live" peer = suspect
      "connected_since": 1784410633557,
      "pending": 0,                 // messages queued in THIS session's inbox
      "pid": 2311408,               // reported by the client on subscribe (meta)
      "ppid": 2013355,              // parent — if the CC parent is gone, this is a zombie
      "cwd": "/home/julius/00_projects/168_TaxGraph/taxgraph",
      "title": "taxgraph-instructor",
      "client_version": "2.0.0"
    }
  ],
  "pending_by_name": { "worker": 2 },   // TTL'd pre-launch queues (name → count)
  "counts": { "live": 5, "dropped": 1, "pending_names": 1, "orphan_msgs": 3 }
}
```

Differences from today (autopsy 04 made the old `/status` useless — 65 of 70 entries were dead):

- **Only live + in-grace sessions appear.** GC'd sessions are gone, so the list is real presence, not
  a graveyard. `pending_by_name` is a small TTL'd bucket, not 62 immortal ghosts.
- **`pid`/`ppid`/`cwd`/`client_version`** let the user correlate a bus peer to an actual process and
  spot a zombie: a `live` peer with a stale `last_seen_ms`, or a `ppid` whose CC process no longer
  exists, is a straggler.
- **`client_version`** surfaces the version skew directly — you can see which peers still run a legacy
  client that can't send `session=` (drives the migration cutover, 06).

## `list_peers` tool (for peers) — live-only, concise

```jsonc
// returns, by default, only LIVE peers — the ones you can actually reach right now
[ { "name": "taxgraph-instructor", "since": 1784410633557, "pending_for_you": 0 },
  { "name": "dev-1-a1b2", "since": 1784410700000, "pending_for_you": 1 } ]
```

The tool description stops overselling itself: it is a live directory, not a typo guard against a
graveyard. A send to a name not in this list returns `queued_pending` (03) — the sender is told
nobody is there, rather than silently queuing to a blackhole.

## `/kill` — operator force-remove

Two-step because the broker owns registration, not processes:

```
POST /kill { name: "taxgraph-instructor" }
→ { killed: [ { session: "dc376067-…", name: "taxgraph-instructor", pid: 2311408 } ] }
```

The broker force-GCs the session (drops names + inbox, closes the stream). It returns the `pid` so
the caller decides whether to also `SIGTERM` the process. The broker never signals the process itself
— separation of concerns, and it avoids the broker becoming a process manager.

## `agentbus` CLI (thin wrapper — the operator surface)

A small script (`agentbus`) over the HTTP endpoints, so the user isn't curling JSON:

| Command | Does |
|---------|------|
| `agentbus peers` | pretty-print `/status` live peers (name, pid, cwd, age, pending) |
| `agentbus ghosts` | show `dropped` + `pending_by_name` (what's about to be GC'd) |
| `agentbus kill <name\|session>` | `/kill` **and** `SIGTERM` the returned pid (the process-kill the broker won't do) |
| `agentbus gc` | trigger an immediate sweep (drop expired grace/pending) |
| `agentbus tail` | stream the broker's message trail (journald follow) |
| `agentbus receipt <id>` | `/receipt` lookup for a sent message (04) |

`agentbus kill` is the answer to "the user needs to be able to investigate open peers and kill them":
`peers` to investigate, `kill` to remove — both the bus registration and the OS process, in one
command.

## How this satisfies the requirements

| Requirement | Mechanism |
|-------------|-----------|
| Investigate open peers | `/status` with pid/cwd/age/version; `agentbus peers` |
| Kill a peer | `/kill` + `agentbus kill` (dereg + SIGTERM) |
| Peers see who's there | `list_peers` live-only |
| No graveyard in the view | GC (02) makes `/status` show only real presence |
