// What Shuki notices on his own (decisions 120-128), without anyone saying "remember".
// A pattern is watched in the `noticed` table. At NOTICE_AT times it is shown under "I noticed that..." in settings,
// and some kinds are asked about once in the chat ("want me to remember?"). Only defaults change silently
// (an amount on the list or in the cart); anything else waits for a yes. A no is final.
import { WEEKDAYS, STORE_NAMES, DAY, byGender, amount, of, withHa, local } from './domain.js';
import { byPerson } from '../public/hebrew.js';

export const NOTICE_AT = 3;
// מ31 (decision 4): an expired pattern comes back after its kind's scan window, in days
const RETURN_AFTER = { weekly: 22, regular: 60, buyer: 60, shopday: 28, owner: 90 };
const ASK_KINDS = ['weekly', 'rejects', 'buyer', 'regular', 'owner']; // asked in the chat; want / buy just become defaults

/** One more sighting. `same`: the pattern is "the same value every time" (a new value starts the count again). */
export async function notice(db, { key, kind, userId = null, productId = null, value, same = true, now = Date.now(), count }) {
  // a private product teaches nothing: what's noticed is shown in settings and asked in the chat (0b part 3)
  if (productId != null && (await db.prepare('SELECT private_to FROM products WHERE id = ?').bind(productId).first())?.private_to != null) return;
  const row = await db.prepare('SELECT * FROM noticed WHERE key = ?').bind(key).first();
  const data = JSON.stringify({ v: value ?? null });
  if (!row) {
    await db.prepare('INSERT INTO noticed (key, kind, user_id, product_id, data, count, first, last) VALUES (?,?,?,?,?,?,?,?)').bind(key, kind, userId, productId, data, count ?? 1, now, now).run();
    return;
  }
  if (row.status === 'no') return;
  // 66 (the owner 05/10): asked, unanswered and expired: seen anew only with new evidence. What the morning's scan counts (a
  // `count`) comes back once its window (60 days at most) holds nothing from before; a turned-down one counts again from 0
  if (row.status === 'expired') {
    // מ31 (decision 4): by the kind's own scan window (RETURN_AFTER), 60 days for the rest
    if (count != null && now - row.last < (RETURN_AFTER[kind] ?? 60) * DAY) return;
    const n = count ?? row.count + 1;
    await db.prepare("UPDATE noticed SET data = ?, count = ?, last = ?, status = 'watching', user_id = COALESCE(?, user_id) WHERE id = ?").bind(data, n, now, userId, row.id).run();
    return;
  }
  const prev = JSON.parse(row.data || '{}').v ?? null;
  const n = count ?? (same && JSON.stringify(prev) !== JSON.stringify(value ?? null) ? 1 : row.count + 1);
  // a changed value is a new pattern: it's watched (and may be asked about) again
  const status = same && JSON.stringify(prev) !== JSON.stringify(value ?? null) && row.status !== 'yes' ? 'watching' : row.status;
  await db.prepare('UPDATE noticed SET data = ?, count = ?, last = ?, status = ?, user_id = CASE WHEN status = \'yes\' THEN user_id ELSE COALESCE(?, user_id) END WHERE id = ?').bind(data, n, now, status, userId, row.id).run(); // מ31: "who buys" with the buyer it has now
}

/** After actions were carried out: what someone did the same way again. */
export async function observe(env, user, actions, now = Date.now()) {
  if (!user?.id) return; // Shuki's own weekly buys teach nothing
  const db = env.DB;
  try {
    for (const a of actions) {
      if (a.kind === 'list_add' && a.product_id && Number(a.amount) > 0 && !a.fromDefault) {
        await notice(db, { key: `want:${user.id}:${a.product_id}`, kind: 'want', userId: user.id, productId: +a.product_id, value: Number(a.amount), now });
      }
      // decision 122 (r0t d122): the place each category's new products go to, from a product made or moved with one
      if ((a.kind === 'create' && a.product?.name) || (a.kind === 'edit' && a.product_id && a.fields?.location_id != null)) {
        const p = a.kind === 'create'
          ? await db.prepare('SELECT category_id, location_id FROM products WHERE name = ? AND deleted IS NULL AND private_to IS NULL ORDER BY created DESC LIMIT 1').bind(String(a.product.name).trim()).first()
          : await db.prepare('SELECT category_id, location_id FROM products WHERE id = ? AND deleted IS NULL AND private_to IS NULL').bind(Number(a.product_id)).first();
        if (p?.category_id != null && p.location_id != null) await notice(db, { key: `place:${p.category_id}`, kind: 'place', value: p.location_id, now });
      }
      if (a.kind === 'check') {
        const i = await db.prepare('SELECT product_id, store FROM list_items WHERE id = ?').bind(Number(a.item_id)).first();
        if (i?.product_id && a.amount != null) await notice(db, { key: `buy:${i.product_id}`, kind: 'buy', productId: i.product_id, value: Number(a.amount), now });
        // decision 122 (r0t d122): the store it's bought at, by the same mechanism
        if (i?.product_id && i.store) await notice(db, { key: `store:${i.product_id}`, kind: 'store', productId: i.product_id, value: i.store, now });
      }
    }
  } catch (e) { console.error('observe', e?.message); } // best effort: learning never blocks an update
}

