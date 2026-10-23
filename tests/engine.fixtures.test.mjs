// Engine behaviour, checked against hand-built fixtures.
// These run anywhere — no EverQuest install, no built dataset.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fx } from './fixtures.mjs';
import { checkStack, checkBoth, isBardSong, isGroupSpell, isStackableDot, nonCumulativeOverlap, focusOverlap, analyzeSet, limitersOf, calcValue, calcDuration, isEmptySlot, isBlankSlot } from '../web/engine.js';
import { isAuraEffect, classify, SPELL_REF_FIELDS } from '../tools/spells.mjs';
import { FOCUS_CONTESTED, FOCUS_PROC_EXCEPTIONS, FOCUS_BEST_ONLY, IGNORED_BY_CLAIM, MAX_PLAYER_LEVEL } from '../web/spa.js';

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

// --- which value the game keeps ---------------------------------------------
//
// The site colours the slot that applies and the slot that does not. That is a
// claim about the game — but not a second one: every non_cumulative claim already
// asserts which value applies, so the winner is named whatever the confidence and
// `status` carries how firmly the view should say it.

const ncPair = (spaA, valA, spaB, valB) => {
  const a = fx('longSongA'), b = fx('longSongB');
  a.slots[20] = { spa: spaA, base1: valA, base2: -1, calc: 100, max: 0 };
  b.slots[13] = { spa: spaB, base1: valB, base2: -1, calc: 100, max: 0 };
  return nonCumulativeOverlap(a, b)[0];
};

test('a confirmed non-cumulative SPA names the larger value as the one that applies', () => {
  const higherOnB = ncPair(496, 40, 496, 100);
  assert.equal(higherOnB.confirmed, true);
  assert.equal(higherOnB.winner, 'b');
  assert.deepEqual([higherOnB.valueA, higherOnB.valueB], [40, 100]);

  const higherOnA = ncPair(496, 300, 496, 100);
  assert.equal(higherOnA.winner, 'a');
});

test('equal values are a tie, so neither buff is shown as losing out', () => {
  const tied = ncPair(496, 100, 496, 100);
  assert.equal(tied.winner, 'tie');
});

test('an unconfirmed non-cumulative SPA still names the value that applies', () => {
  // It is not a second claim. non-cumulative/185 already asserts which value
  // applies; refusing to say left the tool declining to answer a question its own
  // claim had answered. The confidence is carried on `status` for the view to say.
  const o = ncPair(185, 2, 185, 110);
  assert.equal(o.confirmed, false);
  assert.equal(o.status, 'unverified');
  assert.equal(o.winner, 'b');
  assert.deepEqual([o.valueA, o.valueB], [2, 110]);
});

test('among negatives it is the most negative that applies, not the larger', () => {
  // The rule is "furthest from zero on the side it is already on", which is what
  // EQEmu does. SPA 505 is negative in all 22 of its slots in the current file, so
  // reading it as "the larger" would name the weaker mitigation the winner.
  assert.equal(ncPair(505, -7, 505, -11).winner, 'b');
  assert.equal(ncPair(185, -100, 185, -40).winner, 'a');
});

test('opposite signs name nobody, because the server decides by order', () => {
  // A buff and a debuff of the same effect never displace each other on their own
  // terms — whichever is left standing depends on the order they were applied in.
  assert.equal(ncPair(185, 60, 185, -40).winner, null);
  assert.equal(ncPair(185, 0, 185, 40).winner, null, 'and a zero is not a bonus at all');
});

test('haste is compared after the 100 comes off, so a slow is not a big buff', () => {
  // 168 is a 68% haste and 90 is a 10% slow. Comparing the stored numbers would
  // make every haste beat every slow and call the slow a bonus.
  assert.equal(ncPair(11, 168, 11, 160).winner, 'a');
  assert.equal(ncPair(11, 80, 11, 60).winner, 'b', 'and the deeper slow is the one that lands');
});

test('a slow takes the slot from a haste however small it is', () => {
  // A slow is not a lesser haste. While any slow is applied no haste applies at
  // all, so magnitude does not come into it: a 1% slow beats a 68% haste.
  assert.equal(ncPair(11, 168, 11, 99).winner, 'b');
  assert.equal(ncPair(11, 99, 11, 168).winner, 'a');
  assert.equal(ncPair(119, 25, 119, -1).winner, 'b');
  // Only where a claim says so. Everywhere else opposite signs still name nobody.
  assert.equal(ncPair(185, 60, 185, -40).winner, null);
});

test('the winner is decided at the caster levels asked about, not the cap', () => {
  const a = fx('longSongA'), b = fx('longSongB');
  // calc 102 scales with level, so who wins depends on the levels supplied
  a.slots[20] = { spa: 496, base1: 10, base2: -1, calc: 102, max: 0 };
  b.slots[13] = { spa: 496, base1: 10, base2: -1, calc: 102, max: 0 };
  assert.equal(nonCumulativeOverlap(a, b, { levelA: 130, levelB: 100 })[0].winner, 'a');
  assert.equal(nonCumulativeOverlap(a, b, { levelA: 100, levelB: 130 })[0].winner, 'b');
  assert.equal(nonCumulativeOverlap(a, b)[0].winner, 'tie', 'both default to the cap');
});

