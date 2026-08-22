// Preset sets ship with the site, so a broken one is broken for everybody rather
// than for the person who made it. These checks are the ones that can be made
// without a spell file; build.mjs separately reports ids that stop resolving,
// which is the failure that actually happens over time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, findPreset } from '../web/presets.js';
import { sameSet } from '../web/saved.js';

test('every preset has a name, a note and some spells', () => {
  assert.ok(PRESETS.length > 0);
  for (const p of PRESETS) {
    assert.ok(p.name && p.name.trim() === p.name, `"${p.name}" needs a trimmed name`);
    assert.ok(p.name.length <= 40, `"${p.name}" is longer than a saved-set name may be`);
    assert.ok(p.note && p.note.length > 30, `${p.name} needs a note saying what it is`);
    assert.ok(Array.isArray(p.ids) && p.ids.length > 1, `${p.name} needs more than one spell`);
  }
});

test('preset spell ids are positive integers with no duplicates', () => {
  for (const p of PRESETS) {
    for (const id of p.ids)
      assert.ok(Number.isInteger(id) && id > 0, `${p.name} has a bad id: ${id}`);
    assert.equal(new Set(p.ids).size, p.ids.length, `${p.name} lists the same spell twice`);
  }
});

test('preset names are unique and distinguishable', () => {
  const names = PRESETS.map(p => p.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'two presets sharing a name cannot both be loaded');
});

test('a preset is found case-insensitively, like a saved set', () => {
  // The set view resolves a loaded name against saved sets first and presets
  // second, so the two lookups have to agree on what "same name" means.
  const first = PRESETS[0];
  assert.equal(findPreset(first.name.toUpperCase())?.name, first.name);
  assert.equal(findPreset(`  ${first.name}  `)?.name, first.name);
  assert.equal(findPreset('no such set'), null);
  assert.equal(findPreset(undefined), null);
});

test('a preset compares as a set, so a reorder is not a change', () => {
  const p = PRESETS[0];
  assert.equal(sameSet(p.ids, [...p.ids].reverse()), true);
  assert.equal(sameSet(p.ids, p.ids.slice(1)), false);
});

test('the shipped set is the one asked for', () => {
  // Pinned so a careless edit to the list is a failing test rather than a
  // different set quietly going out to everyone.
  const p = findPreset('Common level 130 buffs');
  assert.ok(p, 'the common 130 set must exist');
  assert.equal(p.ids.length, 23);
  for (const id of [73888, 11249, 49447, 3628, 67264, 71052, 72774, 36424, 70155])
    assert.ok(p.ids.includes(id), `expected spell ${id} in the common 130 set`);
});
