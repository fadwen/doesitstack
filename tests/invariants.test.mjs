// Rules AGENTS.md states, enforced where they can be.
//
// Documentation in this repo has gone stale twice by describing behaviour that had
// changed underneath it. Anything checkable should be checked rather than asserted,
// so a rule cannot quietly stop being true.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = f => readFile(new URL(f, root), 'utf8');

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/Users/..." —
// a leading slash and forward slashes — which is not a usable cwd, so git never
// starts. Caught by this very test failing on Windows and passing on Linux.
const repoRoot = fileURLToPath(root);

function tracked() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return null;   // no git, or not a checkout — nothing to assert about
  }
}

test('the parser imports only Node built-ins', async () => {
  const src = await read('tools/spells.mjs');
  const imports = [...src.matchAll(/^import .*? from '([^']+)'/gm)].map(m => m[1]);
  assert.ok(imports.length > 0);
  for (const i of imports)
    assert.ok(i.startsWith('node:'), `tools/spells.mjs must not import ${i} — spell values come from the client's files alone`);
});

test('claims.json never hand-writes a status', async () => {
  const raw = await read('claims.json');
  assert.doesNotMatch(raw, /"status"\s*:/, 'status is derived from evidence at load time, not stored');
});

test('the engine imposes no slot ceiling', async () => {
  const src = await read('web/engine.js');
  // the span is the larger of the two spells, floored at the legacy 12 — never capped
  assert.match(src, /Math\.max\(a\.slots\?\.length \|\| 0, b\.slots\?\.length \|\| 0, LEGACY_EFFECT_COUNT\)/);
  assert.doesNotMatch(src, /Math\.min\([^)]*slots\?\.length/, 'a min() over slot length would be a cap');
});

test('generated and licensed files are not committed', async (t) => {
  const files = tracked();
  if (!files) return t.skip('git not available, so there is no index to inspect');
  const banned = [/^dist\//, /^web\/spa\.js$/, /spells_us\.txt$/, /dbstr_us\.txt$/, /spells_us_str\.txt$/, /SpellStackingGroups\.txt$/,
                  /^vendor\//, /items\.txt$/, /itemlist\.txt$/];
  for (const f of files)
    for (const b of banned)
      assert.ok(!b.test(f), `${f} should not be committed`);
});

test('only the fetch script touches the network', async () => {
  // The build must stay offline and deterministic: CI never depends on a third
  // party being up, and two builds from the same inputs produce the same dist.
  for (const f of ['tools/build.mjs', 'tools/items.mjs', 'tools/spells.mjs', 'tools/verify_dataset.mjs']) {
    const src = await read(f);
    assert.doesNotMatch(src, /\bnode:https?\b|\bfetch\s*\(/, `${f} must not make network calls — that belongs in tools/fetch_items.mjs`);
  }
});

test('the item parser resolves dump columns by name', async () => {
  // Positional parsing of a third-party dump reads the wrong field the moment a
  // column is added or moved, and does it silently.
  const src = await read('tools/items.mjs');
  assert.match(src, /resolveColumns/);
  assert.match(src, /missing expected column/);
});

test('the verbatim reference is intact', async () => {
  const raw = await read('tools/reference/daybreak-spa-list.txt');
  assert.match(raw, /^# Daybreak's enumerated SPA list/m);
  // underscores and publisher capitalisation preserved, not tidied into prose
  assert.match(raw, /^124 - Fc_Damage_%$/m);
  assert.match(raw, /^148 - StackingBlocker$/m);
  assert.match(raw, /^528 - Fc_Banestrike$/m);
});

test('every command AGENTS.md names actually exists', async () => {
  const doc = await read('AGENTS.md');
  const pkg = JSON.parse(await read('package.json'));
  const named = [...new Set([...doc.matchAll(/npm run ([a-z:]+)/g)].map(m => m[1]))];
  assert.ok(named.length >= 4, 'expected AGENTS.md to document the main commands');
  for (const s of named)
    assert.ok(pkg.scripts[s], `AGENTS.md tells an agent to run "npm run ${s}", which package.json does not define`);
});

test('AGENTS.md points at the reasoning rather than restating it', async () => {
  const doc = await read('AGENTS.md');
  assert.match(doc, /CONTRIBUTING\.md/);
  assert.ok(doc.split('\n').length < 90, 'keep it short — a long one drifts from CONTRIBUTING.md');
});
