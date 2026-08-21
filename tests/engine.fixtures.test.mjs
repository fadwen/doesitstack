// Engine behaviour, checked against hand-built fixtures.
// These run anywhere — no EverQuest install, no built dataset.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fx } from './fixtures.mjs';
import { checkStack, checkBoth, isBardSong, isGroupSpell, nonCumulativeOverlap, calcValue } from '../web/engine.js';

test('the same effect in different slots does not conflict', () => {
  const r = checkBoth(fx('prophetsGift'), fx('savageSpirit'));
  assert.equal(r.xThenY.verdict, 'independent');
  assert.equal(r.yThenX.verdict, 'independent');
});

test('but a shared non-cumulative effect is still flagged', () => {
  const o = nonCumulativeOverlap(fx('prophetsGift'), fx('savageSpirit'));
  assert.equal(o.length, 1);
  assert.equal(o[0].spa, 496);
});

test('the weaker rank of a line is refused, the stronger overwrites', () => {
  assert.equal(checkStack(fx('strongBuff'), fx('weakBuff')).code, -1);
  assert.equal(checkStack(fx('weakBuff'), fx('strongBuff')).code, 1);
});

test('a single-target buff will not replace the group version of its line', () => {
  const r = checkStack(fx('groupVersion'), fx('singleVersion'));
  assert.equal(r.code, -1);
  assert.equal(r.rule, 'single-vs-group');
});

test('SPA 148 blocks a weaker effect in the slot it names', () => {
  const weak = fx('weakBuff');            // slot 1 AC 100, below the blocker's 500
  const r = checkStack(fx('blocker'), weak);
  assert.equal(r.code, -1);
  assert.equal(r.rule, 'spa-148');
});

test('a snare already up refuses a run-speed buff, but not the reverse', () => {
  assert.equal(checkStack(fx('ensnare'), fx('spiritOfWolf')).rule, 'snare');
  assert.equal(checkStack(fx('ensnare'), fx('spiritOfWolf')).code, -1);
  assert.equal(checkStack(fx('spiritOfWolf'), fx('ensnare')).code, 0);
});

test('a bard song and a non-song beneficial spell always stack', () => {
  const song = fx('chantOfBattle'), buff = fx('spiritOfWolf');
  assert.ok(isBardSong(song) && !isBardSong(buff));
  assert.equal(checkStack(song, buff).rule, 'bard-song');
});

test('a discipline is not treated as a bard song', () => {
  assert.equal(isBardSong(fx('roilingRage')), false);
});

test('two ranks of one Live stacking group never coexist', () => {
  const r = checkStack(fx('stackGroupLow'), fx('stackGroupHigh'));
  assert.equal(r.rule, 'stacking-group');
  assert.equal(r.code, 1);                                        // the higher rank wins
  assert.equal(checkStack(fx('stackGroupHigh'), fx('stackGroupLow')).code, -1);
});

test('group targeting is recognised', () => {
  assert.ok(isGroupSpell(fx('groupVersion')));
  assert.ok(!isGroupSpell(fx('singleVersion')));
});

test('a spell refreshes itself at equal level but not at a lower one', () => {
  const s = fx('weakBuff');
  assert.equal(checkStack(s, s, { levelA: 125, levelB: 125 }).code, 1);
  assert.equal(checkStack(s, s, { levelA: 125, levelB: 60 }).code, -1);
});

test('level-scaling formulas are applied', () => {
  const s = fx('weakBuff');
  s.slots[0] = { spa: 1, base1: 10, base2: 0, calc: 102, max: 0 };  // base + level
  assert.equal(calcValue(s, 0, 100), 110);
});
