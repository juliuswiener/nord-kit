# PROJEKT — <eine Zeile: was es ist, welcher Stack>

## Struktur

- `atoms/<kategorie>/<name>/main.py` — **pure Funktion**: kein I/O, kein globaler
  Zustand, nur stdlib. Einstiegspunkt heisst `run`. Test daneben als `main_test.py`.
- `features/<name>/` — Geschaeftslogik, I/O erlaubt. `models.py` (Datentypen),
  `handlers.py` (Verhalten), `handlers_test.py`, `feature.yaml`.

Dieselbe Konvention gilt fuer JavaScript: `main.js` mit Einstiegspunkt `run` statt
`main.py`, Test daneben als `main_test.js`, Importe relativ. Zwei Waechter pruefen die
Schichtung — `~/.claude/hooks/layering-gate.py` (prueft `path.endswith(".py")`) und
`vault/bin/layering-check` (sammelt `git ls-files "*.py"`) — beide erfassen nur
`.py`-Dateien. Bei JavaScript traegt die Konvention, aber niemand erzwingt sie.

Das ist die einzige Regel, die man dem Baum nicht ansieht: **Atome sind pur,
Features duerfen.** Alles andere liest sich aus den Verzeichnisnamen.

Ein neues Atom: `cp -r atoms/_template/example atoms/<kategorie>/<name>` (kopiert
main.py/main_test.py und main.js/main_test.js mit; fuer ein reines JS-Atom nur
main.js und main_test.js uebernehmen).
Ein neues Feature: `cp -r features/_template features/<name>`.

`feature.yaml` listet unter `atoms_used`, welche Atome dieses Feature benutzt, als
`"<kategorie>/<name>"` — derselbe Pfad wie im Import. Die Datei
oeffnet man beim Hinzufuegen eines Imports ohnehin, deshalb bleibt sie wahr. Es gibt
**keine** Rueckwaertsliste ("wer benutzt mich"): die berechnet `graphify` aus dem
Code, und ein berechneter Graph veraltet nicht.

## Commands

- Alle Tests (Python-Vorlage): `pytest`
- Ein einzelner: `pytest atoms/<kategorie>/<name>/main_test.py`
- Alle Tests (JavaScript): `node --test` (ohne Argumente — findet den ganzen Baum
  selbst ueber die Namensmuster `main_test.js`/`handlers_test.js`; Verzeichnisargumente
  scheitern auf Node 26).
- Ein einzelner: `node --test 'atoms/<kategorie>/<name>/main_test.js'`
