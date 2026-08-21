#!/usr/bin/env node
// Build the static dataset and site.
//
//   node tools/build.mjs                       auto-detect the EverQuest install
//   node tools/build.mjs --eq-dir "C:/..."     point at it explicitly
//   node tools/build.mjs --out dist --level 125
//   node tools/build.mjs --items vendor/items.txt   item -> spell relationships
//
// The build never touches the network. `npm run fetch` is what downloads the
// item dump; if vendor/items.txt is absent the build simply carries no item tags.
//
// Outputs:
//   dist/index.html, app.js, engine.js, spa.js, style.css
//   dist/data/meta.json       SPA names, ignore list, build stamp
//   dist/data/index.json      one small row per spell, for the search box
//   dist/data/spells/NN.json  full spell records, fetched only for the pair you pick
//   dist/data/desc/NN.json    descriptions with their template tokens resolved

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadAll, applyItemSources, isAuraEffect, CLASSES, KINDS, MAX_PLAYER_LEVEL, TARGET_NAMES, RESIST_NAMES, classMask, isBardSong, isGroupSpell } from './spells.mjs';
import { loadItems, defaultItemFile, REL } from './items.mjs';
import { load as loadClaims, byType } from './claims.mjs';
import { generate as generateSpaJs } from './gen_spa_js.mjs';
import { resolveNames, SPA_LIST_SOURCE } from './spa_names.mjs';
import { findEqDir, arg } from './eqdir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const BUCKET = 2000;

function compact(sp) {
  const rec = {
    id: sp.id, name: sp.name, levels: sp.levels, beneficial: sp.beneficial, target: sp.target,
    resist: sp.resist, duration: sp.duration, dur_calc: sp.dur_calc, dur_cap: sp.dur_cap,
    mana: sp.mana, endurance: sp.endurance, cast_ms: sp.cast_ms, recast_ms: sp.recast_ms,
    icon: sp.icon, group_id: sp.group_id, rank: sp.rank, is_skill: sp.is_skill,
    range: sp.range, ae_range: sp.ae_range,
    unstackable_dot: sp.unstackable_dot, song_window: sp.song_window, timer: sp.timer,
    kind: sp.kind,
    slots: sp.slots.map(s => s && [s.spa, s.base1, s.base2, s.calc, s.max]),
  };
  if (isAuraEffect(sp)) rec.aura = true;
  if (sp.extra) rec.extra = sp.extra;
  if (sp.categories.length) rec.categories = sp.categories;
  if (sp.stacking.length) rec.stacking = sp.stacking;
  if (sp.ext_levels.some(l => l < 255)) rec.ext_levels = sp.ext_levels;
  if (sp.refs.length) rec.refs = sp.refs.slice(0, 12);
  // [relationship bitmask, total item count, [[item id, item name, rel index], ...]]
  // Only a handful of named items ride along; the count carries the rest. The
  // bitmask is duplicated into the search index so filtering needs no shard.
  if (sp.items) rec.it = [sp.items.mask, sp.items.count, sp.items.items.map(([id, name, rel]) => [id, name, REL.indexOf(rel)])];
  return rec;
}

const writeJson = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj));

/**
 * The public address of this copy, for canonical links, share cards and the
 * sitemap — derived rather than hardcoded, so a fork does not advertise this
 * repo's URL as its own. Trailing slash included; callers append a filename.
 *
 * Returns null when there is no remote to derive it from, and the tags that
 * depend on it are then dropped rather than shipped pointing nowhere.
 */
function siteUrl(repo) {
  const m = repo && /^https:\/\/github\.com\/([^/]+)\/(.+)$/.exec(repo);
  if (!m) return null;
  const [, owner, name] = m;
  // A repo literally named <owner>.github.io is served at the domain root.
  return name.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? `https://${owner.toLowerCase()}.github.io/`
    : `https://${owner.toLowerCase()}.github.io/${name}/`;
}

