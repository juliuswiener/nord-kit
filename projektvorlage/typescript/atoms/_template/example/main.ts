// Atom: <was es berechnet, in einem Satz>.
//
// Pur: kein I/O, kein globaler Zustand, nur stdlib.

export function run(value: number): number {
  // <Was es tut. Signatur und Kommentar ersetzen.>
  if (!Number.isInteger(value)) {
    throw new TypeError("value must be int");
  }
  return value;
}
