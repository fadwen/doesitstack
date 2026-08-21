import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(root, 'dist', 'data');
export const META = JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'));
const shards = new Map();

export function spell(id) {
  const b = Math.floor(id / META.bucket);
  if (!shards.has(b)) shards.set(b, JSON.parse(fs.readFileSync(path.join(DATA, 'spells', `${b}.json`), 'utf8')));
  const rec = shards.get(b)[id];
  if (!rec) throw new Error(`spell ${id} not in dataset`);
  return { ...rec, stacking: rec.stacking || [],
           slots: (rec.slots || []).map(s => s && { spa: s[0], base1: s[1], base2: s[2], calc: s[3], max: s[4] }) };
}

let indexCache = null;
export function index() {
  if (!indexCache) indexCache = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
  return indexCache;
}

export function byName(re) {
  return index().filter(r => re.test(r[1]));
}

export const ROW = { id: 0, name: 1, target: 2, flags: 3, duration: 4, levels: 5, category: 6,
                     kind: 7, classMask: 8, extMask: 9 };
