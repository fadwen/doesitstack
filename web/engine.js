// Stacking rules engine.
//
// This is a port of EverQuest's buff-stacking arbitration as implemented in
// EQEmu's Mob::CheckStackConflict (zone/spells.cpp), which itself mirrors the
// RoF2 client. Server-only inputs that we cannot know from spell data alone
// (existing spell bonuses, Screech/AStacker buff state, NPC-vs-NPC DoT rules,
// resurrection sickness) are omitted and called out in `caveats`.
//
// Vocabulary: `a` is the buff already on you, `b` is the one being cast.
//   'independent' -> no shared slot/effect, both sit on you at once
//   'overwrite'   -> b lands and removes a
//   'blocked'     -> b refuses to land
//
// Live's SpellStackingGroups.txt adds a second, newer mechanism on top of the
// slot arbitration: two spells in the same stacking group never coexist.

import {
  SPA_NAMES, IGNORED_IN_STACKING, NON_CUMULATIVE_SPA, NON_CUMULATIVE_CONFIRMED,
  NON_CUMULATIVE_STATUS, NON_CUMULATIVE_OFFSET, IGNORED_BY_CLAIM,
  FOCUS_SPA, FOCUS_BEST_ONLY, FOCUS_LIMIT, FOCUS_PROC_EXCEPTIONS, FOCUS_CONTESTED, MAX_PLAYER_LEVEL,
} from './spa.js';

export const SPA = {
  CurrentHP: 0, ArmorClass: 1, ATK: 2, MovementSpeed: 3, CHA: 10, AttackSpeed: 11,
  CompleteHeal: 101, Screech: 123, StackingBlock: 148, StackingOverwrite: 149,
  ManaBurn: 350, BardAEDot: 334, ImprovedTaunt: 444, AttackSpeed2: 98, ACv2: 416,
  Blank: 254,
};

const SPELL_EYE_OF_ZOMM = 331;
const SPELL_MANA_BURN   = 2751;

// EQEmu's EFFECT_COUNT is a hard 12, because that is what the RoF2 client held.
// EverQuest allows up to 100. Modern bard songs run past 20 and the longest spell in
// the current file has 67, so arbitration walks however many slots the two spells
// actually have — there is no ceiling here, and imposing one at any number below 100
// would silently drop effects the way the twelve-slot cap did.
const LEGACY_EFFECT_COUNT = 12;
const slotSpan = (a, b) => Math.max(a.slots?.length || 0, b.slots?.length || 0, LEGACY_EFFECT_COUNT);

const ST_GROUP_TELEPORT = 0x03, ST_AE_BARD = 0x28, ST_GROUP = 0x29;
const BARD_INDEX = 7;

// The client-derived list, plus whatever a claim with real evidence behind it says
// should also be exempt. Evidence changing a verdict is the point; see claims.json.
const ignored = new Set([...IGNORED_IN_STACKING, ...IGNORED_BY_CLAIM]);
const ignoredByClaim = new Set(IGNORED_BY_CLAIM);
const focusSpa = new Set(FOCUS_SPA);
const focusLimit = new Set(FOCUS_LIMIT);
const focusBestOnly = new Set(FOCUS_BEST_ONLY);
const focusContested = new Set(FOCUS_CONTESTED);

export const slotOf = (sp, i) => (sp.slots && sp.slots[i]) || null;
export const spaOf  = (sp, i) => { const s = slotOf(sp, i); return s ? s.spa : SPA.Blank; };

export const isBardSong    = sp => sp.levels[BARD_INDEX] < 255 && !sp.is_skill;
export const isGroupSpell  = sp => sp.target === ST_GROUP || sp.target === ST_AE_BARD || sp.target === ST_GROUP_TELEPORT;
export const isDetrimental = sp => !sp.beneficial;
export const hasEffect     = (sp, spa) => (sp.slots || []).some(s => s && s.spa === spa);

// SPA 10 with base 0 and calc 100 is the client's "spacer"; 148/149 are commands,
// not effects. All three are invisible to the slot-by-slot comparison.
/**
 * A slot with nothing in it for a reader.
 *
 * Deliberately narrower than isBlankSlot below. That one answers "does this
 * take part in arbitration", and includes SPA 148 and 149 — which are the most
 * informative rows in a slot table, not the least. Hiding a stacking blocker to
 * tidy the display would remove the very thing most verdicts turn on.
 *
 * Only the client's spacer qualifies: SPA 10, base 0, calc 100. The 42 slots in
 * the file with base 0 and some other calc are left visible, since a formula
 * that is not the flat one may do something.
 */
