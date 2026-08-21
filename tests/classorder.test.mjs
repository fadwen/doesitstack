// Class filter chip ordering.
//
// The subtle part is that reordering the *display* must not disturb the class
// index, which is the bit position in the class mask on every search-index row.
// Get that wrong and every class search quietly returns the wrong class.

import test from 'node:test';
import assert from 'node:assert/strict';
import { orderClasses } from '../web/data.js';

// The game's own order, which is what META.classes ships.
const CLASSES = ['WAR', 'CLR', 'PAL', 'RNG', 'SHD', 'DRU', 'MNK', 'BRD', 'ROG',
                 'SHM', 'NEC', 'WIZ', 'MAG', 'ENC', 'BST', 'BER'];

test('classes come out alphabetically descending', () => {
  const labels = orderClasses(CLASSES).map(c => c.label);
  assert.deepEqual(labels, ['WIZ', 'WAR', 'SHM', 'SHD', 'ROG', 'RNG', 'PAL', 'NEC',
                            'MNK', 'MAG', 'ENC', 'DRU', 'CLR', 'BST', 'BRD', 'BER']);
});

test('every class survives the reorder exactly once', () => {
  const out = orderClasses(CLASSES);
  assert.equal(out.length, CLASSES.length);
  assert.deepEqual(new Set(out.map(c => c.label)), new Set(CLASSES));
});

test('each chip keeps the class index it started with', () => {
  // This is the one that matters. The index is the bit position in the class
  // mask; if it tracked display position instead, searching BER would filter WIZ.
  for (const { label, idx } of orderClasses(CLASSES))
    assert.equal(CLASSES[idx], label, `${label} must keep index ${CLASSES.indexOf(label)}`);
});

test('the source array is not mutated', () => {
  const input = [...CLASSES];
  orderClasses(input);
  assert.deepEqual(input, CLASSES, 'META.classes is shared — reordering it in place would break the mask');
});

test('an empty list is not an error', () => {
  assert.deepEqual(orderClasses([]), []);
});
