import { checkBoth, checkStack, calcValue, isBardSong, isGroupSpell, slotOf, SPA } from './engine.js';

const $ = s => document.querySelector(s);
const el = (t, cls, txt) => { const n = document.createElement(t); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const LUCY = id => `https://lucy.allakhazam.com/spell.html?id=${id}&source=Live`;

let META, INDEX;
const shardCache = new Map(), descCache = new Map();
const picked = { a: null, b: null };

const F_BENEFICIAL = 1, F_SKILL = 2, F_SONG = 4, F_SONGWIN = 8, F_GROUP = 16, F_STACKGRP = 32;
const row = { id: 0, name: 1, target: 2, flags: 3, duration: 4, levels: 5, category: 6,
              kind: 7, classMask: 8, extMask: 9 };

// Labels for the `kind` a spell was classified into at build time.
const KIND_LABEL = {
  spell: 'Spell', discipline: 'Discipline', song: 'Song', aa: 'AA',
  item: 'Item / other', triggered: 'Triggered', npc: 'NPC',
};
const KIND_HELP = {
  spell: 'Scribed into a spellbook by a class at a normal level.',
  discipline: 'A combat skill — flagged as a discipline in the spell file.',
  song: 'Usable by bards and not a combat skill.',
  aa: 'Granted by an alternate ability (the class level reads 254).',
  item: 'No class can learn it and nothing in the spell file triggers it — clickies, procs and worn effects land here, but so do NPC spells. The client files do not record which item grants an effect, so this bucket is a deduction rather than a fact.',
  triggered: 'Fired by another spell as a side effect, recourse or proc rather than cast directly.',
  npc: 'Flagged in the spell file as castable by NPCs only.',
};
const DEFAULT_KINDS = ['spell', 'discipline', 'song', 'aa', 'item'];

const active = { kinds: new Set(DEFAULT_KINDS), cls: -1 };

async function boot() {
  [META, INDEX] = await Promise.all([
    fetch('data/meta.json').then(r => r.json()),
    fetch('data/index.json').then(r => r.json()),
  ]);
  $('#build').textContent =
    `${META.spell_count.toLocaleString()} spells from a spells_us.txt dated ${META.spell_file_date}. Dataset built ${META.built.slice(0, 10)}.`;
  $('#lvl').value = META.max_level;
  buildFilters();
  for (const side of ['a', 'b']) wirePicker(side);
  $('#swap').onclick = () => { const t = picked.a; picked.a = picked.b; picked.b = t; syncAll(); };
  for (const id of ['#f-buffs', '#f-benef', '#lvl']) $(id).addEventListener('change', refresh);
  window.addEventListener('hashchange', fromHash);
  await fromHash();
}

const refresh = () => { rerunSearch('a'); rerunSearch('b'); render(); };

function buildFilters() {
  const kinds = $('#kinds');
  for (const k of META.kinds) {
    const b = el('button', 'chip' + (active.kinds.has(k) ? ' on' : ''), KIND_LABEL[k] || k);
    b.title = KIND_HELP[k] || '';
    b.onclick = () => {
      active.kinds.has(k) ? active.kinds.delete(k) : active.kinds.add(k);
      b.classList.toggle('on');
      refresh();
    };
    kinds.appendChild(b);
  }
  const classes = $('#classes');
  const mk = (label, idx) => {
    const b = el('button', 'chip' + (active.cls === idx ? ' on' : ''), label);
    b.onclick = () => {
      active.cls = active.cls === idx ? -1 : idx;
      [...classes.children].forEach((c, i) => c.classList.toggle('on', i === (active.cls < 0 ? 0 : active.cls + 1)));
      refresh();
    };
    return b;
  };
  classes.appendChild(mk('Any', -1));
  classes.firstChild.classList.add('on');
  META.classes.forEach((c, i) => classes.appendChild(mk(c, i)));
}

// ---------- search ----------------------------------------------------------
function matches(r, q) {
  if (/^\d+$/.test(q)) return String(r[row.id]).startsWith(q);
  return r[row.name].toLowerCase().includes(q);
}

function filtered(q) {
  const buffsOnly = $('#f-buffs').checked, benefOnly = $('#f-benef').checked;
  const clsBit = active.cls >= 0 ? (1 << active.cls) : 0;
  const out = [];
  for (const r of INDEX) {
    if (buffsOnly && r[row.duration] <= 0) continue;
    if (benefOnly && !(r[row.flags] & F_BENEFICIAL)) continue;
    if (!active.kinds.has(META.kinds[r[row.kind]])) continue;
    // a class matches either by learning the spell or by triggering it
    if (clsBit && !((r[row.classMask] | r[row.extMask]) & clsBit)) continue;
    if (!matches(r, q)) continue;
    out.push(r);
    if (out.length >= 400) break;
  }
  // exact-ish first, then shortest name, then id
  const ql = q.toLowerCase();
  out.sort((x, y) => {
    const a = x[row.name].toLowerCase(), b = y[row.name].toLowerCase();
    return (a.startsWith(ql) ? 0 : 1) - (b.startsWith(ql) ? 0 : 1) || a.length - b.length || x[row.id] - y[row.id];
  });
  return out.slice(0, 60);
}

function wirePicker(side) {
  const input = $(`#q-${side}`), box = $(`#results-${side}`);
  input.addEventListener('input', () => rerunSearch(side));
  input.addEventListener('focus', () => rerunSearch(side));
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

function rerunSearch(side) {
  const q = $(`#q-${side}`).value.trim().toLowerCase(), box = $(`#results-${side}`);
  box.innerHTML = '';
  if (q.length < 2) { box.hidden = true; return; }
  const hits = filtered(q);
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
    if (r[row.category]) bits.push(r[row.category]);
    b.appendChild(el('div', 'meta', bits.join(' · ')));
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => { box.hidden = true; select(side, r[row.id]); };
    box.appendChild(b);
  }
  box.hidden = false;
}

// ---------- data ------------------------------------------------------------
async function shard(id) {
  const b = Math.floor(id / META.bucket);
  if (!shardCache.has(b)) shardCache.set(b, fetch(`data/spells/${b}.json`).then(r => r.ok ? r.json() : {}));
  return (await shardCache.get(b))[id] || null;
}
async function descOf(id) {
  const b = Math.floor(id / META.bucket);
  if (!descCache.has(b)) descCache.set(b, fetch(`data/desc/${b}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})));
  return (await descCache.get(b))[id] || null;
}

/** compact record -> the shape engine.js expects */
function hydrate(rec) {
  if (!rec) return null;
  return {
    ...rec,
    stacking: rec.stacking || [],
    slots: (rec.slots || []).map(s => s && { spa: s[0], base1: s[1], base2: s[2], calc: s[3], max: s[4] }),
  };
}

async function select(side, id) {
  picked[side] = hydrate(await shard(id));
  if (picked[side]) picked[side].desc = await descOf(id);
  syncAll();
}

function syncAll() {
  const h = [];
  if (picked.a) h.push(`a=${picked.a.id}`);
  if (picked.b) h.push(`b=${picked.b.id}`);
  const want = h.length ? '#' + h.join('&') : '';
  if (location.hash !== want) history.replaceState(null, '', want || location.pathname);
  render();
}

async function fromHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const side of ['a', 'b']) {
    const id = parseInt(p.get(side), 10);
    if (id && picked[side]?.id !== id) {
      picked[side] = hydrate(await shard(id));
      if (picked[side]) picked[side].desc = await descOf(id);
    } else if (!id) picked[side] = null;
  }
  render();
}

// ---------- rendering -------------------------------------------------------
const durText = t => t <= 0 ? 'instant' : t >= 72000 ? 'permanent' : `${t} tick${t === 1 ? '' : 's'} (${fmtTime(t * 6)})`;
function fmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m${s ? ' ' + s + 's' : ''}` : `${s}s`;
}

function spellCard(sp) {
  const c = el('div', 'card');
  const h = el('div', 'row1');
  h.appendChild(el('h3', null, sp.name));
  const badge = el('span', 'badge ' + sp.kind, KIND_LABEL[sp.kind] || sp.kind);
  badge.title = KIND_HELP[sp.kind] || '';
  h.appendChild(badge);
  c.appendChild(h);
  const sub = el('div', 'sub');
  const bits = [`#${sp.id}`, META.targets[sp.target] || `target ${sp.target}`, durText(sp.duration)];
  const lv = META.classes.map((c2, i) => sp.levels[i] < 255 ? `${c2} ${sp.levels[i]}` : null).filter(Boolean);
  if (lv.length) bits.push(lv.slice(0, 5).join(', '));
  sub.textContent = bits.join(' · ') + ' · ';
  const a = el('a', null, 'Lucy'); a.href = LUCY(sp.id); a.target = '_blank'; a.rel = 'noopener';
  sub.appendChild(a);
  c.appendChild(sub);
  if (sp.desc?.d) { const d = el('p', 'sub', sp.desc.d.replace(/<BR>/gi, ' ')); d.style.marginTop = '8px'; c.appendChild(d); }
  return c;
}

function render() {
  for (const side of ['a', 'b']) {
    const box = $(`#chosen-${side}`); box.innerHTML = '';
    if (picked[side]) box.appendChild(spellCard(picked[side]));
  }
  const { a, b } = picked;
  if (!a || !b) { $('#verdict').hidden = true; $('#detail').hidden = true; $('#empty').hidden = false; return; }
  $('#empty').hidden = true;

  const lvl = parseInt($('#lvl').value, 10) || META.max_level;
  const res = checkBoth(a, b, { levelX: lvl, levelY: lvl });
  renderVerdict(a, b, res);
  renderDetail(a, b, res, lvl);
}

function renderVerdict(a, b, res) {
  const v = $('#verdict'); v.hidden = false; v.innerHTML = '';
  const codes = [res.xThenY.code, res.yThenX.code];
  const bothIndependent = codes.every(c => c === 0);
  const anyBlocked = codes.some(c => c === -1);

  let cls, head;
  if (bothIndependent) { cls = 'stacks'; head = 'Yes — these stack.'; }
  else if (anyBlocked && codes.some(c => c === 1)) { cls = 'partial'; head = 'No — one replaces the other.'; }
  else if (anyBlocked) { cls = 'conflict'; head = 'No — they conflict.'; }
  else { cls = 'partial'; head = 'They overwrite each other.'; }
  v.className = 'verdict ' + cls;
  v.appendChild(el('h2', null, head));

  const dirs = el('div', 'dirs');
  for (const [key, label] of [['xThenY', `${a.name} first, then ${b.name}`], ['yThenX', `${b.name} first, then ${a.name}`]]) {
    const r = res[key], d = el('div', 'dir');
    d.appendChild(el('h4', null, label));
    const words = { independent: 'Both hold', overwrite: 'The second one overwrites the first', blocked: 'The second one is refused' };
    d.appendChild(el('div', 'out ' + r.verdict, words[r.verdict]));
    d.appendChild(el('div', 'why', r.reason));
    dirs.appendChild(d);
  }
  v.appendChild(dirs);

  // Only meaningful when both buffs actually hold at once.
  if (res.nonCumulative.length && bothIndependent) v.appendChild(nonCumulativeNote(res.nonCumulative));

  // A verdict resting on a focus SPA the client-derived ignore list omits.
  const contested = [res.xThenY, res.yThenX].map(r => r.contestedFocus).filter(Boolean);
  if (contested.length) v.appendChild(contestedFocusNote(contested));

  // Both hold, but only the best focus applies to any one cast.
  if (bothIndependent && res.focus?.bestOnly.length) v.appendChild(focusBestOnlyNote(res.focus));
  const g = res.xThenY.sharedGroups;
  if (g.length) {
    const n = el('div', 'note');
    n.textContent = `Shared Live stacking group: ${g.map(x => `${x.name} (ranks ${x.rankA} / ${x.rankB})`).join('; ')}. Only one member of a stacking group is ever active.`;
    v.appendChild(n);
  }
}

/**
 * Effects that land together but are not added together. The wording tracks the
 * evidence recorded in claims.json, and the disclosure shows that evidence, so a
 * reader can judge it — or go settle it.
 */
function nonCumulativeNote(overlaps) {
  const n = el('div', 'note');
  const names = [...new Set(overlaps.map(x => x.name))].join(', ');
  const spas = [...new Set(overlaps.map(x => x.spa))];
  const unverified = spas.filter(s => !META.non_cumulative_confirmed.includes(s));

  let text = `Both carry ${names}. The game does not add these together — while both buffs are up, only the larger value counts. Stacking here does not mean the numbers add.`;
  if (unverified.length)
    text += ` Treat that as unverified for SPA ${unverified.join(', ')}: it rests on how the EQEmu server accumulates the bonus, which nothing in that project backs up, and the game's own spell text never calls these non-cumulative.`;
  n.appendChild(el('p', null, text));

  const d = el('details', 'evidence');
  d.appendChild(el('summary', null, 'Where this comes from'));
  for (const spa of spas) {
    const claim = META.claims?.[spa];
    if (!claim) continue;
    const box = el('div', 'claim');
    const head = el('div', 'claim-head');
    head.appendChild(el('span', null, `SPA ${spa}`));
    head.appendChild(el('span', 'badge ' + claim.status, claim.status));
    box.appendChild(head);
    const ul = el('ul');
    for (const e of claim.evidence) ul.appendChild(evidenceLine(e));
    box.appendChild(ul);
    d.appendChild(box);
  }
  if (META.claim_notes?.bonus_buckets) d.appendChild(el('p', 'src', META.claim_notes.bonus_buckets));

  const ask = el('p', 'ask');
  ask.appendChild(document.createTextNode(unverified.length
    ? 'Have a parse, a patch note or a developer statement that settles this? '
    : 'Think this is wrong? '));
  if (META.repo_url) {
    const a = el('a', null, 'Open a PR against claims.json');
    a.href = `${META.repo_url}/blob/main/CONTRIBUTING.md`;
    a.target = '_blank'; a.rel = 'noopener';
    ask.appendChild(a);
    ask.appendChild(document.createTextNode(' — the evidence standard is in CONTRIBUTING.md.'));
  } else {
    ask.appendChild(document.createTextNode('Open a PR against claims.json — the evidence standard is in CONTRIBUTING.md.'));
  }
  d.appendChild(ask);
  n.appendChild(d);
  return n;
}

function evidenceLine(e) {
  const li = el('li');
  li.appendChild(el('span', 'strength ' + e.strength, e.strength));
  li.appendChild(el('span', null, ` ${e.summary} `));
  li.appendChild(el('span', 'src', e.who ? `— ${e.who}, ${e.source}` : `— ${e.source}`));
  return li;
}

/** Shared scaffolding for the caveat boxes: text, evidence disclosure, invitation. */
function claimNote(text, claimKey, askText) {
  const n = el('div', 'note');
  n.appendChild(el('p', null, text));
  const claim = META.claims?.[claimKey];
  if (!claim) return n;

  const d = el('details', 'evidence');
  d.appendChild(el('summary', null, 'Where this comes from'));
  const box = el('div', 'claim');
  const head = el('div', 'claim-head');
  head.appendChild(el('span', null, claim.assertion ? '' : String(claimKey)));
  head.appendChild(el('span', 'badge ' + claim.status, claim.status));
  box.appendChild(head);
  if (claim.assertion) box.appendChild(el('p', 'src', claim.assertion));
  const ul = el('ul');
  for (const e of claim.evidence) ul.appendChild(evidenceLine(e));
  box.appendChild(ul);
  d.appendChild(box);

  const ask = el('p', 'ask');
  ask.appendChild(document.createTextNode(askText + ' '));
  if (META.repo_url) {
    const a = el('a', null, 'Open a PR against claims.json');
    a.href = `${META.repo_url}/blob/main/CONTRIBUTING.md`;
    a.target = '_blank'; a.rel = 'noopener';
    ask.appendChild(a);
    ask.appendChild(document.createTextNode(' — the evidence standard is in CONTRIBUTING.md.'));
  } else {
    ask.appendChild(document.createTextNode('Open a PR against claims.json — the evidence standard is in CONTRIBUTING.md.'));
  }
  d.appendChild(ask);
  n.appendChild(d);
  return n;
}

function contestedFocusNote(contested) {
  const names = [...new Set(contested.map(c => `${c.name} (SPA ${c.spa})`))].join(', ');
  const n = claimNote(
    `This answer turns on ${names}, a focus effect. Focus effects are reported to stack regardless of slot, `
    + `and most of them are already exempt from slot arbitration — but this one is missing from the client-derived `
    + `list the engine uses, so the conflict above may not be real. Treat the verdict as doubtful here.`,
    'focus-stacking/not-on-client-ignore-list',
    'Know how this one behaves?');
  n.classList.add('note-doubt');
  return n;
}

function focusBestOnlyNote(focus) {
  const names = focus.bestOnly.map(f => f.name).join(', ');
  let text = `Both carry ${names}, a focus effect. They stack as buffs, but only the best focus applies to any one cast — `
           + `two of them do not add up. This is the distinction behind "twincast does not stack": the buffs do both hold, `
           + `it is the effect that does not double.`;
  if (focus.procs.length)
    text += ` (${focus.procs.map(f => f.name).join(', ')} is proc-type and does fire independently.)`;
  return claimNote(text, 'focus-best-only/all-focus-spas', 'Can you confirm or refute this?');
}

function renderDetail(a, b, res, lvl) {
  const d = $('#detail'); d.hidden = false; d.innerHTML = '';
  d.appendChild(el('h3', 'sec', 'Slot by slot'));
  const t = el('table', 'slots');
  t.innerHTML = `<thead><tr><th class="n">Slot</th><th>${escape(a.name)}</th><th>${escape(b.name)}</th><th>Verdict</th></tr></thead>`;
  const body = el('tbody');
  const bySlot = new Map();
  for (const s of res.xThenY.slots) if (s.kind === 'slot') bySlot.set(s.slot, s);

  // Live spells run well past twelve slots; show every slot either one uses.
  const span = Math.max(a.slots?.length || 0, b.slots?.length || 0);
  for (let i = 0; i < span; i++) {
    const sa = slotOf(a, i), sb = slotOf(b, i);
    if (!sa && !sb) continue;
    const tr = el('tr');
    tr.appendChild(el('td', 'n', String(i + 1)));
    tr.appendChild(slotCell(a, i, lvl));
    tr.appendChild(slotCell(b, i, lvl));
    const info = bySlot.get(i);
    let verdict = '—', cls = '';
    if (info) {
      if (info.outcome === 'conflict-blocked') { verdict = 'conflict — blocks'; cls = 'hit'; }
      else if (info.outcome === 'conflict-b-wins') { verdict = `same effect · ${info.valueA} vs ${info.valueB} · would overwrite`; cls = 'hit'; }
      else if (info.outcome === 'ignored') { verdict = 'ignored for stacking'; cls = 'ok'; }
      else verdict = 'no conflict';
    } else if (sa && sb) verdict = 'no conflict';
    tr.className = cls;
    tr.appendChild(el('td', null, verdict));
    body.appendChild(tr);
  }
  t.appendChild(body);
  d.appendChild(t);

  const notes = res.xThenY.slots.filter(s => s.kind !== 'slot');
  if (notes.length) {
    d.appendChild(el('h3', 'sec', 'Stacking commands'));
    const ul = el('ul', 'trace');
    for (const n of notes) ul.appendChild(el('li', null, n.detail));
    d.appendChild(ul);
  }

  d.appendChild(el('h3', 'sec', 'How the check ran'));
  const ul = el('ul', 'trace');
  for (const s of res.xThenY.slots) if (s.kind === 'slot') ul.appendChild(el('li', null, s.detail));
  ul.appendChild(el('li', null, `Result casting ${b.name} onto ${a.name}: ${res.xThenY.reason} (rule: ${res.xThenY.rule})`));
  ul.appendChild(el('li', null, `Result casting ${a.name} onto ${b.name}: ${res.yThenX.reason} (rule: ${res.yThenX.rule})`));
  d.appendChild(ul);
}

function slotCell(sp, i, lvl) {
  const s = slotOf(sp, i);
  if (!s) return el('td', null, '—');
  const td = el('td');
  td.appendChild(el('div', null, META.spa_names[s.spa] || `SPA ${s.spa}`));
  const v = calcValue(sp, i, lvl);
  td.appendChild(el('div', 'spa', `SPA ${s.spa} · base ${s.base1}${s.base2 ? ' / ' + s.base2 : ''}${s.max ? ' · max ' + s.max : ''} · value ${v}`));
  return td;
}

const escape = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

boot();
