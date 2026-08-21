// Saved buff sets. Storage is injected, so this runs with no browser.
//
// The cases that matter are the hostile ones: storage that throws, storage full
// of someone else's junk, and storage that silently refuses to write. A tool
// that loses a carefully built raid set without saying so is worse than one
// that never offered to save it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readSets, writeSets, upsert, removeSet, findSet, sameSet, cleanName, KEY, MAX_NAME } from '../web/saved.js';

/** A stand-in for localStorage, optionally broken in the ways real ones are. */
const store = ({ throwOnRead = false, throwOnWrite = false, seed = null } = {}) => {
  let value = seed;
  return {
    getItem: () => { if (throwOnRead) throw new Error('SecurityError'); return value; },
    setItem: (_, v) => { if (throwOnWrite) throw new Error('QuotaExceededError'); value = v; },
    read: () => value,
  };
};

test('a round trip returns what went in', () => {
  const s = store();
  const list = upsert([], 'Melee raid', [1, 2, 3]);
  assert.equal(writeSets(s, list), true);
  assert.deepEqual(readSets(s), [{ name: 'Melee raid', ids: [1, 2, 3] }]);
});

test('nothing saved yet is not an error', () => {
  assert.deepEqual(readSets(store()), []);
  assert.deepEqual(readSets(undefined), []);
});

test('storage that throws degrades to no saved sets', () => {
  // Private windows and blocked site data throw on access rather than returning
  // null, and that must not take the page down with it.
  assert.deepEqual(readSets(store({ throwOnRead: true })), []);
});

test('a write that cannot persist says so rather than pretending', () => {
  assert.equal(writeSets(store({ throwOnWrite: true }), [{ name: 'x', ids: [1] }]), false);
});

test('junk in storage is discarded, not trusted', () => {
  assert.deepEqual(readSets(store({ seed: 'not json at all' })), []);
  assert.deepEqual(readSets(store({ seed: '{"not":"an array"}' })), []);
  assert.deepEqual(readSets(store({ seed: '[1,2,3]' })), []);
  assert.deepEqual(
    readSets(store({ seed: JSON.stringify([{ name: 'ok', ids: [1, 'x', -4, 2.5, 2, 2] }]) })),
    [{ name: 'ok', ids: [1, 2] }],
    'only positive integers survive, deduplicated');
  assert.deepEqual(readSets(store({ seed: JSON.stringify([{ name: '', ids: [1] }, { name: 'a', ids: [] }]) })), [],
    'a set with no name or no spells is not a set');
});

test('saving the same name again replaces it in place', () => {
  let list = upsert([], 'Melee raid', [1, 2]);
  list = upsert(list, 'Caster', [9]);
  list = upsert(list, 'melee RAID', [3, 4, 5]);
  assert.equal(list.length, 2, 'matched case-insensitively rather than duplicating');
  assert.deepEqual(list[0], { name: 'melee RAID', ids: [3, 4, 5] });
  assert.equal(list[1].name, 'Caster', 'and the others keep their order');
});

test('a name is tidied, and an empty one saves nothing', () => {
  assert.equal(cleanName('  Melee   raid  '), 'Melee raid');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName('x'.repeat(200)).length, MAX_NAME);
  assert.deepEqual(upsert([], '   ', [1]), []);
  assert.deepEqual(upsert([], 'Empty', []), [], 'and neither does an empty set');
});

test('sets can be found and removed by name, ignoring case', () => {
  const list = upsert(upsert([], 'Melee raid', [1]), 'Caster', [2]);
  assert.deepEqual(findSet(list, 'MELEE RAID').ids, [1]);
  assert.equal(findSet(list, 'nope'), null);
  assert.deepEqual(removeSet(list, 'melee raid').map(s => s.name), ['Caster']);
});

test('a reordered set is the same set', () => {
  // ids carry insertion order, which is a display detail. Calling a reorder
  // "modified" would make the revert prompt cry wolf.
  assert.equal(sameSet([1, 2, 3], [3, 1, 2]), true);
  assert.equal(sameSet([1, 2, 3], [1, 2]), false);
  assert.equal(sameSet([1, 2], [1, 2, 3]), false);
  assert.equal(sameSet([], []), true);
  assert.equal(sameSet([1, 2], [1, 4]), false);
});

test('the storage key is namespaced so it cannot collide', () => {
  assert.match(KEY, /^doesitstack\./);
});
