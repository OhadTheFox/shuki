// Recipes with structured ingredients (round 21): each ingredient is a quantity, a unit and a name, linked to a
// product at home when Shuki can find one. That link is what the ✓/✗, the "how many people" scaling and
// "we made it" work from. Old recipes (one free-text line) are converted the first time they're loaded.
// Shared by the app and the server (like hebrew.js): the app works out ✓/✗ for any number of people without a signal.

/** The same normalising as the server's domain.norm. */
export function norm(s) {
  return String(s || '').toLowerCase().replace(/[\u0591-\u05C7]/g, '').replace(/["'`׳״.,;:!?()\-_/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const isOut = (p) => (p.count_type === 'level' ? p.level === 'none' || !p.level : p.count_type === 'inuse' ? !p.is_open && !(p.qty > 0) : !(p.qty > 0));

const NUM_WORDS = {
  'חצי': 0.5, 'רבע': 0.25, 'שליש': 1 / 3, 'אחד': 1, 'אחת': 1, 'שני': 2, 'שתי': 2, 'שניים': 2, 'שתיים': 2, 'שלוש': 3, 'שלושה': 3,
  'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9, 'עשר': 10, 'עשרה': 10,
};
const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

// the units recipes use, every form people write → the singular
const UNITS = {};
for (const [one, ...forms] of [
  ['כוס', 'כוסות', 'כוסות'], ['כף', 'כפות'], ['כפית', 'כפיות'], ['גרם', 'גר', "גר'", 'ג'], ['ק"ג', 'קג', 'קילו', 'קילוגרם'],
  ['ליטר', 'ל'], ['מ"ל', 'מל'], ['קורט'], ['שן', 'שיני', 'שיניים'], ['צרור', 'צרורות'], ['ענף', 'ענפי', 'ענפים'],
  ['פרוסה', 'פרוסות', 'פרוסת'], ['קופסה', 'קופסא', 'קופסאות', 'קופסת'], ['פחית', 'פחיות', 'פחיות'], ['שקית', 'שקיות'],
  ['חבילה', 'חבילות', 'חבילת'], ['גביע', 'גביעים', 'גביעי'], ['מיכל', 'מיכלים'], ['צנצנת', 'צנצנות'], ['בקבוק', 'בקבוקים', 'בקבוקי'],
  ['יחידה', 'יחידות'], ['קרטון', 'קרטונים', 'קרטוני'], ['אריזה', 'אריזות', 'אריזת'], ['חופן', 'חופנים'], ['קוביה', 'קוביות', 'קוביית'],
  ['פילה', 'פילטים', 'פילטי', 'פילט'], ['נתח', 'נתחים', 'נתחי'],
]) for (const f of [one, ...forms]) UNITS[f] = one;
// home19 (3, the owner 17/10): "3 פילה אנשובי" is three fillets of anchovy, "4 נתחי עוף" four pieces of chicken: a unit only after a
// number. With none, the words are the name ("פילה סלמון"), and linking reads through them (afterUnit)
const NUMBERED_UNITS = new Set(['פילה', 'נתח']);
// one of each unit as lineOf writes it ("כוס", "קופסת"), and the singular itself ("קופסה של…")
const ONE_FORMS = {};
for (const one of new Set(Object.values(UNITS))) if (!NUMBERED_UNITS.has(one)) { ONE_FORMS[one] = one; ONE_FORMS[one.replace(/ה$/, 'ת')] = one; }
for (const f of ['קופסא', 'קוביית', 'קילו', 'קג', 'קילוגרם', 'גר', "גר'", 'מל']) ONE_FORMS[f] = UNITS[f]; // how people write them
// measured in the kitchen, not counted at home: never taken off the inventory by number
export const KITCHEN_UNITS = new Set(['כוס', 'כף', 'כפית', 'גרם', 'ק"ג', 'ליטר', 'מ"ל', 'קורט', 'שן', 'צרור', 'ענף', 'פרוסה', 'חופן', 'קוביה', 'פילה', 'נתח']);

export const UNIT_SIZE = new Set(['גדושה', 'גדושות', 'גדוש', 'גדושים', 'שטוחה', 'שטוחות', 'שטוח', 'שטוחים', 'מלאה', 'מלאות', 'מלא', 'מלאים', 'עגולה', 'עגולות', 'נדיבה', 'נדיבות', 'קטנה', 'קטנות', 'גדולה', 'גדולות', 'קטן', 'גדול', 'קטנים', 'גדולים']);
// how it's prepared, not what it is (16/10): "3 שיני שום פרוסות", "בצל קצוץ דק", "עגבנייה חתוכה לקוביות"; home19 (3, the owner
// 17/10): "עגבנייה סחוטה", "גזר מגורר", "חמאה מומסת" too: what's at home is what it's made from. Not "מרוסק" ("עגבניות
// מרוסקות" is a product: only linking reads through it, SOFT_PREP), and "טחון" stays after meat or coffee ("בשר טחון", "קפה טחון")
const PREP = /\s+(פרוס|פרוסה|פרוסים|פרוסות|קצוץ|קצוצה|קצוצים|קצוצות|ברצועות|לרצועות|לקוביות|בקוביות|לטבעות|מגורד|מגורדת|מגורדים|מגורדות|מגורר|מגוררת|מגוררים|מגוררות|סחוט|סחוטה|סחוטים|סחוטות|קלוף|קלופה|קלופים|קלופות|מומס|מומסת|מומסים|מומסות|מבושל|מבושלת|מבושלים|מבושלות|טרי|טרייה|טריה|טריים|טריות|חתוך|חתוכה|חתוכים|חתוכות|טחון|טחונה|טחונים|טחונות)(?=\s|$)(\s+(דק|דקה|דקים|דקות|גס|גסה|גסים|גסות|קטנות|קטנים|גדולות|גדולים|דק דק|לקוביות|לרצועות|לטבעות|לחצאים|לרבעים))*/g;
export function basePrep(name) {
  const n = String(name || '');
  if (/^(בשר|עוף|הודו|קפה|פלפל שחור|פלפל לבן|שקדים|אגוזים|אגוזי \S+|פרג|פשתן|שומשום)\s+טחו/.test(n.trim())) return n.trim(); // "שקדים טחונים" is its own product (the reviewer)
  if (/^שמרים\s+טרי/.test(n.trim())) return n.trim();
  if (/^מיץ\s.+\sסחוט/.test(n.trim())) return n.trim(); // "מיץ לימון סחוט" is fresh juice, not "מיץ לימון" (home19) // "שמרים טריים" aren't the dry ones (the reviewer); "טרי" goes otherwise (the owner 16/10)
  const out = n.replace(/\s*\((?:[^)]*)\)\s*$/, '').replace(PREP, '').replace(/\s+/g, ' ').trim();
  const note = /\s*\((?:[^)]*)\)\s*$/.exec(n)?.[0]?.trim(); // "פטה (לא חובה)" keeps its note
  return out ? (note ? `${out} ${note}` : out) : n.trim();
}

/** One ingredient line → { qty, unit, name, line }. "2 כפות שמן זית", "בצל אחד", "חצי כוס סוכר", "ביצים 4". */
export function parseLine(line) {
  let s = String(line || '').replace(/^[\s•\-*·–]+/, '').replace(/\s+/g, ' ').trim();
  const orig = s;
  if (!s) return null;
  let qty = null;
  const num = (t) => {
    if (t in FRACTIONS) return FRACTIONS[t];
    if (/^\d+\/\d+$/.test(t)) { const [a, b] = t.split('/').map(Number); return b ? a / b : null; }
    if (/^\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
    const m = /^(\d+)([½¼¾⅓⅔])$/.exec(t); if (m) return Number(m[1]) + FRACTIONS[m[2]];
    return NUM_WORDS[t] ?? null;
  };
  // a leading number, "1-2" (the larger), "1 וחצי"
  let m = /^(\d+(?:[.,]\d+)?|\d+\/\d+|[½¼¾⅓⅔]|\d+[½¼¾⅓⅔])(?:\s*-\s*(\d+(?:[.,]\d+)?))?\s+(.*)$/.exec(s);
  if (m) { qty = num(m[2] || m[1]); s = m[3]; if (/^וחצי\s/.test(s)) { qty += 0.5; s = s.slice(5); } }
  else {
    const w = s.split(' ');
    if (w.length > 1 && NUM_WORDS[w[0]] != null) { qty = NUM_WORDS[w[0]]; s = w.slice(1).join(' '); if (/^וחצי\s/.test(s)) { qty += 0.5; s = s.slice(5); } }
  }
  let unit = null;
  const w = s.split(' ');
  const w0 = w[0].replace(/[,:]$/, '');
  // stage 11, question 13 (the owner 15/10): with no number, a unit word reads as one only in the form lineOf writes for one
  // ("כוס קמח", "ליטר חלב", "קופסת טונה", "קובית שמרים"); any other form is part of the name ("קוביות קרח", "שיני שום").
  // a weight with no number is "how much you like" ("גרם", as lineOf writes no quantity: one of a weight is "1 גרם")
  const one = ONE_FORMS[w0];
  if (w.length > 1 && qty == null && one) { unit = one; qty = WEIGHT_UNITS.has(one) ? null : 1; s = w.slice(1).join(' ').replace(/^של\s+/, ''); }
  else if (w.length > 1 && qty != null && UNITS[w0]) { unit = UNITS[w0]; s = w.slice(1).join(' ').replace(/^של\s+/, ''); }
  // a word that tells the unit's size is the unit's, not the name's (16/10: "כף גדושה סוכר" is sugar, "כפית שטוחה מלח")
  if (unit) { const v = s.split(' '); if (v.length > 1 && UNIT_SIZE.has(v[0])) s = v.slice(1).join(' '); }
  if (unit && /^וחצי\s/.test(s)) { qty = (qty ?? 1) + 0.5; s = s.slice(5); } // "כוס וחצי סוכר"
  // at the end: "בצל אחד", "ביצים 4", "שום 3 שיניים"
  if (qty == null) {
    const e = /^(.+?)\s+(\d+(?:[.,]\d+)?|[½¼¾]|אחד|אחת|שתיים|שניים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|חצי)(?:\s+(\S+))?$/.exec(s);
    if (e && (!e[3] || UNITS[e[3]])) { qty = num(e[2]); if (e[3]) unit = UNITS[e[3]]; s = e[1]; }
    // the number at the end, the unit at the start: "שיני שום 3", "כפות סוכר 2"
    const v = s.split(' ');
    if (qty != null && unit == null && v.length > 1 && UNITS[v[0]]) { unit = UNITS[v[0]]; s = v.slice(1).join(' '); }
  }
  if (unit == null && qty == null && /^קורט\s/.test(s)) { unit = 'קורט'; s = s.slice(5); }
  // "קופסת רסק", "חבילה של פסטה": one
  if (qty == null && unit && !KITCHEN_UNITS.has(unit)) qty = 1;
  s = s.replace(/\s*\((?:[^)]*)\)\s*$/, (x) => x).trim(); // notes in brackets stay part of the name
  s = s.replace(/[.,;:]+$/, '').trim();
  s = basePrep(s); // "2 גמבות ברצועות" is גמבות: the line keeps how it's cut (16/10)
  if (!s) return { qty: null, unit: null, name: orig, line: orig };
  return { qty: qty != null && qty > 0 ? Math.round(qty * 1000) / 1000 : null, unit, name: s.slice(0, 80), line: orig.slice(0, 120) };
}

/** A recipe's ingredients as text → one object per ingredient. New recipes: a line each; old ones: commas. */
export function parseIngredients(text) {
  const t = String(text || '').replace(/^\s*מצרכים\s*:?\s*/, '').trim();
  if (!t) return [];
  const lines = t.includes('\n') ? t.split('\n') : t.split(/,(?!\d)|؛|;/);
  return lines.map(parseLine).filter(Boolean).slice(0, 60);
}

// always in the kitchen (decision, 30/09): never "missing", unless it ran out at home
const STAPLES = /^(מלח|פלפל שחור|מלח ופלפל|מלח פלפל|פלפל לבן|פלפל גרוס|שמן|שמן זית|שמן קנולה|שמן צמחי|שמן לטיגון|מים|מים חמים|מים קרים|סוכר|סוכר לבן|תבלינים|כמון|פפריקה|פפריקה מתוקה|פפריקה חריפה|כורכום|אורגנו|קינמון|זעתר|בהרט|ראס אל חנות|אבקת שום|אבקת בצל|עלי דפנה|זרעי שומשום|אגוז מוסקט|ציפורן|הל|ג'ינג'ר טחון|צ'ילי גרוס|פתיתי צ'ילי|תימין|רוזמרין יבש|בזיליקום יבש|שמיר יבש|פטרוזיליה יבשה|מלח גס|מלח דק|מלח לים|סוכר חום)$/;
/** A name that starts with a unit word ("שיני שום", "כפות שמן זית", question 13 keeps them whole): the name after it. */
const SOFT_PREP = /\s+(מרוסק|מרוסקת|מרוסקים|מרוסקות)(?=\s|$)/g;
const afterUnit = (name) => { const w = String(name || '').trim().split(/\s+/); return w.length > 1 && UNITS[w[0]] ? w.slice(1).join(' ') : null; };
export function isStaple(name, unit) {
  const alts = alternativesOf(name);
  if (alts) return alts.some((a) => a.some((x) => isStaple(x, unit)));
  const rest = afterUnit(name);
  if (rest && isStaple(rest, unit || UNITS[String(name).trim().split(/\s+/)[0]])) return true;
  const n = norm(name).replace(/^ה(?=\S)/, '');
  if (STAPLES.test(n)) return true;
  if (n === 'פלפל' && (!unit || KITCHEN_UNITS.has(unit) || unit === 'קורט')) return true; // "פלפל" by the pinch is black pepper
  if (/(^| )לפי הטעם$/.test(n)) return true;
  return false;
}

/** An ingredient written as optional: "פטה (לא חובה)". */
export const isOptional = (name) => /\(\s*לא חובה\s*\)\s*$/.test(String(name || ''));

/**
 * home19 (3, the owner 17/10): "שמן חמניות או קנולה" is either. The choices in their order, each as the names to try: the words
 * as written, and a one-word choice after a longer one also with the first one's head noun ("קנולה" → "שמן קנולה").
 * One name: null.
 */
export function alternativesOf(name) {
  const n = String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const parts = n.split(/\s+או\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const head = parts[0].split(' ');
  return parts.map((p, k) => (k && head.length > 1 && !p.includes(' ') ? [p, `${head[0]} ${p}`] : [p]));
}
/** The product at home an ingredient is, or null: the name or an alias, then the longest contained name, then the first word. */
export function linkProduct(name, products) {
  // either of two (home19, 3): the first choice that is at home, else the first that is in the inventory at all
  const alts = alternativesOf(name);
  if (alts) {
    const found = alts.map((a) => a.reduce((p, x) => p || linkProduct(x, products), null)).filter(Boolean);
    if (found.length) return found.find((p) => !(p.out ?? isOut(p))) || found[0];
  }
  const rest = afterUnit(name), base = basePrep(name);
  const one = linkName(name, products) || (rest ? linkName(rest, products) : null) || (base !== String(name || '').trim() ? linkName(base, products) || (afterUnit(base) ? linkName(afterUnit(base), products) : null) : null);
  if (one) return one;
  // home19 (3): "עגבניות מרוסקות" with only tomatoes at home is made from them (the name keeps the word: it may be a can)
  const soft = basePrep(String(name || '').replace(SOFT_PREP, ''));
  if (soft && soft !== base) { const p = linkName(soft, products) || (afterUnit(soft) ? linkName(afterUnit(soft), products) : null); if (p) return p; }
  // "מיץ לימון סחוט" is squeezed from lemons
  const juice = /^מיץ\s+(.+?)\s+סחוט/.exec(String(name || '').trim());
  return juice ? linkName(juice[1], products) : null;
}
// the same thing by another name (16/10): "גמבה" is "פלפל אדום"; both ways
const SAME = [['גמבה', 'פלפל אדום'], ['גמבה צהובה', 'פלפל צהוב'], ['כוסברה', 'כוסבר'], ['בצל ירוק', 'בצלצל'], ['שמנת חמוצה', 'שמנת 15%'], ['ג\'ינג\'ר', 'זנגביל'], ['קישוא', 'זוקיני'], ['חציל', 'חצילים']];
/** one word to compare, singular or plural: "גמבות" ~ "גמבה", "עגבניות" ~ "עגבנייה", "שיני" ~ "שן" */
const stem = (w) => w.replace(/יי/g, 'י').replace(/(ים|ות|ה|י)$/, '').replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ');
const plural = (w) => /(ים|ות|י)$/.test(w);
/** the same word, one singular and one plural: "גמבה"/"גמבות", "ביצה"/"ביצים", "תפוח"/"תפוחי"; not "חלבה"/"חלב", "שמנת"/"שמן" */
const sameWord = (a, b) => a === b || ((plural(a) !== plural(b)) && stem(a).length >= 2 && stem(a) === stem(b));
// (not "יבש", "מיובש": "שמרים יבשים", "אורגנו מיובש" are what the house has as "שמרים", "אורגנו")
// the word after the ingredient's name in the product's ("לימון" / "לימון כבוש"), or after the product's in the ingredient's ("חלב" /
// "חלב קוקוס"); "משומר" only in the ingredient's: "עגבניות משומרות" aren't tomatoes, but "עלי גפן" may be "עלי גפן משומרים"
const OTHER_THING = /^(כבוש|כבושה|כבושים|כבושות|משומר|משומרת|משומרים|משומרות|מעושן|מעושנת|מעושנים|מעושנות|פרסי|קוקוס|סויה|שקדים|שיבולת|אורז|אבקה|אבקת)$/;
const PRESERVED = /^(משומר|משומרת|משומרים|משומרות)$/;
const isOther = (w, productLonger) => OTHER_THING.test(w || '') && !(productLonger && PRESERVED.test(w));
/** home19 (3): the product is another thing than the ingredient, by the word right after the shorter of the two names, word
 * by word, singular or plural ("לימון" and "לימון פרסי שחור", "מלפפונים" and "מלפפון כבוש ביתי"); for the once-only relink of
 * links made by the old rules. */
export function otherThing(ingName, productName) {
  const a = norm(basePrep(ingName)).replace(/^ה(?=\S)/, '').split(' '), b = norm(productName).split(' ');
  if (a.length === b.length) return false;
  const [l, sh] = a.length > b.length ? [a, b] : [b, a];
  return sh.every((w, k) => w === l[k] || stem(w) === stem(l[k])) && isOther(l[sh.length], l === b);
}
// the names a product goes by first, then (home19, 3) also what comes after a unit word at their start ("צרור פטרוזיליה")
const linkName = (name, products) => linkName0(name, products, false) || linkName0(name, products, true);
function linkName0(name, products, more) {
  const live = products.filter((p) => !p.deleted);
  const n = norm(name).replace(/^ה(?=\S)/, '');
  if (!n) return null;
  // a product's name that starts with a unit word is also what comes after it (home19, 3: "פילה אנשובי" is "אנשובי")
  const names = (p) => [p.name, ...(Array.isArray(p.aliases) ? p.aliases : JSON.parse(p.aliases || '[]'))].flatMap((x) => (more ? [afterUnit(x)] : [x])).filter(Boolean).map((x) => norm(x));
  const sing = (w) => w.replace(/(ים|ות)$/, ''); // "ביצים" ~ "ביצ", "עגבניות" ~ "עגבני"
  const exact = live.find((p) => names(p).some((x) => x === n));
  if (exact) return exact;
  // singular or plural, word by word ("גמבות" is "גמבה", "עגבניות" is "עגבנייה"), and the same thing by another name
  const sameName = (x, y) => { const a = x.split(' '), b = y.split(' '); return a.length === b.length && a.every((w, k) => sameWord(w, b[k])); };
  const syn = SAME.flatMap(([a, b]) => (sameName(norm(a), n) ? [norm(b)] : sameName(norm(b), n) ? [norm(a)] : []));
  const byForm = live.find((p) => names(p).some((x) => sameName(x, n) || syn.some((y) => sameName(x, y))));
  if (byForm) return byForm;
  const words = n.split(' ');
  // the head noun comes first in Hebrew: "פטרוזיליה קצוצה" is parsley, "ביצים" are "ביצים L", but "רסק עגבניות" is not tomatoes
  // home19 (3): but not when the word after it makes it another thing ("לימון כבוש", "לימון פרסי שחור", "חלב קוקוס" aren't lemons or milk)
  const other = (longer, shorter, productLonger) => isOther(longer.slice(shorter.length + 1).split(' ')[0], productLonger);
  const inside = live.filter((p) => names(p).some((x) => x.length >= 2 && ((`${n} `.startsWith(`${x} `) && !other(n, x, false)) || (`${x} `.startsWith(`${n} `) && !other(x, n, true))))).sort((a, b) => b.name.length - a.name.length)[0];
  if (inside) return inside;
  // word by word, plural or not: "פלפלים חריפים" is "פלפל חריף", but "פלפל שחור" is not (01/10)
  const fin = (w) => w.replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ');
  const same = (a, b) => fin(sing(a)) === fin(sing(b));
  const first = live.find((p) => { const pw = norm(p.name).split(' '), f = pw[0]; return f.length >= 3 && sing(f).length >= 3 && same(f, words[0]) && pw.slice(1, words.length).every((x, k) => same(x, words[k + 1])) && !isOther((words.length > pw.length ? words : pw)[Math.min(words.length, pw.length)], pw.length > words.length); });
  return first || null;
}

const COUNTED = new Set(['units', 'pack', 'batches']);
const PACKAGE_UNITS = new Set(['יחידה', 'קופסה', 'פחית', 'שקית', 'חבילה', 'גביע', 'מיכל', 'צנצנת', 'בקבוק', 'קרטון', 'אריזה']);
/** Counted the same way at home as in the recipe, so a number can be compared and taken off: "6 ביצים", "2 קופסאות רסק". */
export function countable(ing, p) {
  if (!p || ing.qty == null || !COUNTED.has(p.count_type)) return false;
  if (!ing.unit && NUMBERED_UNITS.has(UNITS[String(ing.name || '').trim().split(/\s+/)[0]])) return false; // "3 פילה אנשובי" saved before home19: fillets, not cans
  if (!ing.unit) return p.count_type === 'pack' || !p.unit || p.unit === 'יחידה' || /ביצ/.test(p.name);
  if (KITCHEN_UNITS.has(ing.unit)) return false;
  if (p.count_type === 'pack') return false; // a pack product counts single units; "2 אריזות" is a different number
  return PACKAGE_UNITS.has(ing.unit) && (!p.unit || p.unit === ing.unit || p.unit === 'יחידה');
}

/**
 * Each ingredient against the house, for `people` (or as written): ok, and when short, by how much.
 * Missing = not enough for the recipe (4 eggs, 6 needed = 2 missing); staples only when they ran out.
 */
export function recipeStatus(recipe, ings, products, people) {
  const serves = Number(recipe.serves) || null;
  const k = serves && people && people !== serves ? people / serves : 1;
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = ings.map((i) => {
    let p = i.product_id != null ? byId.get(i.product_id) : null;
    // "שמן חמניות או קנולה" (home19, 3): when the one it's linked to isn't at home, another choice that is
    const alts = alternativesOf(i.name);
    if (alts && (!p || p.deleted || (p.out ?? isOut(p)))) { const q = linkProduct(i.name, products.filter((x) => !x.deleted && !(x.out ?? isOut(x)))); if (q) p = q; }
    const live = p && !p.deleted ? p : null;
    const need = i.qty != null ? Math.round(i.qty * k * 100) / 100 : null;
    const staple = isStaple(i.name, i.unit);
    const out = live ? (p.out ?? isOut(p)) : null;
    const counted = countable(i, live);
    const have = counted ? Number(live.qty) || 0 : null;
    let ok; let short = 0;
    if (staple) ok = !(live && out);
    else if (!live || out) { ok = false; short = counted || (need && !i.unit) ? Math.ceil(need) : 0; }
    else if (counted && need != null && have < need) { ok = false; short = Math.ceil(need - have); }
    else ok = true;
    // "פטה (לא חובה)" (approved 30/09): never missing and never on the list; ✓ only when it's at home
    const optional = isOptional(i.name), here = ok;
    if (optional) { ok = true; short = 0; }
    // listName: what goes on the list, the product's name at home, or the name without how it's cut (16/10)
    // alt: which of the choices is at home (home19, 3)
    return { id: i.id, name: i.name, listName: live ? live.name : basePrep(i.name), qty: i.qty, unit: i.unit, need, have, ok, short, staple, counted, optional, here, product_id: live ? live.id : null, alt: alts && live && !out ? live.name : null };
  });
  return { people: people || serves || null, serves, items, missing: items.filter((x) => !x.ok).length };
}

/**
 * home19 (infrastructure for 7): what a recipe needs from the house, by the same parsing and linking as the recipes screen,
 * for the server as for the app. `recipe`: a saved recipe ({ serves, ings }), a list of ingredients ({ name, qty, unit,
 * product_id? }), or the ingredients as text. An ingredient with no product_id given (text, or a recipe not saved) is linked
 * here; one with product_id (also null: unlinked by hand) keeps it. `products`: the ones the asker may see, with count_type,
 * qty, level and is_open (or `out`). Each item: have (not missing), product ({ id, name } or null), alt (which choice of an
 * "או" ingredient is at home), short, staple, optional, listName (what goes on the list).
 */
export function missingFor(recipe, products, people) {
  const text = typeof recipe === 'string';
  const ings = text ? parseIngredients(recipe) : Array.isArray(recipe) ? recipe : Array.isArray(recipe?.ings) ? recipe.ings : parseIngredients(recipe?.ingredients);
  const live = products.filter((p) => !p.deleted);
  const linked = ings.map((i, k) => ({ ...i, id: i.id ?? k, product_id: i.product_id !== undefined ? i.product_id : linkProduct(i.name, live)?.id ?? null }));
  const st = recipeStatus(text || Array.isArray(recipe) ? {} : recipe, linked, products, people);
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = st.items.map((x) => ({ ...x, have: x.ok, product: x.product_id != null ? { id: x.product_id, name: byId.get(x.product_id).name } : null }));
  return { ...st, items };
}

/**
 * "We made it" (decision, 30/09): what comes off the inventory. Only what's counted in units or packages comes off by
 * number; for the rest Shuki asks "is there little left?" only where it may have run out (unticked on the card).
 * Returns [{ action, off }] — off = unticked by default.
 */
export function cookedActions(status, products) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const out = [];
  const seen = new Set(); // two ingredients of the same product: one line
  for (const it of status.items) {
    const p = it.product_id != null ? byId.get(it.product_id) : null;
    if (!p || (p.out ?? isOut(p)) || seen.has(p.id)) continue;
    seen.add(p.id);
    if (it.counted && it.need) { out.push({ action: { kind: 'op', product_id: p.id, op: { type: 'use', amount: Math.min(it.need, Number(p.qty) || it.need) } }, off: false }); continue; }
    if (it.staple && p.count_type !== 'level' && p.count_type !== 'inuse') continue;
    // may have run out: the last of it, or "a little" before
    if (p.count_type === 'level') {
      if (p.level === 'plenty') out.push({ action: { kind: 'op', product_id: p.id, op: { type: 'set', level: 'little' } }, off: true });
      else if (p.level === 'little') out.push({ action: { kind: 'op', product_id: p.id, op: { type: 'out' } }, off: true });
    } else if (p.count_type === 'inuse') {
      if (!(Number(p.qty) > 0)) out.push({ action: { kind: 'op', product_id: p.id, op: { type: 'low' } }, off: true });
    } else if (Number(p.qty) <= 1) out.push({ action: { kind: 'op', product_id: p.id, op: { type: 'low' } }, off: true });
  }
  return out;
}

// a kosher house (decision, 30/09): meat with milk, seafood, pork
export const MEAT = /(^| )(נקניקייה|נקניקיה|קבנוס|בייקון|פפרוני|אווז|ברווז|כרעיים|קורקבנים|שניצלונים|בשר|בקר|עוף|עופות|הודו|כבש|טלה|עגל|פרגית|פרגיות|חזה עוף|שוקיים|כנפיים|כבד|קבב|קציצות בשר|שניצל|נקניק|נקניקיות|סלמי|פסטרמה|אנטריקוט|סטייק|המבורגר|צלעות|אסאדו|שווארמה|קורנביף|מרגז|צוואר)( |$)/;
export const MILK = /(^| )(קשקבל|חלומי|קממבר|לאבנה|קרם פרש|קפיר|רוקפור|גורגונזולה|בשמל|שוקו|קוטג'|חלב|גבינה|גבינת|גבינות|חמאה|שמנת|יוגורט|לבנה|מוצרלה|פרמזן|צהובה|ריקוטה|קוטג|מסקרפונה|פטה|בולגרית|צפתית|גאודה|צ'דר|שמנת חמוצה|שמנת מתוקה|חלב מרוכז|גבינת שמנת)( |$)/;
export const PAREVE = /(חלב קוקוס|חלב סויה|חלב שקדים|חלב שיבולת|חלב אורז|שמנת צמחית|חמאת בוטנים|חמאת שקדים|חמאת קקאו|מרגרינה|שמנת קוקוס|גבינה טבעונית|גבינה צמחית)/;
export const SEAFOOD = /(^| )(שרימפס|חסילונים|קלמרי|קלמארי|תמנון|סרטן|סרטנים|צדפות|צדפה|לובסטר|פירות ים|מולים|סקאלופ|שבלולים|רכיכות)( |$)/;
export const PORK = /(^| )(חזיר|בייקון|פנצ'טה|פרושוטו|קותלי חזיר|צלעות חזיר|גואנצ'אלה|שינקן)( |$)/;
// fish (0e, the owner 02/10): for the server's "⚠" next to a recipe, with a diet fact; not used for kashrut
export const FISH = /(^| )(דג|דגים|סלמון|טונה|אמנון|מושט|דניס|לברק|בקלה|סרדינים|סרדין|אנשובי|פילה דג|הרינג|מקרל|טילפיה|בורי)( |$)/;
// ד5 (stage 8): a period of keto or paleo, for the server's "⚠" next to a recipe
export const KETO = /(^| )(סוכר|קמח|לחם|לחמניה|לחמניות|פיתה|פיתות|אורז|פסטה|ספגטי|אטריות|תפוח אדמה|תפוחי אדמה|בטטה|תירס|קוסקוס|בורגול|דבש|פירורי לחם|פתיתים|שיבולת שועל)( |$)/;
export const PALEO = /(^| )(סוכר|קמח|לחם|לחמניה|לחמניות|פיתה|פיתות|אורז|פסטה|ספגטי|אטריות|קוסקוס|בורגול|פתיתים|שיבולת שועל|תירס|פירורי לחם|קטניות|עדשים|חומוס|שעועית|אפונה|סויה|טופו|בוטנים)( |$)/;
/** Why a recipe doesn't fit a kosher house: 'meatMilk', 'seafood', 'pork', or null. */
export function kosherProblem(ings) {
  const names = ings.map((i) => norm(i.name));
  if (names.some((n) => PORK.test(n))) return 'pork';
  if (names.some((n) => SEAFOOD.test(n))) return 'seafood';
  const meat = names.some((n) => MEAT.test(n));
  const milk = names.some((n) => !PAREVE.test(n) && MILK.test(n));
  return meat && milk ? 'meatMilk' : null;
}
/**
 * home19 (4, the owner 17/10): the "שימו לב" Shuki wrote when the recipe was saved ("יש במתכון כוסברה"), as it is for the ingredients
 * the recipe has now: a part "יש במתכון X" whose X is in none of them goes (the cilantro was edited into parsley). X by its
 * words, singular or plural ("בוטנים" is in "חמאת בוטנים"); a group by its words in the code ("דגים": FISH, "בשר": MEAT); a
 * group the code doesn't know ("גלוטן", "אגוזים") and any other sentence stay. Null when nothing is left.
 */
export function warnNow(warn, ings) {
  const w = String(warn || '').trim().replace(/^שימו לב:\s*/, '');
  if (!w) return null;
  const names = (ings || []).map((i) => norm(i.name)).filter(Boolean);
  const st = (x) => stem(x.replace(/^ה(?=\S{2})/, ''));
  const inName = (n, item) => { const a = n.split(' ').map(st), b = item.split(' ').map(st); return a.some((_, k) => b.every((x, j) => x.length >= 2 && a[k + j] === x)); };
  const GROUPS = [[/^(דג|דגים)$/, FISH], [/^(בשר|בשרים)$/, MEAT], [/^(חלב|מוצרי חלב|גבינה|גבינות|חלבי)$/, MILK], [/^(פירות ים)$/, SEAFOOD], [/^(חזיר)$/, PORK]];
  const UNKNOWN = /^(גלוטן|לקטוז|אגוזים|אגוזי עץ|קטניות|פחמימות|אלכוהול|סוכר מוסף|מוצרי \S+)$/;
  const there = (item) => {
    const t = norm(item).replace(/^ה(?=\S{2})/, '');
    if (!t || UNKNOWN.test(t)) return true;
    const g = GROUPS.find(([re]) => re.test(t));
    if (g) return names.some((n) => g[1].test(n) && !(g[1] === MILK && PAREVE.test(n)));
    return names.some((n) => inName(n, t));
  };
  const parts = w.split(/(?<=\.)\s+|,\s*(?=ו?יש במתכון)/).map((x) => x.trim()).filter(Boolean);
  const kept = parts.filter((part) => {
    const m = /^ו?יש במתכון\s+(.+?)\.?$/.exec(part);
    return !m || m[1].split(/\s*,\s*|\s+ו(?=\S{2})/).some(there);
  });
  if (kept.length === parts.length) return String(warn).trim();
  return kept.length ? kept.map((x, k) => (k ? x : x.replace(/^ו(?=יש במתכון)/, ''))).join(', ') : null;
}
/**
 * home19 (the manager, 18/10): Shuki's warning and the ones from the house's facts (the server's factWarnHits: an ingredient
 * someone is allergic to or doesn't eat), in the same words: "יש במתכון בוטנים". One already said isn't said twice.
 */
export function withFacts(warn, hits) {
  const w = String(warn || '').trim();
  const said = norm(w);
  const add = [...new Set((hits || []).map((h) => String(h || '').trim()).filter(Boolean))].filter((h) => !` ${said} `.includes(` ${norm(h)} `));
  if (!add.length) return w || null;
  return [w, ...add.map((h) => `יש במתכון ${h}`)].filter(Boolean).join(', ').replace(/^שימו לב:\s*/, '');
}
/** The house notes say it's kosher ("הכל כשר", "בית כשר"), and not "not kosher". */
export const kosherHouse = (notes) => /כשר/.test(String(notes || '')) && !/(לא|אינו|לא ממש)\s+כשר/.test(String(notes || ''));

// the cuisines and dishes Shuki files a recipe under (the approved list, 30/09); a house may add its own
export const CATEGORIES = ['ארוחות בוקר', "בראנץ'", 'ארוחות ערב', 'אוכל ביתי', 'ישראלי', 'מזרחי', 'אסייתי', 'סיני', 'יפני', 'תאילנדי', 'הודי', 'קארי', 'נודלס', 'מרקים אסייתים', 'כיסונים', 'סושי', 'איטלקי', 'פסטה', 'פיצה', 'אמריקאי', 'המבורגר', 'מקסיקני', 'אירופאי', 'ברביקיו', 'קבב', 'עוף', 'דגים', 'מאכלי ים', 'חומוס', 'פלאפל', "סנדוויץ'", 'סלט', 'מרקים', 'בולז', 'טבעוני', 'צמחוני', 'אוכל בריא', 'ללא גלוטן', 'כשר', 'קינוחים', 'עוגות', 'לחמים ומאפים', 'גלידות', 'שייק', 'קפה ותה'];
/** A recipe's categories, from the comma separated tags column. Old free tags ("דפי גיוזה") stay, as the house's own. */
export const categoriesOf = (tags) => [...new Set(String(tags || '').split(/\s*,\s*/).map((t) => t.trim()).filter(Boolean))].slice(0, 12);

/** Same recipe twice (decision, 30/09): the same link, or the same name. */
export function sameRecipe(recipes, { name, url }) {
  const n = norm(name);
  return recipes.find((r) => (url && r.url && r.url === url) || (n && norm(r.name) === n)) || null;
}

/** One ingredient back as a line, the way it's typed: "2 כפות שמן זית", "קופסת טונה", "חצי כוס סוכר", "מלח". */
export function lineOf(i) {
  // the line as it was written ("כף גדושה סוכר", "2 גמבות ברצועות"), as long as it still says this
  // (only when it says more than the usual line would: a size or how it's cut; otherwise the usual line, "פרוסת נענע")
  if (i.line && (new RegExp(PREP.source).test(` ${String(i.line).split(/\s+/).slice(1).join(' ')}`) || String(i.line).split(/\s+/).some((w) => UNIT_SIZE.has(w)))) { const p = parseLine(i.line); if (p && p.name === i.name && (p.unit ?? null) === (i.unit ?? null) && (p.qty ?? null) === (i.qty ?? null)) return p.line; }
  const n = i.qty != null ? Math.round(i.qty * 100) / 100 : null;
  if (n === 1 && i.unit && !WEIGHT_UNITS.has(i.unit) && !NUMBERED_UNITS.has(i.unit)) return `${i.unit.replace(/ה$/, 'ת')} ${i.name}`; // "קופסת טונה", "כוס סוכר"
  if (n === 1 && !i.unit) return i.name;
  const q = n == null ? '' : QTY_WORDS[n] ?? String(n);
  return [q, i.unit ? unitWord(i.unit, n) : '', i.name].filter(Boolean).join(' ');
}
// stage 11, question 4 (approved 15/10): a quarter, a third and the like in words or as a fraction, not "0.25"; the rest as
// numbers ("1.5 כוסות"). parseLine reads all of them back ("רבע", "שליש" in NUM_WORDS; "3/4" as a fraction)
const QTY_WORDS = { 0.5: 'חצי', 0.25: 'רבע', 0.33: 'שליש', 0.75: '3/4', 0.67: '2/3' };
// one of a weight is "1 גרם שמרים", not "גרם שמרים" (question 4)
const WEIGHT_UNITS = new Set(['גרם', 'ק"ג']);
const PLURAL = { 'כוס': 'כוסות', 'כף': 'כפות', 'כפית': 'כפיות', 'שן': 'שיני', 'צרור': 'צרורות', 'ענף': 'ענפי', 'פרוסה': 'פרוסות', 'קופסה': 'קופסאות', 'פחית': 'פחיות', 'שקית': 'שקיות', 'חבילה': 'חבילות', 'גביע': 'גביעים', 'מיכל': 'מיכלים', 'צנצנת': 'צנצנות', 'בקבוק': 'בקבוקים', 'יחידה': 'יחידות', 'קרטון': 'קרטונים', 'אריזה': 'אריזות', 'חופן': 'חופנים', 'קוביה': 'קוביות', 'נתח': 'נתחי' };
export const unitWord = (u, n) => (n != null && n > 1 && PLURAL[u] ? PLURAL[u] : u);

