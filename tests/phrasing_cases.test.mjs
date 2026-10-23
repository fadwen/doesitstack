// The reader that lifts each SPA's formatting line out of eqspellparser.
//
// Both the audit and the worklist trust it to pick the line that applies to a
// current spell file. The two ways it has been wrong: taking the line kept for
// pre-2016 files, and letting a later switch in the same file overwrite the
// formatter's.

import test from 'node:test';
import assert from 'node:assert/strict';
import { eqspCases } from '../tools/eqsp_cases.mjs';

const SRC = `
            switch (spa)
            {
                case 1:
                    // a comment between the label and the line
                    return Spell.FormatCount("AC", value);
                case 178:
                    if (Version != 0 && Version < 20160816)
                        return String.Format("Lifetap from Weapon Damage: {0}%", base1);
                    // the current line
                    return string.Format("Return {0}% of Melee Damage", base1 / 10f);
                case 12:
                    if (base1 > 1)
                        return "Invisibility (Enhanced)";
                    return "Invisibility";
            }
            switch (spell.Slots[i].SPA)
            {
                case 1:
                    text = "overwritten";
                    return text;
            }
`;

test('it takes the first return under each case, past comments', () => {
  const cases = eqspCases(SRC);
  assert.equal(cases.get(1), 'Spell.FormatCount("AC", value)');
});

test('a return guarded by a spell-file version is the old line, not the one to port', () => {
  assert.equal(eqspCases(SRC).get(178), 'string.Format("Return {0}% of Melee Damage", base1 / 10f)');
});

test('a return under any other condition still counts as the first', () => {
  // only the Version guard means "for older files"; a data-dependent branch is
  // part of the current line and the comparison should see it
  assert.equal(eqspCases(SRC).get(12), '"Invisibility (Enhanced)"');
});

test('a later switch in the same file does not overwrite the formatter', () => {
  assert.equal(eqspCases(SRC).get(1), 'Spell.FormatCount("AC", value)');
});

test('a Windows checkout reads the same as a Unix one', () => {
  assert.deepEqual([...eqspCases(SRC.replace(/\n/g, '\r\n'))], [...eqspCases(SRC)]);
});
