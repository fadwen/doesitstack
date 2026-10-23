// Description tokens are rendered with the engine's calculator.
//
// A description saying "increases your AC by #4" has to show the number the
// verdict was decided on. tools/spells.mjs cannot import the engine — it reads
// the client's files and nothing else — so the build passes calcValue in. For a
// while it carried its own shorter copy of the formula table instead, and the
// two disagreed on 68 slots in the file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDesc, unscaledSlotValue } from '../tools/spells.mjs';
import { calcValue } from '../web/engine.js';

// Formula 115 at base 10 capped at 300: 10 + 7 * (130 - 15) runs past the cap.
const spell = () => ({
  id: 900100, name: 'Test Ward', desc: 'Hardens your skin, increasing armor class by #1 for %z.',
  duration: 100, dur_calc: 7, dur_cap: 0, beneficial: true,
  slots: [{ spa: 1, base1: 10, base2: 0, calc: 115, max: 300 }],
});

test('an AC token is scaled by the calculator the build passes in', () => {
  const text = prepareDesc(spell(), new Map(), 130, calcValue);
  assert.match(text, /armor class by 300 for 10m/);
});

test('without a calculator the token is the slot base, unscaled', () => {
  // Honest rather than clever: a caller that did not pass the engine in gets
  // the number the file holds, not a second-hand scaling of it.
  const text = prepareDesc(spell(), new Map(), 130);
  assert.match(text, /armor class by 10 for 10m/);
  assert.equal(unscaledSlotValue(spell(), 0), 10);
});

test('haste tokens show the bonus over 100, through the same calculator', () => {
  const sp = spell();
  sp.desc = 'Quickens your attacks by #1% for %z.';
  sp.slots[0] = { spa: 11, base1: 125, base2: 0, calc: 100, max: 0 };
  assert.match(prepareDesc(sp, new Map(), 130, calcValue), /attacks by 25%/);
});
