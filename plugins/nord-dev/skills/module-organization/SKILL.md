---
name: module-organization
description: Organize modules vertically by feature domain, not horizontally by language construct. Use when creating new modules, reorganizing code, or deciding where to put types and functions. Based on Gabriella Gonzalez's Haskell module organization guidelines.
---

# Module Organization Guidelines

## Organize Vertically, Not Horizontally

**Never** create a `Types`, `Constants`, or `Lib` module.

**Vertical** (by feature domain):
- `Syntax` -- syntax tree type + traversal utilities
- `Parsing` -- parser type + parsers + parse error messages
- `Infer` -- type inference logic + inference error types
- `Evaluation` -- evaluator + evaluated AST
- `Pretty` -- pretty-printing

**Horizontal** (by language construct -- avoid this):
- `Types` -- all types dumped together
- `Lib` -- all functions dumped together
- `Constants` -- all constants dumped together

### Why Vertical Wins

1. **Separability**: Vertical modules can be extracted into standalone packages. Horizontal modules are too coupled.
2. **Build granularity**: Changing type inference only rebuilds modules that depend on inference. A `Types` module change rebuilds everything.
3. **Related changes stay together**: In vertical organization, a feature change touches one module. In horizontal, every change touches every module.

## Module Naming

The default import module should match the package name: package `foo-bar-baz` exports `Foo.Bar.Baz`.

- Skip `Control.` and `Data.` prefixes unless the package name starts with `control-` or `data-`
- Shorter names reduce clashes and are easier to discover

## For PureScript

Each module should own its types, constructors, and functions for one domain concept. Co-locate the type with the operations that act on it.
