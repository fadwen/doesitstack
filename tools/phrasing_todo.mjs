#!/usr/bin/env node
// What is still shown as-is, worst first.
//
//   node tools/phrasing_todo.mjs                       needs a built dist/
//   node tools/phrasing_todo.mjs --eqsp ../eqspellparser   attach the C# to port
//   node tools/phrasing_todo.mjs --json
//
// Ranked by how many slots in the actual spell file carry the effect, because
// that is what decides whether anyone ever sees it. With a checkout of
// rumstil/eqspellparser to hand it also prints that project's line for each one,
// which is usually the whole job.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHRASED } from '../web/phrasing.js';
import { arg } from './eqdir.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** eqspellparser's formatting line for a SPA, if a checkout was provided. */
function eqspLines(dir) {
  const file = path.join(dir, 'core', 'SpellData.cs');
  if (!dir || !fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, 'utf8').split('\n');
  const out = new Map();
  for (let i = 0; i < src.length; i++) {
    const m = /^\s*case (\d+):\s*$/.exec(src[i]);
    if (!m) continue;
    // the first return after the case label, skipping its comments
    for (let j = i + 1; j < Math.min(i + 8, src.length); j++) {
      if (/^\s*case \d+:/.test(src[j])) break;
      const r = /^\s*return (.+);\s*$/.exec(src[j]);
      if (r) { out.set(+m[1], r[1]); break; }
    }
  }
  return out;
}

const dist = path.join(ROOT, arg('out', 'dist'));
const dataDir = path.join(dist, 'data');
if (!fs.existsSync(path.join(dataDir, 'meta.json'))) {
  console.error('No built dataset. Run `npm run build` first.');
  process.exit(1);
}
const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'));

const count = new Map(), examples = new Map();
let total = 0;
for (const f of fs.readdirSync(path.join(dataDir, 'spells'))) {
  const shard = JSON.parse(fs.readFileSync(path.join(dataDir, 'spells', f), 'utf8'));
  for (const id in shard) {
    for (const sl of shard[id].slots) {
      if (!sl) continue;
      total++;
      const spa = sl[0];
      count.set(spa, (count.get(spa) || 0) + 1);
      if (!examples.has(spa)) examples.set(spa, []);
      const seen = examples.get(spa);
      if (seen.length < 3 && shard[id].name) seen.push(`${shard[id].name} (#${id})`);
    }
  }
}

const eqsp = eqspLines(arg('eqsp', null));
const todo = [...count.entries()]
  .filter(([spa]) => !PHRASED.has(spa))
  .sort((a, b) => b[1] - a[1])
  .map(([spa, n]) => ({
    spa,
    name: meta.spa_names[spa] || `SPA ${spa}`,
    slots: n,
    share: n / total,
    examples: examples.get(spa) || [],
    eqspellparser: eqsp?.get(spa) || null,
  }));

const covered = [...count.entries()].filter(([spa]) => PHRASED.has(spa)).reduce((a, [, n]) => a + n, 0);
const remaining = total - covered;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total, covered, remaining, phrased: PHRASED.size, todo }, null, 2));
} else {
  console.log(`${PHRASED.size} effects phrased, covering ${(100 * covered / total).toFixed(1)}% of `
            + `${total.toLocaleString()} slots. ${todo.length} effects still read as-is `
            + `(${remaining.toLocaleString()} slots).\n`);
  if (!eqsp) console.log('Tip: --eqsp <path to an eqspellparser checkout> prints the line to port.\n');
  let run = covered;
  for (const t of todo) {
    run += t.slots;
    console.log(`${String(t.spa).padStart(3)}  ${t.name.padEnd(32)} ${String(t.slots).padStart(6)} slots  `
              + `${(100 * t.share).toFixed(2).padStart(5)}%  → ${(100 * run / total).toFixed(1)}% if done`);
    if (t.eqspellparser) console.log(`     C#: ${t.eqspellparser}`);
    if (t.examples.length) console.log(`     e.g. ${t.examples.join(', ')}`);
  }
}
