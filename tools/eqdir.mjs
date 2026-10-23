// Locating the EverQuest install, shared by the build and the claim verifier.
import fs from 'node:fs';
import path from 'node:path';

export const CANDIDATE_DIRS = [
  'C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest',
  'C:\\Users\\Public\\Sony Online Entertainment\\Installed Games\\EverQuest',
  'C:\\Program Files (x86)\\Sony\\EverQuest',
  'C:\\EverQuest',
];

/**
 * The first directory that actually holds a spell file. EQ_DIR is tried ahead of
 * the usual install paths, so an install on another drive — or a copy of the
 * files on a machine without the game — does not need --eq-dir on every command.
 * The parameters exist for the tests; callers take the defaults.
 */
export function findEqDir(candidates = CANDIDATE_DIRS, env = process.env) {
  const dirs = env.EQ_DIR ? [env.EQ_DIR, ...candidates] : candidates;
  return dirs.find(d => fs.existsSync(path.join(d, 'spells_us.txt')));
}

export function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
