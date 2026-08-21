// The item dump is the one input that does not come from the player's own client
// files, and the only one that can change shape without warning. These tests pin
// the two properties that make that survivable: columns are found by name, and a
// column we cannot find is a loud failure rather than silently wrong data.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadItems, relMask, maskRels, REL, KEEP_PER_SPELL } from '../tools/items.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dis-items-'));
const write = (name, rows) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, rows.map(r => r.join('|')).join('\n') + '\n');
  return file;
};

// A minimal dump: the columns we read, in a deliberately odd order, with an
// unknown column wedged in the middle to prove position is never assumed.
const HEADER = [
  'name', 'nonsense', 'clickeffect', 'proceffect', 'id', 'worneffect', 'focuseffect',
  'bardeffect', 'mounteffect', 'blessingeffect', 'familiareffect', 'scrolleffect', 'updated',
];
const item = ({ id, name, click = 0, proc = 0, worn = 0, scroll = 0, updated = '2026-01-01 00:00:00' }) =>
  [name, 'x', click, proc, id, worn, 0, 0, 0, 0, 0, scroll, updated];

test('columns are resolved by name, not position', async () => {
  const file = write('reordered.txt', [HEADER, item({ id: 10, name: 'Cloak', click: 500 })]);
  const r = await loadItems(file);
  assert.equal(r.spellCount, 1);
  assert.deepEqual([...r.bySpell.get(500).rels], ['click']);
  assert.equal(r.bySpell.get(500).items[0][1], 'Cloak');
});

test('a renamed column fails loudly and says what to do', async () => {
  const header = HEADER.map(c => c === 'clickeffect' ? 'click_effect' : c);
  const file = write('renamed.txt', [header, item({ id: 10, name: 'Cloak', click: 500 })]);
  await assert.rejects(() => loadItems(file), err => {
    assert.match(err.message, /missing expected column\(s\): clickeffect/);
    assert.match(err.message, /tools\/items\.mjs/);
    return true;
  });
});

test('a missing file is not an error — the build just carries no item tags', async () => {
  assert.equal(await loadItems(path.join(dir, 'nope.txt')), null);
});

test('one spell can be reached several ways at once', async () => {
  // Steelskin's real shape: a click on some items, a proc on others.
  const file = write('multi.txt', [
    HEADER,
    item({ id: 1, name: 'Mystic Cloak', click: 393 }),
    item({ id: 2, name: 'Sword of Rile', proc: 393 }),
    item({ id: 3, name: 'Mystic Brooch', click: 393 }),
  ]);
  const r = await loadItems(file);
  const e = r.bySpell.get(393);
  assert.deepEqual([...e.rels].sort(), ['click', 'proc']);
  assert.equal(e.count, 3);
  // every tag we display is illustrated by at least one named item
  assert.deepEqual(new Set(e.items.map(i => i[2])), new Set(['click', 'proc']));
});

test('one item granting the same spell two ways counts both', async () => {
  const file = write('both.txt', [HEADER, item({ id: 1, name: 'Odd Ring', click: 77, worn: 77 })]);
  const e = (await loadItems(file)).bySpell.get(77);
  assert.deepEqual([...e.rels].sort(), ['click', 'worn']);
});

test('scrolls are ignored — a scroll teaches a spell, it does not cast one', async () => {
  const file = write('scroll.txt', [HEADER, item({ id: 1, name: 'Spell: Ice Comet', scroll: 999 })]);
  const r = await loadItems(file);
  assert.equal(r.spellCount, 0, 'scrolleffect must not produce a tag');
});

test('spells the current spell file does not have are dropped, not dangled', async () => {
  const file = write('stale.txt', [
    HEADER,
    item({ id: 1, name: 'Known', click: 100 }),
    item({ id: 2, name: 'From a later patch', click: 999999 }),
  ]);
  const r = await loadItems(file, new Set([100]));
  assert.equal(r.spellCount, 1);
  assert.equal(r.dropped, 1);
  assert.ok(!r.bySpell.has(999999));
});

test('only a bounded number of named items ship per spell', async () => {
  const rows = [HEADER];
  for (let i = 1; i <= 40; i++) rows.push(item({ id: i, name: `Item ${i}`, click: 5 }));
  const e = (await loadItems(write('many.txt', rows))).bySpell.get(5);
  assert.equal(e.count, 40, 'the count keeps the full total');
  assert.equal(e.items.length, KEEP_PER_SPELL);
});

