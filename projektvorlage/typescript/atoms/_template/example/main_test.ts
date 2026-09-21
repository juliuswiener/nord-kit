// Test des Atoms nebenan. Laeuft unveraendert gruen — erst ersetzen, dann bauen.

import { test } from "node:test";
import assert from "node:assert/strict";

import { run } from "./main.ts";

test("gibt die eingabe zurueck", () => {
  assert.equal(run(3), 3);
});

test("weist falschen typ ab", () => {
  assert.throws(() => run("3" as unknown as number), TypeError);
});
