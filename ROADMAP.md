# Skillset Curation — Roadmap

**Ziel:** Ein eigenes, kuratiertes Skillset in der nord-Distribution. Kein Overlap aus
dutzenden Plugins. Ein Namespace, selbst besessen, ordner-granular kontrolliert.

**Strategie (gewählt):** Eigene nord-Distribution (Fork). Wo einzelne Skills stören und
Plugin-Toggle zu grob ist → in nord-kit vendoren und Ordner löschen. Engines, die der
Router nutzt, erst migrieren, dann upstream abschalten.

**Mechanik:** Skill = 1 Ordner mit `SKILL.md`. In *diesem* Repo = volle Granularität
(`rm -rf skills/<name>/`). `settings.json` kann nur ganze Plugins. Kein nativer Per-Skill-
Schalter existiert → Fork ist der einzige Granularitätshebel.

---

## Ausgangslage (Stand 2026-06-26)

**Aktiv (enabled in settings.json) — 76 Skills + 2 global:**

| Plugin | Skills | Rolle | Maßnahme |
|---|---|---|---|
| oh-my-claudecode | 40 | schwere Engine | trim → 5 migrieren, Rest disablen |
| claude-mem | 16 | Memory + Dublette-Plan/Exec/Explore | fork → nord-mem (11), disablen |
| nord-core | 12 | **dein Router** + Multi-Agent | wächst (absorbiert omc-Engines) |
| caveman | 7 | Token-Kompression | behalten |
| claude-md-management | 1 | CLAUDE.md Audit | behalten |
| global ~/.claude/skills | 2 | autopsy + codebase-memory | Entscheidung offen |

**Disabled, bleibt disabled:** superpowers, plugin-dev, skill-creator, frontend-design,
github, agent-sdk-dev, create-worktrees, claude-hud, eww-dev, skillsmp, claude-session-driver,
nord-dev*, nord-ee* (*werden aktiviert, siehe Phase 4).

**Nicht installiert:** nord-ee als Marketplace-Plugin existiert in nord-kit (`plugins/nord-ee`,
17 Skills) aber ist nicht im enabledPlugins → Router-Refs auf kicad/spice/digikey tot.

---

## Overlap-Matrix (nur aktive Skills)

| Job | nord-core | omc | claude-mem | Auflösung |
|---|---|---|---|---|
| Plan | nord-plan | plan, ralplan | make-plan | make-plan DROP |
| Execute | nord-exec | autopilot/ralph/team/ultrawork/… | do | do DROP, omc-loops behalten |
| Review | nord-review | (agent) | — | sauber |
| Cleanup | nord-cleanup | ai-slop-cleaner | — | ai-slop-cleaner weg (omc disable) |
| Audit | mac-audit, scrutinizing | — | — | + autopsy (Entscheidung) |
| Prime/Explore | — | deepinit | learn-codebase, smart-explore, pathfinder | deepinit→nord, learn-codebase→nord-mem, smart-explore/pathfinder DROP |
| Memory | — | wiki, remember, writer-memory, learner | mem-search | mem-search→nord-mem, wiki bleibt omc?→migrate |
| Debug | — | trace, debug, deep-dive | — | trace→nord |
| Verify | — | verify | — | verify→nord |
| Research | — | sciomc, external-context, autoresearch | knowledge-agent | sciomc+external-context→nord, knowledge-agent→nord-mem |
| Skill-Auth | advanced-skill-authoring, find-skills, skill-lookup | skill, skillify, learner | — | nur nord-core behalten |
| Release | — | release | claude-code-plugin-release | release→nord, plugin-release DROP |
| Brainstorm | adversarial-brainstorm, ideation-lab | — | — | sauber |

---

## Ziel-Architektur

```
nord-core   Router + Multi-Agent. NEU absorbiert aus omc:
            trace, verify, deepinit, external-context, sciomc, release, wiki
nord-dev    Sprach-Skills. NEU: rust-coder, rust-unit-tester,
            python-ticket-implementer, python-debugger  + dart/flutter/module-org
nord-ee     17 EE-Skills (bestehend) — aktivieren
nord-mem    NEU, claude-mem geforkt: Engine (hooks+mcp+scripts) +
            mem-search, knowledge-agent, learn-codebase, standup, timeline-report,
            weekly-digests, how-it-works, oh-my-issues, design-is, babysit, wowerpoint
            DROP: make-plan, do, smart-explore, pathfinder, version-bump
caveman     behalten
claude-md   behalten
```

**Router-Defaults, die omc liefert und nord NICHT hat (Migrations-Pflicht vor omc-disable):**
trace (Debug), verify (Verify), deepinit (Prime), sciomc + external-context (Research).

---

## Phasen & Gates

### Phase 1 — Sofort-Cleanup  ▢
Risikoarm. Router an Realität angleichen, tote globale Skills entscheiden.
- **Gate:** ROUTING.md referenziert nur auflösbare (enabled-or-soon) Skills. nord-kit committet.

### Phase 2 — nord-mem  ▢
claude-mem forken, 5 Dubletten droppen, Engine erhalten.
- **Gate:** Memory-Injection feuert (SessionStart-Hook + mcp-search) OHNE aktives claude-mem.
  `make-plan`/`do`/`smart-explore` nicht mehr ladbar. claude-mem disabled.

### Phase 3 — omc-Migration  ▢
trace, verify, deepinit, external-context, sciomc (+ release, wiki) nach nord-core.
- **Gate:** Jeder migrierte Skill lädt aus nord-core + läuft (Pfade/Agent-Refs gefixt).
  oh-my-claudecode disabled. Router-Debug/Verify/Prime/Research-Defaults aufgelöst.

### Phase 4 — nord-dev/ee füllen  ▢
rust/python Skills erstellen, nord-dev + nord-ee aktivieren.
- **Gate:** rust-coder/python-ticket-implementer laden. kicad/spice/digikey auflösbar.
  Router-Tabelle 100% grün.

---

## Offene Entscheidungen

1. **autopsy** (global) — eigenständiger feindlicher Forensik-Modus, NICHT = mac-audit.
   Behalten? → nach nord-core/skills/ migrieren, oder als global lassen, oder löschen.
2. **codebase-memory** (global) — überlappt smart-explore/pathfinder (beide werden gedroppt).
   Behalten als Explore-Default, oder durch nord-Skill ersetzen?
3. **wiki vs nord-mem** — wiki (omc) ist durable Markdown-KB, mem-search (claude-mem) ist
   Cross-Session-DB. Beide behalten (Router tut das) oder konsolidieren?
4. **omc-Loops** (ralph/team/autopilot/ultrawork/ultraqa/ultragoal/self-improve) — nord-exec
   nutzt nativen Workflow+/loop, eskaliert optional zu ralph/team. Diese behalten (omc enabled
   für Engine) ODER auch migrieren? Migration = schwer. Default: als Eskalation behalten,
   d.h. omc bleibt enabled aber Namespace via Fork sauber. → widerspricht „omc disable".
   **Klärung nötig in Phase 3.**
