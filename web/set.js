// The set view: a whole buff bar at once rather than a pair.
//
// It answers two questions and refuses a third. Which of these cannot be up at
// the same time, and which effects do several of them carry where only one
// counts — but not which set is best. See analyzeSet() in engine.js for why that
// last one is left alone.

import { analyzeSet } from './engine.js';
import {
  $, el, link, RAIDLOOT, THIRD_PARTY_LAG, search, spellById, load as loadData,
  getReading, named, notInFile, notLoaded,
} from './data.js';
import {
  DEFAULT_KINDS, readLevel, noticeLine, dataFailed, buildFilters, searchFilters, wireReadingBox,
  wirePicker, renderFooter,
} from './ui.js';
import { readSets, writeSets, upsert, removeSet, findSet, sameSet, cleanName } from './saved.js';
import { PRESETS, findPreset } from './presets.js';
import { phrase } from './phrasing.js';

let META;
const chosen = [];                                     // spells, in the order added
const active = { kinds: new Set(DEFAULT_KINDS), cls: -1 };
const MAX_SET = 100;                                   // far past a real buff bar
let rerunSearch = () => {};                            // from wirePicker(), once booted

// Saved sets live in this browser only. The URL already carries a set, so that
// stays the way to move one between machines or send it to someone.
const store = (() => { try { return window.localStorage; } catch { return null; } })();
let saved = [];
// Which saved set the live one came from, so drifting away from it can be shown
// and undone. That round trip — load the standard set, pile things on to see
// what they cost, put it back — is the whole reason saving is here.
let loadedFrom = null;
// Ids in that set which this spell file does not have. A set saved under an
// older file can name spells that were since removed or renumbered; without
// this it read as "Changed — 1 removed" the moment it loaded, and Revert
// reloaded the same thing.
let unresolved = [];
let storageWarned = false;

// A static element below the saved sets, not part of what render() redraws —
// it was created inside that region, so the one-time storage warning was wiped
// by the render that followed it and nobody ever saw it. Cleared by the next
// change to the set, so it describes the current state and no other.
const { alertLine, clearLine } = noticeLine('#saved-note');

async function boot() {
  try { ({ META } = await loadData()); }
  catch (err) { dataFailed(err); return; }
  saved = readSets(store);
  renderFooter();
  $('#lvl').max = META.max_level;
  $('#lvl').value = META.max_level;
  buildFilters(active, () => rerunSearch());
  rerunSearch = wirePicker($('#q'), $('#results'),
    // already in the set
    q => search(q, { ...searchFilters(active), exclude: new Set(ids()) }),
    id => { $('#q').value = ''; add(id); });
  $('#clear').onclick = () => { chosen.length = 0; loadedFrom = null; unresolved = []; sync(); };
  $('#lvl').addEventListener('change', render);
  wireReadingBox(render);
  for (const id of ['#f-buffs', '#f-benef']) $(id).addEventListener('change', () => rerunSearch());
  $('#why-no-score').textContent = NO_SCORE;
  window.addEventListener('hashchange', fromHash);
  await fromHash();
  // fromHash returns early when the hash already matches what is loaded, which on
  // a first visit with no hash means "nothing to do" — so nothing had ever drawn
  // the set list. Harmless while an empty page really was empty; not once presets
  // needed to be on it.
  render();
}

const NO_SCORE =
  'Ranking buff sets by damage needs a model of how these values combine into a number — '
  + 'the spell, AA and worn bonus buckets, which effects add and which keep only the larger, '
  + 'which focus wins a cast. Nine of the ten non-cumulative claims here are unverified and '
  + 'the focus rule is corroborated rather than confirmed, so a damage figure would look far '
  + 'more authoritative than the evidence behind it. This tool shows you what is being wasted '
  + 'and leaves the arithmetic to you.';


// ---------- the set ---------------------------------------------------------

async function add(id) {
  if (chosen.some(s => s.id === id) || chosen.length >= MAX_SET) return;
  const { found, failed } = await resolve([id]);
  if (found.length) { chosen.push(found[0]); sync(); }
  if (failed.length) alertLine(notLoaded(failed));
}

/**
 * Fetch spells by id, in order, sorting the ones that did not come back into
 * two piles the page describes differently: not in this spell file at all, or
 * not loadable just now. Sequential rather than parallel: shard fetches are
 * cached per bucket, so a 40-buff set is a handful of requests either way.
 */
