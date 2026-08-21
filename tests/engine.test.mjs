import test from 'node:test';
import assert from 'node:assert/strict';
import { spell } from './load.mjs';
import { checkStack, checkBoth, isBardSong, isGroupSpell, calcValue, nonCumulativeOverlap } from '../web/engine.js';

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
