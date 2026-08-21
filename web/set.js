// The set view: a whole buff bar at once rather than a pair.
//
// It answers two questions and refuses a third. Which of these cannot be up at
// the same time, and which effects do several of them carry where only one
// counts — but not which set is best. See analyzeSet() in engine.js for why that
// last one is left alone.

import { analyzeSet, calcValue, slotOf } from './engine.js';
import { dataAge, itemDataAge } from './freshness.js';
import {
  $, el, link, LUCY, F_BENEFICIAL, row,
  KIND_LABEL, kindHelp, search, spellById, load as loadData,
} from './data.js';
import { readSets, writeSets, upsert, removeSet, findSet, sameSet, cleanName } from './saved.js';

let META, INDEX;
const chosen = [];                                     // spells, in the order added
const DEFAULT_KINDS = ['spell', 'discipline', 'song', 'aa', 'item', 'other'];
const active = { kinds: new Set(DEFAULT_KINDS), cls: -1 };
const MAX_SET = 100;                                   // far past a real buff bar

// Saved sets live in this browser only. The URL already carries a set, so that
// stays the way to move one between machines or send it to someone.
const store = (() => { try { return window.localStorage; } catch { return null; } })();
let saved = [];
// Which saved set the live one came from, so drifting away from it can be shown
// and undone. That round trip — load the standard set, pile things on to see
// what they cost, put it back — is the whole reason saving is here.
let loadedFrom = null;
let storageWarned = false;

async function boot() {
  ({ META, INDEX } = await loadData());
  saved = readSets(store);
  renderFooter();
  $('#lvl').value = META.max_level;
  buildFilters();
  wirePicker();
  $('#clear').onclick = () => { chosen.length = 0; loadedFrom = null; sync(); };
  $('#lvl').addEventListener('change', render);
  for (const id of ['#f-buffs', '#f-benef']) $(id).addEventListener('change', rerunSearch);
  $('#why-no-score').textContent = NO_SCORE;
  if (META.repo_url) $('#repo-link').href = META.repo_url;
  window.addEventListener('hashchange', fromHash);
  await fromHash();
}

const NO_SCORE =
  'Ranking buff sets by damage needs a model of how these values combine into a number — '
  + 'the spell, AA and worn bonus buckets, which effects add and which keep only the larger, '
  + 'which focus wins a cast. Six of the seven non-cumulative claims here are unverified and '
  + 'the focus rule is corroborated rather than confirmed, so a damage figure would look far '
  + 'more authoritative than the evidence behind it. This tool shows you what is being wasted '
  + 'and leaves the arithmetic to you.';

// ---------- filters and search ----------------------------------------------

function buildFilters() {
  const kinds = $('#kinds');
  for (const k of META.kinds) {
    const b = el('button', 'chip' + (active.kinds.has(k) ? ' on' : ''), KIND_LABEL[k] || k);
    b.title = kindHelp(k);
    b.onclick = () => {
      active.kinds.has(k) ? active.kinds.delete(k) : active.kinds.add(k);
      b.classList.toggle('on');
      rerunSearch();
    };
    kinds.appendChild(b);
  }
  const classes = $('#classes');
  const mk = (label, idx) => {
    const b = el('button', 'chip' + (active.cls === idx ? ' on' : ''), label);
    b.onclick = () => {
      active.cls = active.cls === idx ? -1 : idx;
      [...classes.children].forEach((c, i) => c.classList.toggle('on', i === (active.cls < 0 ? 0 : active.cls + 1)));
      rerunSearch();
    };
    classes.appendChild(b);
  };
  mk('Any', -1);
  META.classes.forEach((c, i) => mk(c, i));
}

