"""
Parse the EverQuest client spell data files into a compact, stacking-oriented dataset.

Source files (all shipped with the Live client):
  spells_us.txt                 - main spell table, caret-delimited, 166 fields (2025+ format)
  spells_us_str.txt             - cast/land/fade message strings
  dbstr_us.txt                  - description strings (type 6 = spell desc, 5 = category, 40 = stacking group)
  Resources/SpellStackingGroups.txt - spell -> stacking group / rank / type

Field layout follows rumstil/eqspellparser (SpellParserCurrent.cs).
"""
from __future__ import annotations
import json, os, re
from dataclasses import dataclass, field, asdict

CLASSES = ["WAR","CLR","PAL","RNG","SHD","DRU","MNK","BRD","ROG","SHM","NEC","WIZ","MAG","ENC","BST","BER"]

# field indexes in spells_us.txt (166-field layout)
F_ID, F_NAME, F_EXTRA = 0, 1, 3
F_RANGE, F_AERANGE = 4, 5
F_CAST_MS, F_RECOVERY_MS, F_RECAST_MS = 8, 9, 10
F_DUR_CALC, F_DUR_CAP = 11, 12
F_AEDURATION, F_MANA = 13, 14
F_BENEFICIAL, F_RESIST, F_TARGET = 28, 29, 30
F_SKILL, F_ZONETYPE = 32, 33
F_LEVELS = 36                     # 16 entries, WAR..BER
F_CANCEL_ON_SIT = 56
F_ICON = 75
F_RESIST_MOD = 78
F_UNSTACKABLE_DOT = 79
F_RECOURSE = 81
F_HATE_MOD = 92
F_SONG_WINDOW = 84
F_DESC_ID = 85
F_CAT = 86                        # 86,87,88
F_ENDURANCE = 96
F_TIMER = 97
F_IS_SKILL = 98                   # combat skill / discipline flag
F_MAX_HITS_TYPE, F_MAX_HITS = 101, 102
F_HATE_OVERRIDE = 99
F_MGB = 110
F_NO_DISPEL = 111
F_NOT_FOCUSABLE = 122
F_DURATION_FROZEN = 125
F_STACKS_WITH_SELF = 128
F_NO_BUFF_BLOCK = 130
F_SPELL_GROUP = 132
F_SPELL_GROUP_RANK = 133
F_PERSIST_AFTER_DEATH = 148
F_CRIT_OVERRIDE = 141
F_MAX_TARGETS = 142
F_NO_REMOVE = 156
F_SPELL_SUBGROUP = 160
F_NO_OVERWRITE = 161

# target types (EQEmu SpellTargetType)
ST_GROUP_TELEPORT, ST_AE_BARD, ST_GROUP = 0x03, 0x28, 0x29

TARGET_NAMES = {
    0: "Target AE", 1: "Single", 2: "Self", 3: "Group Teleport", 4: "AE PC v1", 5: "Single",
    6: "Self", 8: "Targeted AE", 9: "Animal", 10: "Undead", 11: "Summoned", 13: "Life Tap",
    14: "Pet", 15: "Corpse", 16: "Plant", 17: "Giant", 18: "Dragon", 20: "Targeted AE Tap",
    24: "Undead AE", 25: "Summoned AE", 32: "AE Target Hate List", 33: "Hate List",
    34: "LDoN Chest", 35: "Muramite", 36: "PC AE", 37: "NPC AE", 38: "Summoned Pet",
    39: "Group v1", 40: "AE Bard", 41: "Group v2", 42: "Directional AE",
    43: "Group Client and Pet", 44: "Beam", 45: "Ring", 46: "Target's Target",
    47: "Pet Master", 50: "Target AE No Pets",
}

RESIST_NAMES = {0:"Unresistable",1:"Magic",2:"Fire",3:"Cold",4:"Poison",5:"Disease",6:"Chromatic",7:"Prismatic",8:"Physical",9:"Corruption"}


