import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_PLAYER_LEVEL } from '../web/spa.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(root, 'dist', 'data');

// The dataset is built from a licensed EverQuest install, so it is absent on a
// fresh clone and in CI. Suites that need it skip instead of failing; the
// fixture-based suites cover the engine either way.
export const HAS_DATASET = fs.existsSync(path.join(DATA, 'meta.json'));
export const META = HAS_DATASET ? JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8')) : null;

// dist/ is a build artifact, so it can lag the source it was built from. Comparing
// the level cap catches the common case — someone changed a constant and has not
// rebuilt — and turns what would be a baffling assertion failure into an
// instruction. Without this the first symptom is "125 !== 130" with no hint why.
const STALE = HAS_DATASET && META.max_level !== MAX_PLAYER_LEVEL;

export const SKIP =
  !HAS_DATASET ? { skip: 'no built dataset — run `npm run build` with EverQuest installed' }
  : STALE      ? { skip: `dist/ was built at level ${META.max_level} but the source says ${MAX_PLAYER_LEVEL} — run \`npm run build\`` }
  : {};

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
