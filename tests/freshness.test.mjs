// The staleness notice is user-facing correctness: a hosted copy that has gone a
// few patches out of date gives wrong answers with no outward sign.

import test from 'node:test';
import assert from 'node:assert/strict';
import { dataAge, PATCH_CYCLE_DAYS, STALE_DAYS } from '../web/freshness.js';

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
