# Does it stack?

A static site that answers what EverQuest's spell file will not tell you plainly: **what
can actually sit on you at the same time, and what is quietly doing nothing.**

It works on anything the game treats as a spell — buffs, disciplines, bard songs,
AA-granted effects, item clickies, procs, auras — because all of them are rows in the same
spell table.

Two views over the same dataset:

| | |
| --- | --- |
| **Compare two** — [`index.html`](web/index.html) | *If I already have buff A, will buff B land, and what happens to A if it does?* The verdict in both casting orders, and the slot-by-slot arbitration behind it. |
| **Whole buff set** — [`set.html`](web/set.html) | *Given everything I expect to be carrying, what is fighting, and what am I paying for twice?* Conflicting pairs, plus effects several buffs share where only one counts. [More below](#a-whole-buff-set). |

![Does it stack? comparing a berserker AA against a shaman epic click](docs/screenshot.png)

## Why not just read Lucy?

[Lucy](https://lucy.allakhazam.com/) will show you both spells, but you still have to do
the arbitration in your head: line up the effect slots, decide which SPAs count, compare
the values, and remember the exceptions. This does that part, and shows its work.

The classic example, and the one this project started from:

- [Savage Spirit XVII](https://lucy.allakhazam.com/spell.html?id=70855&source=Live) (berserker AA) — SPA 496 in **slot 2**
- [Prophet's Gift of the Ruchu](https://lucy.allakhazam.com/spell.html?id=6273&source=Live) (shaman epic) — SPA 496 in **slot 10**

Same effect, different slot index, so they stack — but SPA 496 is a *non-cumulative*
modifier, so only the larger of the two actually applies. Both halves of that answer
matter, and the site says both.

## Where the answers come from

Daybreak is the source of truth. Everything else in this list is a reading of the game
by someone who does not work on it, this project included.

| | Source |
| --- | --- |
| Every spell value — name, class levels, slots, SPA ids, base/limit/max, formulas, durations, mana, targets, stacking groups, descriptions | **The client's own files.** Nothing else. |
| SPA names | **Daybreak's [enumerated SPA list](https://forums.daybreakgames.com/eq/index.php?threads/enumerated-spa-list.206288/)**, kept verbatim at `tools/reference/daybreak-spa-list.txt` |
| Which effects are focus effects | **Daybreak's list**, by its own `Fc_` and `Ff_` prefixes |
| Live stacking groups | **`SpellStackingGroups.txt`**, shipped with the client |
| Field offsets in `spells_us.txt` | [rumstil/eqspellparser](https://github.com/rumstil/eqspellparser) |
| Target type labels | eqspellparser, which is what Lucy's presentation follows |
| Developer remarks on individual SPAs | eqspellparser's source comments — see below |
| Level-scaled values and durations | Local base/max/calc, run through EQEmu's and eqspellparser's formula tables |
| The stacking rules | [EQEmu](https://github.com/EQEmu/Server) — see below |

`tools/spells.mjs` imports nothing but Node built-ins, so no part of the parser consults
any of the third-party sources. `npm run verify:data` proves the result end to end: it
re-reads `spells_us.txt` with a separate parser that keeps its own field offsets and
diffs every spell against the built dataset — 2.5 million values, exiting non-zero on a
single mismatch.

### Where else a developer has spoken

[eqspellparser](https://github.com/rumstil/eqspellparser) is credited above for field offsets,
but it turns out to be something more useful than a format reference. Across 93 commits to
`core/SpellData.cs`, its author has been recording **Daybreak developer statements as source
comments** — nine attributed to Dzarn, some with the forum thread they came from. Those
threads are largely unreachable now; the comments are not.

Two bear on the rules here, and both are recorded in `claims.json`:

> "SPA 416 functions exactly like SPA 1, it was added so that we could avoid stacking
> conflicts with only 12 spell slots."
>
> — Dzarn, [via eqspellparser case 416](https://github.com/rumstil/eqspellparser/blob/master/core/SpellData.cs), May 2014, citing [forum thread 210028](https://forums.daybreakgames.com/eq/index.php?threads/ac-vs-acv2.210028/)

> "For stacking, Base1 is cumulative while Base2 takes the highest value between spells or AAs."
>
> — Dzarn on SPA 219, via eqspellparser case 219, November 2016

The first explains a pattern visible all over the dataset — `AC_2` (416), `Skill Damage Mod 2`
(459), `Skill Min_Damage Amt 2` (418), `Contact Ability 2` (419) are duplicate effects that
exist to dodge slot conflicts. The second is a developer describing cumulative and
highest-wins behaviour sitting side by side in one effect, taken per bucket.

Both are rated **below primary**: they reach us through a third party's transcription rather
than from the posts themselves, and the first presupposes the slot rule rather than stating
it. Anyone who can read those threads and confirm the wording would raise both.

**What eqspellparser does not do is back the unverified non-cumulative SPAs.** It carries
no stacking comment for 185, 186, 482 or 505; for 503 its author wrote "similar to 185 but
with rear arc? stacking?" — his own question mark. A careful parser declining to make the
claim is worth knowing about.

### The one rule Daybreak has stated

`slot-arbitration` — that the same SPA in *different* slots does not conflict — is
`confirmed`, and not from the emulator. Daybreak said it themselves while reworking spell
critical damage:

> "All modifiers stack (assuming they are in different slots)."
>
> — [July Patch Cliff Notes](https://www.everquest.com/news/july-patch-cliff-notes), 23 July 2015

Their patch practice matches it: the [11 February 2026 update notes](https://www.everquest.com/update-notes/eq-update-notes-2-11-26) fix conflicts by
moving effects between slot indexes — *"Moved the Strength debuff in the Grip of Mori DoT
line from slot 2 to slot 5 to avoid stacking conflicts."*

That claim used to be one sentence covering two rules, and the second half — that a spell
weaker on any shared slot is refused outright — has no such statement behind it. One
primary source would have promoted both, so it is now a separate `slot-strength` claim
that stays `unverified`. A verdict of "no conflict" cites the confirmed rule; a refusal
cites the unverified one.

### Why the rules are the weak part

The stacking algorithm is ported from EQEmu, and that is the least well-sourced thing
here. EQEmu is a volunteer reimplementation targeting the 2013 RoF2 client. It is the
most complete public account of these rules and the reason this project could be written
at all — but it is someone's reading of the game, and this repo has already found four
places where it diverges from live:

- Its `EFFECT_COUNT` caps at twelve slots. Live spells run to 67, and reading only the
  first twelve changed thousands of verdicts.
- Its stacking ignore list omits focus effects that do stack, and its tail past RoF2 is
  self-described as guesswork.
- Its non-cumulative SPA handling was committed with no source cited, and six of those
  seven claims still have nothing behind them.
- Its `IsFocusEffect` mapping is right where a name-based reading of Daybreak's own SPA
  list would have been wrong — a reminder it cuts both ways.

So `implementation` evidence can never be rated above `supporting`. It corroborates; it
never settles. **Every rule the engine applies is registered in
[`claims.json`](claims.json) with its provenance, most of them `unverified`**, and a
verdict shows where the rule that decided it came from. That is the honest position, not
a gap to paper over — and it is what makes the rules correctable by anyone who knows
better.

```bash
npm run claims       # every claim and its derived status
npm run verify       # re-runs the machine-checkable evidence against your spell files
npm run verify:data  # re-parses the spell file and diffs it against the built dataset
```

### Notes, and why they are blocks

A claim carries its own evidence. Background that applies to a *family* of claims —
how the bonus buckets work, what a mount does to a movement buff — lives in
`notes`, and the site shows it under the evidence it qualifies.

`notes.bonus_buckets` was one paragraph of two thousand characters, which is a wall,
and a wall is where a reader stops — which defeats the point of showing the evidence
at all. It is now `lead` plus `blocks`, each block a `title`, a `body` and/or a
`quote`, its `source` and `url`, and a `caveat`: what that source does **not**
establish. The caveats are the least quotable sentences in the note and the ones this
project cannot do without, so they get their own line, their own marker, and a test
that fails if one goes missing. A quotation without a `source` is rejected. A note may
still be a plain string, and `notes.movement_and_mounts` is one.

## How the rules work

EverQuest arbitrates buffs slot by slot: two spells conflict only where the **same** SPA
sits in the **same** slot index. When they do conflict, the incoming spell has to be at
least as strong on *every* shared slot or it is refused outright.

**Slot counts run to 100.** Twelve is a RoF2-era limit that EQEmu still carries as
`EFFECT_COUNT`, and live spells long outgrew it — Aria of Kenburk Rk. III has 22, 2,612
spells in the current file have more than twelve, and the longest has 67. The engine and
the slot table impose no ceiling of their own. Since no live spell reaches 100 yet, the
top of the range is covered by fixtures built at the full hundred rather than left to
chance.

On top of that sit the special cases:

| Rule | Effect |
| --- | --- |
| Live stacking groups | Two spells in one `SpellStackingGroups.txt` group never coexist; rank decides which wins |
| Focus effects | Exempt from slot arbitration — they stack regardless of slot |
| Ignore list | 84 further SPAs (counters, vision, limits…) never cause a conflict |
| SPA 148 / 149 | Explicit block and overwrite commands carried by the spell itself |
| Blank slots | SPA 254, and SPA 10 spacers with base 0, are invisible to arbitration. 344 of the 91,257 SPA 10 slots carry a real charisma value and are not spacers |
| Bard songs | A song and a non-song beneficial spell always stack |
| Negative AC | AC debuffs skip arbitration, so things like Sun's Corona and Glacier Breath coexist |
| Snare vs. run speed | A snare already in place refuses a movement buff |
| DoT vs. regen | A DoT will not overwrite regen, but does block a regen spell landing after it |
| Complete Heal | Never stacks or overwrites, ever |
| Group vs. single | The single-target version of a line will not replace the group version |

The engine in [`web/engine.js`](web/engine.js) is a port of `Mob::CheckStackConflict`
from EQEmu (`zone/spells.cpp`). Server-side inputs that spell data alone cannot know —
existing spell bonuses, Screech and buff-stacker state, resurrection sickness, NPC DoT
ownership — are left out; every rule that made it in is commented with the case it came
from.

### Focus effects

Focus effects — the ones that modify a spell you cast rather than doing something
themselves — behave differently from ordinary buffs in two ways. Both were reported by
Sancus after the project went up, and both are recorded in `claims.json`.

**They stack regardless of slot.** Daybreak's list names 81 SPAs with an `Fc_` or `Ff_`
prefix, so which effects are focus effects is published rather than inferred. The engine
exempts all of them from slot arbitration.

**Only the best one applies.** When several foci could affect the same cast, the game
uses the largest rather than adding them. So two focus buffs can stack and still not
give you both benefits, and the tool says so. The exceptions are the proc-type foci —
**339 Fc_CastProc** and **383 Fc_CastProcNormalized** — which fire independently and can
all land on one cast.

That pair is the answer to "twincast doesn't stack". Two twincast buffs *do* both hold;
what does not double is the effect. The buffs stack, the focus is best-only, and
conflating those two is what makes the mechanic confusing.

Both claims are `corroborated`: a named practitioner reporting first-hand, with
Daybreak's own naming and EQEmu's implementation agreeing. That is enough for the engine
to act on, and it does — the verdicts changed when the evidence did. They are not
`confirmed`, which is reserved for Daybreak stating the behaviour or a parse measuring
it, so the site attributes rather than asserts.

### Non-cumulative effects

A handful of SPAs land on you together but are not added together; the game keeps the
larger value. The tool warns when a stacking pair shares one, and shows the evidence
behind the warning — because the evidence differs sharply between them.

Eleven are claimed. Ten were identified from `zone/bonuses.cpp` in EQEmu, where they keep
the larger magnitude instead of the `+=` an ordinary bonus uses: **11** Melee Speed, **98** Bard
Haste, **119** Overhaste, **185** Skill Damage Mod 1, **186** Min Damage Done Mod, **459**
Skill Damage Mod 2, **482** Skill Base Damage Mod, **496** Critical Melee Damage Mod Max,
**503** Melee Damage Position Mod, **505** Damage Taken Position Mod. The eleventh, **3** Movement Rate, comes from the other direction — see
below.

The three haste effects were missed on the first pass. Haste is accumulated in a different
switch from the damage modifiers, so a reader following the effects that produced the rest
of the list never reaches it — and a raid set with four haste buffs in it reported that
nothing doubled up. They are also the clearest illustration of the bucket structure, and a
warning against reading the list as one pool: each keeps only its own largest value, but
the three accumulate into separate fields that **do** add to each other. EQEmu's own
comments call SPA 98 *"Stacks with V1 but does not Overcap"* and SPA 119 *"Stacks and
Overcaps"*. Two spell hastes do not add; a spell haste and a bard haste do — which is why
overlaps are reported per SPA and never merged across them.

**Movement speed is the one the sources disagree about**, and it is the project's only
`disputed` claim. It is reported from play that run buffs do not add — Selo's Accelerating
Canto and Flight of Eagles sit in different slots, both hold, and having both is no faster
than the better one. EQEmu does the opposite: it adds (`newbon->movementspeed +=
base_value`) and leaves *"should we let these stack?"* beside a commented-out highest-wins
alternative, so the emulator is openly unsure of itself.

Rather than pick a side, the site raises the overlap and says the sources conflict. A
`disputed` claim is not a weaker `unverified` one, and the wording distinguishes them —
"unverified" means the claim rests on EQEmu alone, which would be exactly backwards here.

**Mounts are an exception that cannot be modelled.** A mount overrides a player's movement
buff outright rather than the larger winning: Spirit of Wolf is overwritten by Knight's
Holy Steed whatever the values. That is not in the spell file — Holy Steed carries only SPA
113 (SummonMount) and no SPA 3 at all, so a mount's speed does not exist as a spell effect.
Compare a run buff against a mount here and you will be told they share no effect, which is
true of the data and false of the game. Recorded in `claims.json` under
`notes.movement_and_mounts`.

**Only 496 has a primary source**, and it is not EQEmu — it is Daybreak. Of all 70,963
spells, exactly 53 descriptions contain the word "non-cumulative", and every one of them
carries SPA 496; none says it without. EQEmu independently agrees, which corroborates
but does not establish.

The other nine rest on uncited emulator code. 185/186/459 came from a 2016 mackal commit
whose message body is empty; 503/505 from KayenEQ's PR #1454 and 482 from #1474, each
asserting the behaviour with no source given, and the three haste effects on the same
footing. The site marks those nine unverified and
says so in the warning.

Two caveats apply to all seven:

- The value that applies wins **within one bonus bucket**. Spell, AA and worn-item bonuses are
  summed at use time, so a worn item effect and a buff can still add. Two buffs — the
  case this tool compares — are both in the spell bucket.
- 185, 459, 482, 503 and 505 are additive when they arrive as a worn item bonus rather
  than as a buff.

### Which value applies

Not "the larger". EQEmu keeps the value **furthest from zero on the side of zero it is
already on** — among positives the largest, among negatives the most negative:

```cpp
if (v < 0 && cur > v) cur = v;        // among negatives, the most negative
else if (v > 0 && cur < v) cur = v;   // among positives, the largest
```

the same shape in all seven damage-mod cases, and in the three haste cases once the 100
is taken off (haste is stored as a percentage of normal speed, so 168 is a 68% bonus and
90 is a 10% slow). The difference is not academic: **505 is negative in all 22 of its
slots** in the current file and **3 in 1,297 of its 1,515**, so reading it as "the larger"
would name the weaker effect the winner on both.

Two values on **opposite sides of zero** name nobody — with one exception. They normally
never displace each other on their own terms, so which one is left standing depends on the
order the server applied them in, and that is not something this tool can know.

**Haste is the exception.** A slow is not a small haste: while any slow is applied no haste
applies at all, so a negative value takes the slot outright however small it is. Reported
from play by Matrim, and EQEmu does the same twice over — it refuses a haste while the
bonus is already negative (`if (new_bonus->haste < 0) break;`) and returns from its haste
calculation before item, SPA 98 or SPA 119 haste are added, under the comment
`// slow beats all! Besides a better inhibit`.

### Bonus buckets

Slot arbitration is over once both spells have landed. What happens to the numbers after
that is a different question, and the claims answering it are typed `bonus_bucket`:

| | |
| --- | --- |
| `slow-cancels-haste` | **corroborated** — a slow removes haste entirely rather than netting off against it |
| `haste-types-add` | **confirmed** — SPA 119 is overhaste, a separate bucket that adds on top of the SPA 11 melee haste; within either, the highest applies. Battlecry of the Vah Shir says "cumulative with most other effects that increase attack speed", and of the 152 spells whose description uses the word *overhaste*, all 152 carry SPA 119 and none carries SPA 371 |

SPA 371 is Daybreak's `Slow` — a second slow mechanism, separate from a negative SPA 11,
which EQEmu keeps in its own `inhibitmelee` field. Two of them do not add and the deepest
applies (`non-cumulative/371`, **corroborated**). What a 371 does *against* a SPA 11 haste
is not modelled: EQEmu subtracts it from a positive haste rather than replacing it, and
that is a cross-SPA interaction, where everything in this tool is deliberately per-SPA and
never merged.

Both read as "Decrease Melee Haste by n%" on the page, because that is what they are. The
`(v371, Incremental)` marker is the only thing on the row that tells the two apart, so it
is kept exactly as eqspellparser and raidloot print it.

Values are compared at the caster levels you asked about, so which one applies can change
when you change the level. Ties mark neither side as losing out.

### How firmly it is said

The value that applies is named whatever the evidence, because it is not a second claim —
every `non_cumulative` claim in `claims.json` already asserts which value applies, and
withholding it left the tool declining to answer a question its own claim had answered.
What the evidence changes is how firmly it is drawn:

| | |
| --- | --- |
| **Confirmed** (496 only) | marked solid, and the tooltip adds nothing |
| **Corroborated** | marked faintly; the tooltip says it rests on corroboration, not a settled source |
| **Unverified** (the nine) | marked faintly; the tooltip says the claim rests on EQEmu's bonus accumulation, which nothing in that project backs up |
| **Disputed** (3 only) | marked faintly; the tooltip says the sources disagree, and that the mark follows the practitioner reading rather than EQEmu, which adds them |

Status is derived from evidence, not written by hand, so **adding a primary source removes
the hedging on the next build with no code change**. If you can settle one of the nine,
see [CONTRIBUTING.md](CONTRIBUTING.md) — the parse protocol is there.

## A whole buff set

The pair view answers "do these two stack". [`set.html`](web/set.html) answers the raid
question instead: given everything you expect to be carrying, **which of them cannot be up
at once, and which effects are several buffs paying for where only one counts.**

This scales without new mechanics because the game itself works pairwise — an incoming
spell is checked against each buff already on you, one at a time. So a set holds exactly
when every pair is mutually independent; there is no three-way interaction to model.
`analyzeSet()` is a loop over `checkStack`, and it is cheap: a 40-buff set is **8 ms**, 120
buffs is 86 ms, in the browser.

Two things come out of it:

- **Conflicts** — the pairs that cannot both be up, with the reason in each casting order.
  Which one you keep depends on cast order, so it names the pair rather than choosing.
- **Shared effects** — grouped by SPA across the whole set, which is the part a pair view
  cannot show. Eight disciplines each carrying Skill Damage Mod 1 is a fact about the set,
  not about any pair inside it. Non-cumulative effects use the same green / struck-through
  / orange language as the slot table. Best-only foci list their **limiters**, because two
  foci of the same type do not compete if they apply to different spells — and deciding
  that needs per-cast context this tool does not have, so it shows them and leaves the
  judgement to you.

### Sets that ship with the site

[`web/presets.js`](web/presets.js) carries buff sets built into the page, so someone
arriving with no idea what to type has something real to look at. **Common level 130
buffs** is the shipped one — 23 effects a level 130 character typically has on in a raid.

A preset behaves like a saved set once loaded: change it and you are offered the way back.
Saving over its name keeps a **personal copy that takes precedence for you** and leaves
the built-in set alone for everyone else.

Spell ids are stable for a given spell, but a buff line gets new ids as new ranks ship, so
a preset decays as the game moves on. The build checks every preset id against the dataset
and names the ones that no longer resolve — otherwise the failure mode is a set that
quietly shrinks and nobody notices.

### Saving a set

A raid set is worth building once. Name it and it is kept in **that browser**, so you can
load it back, pile a few things on to see what they cost, and put it back the way it was —
the page tells you when the live set has drifted from the one you loaded, and offers both
**Revert** and **Update**.

A reordered set is not "changed": the ids carry insertion order, which is a display
detail, so comparison is order-insensitive rather than crying wolf.

Saved sets never leave the browser they were made in — no account, no server. The **URL
already carries the whole set**, so that stays the way to move one between machines or send
it to someone. Storage that is blocked or full is reported rather than silently losing a
set, and a browser that refuses it entirely still leaves the link in the address bar.

### Why it will not rank sets

Because it cannot do so honestly. A damage figure needs a model of how these values
combine — the spell, AA and worn bonus buckets, which effects add and which keep only the
larger, which focus wins a cast. Nine of the ten non-cumulative claims here are
`unverified` and the focus rule is `corroborated` rather than `confirmed`; a score built on
that would look far more authoritative than its evidence. Burn output also depends on gear,
AAs, recast timers and the encounter, none of which is in the spell file — that is a
simulator, not a stacking checker. A test asserts `analyzeSet` returns no score.

## Two ways to read a slot

The slot table reads effects out in plain wording, because "Limit Resist: Fire" is what
somebody came here to find out and `Ff_ResistType` is not:

| What the file says | What the table shows |
| --- | --- |
| `Ff_ResistType` · SPA 135 · base 2 | Limit Resist: Fire |
| `Ff_TargetType` · SPA 136 · base -2 | Limit Target: Exclude Caster AE |
| `Ff_LevelMax` · SPA 134 · base 130 / 5 | Limit Max Level: 130 (lose 5% per level) |
| `Fc_Damage_%` · SPA 124 · base 33 | Increase Spell Damage by 33% |
| `StackingBlocker` · SPA 148 | Block new spell if slot 2 is 'AC' and < 500 |

**Show hidden rows** brings back what the slot table leaves out. Only one thing qualifies
today — the client's spacer slots, SPA 10 with base 0 and calc 100, of which there are
90,871 in the file and nine in a single shaman epic click. The switch is named for the
general case so anything else omitted later lands under it.

Nothing is dropped silently: the table says how many rows it left out and offers to show
them, because slot numbers jump when rows disappear and a reader should be told why. A row
is only dropped when **both** spells are empty at that index — a spacer opposite a real
effect keeps its row, with the cell dashed like an absent slot.

**An effect is never renamed.** Whichever reading is on, the name shown is the effect's own
— `CHA` in the exact reading, its phrasing in the other. An earlier version substituted the
words "empty slot" for the name, which was wrong in both and especially so in the exact
reading, whose whole purpose is to show what the file says.

The rule is deliberately not "the value is zero". **39.5% of slots compute to zero**,
including all 1,448 `StackingBlocker` slots, which are the single most informative rows in
the table. There is a separate `isEmptySlot` for the display rather than reusing the
engine's `isBlankSlot`, which counts 148 and 149 as blank because they take no part in
arbitration — a different question with a very different answer.

**SPA names** on either page switches back to the left-hand column. That matters more than
it sounds: the phrasing is ported from
[rumstil/eqspellparser](https://github.com/rumstil/eqspellparser), Apache 2.0, and is a
**third-party reading** — the same standing as the target-type labels. Quoting a slot in a
bug report or a claim is exactly when you want the file's own words and not an
interpretation of them, so the exact view is one click away and the choice is remembered in
your browser.

Nothing is hidden by the default: the raw `SPA n · base x · value y` line is printed under
the name in both readings.

**215 effects have a phrasing, covering 93% of the slots in the current spell file**, and
the build prints that figure so it cannot rot unnoticed. Where there is no phrasing the
slot keeps its exact name and is marked **as-is** — never a guess.

To see what is left:

```bash
node tools/phrasing_todo.mjs                              # worst first
node tools/phrasing_todo.mjs --eqsp ../eqspellparser      # with the line to port
node tools/phrasing_todo.mjs --json
```

221 effects still read as-is, and **215 of them have an eqspellparser line to port**, so
most entries are a one-line job. The tail is shallow: the four biggest reach 95% coverage,
nineteen reach 97%, sixty-one reach 99%, and 105 of the 221 appear in fewer than 20 slots in
the entire file. Adding one is a `case` in [`web/phrasing.js`](web/phrasing.js) — return
`null` rather than guessing if the effect is not understood.

Two deliberate details: effect references resolve through **Daybreak's** SPA names rather
than eqspellparser's own enum, so the two readings never disagree about what an effect is
called; and in the exact reading a repeated limiter collapses to `TargetType ×5`, while
in plain wording it does not, because there each one says something different.

### A phrasing that names another spell

`Cast: [Spell 6097] on Fade` is eqspellparser's line and it is what the ported `case`
returns. The page then resolves the id: the row reads **Cast: Savage Spirit Penance on
Fade**, the name is a button, and clicking it opens that spell's effects underneath the
row rather than replacing what you were comparing. It nests three deep, which is enough
for a proc that fires a spell that has a recourse of its own.

An id that is not in your spell file is left exactly as written and is not offered as a
link — 980 of the 17,485 references in the current file point at spells that are no longer
in it. Only the plain wording does this; the exact reading prints `base 6097` untouched,
because that reading exists to be quoted.

### Ported means ported

A `case` here is a translation of eqspellparser's line, not a paraphrase of the SPA name.
Several were written the second way and were simply wrong — SPA 147 read `Heal to -25% of
Max HP` for an effect that takes a quarter of your health, 162 and 163 had swapped jobs,
191 was labelled `Silence` for an effect that inhibits melee, and 501 had the sign and the
units of a cast-time change both wrong. Nothing compared the two files, so nothing said so.

```bash
node tools/phrasing_audit.mjs --eqsp ../eqspellparser          # lines that disagree
node tools/phrasing_audit.mjs --eqsp ../eqspellparser --all    # and lines that say less
```

**MISMATCH** means the labels disagree, and is almost always a defect. **THINNER** means
the label matches but the source says more — a cap, a PvP figure, a `(v507)` marker — which
is information dropped rather than a mistake; 56 lines are in that state. A divergence is
allowed, but the comment above the `case` has to contain the words *deliberate divergence*
and then say why, which is what exempts it from the audit. Two do: SPA 10, where
eqspellparser hides every charisma debuff along with the padding, and SPA 101, where it
prints a historical figure that is not in the slot.

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
| **Discipline** | flagged as a combat skill in the spell file |
| **Song** | usable by bards, not a combat skill |
| **AA** | granted by an alternate ability — the class level reads 254 |
| **Item** | an item casts it — click, proc, worn, focus, bard, mount, blessing or familiar |
| **Aura** | applied by an aura you stand in — see below |
| **Triggered** | fired by another spell as a proc, recourse or side effect |
| **NPC** | flagged castable by NPCs only, and no known item grants it |
| **Unattributed** | nothing explains it — see below |

**Source is one label, but the item tag is not.** A spell can be scribed *and* sit on a
clicky; an AA effect can also be a proc; *Steelskin* is a click on some items and a proc
on others. So items show as extra tags beside the source badge, never instead of it —
676 scribed spells, 32 AAs and 25 songs carry one.

### Disciplines the level table forgot

A combat skill only reached the **Discipline** label through the scribed check — "a class
learns this at a normal level". **120 rows** carry the file's combat-skill flag but no class
level at all, so they fell past every check into the residual, and the site called something
the file plainly labels a discipline *Unattributed*. Among them: *Berserking Discipline*,
*Concentration Discipline*, *Final Stand Discipline Rk. III*.

The flag is now a last resort before the residual — below every other check, so a
discipline that something else already explains keeps that explanation. Disbelieving the
file about what a row *is* was the bug; the flag is as much a fact as the level table.

It does **not** invent class levels. Those 120 still carry none, so a class filter will not
surface them — the file does not say who gets them, and guessing from a same-named sibling
would be name-matching, which this project has already rejected once for item mapping.

Two unrelated lines can also share a name. *Berserking Discipline* exists twice: **10923–5**
with BER 75, and **14189–91** with no levels and a different recast timer. Both are real
rows in the file, both now read as disciplines, and a search shows all six.

### Auras

An aura effect is what a raid actually stands in, and both halves of it were being lost.

**Duration formula 51 has no tick count.** The effect holds for as long as the aura
applying it holds, so the file gives no number — read naively that is "instant", and all
**601** of them were hidden behind *Only effects with a duration*. They now report as
lasting, and the card reads **"while the aura holds"** rather than inventing a figure.
Deliberately not folded into formula 50: claiming 72000 ticks would be a duration the file
does not give.

**Nothing linked an aura to its effect.** `Spawn Interactive Object` (SPA 351) carries the
applied spell in its **`max`** field, where every other reference SPA uses a base field, so
the reference table missed it. *Aura of Kenburk Effect* had no class levels of its own and
nothing explained it, which left it unattributed and unreachable from a bard search. It is
now linked, borrows BRD 130 from the song that spawns it, and carries its own **Aura**
source label — above *Triggered* in the classification, because "triggered" is a bucket
nobody browses and these are effects people deliberately go and stand in.

### Where item tags come from

**The client's spell files do not record which item grants an effect.** Items live
server-side; nothing in `spells_us.txt` links a clicky to its item. Every other fact on
this site is read from your own client files — this one cannot be, so it comes from the
[SoDeq item database](https://items.sodeq.org/), a community dump built by players
running an item collector.

That buys 10,675 spells tagged with the item that casts them, and lets the site tell
apart three things the old **Item / other** bucket ran together:

- **Item** — an item demonstrably casts it. 9,686 rows.
- **NPC** — flagged NPC-only *and* no item grants it. The item data corrected 249 of
  these, about 28% of the old bucket, that a player can in fact click off an item.
- **Unattributed** — no class learns it, nothing in the file triggers it, no item casts
  it. 17,656 rows. Unexplained rather than absent: the item data lags new content, so
  recent effects land here for a while.

The dump is regenerated daily but updates when a player submits a find, not when
Daybreak patches, so the newest tier is the part most likely to be missing. The footer
names the date and the page says so once the lag gets long. `npm run fetch` pulls it;
the build never touches the network, and without the file it simply produces no tags.

**Lucy's item dump is not part of this.** Its `itemlist.txt.gz` is `id,name,lucylink` —
no click, proc, worn or focus columns — and the third field is the item id templated
into a URL, identical on all 134,079 rows, so the item links here are built rather than
looked up. Matching spell names against item names does not substitute: 3.1% hit rate,
skewed to `Spell: <name>` scrolls, which *teach* a spell rather than cast it.

**The client's spell files do not record which item grants an effect.** Items live
server-side; nothing in `spells_us.txt` links a clicky to its item. So this bucket is a
## Data files

Every spell value comes from the four files that ship with the live client:

```
spells_us.txt                      the spell table itself (166 caret-delimited fields)
spells_us_str.txt                  cast / land / fade messages
dbstr_us.txt                       descriptions, categories, stacking group names
Resources/SpellStackingGroups.txt  spell → stacking group, rank, type
```

One thing is not in them, because it is not in the client at all:

```
vendor/items.txt                   which item casts which spell — items.sodeq.org
```

Optional, gitignored, and fetched by `npm run fetch` rather than by the build. Its 315
columns are read **by name**, so the collector adding or reordering columns cannot shift
the data underneath us; a *renamed* column is a hard build failure rather than silently
wrong tags. Only spells present in the current spell file get tagged, which is what makes
stale item data produce fewer tags instead of tags pointing nowhere.

Nothing is scraped.

### Links off this site

Every result links out, and none of those links is a source. Spell values come from
your own client files; item tags come from SoDeq. What the links are for is checking
this page against somebody else's reading of the same data — which is only worth
offering if the page says how good each reading is.

| | Link | What it is |
|---|---|---|
| **Raidloot** | `spells?name=<id>` | Another port of eqspellparser, so it phrases effects the way this page does, and it resolves a referenced spell to its name. Its own copy of the spell file, refreshed on its own schedule. |
| **Lucy** | `spell.html?id=<id>` | The reference every EverQuest player knows. Its **Raw Data** tab is a second, independent naming of all 166 fields, which is worth having. But its live copy lags — it was eight months behind this build when last checked — and it renders SPA 496 as `Unknown #496`, the one effect here with a `confirmed` claim. |
| **changes** | `spellhistory.html?id=<id>` | Lucy's history of a spell. The only public record of *when* something changed; nothing in the client files carries it. |
| **item names** | `items.sodeq.org/item.php?id=<id>` | Where the tag came from. The page names who submitted the item and when it was last verified — the same staleness question the footer raises about the dump as a whole. |

Each carries that caveat on hover rather than in a footnote, because a link that
quietly points at old data is worse than no link. All four are templated from an id,
so none of them costs a request or a download.

Item links used to go to Lucy, which supplies none of the item data, and the README
used to say Lucy let you "check the source" — a claim this project could not back.

SPA names are Daybreak's own, which they were not until recently: of the 420 SPAs the
spell file uses, **282 were being displayed under an EQEmu enum identifier no player
would recognise** — `CurrentHP` for HP, `WeaponProc` for Contact Ability,
`SympatheticProc` for Fc_CastProcNormalized. The published list is stored verbatim,
underscores and all, because tidying it would make the label a second-hand reading of a
primary source.

The list stops at 528 and the spell file already uses 529 and 531, so newer SPAs fall
back to EQEmu's naming and then to their bare number. Target type labels are still
third-party naming, and one of those was wrong until a reader's spell dump caught it:
EQEmu calls target type 3 `ST_GroupTeleport`, which reads as a port spell, where it is
the target type on ordinary group buffs and everyone else calls it Caster Group.

### Freshness

**It depends on who built the copy you are looking at.** Build it yourself and it is
exactly as current as your last patch. Visit a hosted copy and you get whatever spell
file its publisher had at deploy time — the footer names that date, and the page warns
after about a patch cycle and again once the data is several patches old. Rebuild and
redeploy after each patch day, or the answers go quietly out of date.

The date shown is the modification time of `spells_us.txt`, which the file itself does
not carry a version for. Copying the file around can reset it.

Item data ages on its own clock and the footer stamps it separately. The dump carries a
per-row timestamp, so its age is the newest row in it rather than when it was downloaded
— a re-fetch that changes nothing does not make it look fresher than it is.

## Build and run

Node 20+ is the only prerequisite — no dependencies to install.

```bash
npm run fetch                 # item database — downloads only if it changed (~8 MB)
npm run build                 # auto-detects the usual Windows install paths
node tools/build.mjs --eq-dir "C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest"

npm run serve                 # builds, then serves dist/ on http://localhost:8000
```

The build writes `dist/`:

```
dist/index.html, app.js, engine.js, spa.js, freshness.js, style.css
dist/data/meta.json          SPA names, ignore list, claims, build stamp
dist/data/index.json         one small row per spell — feeds the search box (~775 KB gzipped)
dist/data/spells/NN.json     full records, sharded by id; only the two you pick get fetched
dist/data/desc/NN.json       descriptions with their #1/%z template tokens resolved
```

`dist/` is deliberately not committed. Re-run the build after each patch day.

`npm run fetch` is the only command that touches the network, and it is separate from the
build on purpose: `npm run build` is offline and deterministic, so CI never depends on a
third party being up and two builds from the same inputs produce the same `dist/`. The
fetch sends `If-None-Match` / `If-Modified-Since`, so an unchanged dump costs one request
instead of 8 MB. It is safe to skip — the build says so and carries on without tags.

### Tests

```bash
npm test
```

Two layers. `tests/engine.fixtures.test.mjs`, `tests/claims.test.mjs` and
`tests/freshness.test.mjs` run on a bare clone with no EverQuest install — hand-built
fixtures covering slot arbitration up to the full 100 slots, SPA 148 blocking, stacking
groups, focus behaviour, the snare and bard rules, plus the claims schema. That is what
CI runs, on Linux and Windows.

`tests/engine.test.mjs` needs a built dataset and skips itself without one — or when
`dist/` is stale, which it detects rather than failing cryptically. It pins the engine
against real spells and cross-checks one against a third-party dump of it, so it doubles
as a check that the field offsets still line up with the current file format.

### Discoverability

Both pages carry a canonical link, Open Graph and Twitter card tags, a 1200×630 share
card, and `WebApplication` structured data, plus a `robots.txt` and a `sitemap.xml`.

The address in all of those is a **`{{SITE_URL}}` placeholder** filled in at build time from
the git remote — a fork should not advertise this repo's URL as its own. With no remote to
derive one from, the lines that need it are dropped and the sitemap is skipped, because a
canonical link pointing at somebody else's site is worse than none. `--site-url` overrides
it for a custom domain.

**What this cannot do:** the spell data is fetched as JSON after the page loads, so a
crawler indexes the shell, not 70,963 spells. Searches for a specific spell name will not
find this site. Closing that would mean pre-rendering a static page per spell, which is a
different project — and pairs are not an option at all, since 70,963 spells is 2.5 billion
of them.

### Publishing

```bash
tools/deploy_pages.sh                                        # macOS / Linux / Git Bash
powershell -ExecutionPolicy Bypass -File tools\deploy_pages.ps1   # Windows
```

Either script builds, then force-pushes `dist/` as an orphan `gh-pages` commit, which
keeps fifty-odd megabytes of regenerated JSON out of the repo's history.

## Layout

```
claims.json                        what this project claims about the game, and the evidence
CONTRIBUTING.md                    the evidence standard and the parse protocol
AGENTS.md                          the same constraints, short, for AI coding agents
tools/reference/                   primary sources, kept verbatim (Daybreak's SPA list)
tools/spells.mjs                   spell file parser, formulas, description tokens,
                                   source classification, spell-reference graph
tools/spa_names.mjs                SPA names and the focus set, from Daybreak's list
tools/build.mjs                    dataset + site build
tools/claims.mjs                   claims loader, validator, status derivation
tools/verify_claims.mjs            re-runs machine-checkable evidence
tools/verify_dataset.mjs           diffs the built dataset against the spell file
tools/gen_spa_js.mjs               generates web/spa.js from repo files (no game needed)
tools/gen_spa_meta.mjs             regenerates spa_meta.json from an EQEmu checkout
tools/spa_meta.json                stacking ignore list and focus lists, from EQEmu
tools/items.mjs                    item → spell relationships, parsed by column name
tools/fetch_items.mjs              the only thing here that touches the network
tools/serve.mjs                    dependency-free static server for dist/
web/engine.js                      the stacking rules, pair and set
web/data.js                        loading and searching the dataset, shared by both pages
web/app.js                         the pair view
web/set.js                         the set view — conflicts and shared effects
web/saved.js                       named sets in browser storage, pure and testable
web/presets.js                     buff sets that ship with the site
web/phrasing.js                    the plain-wording reading of a slot, ported from eqspellparser
web/enums.js                       its lookup tables (Apache 2.0, see LICENSE-eqspellparser.txt)
web/freshness.js                   how stale the shipped data is
web/og.png                         1200x630 share card
web/robots.txt, web/sitemap.xml    crawl metadata, address filled in at build time
tests/                             node:test — fixtures and claims run anywhere
```

## Known gaps

- Caster level is a single input applied to both spells; the game tracks it per buff.
  It defaults to 130, the live cap — raise `MAX_PLAYER_LEVEL` in `tools/spells.mjs` on
  the expansion that raises it, and everything else follows from there.
- Eight of the twelve non-cumulative SPAs rest on uncited EQEmu implementation rather
  than any primary source. See above, and `claims.json` for each one.
- Most stacking rules are `unverified` for the same reason. The biggest remaining one is
  `slot-strength` — that an incoming spell must be at least as strong on **every** shared
  slot or be refused outright. Daybreak has stated the slot-index half (see below) but
  not this, and settling it would be the single most valuable contribution here.
- SPA 371 (`Slow`) against SPA 11 haste is not modelled. Two 371s are — the deepest slow
  applies — but 371 versus a haste is a cross-SPA question, and nothing here merges across
  SPAs. EQEmu treats 371 as a separate `inhibitmelee` bucket that subtracts from a positive
  SPA 11 haste rather than replacing it.
- Plain wording covers 93.4% of the slots in the current file. The 221 effects without it
  read as the name in the spell file and are marked **as-is**; `tools/phrasing_todo.mjs`
  lists them worst-first.
- **Unattributed** is still a residual — 17,656 rows nothing explains. The item
  database shrank the old "Item / other" bucket by a third; the rest is genuinely
  unaccounted for, and calling it "probably a clicky" would be a guess.
- Item tags depend on a community dump that lags new content by weeks and is the only
  data here not read from the client's own files.
- Formula 123 (random range) is evaluated at its midpoint.
- Bard instrument modifiers are not applied to song values.
- SPAs past 528 have no published name and fall back to EQEmu's or their number.

## Contributing

Bug fixes and features: normal pull request.

Claims about how the game behaves are different — they live in
[`claims.json`](claims.json) with their evidence, and a PR that settles one is usually a
ten-line diff and no code.

**You do not need to touch git for that.** Every claim the site hedges on links to an
[evidence form](https://github.com/fadwen/doesitstack/issues/new?template=mechanic-evidence.yml&labels=evidence),
prefilled with the claim you were looking at; it asks what you know and where it came
from. Someone else turns it into a PR and credits you. The evidence standard and the
parse protocol are in [CONTRIBUTING.md](CONTRIBUTING.md) for anyone who wants them.

## Credits

- **[SoDeq](https://items.sodeq.org/)** — the item database behind every item tag, and
  the item collector contributors who keep it current. Code copyright Kyle Smith.
- **Daybreak Game Company** — the client files everything here is read from, and the
  published SPA list that names it
- **Sancus** — focus effect behaviour, the slot-count limit, and the SPA list
- [EQEmu/Server](https://github.com/EQEmu/Server) — the stacking algorithm this engine is
  ported from. Corroborating, not authoritative
- [rumstil/eqspellparser](https://github.com/rumstil/eqspellparser) — spell file field layout,
  the target type labels players actually use, the plain-wording slot descriptions ported
  here under Apache 2.0 (see [LICENSE-eqspellparser.txt](LICENSE-eqspellparser.txt)), and a
  decade of recorded developer statements about individual SPAs that would otherwise be lost
  with the forum threads they came from
- [Raidloot](https://www.raidloot.com/) — a second reading of the spell file to check this
  one against, and the one linked first
- [Lucy](https://lucy.allakhazam.com/) — the reference every EverQuest player already
  knows, and the spell history no client file records

Not affiliated with or endorsed by Daybreak Game Company. EverQuest is a trademark of
Daybreak Game Company LLC.
