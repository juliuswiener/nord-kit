"""Verhalten dieses Features. I/O ist hier erlaubt."""

from atoms._template.example.main import run as identity

from features._template.models import Example


def handle(value: int) -> Example:
    return Example(value=identity(value))
