// Loading and searching the built dataset, shared by the pair tool and the set tool.
//
// Extracted from app.js when a second page needed the same dataset. Nothing here
// touches the DOM of either page or knows what is being rendered — it answers
// "give me this spell" and "which spells match this query", and the pages decide
// what to do with the answer.

export const $ = s => document.querySelector(s);
export const el = (t, cls, txt) => {
  const n = document.createElement(t);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
export const link = (href, text) => {
  const a = el('a', null, text);
  a.href = href; a.target = '_blank'; a.rel = 'noopener';
  return a;
};
export const escape = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const LUCY = id => `https://lucy.allakhazam.com/spell.html?id=${id}&source=Live`;
// Lucy's own item export stores this link verbatim, and it is the item id
// templated in with no exceptions across all 134,079 of its rows — so we build
// it rather than shipping a second download to look it up.
export const LUCY_ITEM = id => `https://lucy.allakhazam.com/item.html?id=${id}`;

export const F_BENEFICIAL = 1, F_SKILL = 2, F_SONG = 4, F_SONGWIN = 8, F_GROUP = 16, F_STACKGRP = 32;

/** Column positions in a data/index.json row. */
export const row = {
  id: 0, name: 1, target: 2, flags: 3, duration: 4, levels: 5, category: 6,
  kind: 7, classMask: 8, extMask: 9, itemRel: 10,
};

// Labels for the `kind` a spell was classified into at build time.
export const KIND_LABEL = {
  spell: 'Spell', discipline: 'Discipline', song: 'Song', aa: 'AA',
  item: 'Item', triggered: 'Triggered', npc: 'NPC', other: 'Unattributed',
};
export const KIND_HELP = {
  spell: 'Scribed into a spellbook by a class at a normal level.',
  discipline: 'A combat skill — flagged as a discipline in the spell file.',
  song: 'Usable by bards and not a combat skill.',
  aa: 'Granted by an alternate ability (the class level reads 254).',
  item: 'An item casts this — a click, proc, worn or focus effect. Named items come from a community database, not your client files.',
  triggered: 'Fired by another spell as a side effect, recourse or proc rather than cast directly.',
  npc: 'Flagged in the spell file as castable by NPCs only, and no known item grants it.',
  other: 'No class learns it, nothing in the spell file triggers it, and no item in the item database casts it. Unexplained rather than absent — the item data lags new content, so recent effects can land here for a while.',
};
// Said when the build ran without item data, so 'item' keeps its older,
// looser meaning and 'other' cannot occur at all.
export const KIND_HELP_NO_ITEMS = {
  item: 'No class can learn it and nothing in the spell file triggers it — clickies, procs and worn effects land here, but so do NPC spells. This build has no item database loaded, so the bucket is a deduction rather than a fact.',
};

// How an item grants a spell. Additive, not a classification: a scribed spell
// can also be a clicky, and one spell can be several of these at once.
export const REL_LABEL = {
  click: 'Click', proc: 'Proc', worn: 'Worn', focus: 'Focus',
  bard: 'Bard', mount: 'Mount', blessing: 'Blessing', familiar: 'Familiar',
};
export const REL_HELP = {
  click: 'Cast by activating the item.',
  proc: 'Fires by itself while the item is in use.',
  worn: 'Applied for as long as the item is equipped.',
  focus: 'The item carries this as a focus effect.',
  bard: 'The item is a bard instrument granting this.',
  mount: 'Granted by a mount.',
  blessing: 'A mount blessing effect.',
  familiar: 'Granted by a familiar.',
};

export let META = null, INDEX = null;
const shardCache = new Map(), descCache = new Map();

export async function load() {
  [META, INDEX] = await Promise.all([
    fetch('data/meta.json').then(r => r.json()),
    fetch('data/index.json').then(r => r.json()),
  ]);
  return { META, INDEX };
}

export const kindHelp = k => (META.items ? KIND_HELP[k] : KIND_HELP_NO_ITEMS[k] || KIND_HELP[k]) || '';

// index rows carry item relationships as a bitmask so a result list can show
// tags without fetching a shard. Bit order matches meta.items.rel.
export const relsOf = mask => (META.items?.rel || []).filter((_, i) => mask & (1 << i));

async function shard(id) {
  const b = Math.floor(id / META.bucket);
  if (!shardCache.has(b)) shardCache.set(b, fetch(`data/spells/${b}.json`).then(r => r.ok ? r.json() : {}));
  return (await shardCache.get(b))[id] || null;
}
async function descOf(id) {
  const b = Math.floor(id / META.bucket);
  if (!descCache.has(b)) descCache.set(b, fetch(`data/desc/${b}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})));
  return (await descCache.get(b))[id] || null;
}

/** compact record -> the shape engine.js expects */
export function hydrate(rec) {
  if (!rec) return null;
  return {
    ...rec,
    stacking: rec.stacking || [],
    slots: (rec.slots || []).map(s => s && { spa: s[0], base1: s[1], base2: s[2], calc: s[3], max: s[4] }),
  };
}

/** A spell ready for the engine, with its resolved description attached. */
export async function spellById(id) {
  const sp = hydrate(await shard(id));
  if (sp) sp.desc = await descOf(id);
  return sp;
}

const matches = (r, q) => /^\d+$/.test(q)
  ? String(r[row.id]).startsWith(q)
  : r[row.name].toLowerCase().includes(q);

/**
 * @param {string} q                lower-cased query — a name fragment or a spell id
 * @param {object} f                filters, passed in rather than read from a page
 * @param {boolean} f.buffsOnly     only effects with a duration
 * @param {boolean} f.benefOnly     only beneficial effects
 * @param {Set<string>} f.kinds     which source buckets to include
 * @param {number} f.cls            class index, or -1 for any
 * @param {Set<number>} [f.exclude] spell ids already chosen
 */
export function search(q, f) {
  const clsBit = f.cls >= 0 ? (1 << f.cls) : 0;
  const out = [];
  for (const r of INDEX) {
    if (f.buffsOnly && r[row.duration] <= 0) continue;
    if (f.benefOnly && !(r[row.flags] & F_BENEFICIAL)) continue;
    if (f.kinds && !f.kinds.has(META.kinds[r[row.kind]])) continue;
    // a class matches either by learning the spell or by triggering it
    if (clsBit && !((r[row.classMask] | r[row.extMask]) & clsBit)) continue;
    if (f.exclude?.has(r[row.id])) continue;
    if (!matches(r, q)) continue;
    out.push(r);
    if (out.length >= 400) break;
  }
  // exact-ish first, then shortest name, then id
  out.sort((x, y) => {
    const a = x[row.name].toLowerCase(), b = y[row.name].toLowerCase();
    return (a.startsWith(q) ? 0 : 1) - (b.startsWith(q) ? 0 : 1) || a.length - b.length || x[row.id] - y[row.id];
  });
  return out.slice(0, 60);
}
