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

So the site says which is which, and the wording comes from the evidence rather than
from anyone's confidence. **Add a primary source to a claim and the hedging disappears
on the next build.** No code change, no UI change. That is the whole design.

## What counts as evidence

Ranked. The rank is not about how sure the contributor is; it is about whether a
stranger can check it.

| Strength | Kinds | What it means |
| --- | --- | --- |
| **primary** | `game-text`, `dev-statement`, `patch-notes`, `parse` | Daybreak's own words, or a measurement that meets the protocol below. Settles a claim on its own. |
| **supporting** | `implementation` | Independent but second-hand — an emulator's code, a datamined structure. Corroborates. Never settles. |
| **weak** | `community` | Forum, wiki or Discord consensus with no data behind it. Recorded for context, never load-bearing. |

`implementation` evidence **cannot** be marked primary. The validator rejects it. This
is deliberate: an emulator is someone else's reading of the game, and treating it as
proof is exactly the mistake this file exists to prevent.

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

## Adding a new kind of claim

`claims.json` currently holds one type, `non_cumulative`. To add another — say a claim
about how a specific stacking rule behaves — add the type to `TYPES` in
`tools/claims.mjs`, teach `tools/build.mjs` to emit it, and have the UI read it. Keep
the same shape: an assertion in plain language, evidence entries, a derived status.

## Code changes

Normal rules. A few things specific to this project:

- **The engine is a port, not an invention.** `web/engine.js` follows EQEmu's
  `Mob::CheckStackConflict`. If you change a rule, say which upstream code or which
  observed behaviour you are matching, in the commit message. Divergence may well be
  right — EQEmu is not the game — but it should be deliberate and written down.
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
