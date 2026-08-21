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

### Focus effects

Focus effects — the ones that modify a spell you cast rather than doing something
themselves — behave differently from ordinary buffs in two ways, both reported by a
reader after the project went up and both recorded in `claims.json`:

**They stack regardless of slot.** EQEmu treats 44 SPAs as focus effects, and 31 of
them are already on the client's stacking ignore list, so the category is plainly meant
to be exempt. The rest are missing from it, which means the engine still arbitrates them
and can report a conflict between two focus buffs that in fact coexist. Rather than flip
those silently, a verdict resting on one is **marked doubtful in the UI**, with the
evidence and the counter-evidence shown. The counter-evidence matters: 399 FcTwincast
sits below the ignore list's ceiling, so the client had it and chose not to exempt it —
consistent with the long-standing player report that twincast effects don't stack with
each other. Exempting the whole category unchecked would trade one wrong answer for
another.

**Only the best one applies.** When several foci could affect the same cast, the game
uses the largest rather than adding them — EQEmu's focus aggregation keeps the best
across the item, AA and spell buckets. So two focus buffs can stack and still not give
you both benefits, and the tool says so. The exceptions are the proc-type foci — 339
TriggerOnCast, 340 SpellTrigger, 383 SympatheticProc — which fire independently and can
all land on one cast.

Both are `corroborated` — reported by Sancus, wizard class representative and in Realm
of Insanity, with EQEmu's implementation agreeing. That is strong enough for the engine
to act on: the affected SPAs are exempted from arbitration and the verdicts changed
accordingly. They are not `confirmed`, which is reserved for Daybreak's own words or a
parse, so the site attributes rather than asserts. See
[CONTRIBUTING.md](CONTRIBUTING.md).

This is also the answer to "twincast doesn't stack". Two twincast buffs *do* both hold;
what does not double is the effect. The buffs stack, the focus is best-only, and
conflating those two is what makes the mechanic confusing.

### Non-cumulative effects

A handful of SPAs land on you together but are not added together; the game keeps the
larger value. The tool warns when a stacking pair shares one, and shows the evidence
behind the warning — because the evidence differs sharply between them.

Seven SPAs qualify, identified from `zone/bonuses.cpp` in the EQEmu server, where they
keep the larger magnitude instead of the `+=` an ordinary bonus uses: **185**
DamageModifier, **186** MinDamageModifier, **459** DamageModifier2, **482**
Skill_Base_Damage_Mod, **496** Critical_Melee_Damage_Mod_Max, **503**
Melee_Damage_Position_Mod, **505** Damage_Taken_Position_Mod.

**Only 496 has a primary source**, and it is not EQEmu — it is Daybreak. Of all 70,963
spells, exactly 53 descriptions contain the word "non-cumulative", and every one of them
carries SPA 496; none says it without. EQEmu independently agrees, which corroborates
but does not establish.

The other six rest on uncited emulator code. 185/186/459 came from a 2016 mackal commit
whose message body is empty; 496/503/505 from KayenEQ's PR #1454 and 482 from #1474,
each asserting the behaviour with no source given. Daybreak's own published SPA list
stops at 471, so it never covered 496 either way. The site marks those six unverified
and says so in the warning.

Two caveats apply to all seven:

- The larger value wins **within one bonus bucket**. Spell, AA and worn-item bonuses are
  summed at use time, so a worn item effect and a buff can still add. Two buffs — the
  case this tool compares — are both in the spell bucket.
- 185, 459, 482, 503 and 505 are additive when they arrive as a worn item bonus rather
  than as a buff.

Every claim and its evidence live in [`claims.json`](claims.json). Status is derived
from evidence, not written by hand, so **adding a primary source removes the hedging on
the next build with no code change**. If you can settle one of the six, see
[CONTRIBUTING.md](CONTRIBUTING.md) — the parse protocol is there.

```bash
npm run claims     # every claim and its derived status
npm run verify     # re-runs the machine-checkable evidence against your spell files
```

## How the rules work

