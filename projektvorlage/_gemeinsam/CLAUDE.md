# PROJEKTNAME — <eine Zeile: was es ist, welcher Stack>

## Struktur

Code liegt in Schichten, und aufgerufen wird **nur nach unten**:

```
commands/  ──darf──►  features/  ──darf──►  atoms/
```

- **`atoms/<kategorie>/<name>/`** — **pure Funktion**: kein I/O, kein globaler Zustand,
  nur die Standardbibliothek. Ein Atom darf ein anderes Atom benutzen, nie ein Feature
  oder ein Command.
- **`features/<name>/`** — Geschaeftslogik, I/O erlaubt. Darf Atome und Features
  benutzen, nie ein Command.
- **`commands/`** — die Verdrahtung. Darf alles. Muss nicht existieren.

Das ist die einzige Regel, die man dem Baum nicht ansieht: **Atome sind pur, Features
duerfen.** Alles andere liest sich aus den Verzeichnisnamen.

`feature.yaml` listet unter `atoms_used`, welche Atome dieses Feature benutzt — dieselbe
Schreibweise wie im Import. Die Datei oeffnet man beim Hinzufuegen eines Imports ohnehin,
deshalb bleibt sie wahr. Es gibt **keine** Rueckwaertsliste ("wer benutzt mich"): die
berechnet `graphify` aus dem Code, und ein berechneter Graph veraltet nicht.

## Was das durchsetzt, und was nicht

`aina.yaml` im Wurzelverzeichnis ist ein **Marker**, kein Konfigurationsdokument. Seine
Anwesenheit schaltet zwei Pruefungen ein:

| | |
|---|---|
| `~/.claude/hooks/layering-gate.py` | lehnt beim Schreiben einen Import nach oben ab — in Python, TypeScript, Go und Rust |
| `~/00_projects/vault/bin/layering-check` | sucht Importzyklen ueber den ganzen Baum, aus `.githooks/pre-commit` |

**Die Reinheit der Atome prueft niemand.** "Kein I/O, kein globaler Zustand" steht hier
und sonst nirgends; ein Atom, das eine Datei oeffnet, kommt durch beide Waechter. Das ist
Absicht — ein Waechter, der den Weg statt das Ergebnis prueft, wird umgangen statt
befolgt (vault/decisions/aina-konvention-nur-fuer-neue-projekte.md).

Zyklen werden je Sprache aus einer anderen Quelle gefunden, und der Bericht von
`layering-check` nennt bei jedem Lauf, was er geprueft hat und was nicht. In **Go**
verweigert schon der Compiler einen Importzyklus, dort prueft das Werkzeug deshalb nicht.
