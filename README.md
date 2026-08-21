# Does it stack?

A static site that answers one question about EverQuest: **if I already have buff A,
will buff B land — and what happens to A if it does?**

It works on anything the game treats as a spell — buffs, disciplines, bard songs,
AA-granted effects, item clickies, procs — because all of them are rows in the same
spell table.

![Does it stack? comparing a berserker AA against a shaman epic click](docs/screenshot.png)

## Why not just read Lucy?

[Lucy](https://lucy.allakhazam.com/) will show you both spells, but you still have to
do the arbitration in your head: line up the twelve effect slots, decide which SPAs
count, compare the values, and remember the exceptions. This does that part, and shows
its work.

The classic example, and the one this project started from:

- [Savage Spirit XVII](https://lucy.allakhazam.com/spell.html?id=70855&source=Live) (berserker AA) — SPA 496 in **slot 2**
- [Prophet's Gift of the Ruchu](https://lucy.allakhazam.com/spell.html?id=6273&source=Live) (shaman epic) — SPA 496 in **slot 10**

Same effect, different slot index, so they stack — but SPA 496 is a *non-cumulative*
modifier, so only the larger of the two actually applies. Both halves of that answer
matter, and the site says both.

## How the rules work

EverQuest arbitrates buffs slot by slot. Each spell has twelve effect slots; two
spells conflict only where the **same** SPA (spell effect) sits in the **same** slot
index. When they do conflict, the incoming spell has to be at least as strong on
*every* shared slot or it is refused outright.

On top of that sit the special cases this engine implements:

| Rule | Effect |
| --- | --- |
| Live stacking groups | Two spells in one `SpellStackingGroups.txt` group never coexist; rank decides which wins |
| SPA 148 / 149 | Explicit block and overwrite commands carried by the spell itself |
| Ignore list | ~84 SPAs (focus effects, counters, vision, limits…) never cause a conflict |
| Blank slots | SPA 254, and SPA 10 spacers with base 0, are invisible to arbitration |
| Bard songs | A song and a non-song beneficial spell always stack |
| Negative AC | AC debuffs skip arbitration, so things like Sun's Corona and Glacier Breath coexist |
| Snare vs. run speed | A snare already in place refuses a movement buff |
| DoT vs. regen | A DoT will not overwrite regen, but does block a regen spell landing after it |
| Complete Heal | Never stacks or overwrites, ever |
| Group vs. single | The single-target version of a line will not replace the group version |

The engine in [`web/engine.js`](web/engine.js) is a port of `Mob::CheckStackConflict`
from the [EQEmu server](https://github.com/EQEmu/Server) (`zone/spells.cpp`), which
mirrors the RoF2 client. Server-side inputs that spell data alone cannot know —
existing spell bonuses, Screech and buff-stacker state, resurrection sickness, NPC
DoT ownership — are left out; every rule that made it in is commented with the case
it came from.

## Data

Everything comes from the four spell files that ship with the live client:

```
spells_us.txt                      the spell table itself (166 caret-delimited fields)
spells_us_str.txt                  cast / land / fade messages
dbstr_us.txt                       descriptions, categories, stacking group names
Resources/SpellStackingGroups.txt  spell → stacking group, rank, type
```

Nothing is scraped. Lucy is linked from every result so you can check the source,
but the numbers come out of your own install, which means the site is exactly as
current as your last patch. The field layout follows
[rumstil/eqspellparser](https://github.com/rumstil/eqspellparser).

## Build and run

```bash
python tools/build_data.py           # auto-detects the usual Windows install paths
python tools/build_data.py --eq-dir "C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest"

python -m http.server 8000 --directory dist
# open http://localhost:8000
```

The build writes `dist/`:

```
dist/index.html, app.js, engine.js, spa.js, style.css
dist/data/meta.json          SPA names, ignore list, build stamp
dist/data/index.json         one small row per spell — feeds the search box (~750 KB gzipped)
dist/data/spells/NN.json     full records, sharded by id; only the two you pick get fetched
dist/data/desc/NN.json       descriptions with their #1/%z template tokens resolved
```

`dist/` is deliberately not committed. Re-run the build after each patch day.

### Tests

```bash
node --test tests/*.test.mjs
```

The suite pins the engine against known-good pairs (the two spells above, snare vs.
Spirit of Wolf, a bard song vs. a normal buff, same-spell refresh rules) and runs
against the real dataset, so it doubles as a check that the parser still lines up
with the current file format.

### Publishing

```bash
tools/deploy_pages.sh        # builds, then force-pushes dist/ as an orphan gh-pages commit
```

Pushing the data as an orphan commit each time keeps thirty-odd megabytes of
regenerated JSON out of the repo's history.

## Layout

```
tools/eqspells.py       spell file parser, duration/value formulas, description tokens
tools/build_data.py     dataset + site build
tools/spa_meta.json     SPA id → name and the stacking ignore list, extracted from EQEmu
web/engine.js           the stacking rules
web/app.js              search, pickers, rendering
tests/                  node:test suite over the built dataset
```

## Known gaps

- Caster level is a single input applied to both spells; the game tracks it per buff.
- Formula 123 (random range) is evaluated at its midpoint.
- Non-cumulative detection currently covers SPA 496 only; extend `NON_CUMULATIVE_SPA`
  in `tools/build_data.py` as more are confirmed.
- Slot effects are named, not phrased — you get "Critical Melee Damage Mod Max",
  not Lucy's full "Increase Critical Melee Damage by 300% of Base Damage".
- Bard instrument modifiers are not applied to song values.

## Credits

- [EQEmu/Server](https://github.com/EQEmu/Server) — the stacking algorithm
- [rumstil/eqspellparser](https://github.com/rumstil/eqspellparser) — spell file field layout
- [Lucy](https://lucy.allakhazam.com/) — the reference every EverQuest player already trusts

Not affiliated with or endorsed by Daybreak Game Company. EverQuest is a trademark of
Daybreak Game Company LLC.
