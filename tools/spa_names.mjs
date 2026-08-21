// SPA names, from Daybreak's enumerated SPA list.
//
// This is the authoritative naming and replaces the EQEmu enum names the site used
// to display. They are not cosmetic variants of each other: of the 420 SPAs the
// spell file actually uses, 282 were being shown under an internal identifier no
// player would recognise — CurrentHP for HP, WeaponProc for Contact Ability,
// SympatheticProc for Fc_CastProcNormalized.
//
// Names are shipped verbatim, underscores and capitalisation included. Tidying them
// would make the label a second-hand reading of a primary source, which is the thing
// this project keeps getting caught by.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SPA_LIST_PATH = path.join(HERE, 'reference', 'daybreak-spa-list.txt');
export const SPA_LIST_SOURCE =
  'https://forums.daybreakgames.com/eq/index.php?threads/enumerated-spa-list.206288/';

/** id -> Daybreak's name, parsed from the reference copy. */
export function daybreakNames(file = SPA_LIST_PATH) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^(\d+) - (.+)$/.exec(line.trim());
    if (m) out[Number(m[1])] = m[2].trim();
  }
  if (Object.keys(out).length < 500) throw new Error(`${file} looks truncated`);
  return out;
}

/**
 * Display names for every SPA, Daybreak's where it has one.
 *
 * The spell file already uses SPAs that postdate the published list (529 and 531 as
 * of this writing), so a fallback is not optional. EQEmu's enum covers some of them;
 * anything neither source names is shown as its number rather than guessed at.
 */
export function resolveNames(eqemuNames) {
  const db = daybreakNames();
  const ids = new Set([...Object.keys(db), ...Object.keys(eqemuNames)].map(Number));
  const names = {}, fallback = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    if (db[id]) { names[id] = db[id]; continue; }
    if (eqemuNames[id]) { names[id] = eqemuNames[id]; fallback.push(id); continue; }
    names[id] = `SPA ${id}`;
  }
  return { names, fallback, daybreakCount: Object.keys(db).length };
}

/**
 * Focus effects, from Daybreak's own Fc_ and Ff_ prefixes.
 *
 * Better grounded than either previous attempt: naming by EQEmu's enum missed the
 * legacy-named foci, and EQEmu's IsFocusEffect list is a volunteer's reading. Every
 * SPA EQEmu treats as focus carries an Fc_/Ff_ prefix here, and Daybreak names three
 * more besides — so the published list is a superset, and the union is the honest set.
 */
export function focusSpas(eqemuFocus = []) {
  const db = daybreakNames();
  const byName = Object.keys(db).map(Number).filter(id => /^(Fc_|Ff_)/.test(db[id]));
  return [...new Set([...byName, ...eqemuFocus])].sort((a, b) => a - b);
}

/**
 * The limiter subset: SPAs that restrict which casts a focus applies to, rather
 * than modifying anything themselves.
 *
 * These need separating because Daybreak's Fc_ and Ff_ prefixes both land in
 * focusSpas(), and a limiter is not a focus that "applies" to a cast — it
 * restricts the focus sitting beside it. Reporting two spells as competing over
 * a shared Ff_LevelMax says nothing at all.
 *
 * Same union as focusSpas: Daybreak's Ff_ prefix, plus EQEmu's own limit list.
 */
export function focusLimitSpas(eqemuLimits = []) {
  const db = daybreakNames();
  const byName = Object.keys(db).map(Number).filter(id => /^Ff_/.test(db[id]));
  return [...new Set([...byName, ...eqemuLimits])].sort((a, b) => a - b);
}
