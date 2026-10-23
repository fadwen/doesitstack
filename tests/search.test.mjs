// The spell picker's search, run against a synthetic index.
//
// adopt() takes a dataset already in memory, so none of this needs the built
// dataset or a browser. The cases are the ones that went wrong: a popular word
// losing its newest prefix matches to a cap applied before sorting, and an id
// typed in full sorting below a longer id that merely starts with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { adopt, search, row, notInFile, notLoaded, SHOWN } from '../web/data.js';

const META = { kinds: ['spell', 'aa'], spell_file_date: '2026-09-10', bucket: 1000 };
// [id, name, target, flags, duration, levels, category, kind, classMask, extMask, itemRel]
const spell = (id, name, extra = {}) => {
  const r = [id, name, 1, 1, 10, '', '', 0, 0, 0, 0];
  for (const [k, v] of Object.entries(extra)) r[row[k]] = v;
  return r;
};
const any = { buffsOnly: false, benefOnly: false, kinds: null, cls: -1 };
const ids = hits => hits.map(r => r[row.id]);

test('a prefix match past the first 400 hits is still found', () => {
  // 500 substring matches sit at low ids, then the prefix matches at the top of
  // the id range — where a spell added in the latest patch lands.
  const index = [];
  for (let i = 1; i <= 500; i++) index.push(spell(i, `Savage Spirit ${i}`));
  for (let i = 501; i <= 510; i++) index.push(spell(i, `Spirit of ${i}`));
  adopt(META, index);
  const hits = search('spirit', any);
  assert.equal(hits.length, SHOWN);
  assert.deepEqual(ids(hits.slice(0, 10)), [501, 502, 503, 504, 505, 506, 507, 508, 509, 510],
    'the ten names that start with the query come first, whatever their id');
  assert.ok(ids(hits.slice(10)).every(id => id <= 500), 'then the substring matches');
});

test('an id typed in full comes before the ids it is a prefix of', () => {
  adopt(META, [
    spell(62731, 'Ab'),
    spell(6273, 'Prophet’s Gift of the Ruchu'),   // the longest name, so name length would bury it
    spell(62730, 'Abc'),
  ]);
  assert.deepEqual(ids(search('6273', any)), [6273, 62730, 62731]);
  assert.deepEqual(ids(search('627', any)), [6273, 62730, 62731], 'and otherwise ids read in order');
});

test('matching ignores case and the filters still apply', () => {
  adopt(META, [
    spell(1, 'Savage Spirit'),
    spell(2, 'SAVAGE SPIRIT II', { kind: 1 }),
    spell(3, 'Spirit of Wolf', { duration: 0 }),
    spell(4, 'Talisman of the Spirit', { classMask: 1 << 2 }),
  ]);
  assert.deepEqual(ids(search('savage sp', any)), [1, 2]);
  assert.deepEqual(ids(search('spirit', { ...any, kinds: new Set(['spell']) })), [3, 1, 4]);
  assert.deepEqual(ids(search('spirit', { ...any, buffsOnly: true })), [1, 2, 4]);
  assert.deepEqual(ids(search('spirit', { ...any, cls: 2 })), [4], 'class is matched by bit, not position');
  assert.deepEqual(ids(search('spirit', { ...any, exclude: new Set([1, 2]) })), [3, 4]);
});

test('names come shortest first within a bucket', () => {
  adopt(META, [spell(10, 'Spirit of the Wolf'), spell(11, 'Spirit'), spell(12, 'Wild Spirit'), spell(13, 'Spirit Wolf')]);
  assert.deepEqual(ids(search('spirit', any)), [11, 13, 10, 12]);
});

test('a missing spell is described with the spell file date it is missing from', () => {
  adopt(META, []);
  assert.equal(notInFile([70855]),
    'Spell 70855 is not in this spell file (dated 2026-09-10) — it may have been removed or renumbered.');
  assert.match(notInFile([1, 2]), /^Spells 1, 2 are not in this spell file \(dated 2026-09-10\)/);
  assert.match(notLoaded([5]), /^Could not load spell 5 /);
  assert.match(notLoaded([5, 6]), /^Could not load spells 5, 6 /);
});
