// The staleness notice is user-facing correctness: a hosted copy that has gone a
// few patches out of date gives wrong answers with no outward sign.

import test from 'node:test';
import assert from 'node:assert/strict';
import { dataAge, itemDataAge, PATCH_CYCLE_DAYS, STALE_DAYS } from '../web/freshness.js';

const at = (fileDate, days) => dataAge(fileDate, Date.parse(`${fileDate}T00:00:00Z`) + days * 86400000);

test('fresh data says nothing', () => {
  const r = at('2026-08-01', 3);
  assert.equal(r.level, 'fresh');
  assert.equal(r.message, null);
});

test('nothing is said right up to the end of a patch cycle', () => {
  assert.equal(at('2026-08-01', PATCH_CYCLE_DAYS - 1).level, 'fresh');
});

test('past a patch cycle it warns, with the actual age', () => {
  const r = at('2026-08-01', PATCH_CYCLE_DAYS);
  assert.equal(r.level, 'aging');
  assert.match(r.message, new RegExp(`${PATCH_CYCLE_DAYS} days old`));
});

test('several patches out it says the data should not be trusted', () => {
  const r = at('2026-08-01', STALE_DAYS);
  assert.equal(r.level, 'stale');
  assert.match(r.message, /out of date/);
  assert.match(r.message, /4 months old/);
});

test('the month count reads naturally at exactly one month', () => {
  const r = dataAge('2026-01-01', Date.parse('2026-01-01T00:00:00Z') + 200 * 86400000);
  assert.match(r.message, /6 months old/);
  assert.doesNotMatch(r.message, /1 months/);
});

test('a malformed date is not reported as ancient', () => {
  const r = dataAge('not-a-date', Date.now());
  assert.equal(r.message, null);
  assert.equal(r.level, 'fresh');
});

// ---------------------------------------------------------------------------
// Item data ages on a different clock: it moves when a player submits a find,
// not when Daybreak patches, so weeks of lag is normal and months is not.

const ITEM_NOW = Date.parse('2026-08-21T00:00:00Z');

test('recent item data says nothing', () => {
  assert.equal(itemDataAge('2026-08-09', ITEM_NOW).message, null);
  assert.equal(itemDataAge('2026-08-09', ITEM_NOW).level, 'fresh');
});

test('item data is allowed to lag further than the spell file before it complains', () => {
  // 70 days would already be "aging" for a spell file; for item data it is only
  // just past normal, and the wording says missing rather than wrong.
  const item = itemDataAge('2026-06-12', ITEM_NOW);
  assert.equal(item.level, 'aging');
  assert.match(item.message, /may not be tagged yet/);
  assert.equal(dataAge('2026-06-12', ITEM_NOW).level, 'aging');
});

test('a long-silent item source is called out as such', () => {
  const r = itemDataAge('2025-06-01', ITEM_NOW);
  assert.equal(r.level, 'stale');
  assert.match(r.message, /not come from the client files/);
});

test('a missing item date degrades quietly', () => {
  assert.equal(itemDataAge(null, ITEM_NOW).message, null);
  assert.equal(itemDataAge('', ITEM_NOW).message, null);
});
