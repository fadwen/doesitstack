import { checkBoth, checkStack, calcValue, isBardSong, isGroupSpell, slotOf, SPA } from './engine.js';
import { dataAge, itemDataAge } from './freshness.js';

const $ = s => document.querySelector(s);
const el = (t, cls, txt) => { const n = document.createElement(t); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const LUCY = id => `https://lucy.allakhazam.com/spell.html?id=${id}&source=Live`;
// Lucy's own item export stores this link verbatim, and it is the item id
// templated in with no exceptions across all 134,079 of its rows — so we build
// it rather than shipping a second download to look it up.
const LUCY_ITEM = id => `https://lucy.allakhazam.com/item.html?id=${id}`;

let META, INDEX;
const shardCache = new Map(), descCache = new Map();
const picked = { a: null, b: null };

const F_BENEFICIAL = 1, F_SKILL = 2, F_SONG = 4, F_SONGWIN = 8, F_GROUP = 16, F_STACKGRP = 32;
const row = { id: 0, name: 1, target: 2, flags: 3, duration: 4, levels: 5, category: 6,
              kind: 7, classMask: 8, extMask: 9, itemRel: 10 };

// How an item grants a spell. Additive, not a classification: a scribed spell
// can also be a clicky, and one spell can be several of these at once.
const REL_LABEL = {
  click: 'Click', proc: 'Proc', worn: 'Worn', focus: 'Focus',
  bard: 'Bard', mount: 'Mount', blessing: 'Blessing', familiar: 'Familiar',
};
const REL_HELP = {
  click: 'Cast by activating the item.',
  proc: 'Fires by itself while the item is in use.',
  worn: 'Applied for as long as the item is equipped.',
  focus: 'The item carries this as a focus effect.',
  bard: 'The item is a bard instrument granting this.',
  mount: 'Granted by a mount.',
  blessing: 'A mount blessing effect.',
  familiar: 'Granted by a familiar.',
};
// index rows carry the relationships as a bitmask so the search list can show
// tags without fetching a shard. Bit order matches meta.items.rel.
const relsOf = mask => (META.items?.rel || []).filter((_, i) => mask & (1 << i));

// Labels for the `kind` a spell was classified into at build time.
const KIND_LABEL = {
  spell: 'Spell', discipline: 'Discipline', song: 'Song', aa: 'AA',
  item: 'Item', triggered: 'Triggered', npc: 'NPC', other: 'Unattributed',
};
const KIND_HELP = {
  spell: 'Scribed into a spellbook by a class at a normal level.',
  discipline: 'A combat skill — flagged as a discipline in the spell file.',
  song: 'Usable by bards and not a combat skill.',
  aa: 'Granted by an alternate ability (the class level reads 254).',
  item: 'An item casts this — a click, proc, worn or focus effect. Named items come from a community database, not your client files.',
  triggered: 'Fired by another spell as a side effect, recourse or proc rather than cast directly.',
  npc: 'Flagged in the spell file as castable by NPCs only, and no known item grants it.',
  other: 'No class learns it, nothing in the spell file triggers it, and no item in the item database casts it. Unexplained rather than absent — the item data lags new content, so recent effects can land here for a while.',
};
// Said when the build ran without item data, so 'item' keeps its older,
// looser meaning and 'other' cannot occur at all.
const KIND_HELP_NO_ITEMS = {
  item: 'No class can learn it and nothing in the spell file triggers it — clickies, procs and worn effects land here, but so do NPC spells. This build has no item database loaded, so the bucket is a deduction rather than a fact.',
};
const DEFAULT_KINDS = ['spell', 'discipline', 'song', 'aa', 'item', 'other'];
const kindHelp = k => (META.items ? KIND_HELP[k] : KIND_HELP_NO_ITEMS[k] || KIND_HELP[k]) || '';

const active = { kinds: new Set(DEFAULT_KINDS), cls: -1 };

async function boot() {
  [META, INDEX] = await Promise.all([
    fetch('data/meta.json').then(r => r.json()),
    fetch('data/index.json').then(r => r.json()),
  ]);
  renderDataAge();
  $('#lvl').value = META.max_level;
  buildFilters();
  for (const side of ['a', 'b']) wirePicker(side);
  $('#swap').onclick = () => { const t = picked.a; picked.a = picked.b; picked.b = t; syncAll(); };
  for (const id of ['#f-buffs', '#f-benef', '#lvl']) $(id).addEventListener('change', refresh);
  if (META.repo_url) $('#repo-link').href = META.repo_url;
  window.addEventListener('hashchange', fromHash);
  await fromHash();
}

const refresh = () => { rerunSearch('a'); rerunSearch('b'); render(); };

function buildFilters() {
  const kinds = $('#kinds');
  for (const k of META.kinds) {
    const b = el('button', 'chip' + (active.kinds.has(k) ? ' on' : ''), KIND_LABEL[k] || k);
    b.title = kindHelp(k);
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

/** Say where the data came from and how old it is; warn once that matters. */
function renderDataAge() {
  $('#build').textContent =
    `${META.spell_count.toLocaleString()} spells, read from a client spells_us.txt dated ${META.spell_file_date}. `
    + `This copy was built ${META.built.slice(0, 10)}.`
    + (META.items
        ? ` Which items grant an effect comes from a separate community database, last updated ${META.items.updated}.`
        : ' No item database was loaded for this build, so nothing is tagged with the item that grants it.');

  const notes = [dataAge(META.spell_file_date), META.items ? itemDataAge(META.items.updated) : {}]
    .filter(n => n.message);
  if (!notes.length) return;
  const box = $('#stale');
  box.hidden = false;
  box.className = notes.some(n => n.level === 'stale') ? 'stale bad' : 'stale';
  box.textContent = notes.map(n => n.message).join(' ');
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
    // A spell can be scribed *and* sit on a clicky, so these are extra tags
    // beside the kind badge rather than a replacement for it. Suppressed when
    // the kind badge already says "Item" and there is only one relationship.
    const rels = relsOf(r[row.itemRel]);
    if (rels.length && !(kind === 'item' && rels.length === 1)) {
      const tags = el('span', 'rel-tags');
      for (const rel of rels) tags.appendChild(el('span', 'badge rel', REL_LABEL[rel] || rel));
      head.insertBefore(tags, head.lastChild);
    }
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
  badge.title = kindHelp(sp.kind);
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
  if (sp.it) c.appendChild(itemSource(sp.it));
  if (sp.desc?.d) { const d = el('p', 'sub', sp.desc.d.replace(/<BR>/gi, ' ')); d.style.marginTop = '8px'; c.appendChild(d); }
  return c;
}

/**
 * "Click · Proc — Mystic Cloak, The Sword of Rile and 4 others"
 *
 * `it` is [relationship bitmask, total item count, [[item id, name, rel index]]].
 * Only a few named items ship; the count carries the rest, and the Lucy spell
 * link above covers anyone who wants the full list.
 */
function itemSource([mask, count, items]) {
  const wrap = el('div', 'sub item-source');
  const tags = el('span', 'rel-tags');
  for (const rel of relsOf(mask)) {
    const t = el('span', 'badge rel', REL_LABEL[rel] || rel);
    t.title = REL_HELP[rel] || '';
    tags.appendChild(t);
  }
  wrap.appendChild(tags);
  const named = items.length;
  items.forEach(([id, name], i) => {
    if (i) wrap.appendChild(document.createTextNode(i === named - 1 && count === named ? ' and ' : ', '));
    const a = el('a', null, name);
    a.href = LUCY_ITEM(id); a.target = '_blank'; a.rel = 'noopener';
    a.title = 'Look this item up on Lucy';
    wrap.appendChild(a);
  });
  const rest = count - named;
  if (rest > 0) wrap.appendChild(document.createTextNode(` and ${rest} other item${rest === 1 ? '' : 's'}`));
  return wrap;
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
  d.appendChild(el('summary', null, 'Where this comes from, and how to correct it'));
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

  d.appendChild(askParagraph(
    spas.map(s2 => `non-cumulative/${s2}`),
    unverified.length
      ? 'Have a parse, a patch note or a developer statement that settles this?'
      : 'Think this is wrong?'));
  n.appendChild(d);
  return n;
}

/**
 * The two ways to correct a claim, easiest first.
 *
 * A PR against claims.json is the smaller change, but it assumes GitHub fluency —
 * and the people most likely to know a mechanic cold are not necessarily the people
 * who know how to fork a repo. The issue form asks the same questions in a web form,
 * prefilled with the claim they were looking at.
 */
function askParagraph(claimIds, askText) {
  const ask = el('p', 'ask');
  ask.appendChild(document.createTextNode(askText + ' '));

  if (!META.repo_url) {
    ask.appendChild(document.createTextNode(
      'Fill in the evidence form under .github/ISSUE_TEMPLATE, or open a PR against claims.json — the standard is in CONTRIBUTING.md.'));
    return ask;
  }

  const ids = claimIds.filter(Boolean);
  const params = new URLSearchParams({ template: 'mechanic-evidence.yml', labels: 'evidence' });
  if (ids.length) {
    params.set('claim', ids.join(', '));
    params.set('title', `[evidence] ${ids.join(', ')}`);
  }
  const form = el('a', null, 'Tell us what you know');
  form.href = `${META.repo_url}/issues/new?${params}`;
  form.target = '_blank'; form.rel = 'noopener';
  ask.appendChild(form);
  ask.appendChild(document.createTextNode(' — a short form, no GitHub experience needed. Or '));

  const pr = el('a', null, 'open a PR against claims.json');
  pr.href = `${META.repo_url}/blob/main/CONTRIBUTING.md`;
  pr.target = '_blank'; pr.rel = 'noopener';
  ask.appendChild(pr);
  ask.appendChild(document.createTextNode('.'));
  return ask;
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
  d.appendChild(el('summary', null, 'Where this comes from, and how to correct it'));
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

  d.appendChild(askParagraph([claimKey], askText));
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

/**
 * Which slots carry an effect that does not add with the other buff's copy of it.
 *
 * Two shapes, because the confidence differs. Where the claim is confirmed we know
 * the game keeps the larger value, so the slot that applies is marked as taking
 * precedence and the other as losing out. Where it is not, all we are asserting is
 * that the numbers do not add — so both sides are flagged and neither is called the
 * winner. Returns Map(slot index -> 'wins' | 'loses' | 'unsure') per side.
 */
function nonCumulativeMarks(overlaps) {
  const marks = { a: new Map(), b: new Map() };
  // A slot can appear in more than one pair. Losing is the strongest thing we can
  // say about a slot, so it is never downgraded by a later pair.
  const rank = { loses: 3, wins: 2, unsure: 1 };
  const set = (side, slot, mark) => {
    const had = marks[side].get(slot);
    if (!had || rank[mark] > rank[had]) marks[side].set(slot, mark);
  };
  for (const o of overlaps) {
    if (!o.confirmed) { set('a', o.slotA, 'unsure'); set('b', o.slotB, 'unsure'); continue; }
    // A tie loses nothing either way — that value applies whichever buff supplies it.
    if (o.winner === 'tie') { set('a', o.slotA, 'wins'); set('b', o.slotB, 'wins'); continue; }
    set('a', o.slotA, o.winner === 'a' ? 'wins' : 'loses');
    set('b', o.slotB, o.winner === 'b' ? 'wins' : 'loses');
  }
  return marks;
}

const MARK_TITLE = {
  wins: 'Does not add with the other buff\u2019s copy of this effect. This is the larger value, so this is the one that applies.',
  loses: 'Does not add with the other buff\u2019s copy of this effect. The other buff\u2019s value is larger, so this one does nothing while both are up.',
  unsure: 'Reported not to add with the other buff\u2019s copy of this effect — only one value counts. Which one is unverified, so neither is marked as winning.',
};

function nonCumulativeLegend(marks) {
  const kinds = new Set([...marks.a.values(), ...marks.b.values()]);
  if (!kinds.size) return null;
  const p = el('p', 'legend');
  p.appendChild(document.createTextNode('Marked effects do not add together — '));
  let first = true;
  const add = (cls, label) => {
    if (!kinds.has(cls)) return;
    if (!first) p.appendChild(document.createTextNode(' · '));
    first = false;
    p.appendChild(el('span', 'nc-' + cls, label));
  };
  // The sample text carries the styling it describes, so the legend does not
  // depend on the reader naming a colour.
  add('wins', 'this value applies');
  add('loses', 'this one is ignored');
  add('unsure', 'which one applies is unverified');
  return p;
}

function renderDetail(a, b, res, lvl) {
  const d = $('#detail'); d.hidden = false; d.innerHTML = '';
  d.appendChild(el('h3', 'sec', 'Slot by slot'));
  const t = el('table', 'slots');
  // Each spell carries its own slot numbers rather than sharing one column. The rows
  // still line up by index, because that is what arbitration compares — but the two
  // spells' slot lists are independent, and a single "Slot" column asserted a pairing
  // they do not have. It also read wrongly where only one of the two has a slot.
  t.innerHTML = `<thead><tr><th>${escape(a.name)}</th><th>${escape(b.name)}</th><th>Verdict</th></tr></thead>`;
  const body = el('tbody');
  const bySlot = new Map();
  for (const s of res.xThenY.slots) if (s.kind === 'slot') bySlot.set(s.slot, s);

  // Only meaningful when both buffs actually hold — if one is refused there is no
  // "both up, larger counts" situation to colour. Matches the note under the verdict.
  const bothHold = res.xThenY.verdict === 'independent' && res.yThenX.verdict === 'independent';
  const marks = nonCumulativeMarks(bothHold ? res.nonCumulative : []);

  // Live spells run well past twelve slots; show every slot either one uses.
  const span = Math.max(a.slots?.length || 0, b.slots?.length || 0);
  for (let i = 0; i < span; i++) {
    const sa = slotOf(a, i), sb = slotOf(b, i);
    if (!sa && !sb) continue;
    const tr = el('tr');
    tr.appendChild(slotCell(a, i, lvl, marks.a.get(i)));
    tr.appendChild(slotCell(b, i, lvl, marks.b.get(i)));
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
  // Wide content scrolls inside its own box rather than pushing the page sideways.
  const scroller = el('div', 'table-scroll');
  scroller.appendChild(t);
  d.appendChild(scroller);
  const legend = nonCumulativeLegend(marks);
  if (legend) d.appendChild(legend);

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

  const provenance = ruleProvenance([res.xThenY.rule, res.yThenX.rule]);
  if (provenance) d.appendChild(provenance);
}

/**
 * Where the rule that decided this verdict comes from. Most of them are EQEmu's
 * reading of the game rather than anything Daybreak has stated, and saying so is
 * the honest version of a footer that used to claim the engine mirrored the client.
 */
function ruleProvenance(rules) {
  const seen = new Set(), entries = [];
  for (const r of rules) {
    const claim = META.claims?.[`rule:${r}`];
    if (!claim || seen.has(r)) continue;
    seen.add(r);
    entries.push([r, claim]);
  }
  if (!entries.length) return null;

  const wrap = el('div', 'provenance');
  for (const [rule, claim] of entries) {
    const p = el('p');
    p.appendChild(el('span', 'badge ' + claim.status, claim.status));
    p.appendChild(document.createTextNode(` The ${rule.replace(/-/g, ' ')} rule: ${claim.assertion} `));
    const src = claim.evidence.map(e => e.source).join('; ');
    p.appendChild(el('span', 'src', src));
    wrap.appendChild(p);
  }
  if (entries.some(([, c]) => c.status === 'unverified'))
    wrap.appendChild(askParagraph(
      entries.filter(([, c]) => c.status === 'unverified').map(([r]) => `stacking-rule/${r}`),
      'Know whether the game really works this way?'));
  return wrap;
}

function slotCell(sp, i, lvl, mark) {
  const s = slotOf(sp, i);
  if (!s) return el('td', 'empty-slot', '—');
  const td = el('td');
  const head = el('div', 'slot-head');
  head.appendChild(el('span', 'slotno', String(i + 1)));
  const name = el('span', mark ? 'nc-' + mark : null, META.spa_names[s.spa] || `SPA ${s.spa}`);
  if (mark) name.title = MARK_TITLE[mark];
  head.appendChild(name);
  td.appendChild(head);
  const v = calcValue(sp, i, lvl);
  td.appendChild(el('div', 'spa', `SPA ${s.spa} · base ${s.base1}${s.base2 ? ' / ' + s.base2 : ''}${s.max ? ' · max ' + s.max : ''} · value ${v}`));
  return td;
}

const escape = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

boot();
