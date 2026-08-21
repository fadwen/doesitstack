// claims.json is the file contributors edit, so its shape is enforced here
// rather than discovered at build time. Runs without a game install.

import test from 'node:test';
import assert from 'node:assert/strict';
import { load, validate, deriveStatus, spasOf, STRENGTHS, KINDS } from '../tools/claims.mjs';
import { FOCUS_CONTESTED, FOCUS_BEST_ONLY } from '../web/spa.js';

const doc = load();

test('every claim is structurally valid', () => {
  assert.deepEqual(validate(doc), []);
});

test('every claim states an assertion and cites at least one source', () => {
  for (const c of doc.claims) {
    assert.ok(c.assertion.length > 10, `${c.id} needs a real assertion`);
    assert.ok(c.evidence.length > 0, `${c.id} needs evidence`);
    for (const e of c.evidence) {
      assert.ok(STRENGTHS.includes(e.strength));
      assert.ok(KINDS.includes(e.kind));
      assert.ok(e.source && e.source.length > 5, `${c.id} evidence needs a checkable source`);
    }
  }
});

test('status is derived from evidence, never hand-written', () => {
  assert.equal(deriveStatus({ evidence: [{ strength: 'supporting' }] }), 'unverified');
  assert.equal(deriveStatus({ evidence: [{ strength: 'primary' }] }), 'confirmed');
  assert.equal(deriveStatus({ evidence: [{ strength: 'primary' }, { strength: 'primary', refutes: true }] }), 'disputed');
  for (const c of doc.claims) assert.equal(c.status, deriveStatus(c));
});

test('an emulator implementation can never be primary evidence on its own', () => {
  const problems = validate({
    version: 1,
    claims: [{ id: 'non-cumulative/1', type: 'non_cumulative', spa: 1, assertion: 'a'.repeat(20),
               evidence: [{ strength: 'primary', kind: 'implementation', summary: 's', source: 'somewhere' }] }],
  });
  assert.ok(problems.some(p => p.includes('cannot be primary')));
});

test('a parse must carry its method, sample size and result', () => {
  const problems = validate({
    version: 1,
    claims: [{ id: 'non-cumulative/1', type: 'non_cumulative', spa: 1, assertion: 'a'.repeat(20),
               evidence: [{ strength: 'primary', kind: 'parse', summary: 's', source: 'my log' }] }],
  });
  for (const field of ['method', 'sample_size', 'result'])
    assert.ok(problems.some(p => p.includes(field)), `expected a complaint about ${field}`);
});

test('SPA 496 is confirmed and the rest are not, as of this dataset', () => {
  const byId = Object.fromEntries(doc.claims.map(c => [c.spa, c.status]));
  assert.equal(byId[496], 'confirmed');
  for (const spa of [185, 186, 459, 482, 503, 505]) assert.equal(byId[spa], 'unverified');
});


test('a claim may cover a set of SPAs instead of one', () => {
  const multi = doc.claims.find(c => Array.isArray(c.spas));
  assert.ok(multi, 'expected at least one multi-SPA claim');
  assert.ok(multi.slug, 'a multi-SPA claim needs a slug');
  assert.equal(multi.id, `${multi.type.replace(/_/g, '-')}/${multi.slug}`);
  assert.deepEqual(spasOf(multi), multi.spas);
});

test('a claim cannot name both a single SPA and a set', () => {
  const problems = validate({
    version: 1,
    claims: [{ id: 'focus-stacking/x', type: 'focus_stacking', slug: 'x', spa: 1, spas: [1],
               assertion: 'a'.repeat(20), evidence: [{ strength: 'weak', kind: 'community', summary: 's', source: 'somewhere' }] }],
  });
  assert.ok(problems.some(p => p.includes('exactly one')));
});

test('the focus claims from reader feedback are recorded', () => {
  const bestOnly = doc.claims.find(c => c.type === 'focus_best_only');
  assert.ok(bestOnly, 'the best-only focus claim should exist');
  assert.deepEqual(bestOnly.exceptions, [339, 340, 383]);
  assert.equal(bestOnly.status, 'unverified');
  assert.ok(bestOnly.evidence.some(e => e.kind === 'community'), 'credit the reporter');
  assert.ok(bestOnly.evidence.some(e => e.kind === 'implementation'), 'and corroborate it');

  const stacking = doc.claims.find(c => c.type === 'focus_stacking');
  assert.equal(stacking.status, 'unverified');
  // The claim covers a category; the build derives which SPAs are actually affected.
  assert.deepEqual(stacking.spas, [], 'an empty spas array means "the whole category"');
  assert.ok(FOCUS_CONTESTED.includes(399), 'FcTwincast should come out of that derivation');
  assert.ok(FOCUS_CONTESTED.length > 5 && FOCUS_BEST_ONLY.length > 20);
});