export const isEmptySlot = (sp, i) => {
  const s = slotOf(sp, i);
  if (!s || s.spa === SPA.Blank) return true;
  return s.spa === SPA.CHA && s.base1 === 0 && s.calc === 100;
};

export function isBlankSlot(sp, i) {
  const s = slotOf(sp, i);
  if (!s || s.spa === SPA.Blank) return true;
  if (s.spa === SPA.CHA && s.base1 === 0 && s.calc === 100) return true;
  return s.spa === SPA.StackingBlock || s.spa === SPA.StackingOverwrite;
}

export function isStackableDot(sp) {
  return !(sp.unstackable_dot || sp.beneficial || !sp.dur_calc);
}

// Mob::CalcSpellEffectValue_formula. `ticsRemaining` only matters for the
// degenerating formulas (107/108/120/122/1000-1999), which we evaluate at cast time.
export function calcValue(sp, i, level = MAX_PLAYER_LEVEL, ticsRemaining = 0) {
  const s = slotOf(sp, i);
  if (!s || isBlankSlot(sp, i)) return 0;
  const { calc: formula, base1: base, max } = s;
  const ubase = Math.abs(base);
  const sign = (max < base && max !== 0) ? -1 : 1;
  const durTics = () => {
    const total = calcDuration(sp.dur_calc, sp.dur_cap, level);
    return Math.max(total - Math.max(ticsRemaining - 1, 0), 0);
  };
  let r = 0;
  switch (formula) {
    case 60: case 70: r = Math.trunc(ubase / 100); break;
    case 0: case 100: r = ubase; break;
    case 101: r = sign * (ubase + Math.trunc(level / 2)); break;
    case 102: r = sign * (ubase + level); break;
    case 103: r = sign * (ubase + level * 2); break;
    case 104: r = sign * (ubase + level * 3); break;
    case 105: r = sign * (ubase + level * 4); break;
    case 107: r = sign * (ubase - durTics()); break;
    case 108: r = sign * (ubase - 2 * durTics()); break;
    case 109: r = sign * (ubase + Math.trunc(level / 4)); break;
    case 110: r = ubase + Math.trunc(level / 6); break;
    case 111: r = sign * (ubase + 6 * (level - 16)); break;
    case 112: r = sign * (ubase + 8 * (level - 24)); break;
    case 113: r = sign * (ubase + 10 * (level - 34)); break;
    case 114: r = sign * (ubase + 15 * (level - 44)); break;
    case 115: r = ubase + (level > 15 ? 7 * (level - 15) : 0); break;
    case 116: r = ubase + (level > 24 ? 10 * (level - 24) : 0); break;
    case 117: r = ubase + (level > 34 ? 13 * (level - 34) : 0); break;
    case 118: r = ubase + (level > 44 ? 20 * (level - 44) : 0); break;
    case 119: r = ubase + Math.trunc(level / 8); break;
    case 120: r = sign * (ubase - 5 * durTics()); break;
    case 121: r = ubase + Math.trunc(level / 3); break;
    case 122: r = sign * (ubase - 12 * durTics()); break;
    case 123: r = Math.trunc((ubase + Math.abs(max)) / 2); break;   // random range; use the midpoint
    case 124: case 125: case 126: case 127: case 128: case 129: case 130: case 131: case 132: {
      const mult = { 124: 1, 125: 2, 126: 3, 127: 4, 128: 5, 129: 10, 130: 15, 131: 20, 132: 25 }[formula];
      r = ubase + (level > 50 ? sign * mult * (level - 50) : 0); break;
    }
    case 139: r = ubase + (level > 30 ? Math.trunc((level - 30) / 2) : 0); break;
    case 140: r = ubase + (level > 30 ? level - 30 : 0); break;
    case 141: r = ubase + (level > 30 ? Math.trunc((3 * level - 90) / 2) : 0); break;
    case 142: r = ubase + (level > 30 ? 2 * level - 60 : 0); break;
    case 143: r = ubase + Math.trunc(3 * level / 4); break;
    case 144: r = ubase + level * 10 + (level - 40) * 20; break;
    case 201: case 203: r = max; break;
    default:
      if (formula < 100) r = ubase + level * formula;
      else if (formula > 1000 && formula < 1999) r = sign * (ubase - (formula - 1000) * durTics());
      else if (formula >= 2000 && formula <= 2650) r = ubase * (level * (formula - 2000) + 1);
      else r = ubase;
  }
  if (max !== 0) r = sign === 1 ? Math.min(r, max) : Math.max(r, max);
  if (base < 0 && r > 0) r = -r;
  return r;
}

