// Hand-built spells, so the engine suite runs without an EverQuest install.
//
// Every fixture mirrors the shape of a real record and is annotated with the
// mechanic it exercises. Values are taken from the real spells where a real
// spell is named, so a fixture drifting from the game is a visible bug rather
// than a silent one — tests/engine.test.mjs re-checks them against the built
// dataset whenever one is present.

const slot = (spa, base1 = 0, base2 = 0, calc = 100, max = 0) => ({ spa, base1, base2, calc, max });
const NONE = new Array(16).fill(255);
const lv = (obj) => { const l = NONE.slice(); for (const [i, v] of Object.entries(obj)) l[i] = v; return l; };
export const CLASS = { WAR:0, CLR:1, PAL:2, RNG:3, SHD:4, DRU:5, MNK:6, BRD:7, ROG:8, SHM:9, NEC:10, WIZ:11, MAG:12, ENC:13, BST:14, BER:15 };

const base = {
  extra: '', beneficial: true, target: 5, resist: 0, duration: 100, dur_calc: 7, dur_cap: 0,
  mana: 0, endurance: 0, cast_ms: 0, recast_ms: 0, icon: 0, group_id: 0, rank: 0,
  is_skill: false, unstackable_dot: false, song_window: false, timer: 0,
  kind: 'spell', levels: NONE, slots: [], stacking: [],
};
const make = (o) => ({ ...base, ...o });

export const FIXTURES = {
  // Shaman epic 2.0 click. SPA 496 sits in slot 10.
  prophetsGift: make({
    id: 6273, name: "Prophet's Gift of the Ruchu", kind: 'item', target: 3, duration: 10, dur_calc: 7,
    slots: [...Array(9).fill(slot(10)), slot(496, 110, -1), slot(169, 65, -1), slot(100, 500)],
  }),
  // Berserker AA. SPA 496 sits in slot 2 — a different index, so no conflict.
  savageSpirit: make({
    id: 70855, name: 'Savage Spirit XVII', kind: 'aa', target: 6, duration: 11,
    levels: lv({ 15: 254 }), slots: [slot(373, 6097), slot(496, 300, -1)],
  }),
  // Movement speed in slot 2, benign spacer in slot 1.
  spiritOfWolf: make({
    id: 278, name: 'Spirit of Wolf', duration: 360, levels: lv({ 3: 28, 5: 10, 9: 9, 14: 24 }),
    slots: [slot(10), slot(3, 30, 0, 100, 55)],
  }),
  // Same slot, same SPA, opposite sign — the snare rule.
  ensnare: make({
    id: 512, name: 'Ensnare', beneficial: false, duration: 140, levels: lv({ 3: 51, 5: 26 }),
    slots: [slot(10), slot(3, -40, 3, 100, 56)],
  }),
  // A bard song: bard level set, not a combat skill.
  chantOfBattle: make({
    id: 700, name: 'Chant of Battle', duration: 100, levels: lv({ 7: 1 }),
    slots: [slot(4, 10), slot(5, 10), slot(1, 10)],
  }),
  // Berserker discipline: combat skill flag with a real class level.
  roilingRage: make({
    id: 68190, name: 'Roiling Rage', is_skill: true, target: 6, duration: 10,
    levels: lv({ 15: 122 }), slots: [slot(185, 60, -1)],
  }),
  // Two ranks of one line: identical SPAs in identical slots, different values.
  weakBuff: make({ id: 900001, name: 'Test Buff Rk. I', slots: [slot(1, 100)] }),
  strongBuff: make({ id: 900002, name: 'Test Buff Rk. II', slots: [slot(1, 200)] }),
  // Group and single versions of one line, for the single-vs-group rule.
  groupVersion: make({ id: 900003, name: 'Test Group Buff', target: 41, slots: [slot(1, 150)] }),
  singleVersion: make({ id: 900004, name: 'Test Single Buff', target: 5, slots: [slot(1, 150)] }),
  // SPA 148: block anything whose slot 1 is SPA 1 (AC) below 500.
  blocker: make({ id: 900005, name: 'Test Blocker', slots: [slot(1, 400), slot(148, 1, 1, 100, 500)] }),
  // Focus effects. 399 FcTwincast is absent from the client-derived ignore list, so
  // the engine still arbitrates it and the verdict is flagged contested.
  twincastA: make({ id: 900008, name: 'Test Twincast A', slots: [slot(399, 10)] }),
  twincastB: make({ id: 900009, name: 'Test Twincast B', slots: [slot(399, 30)] }),
  // 286 FcDamageAmt is on the ignore list, so it never conflicts at all.
  focusIgnoredA: make({ id: 900010, name: 'Test Focus Ignored A', slots: [slot(286, 100)] }),
  focusIgnoredB: make({ id: 900011, name: 'Test Focus Ignored B', slots: [slot(286, 400)] }),
  // 383 SympatheticProc is proc-type: several can fire on one cast.
  procFocusA: make({ id: 900012, name: 'Test Proc Focus A', slots: [slot(383, 5, 12345)] }),
  procFocusB: make({ id: 900013, name: 'Test Proc Focus B', slots: [slot(1, 50), slot(383, 9, 12346)] }),

  // Two members of one Live stacking group.
  stackGroupLow:  make({ id: 900006, name: 'Test Group Rank 1', slots: [slot(2, 50)],
                         stacking: [{ group: 4242, group_name: 'Test Stacking Group', rank: 1, type: 1 }] }),
  stackGroupHigh: make({ id: 900007, name: 'Test Group Rank 2', slots: [slot(2, 90)],
                         stacking: [{ group: 4242, group_name: 'Test Stacking Group', rank: 2, type: 1 }] }),
};

export const fx = (name) => structuredClone(FIXTURES[name]);