async function resolve(ids) {
  const found = [], missing = [], failed = [];
  for (const id of ids) {
    try {
      const sp = await spellById(id);
      if (sp) found.push(sp); else missing.push(id);
    } catch { failed.push(id); }
  }
  return { found, missing, failed };
}

// ---------- saved sets ------------------------------------------------------

const ids = () => chosen.map(s => s.id);
// A personal set shadows a preset of the same name — yours wins for you, and the
// preset is untouched for everyone else.
const anySet = (name) => findSet(saved, name) || findPreset(name);
const baseline = () => (loadedFrom ? anySet(loadedFrom) : null);
const isPreset = (name) => !findSet(saved, name) && !!findPreset(name);
// What the loaded set amounts to in this spell file. Drift is measured against
// this, not the saved list, or an id the file lost would count as your change.
const baselineIds = () => baseline().ids.filter(id => !unresolved.includes(id));
const drifted = () => (baseline() ? !sameSet(baselineIds(), ids()) : false);

function persist(next) {
  saved = next;
  if (!writeSets(store, saved) && !storageWarned) {
    storageWarned = true;
    // Better to say it once than to let someone build a set, save it, and find
    // it gone after a reload.
    alertLine('Could not save — this browser is blocking site data, so sets will '
            + 'not survive a reload. The link in your address bar still holds the set.');
  }
  render();
}

const saveAs = (name) => {
  const clean = cleanName(name);
  if (!clean || !chosen.length) return;
  loadedFrom = clean;
  unresolved = [];          // the saved copy is exactly what is on screen
  persist(upsert(saved, clean, ids()));
};

async function loadSet(name) {
  const s = anySet(name);
  if (!s) return;
  const { found, missing, failed } = await resolve(s.ids);
  chosen.length = 0;
  chosen.push(...found);
  loadedFrom = s.name;
  unresolved = missing;
  sync();
  if (failed.length) alertLine(notLoaded(failed));
}

const remove = id => {
  const i = chosen.findIndex(s => s.id === id);
  if (i > -1) { chosen.splice(i, 1); sync(); }
};

function sync() {
  clearLine();
  const want = chosen.length ? '#set=' + chosen.map(s => s.id).join(',') : '';
  if (location.hash !== want) history.replaceState(null, '', want || location.pathname);
  render();
}

async function fromHash() {
  const param = new URLSearchParams(location.hash.slice(1)).get('set');
  const want = (param || '').split(',').map(n => parseInt(n, 10)).filter(Boolean).slice(0, MAX_SET);
  if (want.join(',') === ids().join(',')) return;
  const { found, missing, failed } = await resolve(want);
  chosen.length = 0;
  chosen.push(...found);
  // An id that is not in this spell file is dropped from the link and said to
  // be missing. One that would not load stays in it, so a reload tries again.
  if (missing.length) sync(); else { clearLine(); render(); }
  const said = [missing.length && notInFile(missing), failed.length && notLoaded(failed)].filter(Boolean);
  if (said.length) alertLine(said.join(' '));
}

// ---------- rendering -------------------------------------------------------

function render() {
  renderSaved();
  const list = $('#setlist'); list.innerHTML = '';
  $('#clear').hidden = !chosen.length;
  $('#empty').hidden = chosen.length > 0;
  if (!chosen.length) { $('#report').hidden = true; return; }

  const res = analyzeSet(chosen, { level: readLevel() });
  const conflicted = new Set(res.conflicts.flatMap(c => [c.a, c.b]));

  const head = el('div', 'set-head');
  head.appendChild(el('h3', 'sec', `${chosen.length} in the set`));
  list.appendChild(head);
  const ul = el('div', 'set-chips');
  for (const sp of chosen) {
    const c = el('span', 'setchip' + (conflicted.has(sp.id) ? ' bad' : ''));
    c.appendChild(el('span', 'setchip-name', sp.name));
    const x = el('button', 'setchip-x', '×');
    x.title = `Remove ${sp.name}`;
    x.onclick = () => remove(sp.id);
    c.appendChild(x);
    ul.appendChild(c);
  }
  list.appendChild(ul);

  renderReport(res);
}

