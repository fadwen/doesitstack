// The dataset verifier keeps its own reading of a spell line, deliberately apart
// from the parser it checks. The two have to read one line the same way, or a
// clean verify:data proves nothing. Runs anywhere: the line is made up here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rawSpell } from '../tools/verify_dataset.mjs';
import { parseSpellLine, MAX_PLAYER_LEVEL } from '../tools/spells.mjs';

// A 166-field line in the client's layout, with a value in every field the
// verifier compares, a blank, a ".5"-style decimal, and three effect slots
// followed by the 254 "nothing follows" marker.
const fields = new Array(166).fill('0');
const set = (i, v) => { fields[i] = v; };
set(0, '4242'); set(1, ' Test Spell '); set(4, '200'); set(5, '50'); set(8, '3000'); set(10, '12000');
set(11, '7'); set(12, '0'); set(14, '150'); set(28, '1'); set(29, '2'); set(30, '5');
for (let i = 0; i < 16; i++) set(36 + i, '255');
set(36 + 9, '70'); set(36 + 15, '254');
set(96, '');          // a blank reads as 0
set(98, '.5');        // a decimal reads as 0 — not 5, not NaN
set(132, '77'); set(133, '3');
set(165, '1|1|100|0|100|0$2|3|30|0|100|55$4|496|110|-1|100|0$5|254|0|0|0|0');
const line = fields.join('^');

test('the verifier and the parser read one line the same way', () => {
  const raw = rawSpell(line);
  const got = parseSpellLine(line.split('^'), MAX_PLAYER_LEVEL);
  for (const k of ['id', 'name', 'levels', 'beneficial', 'target', 'resist', 'mana', 'endurance', 'cast_ms',
                   'recast_ms', 'dur_calc', 'dur_cap', 'range', 'ae_range', 'is_skill', 'group_id', 'rank'])
    assert.deepEqual(raw[k], got[k], k);
  assert.deepEqual(raw.slots, got.slots.map(s => s && [s.spa, s.base1, s.base2, s.calc, s.max]));
});

test('and both read what the line says', () => {
  const raw = rawSpell(line);
  assert.equal(raw.id, 4242);
  assert.equal(raw.name, 'Test Spell');
  assert.equal(raw.endurance, 0);
  assert.equal(raw.is_skill, false);
  assert.equal(raw.levels[9], 70);
  assert.equal(raw.levels[15], 254);
  // slot 3 was never listed, so it is a gap; the 254 marker ends the list
  assert.deepEqual(raw.slots, [[1, 100, 0, 100, 0], [3, 30, 0, 100, 55], null, [496, 110, -1, 100, 0]]);
});