export function calcDuration(calc, cap, level = MAX_PLAYER_LEVEL) {
  let v;
  switch (calc) {
    case 0: v = 0; break;
    case 1: v = Math.max(Math.trunc(level / 2), 1); break;
    case 2: v = Math.max(Math.trunc(level / 2) + 5, 6); break;
    case 3: v = level * 30; break;
    case 4: v = 50; break;
    case 5: v = 2; break;
    case 6: v = Math.trunc(level / 2); break;
    case 7: v = level; break;
    case 8: v = level + 10; break;
    case 9: v = level * 2 + 10; break;
    case 10: v = level * 30 + 10; break;
    case 11: v = (level + 3) * 30; break;
    case 12: v = Math.max(Math.trunc(level / 2), 1); break;
    case 13: v = level * 4 + 10; break;
    case 14: v = level * 5 + 10; break;
    case 15: v = (level * 5 + 50) * 2; break;
    case 50: v = 72000; break;
    case 3600: v = 3600; break;
    default: v = cap;
  }
  if (cap > 0 && v > cap) v = cap;
  return v;
}

const spaName = spa => SPA_NAMES[spa] || `SPA ${spa}`;

/**
 * Decide what happens when `b` is cast on a target already carrying `a`.
 *
 * @param {object} a  spell already on the target
 * @param {object} b  spell being cast
 * @param {{levelA?:number, levelB?:number}} opts caster levels
 * @returns {{verdict:'independent'|'overwrite'|'blocked', code:-1|0|1,
 *            reason:string, rule:string, slots:Array, caveats:string[],
 *            sharedGroups:Array}}
 */
