// Finding the game files. Runs anywhere: the directories are made up on the spot.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findEqDir } from '../tools/eqdir.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dis-eqdir-'));
const install = (name) => {
  const d = path.join(dir, name);
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'spells_us.txt'), '');
  return d;
};
const empty = (name) => { const d = path.join(dir, name); fs.mkdirSync(d); return d; };

test('EQ_DIR is tried before the usual install paths', () => {
  const mine = install('mine'), usual = install('usual');
  assert.equal(findEqDir([usual], { EQ_DIR: mine }), mine);
});

test('an EQ_DIR without a spell file falls through to the usual paths', () => {
  // A stale variable should not hide a perfectly good install.
  const usual = install('usual2');
  assert.equal(findEqDir([usual], { EQ_DIR: empty('stale') }), usual);
});

test('nothing found means undefined, so the caller can say so', () => {
  assert.equal(findEqDir([empty('a'), path.join(dir, 'does-not-exist')], {}), undefined);
  assert.equal(findEqDir([], { EQ_DIR: empty('b') }), undefined);
});