test('checkBoth passes the caster levels through to the non-cumulative check', () => {
  const a = fx('longSongA'), b = fx('longSongB');
  a.slots[20] = { spa: 496, base1: 10, base2: -1, calc: 102, max: 0 };
  b.slots[13] = { spa: 496, base1: 10, base2: -1, calc: 102, max: 0 };
  const r = checkBoth(a, b, { levelX: 130, levelY: 100 });
  assert.equal(r.nonCumulative[0].winner, 'a');
  assert.equal(r.nonCumulative[0].valueA > r.nonCumulative[0].valueB, true);
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
  assert.equal(checkStack(s, s, { levelA: MAX_PLAYER_LEVEL, levelB: MAX_PLAYER_LEVEL }).code, 1);
  assert.equal(checkStack(s, s, { levelA: MAX_PLAYER_LEVEL, levelB: 60 }).code, -1);
});

test('level-scaling formulas are applied', () => {
  const s = fx('weakBuff');
  s.slots[0] = { spa: 1, base1: 10, base2: 0, calc: 102, max: 0 };  // base + level
  assert.equal(calcValue(s, 0, 100), 110);
});


// --- focus effects ----------------------------------------------------------

test('a focus SPA on the ignore list never causes a conflict', () => {
  const r = checkStack(fx('focusIgnoredA'), fx('focusIgnoredB'));
  assert.equal(r.code, 0);
  assert.equal(r.contestedFocus, null);
});

test('a focus SPA the claim covers is exempt, so two twincast buffs both hold', () => {
  // The focus stacking claim is corroborated, so 399 is exempted rather than
  // arbitrated — the verdict changes because the evidence did, not because the
  // engine was special-cased.
  assert.ok(IGNORED_BY_CLAIM.includes(399), 'the claim should exempt FcTwincast');
  assert.equal(FOCUS_CONTESTED.length, 0, 'nothing is left contested while the claim is acted on');

  const r = checkStack(fx('twincastB'), fx('twincastA'));   // stronger already up
  assert.equal(r.code, 0, 'they stack');
  assert.equal(r.contestedFocus, null, 'and there is nothing left to doubt');
});

test('two stacking twincast buffs are still reported as best-only', () => {
  // "Twincast does not stack" is about the effect, not the buffs: both hold, but
  // only the best twincast chance applies to a cast.
  const o = focusOverlap(fx('twincastA'), fx('twincastB'));
  assert.deepEqual(o.bestOnly.map(f => f.spa), [399]);
});

test('an ordinary conflict is not flagged as contested focus', () => {
  const r = checkStack(fx('strongBuff'), fx('weakBuff'));
  assert.equal(r.code, -1);
  assert.equal(r.contestedFocus, null);
});

test('a focus limiter is never reported as a focus that competes', () => {
  // FOCUS_SPA unions Daybreak's Fc_ and Ff_ prefixes, so the best-only list swept
  // up the Ff_ limiters — and "both carry Ff_LevelMax, only the best applies" is
  // meaningless. A limiter does not apply to a cast; it restricts the focus
  // sitting beside it. Two spells sharing only a limiter compete over nothing.
  const withLimiter = (id, name, focusSpa) => ({
    id, name, beneficial: true, target: 5, duration: 100, dur_calc: 7, dur_cap: 0,
    is_skill: false, song_window: false, unstackable_dot: false, timer: 0,
    levels: new Array(16).fill(255), stacking: [], categories: [],
    slots: [
      { spa: focusSpa, base1: 10, base2: 0, calc: 100, max: 0 },
      { spa: 134, base1: 60, base2: 0, calc: 100, max: 0 },   // Ff_LevelMax
      { spa: 142, base1: 5, base2: 0, calc: 100, max: 0 },    // Ff_LevelMin
    ],
  });
  const a = withLimiter(1, 'A', 124), b = withLimiter(2, 'B', 125);
  assert.deepEqual(focusOverlap(a, b).bestOnly.map(f => f.spa), [],
    'they share two limiters and no actual focus, so nothing is best-only');

  // and a genuinely shared focus is still caught, limiters or not
  const c = withLimiter(3, 'C', 124);
  assert.deepEqual(focusOverlap(a, c).bestOnly.map(f => f.spa), [124]);
});

test('shared best-only foci are reported so the numbers are not assumed to add', () => {
  const o = focusOverlap(fx('focusIgnoredA'), fx('focusIgnoredB'));
  assert.deepEqual(o.bestOnly.map(f => f.spa), [286]);
  assert.equal(o.procs.length, 0);
});

test('proc-type foci are reported separately, since they all fire', () => {
  const o = focusOverlap(fx('procFocusA'), fx('procFocusB'));
  assert.deepEqual(o.procs.map(f => f.spa), [383]);
  assert.equal(o.bestOnly.length, 0);
});

