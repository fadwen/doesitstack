// Engine and dataset checks that need the built spell data.
//
// These run only when dist/data exists — that is, on a machine with EverQuest
// installed and `npm run build` already run. Everything that can be checked
// without the game lives in engine.fixtures.test.mjs and claims.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spell, index, byName, META, ROW, SKIP } from './load.mjs';
import { checkStack, checkBoth, isBardSong, isGroupSpell, calcValue, nonCumulativeOverlap } from '../web/engine.js';
import { NON_CUMULATIVE_SPA, MAX_PLAYER_LEVEL } from '../web/spa.js';

const SAVAGE_SPIRIT_17 = 70855;   // Berserker AA "Savage Spirit" rank 17
const PROPHETS_GIFT    = 6273;    // Shaman epic 2.0 click

test('the two effects Jeff asked about land together', SKIP, () => {
  const a = spell(PROPHETS_GIFT), b = spell(SAVAGE_SPIRIT_17);
  const r = checkBoth(a, b);
  assert.equal(r.xThenY.verdict, 'independent');
  assert.equal(r.yThenX.verdict, 'independent');
  // ...but both carry SPA 496, which the game does not add together
  assert.ok(r.nonCumulative.some(x => x.spa === 496),
    'expected the shared non-cumulative crit-damage mod to be flagged');
});

test('a spell always refreshes itself at equal caster level', SKIP, () => {
  const s = spell(PROPHETS_GIFT);
  assert.equal(checkStack(s, s, { levelA: MAX_PLAYER_LEVEL, levelB: MAX_PLAYER_LEVEL }).code, 1);
});

test('a spell cast at a lower level cannot overwrite the same spell', SKIP, () => {
  const s = spell(PROPHETS_GIFT);
  assert.equal(checkStack(s, s, { levelA: MAX_PLAYER_LEVEL, levelB: 60 }).code, -1);
});

test('blank slots (SPA 10 spacers) never create a conflict', SKIP, () => {
  const a = spell(PROPHETS_GIFT);
  // slots 1-9 of Prophet's Gift are SPA 10 spacers
  for (let i = 0; i < 9; i++) assert.equal(a.slots[i].spa, 10);
  const r = checkStack(a, spell(SAVAGE_SPIRIT_17));
  assert.ok(!r.slots.some(s => s.outcome === 'conflict-b-wins'));
});

test('a bard song and a non-song beneficial spell always stack', SKIP, () => {
  const song = spell(700);      // Chant of Battle
  const buff = spell(278);      // Spirit of Wolf
  assert.ok(isBardSong(song) && !isBardSong(buff));
  assert.equal(checkStack(song, buff).rule, 'bard-song');
  assert.equal(checkStack(song, buff).code, 0);
});

test('a snare already in place blocks a run-speed buff', SKIP, () => {
  const sow = spell(278);       // Spirit of Wolf
  const snare = spell(512);     // Ensnare — SPA 3 in the same slot as SoW
  const r = checkStack(snare, sow);
  assert.equal(r.code, -1);
  assert.equal(r.rule, 'snare');
  // the reverse is not symmetric: a snare cast onto an existing SoW just lands
  assert.equal(checkStack(sow, snare).code, 0);
});

test('level formulas evaluate sanely', SKIP, () => {
  const sow = spell(278);
  const i = sow.slots.findIndex(s => s && s.spa === 3);
  assert.ok(calcValue(sow, i, MAX_PLAYER_LEVEL) > 0);
});

test('every spell is self-consistent (no crashes, verdict always set)', SKIP, () => {
  const ids = [3, 278, 28, 1381, 6273, 70855];
  for (const x of ids) for (const y of ids) {
    const r = checkStack(spell(x), spell(y));
    assert.ok(['independent', 'overwrite', 'blocked'].includes(r.verdict));
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  }
});


// --- where an effect comes from --------------------------------------------

