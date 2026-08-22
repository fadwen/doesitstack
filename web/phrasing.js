// A second way to read a spell slot: phrased rather than named.
//
// The default view shows what the file says — Daybreak's SPA name and the raw
// base/max values. That is exact and it is what a claim or a bug report should
// quote. It is also close to unreadable if you do not already know the SPAs:
// "Ff_ResistType · SPA 135 · base 2" against "Limit Resist: Fire".
//
// The phrasing here is ported from rumstil/eqspellparser core/SpellData.cs,
// Copyright 2015 Rumstil, Apache License 2.0 — see LICENSE-eqspellparser.txt.
// MODIFIED from the original: rewritten from C# to JavaScript, reduced to the
// effects that actually appear in the spell file, and SPA names resolve through
// Daybreak's published list rather than eqspellparser's own enum, so the two
// views never disagree about what an effect is called.
//
// Ported means ported. Some of these lines were originally written here from the
// SPA name alone, which is guessing, and several of those guesses were wrong —
// SPA 147 said "Heal to -25% of Max HP" for an effect that takes a quarter of
// your health. `node tools/phrasing_audit.mjs --eqsp <checkout>` lists every line
// that no longer matches the source; a divergence is allowed, but it has to be
// deliberate and it has to say why, like the SPA 10 note below.
//
// This is a third-party reading, like the target-type labels. It is a
// convenience, not a source — which is why the exact view is the default and
// this one has to be asked for.

import { SpellResist, SpellTarget, SpellTargetRestrict, SpellSkill, SpellClasses, SpellBodyType, fromEnum, limit } from './enums.js';

const num = (n) => Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
const up = (name, v) => `${v < 0 ? 'Decrease' : 'Increase'} ${name} by ${num(Math.abs(v))}`;
const pct = (name, v) => `${v < 0 ? 'Decrease' : 'Increase'} ${name} by ${num(Math.abs(v))}%`;
// Several effects carry a floor in base1 and a ceiling in base2. A negative pair
// is stored the other way round, and a positive pair with min > max is bad data
// the source ignores rather than prints backwards. Ported from FormatPercentRange.
const pctRange = (name, min, max) => {
  if (min < 0) { if (min < max) [min, max] = [max, min]; }
  else if (min > max) max = min;
  const dir = max < 0 ? 'Decrease' : 'Increase';
  return min === max ? `${dir} ${name} by ${num(Math.abs(min))}%`
    : `${dir} ${name} by ${num(Math.abs(min))}% to ${num(Math.abs(max))}%`;
};

function time(seconds) {
  if (seconds < 120) return `${num(seconds)}s`;
  if (seconds < 7200) return `${num(Math.round(seconds / 6) / 10)}m`;
  return `${num(Math.round(seconds / 360) / 10)}h`;
}

/**
 * @param {object} slot   {spa, base1, base2, calc, max}
 * @param {number} value  the level-scaled value the engine computed
 * @param {object} names  meta.spa_names — Daybreak's naming, for effects that
 *                        reference another effect by number
 * @returns {string|null} null where nothing has been ported, so the caller can
 *                        fall back honestly rather than invent a phrasing
 */