test('the proc exceptions are exactly the three trigger SPAs', () => {
  assert.deepEqual([...FOCUS_PROC_EXCEPTIONS].sort((a, b) => a - b), [339, 340, 383]);
  for (const spa of FOCUS_PROC_EXCEPTIONS) assert.ok(!FOCUS_BEST_ONLY.includes(spa));
});

test('checkBoth surfaces the focus overlap alongside the verdicts', () => {
  const r = checkBoth(fx('focusIgnoredA'), fx('focusIgnoredB'));
  assert.ok(r.focus);
  assert.equal(r.focus.bestOnly.length, 1);
});


// --- spells with more than twelve slots -------------------------------------

test('a conflict past slot 12 is still found', () => {
  const a = fx('longSongA'), b = fx('longSongB');
  assert.equal(a.slots.length, 16);
  assert.ok(a.slots.slice(0, 12).every((s, i) => s.spa !== b.slots[i].spa),
    'the first twelve slots must not conflict, or the test proves nothing');

  const r = checkStack(a, b);          // b is stronger at slot 16
  assert.equal(r.code, 1, 'slot 16 should decide this');
  assert.equal(r.decidedBy, 1);
  assert.equal(checkStack(b, a).code, -1);
});

test('a twelve-slot view of the same pair would miss it', () => {
  const trunc = sp => ({ ...sp, slots: sp.slots.slice(0, 12) });
  assert.equal(checkStack(trunc(fx('longSongA')), trunc(fx('longSongB'))).code, 0);
});

test('non-cumulative overlap is found past slot 12 too', () => {
  const a = fx('longSongA'), b = fx('longSongB');
  a.slots[20] = { spa: 496, base1: 100, base2: -1, calc: 100, max: 0 };
  b.slots[13] = { spa: 496, base1: 300, base2: -1, calc: 100, max: 0 };
  const o = nonCumulativeOverlap(a, b);
  assert.equal(o.length, 1);
  assert.equal(o[0].slotA, 20);
  assert.equal(o[0].slotB, 13);
});


// --- caster level -----------------------------------------------------------

test('the level cap is 130 and is the default everything is answered at', () => {
  assert.equal(MAX_PLAYER_LEVEL, 130);

  // Unstated caster levels use the cap, so an unqualified answer is the max-level one.
  const s = fx('weakBuff');
  s.slots[0] = { spa: 1, base1: 10, base2: 0, calc: 102, max: 0 };   // base + level
  assert.equal(calcValue(s, 0), 10 + MAX_PLAYER_LEVEL);
  assert.equal(calcValue(s, 0, 100), 110);
});

test('a spell recast at the cap still refreshes over one cast below it', () => {
  const s = fx('weakBuff');
  assert.equal(checkStack(s, s, { levelA: MAX_PLAYER_LEVEL - 5, levelB: MAX_PLAYER_LEVEL }).code, 1);
  assert.equal(checkStack(s, s, { levelA: MAX_PLAYER_LEVEL, levelB: MAX_PLAYER_LEVEL - 5 }).code, -1);
});


// --- the full 100-slot range ------------------------------------------------

test('a spell may carry 100 slots and every one is arbitrated', () => {
  const a = fx('hundredSlotA'), b = fx('hundredSlotB');
  assert.equal(a.slots.length, 100);
  assert.equal(b.slots.length, 100);

  // they share nothing until the hundredth
  for (let i = 0; i < 99; i++) assert.notEqual(a.slots[i].spa, b.slots[i].spa);

  const r = checkStack(a, b);
  assert.equal(r.code, 1, 'slot 100 should decide it');
  assert.equal(r.decidedBy, 1);
  assert.equal(checkStack(b, a).code, -1);

  // and the conflict is reported against the right slot index
  const row = r.slots.find(s => s.outcome === 'conflict-b-wins');
  assert.equal(row.slot, 99);
});

test('a stacking command can name a slot beyond the old twelve-slot range', () => {
  const a = fx('hundredSlotA');
  // SPA 148: block anything whose slot 100 is SPA 1 below 500
  a.slots[50] = { spa: 148, base1: 1, base2: 100, calc: 100, max: 500 };
  const r = checkStack(a, fx('hundredSlotB'));   // slot 100 is AC 400, under the bar
  assert.equal(r.code, -1);
  assert.equal(r.rule, 'spa-148');
});

test('non-cumulative overlap is found anywhere in the 100', () => {
  const a = fx('hundredSlotA'), b = fx('hundredSlotB');
  a.slots[97] = { spa: 496, base1: 100, base2: -1, calc: 100, max: 0 };
  b.slots[4]  = { spa: 496, base1: 300, base2: -1, calc: 100, max: 0 };
  const o = nonCumulativeOverlap(a, b);
  assert.equal(o.length, 1);
  assert.deepEqual([o[0].slotA, o[0].slotB], [97, 4]);
});


// --- a whole set, not a pair ------------------------------------------------
//
// The set view exists because some facts are about the set: four buffs each
// carrying the same best-only focus is not visible from any pair inside it.

