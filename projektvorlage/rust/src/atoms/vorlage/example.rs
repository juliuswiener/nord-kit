//! Atom: <was es berechnet, in einem Satz>.
//!
//! Pur: kein I/O, kein globaler Zustand, nur std.

/// <Was es tut. Signatur und Doc-Kommentar ersetzen.>
pub fn run(value: i64) -> Result<i64, String> {
    if value < 0 {
        return Err(format!("value must not be negative: {value}"));
    }
    Ok(value)
}

// Test UNTER dem Code, nicht daneben: nur so sieht er private Items, und nur so
// findet `cargo test` ihn ohne Zutun. Das ist die eine Stelle, an der sich die
// Konvention der Sprache beugt.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gibt_die_eingabe_zurueck() {
        assert_eq!(run(3), Ok(3));
    }

    #[test]
    fn weist_negatives_ab() {
        assert!(run(-1).is_err());
    }
}