test('effects are classified by source', SKIP, () => {
  const kindOf = id => spell(id).kind;
  assert.equal(kindOf(278), 'spell');          // Spirit of Wolf, scribed
  assert.equal(kindOf(700), 'song');           // Chant of Battle, bard
  assert.equal(kindOf(68190), 'discipline');   // Roiling Rage, berserker disc
  assert.equal(kindOf(SAVAGE_SPIRIT_17), 'aa');
  assert.equal(kindOf(PROPHETS_GIFT), 'item'); // shaman epic click — no class can learn it
});

test('an AA-granted effect is marked by its class level of 254', SKIP, () => {
  const s = spell(SAVAGE_SPIRIT_17);
  assert.equal(s.levels[15], 254);             // BER
  assert.ok(s.levels.every(l => l === 255 || l === 254));
});

test('a discipline is a combat skill with a real class level', SKIP, () => {
  const s = spell(68190);
  assert.equal(s.is_skill, true);
  assert.ok(s.levels.some(l => l > 0 && l < 254));
});

test('triggered side effects borrow the class levels of what triggers them', SKIP, () => {
  const s = spell(2463);                       // Siphon Strength Recourse
  assert.equal(s.kind, 'triggered');
  assert.ok(s.levels.every(l => l === 255), 'it has no class levels of its own');
  assert.ok(s.ext_levels && s.ext_levels.some(l => l < 255), 'but it borrows some');
});

test('the search index carries a class mask that matches the level list', SKIP, () => {
  const rows = byName(/^Savage Spirit XVII$/);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(META.kinds[r[ROW.kind]], 'aa');
  assert.equal(r[ROW.classMask], 1 << 15);     // berserker only
  assert.equal(r[ROW.levels], 'BER 254');
});

test('a spell matches a third-party dump of it, field for field', SKIP, () => {
  // Sancus posted Aria of Kenburk Rk. III from his own client. Checking against a
  // reading nobody here produced is the only external confirmation available that
  // the field offsets are right — everything else in this repo shares assumptions.
  const s = spell(71931);
  assert.equal(s.name, 'Aria of Kenburk Rk. III');
  assert.equal(s.levels[7], 126);          // Classes: BRD/126
  assert.equal(s.mana, 373);               // Mana: 373
  assert.equal(s.range, 100);              // Range: 100'
  assert.equal(s.ae_range, 60);            // AE Range: 60'
  assert.equal(s.cast_ms, 3000);           // Casting: 3s
  assert.equal(s.duration, 2);             // Duration: 12s+ (2 ticks)
  assert.equal(META.targets[s.target], 'Caster Group');
  assert.equal(s.beneficial, true);        // Resist: Beneficial
  assert.equal(s.slots.length, 22);        // 22 listed slots

  const at = i => s.slots[i - 1];
  assert.deepEqual([at(1).spa, at(1).base1], [124, 47]);   // 1: Increase Spell Damage by 47% (v124)
  assert.deepEqual([at(2).spa, at(2).base1], [119, 25]);   // 2: Increase Melee Haste by 25% (v119)
  assert.deepEqual([at(4).spa, at(4).base1], [134, 130]);  // 4: Limit Max Level: 130
  assert.deepEqual([at(10).spa, at(10).base1], [364, 40]); // 10: Triple Attack by 40%
  assert.deepEqual([at(11).spa, at(11).base1], [279, 6]);  // 11: Flurry by 6%
  assert.deepEqual([at(12).spa, at(12).base1], [280, 37]); // 12: Pet Flurry by 37%
  assert.deepEqual([at(14).spa, at(14).base1], [302, 8]);  // 14: Increase Spell Damage by 8% (v302)
});

test('target names are the ones players use, not the server enum', SKIP, () => {
  // EQEmu calls target type 3 ST_GroupTeleport; every player-facing source calls it
  // Caster Group, and it is the target type on ordinary group buffs.
  assert.equal(META.targets[3], 'Caster Group');
  assert.equal(spell(71931).target, 3);
});

