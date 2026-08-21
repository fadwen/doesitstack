// claims.json is the file contributors edit, so its shape is enforced here
// rather than discovered at build time. Runs without a game install.

import test from 'node:test';
import assert from 'node:assert/strict';
import { load, validate, deriveStatus, isActionable, spasOf, STRENGTHS, KINDS } from '../tools/claims.mjs';
import { FOCUS_CONTESTED, FOCUS_BEST_ONLY, IGNORED_BY_CLAIM } from '../web/spa.js';

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

test('the focus claims are attributed and acted on', () => {
  const bestOnly = doc.claims.find(c => c.type === 'focus_best_only');
  assert.ok(bestOnly, 'the best-only focus claim should exist');
  assert.deepEqual(bestOnly.exceptions, [339, 340, 383]);
  assert.equal(bestOnly.status, 'corroborated');
  const named = bestOnly.evidence.find(e => e.kind === 'practitioner');
  assert.ok(named, 'a named practitioner report');
  assert.ok(named.who && named.who.length > 5, 'with the standing that makes it weigh');
  assert.ok(bestOnly.evidence.some(e => e.kind === 'implementation'), 'and corroboration');

  const stacking = doc.claims.find(c => c.type === 'focus_stacking');
  assert.equal(stacking.status, 'corroborated');
  assert.deepEqual(stacking.spas, [], 'an empty spas array means "the whole category"');
  // Acted on, so the SPAs are exempted rather than left contested.
  assert.ok(IGNORED_BY_CLAIM.includes(399));
  assert.equal(FOCUS_CONTESTED.length, 0);
  assert.ok(FOCUS_BEST_ONLY.length > 20);
});

test('a practitioner report needs a name to credit and a standing to justify it', () => {
  const base = { id: 'focus-stacking/x', type: 'focus_stacking', slug: 'x', spas: [], assertion: 'a'.repeat(20) };
  const ev = extra => ({ version: 1, claims: [{ ...base,
    evidence: [{ strength: 'strong', kind: 'practitioner', summary: 's', source: 'a post', ...extra }] }] });

  assert.deepEqual(validate(ev({ who: 'Someone', standing: 'class rep for wizards' })), []);
  assert.ok(validate(ev({ standing: 'class rep' })).some(p => p.includes('who')));
  assert.ok(validate(ev({ who: 'Someone' })).some(p => p.includes('standing')));
});

test('the credit line is a name, not a biography', () => {
  const problems = validate({ version: 1, claims: [{ id: 'focus-stacking/x', type: 'focus_stacking', slug: 'x',
    spas: [], assertion: 'a'.repeat(20),
    evidence: [{ strength: 'strong', kind: 'practitioner', who: 'Someone, class representative and raid lead of a guild',
                 standing: 'as stated', summary: 's', source: 'a post' }] }] });
  assert.ok(problems.some(p => p.includes('biography')));
});

test('standing stays in the repo and is never shipped to the page', () => {
  const named = doc.claims.flatMap(c => c.evidence).filter(e => e.kind === 'practitioner');
  assert.ok(named.length > 0);
  for (const e of named) {
    assert.ok(e.standing, 'recorded for reviewers');
    assert.ok(!e.who.includes(e.standing), 'but kept out of the credit line');
  }
});

test('an emulator implementation cannot be strong either', () => {
  const problems = validate({ version: 1, claims: [{ id: 'non-cumulative/1', type: 'non_cumulative', spa: 1,
    assertion: 'a'.repeat(20),
    evidence: [{ strength: 'strong', kind: 'implementation', summary: 's', source: 'some code' }] }] });
  assert.ok(problems.some(p => p.includes('cannot be strong')));
});

test('status ranks primary above strong above the rest', () => {
  assert.equal(deriveStatus({ evidence: [{ strength: 'weak' }] }), 'unverified');
  assert.equal(deriveStatus({ evidence: [{ strength: 'supporting' }] }), 'unverified');
  assert.equal(deriveStatus({ evidence: [{ strength: 'strong' }] }), 'corroborated');
  assert.equal(deriveStatus({ evidence: [{ strength: 'strong' }, { strength: 'primary' }] }), 'confirmed');
  assert.equal(deriveStatus({ evidence: [{ strength: 'strong' }, { strength: 'weak', refutes: true }] }), 'disputed');
});

test('only confirmed and corroborated claims are acted on', () => {
  assert.equal(isActionable({ evidence: [{ strength: 'strong' }] }), true);
  assert.equal(isActionable({ evidence: [{ strength: 'primary' }] }), true);
  assert.equal(isActionable({ evidence: [{ strength: 'supporting' }] }), false);
  assert.equal(isActionable({ evidence: [{ strength: 'weak' }] }), false);
});
