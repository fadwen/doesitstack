// Parse the EverQuest client's spell data files.
//
//   spells_us.txt                      main spell table, caret-delimited, 166 fields (2025+ layout)
//   spells_us_str.txt                  cast / land / fade messages
//   dbstr_us.txt                       descriptions (type 6), categories (5), stacking group names (40)
//   Resources/SpellStackingGroups.txt  spell -> stacking group / rank / type
//
// Field layout follows rumstil/eqspellparser (SpellParserCurrent.cs).

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const CLASSES = ['WAR','CLR','PAL','RNG','SHD','DRU','MNK','BRD','ROG','SHM','NEC','WIZ','MAG','ENC','BST','BER'];

const F = {
  ID: 0, NAME: 1, EXTRA: 3, RANGE: 4, AERANGE: 5, CAST_MS: 8, RECOVERY_MS: 9, RECAST_MS: 10,
  DUR_CALC: 11, DUR_CAP: 12, AEDURATION: 13, MANA: 14, BENEFICIAL: 28, RESIST: 29, TARGET: 30,
  SKILL: 32, ZONETYPE: 33, LEVELS: 36, CANCEL_ON_SIT: 56, ICON: 75, RESIST_MOD: 78,
  UNSTACKABLE_DOT: 79, RECOURSE: 81, SONG_WINDOW: 84, DESC_ID: 85, CAT: 86, HATE_MOD: 92,
  ENDURANCE: 96, TIMER: 97, IS_SKILL: 98, HATE_OVERRIDE: 99, MAX_HITS_TYPE: 101, MAX_HITS: 102,
  MGB: 110, NO_DISPEL: 111, NOT_FOCUSABLE: 122, DURATION_FROZEN: 125, STACKS_WITH_SELF: 128,
  NO_BUFF_BLOCK: 130, SPELL_GROUP: 132, SPELL_GROUP_RANK: 133, CRIT_OVERRIDE: 141,
  MAX_TARGETS: 142, PERSIST_AFTER_DEATH: 148, NO_REMOVE: 156, SPELL_SUBGROUP: 160, NO_OVERWRITE: 161,
};

// EQEmu SpellTargetType
export const ST_GROUP_TELEPORT = 0x03, ST_AE_BARD = 0x28, ST_GROUP = 0x29;

export const TARGET_NAMES = {
  0:'Target AE',1:'Single',2:'Self',3:'Group Teleport',4:'AE PC v1',5:'Single',6:'Self',8:'Targeted AE',
  9:'Animal',10:'Undead',11:'Summoned',13:'Life Tap',14:'Pet',15:'Corpse',16:'Plant',17:'Giant',18:'Dragon',
  20:'Targeted AE Tap',24:'Undead AE',25:'Summoned AE',32:'AE Target Hate List',33:'Hate List',
  34:'LDoN Chest',35:'Muramite',36:'PC AE',37:'NPC AE',38:'Summoned Pet',39:'Group v1',40:'AE Bard',
  41:'Group v2',42:'Directional AE',43:'Group Client and Pet',44:'Beam',45:'Ring',46:"Target's Target",
  47:'Pet Master',50:'Target AE No Pets',
};

export const RESIST_NAMES = {
  0:'Unresistable',1:'Magic',2:'Fire',3:'Cold',4:'Poison',5:'Disease',6:'Chromatic',7:'Prismatic',
  8:'Physical',9:'Corruption',
};

/** spells_us.txt integer field -> int (floors decimals, blank -> 0) */
const int = s => {
  if (!s || s[0] === '.') return 0;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
};
const bool = s => int(s) !== 0;

/** Buff duration in ticks. Mirrors Spell.CalcDuration. */
export function calcDuration(calc, cap, level = 125) {
  let v;
  switch (calc) {
    case 0: v = 0; break;
    case 1: case 12: v = Math.max(Math.trunc(level / 2), 1); break;
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
    case 13: v = level * 4 + 10; break;
    case 14: v = level * 5 + 10; break;
    case 15: v = (level * 5 + 50) * 2; break;
    case 50: v = 72000; break;
    case 3600: v = 3600; break;
    default: v = cap;
  }
  return cap > 0 && v > cap ? cap : v;
}

