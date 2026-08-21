# Contributing

Two kinds of change land here, and they work differently.

**Code** — parser, engine, UI, build. Normal pull request. `npm test` has to pass.

**Claims** — the statements this site makes about how EverQuest behaves. Those live in
[`claims.json`](claims.json), each with the evidence behind it, and a PR that adds
evidence is usually a ten-line diff and no code at all.

The rest of this document is about the second kind, because that is the one with a
standard attached.

---

## Why claims are a separate thing

The site tells people that two buffs stack. Sometimes it also tells them the numbers do
not add up, because the effect is non-cumulative. That second statement is a claim about
game mechanics, and it is only as good as what is behind it.

Right now, exactly one of the seven non-cumulative claims has a primary source. The
other six rest on a reading of the EQEmu server's code, where the behaviour was
committed with no source cited. That is worth something — EQEmu developers test against
live servers — but it is not the same as knowing.

So the site says which is which, and both the wording *and the verdicts* come from the
evidence rather than from anyone's confidence. **Add a source and the next build changes
what the site says — and, where the claim can affect an answer, what it answers.** No
code change, no UI change. That is the whole design.

## What counts as evidence

Ranked. The rank is not about how sure the contributor is; it is about whether a
stranger can check it.

| Strength | Kinds | What it means |
| --- | --- | --- |
| **primary** | `game-text`, `dev-statement`, `patch-notes`, `parse` | Daybreak's own words, or a measurement that meets the protocol below. Settles a claim. |
| **strong** | `practitioner`, `dev-statement`, `patch-notes`, `parse` | A named person with standing in the game reporting first-hand behaviour. Acted on, and attributed. |
| **supporting** | `implementation` | Independent but second-hand — an emulator's code, a datamined structure. Corroborates. Never settles. |
| **weak** | `community` | An unattributed claim with no data and no name behind it. Recorded for context, never load-bearing. |

`implementation` evidence **cannot** be primary or strong. The validator rejects it.
That is deliberate: an emulator is someone else's reading of the game, and treating it
as proof is the mistake this file exists to prevent.

### practitioner

The people who actually know. A class representative, a raid guild's mechanics lead, a
known theorycrafter, a Daybreak CSR — someone whose day-to-day is this system and whose
name can be checked. Reporting what they have seen the game do.

This is not the same as a forum consensus, and lumping the two together as "community"
was wrong: a class rep describing their own class's signature mechanic is worth more
than an emulator's uncited implementation, not less. It is also not the same as
Daybreak's own words — testimony can be misremembered, and mechanics change — so it
gets its own tier rather than being called primary.

A `practitioner` entry needs two fields, and the split matters:

- **`who`** — the credit line, a name and nothing more. This is what the site prints.
- **`standing`** — why the report weighs. This stays in `claims.json` for whoever
  reviews the claim later and is never shipped to the page.

Credit belongs on the page; credentials do not. Nobody reading a stacking answer needs
someone's guild affiliation recited at them, but the person weighing the evidence in six
months does need to know why it was rated `strong`.

```json
{
  "strength": "strong",
  "kind": "practitioner",
  "who": "Sancus",
  "standing": "Wizard class representative; raids with Realm of Insanity. Reporting first-hand on mechanics central to his own class.",
  "summary": "Focus SPAs stack regardless of slot conflicts.",
  "source": "Feedback on the project, 2026-08-21"
}
```

The validator enforces both, and rejects a `who` longer than 40 characters — that is the
signal you are writing a biography where the standing field belongs.

### What each status does

| Status | Reached by | Effect |
| --- | --- | --- |
| `confirmed` | any primary evidence | Stated plainly. The engine acts on it. |
| `corroborated` | any strong evidence | Stated with attribution. The engine acts on it. |
| `unverified` | only supporting or weak | Flagged to the reader. The engine does **not** act on it. |
| `disputed` | any entry with `"refutes": true` | Surfaced as contested. |

"The engine acts on it" is literal for claims that can change a verdict. The focus
stacking claim is one: while it was `unverified` the engine still arbitrated those SPAs
and marked the verdict doubtful; once a class rep's report made it `corroborated`, the
SPAs became exempt and the verdicts changed. Nothing in the engine was special-cased —
`tools/gen_spa_js.mjs` reads the status and emits a different table.

### game-text

The client's own files — `dbstr_us.txt` descriptions, `spells_us_str.txt` messages.
Daybreak wrote them and ships them, which makes them about as close to authoritative as
a player can get without a developer in the room.

The strongest form is a pattern rather than a single line. The SPA 496 claim rests on
this: of all 70,963 spells, exactly 53 descriptions contain the word "non-cumulative",
and every one of them carries SPA 496 — none says it without. One description could be
a copy-paste artefact. Fifty-three with no counterexample is a rule.

If your evidence has that shape, add a `check` block and it becomes re-runnable:

```json
{
  "strength": "primary",
  "kind": "game-text",
  "summary": "Every description saying 'non-cumulative' carries SPA 496, and none says it without.",
  "source": "dbstr_us.txt, shipped with the live client",
  "check": { "id": "desc-phrase-implies-spa", "phrase": "non-cumulative", "spa": 496 }
}
```

`npm run verify` recomputes it against the local spell files and fails if it stops
holding. Adding a new checker means a function in `tools/verify_claims.mjs`; it is a
dozen lines.

