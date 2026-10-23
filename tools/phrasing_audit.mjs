#!/usr/bin/env node
// Which phrased lines no longer match rumstil/eqspellparser.
//
//   node tools/phrasing_audit.mjs --eqsp ../eqspellparser
//   node tools/phrasing_audit.mjs --eqsp ../eqspellparser --all
//
// phrasing_todo.mjs answers "what is still unported". This answers the question
// that went unasked for longer: "what was ported wrongly, or never ported at
// all and written from the SPA name instead". SPA 147 read "Heal to -25% of Max
// HP" for months because nothing compared the two.
//
// Two buckets:
//   MISMATCH — the label itself disagrees. Almost always a real defect.
//   THINNER  — same label, but the source says more (a cap, a PvP figure, a
//              second clause). Usually information dropped, occasionally a
//              deliberate simplification.
//
// It is a text comparison of source lines, not of output, so it flags a little
// more than it should. That is the right side to err on.

import fs from 'node:fs';
import { arg } from './eqdir.mjs';
import { eqspCases, spellDataFile } from './eqsp_cases.mjs';

const dir = arg('eqsp', null);
if (!dir) {
  console.error('Needs a checkout of rumstil/eqspellparser: --eqsp <dir>');
  process.exit(2);
}
const file = spellDataFile(dir);
if (!file) {
  console.error(`No SpellData.cs under ${dir}`);
  process.exit(2);
}

// A divergence is exempt only if the comment immediately above it says
// "deliberate divergence" and then says why. The exemption is the reason.
function jsLines(src) {
  const lines = src.split(/\r?\n/), out = new Map(), waived = new Set();   // a Windows checkout is CRLF
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*case (\d+):\s*(?:return )?(.+)$/.exec(lines[i]);
    if (!m || out.has(+m[1])) continue;
    out.set(+m[1], m[2].trim());
    for (let j = i - 1; j >= 0 && /^\s*\/\//.test(lines[j]); j--)
      if (/deliberate divergence/i.test(lines[j])) { waived.add(+m[1]); break; }
  }
  return { out, waived };
}

// The words of the label, minus the scaffolding of either language and minus the
// direction words, which both sides derive from the sign rather than state.
const NOISE = new Set(['string', 'format', 'spell', 'formatcount', 'formatpercent', 'formatenum',
  'formatcountrange', 'formatpercentrange', 'increase', 'decrease', 'by', 'up', 'to', 'of', 'the',
  'and', 'with', 'math', 'abs', 'round', 'null', 'true', 'false', 'pct', 'num', 'base', 'value',
  'calc', 'max', 'int', 'float', 'skill', 'effectname', 'names', 'spa']);
const words = s => new Set(((s.match(/"[^"]*"|'[^']*'|`[^`]*`/g) || []).join(' ')
  .match(/[A-Za-z]{2,}/g) || []).map(w => w.toLowerCase()).filter(w => !NOISE.has(w)));

const eq = eqspCases(fs.readFileSync(file, 'utf8'));
const { out: mine, waived } = jsLines(fs.readFileSync(new URL('../web/phrasing.js', import.meta.url), 'utf8'));

const mismatch = [], thinner = [];
for (const [spa, line] of [...mine].sort((a, b) => a[0] - b[0])) {
  const e = eq.get(spa);
  if (!e || line === 'null;' || waived.has(spa)) continue;
  const a = words(line), b = words(e);
  if (!a.size || !b.size) continue;
  const shared = [...a].filter(w => b.has(w));
  if (!shared.length) mismatch.push({ spa, line, e });
  else if ([...b].some(w => !a.has(w))) thinner.push({ spa, line, e });
}

const all = process.argv.includes('--all');
const show = (title, rows) => {
  console.log(`\n${title} — ${rows.length}`);
  for (const r of rows) console.log(`  SPA ${r.spa}\n    here: ${r.line}\n    eqsp: ${r.e}`);
};
console.log(`${mine.size} phrased, ${[...mine.keys()].filter(k => eq.has(k)).length} comparable, `
  + `${waived.size} documented as deliberate`);
show('MISMATCH — the labels disagree', mismatch);
if (all) show('THINNER — the source says more', thinner);
else console.log(`\nTHINNER — ${thinner.length} (pass --all to list)`);
process.exit(mismatch.length ? 1 : 0);
