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
  // Measured against the real spell file this is 99% of slot instances. The set
  // here is the floor: dropping below it should be a deliberate act.
  assert.ok(PHRASED.size >= 420, `only ${PHRASED.size} effects have a phrasing`);
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

test('the anchor teleports name the anchor, by the spell id the source keys them on', () => {
  // SpellTeleport in SpellEnums.cs is three spell ids; FormatEnum turns the
  // underscores into spaces. An id outside the three reads as "Type n", like
  // every other table here, rather than as a guess at which anchor it is.
  assert.equal(phrase(slot(437, 52584), 52584), 'Teleport to your Primary Anchor');
  assert.equal(phrase(slot(437, 50874), 50874), 'Teleport to your Guild Anchor');
  assert.equal(phrase(slot(438, 52585), 52585), 'Teleport to their Secondary Anchor');
  assert.equal(phrase(slot(438, 1), 1), 'Teleport to their Type 1');
});

test('a cap relative to the caster reads signed, and one over 1000 reads as the level', () => {
  // eqspellparser's varmax. The file has all three shapes: Braxi's Panic caps at
  // max 1099, meaning level 99; Presence of Fear at max 3, meaning the caster's
  // level plus three; Braxi's Terror at -1. No max, no clause.
  assert.equal(phrase(slot(502, 6000, 0, 1099), 6000), 'Stun and Fear for 6s up to level 99');
  assert.equal(phrase(slot(502, 1000, 0, 3), 1000), 'Stun and Fear for 1s up to level + 3');
  assert.equal(phrase(slot(502, 6000, 0, -1), 6000), 'Stun and Fear for 6s up to level - 1');
  assert.equal(phrase(slot(502, 4000, 2000, 0), 4000), 'Stun and Fear for 4s (2s in PvP)');
  assert.equal(phrase(slot(381, 6, 0, 3), 6), "Fling to Self (6' away) up to level + 3");
  assert.equal(phrase(slot(381, 5), 5), "Fling to Self (5' away)");
});

// --- the rest of the worklist, down to the single-slot effects -----------------
// The same shape as PORTED, in the order phrasing_todo.mjs listed them, with the
// figures taken from a spell in the file where one shape was not obvious.

