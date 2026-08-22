// Links off this site.
//
// None of them is a source. Spell values come from your own client files and
// item tags from SoDeq; these are other people's readings, offered so a verdict
// can be checked. That is only worth doing if the page is straight about how
// good each one is — a link that quietly points at eight-month-old data is worse
// than no link at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LUCY, LUCY_HISTORY, RAIDLOOT, SODEQ_ITEM, THIRD_PARTY_LAG } from '../web/data.js';

const root = new URL('../', import.meta.url);
const read = f => readFile(new URL(f, root), 'utf8');

test('every outbound link is built from an id, never looked up', () => {
  // The point of templating them: no request, no download, nothing to go stale
  // in the build. Lucy's own item export proved this — its third column was the
  // id in a URL on all 134,079 rows.
  assert.equal(RAIDLOOT(70855), 'https://www.raidloot.com/spells?name=70855');
  assert.equal(LUCY(70855), 'https://lucy.allakhazam.com/spell.html?id=70855&source=Live');
  assert.equal(LUCY_HISTORY(70855), 'https://lucy.allakhazam.com/spellhistory.html?id=70855&source=Live');
  assert.equal(SODEQ_ITEM(2399), 'https://items.sodeq.org/item.php?id=2399');
});

test('an item links to the database the tag came from', async () => {
  // The item relationships are SoDeq's, so an item name goes to SoDeq — whose
  // page also says who submitted it and when it was verified. It used to link to
  // Lucy, which contributed none of it.
  const src = await read('web/app.js');
  assert.match(src, /SODEQ_ITEM\(id\)/);
  assert.doesNotMatch(src, /LUCY_ITEM/, 'item links no longer go to a site that supplied nothing');
});

test('a third-party reading says that it is one', async () => {
  assert.match(THIRD_PARTY_LAG, /refreshed on their own/);
  assert.match(THIRD_PARTY_LAG, /missing or out of date/);
  for (const f of ['web/app.js', 'web/set.js']) {
    const src = await read(f);
    assert.match(src, /THIRD_PARTY_LAG/, `${f} must say what these links are`);
  }
});

test('the pages do not claim these links corroborate anything', async () => {
  // "Lucy is linked from every result so you can check the source" was a claim
  // this project could not back: Lucy's live copy was eight months behind, and
  // it has no name for SPA 496 — the one effect here with a confirmed claim.
  for (const f of ['README.md', 'web/app.js', 'web/set.js']) {
    const src = await read(f);
    assert.doesNotMatch(src, /Lucy is linked from every result/);
  }
});