/** Shuki suggested a product for the list and it was turned down (the card, or its line). */
export async function turnedDown(env, actions, now = Date.now()) {
  const db = env.DB;
  for (const a of actions) {
    const pid = a.kind === 'list_add' ? a.product_id : null;
    if (pid) await notice(db, { key: `rejects:${pid}`, kind: 'rejects', productId: +pid, same: false, now });
  }
}

/** Decision 122: the amount someone always adds, when they add without one. */
export async function withDefaults(env, user, actions) {
  if (!user?.id || !actions.some((a) => a.kind === 'list_add' && a.product_id && a.amount == null)) return actions;
  const rows = (await env.DB.prepare("SELECT product_id, data FROM noticed WHERE kind = 'want' AND user_id = ? AND count >= ? AND status != 'no'").bind(user.id, NOTICE_AT).all()).results;
  const want = new Map(rows.map((r) => [r.product_id, JSON.parse(r.data).v]));
  return actions.map((a) => (a.kind === 'list_add' && a.product_id && a.amount == null && want.get(+a.product_id) > 1 ? { ...a, amount: want.get(+a.product_id), fromDefault: true } : a));
}

/** The amount usually bought, per product, for the cart. */
export async function buyDefaults(db) {
  const rows = (await db.prepare("SELECT product_id, data FROM noticed WHERE kind = 'buy' AND count >= ? AND status != 'no'").bind(NOTICE_AT).all()).results;
  return new Map(rows.map((r) => [r.product_id, JSON.parse(r.data).v]));
}

/** Decision 122 (r0t d122): the store each product is bought at, when it isn't the product's own; for a new line on the list. */
export async function storeDefaults(db) {
  const rows = (await db.prepare("SELECT n.product_id, n.data FROM noticed n JOIN products p ON p.id = n.product_id WHERE n.kind = 'store' AND n.count >= ? AND n.status != 'no'").bind(NOTICE_AT).all()).results;
  return new Map(rows.map((r) => [r.product_id, JSON.parse(r.data).v]));
}

/** Decision 122 (r0t d122): the place a new product of each category goes to, when none is given. */
export async function placeDefaults(db) {
  const rows = (await db.prepare("SELECT key, data FROM noticed WHERE kind = 'place' AND count >= ? AND status != 'no'").bind(NOTICE_AT).all()).results;
  return new Map(rows.map((r) => [Number(r.key.split(':')[1]), JSON.parse(r.data).v]));
}

