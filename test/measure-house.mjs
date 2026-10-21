// Stage 0 measurement: the fixed house, as SQL for a fresh D1 (all times relative to FIXED_NOW). Run: node test/measure-house.mjs <out.sql>
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const N = 1791298800000; // Tue 06/10/2026 18:00 Asia/Jerusalem
const H = 3600e3, D = 86400e3;
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const cat = (n) => `(SELECT id FROM categories WHERE name = ${q(n)})`;
const loc = (n) => `(SELECT id FROM locations WHERE name = ${q(n)})`;
const out = [];
out.push(`-- Stage 0 measurement: the fixed house (generated). Times are relative to FIXED_NOW = ${N} (Tue 06/10/2026 18:00, Asia/Jerusalem).
-- Size is an assumption, not a measurement (docs/stage0-architecture.md, 0א): 40 products, 6 on the list, 10 lessons, 2 recipes, 12 chat messages.
-- No lesson is about milk: it would cancel "which milk?" (message 9).`);
out.push(`INSERT INTO users (id, name, gender, role, active, created) VALUES (1, 'אבי', 'm', 'admin', 1, ${N - 60 * D}), (2, 'מיכל', 'f', 'member', 1, ${N - 60 * D}), (3, 'יואבי', 'm', 'child', 1, ${N - 60 * D});`);
out.push(`INSERT INTO settings (key, value) VALUES ('ask_once:likes:1', '1'), ('ask_once:likes:2', '1'), ('ask_once:recipe_tip:1', '1'), ('ask_once:recipe_tip:2', '1');`); // stage 8, ז4 and ז5: a house running for two months was asked them already
out.push(`INSERT INTO settings (key, value) VALUES ('house_name', 'הבית של אבי ומיכל'), ('tz', 'Asia/Jerusalem'), ('house_notes', 'הכל כשר. מיכל צמחונית ואוכלת דגים.');`);
// already paired phones (a first pairing would add the welcome bubbles to the chat). Test tokens, not secrets.
const sha = (t) => createHash('sha256').update(t).digest('hex');
export const TOKENS = { avi: sha('measure-avi'), michal: sha('measure-michal'), yoavi: sha('measure-yoavi') }; // 64 hex, like a real token
out.push(`INSERT INTO devices (user_id, token_hash, name, created, last_seen) VALUES (1, '${sha(TOKENS.avi)}', 'iPhone', ${N - 60 * D}, ${N - H}), (2, '${sha(TOKENS.michal)}', 'iPhone', ${N - 60 * D}, ${N - H}), (3, '${sha(TOKENS.yoavi)}', 'iPhone', ${N - 30 * D}, ${N - 5 * H});`);