function parseSpellLine(f, level) {
  const s = {
    id: int(f[F.ID]),
    name: f[F.NAME].trim(),
    extra: f[F.EXTRA],
    levels: Array.from({ length: 16 }, (_, i) => int(f[F.LEVELS + i])),
    beneficial: bool(f[F.BENEFICIAL]),
    target: int(f[F.TARGET]),
    resist: int(f[F.RESIST]),
    skill: int(f[F.SKILL]),
    mana: int(f[F.MANA]),
    endurance: int(f[F.ENDURANCE]),
    cast_ms: int(f[F.CAST_MS]),
    recast_ms: int(f[F.RECAST_MS]),
    dur_calc: int(f[F.DUR_CALC]),
    dur_cap: int(f[F.DUR_CAP]),
    icon: int(f[F.ICON]),
    desc_id: int(f[F.DESC_ID]),
    timer: int(f[F.TIMER]),
    is_skill: bool(f[F.IS_SKILL]),
    unstackable_dot: bool(f[F.UNSTACKABLE_DOT]),
    song_window: bool(f[F.SONG_WINDOW]),
    no_dispel: bool(f[F.NO_DISPEL]),
    duration_frozen: bool(f[F.DURATION_FROZEN]),
    persist_after_death: bool(f[F.PERSIST_AFTER_DEATH]),
    stacks_with_self: bool(f[F.STACKS_WITH_SELF]),
    no_buff_block: bool(f[F.NO_BUFF_BLOCK]),
    no_remove: bool(f[F.NO_REMOVE]),
    group_id: int(f[F.SPELL_GROUP]),
    rank: int(f[F.SPELL_GROUP_RANK]),
    subgroup: f.length > F.SPELL_SUBGROUP ? int(f[F.SPELL_SUBGROUP]) : 0,
    no_overwrite: f.length > F.NO_OVERWRITE ? bool(f[F.NO_OVERWRITE]) : false,
    recourse: int(f[F.RECOURSE]),
    hate_mod: int(f[F.HATE_MOD]),
    hate_override: int(f[F.HATE_OVERRIDE]),
    max_hits: int(f[F.MAX_HITS]),
    crit_override: int(f[F.CRIT_OVERRIDE]),
    max_targets: int(f[F.MAX_TARGETS]),
    range: int(f[F.RANGE]),
    ae_duration: int(f[F.AEDURATION]),
    cat_ids: [0, 1, 2].map(i => int(f[F.CAT + i])),
    desc: '', land_self: '', categories: [], stacking: [], slots: [],
  };
  s.duration = calcDuration(s.dur_calc, s.dur_cap, level);

  // last field: SLOT|SPA|BASE1|BASE2|CALC|MAX, chunks separated by $
  for (const chunk of f[f.length - 1].split('$')) {
    const p = chunk.split('|');
    if (p.length < 6) break;
    const i = int(p[0]) - 1, spa = int(p[1]);
    if (spa === 254) break;                       // unused slot, nothing meaningful follows
    while (s.slots.length <= i) s.slots.push(null);
    s.slots[i] = { i, spa, base1: int(p[2]), base2: int(p[3]), calc: int(p[4]), max: int(p[5]) };
  }
  return s;
}