def _i(s: str) -> int:
    """spells_us.txt integer field -> int (floors decimals, blank -> 0)."""
    if not s or s[0] == ".":
        return 0
    s = re.sub(r"\..*$", "", s)
    try:
        return int(s)
    except ValueError:
        return 0


def _b(s: str) -> bool:
    return _i(s) != 0


def calc_duration(calc: int, cap: int, level: int = 125) -> int:
    """Buff duration in ticks. Mirrors Spell.CalcDuration."""
    if calc == 0:      v = 0
    elif calc == 1:    v = max(level // 2, 1)
    elif calc == 2:    v = max((level // 2) + 5, 6)
    elif calc == 3:    v = level * 30
    elif calc == 4:    v = 50
    elif calc == 5:    v = 2
    elif calc == 6:    v = level // 2
    elif calc == 7:    v = level
    elif calc == 8:    v = level + 10
    elif calc == 9:    v = level * 2 + 10
    elif calc == 10:   v = level * 30 + 10
    elif calc == 11:   v = (level + 3) * 30
    elif calc == 12:   v = max(level // 2, 1)
    elif calc == 13:   v = level * 4 + 10
    elif calc == 14:   v = level * 5 + 10
    elif calc == 15:   v = (level * 5 + 50) * 2
    elif calc == 50:   v = 72000
    elif calc == 3600: v = 3600
    else:              v = cap
    if cap > 0 and v > cap:
        v = cap
    return v


@dataclass
class Slot:
    i: int          # 0-based slot index
    spa: int
    base1: int
    base2: int
    calc: int       # "formula" in EQEmu terms
    max: int


@dataclass
class Spell:
    id: int
    name: str
    extra: str = ""
    levels: list = field(default_factory=lambda: [255] * 16)
    slots: list = field(default_factory=list)     # list[Slot | None], index = slot number
    beneficial: bool = False
    target: int = 0
    resist: int = 0
    skill: int = 0
    mana: int = 0
    endurance: int = 0
    cast_ms: int = 0
    recast_ms: int = 0
    dur_calc: int = 0
    dur_cap: int = 0
    duration: int = 0                 # ticks at level 125
    icon: int = 0
    desc_id: int = 0
    desc: str = ""
    land_self: str = ""
    categories: list = field(default_factory=list)
    timer: int = 0
    is_skill: bool = False            # combat skill (discipline)
    unstackable_dot: bool = False
    song_window: bool = False
    no_dispel: bool = False
    duration_frozen: bool = False
    persist_after_death: bool = False
    stacks_with_self: bool = False
    no_buff_block: bool = False
    no_overwrite: bool = False
    no_remove: bool = False
    group_id: int = 0
    rank: int = 0
    subgroup: int = 0
    stacking: list = field(default_factory=list)  # [{group, group_name, rank, type}]
    recourse: int = 0
    hate_mod: int = 0
    hate_override: int = 0
    max_hits: int = 0
    crit_override: int = 0
    max_targets: int = 0
    range: int = 0
    ae_duration: int = 0
    cat_ids: list = field(default_factory=list)

    @property
    def is_bard_song(self) -> bool:
        return self.levels[7] < 255 and not self.is_skill

    @property
    def is_group_spell(self) -> bool:
        return self.target in (ST_AE_BARD, ST_GROUP, ST_GROUP_TELEPORT)

    @property
    def is_detrimental(self) -> bool:
        return not self.beneficial


def parse_spell_line(fields: list) -> Spell:
    s = Spell(id=_i(fields[F_ID]), name=fields[F_NAME].strip(), extra=fields[F_EXTRA])
    s.levels = [_i(fields[F_LEVELS + i]) for i in range(16)]
    s.beneficial = _b(fields[F_BENEFICIAL])
    s.target = _i(fields[F_TARGET])
    s.resist = _i(fields[F_RESIST])
    s.skill = _i(fields[F_SKILL])
    s.mana = _i(fields[F_MANA])
    s.endurance = _i(fields[F_ENDURANCE])
    s.cast_ms = _i(fields[F_CAST_MS])
    s.recast_ms = _i(fields[F_RECAST_MS])
    s.dur_calc = _i(fields[F_DUR_CALC])
    s.dur_cap = _i(fields[F_DUR_CAP])
    s.duration = calc_duration(s.dur_calc, s.dur_cap)
    s.icon = _i(fields[F_ICON])
    s.desc_id = _i(fields[F_DESC_ID])
    s.timer = _i(fields[F_TIMER])
    s.is_skill = _b(fields[F_IS_SKILL])
    s.unstackable_dot = _b(fields[F_UNSTACKABLE_DOT])
    s.song_window = _b(fields[F_SONG_WINDOW])
    s.no_dispel = _b(fields[F_NO_DISPEL])
    s.duration_frozen = _b(fields[F_DURATION_FROZEN])
    s.persist_after_death = _b(fields[F_PERSIST_AFTER_DEATH])
    s.stacks_with_self = _b(fields[F_STACKS_WITH_SELF])
    s.no_buff_block = _b(fields[F_NO_BUFF_BLOCK])
    s.no_remove = _b(fields[F_NO_REMOVE])
    s.group_id = _i(fields[F_SPELL_GROUP])
    s.rank = _i(fields[F_SPELL_GROUP_RANK])
    if len(fields) > F_SPELL_SUBGROUP:
        s.subgroup = _i(fields[F_SPELL_SUBGROUP])
    if len(fields) > F_NO_OVERWRITE:
        s.no_overwrite = _b(fields[F_NO_OVERWRITE])
    s.cat_ids = [_i(fields[F_CAT + i]) for i in range(3)]
    s.recourse = _i(fields[F_RECOURSE])
    s.hate_mod = _i(fields[F_HATE_MOD])
    s.hate_override = _i(fields[F_HATE_OVERRIDE])
    s.max_hits = _i(fields[F_MAX_HITS])
    s.crit_override = _i(fields[F_CRIT_OVERRIDE])
    s.max_targets = _i(fields[F_MAX_TARGETS])
    s.range = _i(fields[F_RANGE])
    s.ae_duration = _i(fields[F_AEDURATION])

    # last field: SLOT|SPA|BASE1|BASE2|CALC|MAX separated by $
    slots = []
    for chunk in fields[-1].split("$"):
        p = chunk.split("|")
        if len(p) < 6:
            break
        idx, spa = _i(p[0]) - 1, _i(p[1])
        if spa == 254:            # unused slot, nothing meaningful follows
            break
        while len(slots) <= idx:
            slots.append(None)
        slots[idx] = Slot(i=idx, spa=spa, base1=_i(p[2]), base2=_i(p[3]), calc=_i(p[4]), max=_i(p[5]))
    s.slots = slots
    return s


def load_dbstr(path):
    """dbstr_us.txt -> {(type, id): text}"""
    out = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            f = line.rstrip("\n").split("^")
            if len(f) < 3:
                continue
            out[(_i(f[1]), _i(f[0]))] = f[2]
    return out


def load_all(eq_dir: str, level: int = 125):
    spells, by_id = [], {}
    with open(os.path.join(eq_dir, "spells_us.txt"), encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            f = line.split("^")
            if len(f) < 100:
                continue
            sp = parse_spell_line(f)
            spells.append(sp)
            by_id[sp.id] = sp

    desc = load_dbstr(os.path.join(eq_dir, "dbstr_us.txt"))

    for sp in spells:
        if sp.desc_id > 0:
            sp.desc = desc.get((6, sp.desc_id), "")
        cats = []
        c1 = desc.get((5, sp.cat_ids[0]))
        if c1:
            for sub in sp.cat_ids[1:]:
                c2 = desc.get((5, sub))
                if c2 and not c2.startswith("Timer"):
                    cats.append(c1 + "/" + c2)
            if not cats:
                cats.append(c1)
        sp.categories = cats

    str_path = os.path.join(eq_dir, "spells_us_str.txt")
    if os.path.exists(str_path):
        with open(str_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if line.startswith("#"):
                    continue
                f = line.rstrip("\n").split("^")
                if len(f) < 5:
                    continue
                sp = by_id.get(_i(f[0]))
                if sp:
                    sp.land_self = f[3]

    stack_path = os.path.join(eq_dir, "Resources", "SpellStackingGroups.txt")
    if not os.path.exists(stack_path):
        stack_path = os.path.join(eq_dir, "SpellStackingGroups.txt")
    if os.path.exists(stack_path):
        fallback = {}
        with open(stack_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if line.startswith("#"):
                    continue
                f = line.rstrip("\n").split("^")
                if len(f) < 4:
                    continue
                sid, gid, rank, gtype = _i(f[0]), _i(f[1]), _i(f[2]), _i(f[3])
                sp = by_id.get(sid)
                if not sp:
                    continue
                name = desc.get((40, gid))
                if not name:
                    name = fallback.setdefault(gid, sp.name)
                sp.stacking.append({"group": gid, "group_name": name, "rank": rank, "type": gtype})

    for sp in spells:
        sp.desc = prepare_desc(sp, by_id)

    return spells, by_id


# ---------------------------------------------------------------------------
# Description tokens
#
# dbstr descriptions are templates: "#2" means "base1 of slot 2", "%z" the
# duration, "*#1%N" the name of the spell whose id sits in base1 of slot 1, and
# so on. Substituting them at build time is what turns "Grants a #2% increase"
# into "Grants a 300% increase". Port of Spell.PrepareDesc / DecodeDescToken.
# ---------------------------------------------------------------------------

_TAG_RE      = re.compile(r"<.+?>")
_LOOSE_REF   = re.compile(r"\s([#$@]\d+(?:%N|\+G))")
_TOKEN_RE    = re.compile(r"([*+$#@%][^\s.,)<>\-s]+(?<!%))")
_STAR_ID     = re.compile(r"^\*(\d+)")
_STAR_SLOT   = re.compile(r"^\*[#$@](\d+)")
_PLAIN_SLOT  = re.compile(r"^[#$@](\d+)")

# SPA-specific scaling applied when a description prints a slot value
_DIV_1000 = {143, 144, 310, 511}
_DIV_100  = {214, 513, 514, 515, 516, 517, 518, 522, 523}
_DIV_10   = {178, 182}


def _fmt_num(x):
    return str(int(x)) if float(x).is_integer() else ("%g" % x)


def _fmt_time(sec: int) -> str:
    if sec <= 0:
        return "0s"
    h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
    parts = []
    if h: parts.append(f"{h}h")
    if m: parts.append(f"{m}m")
    if s and not h: parts.append(f"{s}s")
    return " ".join(parts) or "0s"


def _slot_value(sp, i, kind):
    if i < 0 or i >= len(sp.slots) or sp.slots[i] is None:
        return None
    sl = sp.slots[i]
    return {"#": sl.base1, "$": sl.base2, "@": sl.max}[kind], sl


def _decode(token, sp, by_id, depth=0):
    if depth > 4:
        return None
    if re.match(r"^\*@\D", token):
        token = token[2:]
    if re.match(r"^\*[#$@]\d+\+S$", token):
        token = token[1:]

    if token.startswith("*%R"):
        ref = by_id.get(sp.recourse)
        return _decode(token[3:], ref, by_id, depth + 1) if ref else None

    m = _STAR_ID.match(token)
    if m:
        ref = by_id.get(int(m.group(1)))
        return _decode(token[m.end():], ref, by_id, depth + 1) if ref else None

    m = _STAR_SLOT.match(token)
    if m:
        got = _slot_value(sp, int(m.group(1)) - 1, token[1])
        if got is None:
            return None
        sid = got[0]
        if token.endswith("+G"):
            sid = -sid
        ref = by_id.get(sid)
        return _decode(token[m.end():], ref, by_id, depth + 1) if ref else None

    m = _PLAIN_SLOT.match(token)
    if m:
        got = _slot_value(sp, int(m.group(1)) - 1, token[0])
        if got is None:
            return None
        value, sl = got
        if token.endswith("+S"):
            return f"skill {value}" + token[m.end():]
        if abs(value) in (2147483647, 2147483648):
            value = 0
        spa, kind = sl.spa, token[0]
        if spa == 1:
            text = _fmt_num(abs(calc_value(sl, sp)))
        elif spa == 11:
            text = _fmt_num(abs(calc_value(sl, sp) - 100))
        elif spa == 63:
            text = _fmt_num(abs(value) + 40)
        elif spa in (21, 64) and kind != "@":
            text = _fmt_num(abs(value) / 1000)
        elif spa in _DIV_1000:
            text = _fmt_num(abs(value) / 1000)
        elif spa in _DIV_100:
            text = _fmt_num(abs(value) / 100)
        elif spa in _DIV_10:
            text = _fmt_num(abs(value) / 10)
        elif spa == 440 and kind == "$":
            text = _fmt_num(abs(value) / 10)
        elif spa == 278 and kind == "#":
            text = _fmt_num(abs(value) / 10)
        elif spa in (457, 525, 526) and kind != "@":
            text = _fmt_num(abs(value) / 10)
        elif spa == 118:
            text = _fmt_num(abs(value) * 10)
        elif spa == 210:
            text = _fmt_num(abs(value) * 12)
        elif spa == 287:
            text = _fmt_num(abs(value) * 6)
        else:
            text = _fmt_num(abs(value))
        return text + token[m.end():]

    simple = {
        "%z": _fmt_time(sp.duration * 6), "%Z": _fmt_time(sp.duration * 6),
        "%H": str(abs(sp.hate_override)), "%M": str(abs(sp.hate_mod)),
        "%L": str(sp.max_hits), "%n": sp.name, "%N": sp.name, "+G": sp.name,
        "%O": str(sp.crit_override), "%T": str(sp.max_targets), "%J": str(sp.range),
        "%i": str(sp.ae_duration // 2500 if sp.ae_duration >= 2500 else 1),
    }
    return simple.get(token)


def prepare_desc(sp, by_id) -> str:
    if not sp.desc:
        return ""
    text = _TAG_RE.sub(lambda m: m.group(0) if m.group(0).lower() == "<br>" else "", sp.desc)
    text = _LOOSE_REF.sub(lambda m: " *" + m.group(1), text)
    text = _TOKEN_RE.sub(lambda m: _decode(m.group(1), sp, by_id) or m.group(1), text)
    text = re.sub(r"\{39\}(\d+)", r"target type \1", text)
    text = re.sub(r"\{4[45]\}(\d+)", r"[\1]", text)
    return re.sub(r"<br>", " ", text, flags=re.I).strip()


def calc_value(sl, sp, level: int = 125) -> int:
    """Level-scaled slot value. Mirrors CalcSpellEffectValue_formula for the
    non-degenerating formulas; used only for description rendering here."""
    formula, base, mx = sl.calc, sl.base1, sl.max
    ubase = abs(base)
    sign = -1 if (mx < base and mx != 0) else 1
    if formula in (60, 70):        r = ubase // 100
    elif formula in (0, 100):      r = ubase
    elif formula == 101:           r = sign * (ubase + level // 2)
    elif formula == 102:           r = sign * (ubase + level)
    elif formula == 103:           r = sign * (ubase + level * 2)
    elif formula == 104:           r = sign * (ubase + level * 3)
    elif formula == 105:           r = sign * (ubase + level * 4)
    elif formula == 109:           r = sign * (ubase + level // 4)
    elif formula == 110:           r = ubase + level // 6
    elif formula == 119:           r = ubase + level // 8
    elif formula == 121:           r = ubase + level // 3
    elif formula in (201, 203):    r = mx
    elif formula < 100:            r = ubase + level * formula
    else:                          r = ubase
    if mx != 0:
        r = min(r, mx) if sign == 1 else max(r, mx)
    if base < 0 and r > 0:
        r = -r
    return r
