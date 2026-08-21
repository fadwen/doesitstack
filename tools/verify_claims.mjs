#!/usr/bin/env node
// Re-derive every checkable piece of evidence from the local spell files.
//
//   node tools/verify_claims.mjs [--eq-dir "C:/..."]
//
// Evidence that carries a `check` block is not taken on trust: this recomputes it
// and fails if the numbers no longer hold. Run it before opening a PR, and after
// a patch day — the game changes, and a claim that was true in 2024 may not be.

import { load } from './claims.mjs';
import { loadAll } from './spells.mjs';
import { findEqDir, arg } from './eqdir.mjs';

const CHECKS = {
  // "every spell whose description contains PHRASE carries SPA, and none carries
  // the phrase without it" — the shape of the SPA 496 evidence.
  'desc-phrase-implies-spa'(spells, { phrase, spa }) {
    const rx = new RegExp(phrase.replace(/[-[\]{}()*+?.\\^$|]/g, '\\$&').replace(/\\-/g, '-?'), 'i');
    const says = spells.filter(s => rx.test(s.desc));
    const withSpa = spells.filter(s => s.slots.some(sl => sl && sl.spa === spa));
    const saysWithout = says.filter(s => !s.slots.some(sl => sl && sl.spa === spa));
    return {
      ok: says.length > 0 && saysWithout.length === 0,
      detail: `${says.length} description(s) say "${phrase}"; ${withSpa.length} spell(s) carry SPA ${spa}; `
            + `${saysWithout.length} say it without SPA ${spa}`,
    };
  },
};

const eqDir = arg('eq-dir', findEqDir());
if (!eqDir) {
  console.error('Could not find an EverQuest install. Pass --eq-dir explicitly.');
  process.exit(1);
}

const doc = load();
const { spells } = await loadAll(eqDir);
console.log(`claims.json is structurally valid — ${doc.claims.length} claims\n`);

let checked = 0, failed = 0;
for (const claim of doc.claims) {
  const checks = claim.evidence.filter(e => e.check);
  const mark = { confirmed: 'confirmed ', unverified: 'unverified', disputed: 'DISPUTED  ' }[claim.status];
  console.log(`  [${mark}] ${claim.id}  (${claim.evidence.length} evidence, ${checks.length} machine-checkable)`);
  for (const e of checks) {
    const fn = CHECKS[e.check.id];
    if (!fn) { console.log(`      ! unknown check "${e.check.id}"`); failed++; continue; }
    const { ok, detail } = fn(spells, e.check);
    checked++;
    if (!ok) failed++;
    console.log(`      ${ok ? 'PASS' : 'FAIL'}  ${detail}`);
  }
}

console.log(`\n${checked} check(s) run, ${failed} failed.`);
if (failed) {
  console.error('Evidence no longer holds against this spell file. Do not ship this claim as written.');
  process.exit(1);
}
