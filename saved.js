// Named buff sets, kept in the browser.
//
// The workflow this exists for: a melee has a standard raid buff set, loads it,
// piles on a few things to see what they cost, and wants the standard set back
// without rebuilding it by hand. So saving is only half of it — knowing that the
// live set has drifted from the one you loaded, and being able to go back, is
// the part that makes it useful.
//
// Everything here is pure over an injected storage object, so it is testable
// without a browser and cannot be broken by a page's DOM. The caller passes
// localStorage; a test passes a Map-backed stand-in.

export const KEY = 'doesitstack.sets';
export const MAX_SETS = 50;
export const MAX_NAME = 40;

/**
 * Storage is not guaranteed. Private windows, blocked site data and quota
 * exhaustion all throw rather than returning null, so every access is wrapped
 * and a failure degrades to "no saved sets" instead of a broken page.
 */
export function readSets(store) {
  let raw;
  try { raw = store?.getItem(KEY); } catch { return []; }
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(s => s && typeof s.name === 'string' && Array.isArray(s.ids))
    .map(s => ({
      name: s.name.slice(0, MAX_NAME),
      // Whatever else ended up in there, only positive integers are spell ids.
      ids: [...new Set(s.ids.map(Number).filter(n => Number.isInteger(n) && n > 0))],
    }))
    .filter(s => s.name && s.ids.length)
    .slice(0, MAX_SETS);
}

/** @returns {boolean} whether it actually persisted — the caller should say so if not. */
export function writeSets(store, list) {
  try {
    store.setItem(KEY, JSON.stringify(list.slice(0, MAX_SETS)));
    return true;
  } catch {
    return false;   // quota, private mode, or storage disabled
  }
}

export const cleanName = name => String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);

/** Save under `name`, replacing an existing one of that name in place. */
export function upsert(list, name, ids) {
  const clean = cleanName(name);
  if (!clean || !ids.length) return list;
  const entry = { name: clean, ids: [...ids] };
  const at = list.findIndex(s => s.name.toLowerCase() === clean.toLowerCase());
  if (at === -1) return [...list, entry].slice(0, MAX_SETS);
  const next = [...list];
  next[at] = entry;
  return next;
}

export const removeSet = (list, name) =>
  list.filter(s => s.name.toLowerCase() !== cleanName(name).toLowerCase());

export const findSet = (list, name) =>
  list.find(s => s.name.toLowerCase() === cleanName(name).toLowerCase()) || null;

/**
 * Whether two sets hold the same spells.
 *
 * Order-insensitive on purpose: the ids carry insertion order, which is a
 * display detail. Adding Focus and then Aura is the same set as the reverse,
 * and reporting that as "modified" would cry wolf.
 */
export function sameSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every(id => seen.has(id));
}