### dev-statement and patch-notes

A named Daybreak or Darkpaw developer on the official forums, in a patch note, or in a
stream. Quote it and link it. Include the date — mechanics change, and a 2009 post about
a 2021 SPA is not evidence.

Archive links are fine and often better, since the EQ forums have eaten their own
history more than once.

### parse

An in-game measurement. This is the one most likely to be wrong for boring reasons, so
the bar is specific. A parse must state all five:

**Method.** What you cast, in what order, on what. Enough that someone with the same
class could repeat it.

**Sample size.** Number of swings, casts or ticks. A dozen hits cannot separate a 300%
crit modifier from a 410% one; hundreds can.

**Result.** The actual numbers, both conditions. "Buff A alone: mean crit 41,203 over
600 hits. A+B: 41,180 over 640." Means, not impressions.

**Controls.** What you ruled out. No gear swap between runs, no other buff landing or
fading, no AA or item proc contributing the same SPA, same target, same weapon, same
stance. Most bad parses are a control failure, not a math failure.

**Log excerpt.** A few representative lines, or a link to the full log. Not the whole
thing inline.

A parse that shows a difference is stronger than one that does not, because "I saw no
difference" is also what insufficient sample size looks like. If your result is a null,
say what effect size you could have detected.

## Making the change

```bash
git clone <your fork>
cd does-it-stack
npm test                 # works on a fresh clone — no EverQuest install needed
```

Edit `claims.json`. Add your evidence entry to the relevant claim's `evidence` array.
**Do not touch `status`** — it is derived: any primary evidence makes a claim
`confirmed`, any entry marked `"refutes": true` makes it `disputed`, otherwise it is
`unverified`.

If a claim turns out to be wrong outright, keep the claim and add refuting evidence
rather than deleting the entry. A claim that was believed and then disproved is more
useful to the next reader than a claim that silently vanished.

Then:

```bash
npm run claims           # shows every claim and its derived status
npm test                 # validates claims.json among other things
npm run verify           # re-runs machine-checkable evidence (needs EverQuest installed)
```

Open the PR. The template asks for the same fields as above.

### If you do not want to touch JSON

Open an issue with the [evidence form](.github/ISSUE_TEMPLATE/mechanic-evidence.yml) and
say what you know. Someone will turn it into a PR and credit you. A patch note nobody
else had noticed is worth more than a well-formatted commit.

## Credit

Evidence gets credited in the claim's `source` field, which is shown in the site's
evidence disclosure. The focus-effect claims came from a reader who replied to the
announcement post; that reply is quoted verbatim in `claims.json` and rendered in the
UI. If you would rather be credited by name or handle than as "reader feedback", say so
in the PR or issue and it goes in the source line.

## Adding a new kind of claim

`claims.json` holds three types: `non_cumulative`, `focus_best_only` and
`focus_stacking`. To add another, add the type to `TYPES` in `tools/claims.mjs`, teach
`tools/build.mjs` to emit it, and have the UI read it. Keep the same shape: an assertion
in plain language, evidence entries, a derived status.

A claim can name one SPA (`spa`) or a set (`spas` plus a `slug` for the id). An **empty**
`spas` array means "the whole category" — the build derives the actual SPA list from
`tools/spa_meta.json`, so a regenerated SPA table picks up whatever a new expansion adds
instead of freezing a list that quietly goes stale. Both focus claims work that way.

## Code changes

Normal rules. A few things specific to this project:

- **The engine is a port, not an invention.** `web/engine.js` follows EQEmu's
  `Mob::CheckStackConflict`. If you change a rule, say which upstream code or which
  observed behaviour you are matching, in the commit message. Divergence may well be
  right — EQEmu is not the game — but it should be deliberate and written down. The
  slot count is one such deliberate divergence: EQEmu caps at twelve because RoF2 did,
  and live spells go far past that, so the engine walks the real slot arrays instead.
- **Every rule carries the case it came from.** Comments in the engine name the
  scenario, not the mechanism. Keep that.
- **Tests must run without the game.** `tests/engine.fixtures.test.mjs` and
  `tests/claims.test.mjs` use hand-built fixtures and run anywhere; CI has no EverQuest
  install. `tests/engine.test.mjs` needs a built dataset and skips itself without one.
  New engine behaviour needs a fixture test, not only a dataset test.
- **`dist/` is not committed.** Rebuild after each patch day; `tools/deploy_pages.sh`
  and `tools/deploy_pages.ps1` push it as an orphan `gh-pages` commit.
- **Parser changes** should note which field index moved and in which client build.
  The layout has changed several times; `tools/spells.mjs` targets the 166-field format.

## Regenerating the SPA tables

`tools/spa_meta.json` — SPA names and the stacking ignore list — is extracted from
EQEmu rather than typed:

```bash
git clone --filter=blob:none --depth 1 https://github.com/EQEmu/Server.git /tmp/eqemu
node tools/gen_spa_meta.mjs --eqemu /tmp/eqemu
```

Run it when an expansion adds SPAs and EQEmu catches up. It should produce no diff
otherwise.

## Ground rules

Be specific and be checkable. Beyond that: no spell data from the game is redistributed
here, so do not commit `spells_us.txt`, `dbstr_us.txt` or a built `dist/`. Everyone
builds from their own install.
