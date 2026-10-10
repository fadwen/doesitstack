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

// ---------------------------------------------------------------------------
// Item data ages on its own clock.
//
// Item -> spell relationships come from a community dump built by players
// running a collector, so it moves when someone loots something, not when
// Daybreak patches. Weeks of lag on the newest tier is normal and not a
// problem; months of silence means the source has gone quiet.

export const ITEM_LAG_DAYS = 60;
export const ITEM_STALE_DAYS = 180;

/**
 * @param {string|null} updated  newest row timestamp in the item dump (ISO date)
 * @param {number} now           epoch ms, injected so this is testable
 * @returns {{days:number, level:'fresh'|'aging'|'stale', message:string|null}}
 */
export function itemDataAge(updated, now = Date.now()) {
  const parsed = Date.parse(`${updated}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return { days: NaN, level: 'fresh', message: null };

  const days = Math.floor((now - parsed) / 86400000);
  if (days < ITEM_LAG_DAYS) return { days, level: 'fresh', message: null };

  if (days >= ITEM_STALE_DAYS) {
    const months = Math.floor(days / 30);
    return {
      days, level: 'stale',
      message: `The item database has not been updated in about ${months} months, so item tags `
             + 'are missing for anything added since. Which items grant an effect is the only '
             + 'part of this site that does not come from the client files.',
    };
  }
  return {
    days, level: 'aging',
    message: `The item database is ${days} days old, so recent items may not be tagged yet.`,
  };
}