const DAIRY = 'מוצרי חלב, גבינות וביצים', VEG = 'ירקות ופירות';
// [name, category, location, count_type, unit, pack_size, qty, level, is_open, is_basic, target, store, extra]
const P = [
  ['חלב 3%', DAIRY, 'מקרר', 'units', 'קרטון', null, 1, null, 0, 1, 2, 'super', { shelf_days: 7, expires: N + 4 * D }],
  ['חלב 1%', DAIRY, 'מקרר', 'units', 'קרטון', null, 1, null, 0, 0, null, 'super', { expires: N + 5 * D }],
  ['ביצים', DAIRY, 'מקרר', 'pack', null, 12, 0, null, 0, 1, 6, 'super', {}],
  ["קוטג'", DAIRY, 'מקרר', 'units', 'גביע', null, 1, null, 0, 1, 1, 'super', { expires: N + 3 * D }],
  ['גבינה צהובה', DAIRY, 'מקרר', 'units', 'אריזה', null, 1, null, 0, 1, 1, 'super', {}],
  ['משקה סויה', DAIRY, 'מקרר', 'units', 'קרטון', null, 1, null, 0, 0, null, 'super', {}],
  ['יוגורט', DAIRY, 'מקרר', 'units', 'גביע', null, 4, null, 0, 0, null, 'super', { expires: N + 9 * D }],
  ['פטה', DAIRY, 'מקרר', 'units', 'אריזה', null, 1, null, 0, 0, null, 'super', {}],
  ['חמאה', DAIRY, 'מקרר', 'units', 'חבילה', null, 1, null, 0, 0, null, 'super', {}],
  ['עגבניות', VEG, 'מקרר', 'level', null, null, 0, 'little', 0, 1, null, 'greengrocer', {}],
  ['מלפפונים', VEG, 'מקרר', 'level', null, null, 0, 'plenty', 0, 1, null, 'greengrocer', {}],
  ['בצל', VEG, 'מזווה', 'level', null, null, 0, 'plenty', 0, 0, null, 'greengrocer', {}],
  ['שום', VEG, 'מזווה', 'level', null, null, 0, 'plenty', 0, 0, null, 'greengrocer', {}],
  ['ברוקולי', VEG, 'מקפיא', 'units', 'שקית', null, 2, null, 0, 0, null, 'super', {}],
  ['פלפל חריף', VEG, 'מקרר', 'level', null, null, 0, 'little', 0, 0, null, 'greengrocer', {}],
  ['תפוחים', VEG, 'מקרר', 'level', null, null, 0, 'none', 0, 1, null, 'greengrocer', {}],
  ['לחם פרוס', 'לחם ומאפים', 'ארון מטבח', 'units', null, null, 0, null, 0, 1, 1, 'super', {}],
  ['פיתות', 'לחם ומאפים', 'מקפיא', 'units', 'חבילה', null, 1, null, 0, 0, null, 'super', {}],
  ['פסטה', 'יבשים', 'ארון מטבח', 'units', 'חבילה', null, 3, null, 0, 1, 2, 'super', {}],
  ['אורז', 'יבשים', 'ארון מטבח', 'inuse', null, null, 0, null, 1, 0, null, 'super', {}],
  ['טונה', 'שימורים ורטבים', 'ארון מטבח', 'units', 'קופסה', null, 6, null, 0, 1, 2, 'super', {}],
  ['רסק עגבניות', 'שימורים ורטבים', 'ארון מטבח', 'units', 'קופסה', null, 2, null, 0, 0, null, 'super', {}],
  ['חומוס', 'שימורים ורטבים', 'מקרר', 'units', 'קופסה', null, 1, null, 0, 0, null, 'super', {}],
  ['שמן זית', 'תבלינים ושמנים', 'ארון מטבח', 'inuse', null, null, 0, null, 1, 1, 1, 'super', {}],
  ['מלח', 'תבלינים ושמנים', 'ארון מטבח', 'inuse', null, null, 0, null, 1, 0, null, 'super', {}],
  ['פפריקה', 'תבלינים ושמנים', 'ארון מטבח', 'inuse', null, null, 0, null, 1, 0, null, 'super', {}],
  ['כמון', 'תבלינים ושמנים', 'ארון מטבח', 'inuse', null, null, 0, null, 1, 0, null, 'super', {}],
  ['פלפל שחור', 'תבלינים ושמנים', 'ארון מטבח', 'inuse', null, null, 0, null, 1, 0, null, 'super', {}],
  ['קפה', 'משקאות', 'ארון מטבח', 'inuse', null, null, 0, null, 1, 1, 1, 'super', {}],
  ['תה', 'משקאות', 'ארון מטבח', 'units', 'קופסה', null, 1, null, 0, 0, null, 'super', {}],
  ['עוגיות', 'חטיפים ומתוקים', 'מזווה', 'units', 'חבילה', null, 1, null, 0, 0, null, 'super', {}],
  ['שוקולד', 'חטיפים ומתוקים', 'מזווה', 'units', null, null, 2, null, 0, 0, null, 'super', {}],
  ['נייר טואלט', 'חד-פעמי ונייר', 'מחסן', 'pack', null, 32, 14, null, 0, 1, 8, 'super', {}],
  ['שקיות אשפה', 'חד-פעמי ונייר', 'ארון ניקיון', 'units', 'גליל', null, 0, null, 0, 1, 1, 'super', {}],
  ['סבון כלים', 'ניקיון וכביסה', 'ארון ניקיון', 'inuse', null, null, 1, null, 1, 1, 1, 'super', {}],
  ['נוזל כביסה', 'ניקיון וכביסה', 'ארון ניקיון', 'inuse', null, null, 0, null, 1, 1, 1, 'super', {}],
  ['שמפו', 'טואלטיקה והיגיינה', 'ארון אמבטיה', 'inuse', null, null, 0, null, 1, 0, null, 'pharm', {}],
  ['משחת שיניים', 'טואלטיקה והיגיינה', 'ארון אמבטיה', 'units', null, null, 1, null, 0, 0, null, 'pharm', {}],
  ['סוללות', 'תחזוקת בית', 'מחסן', 'units', null, null, 4, null, 0, 0, null, 'super', {}],
  ['חזה עוף', 'בשר, עוף ודגים', 'מקפיא', 'batches', 'מגש', null, 2, null, 0, 0, null, 'super', {}],
];
if (P.length !== 40) throw new Error(`products: ${P.length}`);
const id = {};
P.forEach(([name, c, l, ct, unit, pack, qty, level, open, basic, target, store, x], i) => {
  const pid = i + 1; id[name] = pid;
  const by = i % 3 === 0 ? 2 : 1;
  out.push(`INSERT INTO products (id, name, category_id, location_id, count_type, unit, pack_size, qty, level, is_open, is_basic, target, store, shelf_days, expires, created, updated, updated_by) VALUES (${pid}, ${q(name)}, ${cat(c)}, ${loc(l)}, ${q(ct)}, ${q(unit)}, ${q(pack)}, ${qty}, ${q(level)}, ${open}, ${basic}, ${q(target)}, ${q(store)}, ${q(x.shelf_days)}, ${q(x.expires)}, ${N - 45 * D}, ${N - ((i % 9) + 1) * D}, ${by});`);
});
out.push(`INSERT INTO batches (product_id, qty, bought, expires) VALUES (${id['חזה עוף']}, 2, ${N - 5 * D}, ${N + 60 * D});`);

