"""Test der Handler. Laeuft unveraendert gruen."""

from features._template.handlers import handle


def test_baut_das_modell():
    assert handle(7).value == 7
