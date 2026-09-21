// Verhalten dieses Features. I/O ist hier erlaubt.

import { run as identity } from "../../atoms/_template/example/main.ts";

import { Example } from "./models.ts";

export function handle(value: number): Example {
  return Example(identity(value));
}
