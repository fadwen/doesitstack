// The line rumstil/eqspellparser formats each SPA with.
//
// The audit and the worklist both read core/SpellData.cs for the same thing: the
// first `return` under each `case N:` of ParseEffect, which is the line to port
// or the line to compare against. Each used to carry its own copy of this scan,
// with a different lookahead, and the worklist's let the description-token
// switch further down the file overwrite the formatter's line — SPA 287 was
// listed as `text + token.Substring(m.Length)`.

import fs from 'node:fs';
import path from 'node:path';

/** SpellData.cs under a checkout, or null if it is not there. */
export function spellDataFile(dir) {
  if (!dir) return null;
  const file = path.join(dir, 'core', 'SpellData.cs');
  return fs.existsSync(file) ? file : null;
}

/**
 * A few cases open with `if (Version != 0 && Version < N) return <old line>;`
 * for spell files from before a format change. That line is not the one to
 * port — this tool reads the current file — so the reader steps over it to the
 * unconditional return that follows. SPA 178 was ported from the old line and
 * read "Lifetap from Weapon Damage" for years.
 *
 * @param {string} src  the text of SpellData.cs
 * @returns {Map<number,string>} SPA -> the C# expression its case returns
 */
export function eqspCases(src) {
  const lines = src.split(/\r?\n/), out = new Map();   // the checkout may be CRLF
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*case (\d+):\s*$/.exec(lines[i]);
    if (!m || out.has(+m[1])) continue;                 // the first switch is the formatter
    let legacy = false;
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      if (/^\s*case \d+:/.test(lines[j])) break;
      if (/^\s*if \(Version != 0 && Version < \d+\)\s*$/.test(lines[j])) { legacy = true; continue; }
      const r = /^\s*return (.+);\s*$/.exec(lines[j]);
      if (!r) continue;
      if (legacy) { legacy = false; continue; }
      out.set(+m[1], r[1].trim());
      break;
    }
  }
  return out;
}
