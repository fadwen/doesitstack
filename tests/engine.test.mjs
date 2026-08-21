import test from 'node:test';
import assert from 'node:assert/strict';
import { spell, index, byName, META, ROW } from './load.mjs';
import { checkStack, checkBoth, isBardSong, isGroupSpell, calcValue, nonCumulativeOverlap } from '../web/engine.js';
import { NON_CUMULATIVE_SPA } from '../web/spa.js';

const SAVAGE_SPIRIT_17 = 70855;   // Berserker AA "Savage Spirit" rank 17
const PROPHETS_GIFT    = 6273;    // Shaman epic 2.0 click

test('the two effects Jeff asked about land together', () => {
  const a = spell(PROPHETS_GIFT), b = spell(SAVAGE_SPIRIT_17);
  const r = checkBoth(a, b);
  assert.equal(r.xThenY.verdict, 'independent');
  assert.equal(r.yThenX.verdict, 'independent');
  // ...but both carry SPA 496, which the game does not add together
  assert.ok(r.nonCumulative.some(x => x.spa === 496),
    'expected the shared non-cumulative crit-damage mod to be flagged');
});

test('a spell always refreshes itself at equal caster level', () => {
  const s = spell(PROPHETS_GIFT);
  assert.equal(checkStack(s, s, { levelA: 125, levelB: 125 }).code, 1);
});

test('a spell cast at a lower level cannot overwrite the same spell', () => {
  const s = spell(PROPHETS_GIFT);
  assert.equal(checkStack(s, s, { levelA: 125, levelB: 60 }).code, -1);
});

test('blank slots (SPA 10 spacers) never create a conflict', () => {
  const a = spell(PROPHETS_GIFT);
  // slots 1-9 of Prophet's Gift are SPA 10 spacers
  for (let i = 0; i < 9; i++) assert.equal(a.slots[i].spa, 10);
  const r = checkStack(a, spell(SAVAGE_SPIRIT_17));
  assert.ok(!r.slots.some(s => s.outcome === 'conflict-b-wins'));
});

test('a bard song and a non-song beneficial spell always stack', () => {
  const song = spell(700);      // Chant of Battle
  const buff = spell(278);      // Spirit of Wolf
  assert.ok(isBardSong(song) && !isBardSong(buff));
  assert.equal(checkStack(song, buff).rule, 'bard-song');
  assert.equal(checkStack(song, buff).code, 0);
});

test('a snare already in place blocks a run-speed buff', () => {
  const sow = spell(278);       // Spirit of Wolf
  const snare = spell(512);     // Ensnare — SPA 3 in the same slot as SoW
  const r = checkStack(snare, sow);
  assert.equal(r.code, -1);
  assert.equal(r.rule, 'snare');
  // the reverse is not symmetric: a snare cast onto an existing SoW just lands
  assert.equal(checkStack(sow, snare).code, 0);
});

test('level formulas evaluate sanely', () => {
  const sow = spell(278);
  const i = sow.slots.findIndex(s => s && s.spa === 3);
  assert.ok(calcValue(sow, i, 125) > 0);
});

test('every spell is self-consistent (no crashes, verdict always set)', () => {
  const ids = [3, 278, 28, 1381, 6273, 70855];
  for (const x of ids) for (const y of ids) {
    const r = checkStack(spell(x), spell(y));
    assert.ok(['independent', 'overwrite', 'blocked'].includes(r.verdict));
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  }
});


// --- where an effect comes from --------------------------------------------

test('effects are classified by source', () => {
  const kindOf = id => spell(id).kind;
  assert.equal(kindOf(278), 'spell');          // Spirit of Wolf, scribed
  assert.equal(kindOf(700), 'song');           // Chant of Battle, bard
  assert.equal(kindOf(68190), 'discipline');   // Roiling Rage, berserker disc
  assert.equal(kindOf(SAVAGE_SPIRIT_17), 'aa');
  assert.equal(kindOf(PROPHETS_GIFT), 'item'); // shaman epic click — no class can learn it
});

test('an AA-granted effect is marked by its class level of 254', () => {
  const s = spell(SAVAGE_SPIRIT_17);
  assert.equal(s.levels[15], 254);             // BER
  assert.ok(s.levels.every(l => l === 255 || l === 254));
});

test('a discipline is a combat skill with a real class level', () => {
  const s = spell(68190);
  assert.equal(s.is_skill, true);
  assert.ok(s.levels.some(l => l > 0 && l < 254));
});

test('triggered side effects borrow the class levels of what triggers them', () => {
  const s = spell(2463);                       // Siphon Strength Recourse
  assert.equal(s.kind, 'triggered');
  assert.ok(s.levels.every(l => l === 255), 'it has no class levels of its own');
  assert.ok(s.ext_levels && s.ext_levels.some(l => l < 255), 'but it borrows some');
});

test('the search index carries a class mask that matches the level list', () => {
  const rows = byName(/^Savage Spirit XVII$/);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(META.kinds[r[ROW.kind]], 'aa');
  assert.equal(r[ROW.classMask], 1 << 15);     // berserker only
  assert.equal(r[ROW.levels], 'BER 254');
});

test('every indexed spell has a known kind', () => {
  const kinds = new Set(META.kinds);
  for (const r of index()) assert.ok(kinds.has(META.kinds[r[ROW.kind]]), `bad kind on spell ${r[0]}`);
});


// --- non-cumulative effects -------------------------------------------------

test('the non-cumulative list matches what EQEmu treats as highest-wins', () => {
  // zone/bonuses.cpp keeps the larger magnitude for these instead of summing
  assert.deepEqual(NON_CUMULATIVE_SPA, [185, 186, 459, 482, 496, 503, 505]);
});

test('SPA 496 is flagged when two stacking buffs both carry it', () => {
  const overlap = nonCumulativeOverlap(spell(PROPHETS_GIFT), spell(SAVAGE_SPIRIT_17));
  assert.equal(overlap.length, 1);
  assert.equal(overlap[0].spa, 496);
  assert.equal(overlap[0].slotA, 9);    // slot 10 on the shaman click
  assert.equal(overlap[0].slotB, 1);    // slot 2 on the AA
});

test('an unrelated pair is not flagged as non-cumulative', () => {
  assert.equal(nonCumulativeOverlap(spell(278), spell(700)).length, 0);
});
