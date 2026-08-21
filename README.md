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

### Non-cumulative effects

A handful of SPAs land on you together but are not added together; the game keeps the
larger value. The tool warns when a stacking pair shares one — with different wording
depending on how well the claim is backed, because the backing genuinely differs.

**How the list was built.** `zone/bonuses.cpp` in the EQEmu server accumulates most
bonuses with `+=`. Seven use a keep-the-larger-magnitude idiom instead: **185**
DamageModifier, **186** MinDamageModifier, **459** DamageModifier2, **482**
Skill_Base_Damage_Mod, **496** Critical_Melee_Damage_Mod_Max, **503**
Melee_Damage_Position_Mod, **505** Damage_Taken_Position_Mod.

**Where EQEmu gets its own knowledge.** Its code cites real sources in places — the
RoF2 client itself (`zone/spells.cpp`: *"big ol' list according to the client"*, for the
stacking ignore list), Daybreak's enumerated SPA list on the official EQ forums
(`common/spdat.h` header), samanna.net for buff duration formulas, and live-server
parses by its developers (*"~Kayen confirmed on live 2/2/22"*).

**None of those citations attach to these seven.** Each was introduced by a developer
asserting the behaviour with no stated source:

| SPA | Introduced |
| --- | --- |
| 185, 186, 459 | `6fc5f8fb`, 2016-01-10, mackal — "Fix stacking issues with SE_DamageModifier and SE_MinDamageModifier" |
| 496, 503, 505 | `8a2a1b15`, 2021-07-14, KayenEQ — PR #1454, *"SE_Critical_Melee_Damage_Mod_Max 496 - This is a non stackable melee critical modifier"* |
| 482 | `fee8772b`, 2021-07-29, KayenEQ — PR #1474 |

Neither PR discussion cites a parse, a forum thread or a test. Daybreak's own SPA list
stops at 471, so it never covered 496 at all.

**The one thing that is independently confirmed is 496**, and not by EQEmu — by
Daybreak. Of all 70,963 spells, exactly 53 descriptions contain the word
"non-cumulative", and every one of them carries SPA 496. None says it without. That is
the game's own text, shipped in `dbstr_us.txt`, and EQEmu's implementation happens to
agree with it.

So: 496 is established, and the other six are one project's reading of the mechanic.
The UI says so.

Two caveats that apply either way:

- The larger value wins **within one bonus bucket**. Spell, AA and worn-item bonuses
  are summed at use time, so a worn item effect and a buff can still add. Two buffs —
  the case this tool compares — are both in the spell bucket.
- 185, 459, 482, 503 and 505 are additive when they arrive as a worn item bonus rather
  than as a buff.

Per-SPA provenance, including the commits above, lives in `tools/spa_meta.json` under
`non_cumulative`.

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

## Searching

The search box filters by name or spell id, narrowed by two things:

**Class** — the sixteen classes, matching either a spell the class can learn or one it
only ever reaches by triggering. Side-effect spells usually carry no class levels of
their own, so the build borrows the levels of whatever triggers them; that is why a
ranger search turns up *Jolting Swings Strike* and not just *Jolting Swings*.

**Source** — where the effect comes from:

| | |
| --- | --- |
| **Spell** | scribed by a class at a normal level |
| **Discipline** | flagged as a combat skill |
| **Song** | usable by bards, not a combat skill |
| **AA** | granted by an alternate ability — the class level reads 254 |
| **Item / other** | see below |
| **Triggered** | fired by another spell as a proc, recourse or side effect |
| **NPC** | flagged castable by NPCs only |

### On "Item / other"

**The client's spell files do not record which item grants an effect.** Items live
server-side; nothing in `spells_us.txt` links a clicky to its item. So this bucket is a
residual — everything no class can learn, nothing else in the file triggers, and that
is not flagged NPC-only. Clickies, procs and worn effects land there, which is what
you want, but so do NPC spells that simply lack the NPC flag. Roughly 27,000 rows.

Pairing it with **Beneficial only** and **Only effects with a duration** gets close to
"things an item can put on me". Treat the label as a deduction, not a fact, and follow
the Lucy link when it matters — Lucy has an item database and can tell you the real
source.

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

Node 20+ is the only prerequisite — no dependencies to install.

```bash
npm run build                 # auto-detects the usual Windows install paths
node tools/build.mjs --eq-dir "C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest"

npm run serve                 # builds, then serves dist/ on http://localhost:8000
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
npm test
```

The suite pins the engine against known-good pairs (the two spells above, snare vs.
Spirit of Wolf, a bard song vs. a normal buff, same-spell refresh rules) and runs
against the real dataset, so it doubles as a check that the parser still lines up
with the current file format.

### Publishing

```bash
tools/deploy_pages.sh                                        # macOS / Linux / Git Bash
powershell -ExecutionPolicy Bypass -File tools\deploy_pages.ps1   # Windows
```

Either script builds, then force-pushes `dist/` as an orphan `gh-pages` commit.

Pushing the data as an orphan commit each time keeps thirty-odd megabytes of
regenerated JSON out of the repo's history.

## Layout

```
tools/spells.mjs        spell file parser, duration/value formulas, description tokens,
                        source classification and the spell-reference graph
tools/build.mjs         dataset + site build
tools/serve.mjs         dependency-free static server for dist/
tools/spa_meta.json     SPA id → name and the stacking ignore list, extracted from EQEmu
web/engine.js           the stacking rules
web/app.js              search, pickers, rendering
tests/                  node:test suite over the built dataset
```

## Known gaps

- Caster level is a single input applied to both spells; the game tracks it per buff.
- Formula 123 (random range) is evaluated at its midpoint.
- Six of the seven non-cumulative SPAs rest on uncited EQEmu implementation rather than
  on any primary source. See the section above.
- Slot effects are named, not phrased — you get "Critical Melee Damage Mod Max",
  not Lucy's full "Increase Critical Melee Damage by 300% of Base Damage".
- Bard instrument modifiers are not applied to song values.
- "Item / other" is a residual bucket, not a real source flag — see above.

## Credits

- [EQEmu/Server](https://github.com/EQEmu/Server) — the stacking algorithm
- [rumstil/eqspellparser](https://github.com/rumstil/eqspellparser) — spell file field layout
- [Lucy](https://lucy.allakhazam.com/) — the reference every EverQuest player already trusts

Not affiliated with or endorsed by Daybreak Game Company. EverQuest is a trademark of
Daybreak Game Company LLC.
