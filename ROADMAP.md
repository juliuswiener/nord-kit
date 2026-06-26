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

### Phase 2 — nord-mem  ✓ SKIPPED (Entscheidung 2026-06-26)
ENTFÄLLT. Engine = vendorter Node/Bun-Daemon (worker-service.cjs), thedotmack-hardcoded,
aktiv entwickelt → Fork = Wartungslast + Update-Bruchrisiko. Nur make-plan/do echte Dubletten,
beide schon Router-blacklisted. smart-explore/pathfinder eigenständig nützlich. → claude-mem bleibt.
- **Gate:** Memory-Injection feuert (SessionStart-Hook + mcp-search) OHNE aktives claude-mem.
  `make-plan`/`do`/`smart-explore` nicht mehr ladbar. claude-mem disabled.

### Phase 3 — omc-Migration  ✗ CANCELLED (Befund 2026-06-26)
ENTFÄLLT. omc = TS-Runtime (node_modules/dist/bin, `omc` CLI, mcp, bridge). ralph/team/ask/ccg
hängen am Binary → nicht migrierbar ohne Vendoring. trace/verify/deepinit wären billig, lohnen aber
nur bei omc-disable, und das killt CLI-Loops+Multi-Model. Gleiche Falle wie claude-mem-Fork.
→ omc bleibt enabled als Engine. Router (Phase 1) diszipliniert die Dubletten.
- **Gate:** Jeder migrierte Skill lädt aus nord-core + läuft (Pfade/Agent-Refs gefixt).
  oh-my-claudecode disabled. Router-Debug/Verify/Prime/Research-Defaults aufgelöst.

### Phase 4 — nord-dev/ee aktivieren  ◐
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

---

## MERGE MAP (omc → nord) — Befund 2026-06-26 aus 5 Cluster-Analysen

### FOLD — Mechanik in bestehenden nord-Skill einarbeiten, dann aus Fork droppen
| omc | → nord-Skill | Harvest (was nord fehlt) | Repoint nötig |
|---|---|---|---|
| ai-slop-cleaner | nord-cleanup | `--review` mode, pre-edit behavior-lock, ordered sequential passes (dead→dup→naming→tests), quality-gates, UI/design detector, boundary-violations detector, scoped file-list, "when not to use", evidence-report | ralph L116/117/141/233 `Skill("ai-slop-cleaner")`→`Skill("nord-cleanup")`, CLAUDE.md keyword |
| plan + ralplan | nord-plan | `--consensus` (Planner→Architect→Critic loop, max5), RALPLAN-DR (Principles/Drivers/Options), ADR section, `--deliberate` (pre-mortem+testplan), `.omc/plans/ralplan-*.md` persist, approval-routing, pre-exec gate | autopilot L42 glob detect (Option A: keep ralplan-*.md naming) |
| skillify + learner | advanced-skill-authoring §6 | session→skill extraction: 3-clause gate (not-googleable+codebase-specific+hard-won), Expertise/Workflow split, body template, save-path rule | — |

### BUILD — neuer eigener nord-Skill/Agent (omc-Mechanik übernehmen)
| omc | → neu | Begründung |
|---|---|---|
| verify (skill) | nord-core/skills/verify | nord hat keine in-session completion-verify. Klein, verbatim kopierbar. KEIN ralph-hard-invoke |
| verifier (agent) | nord-core/agents/verifier | per-criterion evidence matrix, parallel tests/lsp/build/grep |
| skill (CRUD) | nord-core/skills/local-skill-manager | nord hat nur external-discovery (find-skills/skill-lookup), kein lokales CRUD/wizard + 4 templates |
| deep-interview | nord-interview (HIGH prio) | adversarial-brainstorm L38 referenziert es selbst. Ambiguity-formel, topology-lock, ontology-track, challenge-agents |
| sciomc | nord-research | parallel scientist agents codebase, tier-routing, cross-validation, session-persist. nord hat 0 codebase-investigation |

### FOLD-AGENT — in nord-review/audit einarbeiten + Agent im Fork behalten (hard-invoked)
| omc agent | → nord | KEEP weil |
|---|---|---|
| code-reviewer | nord-review: spec-compliance Stage0, discovery/filter-doktrin, quality-strategy mode | autopilot L79 invoke |
| critic | nord-review `--plan` mode: self-audit, realist-check, adaptive-harshness, role-lenses, pre-commitment | ralph L104/136 invoke |
| security-reviewer | mac-audit Lane5: `git log -p` secrets, remediation-timelines | nord docs cross-ref |

### KEEP in Fork — Runtime/Infra, kein Merge
ralph, team, autopilot, ultrawork, ultraqa, ultragoal, self-improve (loop-engines, CLI) ·
ask, ccg (multi-model CLI) · trace, deepinit (prompt-skills, später nord-bar) ·
external-context (dünn, ideation-lab deckt ~ab) · autoresearch (dep deep-interview) ·
deep-dive (dep trace+deep-interview) · remember, writer-memory, wiki (memory=claude-mem) ·
visual-verdict, project-session-manager · INFRA: setup/omc-setup/omc-doctor/omc-reference/
omc-teams/mcp-setup/cancel/configure-notifications/local-build-reminder/hud/release
