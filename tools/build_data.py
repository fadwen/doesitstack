"""
Build the static dataset the site ships with.

  python tools/build_data.py --eq-dir "C:/.../EverQuest" --out dist

Outputs:
  dist/data/meta.json       SPA names, ignore list, build stamp
  dist/data/index.json      one small row per spell, for the search box
  dist/data/spells/NN.json  full spell records, fetched only for the pair you pick
  dist/data/desc/NN.json    spell descriptions, fetched with the pair
"""
from __future__ import annotations
import argparse, json, os, re, shutil, sys, time, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eqspells import load_all, CLASSES, TARGET_NAMES, RESIST_NAMES

HERE = os.path.dirname(os.path.abspath(__file__))
BUCKET = 2000
NON_CUMULATIVE_SPA = [496]   # "non-cumulative" mods: both buffs land, only the largest applies


def pretty_spa(name: str) -> str:
    name = name.replace("_", " ")
    name = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name)
    name = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", name)
    return re.sub(r"\s+", " ", name).strip()


CANDIDATE_DIRS = [
    r"C:\Users\Public\Daybreak Game Company\Installed Games\EverQuest",
    r"C:\Users\Public\Sony Online Entertainment\Installed Games\EverQuest",
    r"C:\Program Files (x86)\Sony\EverQuest",
    r"C:\EverQuest",
]


def find_eq_dir():
    for d in CANDIDATE_DIRS:
        if os.path.exists(os.path.join(d, "spells_us.txt")):
            return d
    return None


def compact(sp) -> dict:
    rec = {
        "id": sp.id,
        "name": sp.name,
        "levels": sp.levels,
        "beneficial": sp.beneficial,
        "target": sp.target,
        "resist": sp.resist,
        "duration": sp.duration,
        "dur_calc": sp.dur_calc,
        "dur_cap": sp.dur_cap,
        "mana": sp.mana,
        "endurance": sp.endurance,
        "cast_ms": sp.cast_ms,
        "recast_ms": sp.recast_ms,
        "icon": sp.icon,
        "group_id": sp.group_id,
        "rank": sp.rank,
        "is_skill": sp.is_skill,
        "unstackable_dot": sp.unstackable_dot,
        "song_window": sp.song_window,
        "timer": sp.timer,
        "slots": [None if s is None else [s.spa, s.base1, s.base2, s.calc, s.max] for s in sp.slots],
    }
    if sp.extra:
        rec["extra"] = sp.extra
    if sp.categories:
        rec["categories"] = sp.categories
    if sp.stacking:
        rec["stacking"] = sp.stacking
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eq-dir", default=None,
                    help="EverQuest install directory (auto-detected on Windows if omitted)")
    ap.add_argument("--out", default="dist")
    ap.add_argument("--level", type=int, default=125)
    args = ap.parse_args()
    if not args.eq_dir:
        args.eq_dir = find_eq_dir()
        if not args.eq_dir:
            sys.exit("Could not find an EverQuest install. Pass --eq-dir explicitly.")
        print(f"using {args.eq_dir}")

    t0 = time.time()
    spells, _ = load_all(args.eq_dir, level=args.level)
    print(f"parsed {len(spells)} spells in {time.time() - t0:.1f}s")

    data_dir = os.path.join(args.out, "data")
    os.makedirs(os.path.join(data_dir, "desc"), exist_ok=True)

    os.makedirs(os.path.join(data_dir, "spells"), exist_ok=True)
    shards = {}
    for s in spells:
        shards.setdefault(s.id // BUCKET, {})[s.id] = compact(s)
    for b, payload in shards.items():
        with open(os.path.join(data_dir, "spells", f"{b}.json"), "w", encoding="utf-8") as fh:
            json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)

    # Search index: [id, name, target, flags, duration_ticks, "BER 254|SHM 70", category]
    # flags bit 0 beneficial, 1 combat skill (discipline), 2 bard song, 3 song window,
    #       4 group spell, 5 has a Live stacking group
    index = []
    for s in spells:
        lv = "|".join(f"{c} {l}" for c, l in zip(CLASSES, s.levels) if l < 255)
        flags = ((1 if s.beneficial else 0) | (2 if s.is_skill else 0) |
                 (4 if s.is_bard_song else 0) | (8 if s.song_window else 0) |
                 (16 if s.is_group_spell else 0) | (32 if s.stacking else 0))
        index.append([s.id, s.name, s.target, flags, s.duration, lv, s.categories[0] if s.categories else ""])
    with open(os.path.join(data_dir, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, separators=(",", ":"), ensure_ascii=False)
    records = index

    buckets = {}
    for s in spells:
        if s.desc or s.land_self:
            buckets.setdefault(s.id // BUCKET, {})[s.id] = {"d": s.desc, "l": s.land_self}
    for b, payload in buckets.items():
        with open(os.path.join(data_dir, "desc", f"{b}.json"), "w", encoding="utf-8") as fh:
            json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)

    spa_meta = json.load(open(os.path.join(HERE, "spa_meta.json"), encoding="utf-8"))
    src_mtime = os.path.getmtime(os.path.join(args.eq_dir, "spells_us.txt"))
    meta = {
        "built": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "spell_file_date": datetime.datetime.fromtimestamp(src_mtime, datetime.timezone.utc).date().isoformat(),
        "spell_count": len(records),
        "bucket": BUCKET,
        "max_level": args.level,
        "classes": CLASSES,
        "targets": TARGET_NAMES,
        "resists": RESIST_NAMES,
        "spa_names": {k: pretty_spa(v) for k, v in spa_meta["spa_names"].items()},
        "ignored_in_stacking": spa_meta["ignored_in_stacking"],
        "non_cumulative": NON_CUMULATIVE_SPA,
    }
    with open(os.path.join(data_dir, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, separators=(",", ":"), ensure_ascii=False)

    # engine.js imports these as a module, so they are generated rather than fetched.
    # Written into web/ (the source tree, gitignored) as well so tests can run there.
    spa_js = ("// generated by tools/build_data.py \u2014 do not edit\n"
              "export const SPA_NAMES = " + json.dumps(meta["spa_names"], separators=(",", ":"), ensure_ascii=False) + ";\n"
              "export const IGNORED_IN_STACKING = " + json.dumps(spa_meta["ignored_in_stacking"]) + ";\n"
              "export const NON_CUMULATIVE_SPA = " + json.dumps(NON_CUMULATIVE_SPA) + ";\n")
    web_dir = os.path.join(os.path.dirname(HERE), "web")
    with open(os.path.join(web_dir, "spa.js"), "w", encoding="utf-8") as fh:
        fh.write(spa_js)
    for name in os.listdir(web_dir):
        if name.endswith((".html", ".css", ".js")):
            shutil.copy2(os.path.join(web_dir, name), os.path.join(args.out, name))

    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(data_dir) for f in fs)
    print(f"wrote {args.out}: {total/1e6:.1f} MB across {len(buckets)+len(shards)+2} data files")


if __name__ == "__main__":
    main()