// 6 open on the list
const L = [['ביצים', 'reported', 1, N - 0.5 * H], ['לחם פרוס', 'auto', 1, N - 20 * H], ['עגבניות', 'auto', 2, N - 26 * H], ['שקיות אשפה', 'auto', 1, N - 51 * H], ['נוזל כביסה', 'reported', 2, N - 68 * H], ['תפוחים', 'auto', 1, N - 29 * H]];
L.forEach(([n, src, by, ts]) => out.push(`INSERT INTO list_items (product_id, store, source, status, added_by, added) VALUES (${id[n]}, ${q(P[id[n] - 1][11])}, ${q(src)}, 'open', ${by}, ${Math.round(ts)});`));

// 10 lessons, none about milk
const LESSONS = [
  'כשמיכל אומרת "הלחם" היא מתכוונת ללחם פרוס.',
  'ירקות קונים אצל הירקן, בדרך כלל ביום שישי.',
  'את הקפה קונים טחון, לא נמס.',
  'נייר טואלט קונים בחבילה של 32 גלילים.',
  'כשאבי אומר "הגבינה" הוא מתכוון לגבינה צהובה.',
  'שקיות אשפה: הגדולות, לא הקטנות.',
  'יואבי לא אוכל פטריות.',
  'ביום חמישי עושים משלוח מהסופר.',
  'את הסוללות שמים במחסן.',
  'כשאומרים "נוזל" מתכוונים לנוזל כביסה.',
];
LESSONS.forEach((t, i) => out.push(`INSERT INTO lessons (text, added, added_by) VALUES (${q(t)}, ${N - (30 - i) * D}, ${i % 2 ? 2 : 1});`));

