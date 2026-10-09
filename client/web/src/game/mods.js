// Modifications, after War Thunder's: vehicles built on the same chassis are one family. The
// garage shows one card per family; its modifications (the weapon fit, the camouflage) pick
// which of the family's vehicles is driven, each with its own data and model.

/**
 * Families: the first variant's id is the family's card. Each variant names its weapon fit and
 * its camouflage (zh / en); variants with the same weapon and another paint are camouflages.
 */
export const FAMILIES = [
  {
    key: 'de_hetzer',
    variants: [
      { id: 'de_hetzer', weapon: ['7.5 cm PaK 39 L/48', '7.5 cm PaK 39 L/48'], paint: ['標準', 'Standard'] },
      { id: 'de_hetzer_flak', weapon: ['2 cm FlaK 38 防空', '2 cm FlaK 38 AA'], paint: ['標準', 'Standard'] },
      { id: 'de_hetzer_mk103', weapon: ['3 cm MK 103 防空', '3 cm MK 103 AA'], paint: ['城市灰', 'Urban grey'] },
      { id: 'de_hetzer_mk103_camo', weapon: ['3 cm MK 103 防空', '3 cm MK 103 AA'], paint: ['三色迷彩', 'Three-colour camouflage'] },
      { id: 'de_hetzer_sdkfz1401', weapon: ['2 cm KwK 38 · SDK 炮塔（假想改裝）', '2 cm KwK 38 · SDK turret (custom)'], paint: ['沙黃色', 'Sand yellow'] },
    ],
  },
  {
    key: 'xp_bmp_k64',
    variants: [
      { id: 'xp_bmp_k64', weapon: ['14.5 mm KPVT 機槍塔', '14.5 mm KPVT cupola'], paint: ['標準', 'Standard'] },
      { id: 'xp_bmp_k64_atgm', weapon: ['9M113 雙聯飛彈筒', '9M113 twin missile tubes'], paint: ['標準', 'Standard'] },
      { id: 'xp_bmp_k64_kornet', weapon: ['9M133 飛彈發射架套件', '9M133 launcher kit'], paint: ['標準', 'Standard'] },
    ],
  },
  {
    key: 'de_rso_flak',
    variants: [
      { id: 'de_rso_flak', weapon: ['2 cm FlaK 38', '2 cm FlaK 38'], paint: ['標準', 'Standard'] },
      { id: 'de_rso_pak40', weapon: ['7.5 cm PaK 40 裝甲駕駛室', '7.5 cm PaK 40, armoured cab'], paint: ['標準', 'Standard'] },
    ],
  },
  {
    key: 'us_m4a3_75w',
    variants: [
      { id: 'us_m4a3_75w', weapon: ['75 mm M3 · VVSS', '75 mm M3 · VVSS'], paint: ['標準', 'Standard'] },
      { id: 'us_m4a3_76w_hvss', weapon: ['76 mm M1 · T23 炮塔 · HVSS', '76 mm M1 · T23 turret · HVSS'], paint: ['標準', 'Standard'] },
    ],
  },
  {
    key: 'de_panther_g',
    variants: [
      { id: 'de_panther_g', weapon: ['7.5 cm KwK 42 · G 型炮塔', '7.5 cm KwK 42 · Ausf. G turret'], paint: ['標準', 'Standard'] },
      { id: 'de_panther_f', weapon: ['7.5 cm KwK 42 · 窄炮塔', '7.5 cm KwK 42 · Schmalturm'], paint: ['標準', 'Standard'] },
      { id: 'de_aufkl_panther', weapon: ['5 cm KwK 39/1 · 偵察炮塔', '5 cm KwK 39/1 · recce turret'], paint: ['標準', 'Standard'] },
    ],
  },
  {
    key: 'su_t34_85',
    variants: [
      { id: 'su_t34_85', weapon: ['85 mm ZiS-S-53', '85 mm ZiS-S-53'], paint: ['標準', 'Standard'] },
      { id: 'su_bmpt34', weapon: ['BMPT 戰鬥模組', 'BMPT combat module'], paint: ['標準', 'Standard'] },
      { id: 'su_t34_1940', weapon: ['76 mm L-11 · 1940 焊接炮塔', '76 mm L-11 · 1940 welded turret'], paint: ['標準', 'Standard'] },
    ],
  },
  {
    key: 'xp_kda35',
    variants: [
      { id: 'xp_kda35', weapon: ['35 mm KDA 機炮', '35 mm KDA cannon'], paint: ['標準', 'Standard'] },
      { id: 'xp_w78', weapon: ['78 mm 低後座炮', '78 mm low-recoil gun'], paint: ['標準', 'Standard'] },
    ],
  },
];

const BY_ID = new Map();
for (const f of FAMILIES) for (const v of f.variants) BY_ID.set(v.id, f);

/** The family a vehicle belongs to, or null. */
export function familyOf(id) {
  return BY_ID.get(id) || null;
}

/** Which variant each family is fitted with, kept in the browser's storage. */
export class Mods {
  constructor(store, key, has) {
    this.store = store;
    this.key = key;
    // only vehicles the build carries
    this.has = has;
    this.pick = {};
    try {
      this.pick = JSON.parse(store.get(key) || '{}') || {};
    } catch {
      /* a broken entry starts afresh */
    }
  }

  /** The vehicle driven for a card (a family's key, or a vehicle of no family). */
  variantOf(cardId) {
    const f = BY_ID.get(cardId);
    if (!f || f.key !== cardId) return cardId;
    const v = this.pick[f.key];
    return v && this.has(v) ? v : f.key;
  }

  /** The card a vehicle shows on. */
  cardOf(id) {
    const f = BY_ID.get(id);
    return f ? f.key : id;
  }

  /** Fits the family of `id` with that variant. */
  choose(id) {
    const f = BY_ID.get(id);
    if (!f) return;
    this.pick[f.key] = id;
    this.store.set(this.key, JSON.stringify(this.pick));
  }

  /** The garage's order with each family on one card: [card id, vehicle id driven]. */
  cards(order) {
    const out = [];
    for (const id of order) {
      const f = BY_ID.get(id);
      if (f && f.key !== id && order.includes(f.key)) continue;
      out.push([id, this.variantOf(id)]);
    }
    return out;
  }

  /** The modification slots of a vehicle's family: weapon fits, then the camouflages of the fit. */
  slots(id, lang = 0) {
    const f = BY_ID.get(id);
    if (!f) return null;
    const cur = f.variants.find((v) => v.id === id);
    const weapons = [];
    for (const v of f.variants) {
      if (!this.has(v.id)) continue;
      const w = v.weapon[lang];
      if (!weapons.some((x) => x.label === w)) {
        // a fit chosen keeps the camouflage it had, if it comes in it
        const same = f.variants.find((u) => u.weapon[lang] === w && u.paint[lang] === cur.paint[lang] && this.has(u.id));
        weapons.push({ label: w, id: same ? same.id : v.id, on: w === cur.weapon[lang] });
      }
    }
    const paints = f.variants.filter((v) => this.has(v.id) && v.weapon[lang] === cur.weapon[lang]).map((v) => ({ label: v.paint[lang], id: v.id, on: v.id === id }));
    return { weapons, paints };
  }
}
