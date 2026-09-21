// Datentypen dieses Features.

export interface Example {
  readonly value: number;
}

export function Example(value: number): Example {
  return Object.freeze({ value });
}