function wirePicker() {
  const input = $('#q'), box = $('#results');
  input.addEventListener('input', rerunSearch);
  input.addEventListener('focus', rerunSearch);
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  input.addEventListener('keydown', e => {
    const btns = [...box.querySelectorAll('button')];
    const i = btns.findIndex(b => b.classList.contains('on'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      btns.forEach(b => b.classList.remove('on'));
      if (btns[n]) { btns[n].classList.add('on'); btns[n].scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'Enter' && btns[Math.max(i, 0)]) {
      e.preventDefault(); btns[Math.max(i, 0)].click();
    } else if (e.key === 'Escape') box.hidden = true;
  });
}

function rerunSearch() {
  const q = $('#q').value.trim().toLowerCase(), box = $('#results');
  box.innerHTML = '';
  if (q.length < 2) { box.hidden = true; return; }
  const hits = search(q, {
    buffsOnly: $('#f-buffs').checked, benefOnly: $('#f-benef').checked,
    kinds: active.kinds, cls: active.cls,
    exclude: new Set(chosen.map(s => s.id)),        // already in the set
  });
  if (!hits.length) { box.hidden = true; return; }
  for (const r of hits) {
    const b = el('button');
    const kind = META.kinds[r[row.kind]];
    const head = el('div', 'row1');
    head.appendChild(el('span', null, r[row.name]));
    head.appendChild(el('span', 'badge ' + kind, KIND_LABEL[kind] || kind));
    b.appendChild(head);
    const bits = [`#${r[row.id]}`];
    if (r[row.levels]) bits.push(r[row.levels].split('|').slice(0, 4).join(', '));
    if (r[row.duration] > 0) bits.push(`${r[row.duration]} tick${r[row.duration] === 1 ? '' : 's'}`);
    b.appendChild(el('div', 'meta', bits.join(' · ')));
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => { box.hidden = true; $('#q').value = ''; add(r[row.id]); };
    box.appendChild(b);
  }
  box.hidden = false;
}

// ---------- the set ---------------------------------------------------------

async function add(id) {
  if (chosen.some(s => s.id === id) || chosen.length >= MAX_SET) return;
  const sp = await spellById(id);
  if (sp) { chosen.push(sp); sync(); }
}

// ---------- saved sets ------------------------------------------------------

const ids = () => chosen.map(s => s.id);
const baseline = () => (loadedFrom ? findSet(saved, loadedFrom) : null);
const drifted = () => { const b = baseline(); return b ? !sameSet(b.ids, ids()) : false; };

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
  persist(upsert(saved, clean, ids()));
};

async function loadSet(name) {
  const s = findSet(saved, name);
  if (!s) return;
  chosen.length = 0;
  for (const id of s.ids) {
    const sp = await spellById(id);
    if (sp) chosen.push(sp);
  }
  loadedFrom = s.name;
  sync();
}

const alertLine = (text) => {
  const box = $('#saved-note');
  if (box) { box.textContent = text; box.hidden = false; }
};

const remove = id => {
  const i = chosen.findIndex(s => s.id === id);
  if (i > -1) { chosen.splice(i, 1); sync(); }
};

function sync() {
  const want = chosen.length ? '#set=' + chosen.map(s => s.id).join(',') : '';
  if (location.hash !== want) history.replaceState(null, '', want || location.pathname);
  render();
}

async function fromHash() {
  const ids = new URLSearchParams(location.hash.slice(1)).get('set');
  const want = (ids || '').split(',').map(n => parseInt(n, 10)).filter(Boolean).slice(0, MAX_SET);
  if (want.join(',') === chosen.map(s => s.id).join(',')) return;
  chosen.length = 0;
  // Sequential rather than parallel: shard fetches are cached per bucket, so a
  // 40-buff set is a handful of requests either way, and order is preserved.
  for (const id of want) {
    const sp = await spellById(id);
    if (sp) chosen.push(sp);
  }
  render();
}

// ---------- rendering -------------------------------------------------------

const level = () => parseInt($('#lvl').value, 10) || META.max_level;

function render() {
  renderSaved();
  const list = $('#setlist'); list.innerHTML = '';
  $('#clear').hidden = !chosen.length;
  $('#empty').hidden = chosen.length > 0;
  if (!chosen.length) { $('#report').hidden = true; return; }

  const res = analyzeSet(chosen, { level: level() });
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
  if (!saved.length && !chosen.length) return;

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

  // The experiment round trip: you loaded something, you have changed it, and
  // you want either to go back or to keep the change.
  if (drifted()) {
    const b = baseline();
    const n = chosen.length - b.ids.length;
    const note = el('div', 'frow drift');
    note.appendChild(el('span', null,
      `Changed from ${b.name} — ${n > 0 ? `${n} added` : n < 0 ? `${-n} removed` : 'same size, different spells'}.`));
    const revert = el('button', 'chip wide', `Revert to ${b.name}`);
    revert.onclick = () => loadSet(b.name);
    const update = el('button', 'chip wide', `Update ${b.name}`);
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

  const note = el('p', 'legend');
  note.id = 'saved-note';
  note.hidden = true;
  box.appendChild(note);
}

function spellLink(name, id) {
  const a = link(LUCY(id), name);
  a.title = `Look ${name} up on Lucy`;
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

  if (groups.length || res.focusProcs.length) {
    const note = el('p', 'legend');
    note.id = 'why-no-score-note';
    note.textContent = NO_SCORE;
    box.appendChild(note);
  }
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
  const n = groupShell('note-doubt', `${g.members.length} carry ${g.name}`,
    g.confirmed
      ? 'These do not add. The game keeps the larger value, so the rest are doing nothing while all of them are up.'
      : 'These do not add — only one value counts. Which one is unverified, so none is marked as the one that applies.');
  const ul = el('ul', 'group-members');
  for (const m of g.members) {
    // Same language as the pair view's slot table, so the colours mean one thing
    // across the site: green applies, struck-through is ignored, orange unknown.
    const cls = m.applies === true ? 'nc-wins' : m.applies === false ? 'nc-loses' : 'nc-unsure';
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
      const byName = new Map();
      for (const l of m.limiters) {
        if (!byName.has(l.spa)) byName.set(l.spa, { ...l, values: [] });
        byName.get(l.spa).values.push(l.base1);
      }
      const lim = el('div', 'limiters');
      for (const l of byName.values()) {
        const label = l.name.replace(/^Ff_/, '');
        const chip = el('span', 'badge rel', l.values.length > 1 ? `${label} ×${l.values.length}` : label);
        chip.title = `${l.name} (SPA ${l.spa}) · ${l.values.length > 1 ? 'values' : 'base'} ${l.values.join(', ')}`;
        lim.appendChild(chip);
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

// ---------- footer ----------------------------------------------------------

function renderFooter() {
  const b = $('#build');
  b.appendChild(document.createTextNode(
    `${META.spell_count.toLocaleString()} spells, read from a client spells_us.txt dated ${META.spell_file_date}. `
    + `This copy was built ${META.built.slice(0, 10)}.`));
  if (META.items) {
    b.appendChild(document.createTextNode(' Which items grant an effect comes from the '));
    b.appendChild(link(META.items.source, 'SoDeq item database'));
    b.appendChild(document.createTextNode(`, last updated ${META.items.updated}.`));
  }
  const notes = [dataAge(META.spell_file_date), META.items ? itemDataAge(META.items.updated) : {}]
    .filter(n => n.message);
  if (notes.length) {
    const stale = $('#stale');
    stale.hidden = false;
    stale.className = notes.some(n => n.level === 'stale') ? 'stale bad' : 'stale';
    stale.textContent = notes.map(n => n.message).join(' ');
  }
  const p = $('#credits');
  p.appendChild(document.createTextNode('Built on work by others: '));
  const parts = [
    link('https://forums.daybreakgames.com/eq/index.php?threads/enumerated-spa-list.206288/', 'Daybreak’s published SPA list'),
    link('https://github.com/EQEmu/Server', 'the EQEmu stacking implementation'),
    link('https://github.com/rumstil/eqspellparser', 'eqspellparser’s field layout'),
  ];
  if (META.items) parts.push(link(META.items.source, 'the SoDeq item database'));
  parts.push(link('https://lucy.allakhazam.com/', 'Lucy'));
  parts.forEach((node, i) => {
    if (i) p.appendChild(document.createTextNode(i === parts.length - 1 ? ' and ' : ', '));
    p.appendChild(node);
  });
  p.appendChild(document.createTextNode('.'));
  if (META.repo_url) {
    p.appendChild(document.createTextNode(' '));
    p.appendChild(link(`${META.repo_url}#credits`, 'Full credits'));
    p.appendChild(document.createTextNode('.'));
  }
}

boot();
