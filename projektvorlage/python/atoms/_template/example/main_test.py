"""Test des Atoms nebenan. Laeuft unveraendert gruen — erst ersetzen, dann bauen."""

import pytest

from atoms._template.example.main import run


def test_gibt_die_eingabe_zurueck():
    assert run(3) == 3


def test_weist_falschen_typ_ab():
    with pytest.raises(TypeError):
        run("3")