export function checkStack(a, b, opts = {}) {
  const levelA = opts.levelA ?? MAX_PLAYER_LEVEL;
  const levelB = opts.levelB ?? MAX_PLAYER_LEVEL;
  const n = slotSpan(a, b);
  const slots = [];
  const caveats = [];
  const done = (code, rule, reason, decidedBy = null) => ({
    verdict: code === 1 ? 'overwrite' : code === -1 ? 'blocked' : 'independent',
    code, rule, reason, slots, caveats, decidedBy,
    // A verdict resting on a focus SPA that the client-derived ignore list omits.
    // Focus effects are widely reported to stack regardless of slot, so this answer
    // may be wrong — see the focus_stacking claim in claims.json.
    // Empty once the focus stacking claim becomes actionable — at that point those
    // SPAs are exempted outright rather than arbitrated under a doubt flag.
    contestedFocus: code !== 0 && decidedBy != null && focusContested.has(decidedBy)
      ? { spa: decidedBy, name: spaName(decidedBy) } : null,
    sharedGroups: sharedStackingGroups(a, b),
  });

  // --- Live spell stacking groups -----------------------------------------
  // Newer than the slot arbitration and evaluated by the client first: two
  // spells sharing a stacking group never coexist.
  const shared = sharedStackingGroups(a, b);
  if (shared.length && a.id !== b.id) {
    const g = shared[0];
    if (g.type === 6 && g.rankB <= g.rankA) {
      return done(-1, 'stacking-group',
        `Both are in stacking group "${g.name}" (non-override). ${a.name} is already up, so ${b.name} will not take hold.`);
    }
    if (g.rankB >= g.rankA) {
      return done(1, 'stacking-group',
        `Both are in stacking group "${g.name}". ${b.name} is rank ${g.rankB} vs rank ${g.rankA}, so it replaces ${a.name}.`);
    }
    return done(-1, 'stacking-group',
      `Both are in stacking group "${g.name}". ${b.name} is the weaker rank (${g.rankB} vs ${g.rankA}) and will not overwrite ${a.name}.`);
  }

  // --- same spell ----------------------------------------------------------
  if (a.id === b.id) {
    if (a.id === SPELL_EYE_OF_ZOMM) return done(-1, 'same-spell', 'Eye of Zomm will not re-land while it is already up.');
    if (!isStackableDot(a) && !hasEffect(a, SPA.ManaBurn)) {
      if (levelA > levelB) {
        if (hasEffect(a, SPA.ImprovedTaunt))
          return done(1, 'same-spell', 'Same spell; Improved Taunt is exempt from the level check, so the new cast overwrites.');
        return done(-1, 'same-spell', `Same spell, but the existing one was cast at a higher level (${levelA} vs ${levelB}).`);
      }
      return done(1, 'same-spell', `Same spell cast at an equal or higher level (${levelB} vs ${levelA}) — it refreshes.`);
    }
    if (a.id === SPELL_MANA_BURN) return done(-1, 'same-spell', 'Mana Burn does not stack with itself.');
  }

  // --- bard song vs non-song ----------------------------------------------
  if (isBardSong(a) !== isBardSong(b) && a.beneficial && b.beneficial) {
    return done(0, 'bard-song',
      `One is a bard song and one is not, and both are beneficial — songs occupy their own arbitration space, so these always stack.`);
  }

  // --- is this the same spell line? ---------------------------------------
  // If every slot carries the same SPA, the two are ranks of one line and the
  // client skips the 148/149 command checks.
  let effectMatch = true;
  if (a.id !== b.id) {
    for (let i = 0; i < n; i++) {
      if (spaOf(a, i) !== spaOf(b, i) || spaOf(a, i) === SPA.ManaBurn) { effectMatch = false; break; }
    }
  } else if (hasEffect(a, SPA.ManaBurn)) {
    return done(-1, 'mana-burn', 'Mana Burn spells never stack with themselves.');
  }

  // --- SPA 148 (block) / SPA 149 (overwrite) commands ----------------------
  if (!effectMatch) {
    for (let i = 0; i < n; i++) {
      const sa = slotOf(a, i), sb = slotOf(b, i);

      if (sb && sb.spa === SPA.StackingOverwrite) {
        const target = (sb.base2 > 0 ? sb.base2 - 1 : sb.calc - 201);
        const wantSpa = sb.base1, below = sb.max;
        if (spaOf(a, target) === wantSpa) {
          const v = calcValue(a, target, levelA);
          slots.push({ slot: i, kind: 'overwrite-command', spa: SPA.StackingOverwrite,
            detail: `${b.name} slot ${i + 1}: overwrite anything whose slot ${target + 1} is ${spaName(wantSpa)} below ${below}. ${a.name} has ${v}.`,
            outcome: v < below ? 'overwrite' : 'no-effect' });
          if (v < below)
            return done(1, 'spa-149', `${b.name} carries an overwrite command (SPA 149): it replaces any buff whose slot ${target + 1} ${spaName(wantSpa)} is below ${below}, and ${a.name} has ${v}.`);
        }
      } else if (sa && sa.spa === SPA.StackingBlock) {
        const target = (sa.base2 > 0 ? sa.base2 - 1 : sa.calc - 201);
        const wantSpa = sa.base1, below = sa.max;
        if (spaOf(b, target) === wantSpa) {
          const v = calcValue(b, target, levelB);
          const bypass = isDetrimental(b);   // Live change, 2018: detrimental spells ignore SPA 148
          slots.push({ slot: i, kind: 'block-command', spa: SPA.StackingBlock,
            detail: `${a.name} slot ${i + 1}: block anything whose slot ${target + 1} is ${spaName(wantSpa)} below ${below}. ${b.name} has ${v}.`,
            outcome: (v < below && !bypass) ? 'blocked' : 'no-effect' });
          if (v < below && !bypass)
            return done(-1, 'spa-148', `${a.name} carries a block command (SPA 148): it blocks any buff whose slot ${target + 1} ${spaName(wantSpa)} is below ${below}, and ${b.name} has only ${v}.`);
        }
      }
    }
  }

  // --- slot-by-slot arbitration -------------------------------------------
  const aDet = isDetrimental(a), bDet = isDetrimental(b);
  let willOverwrite = false, valuesEqual = true, lastConflictSpa = null;

  for (let i = 0; i < n; i++) {
    if (isBlankSlot(a, i) || isBlankSlot(b, i)) continue;
    const e1 = spaOf(a, i), e2 = spaOf(b, i);
    const row = { slot: i, spaA: e1, spaB: e2, nameA: spaName(e1), nameB: spaName(e2) };

    if (e1 !== e2) {
      slots.push({ ...row, kind: 'slot', outcome: 'no-conflict',
        detail: `Slot ${i + 1}: ${spaName(e1)} vs ${spaName(e2)} — different effects in the same slot never conflict.` });
      continue;
    }
    if (e1 === SPA.BardAEDot && a.levels[BARD_INDEX] !== 255 && b.levels[BARD_INDEX] !== 255) {
      slots.push({ ...row, kind: 'slot', outcome: 'no-conflict', detail: `Slot ${i + 1}: bard-only AE DoT effect, exempt.` });
      continue;
    }
    if (ignored.has(e1)) {
      const viaClaim = ignoredByClaim.has(e1);
      slots.push({ ...row, kind: 'slot', outcome: 'ignored', viaClaim,
        detail: viaClaim
          ? `Slot ${i + 1}: ${spaName(e1)} is a focus effect, exempt from slot arbitration — see the focus stacking claim.`
          : `Slot ${i + 1}: ${spaName(e1)} is on the client's ignore list — it never causes a stacking conflict.` });
      continue;
    }
    if ((e1 === SPA.ArmorClass || e1 === SPA.ACv2) && slotOf(b, i).base1 < 0) {
      slots.push({ ...row, kind: 'slot', outcome: 'no-conflict', detail: `Slot ${i + 1}: negative AC effects are skipped.` });
      continue;
    }
    if (e1 === SPA.CompleteHeal) {
      slots.push({ ...row, kind: 'slot', outcome: 'conflict-blocked',
        detail: `Slot ${i + 1}: Complete Heal. This effect never stacks or overwrites.` });
      return done(-1, 'complete-heal', 'Complete Heal buffs never stack or overwrite — always blocked.');
    }
    if (e1 === SPA.CurrentHP && a.id !== b.id && aDet && bDet) {
      slots.push({ ...row, kind: 'slot', outcome: 'no-conflict', detail: `Slot ${i + 1}: two different DoTs stack.` });
      continue;
    }

    let v1 = calcValue(a, i, levelA), v2 = calcValue(b, i, levelB);

    if (e1 === SPA.MovementSpeed && e2 === SPA.MovementSpeed) {
      if (v1 < 0 && v2 > 0) {
        slots.push({ ...row, kind: 'slot', outcome: 'conflict-blocked', valueA: v1, valueB: v2,
          detail: `Slot ${i + 1}: ${a.name} is a snare (${v1}) and ${b.name} is a movement buff (${v2}) — the snare wins.` });
        return done(-1, 'snare', `A snare (${a.name}) is already in place, so the movement buff ${b.name} will not land.`);
      }
      if (v2 < 0 && v1 > 0) {
        slots.push({ ...row, kind: 'slot', outcome: 'no-conflict', detail: `Slot ${i + 1}: a snare lands over a run-speed buff.` });
        continue;
      }
    }
    if (a.dur_calc > 0 && b.dur_calc > 0 && e1 === SPA.CurrentHP && e2 === SPA.CurrentHP) {
      if (!aDet && bDet) {
        slots.push({ ...row, kind: 'slot', outcome: 'no-conflict', detail: `Slot ${i + 1}: a DoT does not overwrite regeneration.` });
        continue;
      }
      if (aDet && !bDet) {
        slots.push({ ...row, kind: 'slot', outcome: 'conflict-blocked',
          detail: `Slot ${i + 1}: the DoT already running blocks an incoming regeneration effect.` });
        return done(-1, 'dot-blocks-regen', `The DoT ${a.name} blocks the regeneration spell ${b.name}.`);
      }
    }
    if (e1 === SPA.AttackSpeed || e1 === SPA.AttackSpeed2) { v1 -= 100; v2 -= 100; }
    v1 = Math.abs(v1); v2 = Math.abs(v2);

    if (v2 < v1) {
      slots.push({ ...row, kind: 'slot', outcome: 'conflict-blocked', valueA: v1, valueB: v2,
        detail: `Slot ${i + 1}: both are ${spaName(e1)}. ${b.name} gives ${v2} where ${a.name} already gives ${v1} — the weaker spell is refused.` });
      return done(-1, 'weaker-slot',
        `Slot ${i + 1} is ${spaName(e1)} on both. ${b.name} gives ${v2} where ${a.name} already gives ${v1}, so the weaker spell is refused.`,
        e1);
    }

    if (v2 !== v1) valuesEqual = false;
    willOverwrite = true;
    lastConflictSpa = e1;
    slots.push({ ...row, kind: 'slot', outcome: 'conflict-b-wins', valueA: v1, valueB: v2,
      detail: `Slot ${i + 1}: both are ${spaName(e1)}. ${b.name} (${v2}) is at least as strong as ${a.name} (${v1}), so it would overwrite unless another slot objects.` });
  }

  if (willOverwrite) {
    if (valuesEqual && effectMatch && !isGroupSpell(b) && isGroupSpell(a))
      return done(-1, 'single-vs-group', `${b.name} looks like the single-target version of ${a.name} — the group version already on you wins.`);
    return done(1, 'overwrite', `${b.name} shares at least one slot with ${a.name} and is at least as strong everywhere, so it overwrites.`, lastConflictSpa);
  }
  return done(0, 'independent', `${a.name} and ${b.name} share no conflicting slot, so both hold at once.`);
}