test('the pick is deterministic, so two builds of one dump agree', async () => {
  const rows = [HEADER];
  for (const i of [9, 3, 7, 1]) rows.push(item({ id: i, name: `Item ${i}`, click: 5 }));
  const file = write('order.txt', rows);
  const a = (await loadItems(file)).bySpell.get(5).items;
  const b = (await loadItems(file)).bySpell.get(5).items;
  assert.deepEqual(a, b);
  assert.deepEqual(a.map(i => i[0]), [1, 3, 7], 'ties break on lowest item id');
});

test('the dump reports its own age', async () => {
  const file = write('dates.txt', [
    HEADER,
    item({ id: 1, name: 'Old', click: 1, updated: '2024-05-05 10:00:00' }),
    item({ id: 2, name: 'New', click: 2, updated: '2026-08-09 08:22:29' }),
  ]);
  assert.equal((await loadItems(file)).updated, '2026-08-09');
});

test('the relationship bitmask round-trips', () => {
  assert.deepEqual(maskRels(relMask(['click', 'worn'])), ['click', 'worn']);
  assert.equal(relMask([]), 0);
  assert.deepEqual(maskRels(0), []);
  // bit order is what meta.items.rel publishes to the browser; changing it
  // silently reinterprets every mask in an already-deployed index.json
  assert.deepEqual(REL, ['click', 'proc', 'worn', 'focus', 'bard', 'mount', 'blessing', 'familiar']);
});

// ---------------------------------------------------------------------------
// Folding the item data into the dataset.

import { applyItemSources, KINDS } from '../tools/spells.mjs';

const spell = (id, kind, pcnpc = 0) => ({ id, kind, pcnpc });
const tags = (...ids) => new Map(ids.map(id => [id, { rels: new Set(['click']), items: [[1, 'A', 'click']], count: 1, mask: 1 }]));

test('an item tag is additive — it does not overwrite what a spell already is', () => {
  // A scribed spell that also sits on a clicky stays a spell, and an AA that is
  // also an item click stays an AA. Both simply gain `items`.
  const spells = [spell(1, 'spell'), spell(2, 'aa'), spell(3, 'song'), spell(4, 'discipline')];
  applyItemSources(spells, tags(1, 2, 3, 4));
  assert.deepEqual(spells.map(s => s.kind), ['spell', 'aa', 'song', 'discipline']);
  assert.ok(spells.every(s => s.items), 'every one should carry the item relationship');
});

test('an NPC-only guess loses to an item that demonstrably casts the spell', () => {
  // pcnpc === 2 is the file saying "NPCs cast this". If a player can click it off
  // an item, that guess over-claimed; roughly a quarter of the bucket did.
  const spells = [spell(1, 'npc', 2), spell(2, 'npc', 2)];
  applyItemSources(spells, tags(1));
  assert.equal(spells[0].kind, 'item');
  assert.equal(spells[1].kind, 'npc', 'with no item behind it, the NPC flag stands');
});

test('the residual splits into what an item explains and what nothing does', () => {
  const spells = [spell(1, 'item'), spell(2, 'item')];
  applyItemSources(spells, tags(1));
  assert.equal(spells[0].kind, 'item', 'confirmed by the item database');
  assert.equal(spells[1].kind, 'other', 'still unexplained — say so rather than implying an item');
});

test('a triggered effect keeps its own explanation and gains the item one', () => {
  const spells = [spell(1, 'triggered')];
  applyItemSources(spells, tags(1));
  assert.equal(spells[0].kind, 'triggered', 'the spell file already explains this one');
  assert.ok(spells[0].items);
});

test('with no item data nothing is reclassified and "item" keeps its older meaning', () => {
  const spells = [spell(1, 'item'), spell(2, 'npc', 2)];
  const r = applyItemSources(spells, null);
  assert.deepEqual(spells.map(s => s.kind), ['item', 'npc']);
  assert.deepEqual(r, { tagged: 0, reclassified: 0 });
  assert.ok(spells.every(s => !s.items));
});

test('"other" is a real kind the index can encode', () => {
  // build.mjs stores KINDS.indexOf(kind); a kind missing here would ship as -1.
  for (const k of ['item', 'other', 'npc', 'triggered', 'aura']) assert.ok(KINDS.includes(k), k);
});
