//! Die Schichten dieses Projekts. Aufgerufen wird nur nach unten:
//! commands -> features -> atoms.
//!
//! Cargo besteht auf `src/`, deshalb liegen die Schichten hier darunter und nicht
//! an der Wurzel wie in den anderen Sprachen. Beide Waechter wissen das.

pub mod atoms;
pub mod features;
