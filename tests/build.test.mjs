// The build's shaping of a spell record, and its sharding, checked on fixtures.
// Runs anywhere: nothing here reads the game files.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fx } from './fixtures.mjs';
import { compact, shard, outProblem, BUCKET } from '../tools/build.mjs';
import { REL } from '../tools/items.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// The fixtures stop at what the engine reads; the build also expects the
// parser's description, reference and category fields.
const full = (name, extra = {}) =>
  ({ ...fx(name), categories: [], refs: [], ext_levels: new Array(16).fill(255), desc: '', land_self: '', ...extra });

test('a record keeps the slot tuple in the order the page unpacks it', () => {
  const rec = compact(full('spiritOfWolf'));
  assert.equal(rec.id, 278);
  // [spa, base1, base2, calc, max] — tests/load.mjs and web/data.js both unpack by position
  assert.deepEqual(rec.slots[1], [3, 30, 0, 100, 55]);
  assert.equal(rec.slots.length, 2);
  for (const k of ['categories', 'refs', 'ext_levels', 'stacking', 'it', 'aura', 'extra'])
    assert.ok(!(k in rec), `${k} is left out when empty, to keep the shards small`);
});

test('a blank slot stays null rather than becoming a tuple of zeros', () => {
  const sp = full('weakBuff', { slots: [null, { spa: 1, base1: 100, base2: 0, calc: 100, max: 0 }] });
  assert.deepEqual(compact(sp).slots, [null, [1, 100, 0, 100, 0]]);
});

test('the aura flag is set from the duration formula alone', () => {
  assert.equal(compact(full('weakBuff', { dur_calc: 51 })).aura, true);
  assert.equal(compact(full('weakBuff', { dur_calc: 7 })).aura, undefined);
});

test('references are capped at twelve per record', () => {
  const refs = Array.from({ length: 20 }, (_, i) => 1000 + i);
  assert.deepEqual(compact(full('weakBuff', { refs })).refs, refs.slice(0, 12));
});

test('the item triple is [mask, count, [[id, name, rel index]]]', () => {
  const items = { mask: 5, count: 7, items: [[10, 'Cloak', 'click'], [11, 'Ring', 'worn']], all: [] };
  const rec = compact(full('weakBuff', { items }));
  assert.deepEqual(rec.it, [5, 7, [[10, 'Cloak', REL.indexOf('click')], [11, 'Ring', REL.indexOf('worn')]]]);
  assert.equal(REL.indexOf('worn'), 2, 'the index is the bit position meta.items.rel publishes');
});

test('spells shard by id bucket, descriptions only where there is one', () => {
  const spells = [
    full('spiritOfWolf', { desc: 'Faster.' }),           // 278   -> bucket 0
    full('ensnare'),                                      // 512   -> bucket 0, nothing to describe
    full('savageSpirit', { land_self: 'You rage.' }),    // 70855 -> bucket 35
  ];
  const { shards, descs } = shard(spells);
  assert.deepEqual([...shards.keys()], [0, Math.floor(70855 / BUCKET)]);
  assert.deepEqual(Object.keys(shards.get(0)), ['278', '512']);
  assert.deepEqual(descs.get(0), { 278: { d: 'Faster.', l: '' } });
  assert.deepEqual(descs.get(35), { 70855: { d: '', l: 'You rage.' } });
});

test('--out is emptied each build, so it has to be somewhere that is safe to empty', () => {
  // The repo root, anything outside it, and a tracked directory are all refused
  // before a byte is parsed. Only a previous build, an empty dir or nothing passes.
  assert.match(outProblem(path.resolve(ROOT)), /repo itself/);
  assert.match(outProblem(path.resolve(ROOT, '..')), /not inside/);
  assert.match(outProblem(path.join(os.tmpdir(), 'dis-out')), /not inside/);
  assert.match(outProblem(path.join(ROOT, 'web')), /does not look like a previous build/);
  assert.match(outProblem(path.join(ROOT, 'tools')), /does not look like a previous build/);
  assert.equal(outProblem(path.join(ROOT, 'dist-that-does-not-exist-yet')), null);
});

test('an items shard entry exists only when the record does not already name every item', () => {
  const some = { mask: 1, count: 5, items: [[1, 'A', 'click'], [2, 'B', 'click'], [3, 'C', 'click']],
                 all: [[1, 'A', 'click'], [2, 'B', 'click'], [3, 'C', 'click'], [4, 'D', 'click'], [5, 'E', 'click']] };
  const every = { mask: 1, count: 2, items: [[1, 'A', 'click'], [2, 'B', 'click']], all: [[1, 'A', 'click'], [2, 'B', 'click']] };
  const { itemLists } = shard([full('weakBuff', { items: some }), full('strongBuff', { items: every }), full('ensnare')]);
  const b = Math.floor(900001 / BUCKET);
  assert.deepEqual([...itemLists.keys()], [b]);
  assert.deepEqual(Object.keys(itemLists.get(b)), ['900001'], 'only the spell with more items than its record names');
  assert.equal(itemLists.get(b)[900001].length, 5, 'and then it is all of them');
  assert.deepEqual(itemLists.get(b)[900001][3], [4, 'D', 0]);
});