export function sharedStackingGroups(a, b) {
  const out = [];
  for (const ga of a.stacking || [])
    for (const gb of b.stacking || [])
      if (ga.group === gb.group)
        out.push({ group: ga.group, name: ga.group_name || `Group ${ga.group}`, type: gb.type, rankA: ga.rank, rankB: gb.rank });
  return out;
}

/**
 * Slots that land but whose effect the game does not add together — it keeps the
 * larger value. Derived from EQEmu's bonus accumulation (see tools/spa_meta.json
 * for the provenance note); the wording is confirmed by the live spell text for
 * SPA 496, whose descriptions say "non-cumulative" outright.
 */
/**
 * The bonus EQEmu actually compares. Haste is stored as a percentage of normal
 * speed, so 168 is a 68% bonus and 90 is a 10% slow — comparing the stored number
 * would call a slow the bigger buff.
 */
export const ncBonus = (spa, value) => value - (NON_CUMULATIVE_OFFSET[spa] || 0);

/**
 * Which of two values the game keeps, or null where it cannot be said.
 *
 * Not "the larger". EQEmu keeps the value furthest from zero on the side of zero
 * it is already on:
 *
 *     if (v < 0 && cur > v) cur = v;        // among negatives, the most negative
 *     else if (v > 0 && cur < v) cur = v;   // among positives, the largest
 *
 * — the same shape in all seven of the damage-mod cases, and in the haste cases
 * once the 100 is taken off. The difference is not academic: SPA 505 is negative
 * in every one of its 22 slots in the current file, and SPA 3 in 1,297 of 1,515,
 * so "the larger" would name the weaker effect the winner on both.
 *
 * Opposite signs return null. Those two branches never displace each other on
 * their own terms, so which one is left standing depends on the order the server
 * happened to apply them in, and that is not something this tool can know.
 */
