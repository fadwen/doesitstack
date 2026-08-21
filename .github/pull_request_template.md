<!--
  Changing a mechanic claim (claims.json)?  Fill in the evidence section.
  Anything else — a bug fix, UI work, parser change — delete it and just describe the change.
-->

## What this changes

<!-- One or two sentences. -->

## Evidence  <!-- delete this whole section if you are not touching claims.json -->

**Claim:** <!-- e.g. non-cumulative/185 -->

**What you found:** <!-- Does the claim hold, or not? -->

**Kind of evidence:** <!-- game-text | dev-statement | patch-notes | parse | implementation | community -->

**Source:** <!-- Specific enough for a reviewer to check it themselves: a quote and a
link, a patch date, a file and line, a log excerpt. "I tested it" is not a source. -->

<!-- For a parse, the protocol in CONTRIBUTING.md asks for all of these: -->
- **Method:**
- **Sample size:**
- **Result:**
- **Controls:** <!-- what you ruled out — other buffs, gear, AAs, crit sources -->

## Checks

- [ ] `npm test` passes
- [ ] `npm run claims` shows the status I expect
- [ ] `npm run verify` passes, if I added machine-checkable evidence *(needs an EverQuest install)*
- [ ] I did not hand-edit a claim's `status` — it is derived from the evidence
