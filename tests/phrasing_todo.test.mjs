// The worklist tool's argument handling.
//
// It runs both with and without a path to an eqspellparser checkout, and the
// no-argument form is the one people will actually type — which is exactly the
// one that shipped broken, because it was only ever tested with the flag.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (args) => execFileSync(process.execPath, ['tools/phrasing_todo.mjs', ...args],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const built = fs.existsSync(new URL('../dist/data/meta.json', import.meta.url));

test('it runs with no arguments at all', { skip: !built && 'no built dataset' }, () => {
  const out = run([]);
  assert.match(out, /effects phrased/);
  assert.match(out, /still read as-is/);
});

test('a missing eqspellparser path is reported, not a crash', { skip: !built && 'no built dataset' }, () => {
  // Nothing about a wrong path should stop the list being useful.
  const out = run(['--eqsp', '/definitely/not/here']);
  assert.match(out, /effects phrased/);
});

test('--json is machine-readable and carries the fields the list is built from', { skip: !built && 'no built dataset' }, () => {
  const parsed = JSON.parse(run(['--json']));
  for (const k of ['total', 'covered', 'remaining', 'phrased', 'todo']) assert.ok(k in parsed, k);
  assert.ok(Array.isArray(parsed.todo) && parsed.todo.length > 0);
  const first = parsed.todo[0];
  for (const k of ['spa', 'name', 'slots', 'share', 'examples']) assert.ok(k in first, k);
  // ranked worst first, or the whole point of the list is lost
  for (let i = 1; i < parsed.todo.length; i++)
    assert.ok(parsed.todo[i - 1].slots >= parsed.todo[i].slots, 'must be ordered by slot count');
});
