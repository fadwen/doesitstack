// The parts of the page both views draw: the search box and its dropdown, the
// filter chips, the footer, and the lines that say something went wrong.
//
// These used to be copied between app.js and set.js, and the copies drifted —
// the set page's result rows had lost the item tags, its footer the no-item-data
// sentence. One body for each, so a fix lands on both pages at once. data.js
// stays about the data; this file is about the DOM the two pages share.

import { dataAge, itemDataAge } from './freshness.js';
import {
  $, el, link, META, row, F_AURA, KIND_LABEL, REL_LABEL, kindHelp, relsOf, orderClasses,
  getReading, setReading,
} from './data.js';

// Which source buckets a search shows by default. Triggered and NPC are the
// two a player is not choosing between, so they start off.
export const DEFAULT_KINDS = ['spell', 'discipline', 'song', 'aa', 'item', 'aura', 'other'];

/** The caster level from the #lvl box, or the cap when it says nothing usable. */
export const readLevel = () => parseInt($('#lvl').value, 10) || META.max_level;

// The level rides in the hash so a shared link reproduces the verdict — a
// calc that scales with level can change the answer. Only written when it is
// not the cap, so a plain link stays plain.
export const levelParam = () => (readLevel() !== META.max_level ? `lvl=${readLevel()}` : null);
/** Take a level from the hash into the box, clamped to what the data allows. */
export function applyLevelParam(p) {
  const l = parseInt(p.get('lvl'), 10);
  if (!l) return false;
  const want = Math.max(1, Math.min(META.max_level, l));
  if (want === readLevel()) return false;
  $('#lvl').value = want;
  return true;
}

/**
 * A button that copies the address bar. Clipboard access is refused in plenty
 * of contexts; the URL already holds the state, so the failure says that
 * rather than nothing.
 */
export function wireCopyLink(btn, label, alertLine) {
  btn.type = 'button';
  btn.textContent = label;
  btn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = 'Link copied';
      setTimeout(() => { btn.textContent = label; }, 1500);
    } catch {
      alertLine('Could not reach the clipboard — the address bar already holds this link, copy it from there.');
    }
  };
  return btn;
}

// A line for things the page could not do with what it was given: an id in the
// link that is not in this spell file, a spell that would not load, a set that
// would not save. Its own static element, never inside a region a render
// redraws — that is what kept wiping the storage warning before anyone saw it.
export function noticeLine(sel) {
  return {
    alertLine: text => { const n = $(sel); n.textContent = text; n.hidden = false; },
    clearLine: () => { $(sel).hidden = true; },
  };
}

// Nothing drawn and nothing said was what a 404 on the data used to produce — a
// blank page, most likely during the minute a deploy is half-copied.
export function dataFailed(err) {
  const box = $('#stale');
  box.hidden = false;
  box.className = 'stale bad';
  box.textContent = `The spell data could not be loaded (${err.message}). This copy may be `
    + 'mid-deploy — try again in a minute.';
}

// ---------- filters -----------------------------------------------------------

// A chip is a toggle button, and says so: the lit state was only ever a colour.
const press = (b, on) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); };

/**
 * The Source and Class chips. `active` is the page's {kinds, cls} and is
 * mutated in place; `onChange` is called after every change.
 */
export function buildFilters(active, onChange) {
  const kinds = $('#kinds');
  for (const k of META.kinds) {
    const b = el('button', 'chip', KIND_LABEL[k] || k);
    b.type = 'button';
    b.title = kindHelp(k);
    press(b, active.kinds.has(k));
    b.onclick = () => {
      active.kinds.has(k) ? active.kinds.delete(k) : active.kinds.add(k);
      press(b, active.kinds.has(k));
      onChange();
    };
    kinds.appendChild(b);
  }
  const classes = $('#classes');
  // Keyed by class index, not by position: the chips are no longer in class-index
  // order, so "which chip is lit" cannot be derived from where it sits. One of
  // many, but still pressed buttons rather than radios — a radio group promises
  // arrow-key movement between its members, which these do not have.
  const chips = new Map();
  const mk = (label, idx) => {
    const b = el('button', 'chip', label);
    b.type = 'button';
    press(b, active.cls === idx);
    b.onclick = () => {
      active.cls = active.cls === idx ? -1 : idx;
      for (const [i, node] of chips) press(node, i === active.cls);
      onChange();
    };
    chips.set(idx, b);
    classes.appendChild(b);
  };
  mk('Any', -1);
  for (const { label, idx } of orderClasses(META.classes)) mk(label, idx);
}

/** What search() is asked for, read from the chips and the two checkboxes. */
export const searchFilters = active => ({
  buffsOnly: $('#f-buffs').checked, benefOnly: $('#f-benef').checked,
  kinds: active.kinds, cls: active.cls,
});

// Checked means "show me what the file says" — the opposite of the old box,
// because the readable form is now what you get without asking.
export function wireReadingBox(onChange) {
  const exactBox = $('#f-exact');
  exactBox.checked = getReading() === 'exact';
  exactBox.addEventListener('change', () => { setReading(exactBox.checked ? 'exact' : 'phrased'); onChange(); });
}

// ---------- the picker --------------------------------------------------------