const REMAINDER = [
  [[448, 3, 0, 0, 3], 'Buff Blocker C (3)'],
  [[30, -10, 0, 55, -10], 'Decrease Aggro Radius to -10 up to level 55'],
  [[227, 7, 26, 0, 7], 'Decrease Flying Kick Timer by 7s (Before Haste)'],
  [[181, 20, 0, 0, 20], 'Increase Chance to Resist Fear Spell by 20%'],
  [[454, 6097, 5000, 0, 6097], 'Cast: [Spell 6097] if 5000 Spell Damage Taken in Single Hit'],
  [[150, 0, 0, 8000, 0], 'Divine Intervention with 8000 Heal'],
  [[319, 10, 0, 90, 10], 'Increase Chance to Critical HoT by 10% up to level 90 (lose 100% per level)'],
  [[337, 50, 0, 0, 50], 'Increase Experience Gain by 50%'],
  [[474, 20, 0, 0, 20], 'Increase Pet Critical Hit Damage by 20% of Base Damage'],
  [[211, 100, 50, 0, 100], 'Increase Chance to AE Attack by 100% with 50% Damage'],
  [[211, 100, 100, 0, 100], 'Increase Chance to AE Attack by 100%'],
  [[435, 3, 0, 0, 3], 'Fragile Defense (3)'],
  [[379, 20, 0, 0, 20], "Shadowstep Forward 20'"],
  [[210, 5, 0, 0, 5], 'Pet Shielding for 60s'],
  [[18, 0, 0, 0, 0], 'Pacify'],
  [[81, 90, 0, 0, 90], 'Resurrect with 90% XP'],
  [[315, 2, 0, 0, 2], 'Invisibility to Undead (Enhanced 2)'],
  [[315, 1, 0, 0, 1], 'Invisibility to Undead'],
  [[522, 250, 0, 5000, 250], 'Increase Current Mana by 2.5% up to 5000'],
  // 131 stores the conservation as a positive figure; the source negates it after
  // the range swap, so a stored 25 to 50 reads as a decrease of 25% to 50%.
  [[131, 25, 50, 0, 25], 'Decrease Chance of Using Reagent by 25% to 50%'],
  [[131, 25, 25, 0, 25], 'Decrease Chance of Using Reagent by 25%'],
  [[131, -10, 0, 0, -10], 'Increase Chance of Using Reagent by 0% to 10%'],
  [[529, 100060590, 0, 0, 100060590], 'Limit Spell Line: 100060590'],
  [[529, -100060420, 0, 0, -100060420], 'Limit Spell Line: Exclude 100060420'],
  [[378, 50, 23, 0, 50], 'Increase Chance to Resist SPA 23 Effects by 50%'],
  [[67, 0, 0, 0, 0], 'Eye of Zomm'],
  [[505, -250, 0, 0, -250], 'Decrease Rear Arc Melee Damage Taken by 25%'],
  [[505, 250, 1, 0, 250], 'Increase Frontal Arc Melee Damage Taken by 25%'],
  [[312, 0, 0, 0, 0], 'Sanctuary'],
  [[525, 100, 0, 300, 100], 'Increase Current Mana by 1% up to 300'],
  [[526, 100, 0, 300, 100], 'Increase Current Endurance by 1% up to 300'],
  [[206, 500, 0, 0, 500], 'AE Taunt with 500 Hate Mod'],
  [[156, 0, 0, 0, 0], 'Illusion: Target'],
  [[195, 25, 0, 0, 25], 'Increase Chance to Resist Any Stun by 25%'],
  [[402, 1000, -15, 0, 1000], 'Decrease Current HP by up to 1500 (1.5 HP per 1 Target Endurance)'],
  [[523, 250, 0, 5000, 250], 'Increase Current Endurance by 2.5% up to 5000'],
  [[443, 6097, 120, 0, 6097], 'Cast: [Spell 6097] once if Caster Undead'],
  [[205, 1, 0, 0, 1], 'Rampage (1)'],
  [[94, 0, 0, 0, 0], 'Cancel if Combat Initiated'],
  [[164, 0, 0, 0, 50], 'Appraise Chest (50)'],
  [[165, 0, 0, 0, 50], 'Disarm Chest (50)'],
  [[361, 25, 6097, 0, 25], 'Cast: [Spell 6097] on Death (25% Chance)'],
  [[456, 50, 0, 0, 50], 'Increase Current Hate by 50% per tick'],
  [[73, 0, 0, 0, 0], 'Bind Sight'],
  [[82, 0, 0, 0, 0], 'Summon Player'],
  [[218, 5, 0, 0, 5], 'Increase Pet Chance to Critical Hit by 5%'],
  [[334, 300, 0, 0, 300], 'Increase Current HP by 300 (If Target Not Moving)'],
  [[509, 750, -1000, 0, 750], 'Decrease Current HP by 100% of Caster Current HP (75% Life Burn)'],
  [[509, 1000, 1000, 0, 1000], 'Increase Current HP by 100% of Caster Current HP (100% Life Burn)'],
  [[166, 0, 0, 0, 50], 'Unlock Chest (50)'],
  [[268, -10, 59, 0, -10], 'Increase Chance to Fail Alchemy Combine by 10%'],
  [[26, 98, 1, 0, 98], 'Gate (98% Chance)'],
  [[26, 98, 2, 0, 98], 'Gate (98% Chance) to Secondary Bind'],
  [[26, 100, 1, 0, 100], 'Gate'],
  [[518, 500, 0, 0, 500], 'Increase ATK Accuracy by 5%'],
  [[56, 0, 0, 0, 0], 'True North'],
  [[84, 0, 0, 0, 0], 'Gravity Flux'],
  [[321, 500, 0, 0, 500], "Decrease Target's Target Hate by 500"],
  [[29, 0, 0, 0, 0], 'Invisibility to Animals (Unstable)'],
  [[151, 1, 0, 0, 1], 'Suspend Pet with Buffs'],
  [[151, 0, 0, 0, 0], 'Suspend Pet'],
  [[204, 3, 0, 0, 3], 'Group Fear Immunity for 30s'],
  [[527, 500, 0, 0, 500], 'Increase Current HP by 500 (v527, Ignore Mitigation)'],
  [[25, 0, 0, 0, 0], 'Bind'],
  [[353, 1, 0, 0, 1], 'Increase Aura Slots by 1'],
  [[19, 100, 0, 0, 100], 'Increase Faction by 100'],
  [[516, 500, 0, 0, 500], 'Increase Base Mitigation AC by 5%'],
  [[515, 500, 0, 0, 500], 'Increase Base Avoidance AC by 5%'],
  [[233, 50, 0, 0, 50], 'Decrease Food Consumption by 50%'],
  [[222, 10, 0, 0, 10], 'Increase Chance to Block from Back by 10%'],
  [[506, -100, 0, 0, -100], 'Decrease Rear Arc Melee Damage Taken by 100'],
  [[504, 100, 1, 0, 100], 'Increase Frontal Arc Melee Damage by 100'],
  [[299, 0, 0, 60, 0], 'Wake the Dead (60)'],
  [[298, 0, 0, 0, 50], 'Decrease Pet Size by 50%'],
  [[342, 0, 0, 0, 0], 'Inhibit Low Health Fleeing'],
  [[332, 0, 0, 0, 0], 'Summon to Corpse'],
  [[244, 50, 0, 0, 50], 'Decrease Chance of Root Breaking by 50%'],
  [[41, 0, 0, 0, 0], 'Destroy'],
  [[252, 100, 0, 0, 100], 'Increase Chance to Backstab From Front by 100%'],
  [[376, 0, 0, 0, 0], 'Fling'],
  [[28, 0, 0, 0, 0], 'Invisibility to Undead (Unstable)'],
  [[77, 0, 0, 0, 0], 'Locate Corpse'],
  [[103, 0, 0, 0, 0], 'Summon Pet'],
  [[521, 2000, 500, 0, 2000], 'Absorb Damage using Endurance: 20% (0.05 End per 1 HP)'],
  [[521, 1000, 10000, 1500, 1000], 'Absorb Damage using Endurance: 10%, Max Per Hit: 1500'],
  [[531, 10843, 0, 0, 10843], 'Use Graphic, Primary: IT10843'],
  [[531, 103207, 103203, 5, 103207], 'Use Graphic, Primary: IT103207, Secondary: IT103203, Tint: 5'],
  [[290, 10, 0, 0, 10], 'Increase Movement Speed Cap by 10'],
  [[503, 250, 1, 0, 250], 'Increase Frontal Arc Melee Damage by 25%'],
  [[359, 10, 0, 0, 10], 'Increase Chance to Sense Trap by 10%'],
  [[90, 0, 0, 0, 0], 'Ignore Pet'],
  [[52, 0, 0, 0, 0], 'Sense Undead'],
  [[53, 0, 0, 0, 0], 'Sense Summoned'],
  [[76, 0, 0, 0, 0], 'Sentinel'],
  [[61, 0, 0, 0, 0], 'Identify Item'],
  [[93, 0, 0, 0, 0], 'Stop Rain'],
  [[436, 0, 0, 0, 0], 'Toggle: Freeze Buffs'],
  [[203, 0, 0, 0, 0], 'Mass Group Buff on Next Spell'],
  [[331, 25, 0, 0, 25], 'Increase Chance to Salvage Components by 25%'],
  [[407, 6097, 0, 0, 6097], 'Cast: [Spell 6097] if Hit By Spell'],
  [[187, 0, 0, 0, 10], 'Balance Group Mana with 10% Penalty'],
  [[213, 10, 0, 0, 10], 'Increase Pet Max HP by 10%'],
  [[445, 1, 0, 0, 1], 'Grant 1 Mercenary Slots'],
  [[458, 10, 0, 0, 10], 'Increase Faction Hit by 10%'],
  [[309, 0, 0, 0, 0], "Teleport to Caster's Bind"],
  [[224, 10, 37, 0, 10], 'Increase Chance of Additional Riposte with Riposte by 10%'],
  [[468, -10, 0, 0, -10], 'Decrease Damage Shield Taken by 10%'],
  [[488, 50, 0, 0, 50], 'Decrease Push Taken by 50%'],
  [[54, 0, 0, 0, 0], 'Sense Animal'],
  [[68, 0, 0, 0, 0], 'Reclaim Pet Mana'],
  [[75, 0, 0, 0, 0], 'Project Voice'],
  [[102, 0, 0, 0, 0], 'Fear Immunity'],
  [[95, 0, 0, 0, 0], 'Sacrifice'],
  [[117, 0, 0, 0, 0], 'Make Weapon Magical'],
  [[115, 0, 0, 0, 0], 'Reset Hunger Counter'],
  [[207, 0, 0, 0, 0], 'Flesh to Bone Chips'],
  [[226, 0, 0, 0, 0], 'Add Two-Handed Bash Ability'],
  [[246, 10, 0, 0, 10], 'Increase Lung Capacity by 10'],
  [[292, 5, 0, 0, 5], 'Increase Chance of Strikethrough by 5%'],
  [[271, 10, 0, 0, 10], 'Increase Innate Movement Speed by 10%'],
  [[219, 140, 1700, 0, 140], 'Increase Chance to Slay Undead by 1.4% with 1700 Damage Mod'],
  [[260, 0, 51, 0, 2], 'Increase All Bonus by 20%'],
  [[260, 0, 24, 0, 1], 'Increase Strings Bonus by 10%'],
  [[322, 0, 0, 0, 0], 'Gate to Home City'],
  [[472, 1, 0, 0, 1], 'Buy AA Rank (1)'],
  [[338, 0, 0, 0, 0], 'Summon and Resurrect All Corpses'],
  [[265, 70, 0, 0, 70], 'No Fizzle up to level 70'],
  [[307, 0, 0, 0, 0], 'Appraisal'],
  [[388, 0, 0, 0, 0], 'Summon All Corpses (From Any Zone)'],
  [[270, 50, 0, 0, 50], 'Increase Beneficial Song Range by 50'],
];

