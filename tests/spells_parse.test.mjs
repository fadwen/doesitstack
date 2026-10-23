// Reading a spell line's effect slots.
//
// The slot field is the one part of spells_us.txt this project cannot afford to
// read loosely: every verdict is built from it. One check here, for a rule that
// used to be guessed: SPA 254 marks a slot the client does not use, and the
// parser used to stop reading at the first one on the assumption that nothing
// meaningful could follow. The current file has no 254 chunks at all, so the
// assumption was never exercised — and a later slot is exactly what a stacking
// command would be.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAll } from '../tools/spells.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dis-spells-'));

// A line with the 166 fields the 2025 layout has, all zero but for id, name
// and the slot field at the end.
function spellLine(id, name, slots) {
  const f = new Array(166).fill('0');
  f[0] = String(id);
  f[1] = name;
  f[165] = slots;
  return f.join('^');
}

test('an unused-slot marker is skipped, not treated as the end of the list', async () => {
  fs.writeFileSync(path.join(dir, 'spells_us.txt'),
    spellLine(1, 'Test', '1|0|10|0|100|0$2|254|0|0|100|0$3|1|5|0|100|0') + '\n');
  fs.writeFileSync(path.join(dir, 'dbstr_us.txt'), '');
  const { byId } = await loadAll(dir);
  const sp = byId.get(1);
  assert.equal(sp.slots[0].spa, 0, 'slot 1 is read');
  assert.equal(sp.slots[1], null, 'the 254 slot itself is left empty');
  assert.equal(sp.slots[2]?.spa, 1, 'the slot after it is still read');
  assert.equal(sp.slots[2].base1, 5);
});