// the owner's words (03/10, r0t d122, text 12): per category the app comes with, the words at the start and "… חדשים/חדשות";
// "אחר" has no sentence, and a category the house added is said by its name
const PLACE_WORDS = {
  'ירקות ופירות': ['ירקות ופירות', 'ירקות ופירות חדשים'],
  'מוצרי חלב, גבינות וביצים': ['מוצרי חלב', 'מוצרי חלב חדשים'],
  'בשר, עוף ודגים': ['בשר, עוף ודגים', 'בשר, עוף ודגים חדשים'],
  'תחליפי בשר': ['תחליפי בשר', 'תחליפי בשר חדשים'],
  'לחם ומאפים': ['לחם ומאפים', 'לחם ומאפים חדשים'],
  'יבשים': ['מוצרים יבשים', 'מוצרים יבשים חדשים'],
  'שימורים ורטבים': ['שימורים ורטבים', 'שימורים ורטבים חדשים'],
  'תבלינים ושמנים': ['תבלינים ושמנים', 'תבלינים ושמנים חדשים'],
  'חטיפים ומתוקים': ['חטיפים ומתוקים', 'חטיפים ומתוקים חדשים'],
  'משקאות': ['משקאות', 'משקאות חדשים'],
  'ניקיון וכביסה': ['מוצרי ניקיון וכביסה', 'מוצרי ניקיון וכביסה חדשים'],
  'טואלטיקה והיגיינה': ['מוצרי טואלטיקה', 'מוצרי טואלטיקה חדשים'],
  'תרופות ועזרה ראשונה': ['תרופות', 'תרופות חדשות'],
  'חד-פעמי ונייר': ['כלים חד-פעמיים ומוצרי נייר', 'כלים חד-פעמיים ומוצרי נייר חדשים'],
  'תחזוקת בית': ['מוצרי תחזוקה', 'מוצרי תחזוקה חדשים'],
  'חיות מחמד': ['מוצרי חיות מחמד', 'מוצרי חיות מחמד חדשים'],
  'תינוק': ['מוצרי תינוק', 'מוצרי תינוק חדשים'], // stage 8, ו6 (migration 0030): by the same pattern, question 44
  'אחר': null,
};
const at = (prep, place) => `${prep}${place.replace(/^ה(?=[א-ת])/, '')}`; // "המחסן הקטן" → "במחסן הקטן"
export function placeText(category, place) {
  if (!category || !place) return '';
  const w = Object.hasOwn(PLACE_WORDS, category) ? PLACE_WORDS[category] : [category, 'מוצרים חדשים מהסוג הזה'];
  return w ? `אתם שמים ${w[0]} ${at('ב', place)}, אז אני כותב מעכשיו ${w[1]} ${at('ל', place)}.` : '';
}

/** Once a day: products bought on the same weekday three weeks running, and who does which store. */
export async function scanPatterns(env, now, weeklyPatterns) {
  const db = env.DB;
  const routines = (await db.prepare('SELECT product_id FROM routines WHERE private_to IS NULL').all()).results; // a private weekly buy doesn't stop the house's (question 49)
  const log = (await db.prepare("SELECT l.product_id, l.ts FROM product_log l JOIN products p ON p.id = l.product_id AND p.deleted IS NULL WHERE l.kind = 'purchase' AND l.ts > ?").bind(now - 60 * DAY).all()).results;
  for (const x of weeklyPatterns(log.filter((r) => now - r.ts < 22 * DAY), routines, now)) {
    await notice(db, { key: `weekly:${x.product_id}`, kind: 'weekly', productId: x.product_id, value: x.weekday, count: NOTICE_AT, now });
  }
  // decision 163: no minimum is guessed; something that isn't regular and was bought 3 times in two months is suggested as regular, once
  const basics = new Set((await db.prepare('SELECT id FROM products WHERE is_basic = 1 OR occasional = 1').all()).results.map((r) => r.id));
  const times = new Map(); for (const r of log) if (!basics.has(r.product_id)) times.set(r.product_id, (times.get(r.product_id) || 0) + 1);
  for (const [pid, n] of times) if (n >= 3) await notice(db, { key: `regular:${pid}`, kind: 'regular', productId: pid, value: null, count: NOTICE_AT, now });
  // who buys at each store: one person made at least 80% of 6+ purchases there
  const stores = (await db.prepare("SELECT i.store, i.checked_by AS user_id FROM list_items i WHERE i.checked_by IS NOT NULL AND i.private_to IS NULL AND i.checked > ? AND i.store IN ('super', 'pharm', 'greengrocer')").bind(now - 60 * DAY).all()).results;
  const by = new Map();
  for (const r of stores) { const m = by.get(r.store) || by.set(r.store, new Map()).get(r.store); m.set(r.user_id, (m.get(r.user_id) || 0) + 1); }
  await ownerPatterns(db, now);
  await shopdayPattern(db, now);
  const people = (await db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').first())?.n || 0;
  if (people < 2) return;
  for (const [store, m] of by) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [uid, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total >= 6 && n / total >= 0.8) await notice(db, { key: `buyer:${store}`, kind: 'buyer', userId: uid, value: store, count: NOTICE_AT, now });
  }
}