const setSpell = (id, name, spas) => ({
  id, name, beneficial: true, target: 5, duration: 100, dur_calc: 7, dur_cap: 0,
  is_skill: false, song_window: false, unstackable_dot: false, timer: 0,
  levels: new Array(16).fill(255), stacking: [], categories: [],
  slots: spas.map(s => typeof s === 'number'
    ? { spa: s, base1: 10, base2: 0, calc: 100, max: 0 }
    : { spa: s[0], base1: s[1], base2: 0, calc: 100, max: 0 }),
});

test('a set with nothing in common all holds', () => {
  const r = analyzeSet([setSpell(1, 'A', [1]), setSpell(2, 'B', [2]), setSpell(3, 'C', [4])]);
  assert.equal(r.count, 3);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.allHold, true);
});

test('a conflicting pair inside a set is named, with both directions', () => {
  // same SPA in the same slot: the stronger overwrites, the weaker is refused
  const weak = setSpell(1, 'Weak', [[1, 10]]), strong = setSpell(2, 'Strong', [[1, 99]]);
  const r = analyzeSet([weak, strong, setSpell(3, 'Other', [2])]);
  assert.equal(r.allHold, false);
  assert.equal(r.conflicts.length, 1, 'only the one pair, not everything downstream of it');
  const c = r.conflicts[0];
  assert.deepEqual([c.aName, c.bName], ['Weak', 'Strong']);
  assert.notEqual(c.aThenB.verdict, 'independent');
  assert.ok(c.aThenB.reason);
});

test('coexistence is pairwise, so the set scales without new rules', () => {
  // The game checks an incoming spell against each existing buff on its own, so
  // three mutually-compatible buffs hold — there is no emergent three-way rule.
  const a = setSpell(1, 'A', [1]), b = setSpell(2, 'B', [2]), c = setSpell(3, 'C', [4]);
  for (const [x, y] of [[a, b], [a, c], [b, c]]) {
    assert.equal(checkStack(x, y).verdict, 'independent');
    assert.equal(checkStack(y, x).verdict, 'independent');
  }
  assert.equal(analyzeSet([a, b, c]).allHold, true);
});

test('an effect several buffs carry is grouped across the whole set', () => {
  // four spells each carrying SPA 124, in different slots — invisible pairwise
  const set = [
    setSpell(1, 'One', [1, [124, 10]]),
    setSpell(2, 'Two', [2, 3, [124, 40]]),
    setSpell(3, 'Three', [4, 5, 6, [124, 25]]),
    setSpell(4, 'Unrelated', [7]),
  ];
  const g = analyzeSet(set).focusBestOnly;
  assert.equal(g.length, 1);
  assert.equal(g[0].spa, 124);
  assert.deepEqual(g[0].members.map(m => m.name), ['One', 'Two', 'Three']);
  assert.equal(g[0].coexist, true, 'all three can be up together, so all three really do compete');
});

test('a focus limiter is never reported as a focus that competes', () => {
  // FOCUS_SPA unions Daybreak's Fc_ and Ff_ prefixes, so the best-only list used
  // to pick up limiters — and "only the best Ff_LevelMax applies" is meaningless.
  // A limiter does not apply to a cast; it restricts the focus beside it.
  const a = setSpell(1, 'A', [[124, 10], [134, 60]]);
  const b = setSpell(2, 'B', [[125, 10], [134, 65]]);
  assert.deepEqual(focusOverlap(a, b).bestOnly.map(f => f.spa), [],
    'they share only a limiter, so nothing competes');
  assert.deepEqual(analyzeSet([a, b]).focusBestOnly.map(g => g.spa), []);
});

test('a focus carries its limiters, so a reader can see whether two really compete', () => {
  const a = setSpell(1, 'A', [[124, 10], [134, 60], [142, 5]]);
  assert.deepEqual(limitersOf(a).map(l => l.spa), [134, 142]);
  const g = analyzeSet([a, setSpell(2, 'B', [[124, 20]])]).focusBestOnly[0];
  assert.equal(g.members[0].limiters.length, 2);
  assert.equal(g.members[1].limiters.length, 0);
});

test('a group whose members cannot all be up says so', () => {
  // two of the three fight over slot 1, so they never actually compete on the focus
  const set = [
    setSpell(1, 'Weak', [[1, 10], [124, 10]]),
    setSpell(2, 'Strong', [[1, 99], [124, 40]]),
    setSpell(3, 'Third', [2, [124, 25]]),
  ];
  const r = analyzeSet(set);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.focusBestOnly[0].coexist, false);
});

test('a confirmed non-cumulative effect names which member applies, across the set', () => {
  const set = [
    setSpell(1, 'Low', [1, [496, 40]]),
    setSpell(2, 'High', [2, [496, 100]]),
    setSpell(3, 'Mid', [4, [496, 70]]),
  ];
  const g = analyzeSet(set).nonCumulative[0];
  assert.equal(g.spa, 496);
  assert.equal(g.confirmed, true);
  assert.deepEqual(g.members.map(m => [m.name, m.applies]), [['Low', false], ['High', true], ['Mid', false]]);
});

