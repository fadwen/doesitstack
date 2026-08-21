// How stale the shipped spell data is.
//
// A hosted copy serves whatever spell file its publisher had at deploy time, so the
// visitor has no way to tell how old the answers are. EverQuest patches roughly
// monthly; a copy left unbuilt goes quietly stale, and a stacking verdict from a
// stale file is wrong in a way nobody can see.

export const PATCH_CYCLE_DAYS = 45;    // about one patch, allowing for slippage
export const STALE_DAYS = 120;         // several patches; assume it is wrong

/**
 * @param {string} spellFileDate  ISO date of the client file the data was read from
 * @param {number} now            epoch ms, injected so this is testable
 * @returns {{days:number, level:'fresh'|'aging'|'stale', message:string|null}}
 */
export function dataAge(spellFileDate, now = Date.now()) {
  const parsed = Date.parse(`${spellFileDate}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return { days: NaN, level: 'fresh', message: null };

  const days = Math.floor((now - parsed) / 86400000);
  if (days < PATCH_CYCLE_DAYS) return { days, level: 'fresh', message: null };

  if (days >= STALE_DAYS) {
    const months = Math.floor(days / 30);
    return {
      days, level: 'stale',
      message: `That spell file is about ${months} month${months === 1 ? '' : 's'} old. `
             + 'EverQuest has almost certainly patched since — treat anything here as out of date '
             + 'until this copy is rebuilt.',
    };
  }
  return {
    days, level: 'aging',
    message: `That spell file is ${days} days old, so it may be a patch behind. `
           + 'Spells added or changed since will be missing or stale.',
  };
}
