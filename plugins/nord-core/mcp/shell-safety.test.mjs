#!/usr/bin/env node
/**
 * Pins the rm path rules of src/lib/shell-safety.ts (the shell's own validator).
 *
 *   node shell-safety.test.mjs        # exit 0 = every case holds; prints "N cases, M red"
 *
 * Group A: a delete BELOW /var/tmp is allowed (scratch). Before the fix `protectedHit` took
 *   every path under /var for the system directory /var and refused them all.
 * Group B: everything that must stay refused — /var itself, /var/log, a path that leaves
 *   /var/tmp again (`..`), /var/tmp itself and its wildcard, a lookalike prefix, a second
 *   operand outside scratch, other protected paths.
 * Group C: unrelated rm cases that were fine before and must stay fine.
 * Group D: root and home deletes, refused by the other rules of the validator.
 *
 * Cases are plain commands handed to the pure functions; nothing is executed here.
 * Needs Node >= 22.18 (runs the .ts source directly).
 */
import { checkProtectedPaths, validateShellCommand } from './src/lib/shell-safety.ts';

let cases = 0;
let red = 0;
const fail = (name, got) => { red++; console.log(`FAIL ${name}: ${got}`); };

/** The path rule alone, and the whole validator in non-strict mode (a 'warn' executes). */
const allowedHere = (cmd) => checkProtectedPaths(cmd).verdict === 'allow'
  && validateShellCommand(cmd, { strict: false }).verdict !== 'deny';

const A = [
  'rm -f /var/tmp/foerderfinder-tmp/nichts-da',
  'rm /var/tmp/foerderfinder-tmp/.probe',
  'rm -rf /var/tmp/x',
  'rm -rf /var/tmp/x/',
  'rm -rf "/var/tmp/x"',
  'rm -rf /var/tmp/x/*',
  'rm -f /var/tmp/a /var/tmp/b',
  'sudo rm -f /var/tmp/x/a',
  'cd /home/julius && rm -f /var/tmp/x/a',
  'rm -rf /var/tmp//x/./y',
];
for (const cmd of A) {
  cases++;
  if (!allowedHere(cmd)) {
    fail(`A allowed: ${cmd}`, JSON.stringify(validateShellCommand(cmd, { strict: false })));
  }
}

const B = [
  'rm -rf /var',
  'rm -f /var',
  'rm -rf /var/',
  'rm -rf /var/log',
  'rm -f /var/log/nichts-da',
  'rm -rf /var/lib/x',
  'rm -rf /var/tmp/../log',
  'rm -f /var/tmp/../log/nichts-da',
  'rm -rf /var/tmp/x/../../log',
  'rm -rf /var//tmp/../log',
  'rm -rf /var/tmp',
  'rm -rf /var/tmp/',
  'rm -rf /var/tmp/.',
  'rm -rf /var/tmp/*',
  'rm -rf /var/tmpx/a',
  'rm -f /var/tmp/a /var/log/b',
  'rm -f /var/log/b /var/tmp/a',
  'rm -rf /var/tmp/../..',
  'rm -rf /var/tmp/../*',
  'rm -rf /etc',
  'rm -rf /usr/lib/x',
];
for (const cmd of B) {
  cases++;
  const p = checkProtectedPaths(cmd);
  const v = validateShellCommand(cmd, { strict: false });
  if (p.verdict !== 'deny' || p.rule !== 'protected-path' || v.verdict !== 'deny') {
    fail(`B refused: ${cmd}`, `${JSON.stringify(p)} / validator ${v.verdict}`);
  }
}

const C = [
  'rm -rf dist/',
  'rm -rf build/',
  'rm -f ./a/b',
  'rm -rf /tmp/x',
  'rm -rf /home/julius/x',
];
for (const cmd of C) {
  cases++;
  if (!allowedHere(cmd)) fail(`C allowed: ${cmd}`, JSON.stringify(validateShellCommand(cmd, { strict: false })));
}

// Group D: the other validator rules (root, home) are refused by a rule other than protected-path.
const D = [
  'rm -rf /',
  'rm -rf /*',
  'rm -rf ~',
  'rm -rf "$HOME"',
  'rm -rf ${HOME}/',
];
for (const cmd of D) {
  cases++;
  const v = validateShellCommand(cmd, { strict: false });
  if (v.verdict !== 'deny') fail(`D refused: ${cmd}`, JSON.stringify(v));
}

console.log(`${cases} cases, ${red} red`);
process.exit(red ? 1 : 0);