test('an unverified non-cumulative effect still names the one that applies', () => {
  const set = [setSpell(1, 'A', [1, [185, 40]]), setSpell(2, 'B', [2, [185, 100]])];
  const g = analyzeSet(set).nonCumulative[0];
  assert.equal(g.confirmed, false);
  assert.equal(g.status, 'unverified');
  assert.deepEqual(g.members.map(m => m.applies), [false, true]);
});

test('a set holding both a buff and a debuff of one effect names nobody', () => {
  const set = [setSpell(1, 'A', [1, [185, 60]]), setSpell(2, 'B', [2, [185, -40]])];
  const g = analyzeSet(set).nonCumulative[0];
  assert.equal(g.mixed, true);
  assert.deepEqual(g.members.map(m => m.applies), [null, null]);
});

test('proc-type foci are reported apart, because they all do fire', () => {
  const set = [setSpell(1, 'A', [[383, 10]]), setSpell(2, 'B', [[383, 20]])];
  const r = analyzeSet(set);
  assert.deepEqual(r.focusProcs.map(g => g.spa), [383]);
  assert.deepEqual(r.focusBestOnly.map(g => g.spa), [], 'and not counted as competing');
});

test('the set view never scores a set', () => {
  // Ranking sets by damage needs a bonus-bucket model resting on seven unverified
  // claims. If this ever grows a score, that decision needs its own evidence.
  const r = analyzeSet([setSpell(1, 'A', [[124, 10]]), setSpell(2, 'B', [[124, 90]])]);
  for (const key of ['score', 'rank', 'dps', 'best', 'total'])
    assert.equal(key in r, false, `analyzeSet must not return a "${key}"`);
});

test('an empty or single-spell set is not an error', () => {
  assert.equal(analyzeSet([]).allHold, true);
  assert.equal(analyzeSet([setSpell(1, 'Alone', [1, 1])]).focusBestOnly.length, 0);
});


// --- auras ------------------------------------------------------------------
//
// An aura effect holds while the aura applying it holds, which duration formula
// 51 expresses by giving no tick count at all. Read naively that is "instant",
// which hid every aura behind the "only effects with a duration" filter — the
// exact thing a raid stands in.

test('the aura duration formula yields no tick count, and says so rather than guessing', () => {
  // Not folded into formula 50: claiming 72000 ticks would invent a duration the
  // file does not give. Callers are meant to read the aura flag instead.
  assert.equal(calcDuration(51, 0, 130), 0);
  assert.equal(calcDuration(50, 0, 130), 72000, 'the real permanent formula is unchanged');
});

test('an aura effect is recognised by its duration formula', () => {
  assert.equal(isAuraEffect({ dur_calc: 51 }), true);
  assert.equal(isAuraEffect({ dur_calc: 50 }), false);
  assert.equal(isAuraEffect({ dur_calc: 0 }), false);
});

test('an aura is linked to the effect it applies', () => {
  // Spawn Interactive Object carries the applied spell in `max`, unlike every
  // other reference SPA which uses a base field. Missing that left the effect an
  // orphan with no class levels, so no class search could reach it.
  assert.deepEqual(SPELL_REF_FIELDS[351], ['max']);
});


// --- disciplines the level table forgot ---------------------------------------
//
// classify() only reached 'discipline' via the scribed check, so a combat skill
// with no class level recorded fell all the way through to the residual — and
// the site called something the spell file plainly labels a discipline
// "Unattributed". 120 rows were in that state.

const skill = (o) => ({
  id: 1, name: 'Berserking Discipline', pcnpc: 0, is_skill: true, dur_calc: 0,
  levels: new Array(16).fill(255), ...o,
});

test('a combat skill with no class level is still a discipline', () => {
  assert.equal(classify(skill({}), new Set()), 'discipline');
});

test('a combat skill a class actually learns is unaffected', () => {
  const lv = new Array(16).fill(255); lv[15] = 75;      // BER 75
  assert.equal(classify(skill({ levels: lv }), new Set()), 'discipline');
});

test('anything that already had an explanation keeps it', () => {
  // The flag is a last resort, not an override: a discipline something else
  // accounts for should still say what accounts for it.
  assert.equal(classify(skill({ id: 7 }), new Set([7])), 'triggered');
  assert.equal(classify(skill({ pcnpc: 2 }), new Set()), 'npc');
  assert.equal(classify(skill({ dur_calc: 51 }), new Set()), 'aura');
});

test('a spell that is not a combat skill still falls to the residual', () => {
  assert.equal(classify(skill({ is_skill: false }), new Set()), 'item',
    'provisional — applyItemSources turns an unexplained one into "other"');
});


// --- haste ------------------------------------------------------------------
//
// Reported from the shipped "Common level 130 buffs" set: four of its buffs
// carry SPA 11 in different slots, all four hold, and the set view said nothing
// doubled up. Haste is the effect every EverQuest player knows does not add.

