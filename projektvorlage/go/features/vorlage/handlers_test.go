// Test der Handler. Laeuft unveraendert gruen.
package template

import "testing"

func TestBautDasModell(t *testing.T) {
	got, err := Handle(7)
	if err != nil {
		t.Fatalf("unerwarteter Fehler: %v", err)
	}
	if got.Value != 7 {
		t.Errorf("Handle(7).Value = %d, erwartet 7", got.Value)
	}
}