// 2 recipes: the owner's shakshuka (7 steps) and pasta
const SHAK_ING = [[null, null, 'שמן זית', 'שמן זית'], [4, 'שן', 'שום', 'שום'], [2, null, 'פלפל חריף', 'פלפל חריף'], [1, 'קופסה', 'רסק עגבניות', 'רסק עגבניות'], [1, 'כפית', 'פפריקה', 'פפריקה'], [1, 'כפית', 'כמון', 'כמון'], [6, null, 'עגבניות', 'עגבניות'], [null, null, 'פטה (לא חובה)', 'פטה'], [6, null, 'ביצים', 'ביצים'], [null, null, 'מלח', 'מלח'], [null, null, 'פלפל שחור', 'פלפל שחור']];
const SHAK_TEXT = ['מטגנים שום ופלפל חריף בהמון שמן.', 'מוסיפים את הרסק.', 'מוסיפים את התבלינים ונותנים להם להיפתח בשמן.', 'מוסיפים עגבניות חתוכות לשש עד שהמחבת מלאה.', 'מכסים ומטגנים על אש נמוכה.', 'אם רוצים, מפוררים פטה מעל.', 'שוברים פנימה את הביצים ומפזרים מלח ופלפל.'].join('\n');
const PASTA_ING = [[1, 'חבילה', 'פסטה', 'פסטה'], [1, 'קופסה', 'רסק עגבניות', 'רסק עגבניות'], [2, 'שן', 'שום', 'שום'], [null, null, 'שמן זית', 'שמן זית'], [null, null, 'גבינה צהובה (לא חובה)', 'גבינה צהובה'], [null, null, 'מלח', 'מלח']];
const PASTA_TEXT = ['מבשלים את הפסטה במים רותחים עם מלח.', 'מטגנים שום בשמן ומוסיפים את הרסק עם חצי כוס מים.', 'מערבבים את הפסטה ברוטב ומגררים מעל גבינה.'].join('\n');
const lineOf = ([n, u, name]) => [n, u, name].filter((x) => x !== null).join(' ');
[[1, 'שקשוקה', SHAK_ING, SHAK_TEXT, 'ישראלי, ארוחות ערב', 4, 3], [2, 'פסטה ברוטב עגבניות', PASTA_ING, PASTA_TEXT, 'איטלקי, פסטה', 3, 1]].forEach(([rid, name, ings, text, tags, serves, cooked]) => {
  out.push(`INSERT INTO recipes (id, name, ingredients, text, added_by, added, tags, serves, cooked, last_cooked, parsed, source) VALUES (${rid}, ${q(name)}, ${q(ings.map(lineOf).join('\n'))}, ${q(text)}, 1, ${N - 20 * D}, ${q(tags)}, ${serves}, ${cooked}, ${N - 6 * D}, 1, 'mine');`);
  ings.forEach((g, pos) => out.push(`INSERT INTO recipe_ingredients (recipe_id, pos, qty, unit, name, product_id, line) VALUES (${rid}, ${pos}, ${q(g[0])}, ${q(g[1])}, ${q(g[2])}, ${id[g[3]] ?? 'NULL'}, ${q(lineOf(g))});`));
});

// MEASURE_RECIPES=<file>: the same house with a real collection of recipes as well (the owner 03/10: the 257 from the TikTok
// export), for the measurement only. Ingredients are matched to a product by exact name, as the fixed two are.
if (process.env.MEASURE_RECIPES) {
  const many = JSON.parse(readFileSync(process.env.MEASURE_RECIPES, 'utf8'));
  many.forEach((x, k) => {
    const rid = 1000 + k, ings = (x.ings || []).map((g) => [g.qty ?? null, g.unit ?? null, g.name, g.name]);
    out.push(`INSERT INTO recipes (id, name, ingredients, text, added_by, added, tags, serves, cooked, last_cooked, parsed, source) VALUES (${rid}, ${q(x.name)}, ${q(ings.map(lineOf).join('\n'))}, ${q(x.text || '')}, 1, ${N - 10 * D}, ${q(x.tags || null)}, ${x.serves ?? 'NULL'}, 0, NULL, 1, 'mine');`);
    ings.forEach((g, pos) => out.push(`INSERT INTO recipe_ingredients (recipe_id, pos, qty, unit, name, product_id, line) VALUES (${rid}, ${pos}, ${q(g[0])}, ${q(g[1])}, ${q(g[2])}, ${id[g[3]] ?? 'NULL'}, ${q(lineOf(g))});`));
  });
}

// events: an old battery purchase (for "when did we buy batteries?"), then 8 in the last 3 days. The newest is Avi's: the eggs ran out.
const snap = (n, over) => { const [name, , , ct, unit, pack, qty, level, open, basic, target, store] = P[id[n] - 1]; return { id: id[n], name, count_type: ct, unit, pack_size: pack, qty, level, is_open: open, is_basic: basic, target, store, aliases: [], ...over }; };
const EV = [
  [N - 24 * D - 3 * H, 2, 'purchase', 'סוללות', 'מיכל קנתה 4 סוללות', null],
  [N - 68 * H, 2, 'low', 'נוזל כביסה', 'מיכל עדכנה שנוזל הכביסה כמעט נגמר', { is_open: 1, qty: 0 }],
  [N - 51 * H, 1, 'list_add', 'שקיות אשפה', 'אבי הוסיף שקיות אשפה לרשימה', null],
  [N - 46 * H, 2, 'purchase', 'חלב 3%', 'מיכל קנתה 2 קרטוני חלב 3%', { qty: 0 }],
  [N - 29 * H, 1, 'discard', 'תפוחים', 'אבי זרק את התפוחים', { level: 'little' }],
  [N - 26 * H, 2, 'low', 'עגבניות', 'מיכל עדכנה שנשארו מעט עגבניות', { level: 'plenty' }],
  [N - 20 * H, 1, 'out', 'לחם פרוס', 'אבי סימן שנגמר הלחם הפרוס', { qty: 1 }],
  [N - 3 * H, 2, 'purchase', 'פסטה', 'מיכל קנתה 2 חבילות פסטה', { qty: 1 }],
  [N - 0.5 * H, 1, 'out', 'ביצים', 'אבי סימן שנגמרו הביצים', { qty: 8 }],
];
EV.forEach(([ts, by, type, n, summary, before], i) => {
  const eid = i + 1;
  out.push(`INSERT INTO events (id, op_id, ts, user_id, type, product_id, summary, before) VALUES (${eid}, 'measure-${eid}', ${Math.round(ts)}, ${by}, ${q(type)}, ${id[n]}, ${q(summary)}, ${before ? q(JSON.stringify({ products: { [id[n]]: snap(n, before) } })) : 'NULL'});`);
  if (type === 'purchase' || type === 'out') out.push(`INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (${eid}, ${Math.round(ts)}, ${id[n]}, ${q(type)});`);
});