test('the dataset is built at the level cap', SKIP, () => {
  assert.equal(META.max_level, MAX_PLAYER_LEVEL);
  // Nothing in the file needs a level between the cap and the 250 marker used for
  // special entries — which is what corroborates 130 as the cap.
  const levels = new Set();
  for (const r of index())
    for (const part of r[ROW.levels].split('|'))
      if (part) levels.add(Number(part.split(' ')[1]));
  const between = [...levels].filter(l => l > MAX_PLAYER_LEVEL && l < 250).sort((a, b) => a - b);
  assert.deepEqual(between, [], `unexpected level requirements above the cap: ${between.join(', ')}`);
  assert.ok(levels.has(MAX_PLAYER_LEVEL), 'and spells do exist at the cap itself');
});

test('real spells carry more than twelve slots, and arbitration sees them', SKIP, () => {
  const aria = spell(71931);                       // Aria of Kenburk Rk. III
  assert.equal(aria.slots.length, 22);
  // ranks of one line whose shared effects sit past slot 12
  const a = spell(2740), b = spell(3250);          // Celestial Regeneration I and II
  assert.ok(Math.max(a.slots.length, b.slots.length) > 12);
  assert.notEqual(checkStack(a, b).code, 0, 'two ranks of a line must not read as independent');
});

test('every indexed spell has a known kind', SKIP, () => {
  const kinds = new Set(META.kinds);
  for (const r of index()) assert.ok(kinds.has(META.kinds[r[ROW.kind]]), `bad kind on spell ${r[0]}`);
});


// --- non-cumulative effects -------------------------------------------------

test('the non-cumulative list is what is claimed, not only what EQEmu implements', SKIP, () => {
  // Most of these come from zone/bonuses.cpp keeping the larger magnitude where
  // an ordinary bonus uses +=. 11, 98 and 119 were missed on the first pass —
  // haste is accumulated in a different switch from the damage modifiers, so a
  // reader following those never reaches it, and a raid set with four haste
  // buffs reported that nothing doubled up.
  //
  // SPA 3 is here for the opposite reason: EQEmu *adds* movement speed, and the
  // claim is a player report that contradicts it. The list is every effect
  // claimed to be non-cumulative, whatever the status of that claim, because the
  // site has to raise the overlap before it can say how sure it is.
  assert.deepEqual(NON_CUMULATIVE_SPA, [3, 11, 98, 119, 185, 186, 459, 482, 496, 503, 505]);
});

test('the three haste types are separate buckets, not one', SKIP, () => {
  // Each keeps only its own largest value, but they add to each other — EQEmu
  // calls SPA 98 "Stacks with V1 but does not Overcap". Merging them would turn
  // a spell haste plus a bard haste into a conflict, which is wrong.
  for (const spa of [11, 98, 119]) assert.ok(NON_CUMULATIVE_SPA.includes(spa), `SPA ${spa}`);
  const a = { id: 1, name: 'Spell Haste', slots: [{ spa: 11, base1: 160, base2: 0, calc: 100, max: 0 }], stacking: [] };
  const b = { id: 2, name: 'Bard Haste', slots: [null, { spa: 98, base1: 160, base2: 0, calc: 100, max: 0 }], stacking: [] };
  assert.equal(nonCumulativeOverlap(a, b).length, 0, 'different haste types must not be grouped together');
});

test('SPA 496 is flagged when two stacking buffs both carry it', SKIP, () => {
  const overlap = nonCumulativeOverlap(spell(PROPHETS_GIFT), spell(SAVAGE_SPIRIT_17));
  assert.equal(overlap.length, 1);
  assert.equal(overlap[0].spa, 496);
  assert.equal(overlap[0].slotA, 9);    // slot 10 on the shaman click
  assert.equal(overlap[0].slotB, 1);    // slot 2 on the AA
});

test('an unrelated pair is not flagged as non-cumulative', SKIP, () => {
  assert.equal(nonCumulativeOverlap(spell(278), spell(700)).length, 0);
});
