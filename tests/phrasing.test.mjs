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
  // Measured against the real spell file this is 98% of slot instances. The set
  // here is the floor: dropping below it should be a deliberate act.
  assert.ok(PHRASED.size >= 290, `only ${PHRASED.size} effects have a phrasing`);
  // the limiters are the whole reason this exists — they read worst untranslated
  for (const spa of [134, 135, 136, 137, 138, 139, 140, 141, 142, 311, 348, 385])
    assert.ok(PHRASED.has(spa), `limiter SPA ${spa} must have a phrasing`);
});

test('every phrasing is a non-empty string', () => {
  for (const spa of PHRASED) {
    const out = phrase(slot(spa, 1, 1, 1), 1, {}, { extra: 'x' });
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

test('the effects that were written rather than ported now match the source', () => {
  // Every one of these said something the effect does not do. Savage Spirit
  // Penance is the one that surfaced it: slot 1 is SPA 147 at base -25, max
  // 200000, which the file means as "take a quarter of your health", and which
  // this read out as "Heal to -25% of Max HP".
  assert.equal(phrase(slot(147, -25, 0, 200000), -25),
    'Decrease Current HP by 25% up to 200000');
  // 162 and 163 had swapped jobs: 162 is the percentage, 163 is the hit count.
  assert.equal(phrase(slot(162, 30, 500, 10000), 30),
    'Absorb Melee Damage: 30%, Max Per Hit: 500, Total: 10000');
  assert.equal(phrase(slot(163, 4, 0, 1200), 4), 'Absorb 4 Hits or Spells, Max Per Hit: 1200');
  // 191 inhibits melee, not casting — it was labelled "Silence".
  assert.equal(phrase(slot(191), 0), 'Inhibit Combat');
  assert.equal(phrase(slot(96), 0), 'Inhibit Spell Casting');
  // 232 is a chance, not a spell reference; base2 is not a spell id here.
  assert.equal(phrase(slot(232, 5), 5), 'Increase Chance to Trigger Divine Intervention by 5%');
  assert.equal(phrase(slot(55, 0, 0, 0), 8000), 'Absorb Damage: 100%, Total: 8000');
});

test('under a second, a stun is only an interrupt', () => {
  assert.equal(phrase(slot(21, 500), 500), 'Interrupt Casting');
  assert.equal(phrase(slot(21, 4000, 2000), 4000), 'Stun for 4s (2s in PvP)');
});

test('an effect that needs a field of the spell says nothing, rather than the wrong thing', () => {
  // Instrument Modifier reads the spell's skill, which the record does not carry,
  // so it falls back to the exact name and the "as-is" badge whatever it is given.
  // Teleport reads the zone token: null without the spell, the line with it.
  assert.equal(phrase(slot(179, 200), 200), null);
  assert.equal(phrase(slot(179, 200), 200, {}, { extra: 'x', skill: 41 }), null);
  assert.equal(phrase(slot(145, 1), 1), null);
  assert.equal(phrase(slot(145, 1), 1, {}, { extra: 'northkarana' }), 'Teleport to northkarana');
});

test('the second batch of written-not-ported lines matches the source too', () => {
  // Found by tools/phrasing_audit.mjs rather than by anyone reading a spell.
  assert.equal(phrase(slot(360, 25, 6097), 25), 'Add Killshot Proc: [Spell 6097] (25% Chance)');
  assert.equal(phrase(slot(427, 6097, 4), 6097), 'Cast: [Spell 6097] on Skill Use (4)');
  // 428 takes its skill from base1; this read base2 and called it a proc modifier.
  assert.equal(phrase(slot(428, 4), 4), 'Limit Skill: Abjuration');
  // 501 is milliseconds, and a positive figure makes casting faster, not slower.
  assert.equal(phrase(slot(501, 1500), 1500), 'Decrease Casting Times by 1.5s');
  assert.equal(phrase(slot(501, -1500), -1500), 'Increase Casting Times by 1.5s');
  assert.equal(phrase(slot(507, 50, 150), 50),
    'Increase Spell Damage by 5% to 15% (v507, Before DoT Crit, After DD Crit)');
});

test('a floor-and-ceiling pair reads as a range, and a single figure does not', () => {
  assert.equal(phrase(slot(507, 100, 100), 100),
    'Increase Spell Damage by 10% (v507, Before DoT Crit, After DD Crit)');
});

test('a reference to a spell outside this file stays as the file wrote it', () => {
  // Summon Horse points at spell 1, which no longer exists. The page must leave
  // "[Spell 1]" alone rather than offer a link to nothing, so the token has to
  // survive phrasing intact for the renderer to make that call.
  assert.equal(phrase(slot(113, 1), 1), 'Summon Mount: [Spell 1]');
  assert.match(phrase(slot(373, 6097), 6097), /\[Spell 6097\]/);
});

test('the two melee slows read differently, because they are different mechanisms', () => {
  // A negative SPA 11 and a SPA 371 both slow melee, and both read "Decrease Melee
  // Haste by n%". The (v371) marker is the only thing on the row that tells them
  // apart, and they combine differently — so it is kept, exactly as the source and
  // raidloot print it.
  assert.equal(phrase(slot(371, 40), 40), 'Decrease Melee Haste by 40% (v371, Incremental)');
  assert.equal(phrase(slot(11, 70), 70), 'Decrease Melee Haste by 30%');
  assert.equal(phrase(slot(11, 168), 168), 'Increase Melee Haste by 68%');
});

test('the two tenths-of-a-percent effects divide, as the description tokens already did', () => {
  // tools/spells.mjs has scaled 178 and 182 by ten in descriptions all along;
  // the phrasing printed the stored figure. 178 also still carried the line
  // eqspellparser only uses for spell files older than August 2016.
  assert.equal(phrase(slot(178, 50, 0, 0), 50), 'Return 5% of Melee Damage as HP');
  assert.equal(phrase(slot(178, 125, 1, 300), 125), 'Return 12.5% of Melee Damage as Mana, Max Per Hit: 300');
  assert.equal(phrase(slot(178, 100, 2, 0), 100), 'Return 10% of Melee Damage as Endurance');
  assert.equal(phrase(slot(182, -225), -225), 'Decrease Weapon Delay by 22.5%');
  assert.equal(phrase(slot(182, 100), 100), 'Increase Weapon Delay by 10%');
});

test('the other two lines kept for older spell files are replaced by the current ones', () => {
  // Found once the C# reader stepped over the Version-guarded returns. Both
  // were word-for-word the line eqspellparser uses for 2018 files and earlier.
  assert.equal(phrase(slot(32, 17005, 20), 17005), 'Summon: [Item 17005] x 20');
  assert.equal(phrase(slot(329, 5000, 10000, 0), 5000), 'Absorb Damage using Mana: 50%');
  assert.equal(phrase(slot(329, 5000, 4000, 1500), 5000),
    'Absorb Damage using Mana: 50% (0.40 Mana per 1 HP), Max Per Hit: 1500');
});

// --- the worst-first pass down the worklist ----------------------------------
// One line per case, in the order phrasing_todo.mjs listed them, each against
// the line in SpellData.cs it was ported from. [spa, base1, base2, max, value].

const PORTED = [
  [[433, 5, 10, 0, 5], 'Increase Bash Damage Bonus by 5 (v433, Delay Mod)'],
  [[457, 150, 1, 500, 150], 'Return 15% of Spell Damage as Mana, Max Per Hit: 500'],
  [[457, 125, 0, 0, 125], 'Return 12.5% of Spell Damage as HP'],
  [[22, 0, 0, 55, 0], 'Charm up to level 55'],
  [[22, 0, 20, 0, 0], 'Charm with 20% Chance of Memory Blur'],
  [[192, 300, 0, 0, 300], 'Increase Hate by 300'],
  [[63, 0, 0, 0, 30], 'Memory Blur (70% Chance)'],
  [[63, 0, 0, 0, 90], 'Memory Blur (100% Chance)'],
  [[99, 0, 0, 0, 0], 'Root'],
  [[109, 17005, 20, 0, 17005], 'Summon into Bag: [Item 17005] x 20'],
  [[446, 3, 0, 0, 3], 'Buff Blocker A (3)'],
  [[447, 3, 0, 0, 3], 'Buff Blocker B (3)'],
  [[449, 3, 0, 0, 3], 'Buff Blocker D (3)'],
  [[380, 10, 30, 0, 10], "Push Back 30' and Up 10'"],
  [[86, -10, 0, 60, -10], 'Decrease Social Radius to -10 up to level 60'],
  [[455, 50, 0, 0, 50], 'Increase Current Hate by 50%'],
  [[333, 6097, 0, 0, 6097], 'Cast: [Spell 6097] on Rune Fade'],
  [[358, 500, 0, 0, 500], 'Increase Current Mana by 500 (v358)'],
  [[23, 0, 0, 52, 0], 'Fear up to level 52'],
  [[23, 0, 0, 0, 0], 'Fear'],
  [[44, 7, 0, 0, 7], 'Stacking: Delayed Heal Marker (7)'],
  [[451, 20, 3000, 50000, 20], 'Absorb Melee Damage: 20% over 3000, Total: 50000'],
  [[452, 20, 3000, 0, 20], 'Absorb Spell Damage: 20% over 3000'],
  [[442, 6097, 120, 0, 6097], 'Cast: [Spell 6097] once if Undead'],
  [[442, 6097, 7, 0, 6097], 'Cast: [Spell 6097] once if Type 7'],
  [[74, 0, 0, 0, 95], 'Feign Death (95% Chance)'],
  [[74, 0, 0, 0, 100], 'Feign Death'],
  [[154, 500, 1, 0, 500], 'Decrease Detrimental Duration by 50% (50% Chance)'],
  [[154, 500, 0, 70, 500], 'Dispel Detrimental (50% Chance) up to level 70'],
  [[287, 2, 0, 0, 2], 'Increase Duration by 12s (v287)'],
  [[40, 0, 0, 0, 0], 'Invulnerability'],
  [[123, 0, 0, 0, 0], 'Screech'],
  [[198, 250, 0, 0, 250], 'Increase Current Endurance by 250'],
  [[450, 15, 600, 9000, 15], 'Absorb DoT Damage: 15%, Max Per Hit: 600, Total: 9000'],
  [[168, -20, 0, 0, -20], 'Increase Melee Mitigation by 20%'],
  [[330, 50, 8, 0, 50], 'Increase Critical Backstab Damage by 50% of Base Damage'],
  [[431, -16777216 + 0x102030, 0, 0, 0], 'Tint Vision: Red=16 Green=32 Blue=48'],
  [[431, 5, 2, 3, 5], 'Alter Vision: Base1=5 Base2=2 Max=3'],
  [[430, 5, 2, 3, 5], 'Alter Vision: Base1=5 Base2=2 Max=3'],
  [[112, 3, 0, 0, 3], 'Increase Effective Casting Level by 3'],
  [[274, 10, 0, 90, 10], 'Increase Chance to Critical Heal by 10% up to level 90 (lose 100% per level)'],
  [[274, 10, 0, 0, 10], 'Increase Chance to Critical Heal by 10%'],
  [[481, 25, 6097, 0, 25], 'Cast: [Spell 6097] if Hit By Spell (25% Chance)'],
  [[343, 100, 0, 0, 100], 'Interrupt Casting'],
  [[335, 100, 0, 0, 100], 'Block Next Spell'],
  [[280, 7, 0, 0, 7], 'Increase Pet Chance to Flurry by 7%'],
  [[370, 30, 0, 0, 30], 'Increase Corruption Resist by 30'],
  [[157, -10, 0, 0, -10], 'Increase Spell Damage Shield by 10'],
  [[120, 10, 0, 0, 10], 'Increase Healing Taken by 10% (v120, Before Crit)'],
  [[444, 70, 50, 0, 70], 'Lock Aggro on Caster and Decrease Other Aggro by 50% up to level 70'],
  [[467, -100, 0, 0, -100], 'Decrease Damage Shield Taken by 100'],
  [[78, 0, 0, 0, 1200], 'Absorb Spell Damage: 100%, Total: 1200'],
  [[401, 1000, -15, 0, 1000], 'Decrease Current HP by up to 1500 (1.5 HP per 1 Target Mana)'],
  [[400, 1000, 15, 0, 1000], 'Increase Current HP by up to 1500 (1.5 HP per 1 Mana)'],
  [[368, 331, -200, 0, 331], 'Decrease Faction with [Faction 331] by 200'],
  [[453, 6097, 2500, 0, 6097], 'Cast: [Spell 6097] if 2500 Melee Damage Taken in Single Hit'],
  [[466, 5, 0, 0, 5], 'Increase Pet Chance to Flurry on Double Attack by 5%'],
  [[408, 25, 0, 0, 25], 'Cap HP at 25%'],
  [[409, 25, 5000, 0, 25], 'Cap Mana at lowest of 25% or 5000'],
  [[410, 25, 0, 0, 25], 'Cap Endurance at 25%'],
  [[212, 15, 100, 0, 15], 'Increase Chance to Critical DD by 15% and Increase Spell Mana Cost by 100%'],
  [[305, -50, 0, 0, -50], 'Decrease Offhand Damage Shield Taken by 50%'],
  [[305, -50, 0, 1, -50], 'Decrease Offhand Damage Shield Taken by 50'],
  [[386, 6097, 0, 0, 6097], 'Cast: [Spell 6097] on Curer'],
  [[387, 6097, 0, 0, 6097], 'Cast: [Spell 6097] if Cured'],
  [[160, 110, 0, 0, 110], 'Intoxicate if Tolerance under 110'],
  [[469, 100, 42, 0, 100], 'Cast: Highest Rank of [Group 42] (v469)'],
  [[524, 10, 0, 500, 10], 'Increase Current HP by 10% up to 500'],
  [[259, 5, 0, 0, 5], 'Increase AC Soft Cap by 5%'],
  [[24, -10, 0, 0, -10], 'Decrease Stamina Loss by 10'],
  [[122, 4, 0, 0, 0, 25], 'Decrease Abjuration Skill by 25%'],
  [[42, 0, 0, 0, 0], 'Shadowstep'],
  [[510, -20, 0, 0, -20], 'Decrease Incoming Resist Modifier by 20'],
  [[464, 10, 50, 0, 10], 'Increase Pet Chance to Rampage by 10% with 50% Damage'],
  [[367, 3, 0, 0, 3], 'Transform Body Type to Undead'],
  [[460, 0, 0, 0, 0], 'Limit Type: Include Non-Focusable'],
  [[14, 0, 0, 0, 0], 'Enduring Breath'],
  [[441, 30, 0, 0, 30], "Cancel if Moved 30'"],
  [[384, 0, 0, 0, 0], 'Fling to Target'],
  [[266, 20, 2, 0, 20], 'Increase Chance of 2 Additional 2H Attacks by 20%'],
  [[250, 5, 0, 0, 5], 'Increase Melee Proc Rate by 5%'],
  [[357, 0, 0, 0, 0], 'Inhibit Spell Casting'],
  [[478, 100, 0, 0, 100], 'Move to Bottom of Rampage List (100% Chance)'],
  [[393, 10, 20, 0, 10], 'Increase Healing Taken by 10% to 20% (v393)'],
  [[365, 100, 6097, 0, 100], 'Cast: [Spell 6097] on Killshot (100% Chance)'],
  [[105, 0, 0, 0, 0], 'Inhibit Gate'],
  [[513, 250, 0, 0, 250], 'Increase Max Mana by 2.5%'],
  [[514, 250, 0, 0, 250], 'Increase Max Endurance by 2.5%'],
  [[328, 500, 0, 0, 500], 'Increase Max Negative HP by 500'],
  [[243, 50, 0, 0, 50], 'Decrease Chance of Charm Breaking by 50%'],
];

test('every effect ported from the worklist reads as its source line does', () => {
  for (const [[spa, base1, base2, max, value, calc = 100], want] of PORTED)
    assert.equal(phrase({ spa, base1, base2, max, calc }, value, {}), want, `SPA ${spa}`);
});

// --- the lines that print a field of the spell -------------------------------

const EXTRA = [
  [83, 'Teleport to northkarana'],
  [33, 'Summon Pet: PCPetMagS01L005ElemErf'],
  [104, 'Translocate to northkarana'],
  [300, 'Summon Doppelganger: PCPetMagS01L005ElemErf'],
  [71, 'Summon Pet: PCPetMagS01L005ElemErf'],
  [88, 'Evacuate to northkarana'],
  [106, 'Summon Warder: PCPetMagS01L005ElemErf'],
  [145, 'Teleport to northkarana'],
];

test('an effect that names a zone or a pet prints the spell\'s Extra field, verbatim', () => {
  // Portal, Spawn NPC, Translocate, Doppelganger, Create Undead, Combat Portal,
  // the warder and the banish all print Extra as the file has it — a pet token
  // or a zone short name — which is what eqspellparser prints too.
  for (const [spa, want] of EXTRA) {
    const extra = want.split(/[: ]/).pop();
    assert.equal(phrase(slot(spa, 1, 1, 1), 1, {}, { extra }), want, `SPA ${spa}`);
  }
  assert.equal(phrase(slot(306, 5, 0, 90), 5, {}, { extra: 'animateDead28' }),
    'Wake the Dead: animateDead28 x 5 for 90s');
});

test('and says nothing without the spell, or when the spell has no Extra', () => {
  // The set page phrases limiter chips with no spell to hand; these effects never
  // appear there, but a slot without its spell must still fall back honestly.
  // One spell in the file carries a pet slot and an empty Extra, and "Summon
  // Pet: " is not a phrasing.
  for (const [spa] of EXTRA) {
    assert.equal(phrase(slot(spa, 1, 1, 1), 1), null, `SPA ${spa} without a spell`);
    assert.equal(phrase(slot(spa, 1, 1, 1), 1, {}, {}), null, `SPA ${spa} with no extra`);
    assert.equal(phrase(slot(spa, 1, 1, 1), 1, {}, { extra: '' }), null, `SPA ${spa} with an empty extra`);
  }
  // Portal Locations spreads a teleport's co-ordinates over several slots.
  // eqspellparser returns null for it, and so does this, spell or no spell.
  assert.equal(phrase(slot(146, 1, 1, 1), 1, {}, { extra: 'x' }), null);
});
