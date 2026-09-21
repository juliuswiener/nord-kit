"""Atom: <was es berechnet, in einem Satz>.

Pur: kein I/O, kein globaler Zustand, nur stdlib.
"""


def run(value: int) -> int:
    """<Was es tut. Signatur und Docstring ersetzen.>"""
    if not isinstance(value, int):
        raise TypeError("value must be int")
    return value
