// The phrased reading of a slot.
//
// This is a convenience layer over a third party's interpretation, so the tests
// that matter are the ones about honesty: it must say nothing rather than guess,
// and it must not quietly disagree with the exact reading about what an effect
// is called.

import test from 'node:test';
import assert from 'node:assert/strict';
import { phrase, PHRASED } from '../web/phrasing.js';
import { SpellResist, SpellTarget, fromEnum, limit } from '../web/enums.js';

const slot = (spa, base1 = 0, base2 = 0, max = 0, calc = 100) => ({ spa, base1, base2, calc, max });

test('the example that prompted this reads as intended', () => {
  assert.equal(phrase(slot(135, 2), 2), 'Limit Resist: Fire');
});

test('a negative limiter value means "everything except"', () => {
  assert.equal(phrase(slot(135, -2), -2), 'Limit Resist: Exclude Fire');
  assert.equal(phrase(slot(136, -2), -2), 'Limit Target: Exclude Caster AE');
});

test('an unported effect returns null rather than a guess', () => {
  // The UI shows the exact name and an "as-is" marker for these. Inventing a
  // phrasing would be the one unrecoverable mistake here.
  assert.equal(phrase(slot(999, 1), 1), null);
  assert.equal(phrase(slot(146, 1), 1), null, 'Portal Locations is knowingly unported');
});

test('effect references resolve through Daybreak naming, not a second list', () => {
  // SPA 137 names another effect. It must use the same names the exact view
  // shows, or the two readings disagree about what an effect is called.
  const names = { 124: 'Fc_Damage_%' };
  assert.equal(phrase(slot(137, 124), 124, names), 'Limit Effect: Fc_Damage_%');
  assert.equal(phrase(slot(137, 124), 124, {}), 'Limit Effect: SPA 124',
    'with no name table it falls back to the number, never to another vocabulary');
});

test('direction follows the sign, as the source does', () => {
  assert.equal(phrase(slot(0, -500), -500), 'Decrease Current HP by 500');
  assert.equal(phrase(slot(0, 500), 500), 'Increase Current HP by 500');
  assert.equal(phrase(slot(124, -10), -10), 'Decrease Spell Damage by 10%');
});

test('the blank-slot spacer stays blank, but real charisma effects do not', () => {
  // 90,913 of the 91,257 SPA 10 slots carry base 0 and are padding. The other
  // 344 are real: Charisma +40, Glamour, Alluring Aura. Treating the whole SPA
  // as filler would have silently dropped them.
  assert.equal(phrase(slot(10, 0), 0), null);
  assert.equal(phrase(slot(10, 25), 25), 'Increase CHA by 25');
  assert.equal(phrase(slot(10, 40), 40), 'Increase CHA by 40');
});

test('charisma debuffs are phrased, where eqspellparser hides them', () => {
  // A deliberate divergence. eqspellparser returns null for base1 <= 1, which
  // catches the padding but also every debuff — Skunk Spray at -30 and
  // Fellspine at -50 are real effects and say so here.
  assert.equal(phrase(slot(10, -30), -30), 'Decrease CHA by 30');
  assert.equal(phrase(slot(10, -50), -50), 'Decrease CHA by 50');
  assert.equal(phrase(slot(10, -1), -1), 'Decrease CHA by 1');
});

test('the stacking commands are spelled out, since everything here turns on them', () => {
  const names = { 1: 'AC' };
  assert.equal(phrase(slot(148, 1, 2, 500), 1, names), "Block new spell if slot 2 is 'AC' and < 500");
  assert.equal(phrase(slot(149, 1, 2, 500), 1, names), "Overwrite existing spell if slot 2 is 'AC' and < 500");
});

test('an unknown enum value is labelled, not dropped', () => {
  assert.equal(fromEnum(SpellResist, 99), 'Type 99');
  assert.equal(limit(SpellTarget, -999), 'Exclude Type 999');
});

test('coverage is wide enough to be worth offering', () => {
  // Measured against the real spell file this is 93% of slot instances. The set
  // here is the floor: dropping below it should be a deliberate act.
  assert.ok(PHRASED.size >= 200, `only ${PHRASED.size} effects have a phrasing`);
  // the limiters are the whole reason this exists — they read worst untranslated
  for (const spa of [134, 135, 136, 137, 138, 139, 140, 141, 142, 311, 348, 385])
    assert.ok(PHRASED.has(spa), `limiter SPA ${spa} must have a phrasing`);
});

test('every phrasing is a non-empty string', () => {
  for (const spa of PHRASED) {
    const out = phrase(slot(spa, 1, 1, 1), 1, {});
    assert.equal(typeof out, 'string', `SPA ${spa} returned ${typeof out}`);
    assert.ok(out.trim().length > 0, `SPA ${spa} phrased to an empty string`);
    assert.doesNotMatch(out, /undefined|NaN|\[object/, `SPA ${spa} phrased to "${out}"`);
  }
});

// --- which reading you get without asking -----------------------------------

import { getReading, setReading } from '../web/data.js';

test('the readable form is what you get by default', () => {
  // With no stored preference — which is every first visit — a slot should read
  // "Limit Resist: Fire" rather than "Ff_ResistType". The exact view is a
  // checkbox away for anyone who needs to quote what the file actually says.
  assert.equal(getReading(), 'phrased');
});

test('the choice is limited to the two readings that exist', () => {
  assert.equal(setReading('exact'), 'exact');
  assert.equal(setReading('phrased'), 'phrased');
  // anything unrecognised falls to the readable form rather than to a broken state
  assert.equal(setReading('nonsense'), 'phrased');
  assert.equal(setReading(undefined), 'phrased');
  assert.equal(getReading(), 'phrased');
});

test('a spacer keeps the effect name it has in the file', () => {
  // The display may dim a spacer or drop its row, but must not rename it. The
  // exact reading exists so a slot can be quoted as the file has it, and a word
  // of the tool's own in place of "CHA" defeats that entirely.
  assert.equal(phrase(slot(10, 0), 0), null, 'no phrasing, so the caller falls back to the name');
  assert.equal(phrase(slot(10, 0), 0, { 10: 'CHA' }), null, 'and never to a substitute of its own');
});