EverQuest arbitrates buffs slot by slot: two spells conflict only where the **same**
SPA (spell effect) sits in the **same** slot index. When they do conflict, the incoming
spell has to be at least as strong on *every* shared slot or it is refused outright.

Slot counts are not capped at twelve. That is a RoF2-era limit that EQEmu still carries
as `EFFECT_COUNT`, and live spells long outgrew it — Aria of Kenburk Rk. III has 22
slots, 2,612 spells in the current file have more than twelve, and the longest has 67.
The engine walks whatever the two spells actually have.

On top of that sit the special cases this engine implements:

| Rule | Effect |
| --- | --- |
| Live stacking groups | Two spells in one `SpellStackingGroups.txt` group never coexist; rank decides which wins |
| SPA 148 / 149 | Explicit block and overwrite commands carried by the spell itself |
| Ignore list | 84 SPAs (focus effects, counters, vision, limits…) never cause a conflict |
| Focus effects | Reported to stack regardless of slot; verdicts resting on an unexempted one are flagged doubtful |
| Blank slots | SPA 254, and SPA 10 spacers with base 0, are invisible to arbitration |
| Slot count | Whatever the spells carry, not EQEmu's RoF2-era cap of twelve |
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

Two layers. `tests/engine.fixtures.test.mjs` and `tests/claims.test.mjs` run on a bare
clone with no EverQuest install — hand-built fixtures covering slot arbitration, SPA 148
blocking, stacking groups, the snare and bard rules, plus the claims schema. That is
what CI runs.

`tests/engine.test.mjs` needs a built dataset and skips itself without one. It pins the
engine against real spells — the two above, Ensnare vs. Spirit of Wolf, Chant of Battle
vs. a normal buff — so it doubles as a check that the parser still lines up with the
current file format.

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
claims.json             what this project claims about the game, and the evidence for it
CONTRIBUTING.md         the evidence standard and the parse protocol
tools/spells.mjs        spell file parser, duration/value formulas, description tokens,
                        source classification and the spell-reference graph
tools/build.mjs         dataset + site build
tools/claims.mjs        claims loader, validator, status derivation
tools/verify_claims.mjs re-runs machine-checkable evidence against your spell files
tools/gen_spa_js.mjs    generates web/spa.js from repo files (no game needed)
tools/gen_spa_meta.mjs  regenerates spa_meta.json from an EQEmu checkout
tools/serve.mjs         dependency-free static server for dist/
tools/spa_meta.json     SPA id → name and the stacking ignore list, extracted from EQEmu
web/engine.js           the stacking rules
web/app.js              search, pickers, rendering
tests/                  node:test — fixtures and claims run anywhere, dataset tests skip
```

## Known gaps

- Caster level is a single input applied to both spells; the game tracks it per buff.
- Formula 123 (random range) is evaluated at its midpoint.
- Six of the seven non-cumulative SPAs rest on uncited EQEmu implementation rather than
  on any primary source. See the section above — and `claims.json` for each one.
- Slot effects are named, not phrased — you get "Critical Melee Damage Mod Max",
  not Lucy's full "Increase Critical Melee Damage by 300% of Base Damage".
- Bard instrument modifiers are not applied to song values.
- Focus effects missing from the client's ignore list are still arbitrated, and flagged
  rather than exempted. See above.
- "Item / other" is a residual bucket, not a real source flag — see above.

## Contributing

Bug fixes and features: normal pull request.

Claims about how the game behaves are different — they live in
[`claims.json`](claims.json) with their evidence, and a PR that settles one is usually a
ten-line diff and no code. There is an evidence standard, a parse protocol, and an issue
form for people who would rather not touch JSON. All in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

- [EQEmu/Server](https://github.com/EQEmu/Server) — the stacking algorithm
- [rumstil/eqspellparser](https://github.com/rumstil/eqspellparser) — spell file field layout
- [Lucy](https://lucy.allakhazam.com/) — the reference every EverQuest player already trusts

Not affiliated with or endorsed by Daybreak Game Company. EverQuest is a trademark of
Daybreak Game Company LLC.
