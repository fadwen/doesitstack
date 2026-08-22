// Load and validate claims.json — the mechanic claims this project makes to users,
// each with the evidence behind it.
//
// A claim's status is derived from its evidence, never written by hand:
//   confirmed     a primary source — Daybreak's own words, or a parse
//   corroborated  a strong source — a named practitioner with standing in the game
//   unverified    only supporting or weak sources
//   disputed      something refutes it
//
// That derivation is the point of the file. Adding evidence to a claim changes what
// the site tells people with no code change anywhere else — and for claims the
// engine can act on, it changes the verdicts too. `confirmed` and `corroborated`
// are both acted on; `unverified` is flagged to the reader but not acted on.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const CLAIMS_PATH = path.join(ROOT, 'claims.json');

export const STRENGTHS = ['primary', 'strong', 'supporting', 'weak'];
export const KINDS = [
  'game-text', 'dev-statement', 'patch-notes', 'parse',
  'practitioner',   // a named person with standing: class rep, raid mechanics lead, known theorycrafter
  'implementation', 'community',
];

// The best rating each kind of evidence can carry. Downgrading is always allowed —
// a data file that only implies a behaviour is weaker than one that states it — but
// nothing may be rated above its ceiling.
//
// Daybreak is the source of truth: the client's own files, its patch notes, its
// developers. EQEmu is the most complete public implementation of these rules and
// the reason this project could be written at all, but it is a volunteer
// reimplementation targeting a 2013 client, and this thread has already found
// places where it diverges from live. It corroborates. It never settles.
const MAX_STRENGTH = {
  'game-text': 'primary',
  'dev-statement': 'primary',
  'patch-notes': 'primary',
  'parse': 'primary',
  'practitioner': 'strong',
  'implementation': 'supporting',
  'community': 'weak',
};
export const TYPES = ['non_cumulative', 'focus_best_only', 'focus_stacking', 'stacking_rule'];

// Types that describe a rule rather than a spell effect, so they carry a slug
// instead of a SPA number.
const RULE_TYPES = ['stacking_rule'];

export function deriveStatus(claim) {
  if (claim.evidence.some(e => e.refutes)) return 'disputed';
  if (claim.evidence.some(e => e.strength === 'primary')) return 'confirmed';
  if (claim.evidence.some(e => e.strength === 'strong')) return 'corroborated';
  return 'unverified';
}

/** Statuses the engine is allowed to change its behaviour on. */
export const ACTIONABLE = ['confirmed', 'corroborated'];
export const isActionable = (claim) => ACTIONABLE.includes(claim.status ?? deriveStatus(claim));

