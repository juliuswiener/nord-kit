// Atom: <was es berechnet, in einem Satz>.
//
// Pur: kein I/O, kein globaler Zustand, nur stdlib.
package example

import "fmt"

// Run ist der Einstiegspunkt. Gross geschrieben, weil Go nur so exportiert —
// die Konvention heisst sonst ueberall `run`.
func Run(value int) (int, error) {
	// <Was es tut. Signatur und Kommentar ersetzen.>
	if value < 0 {
		return 0, fmt.Errorf("value must not be negative: %d", value)
	}
	return value, nil
}