export function ncWinner(spa, valueA, valueB) {
  const a = ncBonus(spa, valueA), b = ncBonus(spa, valueB);
  if (a === b) return 'tie';
  if (a === 0 || b === 0) return null;
  if ((a > 0) !== (b > 0)) return null;
  return Math.abs(a) > Math.abs(b) ? 'a' : 'b';
}

export function nonCumulativeOverlap(a, b, opts = {}) {
  const levelA = opts.levelA ?? MAX_PLAYER_LEVEL, levelB = opts.levelB ?? MAX_PLAYER_LEVEL;
  const out = [];
  const lenA = a.slots?.length || 0, lenB = b.slots?.length || 0;
  for (let i = 0; i < lenA; i++) {
    const sa = slotOf(a, i);
    if (!sa || !NON_CUMULATIVE_SPA.includes(sa.spa)) continue;
    for (let j = 0; j < lenB; j++) {
      const sb = slotOf(b, j);
      if (!sb || sb.spa !== sa.spa || i === j) continue;
      const valueA = calcValue(a, i, levelA), valueB = calcValue(b, j, levelB);
      // The winner is named whatever the confidence, because it is not a second
      // claim: every non_cumulative claim already asserts which value applies, and
      // withholding it left the tool refusing to answer the question its own claim
      // had answered. What varies with the evidence is how it is said, which is the
      // view's job — `status` is passed through for it.
      const confirmed = NON_CUMULATIVE_CONFIRMED.includes(sa.spa);
      const winner = ncWinner(sa.spa, valueA, valueB);
      out.push({
        spa: sa.spa, name: spaName(sa.spa), slotA: i, slotB: j, valueA, valueB,
        confirmed, status: NON_CUMULATIVE_STATUS[sa.spa] || 'unverified', winner,
      });
    }
  }
  return out;
}

