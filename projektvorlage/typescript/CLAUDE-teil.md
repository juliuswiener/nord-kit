
## Commands

- Alle Tests: `node --test` (ohne Argumente — findet den Baum selbst ueber die
  Namensmuster `main_test.ts`/`handlers_test.ts`; Verzeichnisargumente scheitern
  auf Node 26)
- Ein einzelner: `node --test 'atoms/<kategorie>/<name>/main_test.ts'`

Ein neues Atom: `cp -r atoms/_template/example atoms/<kategorie>/<name>`
Ein neues Feature: `cp -r features/_template features/<name>`

**Kein Build-Schritt.** Node 26 fuehrt TypeScript direkt aus; Importe tragen deshalb die
echte Endung (`from "./main.ts"`), nicht `.js`. Importe sind **relativ** — keine Aliase,
keine `paths` in einer tsconfig: der Schichtenwaechter loest relative Pfade aus, Aliase
nicht.