/** Structural validation. Returns a list of human-readable problems. */
export function validate(doc) {
  const problems = [];
  const fail = (where, msg) => problems.push(`${where}: ${msg}`);

  if (doc.version !== 1) fail('claims.json', `unsupported version ${doc.version}`);
  if (!Array.isArray(doc.claims)) { fail('claims.json', 'claims must be an array'); return problems; }

  const seen = new Set();
  for (const c of doc.claims) {
    const where = c.id || '(claim with no id)';
    if (!c.id) fail(where, 'missing id');
    else if (seen.has(c.id)) fail(where, 'duplicate id');
    else seen.add(c.id);

    if (!TYPES.includes(c.type)) fail(where, `unknown type "${c.type}" (expected one of ${TYPES.join(', ')})`);

    if (RULE_TYPES.includes(c.type)) {
      // A rule claim names a rule the engine can cite in a verdict.
      if (!c.slug) fail(where, 'a rule claim needs a "slug" matching the engine\'s rule name');
      if (c.spa != null || c.spas != null) fail(where, 'a rule claim describes a rule, not a SPA');
      if (c.id && c.slug && c.id !== `${c.type.replace(/_/g, '-')}/${c.slug}`)
        fail(where, `id should be "${c.type.replace(/_/g, '-')}/${c.slug}"`);
    } else {
      // A claim is about one SPA (`spa`) or a set of them (`spas`), never both.
      const hasOne = Number.isInteger(c.spa), hasMany = Array.isArray(c.spas);
      if (hasOne === hasMany) fail(where, 'needs exactly one of "spa" (an integer) or "spas" (an array)');
      if (hasMany && !c.spas.every(Number.isInteger)) fail(where, 'every entry in "spas" must be an integer');
      if (hasMany && !c.slug) fail(where, 'a claim covering several SPAs needs a "slug" to name it');
      if (c.id && c.type) {
        const want = `${c.type.replace(/_/g, '-')}/${hasOne ? c.spa : c.slug}`;
        if (c.id !== want) fail(where, `id should be "${want}"`);
      }
    }
    if (!c.assertion || c.assertion.length < 10) fail(where, 'assertion missing or too short to be meaningful');
    if (!Array.isArray(c.evidence) || c.evidence.length === 0) { fail(where, 'needs at least one evidence entry'); continue; }

    c.evidence.forEach((e, i) => {
      const ew = `${where} evidence[${i}]`;
      if (!STRENGTHS.includes(e.strength)) fail(ew, `strength must be one of ${STRENGTHS.join(', ')}`);
      if (!KINDS.includes(e.kind)) fail(ew, `kind must be one of ${KINDS.join(', ')}`);
      if (!e.summary) fail(ew, 'missing summary');
      if (!e.source) fail(ew, 'missing source — say where this came from, specifically enough to check');
      const ceiling = MAX_STRENGTH[e.kind];
      if (ceiling && STRENGTHS.indexOf(e.strength) < STRENGTHS.indexOf(ceiling))
        fail(ew, `kind "${e.kind}" cannot be ${e.strength} — at best it is ${ceiling}. See CONTRIBUTING.md`);
      if (e.kind === 'practitioner') {
        // `who` is the credit line the site prints — a name, nothing more.
        // `standing` is what justifies the strong tier, and stays in the repo for
        // whoever reviews the claim later. Splitting them keeps the page readable
        // without losing the reason the evidence was rated the way it was.
        if (!e.who) fail(ew, 'a practitioner report needs "who" — the name to credit');
        if (!e.standing) fail(ew, 'a practitioner report needs "standing" — why this person\'s report weighs');
        if (e.who && e.who.length > 40) fail(ew, '"who" is a credit line, not a biography — put the detail in "standing"');
      }
      if (e.kind === 'parse') {
        for (const f of ['method', 'sample_size', 'result'])
          if (!e[f]) fail(ew, `a parse needs "${f}" — see the parse protocol in CONTRIBUTING.md`);
      }
    });
  }

  // A note is background shared by a family of claims. It may be a plain string,
  // or blocks — which exist because one 2,000-character paragraph is where a
  // reader stops. The rules are the same either way: a quotation has to say who
  // said it, and a block has to say something.
  for (const [key, note] of Object.entries(doc.notes || {})) {
    const where = `notes.${key}`;
    if (typeof note === 'string') {
      if (note.length < 10) fail(where, 'too short to be worth recording');
      continue;
    }
    if (!note || typeof note !== 'object') { fail(where, 'must be a string or an object with blocks'); continue; }
    if (!Array.isArray(note.blocks) || !note.blocks.length) { fail(where, 'needs a non-empty "blocks" array'); continue; }
    note.blocks.forEach((b, i) => {
      const bw = `${where} blocks[${i}]`;
      if (!b.title) fail(bw, 'missing title — it is what makes the section scannable');
      if (!b.body && !b.quote) fail(bw, 'needs a "body", a "quote", or both');
      if (b.quote && !b.source) fail(bw, 'a quotation must say where it came from');
      if (b.url && !/^https?:\/\//.test(b.url)) fail(bw, '"url" must be an absolute http(s) link');
    });
  }
  return problems;
}

export function load(file = CLAIMS_PATH) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = validate(doc);
  if (problems.length) {
    throw new Error(`claims.json is invalid:\n  ${problems.join('\n  ')}`);
  }
  for (const c of doc.claims) c.status = deriveStatus(c);
  return doc;
}

export const byType = (doc, type) => doc.claims.filter(c => c.type === type);

/** Every SPA a claim covers, whether it names one or many. */
export const spasOf = (claim) => Number.isInteger(claim.spa) ? [claim.spa] : (claim.spas || []).slice();
