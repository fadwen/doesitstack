// Locating the EverQuest install, shared by the build and the claim verifier.
import fs from 'node:fs';
import path from 'node:path';

export const CANDIDATE_DIRS = [
  'C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest',
  'C:\\Users\\Public\\Sony Online Entertainment\\Installed Games\\EverQuest',
  'C:\\Program Files (x86)\\Sony\\EverQuest',
  'C:\\EverQuest',
];

export function findEqDir() {
  return CANDIDATE_DIRS.find(d => fs.existsSync(path.join(d, 'spells_us.txt')));
}

export function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
