#!/usr/bin/env node
// Build the static dataset and site.
//
//   node tools/build.mjs                       auto-detect the EverQuest install
//   node tools/build.mjs --eq-dir "C:/..."     point at it explicitly
//   node tools/build.mjs --out dist --level 125
//
// Outputs:
//   dist/index.html, app.js, engine.js, spa.js, style.css
//   dist/data/meta.json       SPA names, ignore list, build stamp
//   dist/data/index.json      one small row per spell, for the search box
//   dist/data/spells/NN.json  full spell records, fetched only for the pair you pick
//   dist/data/desc/NN.json    descriptions with their template tokens resolved

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAll, CLASSES, KINDS, TARGET_NAMES, RESIST_NAMES, classMask, isBardSong, isGroupSpell } from './spells.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const BUCKET = 2000;

const CANDIDATE_DIRS = [
  'C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest',
  'C:\\Users\\Public\\Sony Online Entertainment\\Installed Games\\EverQuest',
  'C:\\Program Files (x86)\\Sony\\EverQuest',
  'C:\\EverQuest',
];

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function findEqDir() {
  return CANDIDATE_DIRS.find(d => fs.existsSync(path.join(d, 'spells_us.txt')));
}

const prettySpa = name => name
  .replace(/_/g, ' ')
  .replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ')
  .replace(/(?<=[A-Z])(?=[A-Z][a-z])/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function compact(sp) {
  const rec = {
    id: sp.id, name: sp.name, levels: sp.levels, beneficial: sp.beneficial, target: sp.target,
    resist: sp.resist, duration: sp.duration, dur_calc: sp.dur_calc, dur_cap: sp.dur_cap,
    mana: sp.mana, endurance: sp.endurance, cast_ms: sp.cast_ms, recast_ms: sp.recast_ms,
    icon: sp.icon, group_id: sp.group_id, rank: sp.rank, is_skill: sp.is_skill,
    unstackable_dot: sp.unstackable_dot, song_window: sp.song_window, timer: sp.timer,
    kind: sp.kind,
    slots: sp.slots.map(s => s && [s.spa, s.base1, s.base2, s.calc, s.max]),
  };
  if (sp.extra) rec.extra = sp.extra;
  if (sp.categories.length) rec.categories = sp.categories;
  if (sp.stacking.length) rec.stacking = sp.stacking;
  if (sp.ext_levels.some(l => l < 255)) rec.ext_levels = sp.ext_levels;
  if (sp.refs.length) rec.refs = sp.refs.slice(0, 12);
  return rec;
}

const writeJson = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj));

