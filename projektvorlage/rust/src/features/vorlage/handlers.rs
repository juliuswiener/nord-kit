//! Verhalten dieses Features. I/O ist hier erlaubt.

use crate::atoms::vorlage::example::run as identity;

use super::models::Example;

pub fn handle(value: i64) -> Result<Example, String> {
    Ok(Example { value: identity(value)? })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baut_das_modell() {
        assert_eq!(handle(7), Ok(Example { value: 7 }));
    }
}