/**
 * Focus effects both spells carry. Two buffs can hold at once and still not give
 * you both benefits: when several foci could apply to one cast, only the best is
 * used. The proc-type foci are the exception — they fire independently.
 */
export function focusOverlap(a, b) {
  const spasOf = sp => new Set((sp.slots || []).filter(Boolean).map(s => s.spa).filter(s => focusSpa.has(s)));
  const inA = spasOf(a), inB = spasOf(b);
  const shared = [...inA].filter(s => inB.has(s));
  return {
    // Limiters are excluded. FOCUS_SPA is the union of Daybreak's Fc_ and Ff_
    // prefixes, so the best-only list picked up the Ff_ limiters too — and
    // "both carry Ff_LevelMax, only the best applies" is meaningless. A limiter
    // does not apply to a cast; it restricts the focus sitting beside it.
    bestOnly: shared.filter(s => focusBestOnly.has(s) && !focusLimit.has(s)).map(s => ({ spa: s, name: spaName(s) })),
    procs: shared.filter(s => FOCUS_PROC_EXCEPTIONS.includes(s)).map(s => ({ spa: s, name: spaName(s) })),
  };
}

/** Both directions, since "does it stack" has no natural order. */
export function checkBoth(x, y, opts = {}) {
  return {
    xThenY: checkStack(x, y, { levelA: opts.levelX, levelB: opts.levelY }),
    yThenX: checkStack(y, x, { levelA: opts.levelY, levelB: opts.levelX }),
    nonCumulative: nonCumulativeOverlap(x, y, { levelA: opts.levelX, levelB: opts.levelY }),
    focus: focusOverlap(x, y),
  };
}

// ---------------------------------------------------------------------------
// A whole buff set, rather than a pair.
//
// This scales without new mechanics because the game itself works pairwise: an
// incoming spell is checked against each buff already on you, one at a time. So
// a set can all be up at once exactly when every pair is mutually independent.
// There is no three-way interaction to model — analyzeSet is a loop over
// checkStack, not a new rule.
//
// What it deliberately does NOT do is score a set. Ranking buff sets by damage
// needs a model of how these values combine into a number — bonus buckets,
// additive versus non-cumulative, which focus wins — and six of the seven
// non-cumulative claims are unverified while the focus claim is corroborated
// rather than confirmed. A damage figure built on that would look far more
// authoritative than its evidence. So this answers "what am I wasting?" and
// leaves "what is best?" alone.

/** The Ff_ slots on a spell — what a focus on it is restricted to applying to. */
export function limitersOf(sp) {
  return (sp.slots || []).map((sl, i) => sl && focusLimit.has(sl.spa)
    ? { spa: sl.spa, name: spaName(sl.spa), slot: i, base1: sl.base1, base2: sl.base2 }
    : null).filter(Boolean);
}

/** Every slot on `sp` carrying `spa`, with its value at `level`. */
function carriedAt(sp, spa, level) {
  const out = [];
  const len = sp.slots?.length || 0;
  for (let i = 0; i < len; i++) {
    const sl = slotOf(sp, i);
    if (sl && sl.spa === spa) out.push({ slot: i, value: calcValue(sp, i, level) });
  }
  return out;
}

/**
 * @param {object[]} spells   the set, in no particular order
 * @param {object} [opts]
 * @param {number} [opts.level]            caster level applied to all of them
 * @param {Object<number,number>} [opts.levels]  per-spell-id override
 */
