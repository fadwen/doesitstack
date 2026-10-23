// The numbers the docs quote are the numbers the repo derives.
//
// README.md has gone stale three times by quoting a count that the next patch, the
// next piece of evidence or the next phrasing changed underneath it: "nine of the
// ten non-cumulative claims", "70,963 spells", "93.4% of the slots". Nobody edits a
// README on patch day. So the counts are held to their sources here — claims.json
// for the tally of claims, the built dataset for everything read from the game —
// and a stale sentence fails a test instead of misleading a reader.
//
// The claim tally needs no game files. The dataset half skips itself without a build,
// like every other suite that reads dist/.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load } from '../tools/claims.mjs';
import { PHRASED } from '../web/phrasing.js';
import { META, DATA, SKIP } from './load.mjs';

const root = new URL('../', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const rx = (s, flags = '') => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'), flags);
const n = x => x.toLocaleString('en-US');

const WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
              'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
              'nineteen', 'twenty'];
const cap = w => w[0].toUpperCase() + w.slice(1);

test('the non-cumulative tally in the docs is the one claims.json derives', () => {
  const nc = load().claims.filter(c => c.type === 'non_cumulative');
  const tally = {};
  for (const c of nc) tally[c.status] = (tally[c.status] || 0) + 1;
  const total = WORD[nc.length], unverified = WORD[tally.unverified || 0], confirmed = WORD[tally.confirmed || 0];

  const readme = read('README.md'), contributing = read('CONTRIBUTING.md'), agents = read('AGENTS.md');

  // Each sentence that states a count, held to the count.
  assert.match(readme, rx(`${cap(total)} are claimed.`));
  assert.match(readme, rx(`and ${unverified} of the ${total} claims still have nothing else behind them`));
  assert.match(readme, rx(`The other ${unverified} rest on uncited emulator code`));
  assert.match(readme, rx(`The site marks those ${unverified} unverified`));
  assert.match(readme, rx(`**Unverified** (the ${unverified})`));
  assert.match(readme, rx(`settle one of the ${unverified},`));
  assert.match(readme, rx(`${cap(unverified)} of the ${total} non-cumulative claims here are \`unverified\``));
  assert.match(readme, rx(`${cap(unverified)} of the ${total} non-cumulative SPAs rest on uncited`));
  assert.match(contributing, rx(`exactly ${confirmed} of the ${total} non-cumulative claims has a primary source`));
  assert.match(contributing, rx(`The other ${unverified} rest on a reading of the EQEmu`));
  assert.match(agents, rx(`resting on ${unverified} unverified non-cumulative claims`));

  // And no sentence anywhere states a different one. "N of the M non-cumulative" is
  // the shape every stale version took.
  for (const [file, text] of [['README.md', readme], ['CONTRIBUTING.md', contributing], ['AGENTS.md', agents]])
    for (const m of text.matchAll(/\b(\w+) of the (\w+) non-cumulative/gi)) {
      const [a, b] = [m[1].toLowerCase(), m[2].toLowerCase()];
      assert.ok(b === total, `${file}: "${m[0]}" — there are ${total} non-cumulative claims`);
      assert.ok([unverified, confirmed, WORD[tally.corroborated || 0]].includes(a),
        `${file}: "${m[0]}" — no status has ${a} claims (tally: ${JSON.stringify(tally)})`);
    }

  // The only confirmed one is named as such.
  assert.equal(tally.confirmed, 1);
  assert.match(readme, rx('**Confirmed** (496 only)'));
});

test('the counts the README quotes from the game are the dataset\'s', SKIP, () => {
  const readme = read('README.md'), contributing = read('CONTRIBUTING.md');

  // Spell count. Anything past fifty thousand followed by "spells" is it; the item
  // tally ("10,675 spells tagged") is checked on its own below.
  for (const [file, text] of [['README.md', readme], ['CONTRIBUTING.md', contributing]])
    for (const m of text.matchAll(/\b(\d{2},\d{3})\s+spells\b/g)) {
      if (parseInt(m[1].replace(',', ''), 10) < 50000) continue;
      assert.equal(m[1], n(META.spell_count), `${file} says "${m[0]}"; the file has ${n(META.spell_count)}`);
    }

  // The source buckets.
  const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
  const count = kind => index.filter(r => META.kinds[r[7]] === kind).length;
  assert.match(readme, rx(`**Item** — an item demonstrably casts it. ${n(count('item'))} rows.`));
  assert.match(readme, rx(`it. ${n(count('other'))} rows. Unexplained rather than absent`));
  assert.match(readme, rx(`**Unattributed** is still a residual — ${n(count('other'))} rows`));
  assert.match(contributing, rx(`${n(count('other'))} rows that no class learns`));
  assert.match(readme, rx(`That buys ${n(META.items.spell_count)} spells tagged`));

  // Phrasing coverage, computed the way the build prints it: over every non-empty
  // slot in the file.
  let seen = 0, phrased = 0;
  const spas = new Set();
  for (const f of fs.readdirSync(path.join(DATA, 'spells'))) {
    const shard = JSON.parse(fs.readFileSync(path.join(DATA, 'spells', f), 'utf8'));
    for (const id in shard)
      for (const s of shard[id].slots || [])
        if (s) { seen++; spas.add(s[0]); if (PHRASED.has(s[0])) phrased++; }
  }
  const pct = (100 * phrased / seen).toFixed(1);
  const asIs = [...spas].filter(s => !PHRASED.has(s)).length;
  assert.match(readme, rx(`**${PHRASED.size} effects have a phrasing, covering ${Math.round(pct)}% of the slots`));
  assert.match(readme, new RegExp(`(^|\\n)${asIs} effects still read as-is`));
  assert.match(readme, rx(`Plain wording covers ${pct}% of the slots in the current file. The ${asIs} effects without it`));
});
