import { checkBoth, calcValue, isEmptySlot, slotOf } from './engine.js';
import { phrase } from './phrasing.js';
import {
  $, el, link, escape, LUCY, LUCY_HISTORY, RAIDLOOT, SODEQ_ITEM, THIRD_PARTY_LAG,
  KIND_LABEL, REL_LABEL, REL_HELP, kindHelp, relsOf, search, spellById, nameOf, load as loadData,
  getReading, getShowHidden, setShowHidden, itemsOf, notInFile, notLoaded,
} from './data.js';
import {
  DEFAULT_KINDS, readLevel, levelParam, applyLevelParam, noticeLine, dataFailed, buildFilters,
  searchFilters, wireReadingBox, wirePicker, wireCopyLink, renderFooter,
} from './ui.js';

let META;
const picked = { a: null, b: null };
const active = { kinds: new Set(DEFAULT_KINDS), cls: -1 };
// The rerun function for each side's search, from wirePicker().
const rerun = {};

// One line above the verdict for things the page could not do: an id in the
// link that is not in this spell file, a spell that would not load. Cleared by
// the next change to the pair, so it describes the current state and no other.
const { alertLine, clearLine } = noticeLine('#notice');

async function boot() {
  try { ({ META } = await loadData()); }
  catch (err) { dataFailed(err); return; }
  renderFooter();
  // The cap is the dataset's, not the markup's: the HTML said 130 and would have
  // gone on saying it after the next level increase.
  $('#lvl').max = META.max_level;
  $('#lvl').value = META.max_level;
  buildFilters(active, rerunBoth);
  for (const side of ['a', 'b']) {
    rerun[side] = wirePicker($(`#q-${side}`), $(`#results-${side}`),
      q => search(q, searchFilters(active)), id => select(side, id));
  }
  $('#swap').onclick = () => { const t = picked.a; picked.a = picked.b; picked.b = t; syncAll(); };
  wireCopyLink($('#share'), 'Copy link to this pair', alertLine);
  // Only the level changes a verdict. The other filters narrow the search lists
  // and nothing else, so they must not redraw the detail — that was collapsing
  // an evidence disclosure a reader had just opened.
  for (const id of ['#f-buffs', '#f-benef']) $(id).addEventListener('change', rerunBoth);
  $('#lvl').addEventListener('change', () => { writeHash(); render(); });
  wireReadingBox(render);

  const hiddenBox = $('#f-hidden');
  hiddenBox.checked = getShowHidden();
  hiddenBox.addEventListener('change', () => { setShowHidden(hiddenBox.checked); render(); });
  window.addEventListener('hashchange', fromHash);
  await fromHash();
}

const rerunBoth = () => { rerun.a(); rerun.b(); };


async function select(side, id) {
  try { picked[side] = await spellById(id); }
  catch { alertLine(notLoaded([id])); return; }
  syncAll();
}

function writeHash() {
  const h = [];
  if (picked.a) h.push(`a=${picked.a.id}`);
  if (picked.b) h.push(`b=${picked.b.id}`);
  // A level with nothing picked would be a link to an empty page.
  if (h.length && levelParam()) h.push(levelParam());
  const want = h.length ? '#' + h.join('&') : '';
  if (location.hash !== want) history.replaceState(null, '', want || location.pathname);
}

function syncAll() {
  clearLine();
  writeHash();
  render();
}

async function fromHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  applyLevelParam(p);
  // Two different things can go wrong with an id in a link, and they are told
  // apart: one that is not in this spell file is dropped from the hash and said
  // to be missing; one that would not load stays in the hash, so a reload tries
  // it again.
  const missing = [], failed = [];
  for (const side of ['a', 'b']) {
    const id = parseInt(p.get(side), 10);
    if (!id) { picked[side] = null; continue; }
    if (picked[side]?.id === id) continue;
    try {
      picked[side] = await spellById(id);
      if (!picked[side]) missing.push(id);
    } catch { picked[side] = null; failed.push(id); }
  }
  if (missing.length) syncAll(); else { clearLine(); render(); }
  const said = [missing.length && notInFile(missing), failed.length && notLoaded(failed)].filter(Boolean);
  if (said.length) alertLine(said.join(' '));
}

