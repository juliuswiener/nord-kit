# Skillset Curation — Tasks

Status: ▢ todo · ◐ doing · ✓ done · ⚠ blocked/decision

## Phase 1 — Sofort-Cleanup

- ✓ **1.1** Baseline-Backup: `git -C nord-kit checkout -b skillset-curation`; settings.json kopieren nach `$JOBDIR/tmp/settings.bak.json`.
  - verify: branch aktiv, backup existiert.
- ✓ **1.2** Router-Tote finden: grep ROUTING.md + nord-router.js nach Skill-Namen, gegen reale enabled-Skills + geplante prüfen.
  - verify: Liste toter Refs (deep-research, rust-coder, python-*, kicad/spice, systematic-debugging…).
- ✓ **1.3** ROUTING.md anpassen: tote Refs entweder (a) auf existierende mappen oder (b) als „Phase 4 pending" markieren. Keine Lüge im Router.
  - verify: jede Tabellenzeile zeigt auf ladbaren oder explizit-pending Skill.
- ⚠ **1.4** autopsy-Entscheidung (offen) — NICHT löschen bis geklärt. Default: behalten.
- ✓ **1.5** Commit Phase 1.
  - **GATE:** ROUTING.md sauber, committet.

## Phase 2 — nord-mem

- ▢ **2.1** claude-mem-Engine kartieren: hooks.json (welche Events?), .mcp.json (mcp-search), scripts/ Abhängigkeiten, modes/. Was braucht Memory-Injection wirklich?
  - verify: Liste der Engine-Dateien, unabhängig von skills/.
- ▢ **2.2** `plugins/nord-mem/` anlegen: .claude-plugin/plugin.json, hooks/, .mcp.json, scripts/, ui/ aus claude-mem 13.6.2 kopieren.
  - verify: Verzeichnis steht, plugin.json valide.
- ▢ **2.3** Skills selektiv kopieren: NUR mem-search, knowledge-agent, learn-codebase, standup, timeline-report, weekly-digests, how-it-works, oh-my-issues, design-is, babysit, wowerpoint.
  - DROP: make-plan, do, smart-explore, pathfinder, version-bump.
  - verify: 11 skill-Ordner, 5 fehlen.
- ▢ **2.4** Pfade fixen: CLAUDE_PLUGIN_ROOT/Script-Resolver in .mcp.json + hooks auf neuen Plugin-Namen. mcp-server.cjs-Suche muss nord-mem finden.
  - verify: grep auf alte Pfade = 0 ungefixte Treffer.
- ▢ **2.5** marketplace.json: nord-mem als lokales Plugin (`./plugins/nord-mem`) eintragen. claude-mem-Remote-Eintrag entfernen oder lassen.
  - verify: marketplace.json valide JSON.
- ▢ **2.6** settings.json: nord-mem enable, claude-mem disable.
  - verify: settings valide.
- ▢ **2.7** Test in frischer Session: Memory-Injection-Hook feuert, mem-search-MCP antwortet, make-plan/do nicht ladbar.
  - **GATE:** Memory funktioniert via nord-mem, claude-mem aus, 5 Dubletten weg.
- ▢ **2.8** Commit Phase 2.

## Phase 3 — omc-Migration

- ▢ **3.1** Migrationsumfang fixieren + Entscheidung 4 klären (omc-Loops behalten vs migrieren). Skills: trace, verify, deepinit, external-context, sciomc (+ release, wiki?).
  - verify: finale Skill-Liste + Abhängigkeits-Audit (welche Agents/Commands/Scripts ziehen sie?).
- ▢ **3.2** Pro Skill: nach `nord-core/skills/` kopieren, `${CLAUDE_PLUGIN_ROOT}`-Refs, Agent-Namen (omc:xxx), Command-Refs (/omc:…) auf nord-core/native umbiegen.
  - verify: grep auf `omc`/`oh-my` in migrierten Skills = 0 ungefixt.
- ▢ **3.3** Begleitende Agents/Commands prüfen: brauchen trace/sciomc bestimmte omc-Agents (tracer, scientist)? Falls ja → mitkopieren nach nord-core/agents/.
  - verify: jeder migrierte Skill ist self-contained in nord-core.
- ▢ **3.4** ROUTING.md: Debug→trace, Verify→verify, Prime→deepinit, Research→sciomc/external-context jetzt auf nord-core-Pfade.
  - verify: Router-Defaults laden aus nord-core.
- ▢ **3.5** Test: jeder migrierte Skill lädt + Minimallauf. Dann omc disablen.
  - **GATE:** 5 Skills aus nord-core lauffähig, oh-my-claudecode disabled, Router grün für Debug/Verify/Prime/Research.
- ▢ **3.6** Commit Phase 3.

## Phase 4 — nord-dev/ee füllen

- ▢ **4.1** Router-referenzierte Sprach-Skills erstellen: rust-coder, rust-unit-tester, python-ticket-implementer, python-debugger (SKILL.md + Trigger).
  - verify: 4 neue Skills, valide Frontmatter.
- ▢ **4.2** nord-dev marketplace + settings: aktivieren.
  - verify: dart-expert/rust-coder laden.
- ▢ **4.3** nord-ee aktivieren (17 Skills bestehen).
  - verify: kicad/spice/digikey laden.
- ▢ **4.4** Finaler Router-Durchlauf: jede Tabellenzeile → ladbarer Skill.
  - **GATE:** Router 100% auflösbar, ein Namespace, omc+claude-mem disabled.
- ▢ **4.5** SKILLSET-CURATION.md Status finalisieren, push nach origin.

## Loop-Disziplin
- /compact alle 8 Turns.
- Gate = deterministisch (Skill lädt / Hook feuert / JSON valide / grep=0). Kein Self-Verify.
- Backup vor jedem destruktiven Schritt (settings, rm).
- 3× rotes Gate → stop, eskalieren an User.
