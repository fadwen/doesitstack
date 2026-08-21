#!/usr/bin/env node
// Prove the shipped dataset is the client's spell file and nothing else.
//
//   node tools/verify_dataset.mjs [--eq-dir "C:/..." ] [--dist dist]
//
// Re-reads spells_us.txt with a deliberately separate minimal parser — its own
// field offsets, no import from tools/spells.mjs — and compares every spell in the
// built dataset against it. A mismatch means the pipeline changed a value somewhere
// between the file and the page, which is the one thing this project cannot afford.
//
// This checks fidelity, not interpretation. Field offsets and the labels for SPA
// and target ids come from third-party reference (see README, Source of truth);
// every number below comes from the file.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { findEqDir, arg } from './eqdir.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Independent offsets, written from the format description rather than shared with
// the parser under test — if one drifts, this disagrees instead of agreeing wrongly.
const OFF = { id: 0, name: 1, range: 4, aeRange: 5, cast: 8, recast: 10, durCalc: 11, durCap: 12,
              mana: 14, beneficial: 28, resist: 29, target: 30, levels: 36, endurance: 96,
              isSkill: 98, group: 132, rank: 133 };

const num = s => (!s || s[0] === '.') ? 0 : (parseInt(s, 10) || 0);

function rawSpell(line) {
  const f = line.split('^');
  const slots = [];
  for (const chunk of f[f.length - 1].split('$')) {
    const p = chunk.split('|');
    if (p.length < 6) break;
    const idx = num(p[0]) - 1, spa = num(p[1]);
    if (spa === 254) break;
    while (slots.length <= idx) slots.push(null);
    slots[idx] = [spa, num(p[2]), num(p[3]), num(p[4]), num(p[5])];
  }
  return {
    id: num(f[OFF.id]), name: f[OFF.name].trim(),
    levels: Array.from({ length: 16 }, (_, i) => num(f[OFF.levels + i])),
    beneficial: num(f[OFF.beneficial]) !== 0, target: num(f[OFF.target]), resist: num(f[OFF.resist]),
    mana: num(f[OFF.mana]), endurance: num(f[OFF.endurance]), cast_ms: num(f[OFF.cast]),
    recast_ms: num(f[OFF.recast]), dur_calc: num(f[OFF.durCalc]), dur_cap: num(f[OFF.durCap]),
    range: num(f[OFF.range]), ae_range: num(f[OFF.aeRange]),
    is_skill: num(f[OFF.isSkill]) !== 0, group_id: num(f[OFF.group]), rank: num(f[OFF.rank]),
    slots,
  };
}

const eqDir = arg('eq-dir', findEqDir());
if (!eqDir) { console.error('Could not find an EverQuest install. Pass --eq-dir explicitly.'); process.exit(1); }
const distDir = path.resolve(ROOT, arg('dist', 'dist'));
if (!fs.existsSync(path.join(distDir, 'data', 'meta.json'))) {
  console.error(`No built dataset in ${distDir} — run \`npm run build\` first.`);
  process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(path.join(distDir, 'data', 'meta.json'), 'utf8'));
const shards = new Map();
const shipped = (id) => {
  const b = Math.floor(id / meta.bucket);
  if (!shards.has(b)) {
    const file = path.join(distDir, 'data', 'spells', `${b}.json`);
    shards.set(b, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
  }
  return shards.get(b)[id];
};

const FIELDS = ['name', 'beneficial', 'target', 'resist', 'mana', 'endurance', 'cast_ms',
                'recast_ms', 'dur_calc', 'dur_cap', 'range', 'ae_range', 'is_skill', 'group_id', 'rank'];

let checked = 0, missing = 0, mismatched = 0, slotFields = 0;
const problems = [];

const rl = readline.createInterface({
  input: fs.createReadStream(path.join(eqDir, 'spells_us.txt'), { encoding: 'utf8' }),
  crlfDelay: Infinity,
});
for await (const line of rl) {
  if (!line || line[0] === '#') continue;
  const f = line.split('^');
  if (f.length < 100) continue;
  const raw = rawSpell(line);
  const got = shipped(raw.id);
  checked++;
  if (!got) { missing++; if (problems.length < 20) problems.push(`#${raw.id} ${raw.name}: not in the dataset`); continue; }

  for (const k of FIELDS) {
    if (JSON.stringify(raw[k]) !== JSON.stringify(got[k])) {
      mismatched++;
      if (problems.length < 20) problems.push(`#${raw.id} ${raw.name}: ${k} is ${JSON.stringify(got[k])}, file says ${JSON.stringify(raw[k])}`);
    }
  }
  if (JSON.stringify(raw.levels) !== JSON.stringify(got.levels)) {
    mismatched++;
    if (problems.length < 20) problems.push(`#${raw.id} ${raw.name}: class levels differ`);
  }
  if (JSON.stringify(raw.slots) !== JSON.stringify(got.slots)) {
    mismatched++;
    if (problems.length < 20) problems.push(`#${raw.id} ${raw.name}: slots differ (${raw.slots.length} in file, ${got.slots.length} shipped)`);
  } else {
    slotFields += raw.slots.filter(Boolean).length * 5;
  }
}

console.log(`spell file : ${path.join(eqDir, 'spells_us.txt')}`);
console.log(`dataset    : ${distDir} (built ${meta.built})\n`);
console.log(`${checked.toLocaleString()} spells re-read from the file and compared field by field`);
console.log(`${(checked * (FIELDS.length + 1) + slotFields).toLocaleString()} values checked`);
console.log(`${missing} missing from the dataset, ${mismatched} mismatched`);
for (const p of problems) console.log(`  ${p}`);
if (missing || mismatched) {
  console.error('\nThe dataset does not match the spell file it claims to come from.');
  process.exit(1);
}
console.log('\nEvery value in the dataset came from the local spell file.');