// ---------- rendering -------------------------------------------------------
const durText = (t, aura) => aura ? 'while the aura holds'
  : t <= 0 ? 'instant'
  : t >= 72000 ? 'permanent'
  : `${t} tick${t === 1 ? '' : 's'} (${fmtTime(t * 6)})`;
function fmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m${s ? ' ' + s + 's' : ''}` : `${s}s`;
}

function spellCard(sp, side) {
  const c = el('div', 'card');
  const h = el('div', 'row1');
  h.appendChild(el('h2', null, sp.name));
  const tools = el('span', 'card-tools');
  const badge = el('span', 'badge ' + sp.kind, KIND_LABEL[sp.kind] || sp.kind);
  badge.title = kindHelp(sp.kind);
  tools.appendChild(badge);
  // Clearing a side used to mean editing the address bar or picking something
  // else over it. The same × the set page puts on its chips.
  const x = el('button', 'setchip-x', '×');
  x.type = 'button';
  x.title = `Clear ${sp.name}`;
  x.setAttribute('aria-label', x.title);
  x.onclick = () => { picked[side] = null; syncAll(); };
  tools.appendChild(x);
  h.appendChild(tools);
  c.appendChild(h);
  const sub = el('div', 'sub');
  const bits = [`#${sp.id}`, META.targets[sp.target] || `target ${sp.target}`, durText(sp.duration, sp.aura)];
  const lv = META.classes.map((c2, i) => sp.levels[i] < 255 ? `${c2} ${sp.levels[i]}` : null).filter(Boolean);
  if (lv.length) bits.push(lv.slice(0, 5).join(', '));
  sub.textContent = bits.join(' · ') + ' · ';
  sub.appendChild(elsewhere(sp.id));
  c.appendChild(sub);
  if (sp.it) c.appendChild(itemSource(sp.it, sp.id));
  if (sp.desc?.d) { const d = el('p', 'sub', sp.desc.d.replace(/<BR>/gi, ' ')); d.style.marginTop = '8px'; c.appendChild(d); }
  return c;
}

/**
 * Where else to read this spell.
 *
 * Not sources. Every value on this page comes from your own client files; these
 * are other people's readings of the same file, offered so a verdict here can be
 * checked against one. Which means being straight about what they are: each says
 * so on hover, because a link that quietly points at eight-month-old data is
 * worse than no link.
 *
 * Raidloot leads. Lucy is the name every EverQuest player knows, but on the exact
 * case this tool exists for it shows "Unknown #496" where raidloot shows
 * "Increase Critical Hit Damage by 300% of Base Damage (Non Stacking)".
 *
 * The history link is the one thing neither this page nor the client files can
 * give you: when a spell last changed.
 */
function elsewhere(id) {
  const span = el('span', 'elsewhere');
  const rl = link(RAIDLOOT(id), 'Raidloot');
  rl.title = THIRD_PARTY_LAG;
  const lu = link(LUCY(id), 'Lucy');
  lu.title = THIRD_PARTY_LAG + ' Lucy also has no name for some newer effects.';
  const hi = link(LUCY_HISTORY(id), 'changes');
  hi.title = 'When Lucy last saw this spell change \u2014 the client files do not record that.';
  span.appendChild(rl);
  span.appendChild(document.createTextNode(' \u00b7 '));
  span.appendChild(lu);
  span.appendChild(document.createTextNode(' \u00b7 '));
  span.appendChild(hi);
  return span;
}

/**
 * "Click · Proc — Mystic Cloak, The Sword of Rile and 4 other items"
 *
 * `it` is [relationship bitmask, total item count, [[item id, name, rel index]]].
 * Only a few named items ride along in the record; "N other items" opens the
 * full list, fetched from data/items/ the first time it is asked for.
 */
function itemSource([mask, count, items], spellId) {
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
    a.href = SODEQ_ITEM(id); a.target = '_blank'; a.rel = 'noopener';
    a.title = 'This tag came from SoDeq. Its page names who submitted the item and when it was last verified.';
    wrap.appendChild(a);
  });
  const rest = count - named;
  if (rest > 0) {
    wrap.appendChild(document.createTextNode(' and '));
    const label = `${rest} other item${rest === 1 ? '' : 's'}`;
    const more = el('button', 'linkish', label);
    more.type = 'button';
    more.setAttribute('aria-expanded', 'false');
    let list = null;
    more.addEventListener('click', async () => {
      if (list) {
        list.hidden = !list.hidden;
        more.setAttribute('aria-expanded', String(!list.hidden));
        return;
      }
      more.disabled = true;
      more.textContent = 'loading…';
      const all = await itemsOf(spellId);
      more.disabled = false;
      more.textContent = label;
      list = all ? itemList(all) : el('div', 'sub item-list-missing', 'The full list could not be loaded.');
      wrap.after(list);
      more.setAttribute('aria-expanded', 'true');
    });
    wrap.appendChild(more);
  }
  return wrap;
}