/** One row of the dropdown: name, kind badge, item tags, and a line of facts. */
export function resultButton(r) {
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
  if (r[row.flags] & F_AURA) bits.push('aura');
  else if (r[row.duration] > 0) bits.push(`${r[row.duration]} tick${r[row.duration] === 1 ? '' : 's'}`);
  if (r[row.category]) bits.push(r[row.category]);
  b.appendChild(el('div', 'meta', bits.join(' · ')));
  return b;
}

/**
 * Wire a search box to its dropdown. `find(q)` returns index rows for a query
 * of two or more characters; `onSelect(id)` is told what was picked. Returns
 * the function that reruns the search, for the page to call when a filter
 * changes.
 *
 * To a screen reader this is a combobox over a listbox: the input says whether
 * the list is open and which option the arrow keys have reached, and each row
 * is an option. Nothing about the behaviour changed for anyone else.
 */
export function wirePicker(input, box, find, onSelect) {
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-controls', box.id);
  box.setAttribute('role', 'listbox');
  const show = open => {
    box.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
  };
  show(false);
  // The option the arrow keys are on, or none. Class for the eye, aria for
  // the reader, and the input points at it so the reader follows along.
  const highlight = n => {
    const btns = [...box.querySelectorAll('button')];
    btns.forEach((b, i) => { b.classList.toggle('on', i === n); b.setAttribute('aria-selected', String(i === n)); });
    if (btns[n]) { input.setAttribute('aria-activedescendant', btns[n].id); btns[n].scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const rerun = () => {
    const q = input.value.trim().toLowerCase();
    box.innerHTML = '';
    input.removeAttribute('aria-activedescendant');
    if (q.length < 2) { show(false); return; }
    const hits = find(q);
    if (!hits.length) { show(false); return; }
    hits.forEach((r, i) => {
      const b = resultButton(r);
      b.type = 'button';
      b.id = `${box.id}-${i}`;
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', 'false');
      b.onmousedown = e => e.preventDefault();
      b.onclick = () => { show(false); onSelect(r[row.id]); };
      box.appendChild(b);
    });
    // A filter change reruns the search too, and the list is only wanted
    // under the box someone is typing in — not popped open over the page by
    // a click somewhere else.
    show(document.activeElement === input);
  };
  input.addEventListener('input', rerun);
  input.addEventListener('focus', rerun);
  // Tab from the box onto a result must not close the list under the cursor,
  // which hiding on every blur did. Focus leaving for anywhere else still
  // closes it, on the same short delay as before so a tap on a row lands.
  const leaving = e => {
    const to = e.relatedTarget;
    if (to === input || box.contains(to)) return;
    setTimeout(() => { if (document.activeElement !== input && !box.contains(document.activeElement)) show(false); }, 150);
  };
  input.addEventListener('blur', leaving);
  box.addEventListener('focusout', leaving);
  input.addEventListener('keydown', e => {
    const btns = [...box.querySelectorAll('button')];
    const i = btns.findIndex(b => b.classList.contains('on'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && btns[Math.max(i, 0)]) {
      e.preventDefault(); btns[Math.max(i, 0)].click();
    } else if (e.key === 'Escape') show(false);
  });
  return rerun;
}

// ---------- footer ------------------------------------------------------------

/** Say where the data came from and how old it is; warn once that matters. */
export function renderDataAge() {
  const b = $('#build');
  b.appendChild(document.createTextNode(
    `${META.spell_count.toLocaleString()} spells, read from a client spells_us.txt dated ${META.spell_file_date}. `
    + `This copy was built ${META.built.slice(0, 10)}.`));
  if (META.items) {
    // Name the source here too — this is the sentence a reader is actually
    // looking at when they wonder where the item tags came from.
    b.appendChild(document.createTextNode(' Which items grant an effect comes from the '));
    b.appendChild(link(META.items.source, 'SoDeq item database'));
    b.appendChild(document.createTextNode(`, last updated ${META.items.updated}.`));
  } else {
    b.appendChild(document.createTextNode(
      ' No item database was loaded for this build, so nothing is tagged with the item that grants it.'));
  }

  const notes = [dataAge(META.spell_file_date), META.items ? itemDataAge(META.items.updated) : {}]
    .filter(n => n.message);
  if (!notes.length) return;
  const box = $('#stale');
  box.hidden = false;
  box.className = notes.some(n => n.level === 'stale') ? 'stale bad' : 'stale';
  box.textContent = notes.map(n => n.message).join(' ');
}

/**
 * Who else's work this is built on, named on the page rather than only in the
 * repo. Most visitors never open the README, and the item database in particular
 * is the one source whose data is shipped here rather than merely linked — so
 * "a separate community database" was not an acceptable way to describe it.
 *
 * Built from META, not hardcoded, so a build that ran without item data does not
 * credit a source it never used.
 */
export function renderCredits() {
  const p = $('#credits');
  p.appendChild(document.createTextNode('Built on work by others: '));
  const parts = [
    link('https://forums.daybreakgames.com/eq/index.php?threads/enumerated-spa-list.206288/', 'Daybreak’s published SPA list'),
    link('https://github.com/EQEmu/Server', 'the EQEmu stacking implementation'),
    link('https://github.com/rumstil/eqspellparser', 'eqspellparser’s field layout'),
  ];
  if (META.items) parts.push(link(META.items.source, 'the SoDeq item database'));
  parts.push(link('https://www.raidloot.com/', 'Raidloot'));
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

export function renderFooter() {
  renderDataAge();
  renderCredits();
  if (META.repo_url) $('#repo-link').href = META.repo_url;
}
