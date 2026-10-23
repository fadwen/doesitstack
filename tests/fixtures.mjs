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
  // Focus effects. 399 FcTwincast is absent from the client-derived ignore list;
  // the focus stacking claim is corroborated, so the engine exempts it by claim.
  twincastA: make({ id: 900008, name: 'Test Twincast A', slots: [slot(399, 10)] }),
  twincastB: make({ id: 900009, name: 'Test Twincast B', slots: [slot(399, 30)] }),
  // 286 FcDamageAmt is on the ignore list, so it never conflicts at all.
  focusIgnoredA: make({ id: 900010, name: 'Test Focus Ignored A', slots: [slot(286, 100)] }),
  focusIgnoredB: make({ id: 900011, name: 'Test Focus Ignored B', slots: [slot(286, 400)] }),
  // 383 SympatheticProc is proc-type: several can fire on one cast.
  procFocusA: make({ id: 900012, name: 'Test Proc Focus A', slots: [slot(383, 5, 12345)] }),
  procFocusB: make({ id: 900013, name: 'Test Proc Focus B', slots: [slot(1, 50), slot(383, 9, 12346)] }),

  // Live spells are not capped at twelve slots. Modern bard songs run past twenty
  // (Aria of Kenburk Rk. III has 22) and the longest in the current file has 67.
  // These two collide only at slot 16, which a twelve-slot engine cannot see.
  longSongA: make({
    id: 900014, name: 'Test Long Song A',
    slots: [...Array(15).fill(null).map((_, i) => slot(137 + i)), slot(1, 100)],
  }),
  longSongB: make({
    id: 900015, name: 'Test Long Song B',
    slots: [...Array(15).fill(null).map((_, i) => slot(200 + i)), slot(1, 250)],
  }),

  // EverQuest allows up to 100 slots. The longest in the current file is 67, so the
  // top of the range is not exercised by real data — these two are built at the full
  // 100 and collide only at the last one.
  hundredSlotA: make({
    id: 900016, name: 'Test 100 Slot A',
    slots: [...Array(99).fill(null).map((_, i) => slot(600 + i)), slot(1, 100)],
  }),
  hundredSlotB: make({
    id: 900017, name: 'Test 100 Slot B',
    slots: [...Array(99).fill(null).map((_, i) => slot(800 + i)), slot(1, 400)],
  }),

  // Two members of one Live stacking group.
  stackGroupLow:  make({ id: 900006, name: 'Test Group Rank 1', slots: [slot(2, 50)],
                         stacking: [{ group: 4242, group_name: 'Test Stacking Group', rank: 1, type: 1 }] }),
  stackGroupHigh: make({ id: 900007, name: 'Test Group Rank 2', slots: [slot(2, 90)],
                         stacking: [{ group: 4242, group_name: 'Test Stacking Group', rank: 2, type: 1 }] }),
  // The same two ranks in a type 6 (non-override) group: whatever is up stays up.
  nonOverrideLow:  make({ id: 900018, name: 'Test Non-Override Rank 1', slots: [slot(2, 50)],
                          stacking: [{ group: 4343, group_name: 'Test Non-Override Group', rank: 1, type: 6 }] }),
  nonOverrideHigh: make({ id: 900019, name: 'Test Non-Override Rank 2', slots: [slot(2, 90)],
                          stacking: [{ group: 4343, group_name: 'Test Non-Override Group', rank: 2, type: 6 }] }),

  // The rules the same-spell branch carves out. Mana Burn is any spell carrying SPA
  // 350; Eye of Zomm is spell 331 by id; Improved Taunt carries SPA 444.
  manaBurn:      make({ id: 2751, name: 'Mana Burn', beneficial: false, duration: 0, slots: [slot(350, 1000)] }),
  eyeOfZomm:     make({ id: 331, name: 'Eye of Zomm', duration: 10, slots: [slot(87, 1)] }),
  improvedTaunt: make({ id: 900020, name: 'Test Improved Taunt', beneficial: false, duration: 10, slots: [slot(444, 50, 150)] }),
  // A detrimental duration spell with no damage in it — a snare — is not a DoT, so
  // a recast is still held to the same-spell level check.
  snare: make({ id: 900021, name: 'Test Snare', beneficial: false, duration: 60, slots: [slot(3, -55)] }),
  // Two different DoTs: detrimental, duration, SPA 0 in the same slot.
  dotA: make({ id: 900022, name: 'Test DoT A', beneficial: false, duration: 10, slots: [slot(0, -100)] }),
  dotB: make({ id: 900023, name: 'Test DoT B', beneficial: false, duration: 10, slots: [slot(0, -200)] }),
  // A regeneration buff: beneficial SPA 0 over time, in the slot the DoTs use.
  regen: make({ id: 900024, name: 'Test Regen', duration: 100, slots: [slot(0, 30)] }),
  // Complete Heal: SPA 101 in slot 1.
  completeHeal:  make({ id: 900025, name: 'Test Complete Heal', duration: 1, slots: [slot(101, 7500)] }),
  completeHealB: make({ id: 900034, name: 'Test Complete Heal B', duration: 1, slots: [slot(101, 7500)] }),
  // SPA 149: overwrite anything whose slot 1 is SPA 1 (AC) below 500.
  overwriter: make({ id: 900026, name: 'Test Overwriter', slots: [slot(1, 450), slot(149, 1, 1, 100, 500)] }),
  // A detrimental spell with AC in slot 1, for the 2018 bypass of SPA 148.
  acDebuff: make({ id: 900027, name: 'Test AC Debuff', beneficial: false, duration: 60, slots: [slot(1, -100)] }),
  // Negative AC in a slot an AC buff also uses: the arbitration skips it.
  acBuff: make({ id: 900028, name: 'Test AC Buff', slots: [slot(1, 300)] }),
  // Two bard songs carrying the bard-only AE DoT effect in the same slot.
  bardDotA: make({ id: 900029, name: 'Test Bard AE DoT A', beneficial: false, duration: 10, levels: lv({ 7: 50 }), slots: [slot(334, -20)] }),
  bardDotB: make({ id: 900030, name: 'Test Bard AE DoT B', beneficial: false, duration: 10, levels: lv({ 7: 60 }), slots: [slot(334, -40)] }),
  // Haste is stored as a percentage of normal speed: 168 is +68%, 125 is +25%.
  hasteBig:   make({ id: 900031, name: 'Test Haste 68', slots: [slot(11, 168)] }),
  hasteSmall: make({ id: 900032, name: 'Test Haste 25', slots: [slot(11, 125)] }),
  // A bard song and a buff both carrying haste in the *same* slot: they coexist
  // by the bard-song rule, so the shared non-cumulative effect is real.
  hasteSong: make({ id: 900033, name: 'Test Haste Song', duration: 100, levels: lv({ 7: 20 }), slots: [slot(11, 130)] }),
};

export const fx = (name) => structuredClone(FIXTURES[name]);