export function phrase(slot, value, names = {}) {
  const { spa, base1, base2, max } = slot;
  const skill = () => fromEnum(SpellSkill, base2);
  const effectName = (n) => names[Math.abs(n)] || `SPA ${Math.abs(n)}`;

  switch (spa) {
    // --- the common stat and resource effects ---------------------------
    case 0:   return up('Current HP', value);
    case 1:   return up('AC', value);
    case 2:   return up('ATK', value);
    case 3:   return pct('Movement Speed', value);
    case 4:   return up('STR', value);
    case 5:   return up('DEX', value);
    case 6:   return up('AGI', value);
    case 7:   return up('STA', value);
    case 8:   return up('INT', value);
    case 9:   return up('WIS', value);
    // 90,913 of the 91,257 SPA 10 slots carry base 0 and are padding, but the
    // remaining 344 are real charisma effects — Charisma +40, Glamour, and
    // debuffs like Skunk Spray at -30 — so only base 0 is treated as blank.
    // A deliberate divergence from eqspellparser, which suppresses base1 <= 1
    // and so hides every CHA debuff along with the padding.
    case 10:  return base1 === 0 ? null : up('CHA', value);
    case 11:  return pct('Melee Haste', value - 100);
    case 15:  return up('Current Mana', value);
    case 55:  return `Absorb Damage: 100%, Total: ${num(value)}`;
    case 58:  return 'Illusion';
    case 59:  return up('Damage Shield', -value);
    case 69:  return up('Max HP', value);
    case 79:  return up('Current HP', value);
    case 92:  return up('Hate', value);
    case 97:  return up('Max Mana', value);
    case 100: return up('Current HP', value);
    case 111: return up('All Resists', value);
    case 114: return pct('Hate Generated', value);
    case 116: return up('Curse Counter', value);
    case 35:  return up('Disease Counter', value);
    case 36:  return up('Poison Counter', value);
    // Under a second it does not stun, it only interrupts — saying "Stun for 0.5s"
    // reads as a stun that is merely short, which is a different thing.
    case 21:  return base1 < 1000 ? 'Interrupt Casting'
              : `Stun for ${time(base1 / 1000)}` + (base2 && base2 !== base1 ? ` (${time(base2 / 1000)} in PvP)` : '');
    case 162: return `Absorb Melee Damage: ${base1}%`
              + (base2 > 0 ? `, Max Per Hit: ${base2}` : '') + (max > 0 ? `, Total: ${max}` : '');
    case 163: return `Absorb ${base1} Hits or Spells` + (max > 0 ? `, Max Per Hit: ${max}` : '');
    case 189: return up('Current Endurance', value);
    case 190: return up('Max Endurance', value);
    case 191: return 'Inhibit Combat';
    case 209: return `Dispel Beneficial (${value})`;
    case 214: return pct('Max HP', value / 100);
    case 232: return pct('Chance to Trigger Divine Intervention', base1);
    case 262: return up(fromEnum(SpellSkill, base2) + ' Cap', value);
    case 360: return `Add Killshot Proc: [Spell ${base2}] (${base1}% Chance)`;
    case 374: return `Cast: [Spell ${base2}]` + (base1 < 100 ? ` (${base1}% Chance)` : '');
    case 340: return `Cast: [Spell ${base2}]` + (base1 < 100 ? ` (${base1}% Chance)` : '');
    case 470: return `Cast: Best in [Group ${base2}]`;

    // --- melee ----------------------------------------------------------
    case 85:  return `Add Proc: [Spell ${base1}]` + (base2 ? ` with ${base2}% Rate Mod` : '');
    case 169: return pct('Critical Hit Chance', value);
    case 171: return pct('Chance to Crippling Blow', value);
    case 176: return pct('Dual Wield Chance', value);
    case 177: return pct('Double Attack Chance', value);
    case 182: return pct('Weapon Delay', -value);
    case 184: return pct(`Chance to Hit with ${skill()}`, value);
    case 193: return `${skill()} Attack for ${base1}`;
    case 185: return pct(`${skill()} Damage`, base1);
    case 186: return pct(`Min ${skill()} Damage`, value);
    case 220: return up(`${skill()} Damage Bonus`, base1);
    case 279: return pct('Flurry Chance', value);
    case 364: return pct('Triple Attack Chance', value);
    case 428: return `Limit Skill: ${fromEnum(SpellSkill, base1)}`;
    case 459: return pct(`${skill()} Damage`, base1);
    case 482: return pct(`Base ${skill()} Damage`, value);
    case 496: return pct(`Critical ${skill()} Damage`, base1) + ' of Base Damage (Non Stacking)';

    // --- focus effects ---------------------------------------------------
    case 124: return pct('Spell Damage', base1);
    case 125: return pct('Healing', base1);
    case 126: return pct('Spell Resist Rate', -base1);
    case 127: return pct('Spell Haste', base1);
    case 128: return pct('Spell Duration', base1);
    case 129: return pct('Spell Range', base1);
    case 130: return pct('Spell Hate', base1);
    case 132: return pct('Spell Mana Cost', base1);
    case 286: return up('Spell Damage', base1);
    case 302: return pct('Critical Spell Damage', base1);
    case 303: return up('Critical Spell Damage', base1);
    case 310: return `Reduce Timer by ${time(base1 / 1000)}`;
    case 399: return pct('Chance to Twincast', base1);
    case 413: return pct('Base Spell Effectiveness', value);

    // --- focus limiters ---------------------------------------------------
    // The ones this tool shows most, and the ones the exact view reads worst.
    case 134: return `Limit Max Level: ${base1}` + (base2 > 0 ? ` (lose ${base2}% per level)` : '');
    case 135: return `Limit Resist: ${limit(SpellResist, base1)}`;
    case 136: return `Limit Target: ${limit(SpellTarget, base1)}`;
    case 137: return `Limit Effect: ${base1 < 0 ? 'Exclude ' : ''}${effectName(base1)}`;
    case 138: return `Limit Type: ${base1 === 0 ? 'Detrimental' : 'Beneficial'}`;
    case 139: return `Limit Spell: ${base1 < 0 ? 'Exclude ' : ''}[Spell ${Math.abs(base1)}]`;
    case 140: return `Limit Min Duration: ${time(base1 * 6)}`;
    case 141: return `Limit Type: ${base1 === 0 ? 'Exclude Procs' : 'Instant Spells Only'}`;
    case 142: return `Limit Min Level: ${base1}`;
    case 143: return `Limit Min Cast Time: ${time(base1 / 1000)}`;
    case 144: return `Limit Max Cast Time: ${time(base1 / 1000)}`;
    case 311: return `Limit Type: ${base1 === 1 ? 'Include' : 'Exclude'} Combat Skills`;
    case 348: return `Limit Min Mana Cost: ${base1}`;
    case 385: return `Limit Spells: ${base1 < 0 ? 'Exclude ' : ''}[Group ${Math.abs(base1)}]`;
    case 391: return `Limit Max Mana Cost: ${base1}`;
    case 403: return `Limit Spell Class: ${base1}`;
    case 404: return `Limit Spell Subclass: ${base1}`;
    case 411: return `Limit Class: ${fromEnum(SpellClasses, base1)}`;
    case 412: return `Limit Race: ${base1}`;
    case 414: return `Limit Casting Skill: ${fromEnum(SpellSkill, base1)}`;
    case 415: return `Limit Item Class: ${base1}`;
    case 422: return `Limit Min Use: ${base1}`;
    case 423: return `Limit Use Type: ${base1}`;
    case 479: return `Limit Min Value: ${base1} of ${effectName(base2)}`;
    case 480: return `Limit Max Value: ${base1} of ${effectName(base2)}`;
    case 485: return `Limit Caster Class: ${fromEnum(SpellClasses, base1)}`;
    case 486: return `Limit Caster: ${base1 === 0 ? 'Exclude Self' : 'Self Only'}`;
    case 490: return `Limit Min Recast: ${time(base1 / 1000)}`;
    case 491: return `Limit Max Recast: ${time(base1 / 1000)}`;
    case 495: return `Limit Max Duration: ${time(base1 * 6)}`;
    case 511: return `Limit Min Focus Timer: ${time(base1 / 1000)}`;

    // --- stacking -----------------------------------------------------------
    // Spelled out because these are the effects this whole tool turns on.
    case 148: return `Block new spell if slot ${base2 > 0 ? base2 : slot.calc % 100} is `
                   + `'${effectName(base1)}' and < ${max}`;
    case 149: return `Overwrite existing spell if slot ${base2 > 0 ? base2 : slot.calc % 100} is `
                   + `'${effectName(base1)}' and < ${max}`;

    // --- targeting / misc ---------------------------------------------------
    case 12:  return 'Invisibility';
    case 13:  return 'See Invisible';
    case 20:  return `Blind`;
    case 27:  return `Dispel Magic (${value})`;
    case 31:  return `Mesmerize`;
    case 32:  return `Summon Item: [Item ${base1}]`;
    case 57:  return 'Levitate';
    case 64:  return `Spin Stun for ${time(base1 / 1000)}`;
    case 65:  return 'Infravision';
    case 66:  return 'Ultravision';
    case 87:  return pct('Magnification', value);
    case 89:  return pct('Player Size', value - 100);
    case 91:  return `Summon Corpse (up to level ${base1})`;
    // Named for the pair rather than for the player's word: 96 inhibits casting,
    // 191 inhibits melee. Calling one of them "Silence" hid that they are a pair.
    case 96:  return 'Inhibit Spell Casting';
    // A deliberate divergence: eqspellparser prints the historical figure,
    // "Increase Current HP by 7500". The effect is the Donal's BP complete heal
    // and the number is not in the slot, so naming the effect beats quoting it.
    case 101: return 'Complete Heal (with duration)';
    case 108: return `Summon Familiar: [Spell ${base1}]`;
    case 113: return `Summon Mount: [Spell ${base1}]`;
    case 147: return pct('Current HP', value) + ` up to ${max}`;
    case 153: return `Balance Group HP with ${value}% Penalty`;
    case 158: return pct('Chance to Reflect Spell', base1);
    case 159: return up('All Stats', value);
    case 167: return `Add Pet Proc: [Spell ${base1}]`;
    // 179 is Instrument Modifier and 145 is Teleport; both read a field that
    // belongs to the spell, not the slot, and this function only sees the slot.
    // Better to say nothing and wear the "as-is" badge than to say the wrong thing.
    case 179: return null;
    case 194: return 'Fade (Drop Aggro)';
    case 199: return `Taunt`;
    case 201: return `Add Ranged Proc: [Spell ${base1}]`;
    case 273: return pct('Critical DoT Chance', value);
    case 294: return pct('Critical Spell Chance', base1);
    case 323: return `Add Defensive Proc: [Spell ${base1}]`;
    case 339: return `Cast: [Spell ${base2}] on Spell Use` + (base1 < 100 ? ` (${base1}% Chance)` : '');
    case 351: return `Aura`;
    case 383: return `Cast: [Spell ${base2}] on Spell Use (Base1=${base1})`;
    case 406: return `Cast: [Spell ${base1}] on Max Hits`;
    case 419: return `Add Proc: [Spell ${base1}]` + (base2 ? ` with ${base2}% Rate Mod` : '');
    case 424: return `Gradual ${base1 > 0 ? 'Push' : 'Pull'} to ${base2}' away (Force=${Math.abs(base1)})`;
    case 425: return 'Fly';
    case 427: return `Cast: [Spell ${base1}] on Skill Use (${base2})`;
    case 429: return `Add Skill Proc on Success: [Spell ${base1}]`;
    case 475: return `Cast: [Spell ${base1}] (Non-Item)`;

    // --- the next tier by frequency ---------------------------------------
    case 39:  return 'Limit: No Twincast';
    case 46:  return up('Fire Resist', value);
    case 47:  return up('Cold Resist', value);
    case 48:  return up('Poison Resist', value);
    case 49:  return up('Disease Resist', value);
    case 50:  return up('Magic Resist', value);
    case 145: return null;
    case 152: return `Summon Pet x${base1} for ${time(max)}`;
    case 161: return `Absorb Spell Damage: ${base1}%`
                   + (base2 > 0 ? `, Max Per Hit: ${base2}` : '') + (max > 0 ? `, Total: ${max}` : '');
    case 178: return `Lifetap from Weapon Damage: ${base1}%`;
    case 197: return pct(`${skill()} Damage Taken`, value);
    case 289: return `Cast: [Spell ${base1}] on Duration Fade`;
    case 296: return pct('Spell Damage Taken', base1) + ' (Before Crit)';
    case 297: return up('Spell Damage Taken', base1) + ' (Before Crit)';
    case 320: return pct('Shield Block Chance', base1);
    case 350: return `Mana Burn up to ${base1 * -base2 / 10} Damage`;
    case 369: return up('Corruption Counter', value);
    case 373: return `Cast: [Spell ${base1}] on Fade`;
    case 382: return `Inhibit Effect: ${effectName(base2)}`;
    case 416: return up('AC', value) + ', Based on Class';
    case 417: return up('Current Mana', value);
    case 418: return up(`${skill()} Damage Bonus`, base1);
    case 461: return pct('Critical Spell Damage', base1);
    case 462: return up('Spell Damage', base1);
    case 483: return pct('Spell Damage Taken', base1) + ' (After Crit)';
    case 484: return up('Spell Damage Taken', base1) + ' (After Crit)';
    case 497: return 'Limit: Focus Proc Cannot Be Bypassed';
    case 507: return pctRange('Spell Damage', base1 / 10, base2 / 10)
              + ' (v507, Before DoT Crit, After DD Crit)';
    case 508: return up('Spell Effectiveness', base1);

    // --- and a further pass over what remained -----------------------------
    case 98:  return pct('Melee Haste', value - 100);
    case 118: return pct('Singing Amplification', value * 10);
    case 119: return pct('Melee Haste', value);
    case 121: return up('Reverse Damage Shield', -value);
    case 170: return pct('Critical DD Damage', base1) + ' of Base Damage';
    case 172: return pct('Chance to Avoid Melee', base1);
    case 173: return pct('Chance to Riposte', value);
    case 174: return pct('Chance to Dodge', value);
    case 175: return pct('Chance to Parry', value);
    case 180: return pct('Chance to Resist Spell', value);
    case 188: return pct('Chance to Block', value);
    case 200: return pct('Worn Proc Rate', base1);
    case 215: return pct('Pet Chance to Avoid Melee', base1);
    case 216: return up(`${skill()} Accuracy`, value);
    case 225: return pct('Chance to Double Attack', base1) + ' (Additive)';
    case 258: return pct('Chance to Triple Backstab', value);
    case 291: return `Purify (${value})`;
    case 293: return pct('Chance to Resist Melee Stun', base1);
    case 301: return pct('Archery Damage', base1);
    case 304: return pct('Chance to Avoid Offhand Riposte', -base1);
    case 314: return 'Invisibility' + (base1 > 1 ? ` (Enhanced ${base1})` : '');
    case 317: return up('HP Regen Cap', base1);
    case 318: return up('Mana Regen Cap', base1);
    case 324: return `Cast from HP with ${value}% Penalty`;
    case 329: return `Absorb Damage using Mana: ${base1}%`;
    case 341: return up('ATK Cap', base1);
    case 347: return pct('Chance of Double Archery Attack', base1);
    case 375: return pct('Critical DoT Damage', base1) + ' of Base Damage';
    case 389: return 'Reset Recast Timers';
    case 390: return 'Lockout Recast Timers';
    case 392: return up('Healing', base1) + ' (After Crit)';
    case 394: return up('Healing Taken', base1) + ' (Before Crit)';
    case 396: return up('Healing', base1) + ' (Before Crit)';
    case 398: return `Increase Pet Duration by ${time(base1 / 1000)}`;
    case 405: return pct('Staff Block Chance', base1);
    case 421: return up('Max Hits Counter', base1);
    case 471: return pct('Chance of Double Melee Round', base1);
    case 494: return up('Pet ATK', base1);
    case 498: return pct('Chance of Extra 1H Primary Attack', base1);
    case 499: return pct('Chance of Extra 1H Secondary Attack', base1);
    case 500: return pct('Spell Haste', base1);
    case 501: return `${base1 < 0 ? 'Increase' : 'Decrease'} Casting Times by `
              + `${num(Math.abs(base1 / 1000))}s`;
    case 512: return up('Proc Timer', base1);
    case 519: return up('Luck', base1);
    case 520: return pct('Luck', base1);

    default:  return null;   // not ported — say so rather than guess
  }
}

/** Which SPAs have a phrasing, for the coverage figure the build reports. */
export const PHRASED = (() => {
  const out = new Set();
  const probe = { base1: 1, base2: 1, calc: 100, max: 1 };
  for (let spa = 0; spa <= 600; spa++)
    if (phrase({ ...probe, spa }, 1, {}) !== null) out.add(spa);
  return out;
})();
