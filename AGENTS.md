# Working on this repo

Short version of things that are easy to get wrong here. The reasoning is in
[CONTRIBUTING.md](CONTRIBUTING.md); this is the checklist.

## Commands

```bash
npm test             # runs anywhere — no EverQuest install needed
npm run build        # needs the game files
npm run verify:data  # diffs the built dataset against the spell file
npm run verify       # re-runs machine-checkable claim evidence
npm run claims       # every claim and its derived status
```

`npm test` must pass on a clone with no game installed. CI runs Linux and Windows.

## Rules

**Daybreak is the source of truth, not EQEmu.** The stacking engine is ported from
EQEmu and that is the least well-sourced part of the project. Never rate
`implementation` evidence above `supporting` — the validator rejects it. When EQEmu and
the client's own files disagree, the files win, and the divergence gets written down.

**Never hand-write a claim's `status`.** It is derived from the evidence at load time.
Editing it is how this project would start lying. Add evidence instead.

**`tools/reference/` is verbatim.** Primary sources are stored exactly as published,
including odd capitalisation and underscores. Do not tidy, reformat or "fix" them. A
reformatted copy is a second-hand reading of a primary source.

**`tools/spells.mjs` imports only Node built-ins.** Spell values come from the client's
files and nothing else. Keep it that way; a test enforces it.

**No slot caps.** EverQuest allows up to 100 effect slots. Any constant that limits
iteration to 12, 40 or any other number is a bug — that exact mistake silently corrupted
thousands of verdicts once already.

**Do not commit `dist/`, `web/spa.js`, or any game data file.** They are generated or
licensed. `dist/` deploys as an orphan `gh-pages` commit.

**Assume Windows.** Contributors run EverQuest, so they run Windows. Do not rely on
shell glob expansion, POSIX-only paths, or `file://${process.argv[1]}` — all three have
broken this repo before.

## When changing things

- **A stacking rule** — say which upstream code or observed behaviour you are matching,
  in the commit message. Divergence from EQEmu may be right, but it must be deliberate
  and written down. Every rule the engine can cite needs a `stacking_rule` claim; a test
  checks that by scanning `engine.js`.
- **The parser** — run `npm run verify:data`. It re-reads the spell file with a second
  parser that keeps its own field offsets, so the two disagreeing is the signal. Update
  both or the check is worthless.
- **Anything user-facing** — check it at 390px as well as desktop. Wide content scrolls
  inside its own box; the page must not.
- **Docs** — this README has gone stale twice, describing behaviour that no longer
  existed. If you change what the site does, grep the docs for what you just changed.

## What is deliberately unfinished

Read the "Known gaps" section of the README before proposing to fix something. Several
gaps are open on purpose — the "Item / other" residual and the unverified stacking rules
in particular. Closing them with a plausible guess is worse than leaving them.
