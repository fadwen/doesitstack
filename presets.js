// Buff sets that ship with the site, so someone arriving with no idea what to
// type has something real to look at.
//
// These are not saved sets. A saved set lives in one person's browser and they
// own it; a preset is part of the build and the same for everyone. Loading one
// works exactly like loading a saved set — change it, and you are offered the
// way back — and saving over its name keeps a personal copy that takes
// precedence for you without touching what anybody else sees.
//
// Spell ids are stable for a given spell but a buff line gets new ids as new
// ranks ship, so a preset decays quietly as the game moves on. The build checks
// every id against the dataset and says which ones no longer resolve, because
// the failure mode otherwise is a set that silently shrinks.

export const PRESETS = [
  {
    name: 'Common level 130 buffs',
    note: 'What a level 130 character typically has on in a raid — shaman, cleric, druid, '
        + 'enchanter, ranger, mage and beastlord lines, plus a familiar, an illusion benefit '
        + 'and a mount blessing.',
    ids: [
      73888,  // Familiar: Candlefolk
      11249,  // Illusion Benefit Greater Jann
      49447,  // Mount Blessing Qela
      3628,   // Symphony of Battle
      71724,  // Grovewood Blessing (DRU)
      71768,  // Wild Growth X Rk. III (DRU)
      72129,  // Talisman of Perseverance XV (DRU)
      67264,  // Mammoth's Unity (SHM)
      67265,  // Preeminent Unity (SHM)
      67266,  // Celeritous Unity (SHM)
      72121,  // Spirit's Focusing XIV (SHM)
      72122,  // Spirit of Fortitude XVIII (SHM)
      71052,  // Symbol of Sharosh (CLR)
      71053,  // Ward of Eminence (CLR)
      72774,  // Voice of Clairvoyance XVIII (ENC)
      72773,  // Hastening of Elluria (ENC)
      71442,  // Cloak of Underbrush (RNG)
      71418,  // Call of the Predator XVI (RNG)
      71411,  // Strength of the Grovestalker (RNG)
      70155,  // Fernstalker's Enrichment (RNG)
      72608,  // Circle of Fireskin XVI (MAG)
      72943,  // Spiritual Enlightenment XVII (BST)
      36424,  // Shared Merciless Ferocity Rk. III (BST)
    ],
  },
];

export const findPreset = (name) =>
  PRESETS.find(p => p.name.toLowerCase() === String(name ?? '').trim().toLowerCase()) || null;
