// Quantities in plain Hebrew ("one carton", "3 cartons", "one pack"), with the right plural and gender. Shared by the app and the server.

// plural and gender of the units people actually type; anything else is guessed from its ending
const UNIT_FORMS = {
  'קרטון': ['קרטונים', 'm'], 'אריזה': ['אריזות', 'f'], 'קופסה': ['קופסאות', 'f'], 'קופסא': ['קופסאות', 'f'], 'שקית': ['שקיות', 'f'],
  'בקבוק': ['בקבוקים', 'm'], 'חפיסה': ['חפיסות', 'f'], 'יחידה': ['יחידות', 'f'], 'תבנית': ['תבניות', 'f'], 'גליל': ['גלילים', 'm'],
  'צנצנת': ['צנצנות', 'f'], 'פחית': ['פחיות', 'f'], 'חבילה': ['חבילות', 'f'], 'מארז': ['מארזים', 'm'], 'שקיק': ['שקיקים', 'm'],
  'כיכר': ['כיכרות', 'f'], 'גביע': ['גביעים', 'm'], 'מגש': ['מגשים', 'm'], 'ק"ג': ['ק"ג', 'm'], 'קילו': ['קילו', 'm'], 'ליטר': ['ליטר', 'm'],
  'טובה': ['טובות', 'f'], 'ביצה': ['ביצים', 'f'], 'פיתה': ['פיתות', 'f'], 'לחמנייה': ['לחמניות', 'f'], 'לחמניה': ['לחמניות', 'f'], 'כוס': ['כוסות', 'f'], 'גביעון': ['גביעונים', 'm'], 'שפופרת': ['שפופרות', 'f'], 'רול': ['רולים', 'm'], 'סל': ['סלים', 'm'], 'ראש': ['ראשים', 'm'],
  // kitchen units, for recipes ("יש שן אחת")
  'שן': ['שיניים', 'f'], 'כף': ['כפות', 'f'], 'כפית': ['כפיות', 'f'], 'צרור': ['צרורות', 'm'], 'ענף': ['ענפים', 'm'], 'פרוסה': ['פרוסות', 'f'], 'קוביה': ['קוביות', 'f'],
};
export function unitForms(u) {
  u = String(u || '').trim();
  if (UNIT_FORMS[u]) return [u, ...UNIT_FORMS[u]];
  if (/[הא]$/.test(u)) return [u, u.slice(0, -1) + 'ות', 'f'];
  if (/ת$/.test(u)) return [u, u.slice(0, -1) + 'ות', 'f'];
  return [u, u + 'ים', 'm'];
}
/** 1 carton → "one carton", 2 → "2 cartons", 0 → "none" (in Hebrew). Without a unit: "one" / "3". */
export function amount(n, unit) {
  n = Math.round((n || 0) * 100) / 100;
  if (n <= 0) return 'אין';
  if (!unit) return n === 1 ? 'אחד' : String(n); // "there should always be one", "there are 3"
  const [one, many, g] = unitForms(unit);
  if (n === 1) return `${one} ${g === 'f' ? 'אחת' : 'אחד'}`;
  return `${n} ${many}`;
}
/** How many days a thing keeps, in Hebrew words: 2 → "two days", 7 → "a week". */
export function daysText(d) {
  return { 1: 'יום', 2: 'יומיים', 7: 'שבוע', 14: 'שבועיים', 21: '3 שבועות', 30: 'חודש', 60: 'חודשיים' }[d] || `${d} ימים`;
}
/**
 * How much of what, the way people say it (decision 162): "2 קרטוני חלב 3%", "קרטון חלב", "חבילת פסטה", "3 ביצים",
 * "2 ק"ג עגבניות", and just the name when there's one of it or no number.
 */