/** Where this checkout came from, so the site can link people at the source. */
function repoUrl() {
  try {
    const raw = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(raw);
    return m ? `https://github.com/${m[1]}` : null;
  } catch {
    return null;   // no remote yet, or no git — the UI just omits the link
  }
}

async function main() {
  const eqDir = arg('eq-dir', findEqDir());
  if (!eqDir) {
    console.error('Could not find an EverQuest install. Pass --eq-dir explicitly.');
    process.exit(1);
  }
  const out = path.resolve(ROOT, arg('out', 'dist'));
  const level = parseInt(arg('level', String(MAX_PLAYER_LEVEL)), 10);
  console.log(`using ${eqDir}`);

  const t0 = Date.now();
  const { spells } = await loadAll(eqDir, level);
  console.log(`parsed ${spells.length} spells in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Item -> spell relationships. The client files do not record these, so they
  // come from a community dump that the repo never commits. Intersecting on the
  // spell ids we actually have is what makes stale item data degrade into fewer
  // tags instead of tags pointing at spells this build does not know about.
  const itemFile = arg('items', defaultItemFile(ROOT));
  const items = await loadItems(itemFile, new Set(spells.map(sp => sp.id)));
  if (items) {
    const { tagged, reclassified } = applyItemSources(spells, items.bySpell);
    console.log(`items: ${tagged} spells tagged from ${items.itemCount} items ` +
                `(${reclassified} reclassified, ${items.dropped} dropped as unknown, dump updated ${items.updated})`);
  } else {
    console.log(`items: ${path.relative(ROOT, itemFile)} not found — building without item tags (npm run fetch)`);
  }

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
  //    kind, class bitmask, borrowed-class bitmask, item relationship bitmask]
  // flags bit 0 beneficial, 1 combat skill (discipline), 2 bard song, 3 song window,
  //       4 group spell, 5 has a Live stacking group, 6 aura effect (no tick count,
  //       holds while the aura does — so it is a lasting effect despite duration 0)
  // The borrowed mask covers classes that reach the spell only by triggering it.
  const index = spells.map(sp => [
    sp.id, sp.name, sp.target,
    (sp.beneficial ? 1 : 0) | (sp.is_skill ? 2 : 0) | (isBardSong(sp) ? 4 : 0) |
    (sp.song_window ? 8 : 0) | (isGroupSpell(sp) ? 16 : 0) | (sp.stacking.length ? 32 : 0) |
    (isAuraEffect(sp) ? 64 : 0),
    sp.duration,
    CLASSES.map((c, i) => sp.levels[i] < 255 ? `${c} ${sp.levels[i]}` : null).filter(Boolean).join('|'),
    sp.categories[0] || '',
    KINDS.indexOf(sp.kind),
    classMask(sp.levels),
    classMask(sp.ext_levels),
    sp.items ? sp.items.mask : 0,
  ]);
  writeJson(path.join(dataDir, 'index.json'), index);

  const spaMeta = JSON.parse(fs.readFileSync(path.join(HERE, 'spa_meta.json'), 'utf8'));

  // "non-cumulative" mods: both buffs land, but the game keeps the larger value
  // instead of adding them. The list and the confidence behind each entry come
  // from claims.json, so new evidence changes what the site says without a code
  // change. See CONTRIBUTING.md.
  const claimsDoc = loadClaims();
  const nonCumulative = byType(claimsDoc, 'non_cumulative').sort((a, b) => a.spa - b.spa);
  const NON_CUMULATIVE_SPA = nonCumulative.map(c => c.spa);
  const NON_CUMULATIVE_CONFIRMED = nonCumulative.filter(c => c.status === 'confirmed').map(c => c.spa);
  const tally = claimsDoc.claims.reduce((m, c) => ({ ...m, [c.status]: (m[c.status] || 0) + 1 }), {});
  console.log('claims: ' + Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', '));
  const { names: spaNames } = resolveNames(spaMeta.spa_names);
  const meta = {
    built: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    spell_file_date: fs.statSync(path.join(eqDir, 'spells_us.txt')).mtime.toISOString().slice(0, 10),
    spell_count: spells.length,
    // null when the build ran without item data, so the UI can say "unknown"
    // rather than "no item casts this".
    items: items && {
      source: 'https://items.sodeq.org/',
      rel: REL,
      updated: items.updated,       // newest row in the dump — the data's real age
      fetched: items.fetched,       // when we last pulled it
      item_count: items.itemCount,
      spell_count: items.spellCount,
    },
    bucket: BUCKET,
    max_level: level,
    classes: CLASSES,
    kinds: KINDS,
    targets: TARGET_NAMES,
    resists: RESIST_NAMES,
    spa_names: spaNames,
    spa_names_source: SPA_LIST_SOURCE,
    ignored_in_stacking: spaMeta.ignored_in_stacking,
    non_cumulative: NON_CUMULATIVE_SPA,
    non_cumulative_confirmed: NON_CUMULATIVE_CONFIRMED,
    // Keyed by SPA for the non-cumulative notes and by claim id for the rest.
    claims: Object.fromEntries(claimsDoc.claims.flatMap(c => {
      const payload = {
        status: c.status,
        assertion: c.assertion,
        // `standing` is deliberately not shipped — it justifies the rating for a
        // reviewer reading claims.json, it is not a credential to parade on the page.
        evidence: c.evidence.map(e => ({ strength: e.strength, kind: e.kind, summary: e.summary, source: e.source, who: e.who })),
      };
      if (c.type === 'non_cumulative') return [[c.spa, payload], [c.id, payload]];
      // Rule claims are also keyed by the rule name the engine reports, so a verdict
      // can show where the rule that decided it came from.
      if (c.type === 'stacking_rule')
        return [[c.id, payload], ...(c.engine_rules || []).map(r => [`rule:${r}`, payload])];
      return [[c.id, payload]];
    })),
    claim_notes: claimsDoc.notes || {},
    repo_url: repoUrl(),
  };
  writeJson(path.join(dataDir, 'meta.json'), meta);

  // engine.js imports these as a module rather than fetching them; generated from
  // repo files only, so a clone without the game can still run the tests.
  generateSpaJs();

  // Text assets carry {{SITE_URL}} / {{BUILD_DATE}} placeholders so the address
  // is not baked into the repo. With no remote to derive one from, any line that
  // needs it is dropped — a canonical link pointing at someone else's site is
  // worse than no canonical link.
  const site = arg('site-url', siteUrl(meta.repo_url));
  const stamp = meta.built.slice(0, 10);
  const fill = (text) => (site
    ? text.replaceAll('{{SITE_URL}}', site)
    : text.split('\n').filter(l => !l.includes('{{SITE_URL}}')).join('\n')
  ).replaceAll('{{BUILD_DATE}}', stamp);

  for (const name of fs.readdirSync(path.join(ROOT, 'web'))) {
    const from = path.join(ROOT, 'web', name), to = path.join(out, name);
    if (/\.(html|xml|txt)$/.test(name)) {
      // sitemap.xml is meaningless without an address; skip it rather than ship an empty one.
      if (!site && /\.(xml)$/.test(name)) continue;
      fs.writeFileSync(to, fill(fs.readFileSync(from, 'utf8')));
    } else if (/\.(css|js|png|svg|ico|webp)$/.test(name)) {
      fs.copyFileSync(from, to);
    }
  }
  console.log(site ? `site url ${site}` : 'no git remote — canonical, share-card and sitemap links omitted');

  let total = 0;
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e =>
    e.isDirectory() ? walk(path.join(d, e.name)) : (total += fs.statSync(path.join(d, e.name)).size));
  walk(dataDir);
  console.log(`wrote ${path.relative(ROOT, out) || out}: ${(total / 1e6).toFixed(1)} MB across ${shards.size + descs.size + 2} data files`);
}

main();
