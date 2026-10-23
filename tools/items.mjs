// Item -> spell relationships, parsed from the SoDeq item dump (items.txt).
//
// The EverQuest client files do not record which item grants an effect. That
// relationship only exists in a community database, so this is the one part of
// the dataset that does not come from your own install. See README.md.
//
// Everything here is optional: with no items.txt the build still succeeds and
// the site simply carries no item tags.
//
// The dump is pipe-delimited with a header row. Columns are resolved BY NAME,
// never by position, so the collector adding or reordering columns cannot
// silently shift the data underneath us. A *renamed* column is a hard error.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

/** Relationship types, in priority order. The index is also the bit position. */
export const REL = ['click', 'proc', 'worn', 'focus', 'bard', 'mount', 'blessing', 'familiar'];

/**
 * Dump column backing each relationship.
 *
 * `scrolleffect` is deliberately absent: a scroll teaches a spell, it does not
 * cast one. Including it would tag every scribed spell with the scroll that
 * taught it, which is the wrong relationship and swamps the useful ones.
 */
const COLUMN = {
  click: 'clickeffect', proc: 'proceffect', worn: 'worneffect', focus: 'focuseffect',
  bard: 'bardeffect', mount: 'mounteffect', blessing: 'blessingeffect', familiar: 'familiareffect',
};

const ID_COLUMN = 'id', NAME_COLUMN = 'name', UPDATED_COLUMN = 'updated';

/**
 * How many named items ride along in a spell's record. The rest become a count
 * on the card, and the full list ships separately in data/items/, fetched only
 * when someone asks for it.
 */
export const KEEP_PER_SPELL = 3;

/** Default location, alongside the other inputs the repo never commits. */
export const defaultItemFile = root => path.join(root, 'vendor', 'items.txt');

export const relMask = rels => rels.reduce((m, r) => m | (1 << REL.indexOf(r)), 0);
export const maskRels = mask => REL.filter((_, i) => mask & (1 << i));

function resolveColumns(header) {
  const at = new Map(header.map((n, i) => [n.trim(), i]));
  const want = [ID_COLUMN, NAME_COLUMN, UPDATED_COLUMN, ...Object.values(COLUMN)];
  const missing = want.filter(n => !at.has(n));
  if (missing.length)
    throw new Error(
      `items.txt is missing expected column(s): ${missing.join(', ')}.\n` +
      `The dump format changed. Update COLUMN in tools/items.mjs to match, then rebuild.`);
  return {
    id: at.get(ID_COLUMN), name: at.get(NAME_COLUMN), updated: at.get(UPDATED_COLUMN),
    rel: REL.map(r => [r, at.get(COLUMN[r])]),
    width: header.length,
  };
}

/**
 * The share of rows that may be malformed before the whole file is distrusted.
 * A few are the dump's problem and cost a few tags; a flood means the format
 * changed under us and nothing read since the header can be relied on.
 */
export const MALFORMED_SHARE = 0.01;

/**
 * Parse the dump into a spell id -> item relationship map.
 *
 * A spell may be reached several ways at once — Steelskin is both a click and a
 * proc, and plenty of scribed spells also sit on an item — so `rels` is a set,
 * not a single value, and the tag is additive rather than a classification.
 *
 * @param {string} file            path to items.txt
 * @param {Set<number>} [spellIds] if given, only spells present in the current
 *                                 spell file survive; stale item data then
 *                                 produces fewer tags rather than dangling ones
 */
export async function loadItems(file, spellIds = null) {
  if (!fs.existsSync(file)) return null;

  const rl = readline.createInterface({
    input: fs.createReadStream(file), crlfDelay: Infinity,
  });

  let col = null, rows = 0, itemCount = 0, dropped = 0, malformed = 0, updated = '';
  const bySpell = new Map(), malformedRows = [];

  for await (const line of rl) {
    if (!line) continue;
    const f = line.split('|');
    if (!col) { col = resolveColumns(f); continue; }
    rows++;

    // Resolving columns by name only holds if every row has the header's count.
    // A `|` inside a name — the dump really has "Iksar Right Hand '=\|-'" —
    // shifts every field after it one to the right, and the by-name offsets then
    // read a neighbour's column. And parseInt('12abc') is 12, so an id is checked
    // as digits rather than parsed and hoped for.
    const bad = f.length !== col.width ? `${f.length} columns where the header has ${col.width}`
              : !/^\d+$/.test(f[col.id]) ? `id "${f[col.id]}" is not a number`
              : null;
    if (bad) {
      malformed++;
      if (malformedRows.length < 3) malformedRows.push(`line ${rows + 1}: ${bad}`);
      continue;
    }
    itemCount++;

    const u = f[col.updated];
    if (u && u > updated) updated = u;

    const itemId = Number(f[col.id]);
    if (!itemId) continue;
    const itemName = f[col.name];

    for (const [rel, at] of col.rel) {
      const spellId = parseInt(f[at], 10);
      if (!spellId || spellId <= 0) continue;
      if (spellIds && !spellIds.has(spellId)) { dropped++; continue; }
      let e = bySpell.get(spellId);
      if (!e) bySpell.set(spellId, e = { rels: new Set(), items: [], count: 0 });
      e.rels.add(rel);
      e.count++;
      e.items.push([itemId, itemName, rel]);
    }
  }
  if (!col) throw new Error(`${file} is empty — no header row.`);
  if (malformed > rows * MALFORMED_SHARE)
    throw new Error(
      `${file}: ${malformed} of ${rows} rows are malformed — the dump format has changed.\n` +
      `  ${malformedRows.join('\n  ')}\n` +
      `Check the file against COLUMN in tools/items.mjs, then rebuild.`);

  // Keep a deterministic handful per spell so the build is reproducible.
  // One item per relationship first, so the sample actually illustrates every
  // tag we show — otherwise a spell tagged click+proc can end up displaying
  // three clicks and no proc. Remaining slots fill by relationship priority.
  // Ties break on lowest item id, which keeps the pick stable across dumps.
  // `all` keeps every item in that same order, for the full list a card loads
  // on demand; it is already grouped by relationship.
  for (const e of bySpell.values()) {
    e.items.sort((a, b) => REL.indexOf(a[2]) - REL.indexOf(b[2]) || a[0] - b[0]);
    e.all = e.items;
    const pick = [], seen = new Set();
    for (const it of e.items) if (!seen.has(it[2])) { seen.add(it[2]); pick.push(it); }
    for (const it of e.items) {
      if (pick.length >= KEEP_PER_SPELL) break;
      if (!pick.includes(it)) pick.push(it);
    }
    e.items = pick.slice(0, KEEP_PER_SPELL);
    e.mask = relMask([...e.rels]);
  }

  return {
    bySpell,
    itemCount,
    spellCount: bySpell.size,
    dropped,
    /** Rows skipped for not fitting the header, and the first few, for the build log. */
    malformed,
    malformedRows,
    /** Newest per-row timestamp in the dump — the item data's real age. */
    updated: updated ? updated.slice(0, 10) : null,
    /** When the file itself landed on disk, for a "you have not fetched lately" hint. */
    fetched: fs.statSync(file).mtime.toISOString().slice(0, 10),
  };
}
