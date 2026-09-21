"""Datentypen dieses Features."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Example:
    value: int
