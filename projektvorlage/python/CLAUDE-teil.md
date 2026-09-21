
## Commands

- Alle Tests: `pytest`
- Ein einzelner: `pytest atoms/<kategorie>/<name>/main_test.py`

Ein neues Atom: `cp -r atoms/_template/example atoms/<kategorie>/<name>`
Ein neues Feature: `cp -r features/_template features/<name>`

Ein Importstil im ganzen Baum: `from atoms.<kategorie>.<name>.main import run` —
derselbe im Test wie im Feature, ermoeglicht durch `pythonpath = ["."]` in
`pyproject.toml`. Keine `__init__.py`.