/**
 * Every item granting a spell, grouped by how it grants it. A list can run to
 * thousands, so it scrolls inside its own box rather than stretching the card.
 */
function itemList(all) {
  const box = el('div', 'item-list');
  const groups = new Map();
  for (const [id, name, rel] of all) {
    if (!groups.has(rel)) groups.set(rel, []);
    groups.get(rel).push([id, name]);
  }
  for (const [rel, entries] of groups) {
    const key = META.items.rel[rel];
    const h = el('div', 'item-list-head', `${REL_LABEL[key] || key} (${entries.length})`);
    h.title = REL_HELP[key] || '';
    box.appendChild(h);
    const ul = el('ul');
    for (const [id, name] of entries) {
      const li = el('li');
      const a = el('a', null, name);
      a.href = SODEQ_ITEM(id); a.target = '_blank'; a.rel = 'noopener';
      li.appendChild(a);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }
  return box;
}

function render() {
  for (const side of ['a', 'b']) {
    const box = $(`#chosen-${side}`); box.innerHTML = '';
    if (picked[side]) box.appendChild(spellCard(picked[side], side));
  }
  const { a, b } = picked;
  $('#share-row').hidden = !(a && b);
  if (!a || !b) { $('#verdict').hidden = true; $('#detail').hidden = true; $('#empty').hidden = false; return; }
  $('#empty').hidden = true;

  const lvl = readLevel();
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
    d.appendChild(el('h3', null, label));
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
  const statusOf = (spa) => META.claims?.[spa]?.status || 'unverified';
  const unverified = spas.filter(s => statusOf(s) === 'unverified');
  const disputed = spas.filter(s => statusOf(s) === 'disputed');
  const corroborated = spas.filter(s => statusOf(s) === 'corroborated');

  let text = `Both carry ${names}. The game does not add these together — while both buffs are up, only the value furthest from zero counts. Stacking here does not mean the numbers add.`;
  if (unverified.length)
    text += ` Treat that as unverified for SPA ${unverified.join(', ')}: it rests on how the EQEmu server accumulates the bonus, which nothing in that project backs up, and the game's own spell text never calls these non-cumulative.`;
  // Corroborated is not confirmed. A named practitioner reporting first-hand is
  // acted on, and is still not Daybreak saying so.
  if (corroborated.length)
    text += ` For SPA ${corroborated.join(', ')} this is reported first-hand from play rather than settled by a source — it is acted on here, and it has not been independently parsed.`;
  // A disputed claim is not a weaker unverified one — the sources actively
  // disagree, and saying "unverified because EQEmu says so" would be backwards
  // when EQEmu is the side saying they do add.
  if (disputed.length)
    text += ` For SPA ${disputed.join(', ')} the sources disagree: it is reported this way from play, while the EQEmu server adds the values instead. The marked value is the one the first reading would keep — see the evidence below.`;
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
  const bg = noteSection('How the bonus buckets work', META.claim_notes?.bonus_buckets);
  if (bg) d.appendChild(bg);

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

/**
 * Background that applies to a whole family of claims, rather than to one of them.
 *
 * This was one 2,000-character paragraph, which is a wall — and a wall is where a
 * reader stops, which defeats the point of showing the evidence at all. It is
 * four separate things: the rule, Daybreak naming it, a developer describing the
 * same shape, and the illustration that stops the list being read as one pool.
 * Each has its own source and its own limits, so each gets its own block, and the
 * whole section is folded away behind the per-claim evidence a reader came for.
 *
 * A note may still be a plain string; those render as they always did.
 */
function noteSection(title, note) {
  if (!note) return null;
  if (typeof note === 'string') return el('p', 'src', note);
  const d = el('details', 'background');
  d.appendChild(el('summary', null, title));
  if (note.lead) d.appendChild(el('p', 'lead', note.lead));
  for (const b of note.blocks || []) d.appendChild(noteBlock(b));
  return d;
}

// *word* -> emphasis, without handing anyone's text to innerHTML. The one bit of
// markup these notes use, and it carries meaning: "changed *away* from that
// behaviour" is the whole point of that sentence.
function emphasise(node, text) {
  for (const part of String(text).split(/(\*[^*]+\*)/g)) {
    if (!part) continue;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      node.appendChild(el('em', null, part.slice(1, -1)));
    else node.appendChild(document.createTextNode(part));
  }
  return node;
}

function noteBlock(b) {
  const box = el('div', 'bg-block');
  if (b.title) box.appendChild(el('h4', null, b.title));
  if (b.quote) box.appendChild(el('blockquote', null, `\u201c${b.quote}\u201d`));
  if (b.body) box.appendChild(emphasise(el('p'), b.body));
  // Attribution reads the same way here as it does on an evidence line, because
  // it is the same job: who said it, and where a reader can go and check.
  if (b.source || b.who) {
    const cite = el('p', 'src');
    cite.appendChild(document.createTextNode(`\u2014 ${[b.who, b.source].filter(Boolean).join(', ')}`));
    // Name the host rather than say "source" — a reader deciding whether to click
    // wants to know it goes to everquest.com and not to a forum copy of it.
    if (b.url) {
      cite.appendChild(document.createTextNode(' \u00b7 '));
      cite.appendChild(link(b.url, new URL(b.url).host.replace(/^www\./, '')));
    }
    box.appendChild(cite);
  }
  // What the source does NOT establish. It is the most easily lost sentence in a
  // paragraph and the one most worth keeping, so it gets its own line and marker.
  if (b.caveat) {
    const c = el('p', 'caveat');
    c.appendChild(el('span', 'caveat-tag', 'but'));
    emphasise(c, ' ' + b.caveat);
    box.appendChild(c);
  }
  return box;
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
 * The value that applies is named whatever the confidence — every non_cumulative
 * claim asserts which one applies, so withholding it was the tool declining to
 * answer a question its own claim had answered. What the confidence changes is how
 * firmly it is drawn and what the tooltip says, not whether it is said.
 *
 * Returns Map(slot index -> {kind, firm, status}) per side, where kind is
 * 'wins' | 'loses' | 'unsure' and unsure means there is no answer to give: the two
 * values are on opposite sides of zero and the server decides by order.
 */
function nonCumulativeMarks(overlaps) {
  const marks = { a: new Map(), b: new Map() };
  // A slot can appear in more than one pair. Losing is the strongest thing we can
  // say about a slot, so it is never downgraded by a later pair.
  const rank = { loses: 3, wins: 2, unsure: 1 };
  const set = (side, slot, kind, o) => {
    const had = marks[side].get(slot);
    if (had && rank[kind] <= rank[had.kind]) return;
    marks[side].set(slot, { kind, firm: o.status === 'confirmed', status: o.status, spa: o.spa });
  };
  for (const o of overlaps) {
    if (!o.winner) { set('a', o.slotA, 'unsure', o); set('b', o.slotB, 'unsure', o); continue; }
    // A tie loses nothing either way — that value applies whichever buff supplies it.
    if (o.winner === 'tie') { set('a', o.slotA, 'wins', o); set('b', o.slotB, 'wins', o); continue; }
    set('a', o.slotA, o.winner === 'a' ? 'wins' : 'loses', o);
    set('b', o.slotB, o.winner === 'b' ? 'wins' : 'loses', o);
  }
  return marks;
}

// How sure the page is allowed to sound. The claim's status is derived from its
// evidence, so this is the evidence speaking rather than a tone chosen here.
const HOW_SURE = {
  confirmed: '',
  corroborated: ' This rests on corroborating evidence rather than a settled source.',
  unverified: ' That this effect does not add is unverified — it rests on EQEmu\u2019s bonus'
    + ' accumulation, which nothing in that project backs up.',
  disputed: ' The sources disagree about this one: it is reported from play that only the'
    + ' better value counts, while the EQEmu server adds the two together instead.'
    + ' Neither side is taken here.',
};

const markTitle = (m) => ({
  wins: 'Does not add with the other buff\u2019s copy of this effect. This is the value furthest'
    + ' from zero, so this is the one that applies.',
  loses: 'Does not add with the other buff\u2019s copy of this effect. The other buff\u2019s value is'
    + ' further from zero, so this one does nothing while both are up.',
  unsure: 'Does not add with the other buff\u2019s copy of this effect, but the two are on opposite'
    + ' sides of zero \u2014 a bonus against a penalty. They never displace each other on their'
    + ' own terms, so which one stands depends on the order the server applied them in.',
}[m.kind] + (HOW_SURE[m.status] || ''));

function nonCumulativeLegend(marks) {
  const all = [...marks.a.values(), ...marks.b.values()];
  if (!all.length) return null;
  const kinds = new Set(all.map(m => m.kind));
  const soft = all.some(m => !m.firm);
  const p = el('p', 'legend');
  p.appendChild(document.createTextNode('Marked effects do not add together — '));
  let first = true;
  const add = (kind, label) => {
    if (!kinds.has(kind)) return;
    if (!first) p.appendChild(document.createTextNode(' · '));
    first = false;
    // The sample text carries the styling it describes, so the legend does not
    // depend on the reader naming a colour.
    p.appendChild(el('span', markClass({ kind, firm: !soft || kind === 'unsure' }), label));
  };
  add('wins', 'this value applies');
  add('loses', 'this one is ignored');
  add('unsure', 'no way to say which applies');
  if (soft) p.appendChild(document.createTextNode(
    '. Drawn faintly where the claim behind it is not settled — hover any of them for what it rests on.'));
  return p;
}

// Faint where the evidence is. One class for the colour, one for the confidence,
// so a reader can see at a glance which verdicts are load-bearing.
const markClass = (m) => 'nc-' + m.kind + (m.firm ? '' : ' nc-soft');

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
  // A row is only dropped when it is empty on BOTH sides — a spacer opposite a
  // real effect still has to be drawn, or the two columns stop lining up.
  const showHidden = getShowHidden();
  let hiddenRows = 0;
  for (let i = 0; i < span; i++) {
    const sa = slotOf(a, i), sb = slotOf(b, i);
    if (!sa && !sb) continue;
    if (!showHidden && isEmptySlot(a, i) && isEmptySlot(b, i)) { hiddenRows++; continue; }
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
  // Never omit anything silently — the slot numbers jump, and a reader should be
  // told why rather than left to work it out.
  if (hiddenRows) {
    const note = el('p', 'legend',
      `${hiddenRows} row${hiddenRows === 1 ? '' : 's'} hidden — both spells have an empty slot there. `);
    const show = el('button', 'linkish', 'Show them');
    show.onclick = () => { setShowHidden(true); $('#f-hidden').checked = true; render(); };
    note.appendChild(show);
    d.appendChild(note);
  }
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

// A phrased effect can name another spell — "Cast: [Spell 6097] on Fade". The
// phrasing itself keeps eqspellparser's token, because that is the ported line
// and a test compares it; resolving the id to a name is a presentation choice
// made here, where the index is to hand.
//
// A deliberate divergence from eqspellparser and from Lucy, which both print the
// number: the number is unreadable on its own and the name is one lookup away.
// The id stays in the tooltip so it is still quotable.
const SPELL_REF = /\[Spell (\d+)\]/g;
// Deep enough for a proc that fires a spell that has a recourse; shallow enough
// that a spell referencing itself cannot open forever.
const REF_DEPTH = 3;

function writePhrasing(node, text, host, depth) {
  let at = 0, m;
  SPELL_REF.lastIndex = 0;
  while ((m = SPELL_REF.exec(text))) {
    const id = +m[1], named = nameOf(id);
    // Not in this spell file — say so as the file does rather than offer a
    // link to nothing. Old spells do get removed.
    if (!named) continue;
    node.appendChild(document.createTextNode(text.slice(at, m.index)));
    node.appendChild(depth < REF_DEPTH ? refButton(id, named, host, depth) : el('span', 'spell-ref-flat', named));
    at = m.index + m[0].length;
  }
  node.appendChild(document.createTextNode(text.slice(at)));
}

function refButton(id, named, host, depth) {
  const b = el('button', 'spell-ref', named);
  b.type = 'button';
  b.title = `Spell ${id} — show what it does`;
  b.setAttribute('aria-expanded', 'false');
  b.onclick = async () => {
    const open = b.getAttribute('aria-expanded') === 'true';
    b.setAttribute('aria-expanded', String(!open));
    if (open) { host.querySelector(`:scope > .ref-panel[data-for="${id}"]`)?.remove(); return; }
    const panel = el('div', 'ref-panel');
    panel.dataset.for = String(id);
    panel.appendChild(el('div', 'ref-loading', 'loading…'));
    host.appendChild(panel);
    const sp = await spellById(id);
    panel.textContent = '';
    if (!sp) { panel.appendChild(el('div', 'ref-loading', 'not in this spell file')); return; }
    panel.appendChild(refBody(sp, depth));
  };
  return b;
}

/** The referenced spell, read the same way as the row that pointed at it. */
function refBody(sp, depth) {
  const box = el('div');
  const h = el('div', 'ref-head');
  h.appendChild(el('strong', null, sp.name));
  h.appendChild(el('span', 'ref-meta',
    ` · #${sp.id} · ${KIND_LABEL[sp.kind] || sp.kind} · ${durText(sp.duration, sp.aura)} · `));
  h.appendChild(elsewhere(sp.id));
  box.appendChild(h);
  const lvl = readLevel();
  const ul = el('ul', 'ref-slots');
  for (let i = 0; i < (sp.slots?.length || 0); i++) {
    const s = slotOf(sp, i);
    if (!s || isEmptySlot(sp, i)) continue;
    const v = calcValue(sp, i, lvl);
    const li = el('li');
    const said = getReading() === 'phrased' ? phrase(s, v, META.spa_names) : null;
    const line = el('span');
    if (said) writePhrasing(line, said, li, depth + 1);
    else line.textContent = META.spa_names[s.spa] || `SPA ${s.spa}`;
    li.appendChild(line);
    li.appendChild(el('span', 'spa', ` SPA ${s.spa} · base ${s.base1} · value ${v}`));
    ul.appendChild(li);
  }
  if (!ul.childElementCount) ul.appendChild(el('li', 'ref-loading', 'no effects'));
  box.appendChild(ul);
  return box;
}

function slotCell(sp, i, lvl, mark) {
  const s = slotOf(sp, i);
  if (!s) return el('td', 'empty-slot', '—');
  // A spacer opposite a real effect keeps its row for alignment, but the cell
  // itself should read as nothing rather than as "CHA, base 0, no phrasing".
  if (isEmptySlot(sp, i) && !getShowHidden()) return el('td', 'empty-slot', '—');
  const td = el('td');
  const head = el('div', 'slot-head');
  head.appendChild(el('span', 'slotno', String(i + 1)));
  const v = calcValue(sp, i, lvl);
  const said = getReading() === 'phrased' ? phrase(s, v, META.spa_names) : null;

  // The name is always the effect's own — the file's in the exact reading, the
  // phrasing in the other. Substituting a word of mine for "CHA" was wrong in
  // both, and specifically wrong in the exact reading, which exists precisely so
  // a reader can quote what the file says.
  const empty = isEmptySlot(sp, i);
  const text = said || META.spa_names[s.spa] || `SPA ${s.spa}`;
  const name = el('span', empty ? 'empty-name' : (mark ? markClass(mark) : null));
  // A phrasing that names another spell should be able to show it. Only the
  // phrased reading gets this: the exact reading is there to be quoted, and a
  // spell name is not what the file says.
  if (said) writePhrasing(name, text, td, 0); else name.textContent = text;
  if (mark && !empty) name.title = markTitle(mark);
  if (empty) name.title = 'A spacer slot — the client pads unused slots with SPA 10 at base 0.';
  head.appendChild(name);
  // Say when there is no phrasing rather than quietly showing the exact name and
  // letting it read as one. About 7% of slots are in this state — a spacer is
  // not one of them, it is understood perfectly and simply says nothing.
  if (getReading() === 'phrased' && !said && !empty) {
    const nb = el('span', 'badge rel', 'as-is');
    nb.title = 'No plain wording for this effect yet — showing the name from the spell file.';
    head.appendChild(nb);
  }
  td.appendChild(head);
  td.appendChild(el('div', 'spa', `SPA ${s.spa} · base ${s.base1}${s.base2 ? ' / ' + s.base2 : ''}${s.max ? ' · max ' + s.max : ''} · value ${v}`));
  return td;
}

boot();