const SAME_MANY = /^(אבוקדו|מנגו|קיווי|ליצ'י|פפאיה|פומלו)$/;
export function of(n, unit, name) {
  n = Math.round((n || 0) * 100) / 100;
  name = String(name || '').trim();
  if (!(n > 0)) return name;
  const u = String(unit || '').trim();
  if (!u || u === 'יחידה') {
    if (n === 1) return name;
    // home19 (15): a name that is the same for one and for many ("3 אבוקדו", not "3 יחידות של אבוקדו")
    return /(ים|ות)$/.test(name.split(/\s+/)[0]) || SAME_MANY.test(name.split(/\s+/)[0]) ? `${n} ${name}` : `${n} יחידות של ${name}`;
  }
  const [one, many] = unitForms(u);
  // the unit is the thing itself (eggs counted in "ביצה"): "30 ביצים", not "30 ביצים של ביצים"
  const stem = u.replace(/[הת]$/, '');
  if (stem.length >= 2 && (name.startsWith(stem) || name.startsWith(many))) return n === 1 ? `${one} ${unitForms(u)[2] === 'f' ? 'אחת' : 'אחד'}` : `${n} ${name.startsWith(many) ? name : many}`;
  if (/^(ק"ג|קילו|ליטר|גרם|מ"ל)$/.test(u)) return n === 1 ? `${u === 'ק"ג' ? 'קילו' : one} ${name}` : `${n} ${many} ${name}`;
  // construct forms, the way people say it: "קרטון חלב", "חבילת פסטה", "2 קרטוני חלב", "3 שקיות אורז"
  const one_ = one.replace(/ה$/, 'ת');
  const many_ = many.replace(/ים$/, 'י');
  return n === 1 ? `${one_} ${name}` : `${n} ${many_} ${name}`;
}

/**
 * Masculine, feminine or plural, from the first word of a product name — a guess, for agreeing verbs and pronouns
 * ("הוא נגמר", "היא נגמרה", "הם נגמרו"). Masculine when unsure, as people say it when they don't know either.
 */
export function genderOf(name) {
  const ws = String(name || '').trim().split(/\s+/), w = ws[0] || '';
  if (w === 'מיני' && ws.length > 1) return genderOf(ws.slice(1).join(' ')); // "מיני פיצות" are many, "מיני במבה" one
  if ((/(ים|ות)$/.test(w) && w.length > 3) || w === 'מים') return 'p';
  // a construct plural ("תפוחי אדמה", "עלי בייבי"), by name: "ברוקולי קפוא", "ספגטי מלא" stay one (stage 9)
  // a first word in "-י" before another is a construct plural, but for the nouns that end so in the singular
  if (ws.length > 1 && /י$/.test(w) && w.length > 1 && !/^(ברוקולי|ספגטי|ביסלי|צ'ילי|קרי|קארי|פרי|קיווי|סלמי|סושי|ראביולי|רביולי|פוזילי|פטוצ'יני|טורטליני|קלמרי|סלרי|טחיני|מיני|חלבי|ביתי|טרי|מנגו|פסטרמי|אנטי|סוכרזי|תה|קפה)$/.test(w)) return 'p';
  if (w === 'חזה') return 'm';
  if (/^(קפה|תה|דגני|חטיפי)$/.test(w)) return /י$/.test(w) ? 'p' : 'm'; // masculine though they end in ה; "דגני בוקר" are many
  if (/[הת]$/.test(w)) return 'f';
  return 'm';
}
/** Pick by gender: g3('m', 'f', 'p') words for the product. */
/** A regular buy's interval, in the approved words (r0t d101, 03/10): "כל יום", "כל 10 ימים", "כל חודשיים", "כל שנה". */
export function everyText(n) {
  n = Math.round(Number(n));
  if (n === 1) return 'כל יום';
  if (n === 365) return 'כל שנה';
  if (n >= 30 && n % 30 === 0) { const m = n / 30; return m === 1 ? 'כל חודש' : m === 2 ? 'כל חודשיים' : `כל ${m} חודשים`; }
  return `כל ${n} ימים`;
}
/** question 41 (r9z, ב): a product in the plural that is feminine ("ביצים", "עגבניות", "פיתות", "עוגיות"): by its first word; "-ות"
 * is feminine but for "ירקות" and "פירות"; "-ים" is masculine but for a short list */
const FEM_PLURAL = new Set(['ביצים', 'ביצי', 'עגבניות', 'עגבניות', 'פיתות', 'עוגיות', 'עוגות', 'לחמניות', 'חלות', 'מצות', 'פיצות', 'לביבות', 'פטריות', 'צלעות', 'שוקיים',
  'שוקי', 'כנפיים', 'כנפי', 'נקניקיות', 'קציצות', 'שקיות', 'סוללות', 'פחיות', 'קופסאות', 'תרופות', 'מגבות', 'גבינות', 'תאנים', 'עדשים', 'סוכריות', 'צנוניות', 'פרוסות', 'אצבעות', 'מנות', 'בננות', 'חסות', 'שעועיות',
  'קלמנטינות', 'טבליות', 'קפסולות', 'מפיות', 'פריכיות', 'פרגיות', 'אטריות', 'בטטות', 'כרעיים', 'מברשות', 'כוסות', 'צלחות', 'מטליות', 'טורטיות', 'חמניות', 'נורות']);
export const isFemPlural = (name) => { const w = String(name || '').trim().split(/\s+/).filter((x) => x !== 'מיני')[0] || ''; return FEM_PLURAL.has(w); }; // a closed list (41, ב)
/** by the product: m, f, p, and pf for a plural that is feminine (when given; else p) */
export const byGender = (name, m, f, p, pf) => (pf != null && isFemPlural(name) ? pf : ({ m, f, p: p ?? m })[genderOf(name)]);
/**
 * How Shuki words something to a person or about one (פ22, the owner 06/10, r7b): `u` a user (or a gender, 'm' / 'f' / 'p'),
 * m, f and p the three forms. p, "בלשון רבים", is stage 7ב's: it is kept (GENDERS in worker/index.js), and until its page
 * of wordings is approved every call gives it the m form. Every call gives all four, so 7ב finds every place
 * (test/gender-static.test.js); only isWoman passes null.
 */
export const byPerson = (u, m, f, p) => { const g = typeof u === 'string' ? u : u?.gender; return g === 'f' ? f : g === 'p' && p != null ? p : m; };
/** A woman, for counting people (D9's "אבא ואמא", two mothers), not for wording. */
export const isWoman = (u) => byPerson(u, false, true, null);
/** Shuki's "want me to remember…?" in one place (r8z 11/10, question 31, line 14): "האם תרצה / תרצי / תרצו שאזכור" */
export const rememberAsk = (u) => byPerson(u, 'האם תרצה שאזכור', 'האם תרצי שאזכור', 'האם תרצו שאזכור');
/** Who chose the plural (7ב): not counted as a father nor as a mother, but named (the owner r7d, question 8). */
export const isPlural = (u) => byPerson(u, false, false, true);
/** For counting parents: 'm', 'f', or 'p' (named, not counted). */
export const parentKind = (u) => byPerson(u, 'm', 'f', 'p');
/**
 * Who a child's parents are, in words (decision 5, the owner 06/10, r7b): the grown-ups still in the house (by id) →
 * { one: user } · { two: 'אבא או אמא' } (a father and a mother) · { two: 'אבא אבי או אבא דני', word: 'אבא', names, f } ·
 * { many: true } (3 or more) · null (none). Shared by the server and the app (a child's recipe, the same rule).
 * Two, and one or both chose the plural (7ב, the owner r7d, question 8): { two: 'אבא או נועם', parts: ['אבא', 'נועם'] }, the one
 * who chose it by name and the other as a father or a mother; both: { two: 'נועם או עדי', parts }.
 */
export function parentsOr(users) {
  const adults = (users || []).filter((u) => u.role !== 'child' && u.active !== 0).sort((a, b) => a.id - b.id);
  if (!adults.length) return null;
  if (adults.length === 1) return { one: adults[0] };
  if (adults.length > 2) return { many: true };
  const [a, b] = adults;
  if (isPlural(a) || isPlural(b)) {
    const call = (u) => (isPlural(u) ? u.name : isWoman(u) ? 'אמא' : 'אבא');
    const parts = isPlural(a) && !isPlural(b) ? [call(b), call(a)] : [call(a), call(b)];
    return { two: `${parts[0]} או ${parts[1]}`, parts };
  }
  const f = isWoman(a);
  if (f !== isWoman(b)) return { two: 'אבא או אמא' };
  const word = f ? 'אמא' : 'אבא';
  return { two: `${word} ${a.name} או ${word} ${b.name}`, word, names: [a.name, b.name], f };
}

/** "in" before a place's name (home18, the owner 17/10: "במעל המקרר" was seen in a card): a place that starts with a preposition ("מעל
 * המקרר", "מתחת לכיור", "ליד הדלת") takes none; any other takes ב, without its ה ("המרפסת" → "במרפסת"). The one place that
 * does this, in the server and in the app. `none`: what to say with no place. */
const PLACE_PREPS = /^(מעל|מתחת|ליד|על|בתוך|מאחורי|בין)(\s|$)/;
export const inPlace = (n, none = '') => { const s = String(n || '').trim(); return !s ? none : PLACE_PREPS.test(s) ? s : `ב${s.replace(/^ה/, '')}`; };
