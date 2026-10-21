// Shuki grows: levels and the wardrobe they unlock. Shared by the server (growth, outfit checks) and the app (closet).
// Each person has their own Shuki: their own level (from their own updates) and their own outfit.

// Points to reach each level: 21 levels and 14 items (stage 10, decision 13). From 16/10 (the owner) a point is a day: one for
// each day (by the house's clock) with an update that counts, and one more on a day a shopping trip was finished (at most one
// a day); the mapping and the first meeting don't count (worker/index.js xpOf). So: level 4 in two weeks of daily use, level 10
// in about three months, level 17 in a year, level 21 in two years.
export const LEVELS = [
  { at: 0, name: 'טירון' },
  { at: 3, name: 'מלצר' },
  { at: 7, name: 'בריסטה' },
  { at: 14, name: 'עוזר מטבח' },
  { at: 21, name: 'טבח' },
  { at: 30, name: 'קונדיטור' },
  { at: 45, name: 'מנהל רשימות' },
  { at: 60, name: 'שומר המקרר' },
  { at: 80, name: 'מומחה המזווה' },
  { at: 100, name: 'צייד המבצעים' },
  { at: 125, name: 'סו-שף' },
  { at: 150, name: 'שף' },
  { at: 180, name: 'מנהל המחסן' },
  { at: 210, name: 'אלוף הקניות' },
  { at: 250, name: 'קוסם הרשימות' },
  { at: 300, name: 'ראש המטבח' },
  { at: 365, name: 'חכם הבית' },
  { at: 430, name: 'אלוף המקרר' },
  { at: 500, name: 'כוכב מישלן' },
  { at: 600, name: 'אגדת המזווה' },
  { at: 730, name: 'מלך הבית' },
];

// Where things go on the doll. One item per spot.
export const SLOTS = [
  ['head', 'ראש'], ['eyes', 'עיניים'], ['mouth', 'שפם'], ['chin', 'זקן'], ['neck', 'צוואר'], ['ear', 'אוזניים'], ['chest', 'חזה'],
];

// 14 items, each at the points it opened at before stage 10; a level with a new name of its own (2, 3, 5, 6, 12, 19) brings none.
export const ITEMS = [
  { id: 'bow', level: 4, slot: 'neck', name: 'פפיון' },
  { id: 'glasses', level: 7, slot: 'eyes', name: 'משקפיים עגולים' },
  { id: 'band', level: 8, slot: 'head', name: 'סרט ספורט' },
  { id: 'mustache', level: 9, slot: 'mouth', name: 'שפם' },
  { id: 'pencil', level: 10, slot: 'ear', name: 'עיפרון מאחורי האוזן' },
  { id: 'chef', level: 11, slot: 'head', name: 'כובע שף' },
  { id: 'tie', level: 13, slot: 'neck', name: 'עניבה' },
  { id: 'shades', level: 14, slot: 'eyes', name: 'משקפי שמש' },
  { id: 'earrings', level: 15, slot: 'ear', name: 'עגילי זהב' },
  { id: 'scarf', level: 16, slot: 'neck', name: 'צעיף' },
  { id: 'beard', level: 17, slot: 'chin', name: 'זקן' },
  { id: 'medal', level: 18, slot: 'chest', name: 'מדליית זהב' },
  { id: 'cap', level: 20, slot: 'head', name: 'כובע מצחייה' },
  { id: 'crown', level: 21, slot: 'head', name: 'כתר' },
];
export const ITEM = Object.fromEntries(ITEMS.map((x) => [x.id, x]));

/** xp → { level (1-based), name, xp, from, to (null at the top), next: the next item to open, at whatever level it is } */
export function growth(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].at) i++;
  const next = ITEMS.find((x) => x.level > i + 1);
  return { level: i + 1, name: LEVELS[i].name, xp, from: LEVELS[i].at, to: LEVELS[i + 1]?.at ?? null, next: next ? next.name : null };
}

/**
 * Question 18 (stage 10): an app that still knows 15 levels (its cached copy, once after the deploy, before the new one is
 * loaded) gets the growth in its own numbers: the level among the old thresholds (the items' points), and the name of the
 * level at that threshold. So it doesn't throw a level-up party for the new numbers. Goes when every phone has v76.
 */
export function legacyGrowth(xp) {
  const at = [0, ...ITEMS.map((x) => LEVELS[x.level - 1].at)]; // 0, 15, 35 … 1320: the 15 levels before stage 10
  let i = 0;
  while (i + 1 < at.length && xp >= at[i + 1]) i++;
  const g = growth(xp);
  return { ...g, level: i + 1, name: LEVELS.find((l) => l.at === at[i]).name, from: at[i], to: at[i + 1] ?? null };
}

/** Before anyone chose: the newest item in each spot. */
export function autoOutfit(level) {
  const wear = {};
  for (const x of ITEMS) if (x.level <= level) wear[x.slot] = x.id;
  return wear;
}

/** Keep only what's unlocked and in its own spot. */
export function cleanOutfit(wear, level) {
  const out = {};
  for (const [slot] of SLOTS) {
    const id = wear?.[slot];
    if (id && ITEM[id] && ITEM[id].slot === slot && ITEM[id].level <= level) out[slot] = id;
  }
  return out;
}

/**
 * The saved outfit after a level-up: whatever was just unlocked goes on (in its spot), the rest stays as chosen.
 * stored: { level, wear } | null  →  { level, wear, changed }
 */
export function catchUp(stored, level) {
  if (!stored) return { level, wear: autoOutfit(level), changed: true };
  if (level === stored.level) return { ...stored, wear: cleanOutfit(stored.wear, level), changed: false };
  // the level went down (16/10, points are days now): what doesn't open any more comes off quietly, and the level kept is the
  // new one, so the next level up puts its item on again
  if (level < stored.level) return { level, wear: cleanOutfit(stored.wear, level), changed: true };
  const wear = { ...stored.wear };
  for (const x of ITEMS) if (x.level > stored.level && x.level <= level) wear[x.slot] = x.id;
  return { level, wear, changed: true };
}