// 12 chat messages over the last two days, at real length: Shuki answers in 1–2 sentences, with the cards as the server
// saves them (proposal lines + status). One of Michal's is a secret: message 33 checks Shuki doesn't repeat it.
const card = (n, lines) => ({ proposal: { id: `measure-p${n}`, lines: lines.map((text) => ({ text })) }, status: 'applied' });
const C = [
  [N - 51 * H, 1, 'נגמרו שקיות האשפה, ותבדוק אם נשאר נוזל כביסה'],
  [N - 51 * H + 5e3, 0, 'נוזל הכביסה פתוח, ואין בקבוק סגור בארון הניקיון. להוסיף את שניהם לרשימה?', 1, card(1, ['להוסיף שקיות אשפה לרשימה?', 'להוסיף נוזל כביסה לרשימה?'])],
  [N - 46 * H, 2, 'קניתי 2 קרטוני חלב 3% ו-4 יוגורטים'],
  [N - 46 * H + 5e3, 0, 'יש! עכשיו יש 3 קרטוני חלב 3% במקרר. לסמן את הקנייה?', 2, card(2, ['לסמן שקנינו 2 קרטוני חלב 3%?', 'לסמן שקנינו 4 גביעי יוגורט?'])],
  [N - 26 * H, 2, 'נשארו מעט עגבניות, וגם הפלפל החריף כמעט נגמר'],
  [N - 26 * H + 5e3, 0, 'העגבניות הן מוצר קבוע, אז הן ייכנסו לרשימה של הירקן. לעדכן גם את הפלפל החריף?', 2, card(3, ['לעדכן שנשארו מעט עגבניות?', 'לעדכן שנשאר מעט פלפל חריף?'])],
  [N - 22 * H, 2, 'תזכיר לי לקנות מתנה לאבי, יום ההולדת שלו בעוד שבועיים'],
  [N - 22 * H + 5e3, 0, 'בשמחה. מתי להזכיר לך?', 2, { options: ['מחר בבוקר', 'בעוד שבוע'] }],
  [N - 2 * H, 1, 'מה חסר לשקשוקה? בא לי להכין הערב'],
  [N - 2 * H + 5e3, 0, 'לפי המתכון חסרות ביצים, ונשארו מעט עגבניות. להוסיף ביצים לרשימה?', 1, { options: ['להוסיף לרשימה', 'לא צריך'] }],
  [N - 0.5 * H, 1, 'נגמרו הביצים, השתמשתי בשמונה האחרונות'],
  [N - 0.5 * H + 5e3, 0, 'בתיאבון! לסמן שאין ביצים ולהוסיף אותן לרשימה?', 1, card(4, ['לסמן שאין ביצים?', 'להוסיף ביצים לרשימה?'])],
].sort((a, b) => a[0] - b[0]);
C.forEach(([ts, uid, text, forId, extra]) => out.push(uid
  ? `INSERT INTO chat (ts, user_id, role, content) VALUES (${Math.round(ts)}, ${uid}, 'user', ${q(JSON.stringify({ text, image: false }))});`
  : `INSERT INTO chat (ts, user_id, role, content) VALUES (${Math.round(ts)}, NULL, 'shuki', ${q(JSON.stringify({ reply: text, face: 'happy', ...extra, for: forId, ai: true }))});`));

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2]) { writeFileSync(process.argv[2], `${out.join('\n')}\n`); console.log('ok', out.length, 'statements'); }