/**
 * מ25 (q083, q088): the house's day for the big shop: in the last 28 days, a trip (shopping.started) or a delivery
 * (list_items.ordered) on the same weekday in at least 3 different weeks. One row, `shopday`, { weekday, kind }; not one of
 * the things asked about as "שמתי לב" (ASK_KINDS, noticedList): Shuki's own question is opt-in (worker/shuki.js).
 */
export async function shopdayPattern(db, now) {
  const since = now - 28 * DAY;
  const trips = (await db.prepare('SELECT started AS ts FROM shopping WHERE started > ?').bind(since).all()).results;
  const orders = (await db.prepare('SELECT DISTINCT ordered AS ts FROM list_items WHERE ordered > ? AND private_to IS NULL').bind(since).all()).results;
  const best = (rows) => {
    const weeks = new Map();
    for (const r of rows) { const wd = local(r.ts).wd; if (!weeks.has(wd)) weeks.set(wd, new Set()); weeks.get(wd).add(Math.floor((now - r.ts) / (7 * DAY))); }
    return [...weeks].filter(([, w]) => w.size >= 3).sort((a, b) => b[1].size - a[1].size)[0]?.[0];
  };
  const trip = best(trips), delivery = trip == null ? best(orders) : null;
  // no day any more: the reminder stops (question 40); it comes back with three new weeks (RETURN_AFTER)
  if (trip == null && delivery == null) { await db.prepare("UPDATE noticed SET status = 'expired' WHERE key = 'shopday' AND status NOT IN ('no', 'expired')").run(); return; }
  await notice(db, { key: 'shopday', kind: 'shopday', value: { weekday: trip ?? delivery, kind: trip != null ? 'trip' : 'delivery' }, count: NOTICE_AT, now });
}

/**
 * מ1 (stage 9, q002, q003): a product only one grown-up puts on the list: at least 3 times in 90 days, always them, nobody else
 * marked it out, and it's nobody's yet (not private, not a one-off). Not in a house where one person adds nearly everything:
 * every other grown-up added at least 5 things of their own in that time (question 1). The person is asked, not the house.
 */
async function ownerPatterns(db, now) {
  const since = now - 90 * DAY;
  const adults = (await db.prepare("SELECT id FROM users WHERE active = 1 AND role != 'child'").all()).results.map((r) => r.id);
  if (adults.length < 2) return;
  const own = "(i.source IS NULL OR i.source NOT IN ('auto', 'reported'))"; // added by someone, not by Shuki
  const per = new Map((await db.prepare(`SELECT i.added_by AS uid, COUNT(*) AS n FROM list_items i WHERE i.added > ? AND i.private_to IS NULL AND ${own} GROUP BY i.added_by`).bind(since).all()).results.map((r) => [r.uid, r.n]));
  // not what is the house's by nature: the baby's, the pet's, and period products (the instruction: no owner unless said)
  const adds = (await db.prepare(`SELECT i.product_id AS pid, i.added_by AS uid, p.name FROM list_items i JOIN products p ON p.id = i.product_id AND p.deleted IS NULL AND p.private_to IS NULL AND p.owner IS NULL AND COALESCE(p.occasional, 0) = 0 AND COALESCE(p.category_id, 0) NOT IN (SELECT id FROM categories WHERE name IN ('תינוק', 'חיות מחמד')) WHERE i.added > ? AND i.private_to IS NULL AND i.added_by IS NOT NULL AND ${own}`).bind(since).all()).results.filter((a) => !PERIOD.test(a.name));
  // who marked it out: by the line in the stock's journal and its event, not events.product_id (one product an action, mainProduct)
  const outs = (await db.prepare("SELECT l.product_id AS pid, e.user_id AS uid FROM product_log l JOIN events e ON e.id = l.event_id WHERE l.kind = 'out' AND l.ts > ? AND e.user_id IS NOT NULL").bind(since).all()).results;
  // …nor used it (question 1): opened it, "a little left", counted it, threw it out. Not bought it: someone who buys what's on
  // the list for everyone is just what question 1 is about. By the action's own product (events.product_id: an action's first)
  const used = (await db.prepare("SELECT product_id AS pid, user_id AS uid FROM events WHERE ts > ? AND product_id IS NOT NULL AND user_id IS NOT NULL AND undone IS NULL AND type IN ('use', 'bring', 'open', 'low', 'set', 'discard', 'out')").bind(since).all()).results;
  const by = new Map(); for (const a of adds) (by.get(a.pid) || by.set(a.pid, []).get(a.pid)).push(a.uid);
  for (const [pid, who] of by) {
    const uid = who[0];
    if (who.length < 3 || who.some((x) => x !== uid) || !adults.includes(uid)) continue;
    if ([...outs, ...used].some((o) => o.pid === pid && o.uid !== uid)) continue;
    if (adults.some((a) => a !== uid && (per.get(a) || 0) < 5)) continue;
    await notice(db, { key: `owner:${pid}:${uid}`, kind: 'owner', userId: uid, productId: pid, value: null, count: NOTICE_AT, now });
  }
}