export function analyzeSet(spells, opts = {}) {
  const lvlOf = sp => opts.levels?.[sp.id] ?? opts.level ?? MAX_PLAYER_LEVEL;

  // --- which of these can be up at the same time ---------------------------
  const conflicts = [];
  const compatible = spells.map(() => new Set());
  for (let i = 0; i < spells.length; i++) {
    for (let j = i + 1; j < spells.length; j++) {
      const a = spells[i], b = spells[j];
      const levelA = lvlOf(a), levelB = lvlOf(b);
      const ab = checkStack(a, b, { levelA, levelB });
      const ba = checkStack(b, a, { levelA: levelB, levelB: levelA });
      if (ab.verdict === 'independent' && ba.verdict === 'independent') {
        compatible[i].add(j); compatible[j].add(i);
      } else {
        conflicts.push({
          i, j, a: a.id, b: b.id, aName: a.name, bName: b.name,
          aThenB: { verdict: ab.verdict, reason: ab.reason, rule: ab.rule },
          bThenA: { verdict: ba.verdict, reason: ba.reason, rule: ba.rule },
        });
      }
    }
  }
  const coexist = (idxs) => idxs.every((x, n) => idxs.slice(n + 1).every(y => compatible[x].has(y)));

  // --- effects several of them carry ---------------------------------------
  //
  // Grouped by SPA across the whole set, which is the part a pair view cannot
  // show: four buffs each carrying the same best-only focus is a fact about the
  // set, not about any pair inside it.
  const groupsFor = (predicate) => {
    const bySpa = new Map();
    spells.forEach((sp, i) => {
      const seen = new Set();
      for (const sl of sp.slots || []) {
        if (!sl || !predicate(sl.spa) || seen.has(sl.spa)) continue;
        seen.add(sl.spa);
        if (!bySpa.has(sl.spa)) bySpa.set(sl.spa, []);
        bySpa.get(sl.spa).push(i);
      }
    });
    return [...bySpa.entries()]
      .filter(([, members]) => members.length > 1)
      .sort((x, y) => y[1].length - x[1].length || x[0] - y[0]);
  };

  const nonCumulative = groupsFor(spa => NON_CUMULATIVE_SPA.includes(spa)).map(([spa, idxs]) => {
    const confirmed = NON_CUMULATIVE_CONFIRMED.includes(spa);
    const members = idxs.map(i => {
      const carried = carriedAt(spells[i], spa, lvlOf(spells[i]));
      return {
        index: i, id: spells[i].id, name: spells[i].name,
        slots: carried.map(c => c.slot),
        value: Math.max(...carried.map(c => c.value)),
      };
    });
    // Same rule as the pair view, over more than two: the bonus furthest from
    // zero applies, and only among members on the same side of zero. A set holding
    // both a haste and a slow has no single answer, so none is marked.
    const bonuses = members.map(m => ncBonus(spa, m.value));
    const mixed = bonuses.some(v => v > 0) && bonuses.some(v => v < 0);
    const best = Math.max(...bonuses.map(Math.abs));
    for (let i = 0; i < members.length; i++)
      members[i].applies = mixed || bonuses[i] === 0 ? null : Math.abs(bonuses[i]) === best;
    return {
      spa, name: spaName(spa), confirmed, status: NON_CUMULATIVE_STATUS[spa] || 'unverified',
      mixed, members, coexist: coexist(idxs),
    };
  });

  const focusShared = (list) => groupsFor(spa => list.includes(spa)).map(([spa, idxs]) => ({
    spa, name: spaName(spa), coexist: coexist(idxs),
    members: idxs.map(i => ({
      index: i, id: spells[i].id, name: spells[i].name,
      value: Math.max(...carriedAt(spells[i], spa, lvlOf(spells[i])).map(c => c.value)),
      // Two foci of the same type only compete where their limiters overlap. We
      // do not try to decide that — we show them, because deciding it needs the
      // per-cast context the tool does not have.
      limiters: limitersOf(spells[i]),
    })),
  }));

  return {
    count: spells.length,
    conflicts,
    // The set holds as-is only if nothing in it fights anything else.
    allHold: conflicts.length === 0,
    nonCumulative,
    focusBestOnly: focusShared(FOCUS_BEST_ONLY.filter(spa => !focusLimit.has(spa))),
    // The exception worth stating positively: these all fire.
    focusProcs: focusShared(FOCUS_PROC_EXCEPTIONS),
  };
}