test('the rest of the worklist reads as its source line does', () => {
  for (const [[spa, base1, base2, max, value, calc = 100], want] of REMAINDER)
    assert.equal(phrase({ spa, base1, base2, max, calc }, value, {}), want, `SPA ${spa}`);
});

test('the resisted effect in 378 is named the way the exact view names it', () => {
  // eqspellparser reads its own SpellEffect enum here. This resolves the number
  // through meta.spa_names, as 137 and 382 do, so the two readings agree.
  assert.equal(phrase(slot(378, 50, 23), 50, { 23: 'Fear' }), 'Increase Chance to Resist Fear Effects by 50%');
});

test('the two lines corrected from the source are the lines it meant', () => {
  // 463 is FormatPercent("Melee Shielding: {0}%", base1) — a format token inside
  // the name, which String.Format never expands, so eqspellparser prints
  // "Increase Melee Shielding: {0}% by 2%". 196 is spelled "Srikethrough" there.
  // Both are documented as deliberate divergences above their case.
  assert.equal(phrase(slot(463, 2), 2), 'Melee Shielding: 2%');
  assert.equal(phrase(slot(196, 1), 1), 'Strikethrough (1)');
});

test('what eqspellparser does not phrase stays unphrased here', () => {
  // 183 is null in the source ("according to prathun this effect does nothing");
  // 34, 352, 354, 355 and 366 have no case there at all; 179 needs the spell's
  // Skill field, which the record does not carry.
  for (const spa of [183, 34, 352, 354, 355, 366, 179])
    assert.equal(phrase(slot(spa, 1, 1, 1), 1, {}, { extra: 'x' }), null, `SPA ${spa}`);
});