const DRINK = /^(חלב|שוקו)(\s|$)/; // the approved table: the category "משקאות", or a name that starts with "חלב" / "שוקו"
const PERIOD = /(טמפו[נן]|תחבוש(ת|ות)|(^|\s)פד(ים)?(\s|$)|מגנ?י? תחתון|כוסית וסת)/;
const FOOD_CATS = ['ירקות ופירות', 'מוצרי חלב, גבינות וביצים', 'בשר, עוף ודגים', 'תחליפי בשר', 'לחם ומאפים', 'יבשים', 'שימורים ורטבים', 'תבלינים ושמנים', 'חטיפים ומתוקים'];
/** מ1: "אגב, האם רק אתה שותה חלב סויה?" (q003, the owner's words in the feminine; approved r9p): the verb by the product */
export function ownerQuestion(row, { products, categories = [] }, me) {
  const p = products.find((x) => x.id === row.product_id); if (!p) return '';
  const cat = categories.find((c) => c.id === p.category_id)?.name;
  const [m, f, pl] = cat === 'משקאות' || (DRINK.test(p.name) && (!cat || cat === 'מוצרי חלב, גבינות וביצים')) ? ['שותה', 'שותה', 'שותים'] : FOOD_CATS.includes(cat) ? ['אוכל', 'אוכלת', 'אוכלים'] : ['משתמש ב', 'משתמשת ב', 'משתמשים ב'];
  const verb = byPerson(me, m, f, pl);
  return `אגב, האם רק ${byPerson(me, 'אתה', 'את', 'אתם')} ${verb}${verb.endsWith('ב') ? '' : ' '}${p.name}?`;
}

/** In Shuki's words, for the settings list and the chat. `me`: who reads it (מ1's line is theirs alone, in the second person) */
export function noticedText(row, { users, products, categories = [], locations = [], me = null }) {
  const v = JSON.parse(row.data || '{}').v;
  const p = products.find((x) => x.id === row.product_id);
  const u = users.find((x) => x.id === row.user_id);
  const name = p?.name || '';
  const unit = p?.count_type === 'pack' ? 'אריזה' : p?.unit || null; // what's added to the list and bought is counted in packs
  const you = !!me && me.id === row.user_id; // home19 (11)
  // the approved wording (round 20)
  switch (row.kind) {
    // home19 (11): to the person it is about, in the second person, never their name ("שמתי לב שthe owner עושה…" was said to the owner)
    case 'want': return you ? `כש${byPerson(me, 'אתה מוסיף', 'את מוסיפה', 'אתם מוסיפים')} ${name} לרשימה, ${byPerson(me, 'אתה תמיד מוסיף', 'את תמיד מוסיפה', 'אתם תמיד מוסיפים')} ${amount(v, unit)}. אני שם אוטומטית ${v}. האם זה בסדר?`
      : `כש${u?.name} ${byPerson(u, 'מוסיף', 'מוסיפה', 'מוסיפים')} ${name} לרשימה, ${byPerson(u, 'הוא תמיד מוסיף', 'היא תמיד מוסיפה', 'הם תמיד מוסיפים')} ${amount(v, unit)}. אני שם אוטומטית ${v}. האם זה בסדר?`;
    case 'buy': return `אתם קונים ${of(v, unit, name)} בכל פעם, אז זה מה שאני מציע בעגלה.`;
    // the owner's words (03/10, r0t d122); only when it isn't the product's own store. Like every line here, without "שמתי לב ש":
    // in settings it sits under the heading "שמתי לב ש...", and the chat adds it ("אגב, שמתי לב ש…")
    case 'store': return p && STORE_NAMES[v] && v !== p.store ? `את ${withHa(name)} אתם קונים ב${STORE_NAMES[v]}, אז אני מכניס ${byGender(name, 'אותו', 'אותה', 'אותם', 'אותן')} לרשימה של ה${STORE_NAMES[v]}.` : '';
    case 'weekly': return `אתם קונים ${name} בכל יום ${WEEKDAYS[v]}.`;
    case 'rejects': return `נראה שאתם לא צריכים ${name} ברשימה.`; // 17/10, ש5
    case 'buyer': return `${you ? byPerson(me, 'אתה עושה', 'את עושה', 'אתם עושים') : `${u?.name} ${byPerson(u, 'עושה', 'עושה', 'עושים')}`} כמעט תמיד את ה${STORE_NAMES[v] || v}.`;
    // מ1 (approved r9p): shown only to the person (noticedList), so to them; not in the month's summary to the house (no `me`)
    case 'owner': return p && me && me.id === row.user_id ? `רק ${byPerson(me, 'אתה מוסיף', 'את מוסיפה', 'אתם מוסיפים')} ${name} לרשימה.` : '';
    case 'regular': return p && !p.is_basic ? `אתם קונים ${name} הרבה. האם להפוך ${byGender(name, 'אותו', 'אותה', 'אותם', 'אותן')} למוצר קבוע?` : ''; // 17/10, ש5
    // text 12 (r0t d122): without "שמתי לב ש", like the store's
    case 'place': return placeText(categories.find((c) => c.id === Number(row.key.split(':')[1]))?.name, locations.find((l) => l.id === v)?.name);
    default: return '';
  }
}