test('several haste buffs in different slots are reported as not adding', () => {
  const haste = (id, name, slot, base1) => {
    const slots = new Array(slot).fill(null);
    slots[slot] = { spa: 11, base1, base2: 0, calc: 100, max: 0 };
    return { id, name, beneficial: true, target: 5, duration: 100, dur_calc: 7, dur_cap: 0,
             is_skill: false, song_window: false, unstackable_dot: false, timer: 0,
             levels: new Array(16).fill(255), stacking: [], categories: [], slots };
  };
  const set = [
    haste(1, 'Symphony of Battle', 9, 160),
    haste(2, 'Celeritous Unity', 0, 160),
    haste(3, 'Hastening of Elluria', 4, 168),
    haste(4, 'Illusion Benefit Greater Jann', 2, 150),
  ];
  const r = analyzeSet(set);
  assert.equal(r.allHold, true, 'different slots, so they do all hold');
  const g = r.nonCumulative.find(x => x.spa === 11);
  assert.ok(g, 'and the set view must say that only one of them counts');
  assert.equal(g.members.length, 4);
  assert.equal(g.coexist, true);
  // The set this preset ships: four haste buffs, and Hastening of Elluria at 168
  // is a 68% bonus against 60, 60 and 50. It holds with the other three and they
  // do nothing, which is the whole point of showing the set.
  assert.equal(g.status, 'corroborated', 'a named practitioner reported it, so it is said out loud');
  const applies = Object.fromEntries(g.members.map(m => [m.name, m.applies]));
  assert.deepEqual(applies, {
    'Symphony of Battle': false,
    'Celeritous Unity': false,
    'Hastening of Elluria': true,
    'Illusion Benefit Greater Jann': false,
  });
});

test('a spell haste and a bard haste are left alone', () => {
  // They really do add: EQEmu accumulates them into separate fields.
  const mk = (id, spa, slot) => {
    const slots = new Array(slot).fill(null);
    slots[slot] = { spa, base1: 160, base2: 0, calc: 100, max: 0 };
    return { id, name: `haste ${spa}`, beneficial: true, target: 5, duration: 100, dur_calc: 7,
             dur_cap: 0, is_skill: false, song_window: false, unstackable_dot: false, timer: 0,
             levels: new Array(16).fill(255), stacking: [], categories: [], slots };
  };
  const r = analyzeSet([mk(1, 11, 0), mk(2, 98, 3), mk(3, 119, 5)]);
  assert.deepEqual(r.nonCumulative, [], 'three different haste types share nothing');
});


// --- rows worth drawing -----------------------------------------------------

test('a stacking blocker is never treated as an empty row', () => {
  // isBlankSlot includes 148 and 149 because they take no part in arbitration.
  // isEmptySlot must not, or tidying the display would delete the single most
  // informative row in a slot table — 1,448 slots in the file carry SPA 148.
  const sp = { id: 1, name: 'Blocker', slots: [
    { spa: 148, base1: 1, base2: 2, calc: 100, max: 500 },
    { spa: 149, base1: 1, base2: 2, calc: 100, max: 500 },
  ] };
  assert.equal(isEmptySlot(sp, 0), false);
  assert.equal(isEmptySlot(sp, 1), false);
  assert.equal(isBlankSlot(sp, 0), true, 'still invisible to arbitration, which is a different question');
});

test('only the client spacer counts as an empty row', () => {
  const sp = { id: 1, name: 'Mixed', slots: [
    { spa: 10, base1: 0, base2: 0, calc: 100, max: 0 },    // the spacer
    { spa: 10, base1: 40, base2: 0, calc: 100, max: 0 },   // real charisma
    { spa: 10, base1: -30, base2: 0, calc: 100, max: 0 },  // a charisma debuff
    { spa: 10, base1: 0, base2: 0, calc: 3000, max: 0 },   // base 0 but a scaling formula
    { spa: 1, base1: 0, base2: 0, calc: 100, max: 0 },     // some other effect at zero
  ] };
  assert.equal(isEmptySlot(sp, 0), true);
  assert.equal(isEmptySlot(sp, 1), false);
  assert.equal(isEmptySlot(sp, 2), false, 'a debuff is not an empty row');
  assert.equal(isEmptySlot(sp, 3), false, 'a formula that is not the flat one may do something');
  assert.equal(isEmptySlot(sp, 4), false, 'value zero is not the test — 39% of slots compute to zero');
});

test('a missing slot is empty', () => {
  assert.equal(isEmptySlot({ id: 1, slots: [null] }, 0), true);
  assert.equal(isEmptySlot({ id: 1, slots: [] }, 3), true);
});

test('a set holding a slow and hastes marks the slow, not the biggest haste', () => {
  const set = [
    setSpell(1, 'Hastening', [1, [11, 168]]),
    setSpell(2, 'Symphony', [2, [11, 160]]),
    setSpell(3, 'Cripple', [3, [11, 75]]),
  ];
  const g = analyzeSet(set).nonCumulative.find(x => x.spa === 11);
  assert.equal(g.mixed, false, 'there is an answer here, so it is not the no-answer case');
  assert.deepEqual(g.members.map(m => m.applies), [false, false, true]);
});

