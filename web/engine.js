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
  SPA_NAMES, IGNORED_IN_STACKING, NON_CUMULATIVE_SPA,
  FOCUS_SPA, FOCUS_BEST_ONLY, FOCUS_PROC_EXCEPTIONS, FOCUS_CONTESTED,
} from './spa.js';

export const SPA = {
  CurrentHP: 0, ArmorClass: 1, ATK: 2, MovementSpeed: 3, CHA: 10, AttackSpeed: 11,
  CompleteHeal: 101, Screech: 123, StackingBlock: 148, StackingOverwrite: 149,
  ManaBurn: 350, BardAEDot: 334, ImprovedTaunt: 444, AttackSpeed2: 98, ACv2: 416,
  Blank: 254,
};

const SPELL_EYE_OF_ZOMM = 331;
const SPELL_MANA_BURN   = 2751;
const EFFECT_COUNT      = 12;

const ST_GROUP_TELEPORT = 0x03, ST_AE_BARD = 0x28, ST_GROUP = 0x29;
const BARD_INDEX = 7;

const ignored = new Set(IGNORED_IN_STACKING);
const focusSpa = new Set(FOCUS_SPA);
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
export function calcValue(sp, i, level, ticsRemaining = 0) {
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

export function calcDuration(calc, cap, level = 125) {
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
  const levelA = opts.levelA ?? 125;
  const levelB = opts.levelB ?? 125;
  const slots = [];
  const caveats = [];
  const done = (code, rule, reason, decidedBy = null) => ({
    verdict: code === 1 ? 'overwrite' : code === -1 ? 'blocked' : 'independent',
    code, rule, reason, slots, caveats, decidedBy,
    // A verdict resting on a focus SPA that the client-derived ignore list omits.
    // Focus effects are widely reported to stack regardless of slot, so this answer
    // may be wrong — see the focus_stacking claim in claims.json.
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
    for (let i = 0; i < EFFECT_COUNT; i++) {
      if (spaOf(a, i) !== spaOf(b, i) || spaOf(a, i) === SPA.ManaBurn) { effectMatch = false; break; }
    }
  } else if (hasEffect(a, SPA.ManaBurn)) {
    return done(-1, 'mana-burn', 'Mana Burn spells never stack with themselves.');
  }

  // --- SPA 148 (block) / SPA 149 (overwrite) commands ----------------------
  if (!effectMatch) {
    for (let i = 0; i < EFFECT_COUNT; i++) {
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

  for (let i = 0; i < EFFECT_COUNT; i++) {
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
      slots.push({ ...row, kind: 'slot', outcome: 'ignored',
        detail: `Slot ${i + 1}: ${spaName(e1)} is on the client's ignore list — it never causes a stacking conflict.` });
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
export function nonCumulativeOverlap(a, b) {
  const out = [];
  for (let i = 0; i < EFFECT_COUNT; i++) {
    const sa = slotOf(a, i);
    if (!sa || !NON_CUMULATIVE_SPA.includes(sa.spa)) continue;
    for (let j = 0; j < EFFECT_COUNT; j++) {
      const sb = slotOf(b, j);
      if (sb && sb.spa === sa.spa && i !== j) out.push({ spa: sa.spa, name: spaName(sa.spa), slotA: i, slotB: j });
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
    bestOnly: shared.filter(s => focusBestOnly.has(s)).map(s => ({ spa: s, name: spaName(s) })),
    procs: shared.filter(s => FOCUS_PROC_EXCEPTIONS.includes(s)).map(s => ({ spa: s, name: spaName(s) })),
  };
}

/** Both directions, since "does it stack" has no natural order. */
export function checkBoth(x, y, opts = {}) {
  return {
    xThenY: checkStack(x, y, { levelA: opts.levelX, levelB: opts.levelY }),
    yThenX: checkStack(y, x, { levelA: opts.levelY, levelB: opts.levelX }),
    nonCumulative: nonCumulativeOverlap(x, y),
    focus: focusOverlap(x, y),
  };
}
