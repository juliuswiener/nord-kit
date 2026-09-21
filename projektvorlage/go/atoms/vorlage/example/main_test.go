// Test des Atoms nebenan. Laeuft unveraendert gruen — erst ersetzen, dann bauen.
package example

import "testing"

func TestGibtDieEingabeZurueck(t *testing.T) {
	got, err := Run(3)
	if err != nil {
		t.Fatalf("unerwarteter Fehler: %v", err)
	}
	if got != 3 {
		t.Errorf("Run(3) = %d, erwartet 3", got)
	}
}

func TestWeistNegativesAb(t *testing.T) {
	if _, err := Run(-1); err == nil {
		t.Error("Run(-1) sollte einen Fehler liefern")
	}
}
