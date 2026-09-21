
## Commands

- Alle Tests: `cargo test`
- Ein einzelner: `cargo test atoms::<kategorie>::<name>`
- Vor der Uebergabe: `cargo clippy -- -D warnings && cargo fmt --check && cargo test`

Ein neues Atom: `cp src/atoms/vorlage/example.rs src/atoms/<kategorie>/<name>.rs`,
dann `pub mod <name>;` in `src/atoms/<kategorie>.rs` ergaenzen.

Drei Abweichungen, alle von Cargo erzwungen:

- Die Schichten liegen unter **`src/`**, nicht an der Wurzel. Beide Waechter
  ueberspringen `src/` und finden sie trotzdem.
- **Der Test liegt UNTER dem Code**, nicht daneben: `#[cfg(test)] mod tests` am Ende
  derselben Datei. Nur so sieht er private Items, und nur so findet `cargo test` ihn.
- Die Beispielkategorie heisst **`vorlage`** — gleich wie in Go, damit beide Sprachen
  mit `mod`-Deklarationen denselben Namen tragen.

Importe: `use crate::atoms::<kategorie>::<name>::run;`

**Ein Modulzyklus innerhalb derselben Schicht wird nicht gefunden** — Rust erlaubt ihn,
und kein Werkzeug findet ihn zuverlaessig (vault/tickets/rust-zyklen-innerhalb-einer-schicht-unentdeckt.md).