function renderSaved() {
  const box = $('#saved'); box.innerHTML = '';
  if (!saved.length && !chosen.length && !PRESETS.length) return;

  if (PRESETS.length) {
    const presetRow = el('div', 'frow');
    presetRow.appendChild(el('span', 'flabel', 'Sets'));
    const chips = el('div', 'chips');
    for (const p of PRESETS) {
      // Hidden once you have saved your own under the same name — at that point
      // the chip below is yours and loading the original would be confusing.
      if (findSet(saved, p.name)) continue;
      const wrap = el('span', 'setchip' + (p.name === loadedFrom ? ' on' : ''));
      const open = el('button', 'setchip-name as-button', `${p.name} (${p.ids.length})`);
      open.title = p.note ? `${p.note}\n\nLoad it, change it, and you can always get back.` : `Load ${p.name}`;
      open.onclick = () => loadSet(p.name);
      wrap.appendChild(open);
      wrap.appendChild(el('span', 'setchip-tag', 'built in'));
      chips.appendChild(wrap);
    }
    if (chips.children.length) { presetRow.appendChild(chips); box.appendChild(presetRow); }
  }

  const rowEl = el('div', 'frow');
  rowEl.appendChild(el('span', 'flabel', 'Saved'));
  const chips = el('div', 'chips');

  for (const s of saved) {
    const wrap = el('span', 'setchip' + (s.name === loadedFrom ? ' on' : ''));
    const open = el('button', 'setchip-name as-button', `${s.name} (${s.ids.length})`);
    open.title = `Load ${s.name}`;
    open.onclick = () => loadSet(s.name);
    wrap.appendChild(open);
    const del = el('button', 'setchip-x', '×');
    del.title = `Forget ${s.name}`;
    del.onclick = () => {
      if (loadedFrom === s.name) loadedFrom = null;
      persist(removeSet(saved, s.name));
    };
    wrap.appendChild(del);
    chips.appendChild(wrap);
  }

  if (chosen.length) {
    const name = el('input', 'search saveas');
    name.type = 'text';
    name.placeholder = loadedFrom ? `Save as… (${loadedFrom} loaded)` : 'Save this set as…';
    name.maxLength = 40;
    name.onkeydown = e => { if (e.key === 'Enter') { saveAs(name.value); name.value = ''; } };
    const go = el('button', 'chip wide', 'Save');
    go.onclick = () => { saveAs(name.value); name.value = ''; };
    chips.appendChild(name);
    chips.appendChild(go);
  }
  rowEl.appendChild(chips);
  box.appendChild(rowEl);

  // Said before any talk of drift, because it is the file's change, not yours.
  if (unresolved.length && baseline()) {
    const b = baseline(), n = unresolved.length;
    box.appendChild(el('p', 'legend',
      `${n} of the ${b.ids.length} in ${b.name} no longer resolve${n === 1 ? 's' : ''} in this spell file `
      + `(dated ${META.spell_file_date}): ${unresolved.join(', ')}. `
      + `${n === 1 ? 'It' : 'They'} may have been removed or renumbered; saving your version drops ${n === 1 ? 'it' : 'them'}.`));
  }

  // The experiment round trip: you loaded something, you have changed it, and
  // you want either to go back or to keep the change.
  if (drifted()) {
    const b = baseline();
    const n = chosen.length - baselineIds().length;
    const note = el('div', 'frow drift');
    note.appendChild(el('span', null,
      `Changed from ${b.name} — ${n > 0 ? `${n} added` : n < 0 ? `${-n} removed` : 'same size, different spells'}.`));
    const revert = el('button', 'chip wide', `Revert to ${b.name}`);
    revert.onclick = () => loadSet(b.name);
    const own = isPreset(b.name);
    const update = el('button', 'chip wide', own ? 'Save my version' : `Update ${b.name}`);
    update.title = own
      ? `Keeps your own copy under this name. It takes precedence for you and leaves the built-in set alone.`
      : `Overwrite ${b.name} with what is on screen.`;
    update.onclick = () => saveAs(b.name);
    note.appendChild(revert);
    note.appendChild(update);
    box.appendChild(note);
  }

  if (chosen.length) {
    const share = el('button', 'chip wide', 'Copy link to this set');
    share.onclick = async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        share.textContent = 'Link copied';
        setTimeout(() => { share.textContent = 'Copy link to this set'; }, 1500);
      } catch {
        // Clipboard access is refused in plenty of contexts; the URL bar already
        // holds the set, so say that rather than failing silently.
        alertLine('Could not reach the clipboard — the address bar already holds this set, copy it from there.');
      }
    };
    const shareRow = el('div', 'frow');
    shareRow.appendChild(share);
    box.appendChild(shareRow);
  }
}