async function* lines(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

/** dbstr_us.txt -> Map("type/id" -> text) */
async function loadDbstr(file) {
  const out = new Map();
  for await (const line of lines(file)) {
    if (!line || line[0] === '#') continue;
    const f = line.split('^');
    if (f.length < 3) continue;
    out.set(`${int(f[1])}/${int(f[0])}`, f[2]);
  }
  return out;
}

export async function loadAll(eqDir, level = 125) {
  const spells = [], byId = new Map();
  for await (const line of lines(path.join(eqDir, 'spells_us.txt'))) {
    if (!line || line[0] === '#') continue;
    const f = line.split('^');
    if (f.length < 100) continue;
    const sp = parseSpellLine(f, level);
    spells.push(sp);
    byId.set(sp.id, sp);
  }

  const desc = await loadDbstr(path.join(eqDir, 'dbstr_us.txt'));

  for (const sp of spells) {
    if (sp.desc_id > 0) sp.desc = desc.get(`6/${sp.desc_id}`) || '';
    const c1 = desc.get(`5/${sp.cat_ids[0]}`);
    if (c1) {
      for (const sub of sp.cat_ids.slice(1)) {
        const c2 = desc.get(`5/${sub}`);
        if (c2 && !c2.startsWith('Timer')) sp.categories.push(`${c1}/${c2}`);
      }
      if (!sp.categories.length) sp.categories.push(c1);
    }
  }

  const strPath = path.join(eqDir, 'spells_us_str.txt');
  if (fs.existsSync(strPath)) {
    for await (const line of lines(strPath)) {
      if (!line || line[0] === '#') continue;
      const f = line.split('^');
      if (f.length < 5) continue;
      const sp = byId.get(int(f[0]));
      if (sp) sp.land_self = f[3];
    }
  }

  let stackPath = path.join(eqDir, 'Resources', 'SpellStackingGroups.txt');
  if (!fs.existsSync(stackPath)) stackPath = path.join(eqDir, 'SpellStackingGroups.txt');
  if (fs.existsSync(stackPath)) {
    const fallback = new Map();
    for await (const line of lines(stackPath)) {
      if (!line || line[0] === '#') continue;
      const f = line.split('^');
      if (f.length < 4) continue;
      const sp = byId.get(int(f[0]));
      if (!sp) continue;
      const group = int(f[1]);
      let name = desc.get(`40/${group}`);
      if (!name) {
        if (!fallback.has(group)) fallback.set(group, sp.name);
        name = fallback.get(group);
      }
      sp.stacking.push({ group, group_name: name, rank: int(f[2]), type: int(f[3]) });
    }
  }

  for (const sp of spells) sp.desc = prepareDesc(sp, byId, level);
  return { spells, byId };
}

// ---------------------------------------------------------------------------
// Description tokens
//
// dbstr descriptions are templates: "#2" means "base1 of slot 2", "%z" the
// duration, "*#1%N" the name of the spell whose id sits in base1 of slot 1.
// Resolving them at build time is what turns "Grants a #2% increase" into
// "Grants a 300% increase". Port of Spell.PrepareDesc / DecodeDescToken.
// ---------------------------------------------------------------------------

const TAG_RE = /<.+?>/g;
const LOOSE_REF = /\s([#$@]\d+(?:%N|\+G))/g;
const TOKEN_RE = /([*+$#@%][^\s.,)<>\-s]*[^\s.,)<>\-s%])/g;
const DIV_1000 = new Set([143, 144, 310, 511]);
const DIV_100 = new Set([214, 513, 514, 515, 516, 517, 518, 522, 523]);
const DIV_10 = new Set([178, 182]);

const fmtNum = x => Number.isInteger(x) ? String(x) : String(Math.round(x * 1e6) / 1e6);

function fmtTime(sec) {
  if (sec <= 0) return '0s';
  const h = Math.trunc(sec / 3600), m = Math.trunc(sec % 3600 / 60), s = sec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !h) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

/** Level-scaled slot value, used for description rendering. */
export function calcSlotValue(sl, level = 125) {
  const { calc: formula, base1: base, max } = sl;
  const ubase = Math.abs(base);
  const sign = (max < base && max !== 0) ? -1 : 1;
  let r;
  if (formula === 60 || formula === 70) r = Math.trunc(ubase / 100);
  else if (formula === 0 || formula === 100) r = ubase;
  else if (formula === 101) r = sign * (ubase + Math.trunc(level / 2));
  else if (formula === 102) r = sign * (ubase + level);
  else if (formula === 103) r = sign * (ubase + level * 2);
  else if (formula === 104) r = sign * (ubase + level * 3);
  else if (formula === 105) r = sign * (ubase + level * 4);
  else if (formula === 109) r = sign * (ubase + Math.trunc(level / 4));
  else if (formula === 110) r = ubase + Math.trunc(level / 6);
  else if (formula === 119) r = ubase + Math.trunc(level / 8);
  else if (formula === 121) r = ubase + Math.trunc(level / 3);
  else if (formula === 201 || formula === 203) r = max;
  else if (formula < 100) r = ubase + level * formula;
  else r = ubase;
  if (max !== 0) r = sign === 1 ? Math.min(r, max) : Math.max(r, max);
  if (base < 0 && r > 0) r = -r;
  return r;
}

function slotValue(sp, i, kind) {
  if (i < 0 || i >= sp.slots.length || !sp.slots[i]) return null;
  const sl = sp.slots[i];
  return [{ '#': sl.base1, '$': sl.base2, '@': sl.max }[kind], sl];
}

function decode(token, sp, byId, level, depth = 0) {
  if (!sp || depth > 4) return null;
  if (/^\*@\D/.test(token)) token = token.slice(2);
  if (/^\*[#$@]\d+\+S$/.test(token)) token = token.slice(1);

  if (token.startsWith('*%R')) return decode(token.slice(3), byId.get(sp.recourse), byId, level, depth + 1);

  let m = /^\*(\d+)/.exec(token);
  if (m) return decode(token.slice(m[0].length), byId.get(parseInt(m[1], 10)), byId, level, depth + 1);

  m = /^\*[#$@](\d+)/.exec(token);
  if (m) {
    const got = slotValue(sp, parseInt(m[1], 10) - 1, token[1]);
    if (!got) return null;
    let id = got[0];
    if (token.endsWith('+G')) id = -id;
    return decode(token.slice(m[0].length), byId.get(id), byId, level, depth + 1);
  }

  m = /^[#$@](\d+)/.exec(token);
  if (m) {
    const got = slotValue(sp, parseInt(m[1], 10) - 1, token[0]);
    if (!got) return null;
    let [value, sl] = got;
    if (token.endsWith('+S')) return `skill ${value}` + token.slice(m[0].length);
    if (value === 2147483647 || value === -2147483648) value = 0;   // sentinel for bad data
    const spa = sl.spa, kind = token[0], abs = Math.abs(value);
    let text;
    if (spa === 1) text = fmtNum(Math.abs(calcSlotValue(sl, level)));
    else if (spa === 11) text = fmtNum(Math.abs(calcSlotValue(sl, level) - 100));
    else if (spa === 63) text = fmtNum(abs + 40);
    else if ((spa === 21 || spa === 64) && kind !== '@') text = fmtNum(abs / 1000);
    else if (DIV_1000.has(spa)) text = fmtNum(abs / 1000);
    else if (DIV_100.has(spa)) text = fmtNum(abs / 100);
    else if (DIV_10.has(spa)) text = fmtNum(abs / 10);
    else if (spa === 440 && kind === '$') text = fmtNum(abs / 10);
    else if (spa === 278 && kind === '#') text = fmtNum(abs / 10);
    else if ((spa === 457 || spa === 525 || spa === 526) && kind !== '@') text = fmtNum(abs / 10);
    else if (spa === 118) text = fmtNum(abs * 10);
    else if (spa === 210) text = fmtNum(abs * 12);
    else if (spa === 287) text = fmtNum(abs * 6);
    else text = fmtNum(abs);
    return text + token.slice(m[0].length);
  }

  const simple = {
    '%z': fmtTime(sp.duration * 6), '%Z': fmtTime(sp.duration * 6),
    '%H': String(Math.abs(sp.hate_override)), '%M': String(Math.abs(sp.hate_mod)),
    '%L': String(sp.max_hits), '%n': sp.name, '%N': sp.name, '+G': sp.name,
    '%O': String(sp.crit_override), '%T': String(sp.max_targets), '%J': String(sp.range),
    '%i': String(sp.ae_duration >= 2500 ? Math.trunc(sp.ae_duration / 2500) : 1),
  };
  return simple[token] ?? null;
}

export function prepareDesc(sp, byId, level = 125) {
  if (!sp.desc) return '';
  let text = sp.desc.replace(TAG_RE, m => m.toLowerCase() === '<br>' ? m : '');
  text = text.replace(LOOSE_REF, (_, g) => ' *' + g);
  text = text.replace(TOKEN_RE, m => decode(m, sp, byId, level) ?? m);
  text = text.replace(/\{39\}(\d+)/g, 'target type $1').replace(/\{4[45]\}(\d+)/g, '[$1]');
  return text.replace(/<br>/gi, ' ').trim();
}

export const isBardSong = sp => sp.levels[7] < 255 && !sp.is_skill;
export const isGroupSpell = sp => sp.target === ST_GROUP || sp.target === ST_AE_BARD || sp.target === ST_GROUP_TELEPORT;