test('two slows keep the deepest, because 371 stores the slow as a positive', () => {
  // The sign convention is inverted against everything else here: a bigger number
  // is a worse slow, so "furthest from zero" is the one that lands on you.
  assert.equal(ncPair(371, 40, 371, 80).winner, 'b');
  const set = [setSpell(1, 'Weak', [1, [371, 30]]), setSpell(2, 'Deep', [2, [371, 80]])];
  const g = analyzeSet(set).nonCumulative.find(x => x.spa === 371);
  assert.equal(g.status, 'corroborated');
  assert.deepEqual(g.members.map(m => m.applies), [false, true]);
});


// --- the rules the same-spell branch carves out --------------------------------

test('Mana Burn is refused under its own rule, not the same-spell one', () => {
  // The dedicated branch is the one with a claim behind it; a same-spell verdict
  // would cite the wrong claim.
  const r = checkStack(fx('manaBurn'), fx('manaBurn'));
  assert.equal(r.code, -1);
  assert.equal(r.rule, 'mana-burn');
});

test('Eye of Zomm will not re-land while it is up', () => {
  const r = checkStack(fx('eyeOfZomm'), fx('eyeOfZomm'));
  assert.equal(r.code, -1);
  assert.equal(r.rule, 'same-spell');
});

test('Improved Taunt is exempt from the same-spell level check', () => {
  const r = checkStack(fx('improvedTaunt'), fx('improvedTaunt'), { levelA: 100, levelB: 60 });
  assert.equal(r.code, 1, 'a lower-level recast still overwrites');
  assert.equal(r.rule, 'same-spell');
});

test('a snare is not a stackable DoT, so a lower-level recast is refused', () => {
  // IsStackableDOT needs a Current HP (or Gravity) effect in the spell. A snare is
  // detrimental and has a duration, which was enough for the old test — and let a
  // weaker recast "overwrite" instead of being held to the level check.
  assert.equal(isStackableDot(fx('snare')), false);
  assert.equal(checkStack(fx('snare'), fx('snare'), { levelA: 100, levelB: 60 }).code, -1);
  assert.equal(isStackableDot(fx('dotA')), true);
});


// --- slot rules with no fixture until now -------------------------------------

test('Complete Heal never stacks or overwrites', () => {
  // Two different Complete Heal spells: the same one would stop at the
  // same-spell branch first.
  const r = checkStack(fx('completeHeal'), fx('completeHealB'));
  assert.equal(r.code, -1);
  assert.equal(r.rule, 'complete-heal');
});

test('two different DoTs in the same slot both run', () => {
  assert.equal(checkStack(fx('dotA'), fx('dotB')).code, 0);
  assert.equal(checkStack(fx('dotB'), fx('dotA')).code, 0);
});

test('a DoT does not overwrite regeneration, and a running DoT blocks it', () => {
  assert.equal(checkStack(fx('regen'), fx('dotA')).code, 0, 'the DoT lands beside the regen');
  const r = checkStack(fx('dotA'), fx('regen'));
  assert.equal(r.code, -1);
  assert.equal(r.rule, 'dot-blocks-regen');
});

test('SPA 149 overwrites a weaker effect in the slot it names', () => {
  const r = checkStack(fx('weakBuff'), fx('overwriter'));   // slot 1 AC 100, below 500
  assert.equal(r.code, 1);
  assert.equal(r.rule, 'spa-149');
  assert.equal(checkStack(fx('blocker'), fx('overwriter')).rule, 'spa-149', 'the overwrite command is checked before the block');
});

test('a detrimental spell ignores SPA 148', () => {
  // Live change, 2018. The blocker names slot 1 AC below 500; the debuff has -100
  // there and would be blocked if it were a buff.
  const r = checkStack(fx('blocker'), fx('acDebuff'));
  assert.notEqual(r.rule, 'spa-148');
  assert.equal(r.slots.find(s => s.kind === 'block-command').outcome, 'no-effect');
});

test('a negative AC effect is skipped in arbitration', () => {
  const r = checkStack(fx('acBuff'), fx('acDebuff'));
  assert.equal(r.code, 0);
  assert.equal(r.slots[0].outcome, 'no-conflict');
});

test('the bard-only AE DoT effect is exempt between two bards', () => {
  const r = checkStack(fx('bardDotA'), fx('bardDotB'));
  assert.equal(r.code, 0);
  assert.match(r.slots[0].detail, /bard-only AE DoT/);
});

test('haste is compared after the 100 comes off in arbitration too', () => {
  // 125 vs 168 stored: a 25% haste against a 68% one. The weaker is refused, and
  // the slot row shows the bonuses, not the stored percentages.
  const r = checkStack(fx('hasteBig'), fx('hasteSmall'));
  assert.equal(r.code, -1);
  assert.deepEqual([r.slots[0].valueA, r.slots[0].valueB], [68, 25]);
});

