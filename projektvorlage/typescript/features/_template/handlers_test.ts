// Test der Handler. Laeuft unveraendert gruen.

import { test } from "node:test";
import assert from "node:assert/strict";

import { handle } from "./handlers.ts";

test("baut das modell", () => {
  assert.equal(handle(7).value, 7);
});