async function main() {
  const eqDir = arg('eq-dir', findEqDir());
  if (!eqDir) {
    console.error('Could not find an EverQuest install. Pass --eq-dir explicitly.');
    process.exit(1);
  }
  const out = path.resolve(ROOT, arg('out', 'dist'));
  const level = parseInt(arg('level', '125'), 10);
  console.log(`using ${eqDir}`);

  const t0 = Date.now();
  const { spells } = await loadAll(eqDir, level);
  console.log(`parsed ${spells.length} spells in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const dataDir = path.join(out, 'data');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dataDir, 'spells'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'desc'), { recursive: true });

  const shards = new Map(), descs = new Map();
  for (const sp of spells) {
    const b = Math.floor(sp.id / BUCKET);
    if (!shards.has(b)) shards.set(b, {});
    shards.get(b)[sp.id] = compact(sp);
    if (sp.desc || sp.land_self) {
      if (!descs.has(b)) descs.set(b, {});
      descs.get(b)[sp.id] = { d: sp.desc, l: sp.land_self };
    }
  }
  for (const [b, payload] of shards) writeJson(path.join(dataDir, 'spells', `${b}.json`), payload);
  for (const [b, payload] of descs) writeJson(path.join(dataDir, 'desc', `${b}.json`), payload);

  // Search index, one row per spell:
  //   [id, name, target, flags, duration_ticks, "BER 254|SHM 70", category,
  //    kind, class bitmask, borrowed-class bitmask]
  // flags bit 0 beneficial, 1 combat skill (discipline), 2 bard song, 3 song window,
  //       4 group spell, 5 has a Live stacking group
  // The borrowed mask covers classes that reach the spell only by triggering it.
  const index = spells.map(sp => [
    sp.id, sp.name, sp.target,
    (sp.beneficial ? 1 : 0) | (sp.is_skill ? 2 : 0) | (isBardSong(sp) ? 4 : 0) |
    (sp.song_window ? 8 : 0) | (isGroupSpell(sp) ? 16 : 0) | (sp.stacking.length ? 32 : 0),
    sp.duration,
    CLASSES.map((c, i) => sp.levels[i] < 255 ? `${c} ${sp.levels[i]}` : null).filter(Boolean).join('|'),
    sp.categories[0] || '',
    KINDS.indexOf(sp.kind),
    classMask(sp.levels),
    classMask(sp.ext_levels),
  ]);
  writeJson(path.join(dataDir, 'index.json'), index);

  const spaMeta = JSON.parse(fs.readFileSync(path.join(HERE, 'spa_meta.json'), 'utf8'));
  // "non-cumulative" mods: both buffs land, but the game keeps the larger value
  // instead of adding them. See the _source note in spa_meta.json.
  const NON_CUMULATIVE_SPA = Object.keys(spaMeta.non_cumulative.spas).map(Number).sort((a, b) => a - b);
  // The subset the live spell text confirms in words, rather than only EQEmu's code.
  const NON_CUMULATIVE_CONFIRMED = spaMeta.non_cumulative.confirmed_by_spell_text;
  const spaNames = Object.fromEntries(Object.entries(spaMeta.spa_names).map(([k, v]) => [k, prettySpa(v)]));
  const meta = {
    built: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    spell_file_date: fs.statSync(path.join(eqDir, 'spells_us.txt')).mtime.toISOString().slice(0, 10),
    spell_count: spells.length,
    bucket: BUCKET,
    max_level: level,
    classes: CLASSES,
    kinds: KINDS,
    targets: TARGET_NAMES,
    resists: RESIST_NAMES,
    spa_names: spaNames,
    ignored_in_stacking: spaMeta.ignored_in_stacking,
    non_cumulative: NON_CUMULATIVE_SPA,
    non_cumulative_confirmed: NON_CUMULATIVE_CONFIRMED,
  };
  writeJson(path.join(dataDir, 'meta.json'), meta);

  // engine.js imports these as a module rather than fetching them. Written into
  // web/ (gitignored) as well, so the tests can run straight from the source tree.
  const spaJs = '// generated by tools/build.mjs — do not edit\n'
    + `export const SPA_NAMES = ${JSON.stringify(spaNames)};\n`
    + `export const IGNORED_IN_STACKING = ${JSON.stringify(spaMeta.ignored_in_stacking)};\n`
    + `export const NON_CUMULATIVE_SPA = ${JSON.stringify(NON_CUMULATIVE_SPA)};\n`
    + `export const NON_CUMULATIVE_CONFIRMED = ${JSON.stringify(NON_CUMULATIVE_CONFIRMED)};\n`;
  fs.writeFileSync(path.join(ROOT, 'web', 'spa.js'), spaJs);
  for (const name of fs.readdirSync(path.join(ROOT, 'web'))) {
    if (/\.(html|css|js)$/.test(name)) fs.copyFileSync(path.join(ROOT, 'web', name), path.join(out, name));
  }

  let total = 0;
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e =>
    e.isDirectory() ? walk(path.join(d, e.name)) : (total += fs.statSync(path.join(d, e.name)).size));
  walk(dataDir);
  console.log(`wrote ${path.relative(ROOT, out) || out}: ${(total / 1e6).toFixed(1)} MB across ${shards.size + descs.size + 2} data files`);
}

main();
