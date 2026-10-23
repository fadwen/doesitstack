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
  // The resource taps (178, 457) say which pool the damage comes back as in base2.
  const resource = () => ['HP', 'Mana', 'Endurance'][base2 % 3];
  // Several control effects cap at a target level held in max — eqspellparser's
  // `absmax`.
  const absmax = max > 0 ? ` up to level ${max}` : '';

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
    // Stored in tenths of a percent, like the SPA 178 return and the 457 tap.
    case 182: return pct('Weapon Delay', value / 10);
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
    // Spelled out because these are the effects this whole tool turns on. The
    // slot being checked is in base2; `calc % 100` is where files before May
    // 2018 kept it, and eqspellparser still falls back to it. Every one of the
    // 2,142 command slots in the current file has it in base2.
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
    // Count in base2 since January 2019; eqspellparser's calc line is for older files.
    case 32:  return `Summon: [Item ${base1}] x ${base2}`;
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
    // "Lifetap from Weapon Damage" is the line eqspellparser keeps for spell files
    // older than August 2016. Since then the file stores tenths of a percent and
    // says which resource comes back; this is the melee twin of SPA 457.
    case 178: return `Return ${num(base1 / 10)}% of Melee Damage as ${resource()}`
              + (max > 0 ? `, Max Per Hit: ${max}` : '');
    case 197: return pct(`${skill()} Damage Taken`, value);
    case 289: return `Cast: [Spell ${base1}] on Duration Fade`;
    case 296: return pct('Spell Damage Taken', base1) + ' (Before Crit)';
    case 297: return up('Spell Damage Taken', base1) + ' (Before Crit)';
    case 320: return pct('Shield Block Chance', base1);
    case 350: return `Mana Burn up to ${base1 * -base2 / 10} Damage`;
    case 369: return up('Corruption Counter', value);
    // Stored as the slow amount, positive, so the sign is flipped to read it. The
    // marker is not decoration: a negative SPA 11 is also "Decrease Melee Haste by
    // 30%", and these are two different mechanisms that combine differently.
    // EQEmu notes a few spells store this negative and reads those as slows too;
    // none in the current file does, so the source's line is kept as it is.
    case 371: return pct('Melee Haste', -value) + ' (v371, Incremental)';
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
    // Hundredths of a percent since September 2019, with the mana-per-HP ratio in
    // ten-thousandths. A deliberate divergence in two small places: eqspellparser
    // divides base2 by 10000 as integers, so every ratio under 1.0 prints as 0.00
    // (the file's 4000 means 0.40), and it omits the space before the bracket.
    case 329: return `Absorb Damage using Mana: ${Math.trunc(base1 / 100)}%`
              + (base2 !== 10000 ? ` (${(base2 / 10000).toFixed(2)} Mana per 1 HP)` : '')
              + (max > 0 ? `, Max Per Hit: ${max}` : '');
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

    // --- down the worklist, every effect on 40 slots or more --------------
    // In the order `node tools/phrasing_todo.mjs` lists them. Lines that end in a
    // tick count or a level range in the source ("per tick", CalcValueRange) drop
    // that part here, as 0, 15 and 92 already do: it needs the spell's duration.
    case 433: return up(`${skill()} Damage Bonus`, base1) + ' (v433, Delay Mod)';
    case 457: return `Return ${num(base1 / 10)}% of Spell Damage as ${resource()}`
              + (max > 0 ? `, Max Per Hit: ${max}` : '');
    case 22:  return 'Charm' + absmax + (base2 > 0 ? ` with ${base2}% Chance of Memory Blur` : '');
    case 192: return up('Hate', value);
    // The stored figure is on top of a flat 40, and the roll is capped at 100.
    case 63:  return `Memory Blur (${Math.min(value + 40, 100)}% Chance)`;
    case 99:  return 'Root';
    case 109: return `Summon into Bag: [Item ${base1}] x ${base2}`;
    case 446: return `Buff Blocker A (${base1})`;
    case 447: return `Buff Blocker B (${base1})`;
    case 449: return `Buff Blocker D (${base1})`;
    case 380: return `Push Back ${base2}' and Up ${base1}'`;
    case 86:  return `Decrease Social Radius to ${value}` + absmax;
    case 455: return pct('Current Hate', base1);
    case 333: return `Cast: [Spell ${base1}] on Rune Fade`;
    case 358: return up('Current Mana', value) + ' (v358)';
    case 23:  return 'Fear' + absmax;
    case 44:  return `Stacking: Delayed Heal Marker (${value})`;
    case 451: return `Absorb Melee Damage: ${base1}% over ${base2}` + (max > 0 ? `, Total: ${max}` : '');
    case 452: return `Absorb Spell Damage: ${base1}% over ${base2}` + (max > 0 ? `, Total: ${max}` : '');
    case 442: return `Cast: [Spell ${base1}] once if ${fromEnum(SpellTargetRestrict, base2)}`;
    case 74:  return 'Feign Death' + (value < 100 ? ` (${value}% Chance)` : '');
    case 154: return (base2 !== 0 ? 'Decrease Detrimental Duration by 50%' : 'Dispel Detrimental')
              + ` (${Math.trunc(base1 / 10)}% Chance)` + absmax;
    case 287: return `Increase Duration by ${base1 * 6}s (v287)`;
    case 40:  return 'Invulnerability';
    case 123: return 'Screech';
    case 198: return up('Current Endurance', value);
    case 450: return `Absorb DoT Damage: ${base1}%`
              + (base2 > 0 ? `, Max Per Hit: ${base2}` : '') + (max > 0 ? `, Total: ${max}` : '');
    case 168: return pct('Melee Mitigation', -value);
    case 330: return pct(`Critical ${skill()} Damage`, base1) + ' of Base Damage';
    // A negative base1 packs a colour; anything else is an effect the source does
    // not decode, and it prints the fields.
    case 431: return base1 < 0
              ? `Tint Vision: Red=${base1 >> 16 & 0xff} Green=${base1 >> 8 & 0xff} Blue=${base1 & 0xff}`
              : `Alter Vision: Base1=${base1} Base2=${base2} Max=${max}`;
    case 430: return `Alter Vision: Base1=${base1} Base2=${base2} Max=${max}`;
    case 112: return up('Effective Casting Level', value);
    case 274: return pct('Chance to Critical Heal', base1) + absmax
              + (max > 0 ? ` (lose ${base2 === 0 ? 100 : base2}% per level)` : '');
    case 481: return `Cast: [Spell ${base2}] if Hit By Spell` + (base1 < 100 ? ` (${base1}% Chance)` : '');
    case 343: return 'Interrupt Casting' + (base1 < 100 ? ` (${base1}% Chance)` : '');
    case 335: return 'Block Next Spell' + (base1 < 100 ? ` (${base1}% Chance)` : '');
    case 280: return pct('Pet Chance to Flurry', value);
    case 370: return up('Corruption Resist', value);
    case 157: return up('Spell Damage Shield', -value);
    case 120: return pct('Healing Taken', base1) + ' (v120, Before Crit)';
    case 444: return 'Lock Aggro on Caster and ' + pct('Other Aggro', base2 - 100) + ` up to level ${base1}`;
    case 467: return up('Damage Shield Taken', base1);
    case 78:  return `Absorb Spell Damage: 100%, Total: ${value}`;
    case 401: return `Decrease Current HP by up to ${Math.abs(Math.floor(base1 * base2 / 10))}`
              + ` (${num(Math.abs(base2 / 10))} HP per 1 Target Mana)`;
    case 400: return `Increase Current HP by up to ${Math.abs(Math.floor(base1 * base2 / 10))}`
              + ` (${num(Math.abs(base2 / 10))} HP per 1 Mana)`;
    case 368: return up(`Faction with [Faction ${base1}]`, base2);
    case 453: return `Cast: [Spell ${base1}] if ${base2} Melee Damage Taken in Single Hit`;
    case 466: return pct('Pet Chance to Flurry on Double Attack', base1);
    case 408: return 'Cap HP at ' + (base2 > 0 ? `lowest of ${base1}% or ${base2}` : `${base1}%`);
    case 409: return 'Cap Mana at ' + (base2 > 0 ? `lowest of ${base1}% or ${base2}` : `${base1}%`);
    case 410: return 'Cap Endurance at ' + (base2 > 0 ? `lowest of ${base1}% or ${base2}` : `${base1}%`);
    case 212: return pct('Chance to Critical DD', base1) + ' and ' + pct('Spell Mana Cost', base2);
    case 305: return up('Offhand Damage Shield Taken', base1) + (max === 0 ? '%' : '');
    case 386: return `Cast: [Spell ${base1}] on Curer`;
    case 387: return `Cast: [Spell ${base1}] if Cured`;
    case 160: return `Intoxicate if Tolerance under ${base1}`;
    case 469: return `Cast: Highest Rank of [Group ${base2}]` + (base1 < 100 ? ` (${base1}% Chance)` : '') + ' (v469)';
    case 524: return pct('Current HP', base1) + ` up to ${max}`;
    case 259: return pct('AC Soft Cap', base1);
    case 24:  return up('Stamina Loss', value);
    // The reduction is carried in calc, of all places; the source reads it there too.
    case 122: return pct(`${fromEnum(SpellSkill, base1)} Skill`, -slot.calc);
    case 42:  return 'Shadowstep';
    case 510: return up('Incoming Resist Modifier', base1);
    case 464: return pct('Pet Chance to Rampage', base1) + ` with ${base2}% Damage`;
    case 367: return `Transform Body Type to ${fromEnum(SpellBodyType, base1)}`;
    case 460: return 'Limit Type: Include Non-Focusable';
    case 14:  return 'Enduring Breath';
    case 441: return `Cancel if Moved ${base1}'`;
    case 384: return 'Fling to Target';
    case 266: return pct(`Chance of ${base2} Additional 2H Attacks`, base1);
    case 250: return pct('Melee Proc Rate', base1);
    case 357: return 'Inhibit Spell Casting';
    case 478: return `Move to Bottom of Rampage List (${base1}% Chance)`;
    case 393: return pctRange('Healing Taken', base1, base2) + ' (v393)';
    case 365: return `Cast: [Spell ${base2}] on Killshot (${base1}% Chance)`;
    case 105: return 'Inhibit Gate';
    case 513: return pct('Max Mana', base1 / 100);
    case 514: return pct('Max Endurance', base1 / 100);
    case 328: return up('Max Negative HP', value);
    case 243: return pct('Chance of Charm Breaking', -base1);
    // These read the spell's Extra field — a zone, a pet or a doppelganger name —
    // which is not in the slot. Kept null for the same reason as 145 and 179.
    case 83:  return null;
    case 33:  return null;
    case 104: return null;
    case 300: return null;
    case 71:  return null;
    case 306: return null;
    case 88:  return null;
    case 146: return null;   // Portal Locations: eqspellparser itself returns null

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
