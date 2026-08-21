// claims.json is the file contributors edit, so its shape is enforced here
// rather than discovered at build time. Runs without a game install.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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


// --- the engine's own rules -------------------------------------------------

test('every rule the engine can cite is registered as a claim', async () => {
  const engine = await readFile(new URL('../web/engine.js', import.meta.url), 'utf8');
  const cited = new Set([...engine.matchAll(/done\(-?[01], '([a-z0-9-]+)'/g)].map(m => m[1]));
  const covered = new Set(doc.claims.filter(c => c.type === 'stacking_rule').flatMap(c => c.engine_rules || []));
  const missing = [...cited].filter(r => !covered.has(r));
  assert.deepEqual(missing, [], `these rules decide verdicts with no claim behind them: ${missing.join(', ')}`);
});

test('rule claims name a slug, not a SPA', () => {
  for (const c of doc.claims.filter(c => c.type === 'stacking_rule')) {
    assert.ok(c.slug, `${c.id} needs a slug`);
    assert.equal(c.spa, undefined);
    assert.equal(c.spas, undefined);
  }
  const problems = validate({ version: 1, claims: [{ id: 'stacking-rule/x', type: 'stacking_rule', slug: 'x', spa: 1,
    assertion: 'a'.repeat(20), evidence: [{ strength: 'supporting', kind: 'implementation', summary: 's', source: 'code' }] }] });
  assert.ok(problems.some(p => p.includes('not a SPA')));
});

test('the rule nearly every verdict rests on is honest about its provenance', () => {
  const core = doc.claims.find(c => c.slug === 'slot-arbitration');
  assert.ok(core);
  assert.equal(core.status, 'unverified');
  assert.ok(core.evidence.every(e => e.kind === 'implementation'));
});

test('evidence cannot be rated above its kind ceiling', () => {
  const mk = (kind, strength) => validate({ version: 1, claims: [{ id: 'non-cumulative/1', type: 'non_cumulative',
    spa: 1, assertion: 'a'.repeat(20), evidence: [{ strength, kind, summary: 's', source: 'x', who: 'N', standing: 'S' }] }] });
  assert.ok(mk('implementation', 'primary').some(p => p.includes('at best it is supporting')));
  assert.ok(mk('implementation', 'strong').some(p => p.includes('at best it is supporting')));
  assert.ok(mk('community', 'supporting').some(p => p.includes('at best it is weak')));
  assert.ok(mk('practitioner', 'primary').some(p => p.includes('at best it is strong')));
  // downgrading is always fine
  assert.deepEqual(mk('game-text', 'supporting'), []);
  assert.deepEqual(mk('practitioner', 'strong'), []);
});


// --- SPA naming -------------------------------------------------------------

test('SPA names come from Daybreak, not from EQEmu enum identifiers', async () => {
  const { daybreakNames, resolveNames, focusSpas } = await import('../tools/spa_names.mjs');
  const db = daybreakNames();
  assert.equal(Object.keys(db).length, 529, 'the published list runs 0-528');
  for (let i = 0; i <= 528; i++) assert.ok(db[i], `SPA ${i} missing from the reference copy`);

  // the ones this project talks about most, in the publisher's words
  assert.equal(db[0], 'HP');
  assert.equal(db[148], 'StackingBlocker');
  assert.equal(db[339], 'Fc_CastProc');
  assert.equal(db[383], 'Fc_CastProcNormalized');
  assert.equal(db[496], 'Critical Melee Damage Mod Max');

  const eqemu = JSON.parse(await readFile(new URL('../tools/spa_meta.json', import.meta.url), 'utf8'));
  const { names } = resolveNames(eqemu.spa_names);
  assert.equal(names[0], 'HP', 'not EQEmu\'s CurrentHP');
  assert.equal(names[85], 'Contact Ability (Melee Proc)', 'not EQEmu\'s WeaponProc');

  // Daybreak's prefixes name every focus SPA EQEmu knows about, and more
  const eqemuFocus = [...eqemu.focus_effects, ...eqemu.focus_limits];
  const focus = focusSpas(eqemuFocus);
  for (const id of eqemuFocus) assert.ok(focus.includes(id));
  assert.ok(focus.length > eqemuFocus.length);
});

test('the proc exceptions match how Daybreak names them', async () => {
  const { daybreakNames } = await import('../tools/spa_names.mjs');
  const db = daybreakNames();
  // 339 and 383 are the cast-proc focus family in the publisher's own naming
  assert.match(db[339], /^Fc_CastProc/);
  assert.match(db[383], /^Fc_CastProc/);
  // 340 is not a focus at all, so excepting it is a no-op rather than a claim
  assert.doesNotMatch(db[340], /^(Fc_|Ff_)/);
});