test('a type 6 stacking group is never overwritten, whatever the rank', () => {
  // eqspellparser's reading of SpellStackingGroups.txt: "new procs won't overwrite
  // old ones that are still active". A higher rank used to get through.
  const r = checkStack(fx('nonOverrideLow'), fx('nonOverrideHigh'));
  assert.equal(r.code, -1);
  assert.equal(r.rule, 'stacking-group');
  assert.equal(checkStack(fx('nonOverrideHigh'), fx('nonOverrideLow')).code, -1);
});


// --- the pair and set views agree -------------------------------------------

test('a bard song and a buff sharing haste in the same slot are a real overlap', () => {
  // Both land by the bard-song rule, so the same-index skip that is right for
  // ordinary slot arbitration is wrong here. The set view had no index to skip
  // on and already reported one group; the pair view reported nothing.
  const song = fx('hasteSong'), buff = fx('hasteSmall');
  assert.equal(checkStack(song, buff).rule, 'bard-song');
  const o = nonCumulativeOverlap(song, buff);
  assert.equal(o.length, 1);
  assert.deepEqual([o[0].slotA, o[0].slotB], [0, 0]);
  assert.equal(analyzeSet([song, buff]).nonCumulative.length, 1);
});

test('the same SPA at the same index on two ordinary buffs is still the slot\'s business', () => {
  assert.equal(nonCumulativeOverlap(fx('hasteBig'), fx('hasteSmall')).length, 0);
});

test('a set member carrying a slow twice is represented by its deepest slot', () => {
  // -7 and -11 on one spell against -9 on another: the pair view says -11 wins.
  // Math.max over a spell's own slots picked -7, and then named -9 the set winner.
  const twice = setSpell(1, 'Twice', [1, [505, -7], [505, -11]]);
  const once = setSpell(2, 'Once', [3, [505, -9]]);
  const g = analyzeSet([twice, once]).nonCumulative.find(x => x.spa === 505);
  assert.deepEqual(g.members.map(m => m.value), [-11, -9]);
  assert.deepEqual(g.members.map(m => m.applies), [true, false]);
});


// --- calcValue --------------------------------------------------------------

test('a degenerating formula is worth its base at cast time', () => {
  // Formula 107 loses one per tick. With no tick count given nothing has elapsed —
  // eqspellparser's tick 0. The engine used to pass 0 remaining ticks and so
  // evaluated the slot after the whole duration had run: base 50 over 130 ticks
  // came out at -80.
  const s = fx('weakBuff');
  s.duration = 130; s.dur_calc = 50; s.dur_cap = 130;
  s.slots[0] = { spa: 1, base1: 50, base2: 0, calc: 107, max: 0 };
  assert.equal(calcValue(s, 0), 50);
  assert.equal(calcValue(s, 0, MAX_PLAYER_LEVEL, 130), 49, 'EQEmu\'s first tick, one step in');
  assert.equal(calcValue(s, 0, MAX_PLAYER_LEVEL, 100), 19, 'a hundred ticks left counts as thirty-one elapsed, by the same max(tics - 1, 0)');
  s.slots[0].calc = 1005;                                           // five per tick
  assert.equal(calcValue(s, 0), 50);
  assert.equal(calcValue(s, 0, MAX_PLAYER_LEVEL, 121), 0, 'ten ticks in at five a tick');
});

test('formulas 111-114 never fall below base for a low caster', () => {
  // EQEmu has no guard here and would say -16; eqspellparser guards, as both do
  // for 115-118. A deliberate divergence, written down in calcValue.
  const s = fx('weakBuff');
  s.slots[0] = { spa: 1, base1: 20, base2: 0, calc: 111, max: 0 };
  assert.equal(calcValue(s, 0, 10), 20);
  assert.equal(calcValue(s, 0, 16), 20);
  assert.equal(calcValue(s, 0, 17), 26);
  s.slots[0].calc = 114;
  assert.equal(calcValue(s, 0, 44), 20);
  assert.equal(calcValue(s, 0, 54), 170);
});

test('a decreasing formula keeps its sign and its floor', () => {
  // max below base with max set: EQEmu's updownsign goes negative and the max
  // becomes a floor, not a cap. Formula 102 at base 100, max 50, level 60.
  const s = fx('weakBuff');
  s.slots[0] = { spa: 1, base1: 100, base2: 0, calc: 102, max: 50 };
  assert.equal(calcValue(s, 0, 60), 50, '-(100 + 60) is under the floor, so the floor');
  // 124-132 apply the sign to the increment only, as EQEmu does: 100 + (-1 * 10).
  s.slots[0] = { spa: 1, base1: 100, base2: 0, calc: 124, max: 50 };
  assert.equal(calcValue(s, 0, 60), 90);
  // A negative base stays negative after the formula.
  s.slots[0] = { spa: 1, base1: -10, base2: 0, calc: 102, max: 0 };
  assert.equal(calcValue(s, 0, 100), -110);
});

test('the aura duration formula is no tick count in the engine either', () => {
  // tools/spells.mjs returns 0 for formula 51 and flags the spell as an aura; the
  // engine fell through to the cap and said 72000. One answer, in both places.
  assert.equal(calcDuration(51, 72000), 0);
  assert.equal(calcDuration(50, 0), 72000);
});
