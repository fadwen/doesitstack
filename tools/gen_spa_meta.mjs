#!/usr/bin/env node
// Regenerate tools/spa_meta.json from an EQEmu checkout.
//
//   git clone --filter=blob:none --depth 1 https://github.com/EQEmu/Server.git /tmp/eqemu
//   node tools/gen_spa_meta.mjs --eqemu /tmp/eqemu
//
// Pulls the SPA id->name table out of common/spdat.h and the stacking ignore
// list out of common/spdat.cpp, so neither is retyped by hand. Run it when a new
// expansion adds SPAs and EQEmu catches up.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg } from './eqdir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = arg('eqemu', null);
if (!src) {
  console.error('Pass --eqemu <path to an EQEmu/Server checkout>.');
  process.exit(1);
}

const h = fs.readFileSync(path.join(src, 'common', 'spdat.h'), 'utf8');
const cpp = fs.readFileSync(path.join(src, 'common', 'spdat.cpp'), 'utf8');
const bonuses = fs.readFileSync(path.join(src, 'zone', 'bonuses.cpp'), 'utf8');

const nsBody = /namespace SpellEffect \{([\s\S]*?)\n\}/.exec(h);
if (!nsBody) { console.error('Could not find the SpellEffect namespace in common/spdat.h'); process.exit(1); }
const name2id = new Map();
for (const m of nsBody[1].matchAll(/constexpr int (\w+)\s*=\s*(-?\d+);/g)) name2id.set(m[1], Number(m[2]));

const idsFrom = (fnName) => {
  const body = new RegExp(`bool ${fnName}\\(int effect_id\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(cpp);
  if (!body) { console.error(`Could not find ${fnName} in common/spdat.cpp`); process.exit(1); }
  const ids = new Set();
  for (const m of body[1].matchAll(/case SpellEffect::(\w+):/g)) {
    if (!name2id.has(m[1])) { console.error(`Unknown SpellEffect::${m[1]}`); process.exit(1); }
    ids.add(name2id.get(m[1]));
  }
  return [...ids].sort((a, b) => a - b);
};

// Which SPAs are focus effects. Taken from Mob::IsFocusEffect rather than guessed
// from names: several foci predate the Fc_ naming convention (ImprovedDamage,
// SympatheticProc, TriggerOnCast and friends) and would be missed otherwise.
const focusFn = /uint8 Mob::IsFocusEffect\([\s\S]*?\n\}/.exec(bonuses);
if (!focusFn) { console.error('Could not find Mob::IsFocusEffect in zone/bonuses.cpp'); process.exit(1); }
const focusEffects = new Set();
for (const m of focusFn[0].matchAll(/case SpellEffect::(\w+):/g)) {
  if (!name2id.has(m[1])) { console.error(`Unknown SpellEffect::${m[1]}`); process.exit(1); }
  focusEffects.add(name2id.get(m[1]));
}

const id2name = {};
for (const [name, id] of name2id) if (!(id in id2name)) id2name[id] = name;

const out = {
  spa_names: Object.fromEntries(Object.keys(id2name).map(Number).sort((a, b) => a - b).map(id => [id, id2name[id]])),
  ignored_in_stacking: idsFrom('IsEffectIgnoredInStacking'),
  focus_limits: idsFrom('IsFocusLimit'),
  focus_effects: [...focusEffects].sort((a, b) => a - b),
  _source: 'SPA id->name and the stacking ignore list, extracted from EQEmu/Server '
         + '(common/spdat.h SpellEffect namespace and common/spdat.cpp IsEffectIgnoredInStacking). '
         + 'Regenerate with tools/gen_spa_meta.mjs against a local checkout. '
         + 'focus_effects comes from zone/bonuses.cpp Mob::IsFocusEffect. '
         + 'Claims about how effects behave live in claims.json, not here.',
};
fs.writeFileSync(path.join(HERE, 'spa_meta.json'), JSON.stringify(out, null, 1));
console.log(`spa_meta.json written — ${Object.keys(out.spa_names).length} SPAs, `
          + `${out.ignored_in_stacking.length} ignored in stacking, ${out.focus_limits.length} focus limits, `
          + `${out.focus_effects.length} focus effects`);