/** What "yes" does (the card, or the button in settings). want / buy: they're already the defaults. */
export function yesActions(row, { users, products }) {
  const v = JSON.parse(row.data || '{}').v;
  const p = products.find((x) => x.id === row.product_id);
  const u = users.find((x) => x.id === row.user_id);
  switch (row.kind) {
    case 'weekly': return p ? [{ kind: 'routine', product_id: p.id, weekday: v }] : [];
    case 'rejects': return p ? [{ kind: 'lesson', text: `לא אציע יותר ${p.name} לרשימה` }, ...(p.is_basic ? [{ kind: 'edit', product_id: p.id, fields: { is_basic: false } }] : [])] : [];
    case 'buyer': return u ? [{ kind: 'lesson', text: `${u.name} ${byPerson(u, 'קונה', 'קונה', 'קונים')} בדרך כלל ב${STORE_NAMES[v] || v}` }] : [];
    case 'regular': return p && !p.is_basic ? [{ kind: 'edit', product_id: p.id, fields: { is_basic: true, target: 1 } }] : [];
    case 'owner': return p && u && p.owner == null ? [{ kind: 'edit', product_id: p.id, fields: { owner: u.id } }] : [];
    default: return [];
  }
}

/** Shown in settings: patterns seen enough times that nobody answered yet (and the ones said yes to). */
export async function noticedList(db, uid) {
  // מ1: "only you add…" is that person's alone; another grown-up can't answer it for them
  return (await db.prepare("SELECT * FROM noticed WHERE count >= ? AND status NOT IN ('no', 'expired') AND kind != 'shopday' AND (kind != 'owner' OR user_id = ?) ORDER BY last DESC LIMIT 30").bind(NOTICE_AT, uid ?? -1).all()).results;
}

/** Decision 121: one pattern to ask this person about, in a reply (Shuki never writes first, decision 148). */
export async function toAsk(db, user) {
  return db.prepare(`SELECT * FROM noticed WHERE status = 'watching' AND count >= ? AND kind IN (${ASK_KINDS.map(() => '?').join(',')}) AND (user_id IS NULL OR user_id = ?) ORDER BY kind = 'regular', last DESC LIMIT 1`).bind(NOTICE_AT, ...ASK_KINDS, user.id).first();
}

export async function answer(db, id, yes, now = Date.now()) {
  await db.prepare('UPDATE noticed SET status = ? WHERE id = ?').bind(yes ? 'yes' : 'no', id).run();
  // when the "yes" was said, for the month's "what I learned" (decision 128, r0t d128)
  if (yes) await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`noticed_yes:${id}`, String(now)).run();
}