function spellLink(name, id) {
  const a = link(RAIDLOOT(id), name);
  a.title = `${name} on Raidloot. ${THIRD_PARTY_LAG}`;
  return a;
}

/** "A, B and C" with each name linked. */
function nameList(parent, members) {
  members.forEach((m, i) => {
    if (i) parent.appendChild(document.createTextNode(i === members.length - 1 ? ' and ' : ', '));
    parent.appendChild(spellLink(m.name, m.id));
  });
}

function renderReport(res) {
  const box = $('#report'); box.hidden = false; box.innerHTML = '';

  // --- can they all be up at once? -----------------------------------------
  box.appendChild(el('h3', 'sec', 'Holding them all'));
  if (res.allHold) {
    const ok = el('div', 'out independent', `All ${res.count} can be up at the same time.`);
    box.appendChild(ok);
  } else {
    box.appendChild(el('div', 'out blocked',
      `${res.conflicts.length} pair${res.conflicts.length === 1 ? '' : 's'} cannot both be up.`));
    const t = el('table', 'slots');
    t.innerHTML = '<thead><tr><th>These two</th><th>Casting the first, then the second</th><th>The other way round</th></tr></thead>';
    const body = el('tbody');
    for (const c of res.conflicts) {
      const tr = el('tr', 'hit');
      const pair = el('td');
      pair.appendChild(spellLink(c.aName, c.a));
      pair.appendChild(el('div', 'spa', 'and'));
      pair.appendChild(spellLink(c.bName, c.b));
      tr.appendChild(pair);
      for (const dir of [c.aThenB, c.bThenA]) {
        const td = el('td');
        td.appendChild(el('div', 'dirverdict', { overwrite: 'The second overwrites the first', blocked: 'The second is refused', independent: 'Both hold' }[dir.verdict]));
        td.appendChild(el('div', 'spa', dir.reason));
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    t.appendChild(body);
    const scroll = el('div', 'table-scroll'); scroll.appendChild(t);
    box.appendChild(scroll);
    box.appendChild(el('p', 'legend',
      'Which one you end up holding depends on cast order, so this names the pair rather than picking for you.'));
  }

  // --- what overlaps --------------------------------------------------------
  box.appendChild(el('h3', 'sec', 'Effects more than one of them carries'));
  const groups = [...res.nonCumulative, ...res.focusBestOnly];
  if (!groups.length && !res.focusProcs.length) {
    box.appendChild(el('p', 'legend', 'Nothing in this set doubles up — every effect here comes from one source.'));
  }

  for (const g of res.nonCumulative) box.appendChild(nonCumulativeGroup(g));
  for (const g of res.focusBestOnly) box.appendChild(focusGroup(g));
  for (const g of res.focusProcs) box.appendChild(procGroup(g));

  if (groups.length || res.focusProcs.length) box.appendChild(el('p', 'legend', NO_SCORE));
}

function groupShell(cls, title, subtitle) {
  const n = el('div', 'note ' + cls);
  const h = el('div', 'row1');
  h.appendChild(el('h4', null, title));
  n.appendChild(h);
  if (subtitle) n.appendChild(el('p', null, subtitle));
  return n;
}

function nonCumulativeGroup(g) {
  const status = META.claims?.[g.spa]?.status || 'unverified';
  // The one that applies is named in every case the data allows, and the sentence
  // says what that naming rests on. Saying nothing was the worse option: a set of
  // four haste buffs where one is plainly the biggest is exactly what someone opens
  // this page to find out.
  const said = g.mixed
    ? 'These do not add, but they are on opposite sides of zero — a bonus against a penalty. '
      + 'They never displace each other on their own terms, so which one stands depends on the '
      + 'order the server applied them in, and none is marked.'
    : {
      confirmed: 'These do not add. Only the value furthest from zero applies, so the rest are '
        + 'doing nothing while all of them are up.',
      disputed: 'Only one of these applies, if they do not add — but the sources disagree. It is '
        + 'reported from play that only the better value counts, while the EQEmu server adds them '
        + 'together instead. The one marked is the one the first reading would keep.',
      corroborated: 'These do not add — only the value furthest from zero applies. That rests on '
        + 'corroborating evidence rather than a settled source.',
      unverified: 'These do not add — only the value furthest from zero applies. That they do not '
        + 'add is unverified: it rests on EQEmu\u2019s bonus accumulation, which nothing in that '
        + 'project backs up.',
    }[status];
  const n = groupShell('note-doubt', `${g.members.length} carry ${g.name}`, said);
  const ul = el('ul', 'group-members');
  const soft = status !== 'confirmed' ? ' nc-soft' : '';
  for (const m of g.members) {
    // Same language as the pair view's slot table, so the colours mean one thing
    // across the site: green applies, struck-through is ignored, orange unknown,
    // and faint wherever the claim behind it is not settled.
    const cls = m.applies === true ? 'nc-wins' + soft
      : m.applies === false ? 'nc-loses' + soft : 'nc-unsure';
    const li = el('li');
    const s = el('span', cls);
    s.appendChild(spellLink(m.name, m.id));
    li.appendChild(s);
    li.appendChild(el('span', 'src', ` ${m.value} · slot ${m.slots.map(x => x + 1).join(', ')}`));
    ul.appendChild(li);
  }
  n.appendChild(ul);
  if (!g.coexist) n.appendChild(el('p', 'src', 'Some of these cannot be up at once — see the conflicts above, since resolving one may remove the overlap.'));
  return n;
}

function focusGroup(g) {
  const n = groupShell('', `${g.members.length} carry ${g.name}`,
    'Only the best focus applies to any one cast, so these do not add up. They can still all be doing work if their limiters send them at different spells — which is why the limiters are listed.');
  const ul = el('ul', 'group-members');
  for (const m of g.members) {
    const li = el('li');
    li.appendChild(spellLink(m.name, m.id));
    li.appendChild(el('span', 'src', ` ${m.value}`));
    if (m.limiters.length) {
      // A focus often carries the same limiter several times over — five
      // Ff_TargetType slots naming five allowed targets. Five identical chips
      // say less than one chip and a count, with the values in the tooltip.
      const lim = el('div', 'limiters');
      if (getReading() === 'phrased') {
        // Each limiter says something different, so there is nothing to collapse —
        // "Limit Target: Exclude Caster AE" and "Exclude Caster PB" are the point.
        for (const l of m.limiters) {
          const said = phrase({ spa: l.spa, base1: l.base1, base2: l.base2, calc: 100, max: 0 }, l.base1, META.spa_names);
          // "Limit Spell: [Spell 6097]" tells a reader nothing they can act on.
          // A chip has nowhere to expand into, so it gets the name in the text.
          const chip = el('span', 'badge rel', said ? named(said) : l.name);
          chip.title = `${l.name} (SPA ${l.spa}) · base ${l.base1}`;
          lim.appendChild(chip);
        }
      } else {
        // Exact reading: the same limiter often repeats, and five identical chips
        // say less than one chip and a count.
        const byName = new Map();
        for (const l of m.limiters) {
          if (!byName.has(l.spa)) byName.set(l.spa, { ...l, values: [] });
          byName.get(l.spa).values.push(l.base1);
        }
        for (const l of byName.values()) {
          const label = l.name.replace(/^Ff_/, '');
          const chip = el('span', 'badge rel', l.values.length > 1 ? `${label} ×${l.values.length}` : label);
          chip.title = `${l.name} (SPA ${l.spa}) · ${l.values.length > 1 ? 'values' : 'base'} ${l.values.join(', ')}`;
          lim.appendChild(chip);
        }
      }
      li.appendChild(lim);
    } else {
      li.appendChild(el('div', 'src', 'no limiters — applies to everything this focus can'));
    }
    ul.appendChild(li);
  }
  n.appendChild(ul);
  if (!g.coexist) n.appendChild(el('p', 'src', 'Some of these cannot be up at once, so they may never actually compete.'));
  return n;
}

function procGroup(g) {
  const n = groupShell('', `${g.members.length} carry ${g.name}`,
    'This one is the exception: proc-type foci all fire independently, so these do add.');
  const p = el('p');
  nameList(p, g.members);
  n.appendChild(p);
  return n;
}

boot();
