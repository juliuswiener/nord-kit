
## Commands

- Alle Tests: `go test ./...`
- Vollstaendig (so wie das Tor es faehrt): `go build ./... && go test -count=1 ./...`
- Ein einzelner: `go test ./atoms/<kategorie>/<name>`

Ein neues Atom: `cp -r atoms/vorlage/example atoms/<kategorie>/<name>`
Ein neues Feature: `cp -r features/vorlage features/<name>`

Zwei Abweichungen, beide von Go erzwungen:

- Der Einstiegspunkt heisst **`Run`**, nicht `run` — Go exportiert ueber Grossschreibung.
- Die Beispielkategorie heisst **`vorlage`**, nicht `_template`: Go ignoriert jedes
  Verzeichnis, das mit `_` beginnt, und `go test ./...` fand die Vorlage sonst nicht
  ("matched no packages") — gemessen 2026-09-21.

Importe laufen ueber den Modulpfad aus `go.mod`: `import "<modul>/atoms/<kat>/<name>"`.
