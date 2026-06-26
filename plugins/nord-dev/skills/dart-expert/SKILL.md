---
name: dart-expert
description: "Production Dart (3.x): null safety, async/streams, sealed classes + exhaustive pattern matching, records, Result-style errors, isolates, testing. Use when writing/reviewing Dart domain logic, packages, CLIs, serialization, or concurrency (non-UI)."
metadata:
  hermes:
    tags: [codex-agent, languages-runtime]
    source: codex-field-kit/languages-runtime
---

# Dart Expert

Modern Dart (3.x) for language/domain logic. For Flutter widgets/UI use **flutter-ui-ux**.

## Defaults
- Sound null safety: avoid `!` (bang) and unchecked `as`. Prefer `?.`, `??`, and `late` only when init is guaranteed. A `!` that throws is a bug you chose.
- Immutability: `final` by default, `const` constructors for value types, `copyWith` for updates.
- Records for lightweight multi-return: `(int, String) f() => (1, "ok");` — name fields when not positional: `({int code, String msg})`.
- Sealed classes + exhaustive `switch` for closed state, instead of enum-with-data or inheritance trees:
  ```dart
  sealed class Result<T> {}
  class Ok<T>  extends Result<T> { final T value;      Ok(this.value); }
  class Err<T> extends Result<T> { final Object error; Err(this.error); }
  // compiler errors if a case is missed:
  final msg = switch (r) { Ok(:final value) => '$value', Err(:final error) => 'fail: $error' };
  ```

## Errors
- Model expected failures as data (`Result`/sealed); throw only for programmer errors / truly exceptional cases.
- No bare `catch (e)` that swallows — catch specific types, rethrow with context, or convert to `Err`.
- `Future` errors: `await` inside `try`; don't mix `.then` chains with `await`. Unawaited futures = silent failures → mark `unawaited(...)` deliberately.

## Async / concurrency
- `async/await` over raw `Future.then`. `Future.wait([...])` for parallel, never a sequential `await` loop.
- Streams: `await for` to consume; choose broadcast vs single-subscription deliberately; always cancel subscriptions.
- CPU-heavy work off the event loop: `Isolate.run(() => heavy())` (Dart 2.19+). Isolates don't share memory — pass plain data.

## Packages / serialization
- JSON: generate with `json_serializable`/`freezed`; don't hand-write `fromJson` for non-trivial models.
- `freezed` for sealed unions + `copyWith` + equality in one.
- Public API: `///` docs, honest `@experimental`/`@visibleForTesting`, semver.

## Testing
- `package:test` (`group`/`test`/`expect` matchers). Mock with `mocktail` (no codegen) or `mockito`.
- Test the `Err`/failure branches, not just happy path. `fakeAsync` for timer/stream timing.

## Checklist before done
- `dart analyze` clean (warnings as errors); `dart format` applied.
- No bare `!`/`as` without a guard; no swallowed exceptions; no unawaited futures.
- Public symbols documented; tests cover error branches.
