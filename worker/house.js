// House keeping: the daily backup (and putting the house back to an earlier day), what Shuki costs this month,
// 👎 on an answer, the "haven't seen you in a while" offer, and the new-version note for the admin.
import { local, HOUSE, isOut, STORE_NAMES } from './domain.js';
import { byPerson } from '../public/hebrew.js';
import { loadAll } from './store.js';
import { shabbatFromSettings, KEYS, forgetMarks, dropOrphanMarks } from './facts.js';
// פ6: in a person's own download, a shared fact about them that a private row of theirs wins over doesn't go out (one value:
// any private row of the key; many values: their ended row of that value). The daily copy keeps it
const MULTI = Object.keys(KEYS).filter((k) => KEYS[k].multi).map((k) => `'${k}'`).join(',');
const BEATEN = `EXISTS (SELECT 1 FROM facts p WHERE p.private = 1 AND p.about = 'person' AND p.about_id = facts.about_id AND p.key = facts.key AND (facts.key NOT IN (${MULTI}) OR (p.ended = 1 AND p.value = facts.value)))`;
import { SHARED, forgetPrivate } from './private.js';
import { distressOf } from './distress.js';
import { chatRows, serverCardUp } from './thread.js';

export const VERSION = '0.21.0';
const DAY = 86400e3;
const KEEP_DAYS = 7;
const PART = 900_000; // characters per row (D1 rows stay under 2 MB)
// what never leaves the server, and never comes back from a copy
export const SECRET_SETTINGS = new Set(['anthropic_key', 'openai_key', 'vapid', 'setup_code', 'brain_error', 'guest_salt']); // guest_salt: מ27
// the server's own bookkeeping: a restore keeps today's values
const OWN_SETTINGS = new Set(['backup_day', 'cost_warned', 'update_seen', 'update_available', 'idle_offer']);

/* ---------------- what of settings leaves the server (stage 9, task 0) ---------------- */
// A list of what goes out, not of what doesn't: a new mark stays on the server until it is put here (test/settings-keys.test.js).
// The state (/api/state) carries only what the app reads: the summary's hour, and my own choice of a child's chat (b01).
export const STATE_SETTINGS = new Set(['digest_hour', 'shop_produce', 'shop_care']); // home18 (5): the list's tabs and the settings read them
// a person's download: the house's settings…
// (update_seen and backup_day aren't written today; a restore keeps them, OWN_SETTINGS)
export const HOUSE_SETTINGS = new Set(['house_name', 'house_notes', 'house_mode', 'tz', 'digest_hour', 'stores', 'provider', 'catalog_area', 'catalog_area_at',
  'kitniyot_asked', 'moving', 'relink', 'fell_back', 'recount_at', 'recount_ids', 'recount_kind', 'idle_offer', 'update_available',
  'update_seen', 'cost_warned', 'backup_day', 'cost_cap', 'pesach', 'pace_skip', 'ramadan_pace', 'kosher_filled', 'hosting_items', 'recipe_link_at', 'shop_produce', 'shop_care', 'shop_asked', 'dup_no', 'basics_asked', 'daily_q']);
// …and their own marks: `<prefix>:<person>…` (ask_once ends in the person: ask_once:<kind>:<person>, or :house for the house's)
export const PERSON_MARKS = new Set(['ask', 'askq', 'ask_once', 'holiday', 'likes_asked', 'recipe_tip', 'suggest_day', 'joinlife', 'joinfood',
  'notify', 'outfit', 'pick', 'lastphoto', 'shabbat_sent', 'child_chat', 'life_later', 'ramadan_asked', 'pregbasics_asked', 'placebasics']);
// a mark on a fact goes with the fact's person; on a product, where the product may be seen. noticed_yes:<id> is the house's,
// like the noticed table itself, which a download carries whole
export const FACT_MARKS = new Set(['preg_asked', 'period_end']);
export const PRODUCT_MARKS = new Set(['lowok', 'med_warned']);
export const HOUSE_MARKS = new Set(['noticed_yes', 'pesach_end', 'back']); // back:<away id>: מ28
// never in a download, not even one's own (0b, פ5, א4, 105), nor the first meeting's and "start over"'s working state
export const NEVER_OUT = new Set(['distress', 'eating', 'period_done', 'later', 'pushes', 'learnask', 'tells', 'left', 'onboard', 'restart', 'relink_owner', 'baby_born', 'shopday_sent', 'guest_seen', 'mapstop', 'fix']);
const prefixOf = (key) => key.split(':')[0];
const personOf = (key) => { const p = key.split(':'); return p[0] === 'ask_once' ? p[p.length - 1] : p[1]; };
/** The settings a person's /api/state carries. */
export function stateSettings(set, uid) {
  return Object.fromEntries(Object.entries(set).filter(([k]) => STATE_SETTINGS.has(k) || k.startsWith(`child_chat:${uid}:`)));
}
/** May this settings row go out in `uid`'s download? `own`: { facts: ids of facts about them, hidden: ids of products they can't
 * see }. Moving the house with a person's download (setup with a backup) so leaves the others' marks behind: question 29 */
export function inDownload(key, uid, own) {
  if (SECRET_SETTINGS.has(key)) return false;
  if (HOUSE_SETTINGS.has(key)) return true;
  const p = prefixOf(key), rest = key.slice(p.length + 1);
  if (!key.includes(':') || NEVER_OUT.has(p)) return false;
  if (PERSON_MARKS.has(p)) return personOf(key) === String(uid) || (p === 'ask_once' && personOf(key) === 'house');
  if (FACT_MARKS.has(p)) return own.facts.has(Number(rest));
  if (PRODUCT_MARKS.has(p)) return !own.hidden.has(Number(rest.split(':')[0]));
  if (HOUSE_MARKS.has(p)) return true;
  return false;
}

/* ---------------- the backup (also what "download a backup" gets) ---------------- */
export const BACKUP_TABLES = ['users', 'products', 'batches', 'list_items', 'events', 'product_log', 'locations', 'categories', 'receipt_aliases', 'settings', 'recipes', 'recipe_ingredients', 'cooked_log', 'meal_plan', 'meal_plan_items', 'maybe', 'feedback', 'lessons', 'routines', 'leftovers', 'noticed', 'facts', 'house_guests'];
// reader: who it's for. The daily copy is the whole house ({ all: true }); a download leaves out others' private products (0b decision 5)
export async function exportHouse(db, reader) {
  if (!reader) throw new Error('exportHouse needs a reader');
  const mine = reader.all ? '1' : `(private_to IS NULL OR private_to = ${Number(reader.id)})`;
  const ofMine = reader.all ? '1' : `product_id NOT IN (SELECT id FROM products WHERE NOT ${mine})`;
  const res = await db.batch(BACKUP_TABLES.map((t) => db.prepare(
    ['products', 'list_items', 'events'].includes(t) ? `SELECT * FROM ${t} WHERE ${mine}${t === 'products' ? '' : ` AND (product_id IS NULL OR ${ofMine})`}`
      : ['batches', 'product_log'].includes(t) ? `SELECT * FROM ${t} WHERE ${ofMine}`
      : t === 'settings' ? `SELECT * FROM settings WHERE key NOT IN (${[...SECRET_SETTINGS].map((k) => `'${k}'`).join(',')}) AND key NOT LIKE 'distress:%' AND key NOT LIKE 'eating:%' AND key NOT LIKE 'period_done:%' AND key NOT LIKE 'baby_born:%' AND key NOT LIKE 'guest_seen:%' AND key NOT LIKE 'later:%' AND key NOT LIKE 'pushes:%' AND key NOT LIKE 'learnask:%' AND key NOT LIKE 'tells:%' AND key NOT LIKE 'left:%'${reader.all ? '' : ` AND (key NOT LIKE 'child_chat:%' OR key LIKE 'child_chat:${Number(reader.id)}:%')`}` // one person's day (0b); a download: only my own child_chat (b01)
      : t === 'users' ? 'SELECT id, name, gender, role, active, created FROM users'
      : t === 'house_guests' && !reader.all && reader.role === 'child' ? 'SELECT * FROM house_guests WHERE 0' // מ27: a child doesn't get them
        // a backup leaves private facts out (question (a), docs/stage0-questions.md): they stay only on the server
        : t === 'facts' ? `SELECT * FROM facts WHERE private = 0${reader.all ? '' : ` AND NOT (key = 'no_ask' AND NOT (about = 'person' AND about_id = ${Number(reader.id)})) AND NOT (about = 'person' AND about_id = ${Number(reader.id)} AND ${BEATEN})`}` // 64: another's "לא לשאול" only in the daily copy
        // a download (not the daily copy): another's 👎 quotes their own chat; a reminder or weekly buy of another's private product (0b)
        : t === 'feedback' && !reader.all ? `SELECT * FROM feedback WHERE user_id = ${Number(reader.id)}`
        // ...and one that is private itself (private_to, migration 0024, the owner 04/10): only its owner's download carries it
        // home20: which list lines went on for a dish, only of lines this reader's download has
        : t === 'meal_plan_items' && !reader.all ? `SELECT * FROM meal_plan_items WHERE list_item_id IN (SELECT id FROM list_items WHERE ${mine} AND (product_id IS NULL OR ${ofMine}))`
        : ['maybe', 'routines'].includes(t) && !reader.all ? `SELECT * FROM ${t} WHERE (private_to IS NULL OR private_to = ${Number(reader.id)}) AND (product_id IS NULL OR ${ofMine})`
        : `SELECT * FROM ${t}`)));
  const out = Object.fromEntries(BACKUP_TABLES.map((t, i) => [t, res[i].results]));
  if (!reader.all) {
    // מ27: a hosting list's guests go out as its note does, but not who told about them, nor what was counted; not to a child
    out.settings = out.settings.map((r) => { if (r.key !== 'stores') return r; try { return { ...r, value: JSON.stringify(JSON.parse(r.value).map(({ counted: _c, guests, ...x }) => ({ ...x, ...(guests?.length && reader.role !== 'child' && { guests: guests.map(({ by: _b, ...g }) => g) }) }))) }; } catch { return r; } });
    // a shared journal line can hold, for undo, what a private line or product was before ("done shopping"): not in a download (0b)
    const hidden = new Set((await db.prepare('SELECT id FROM products WHERE private_to IS NOT NULL AND private_to != ?').bind(Number(reader.id)).all()).results.map((r) => r.id));
    const theirs = (x) => x && ((x.private_to != null && x.private_to !== Number(reader.id)) || hidden.has(Number(x.product_id)) || hidden.has(Number(x.id)));
    out.events = out.events.map((e) => {
      if (!e.before) return e;
      try {
        const b = JSON.parse(e.before);
        for (const k of ['products', 'list_items']) for (const [id, row] of Object.entries(b[k] || {})) if ((k === 'products' && hidden.has(Number(id))) || theirs(row)) delete b[k][id];
        for (const id of Object.keys(b.batches || {})) if (hidden.has(Number(id))) delete b.batches[id];
        if (b.created) b.created.products = (b.created.products || []).filter((id) => !hidden.has(Number(id)));
        return { ...e, before: JSON.stringify(b) };
      } catch { return { ...e, before: null }; }
    });
    out.receipt_aliases = out.receipt_aliases.filter((a) => !hidden.has(Number(a.product_id)));
    // a recipe's ingredient linked to another's private product doesn't say so (stage 13, S13-5)
    out.recipe_ingredients = out.recipe_ingredients.map((i) => (hidden.has(Number(i.product_id)) ? { ...i, product_id: null } : i));
    out.noticed = out.noticed.filter((n) => n.kind !== 'owner' || n.user_id === Number(reader.id)); // מ1: "only Michal adds…" is hers
    // settings: the house's, and only my own marks (stage 9, task 0): not another's question waiting for them, its fact, their photo
    const facts = new Set((await db.prepare("SELECT id FROM facts WHERE about = 'person' AND about_id = ?").bind(Number(reader.id)).all()).results.map((r) => r.id));
    out.settings = out.settings.filter((r) => inDownload(r.key, reader.id, { facts, hidden }));
    // r13l (15/10): their own chat (the app's and their assistants' threads, only what they see there) and their own private
    // facts, theirs alone. Not tables a restore reads (RESTORE_ORDER), so moving the house with this file brings neither back
    const me = Number(reader.id);
    out.my_chat = (await db.prepare('SELECT id, ts, role, user_id, thread, content FROM chat WHERE thread = ? OR thread IN (SELECT -id FROM connectors WHERE user_id = ?) ORDER BY ts, id').bind(me, me).all()).results
      .map((r) => ({ ...r, content: JSON.parse(r.content) })).filter((r) => (!r.content.only || r.content.only === me) && r.content.notFor !== me);
    out.my_facts = (await db.prepare("SELECT * FROM facts WHERE private = 1 AND about = 'person' AND about_id = ?").bind(me).all()).results;
  }
  return { version: VERSION, made: Date.now(), ...out };
}

/** Today's copy, once a day; older than a week goes. */
export async function dailyBackup(env, now = Date.now()) {
  const db = env.DB; const day = local(now, HOUSE.tz).date;
  const have = await db.prepare('SELECT 1 AS x FROM backups WHERE day = ? LIMIT 1').bind(day).first();
  if (have) return null;
  const parts = await saveCopy(db, day, now);
  const old = (await db.prepare("SELECT DISTINCT day FROM backups WHERE day NOT LIKE 'before:%' ORDER BY day DESC").all()).results.slice(KEEP_DAYS).map((r) => r.day);
  const cutoff = now - 2 * DAY; // "before a restore" copies: two days are enough
  await db.batch([...old.map((d) => db.prepare('DELETE FROM backups WHERE day = ?').bind(d)), db.prepare("DELETE FROM backups WHERE day LIKE 'before:%' AND created < ?").bind(cutoff)]);
  return { day, parts };
}
export async function saveCopy(db, day, now) {
  const text = JSON.stringify(await exportHouse(db, { all: true }));
  const stmts = [db.prepare('DELETE FROM backups WHERE day = ?').bind(day)];
  for (let i = 0, n = 0; i < text.length; i += PART, n++) stmts.push(db.prepare('INSERT INTO backups (day, part, data, created) VALUES (?,?,?,?)').bind(day, n, text.slice(i, i + PART), now));
  await db.batch(stmts);
  return stmts.length - 1;
}
export async function listBackups(db) {
  return (await db.prepare('SELECT day, MIN(created) AS created, SUM(LENGTH(data)) AS size FROM backups GROUP BY day ORDER BY created DESC').all()).results;
}
async function readCopy(db, day) {
  const rows = (await db.prepare('SELECT data FROM backups WHERE day = ? ORDER BY part').bind(day).all()).results;
  return rows.length ? JSON.parse(rows.map((r) => r.data).join('')) : null;
}

/**
 * Put the house back the way it was on `day`. People and their phones stay as they are today (nobody is logged out);
 * everything else — the inventory, the list, the journal, what was learned, the settings — comes from the copy.
 * A copy of right now is kept first, so this can be undone.
 */
export async function restoreDay(env, day, now = Date.now()) {
  const db = env.DB;
  const bk = await readCopy(db, day);
  if (!bk) throw new Error('אין גיבוי מהיום הזה');
  await saveCopy(db, `before:${now}`, now);
  const ids = (xs) => JSON.stringify((xs || []).map((r) => r.id));
  const keepUsers = new Set((await db.prepare('SELECT id FROM users').all()).results.map((u) => u.id));
  const settings = (bk.settings || []).filter((r) => !SECRET_SETTINGS.has(r.key) && !OWN_SETTINGS.has(r.key));
  const cols = async (t) => new Set((await db.prepare(`PRAGMA table_info(${t})`).all()).results.map((c) => c.name));
  // rows that point at a person who isn't in the house any more keep the row, without the person
  const fixUser = (row) => { const r = { ...row }; for (const k of ['user_id', 'added_by', 'checked_by', 'updated_by', 'set_by', 'owner']) if (r[k] != null && !keepUsers.has(r[k])) r[k] = null; return r; };
  const insertAll = async (t, rows) => {
    const have = await cols(t); const out = [];
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400).map(fixUser);
      const keys = [...new Set(chunk.flatMap((r) => Object.keys(r)))].filter((k) => have.has(k));
      if (!keys.length) continue;
      // one statement per chunk: the rows travel as JSON (D1 counts statements, not rows)
      out.push(db.prepare(`INSERT OR REPLACE INTO ${t} (${keys.join(',')}) SELECT ${keys.map((k) => `json_extract(value, '$.${k}')`).join(',')} FROM json_each(?)`).bind(JSON.stringify(chunk)));
    }
    return out;
  };
  const stmts = [
    // what hangs on products first, then the products that aren't in the copy, then the places and categories
    ...['batches', 'list_items', 'product_log', 'receipt_aliases', 'maybe', 'events', 'recipes', 'recipe_ingredients', 'feedback', 'lessons', 'routines', 'leftovers', 'meal_plan', 'meal_plan_items'].map((t) => db.prepare(`DELETE FROM ${t}`)), // home20: the plan with the list it was made against
    db.prepare('DELETE FROM product_photos WHERE product_id NOT IN (SELECT value FROM json_each(?))').bind(ids(bk.products)),
    ...await insertAll('locations', bk.locations || []),
    ...await insertAll('categories', bk.categories || []),
    ...await insertAll('products', bk.products || []),
    db.prepare('DELETE FROM products WHERE id NOT IN (SELECT value FROM json_each(?))').bind(ids(bk.products)),
    db.prepare('DELETE FROM locations WHERE id NOT IN (SELECT value FROM json_each(?))').bind(ids(bk.locations)),
    db.prepare('DELETE FROM categories WHERE id NOT IN (SELECT value FROM json_each(?))').bind(ids(bk.categories)),
    ...(await Promise.all(['batches', 'list_items', 'events', 'product_log', 'receipt_aliases', 'recipes', 'recipe_ingredients', 'maybe', 'feedback', 'lessons', 'routines', 'leftovers', 'meal_plan', 'meal_plan_items'].map((t) => insertAll(t, bk[t] || [])))).flat(),
    // today's choices stay: notifications, outfits, and (0b) whether a parent sees a child's chat, today's personal-message
    // counts and a child's 24-hour distress mark
    db.prepare(`DELETE FROM settings WHERE key NOT IN (${[...SECRET_SETTINGS, ...OWN_SETTINGS].map((k) => `'${k}'`).join(',')}) AND key NOT LIKE 'notify:%' AND key NOT LIKE 'outfit:%' AND key NOT LIKE 'child_chat:%' AND key NOT LIKE 'tells:%' AND key NOT LIKE 'distress:%' AND key NOT LIKE 'eating:%' AND key NOT LIKE 'period_done:%' AND key NOT LIKE 'baby_born:%' AND key NOT LIKE 'guest_seen:%' AND key NOT LIKE 'left:%'`), // פ5's mark: kept, and א4's record that a period ended, like distress:; and when someone left (105)
    ...await insertAll('settings', settings.filter((r) => !/^(notify|outfit|child_chat|tells|distress|eating|period_done|baby_born|guest_seen|left):/.test(r.key))),
    // cards waiting for approval were made against today's house
    db.prepare("UPDATE proposals SET status = 'expired' WHERE status = 'pending'"),
  ];
  await db.batch(stmts);
  // whoever isn't in the house any more gets nothing private back from a copy made before they left: their private
  // products and what hangs on them, and their private journal lines, go as when they left (the owner 08/10, question 105)
  // and whoever left after the copy was made, though they (or someone with their name, the same id) are back now
  const gone = (await db.prepare("SELECT id FROM users WHERE active = 0 OR id IN (SELECT CAST(substr(key, 6) AS INTEGER) FROM settings WHERE key LIKE 'left:%' AND CAST(value AS INTEGER) > ?)").bind(Number(bk.made) || 0).all()).results;
  // ...and Shuki's own marks about them that the copy brought back (stage 8, question 21)
  for (const { id } of gone) { await forgetPrivate(db, id); await forgetMarks(db, id); }
  await dropOrphanMarks(db).run(); // a mark of a fact deleted since the copy, whoever's it was
  // facts aren't restored from a day's copy: today's stay as they are, and what was forgotten or left doesn't come back.
  // The one exception: a copy from before 0c keeps "keeps Shabbat" as a setting
  await shabbatFromSettings(db, now);
  return { products: (bk.products || []).filter((p) => !p.deleted).length, list: (bk.list_items || []).filter((i) => i.status === 'open').length, made: bk.made };
}

/* ---------------- what Shuki costs this month ---------------- */
// Sonnet 5: $2 per million input tokens, $10 per million output (anthropic.com/news/claude-sonnet-5). Override with PRICE_IN / PRICE_OUT.
export async function monthCost(env, now = Date.now()) {
  const month = local(now, HOUSE.tz).month;
  const u = await env.DB.prepare('SELECT * FROM usage WHERE month = ?').bind(month).first();
  const pin = Number(env.PRICE_IN || 2), pout = Number(env.PRICE_OUT || 10);
  // priced per call since round 18 (micro, per provider); older months only have the token counts
  const spent = !u ? 0 : u.micro ? u.micro / 1e6 : (u.input_tokens * pin + u.output_tokens * pout) / 1e6;
  const set = await env.DB.prepare("SELECT value FROM settings WHERE key = 'cost_cap'").first();
  // the admin's cap; otherwise the server's (MONTHLY_COST_CAP in dollars, or the old MONTHLY_TOKEN_CAP)
  const cap = Number(set?.value) || Number(env.MONTHLY_COST_CAP) || (Number(env.MONTHLY_TOKEN_CAP || 5_000_000) * pin) / 1e6;
  return { month, spent: Math.round(spent * 100) / 100, cap, own: !!set };
}
/** 80% of the cap: the admins hear once a month. */
export async function costWarning(env, now, pushTo) {
  const c = await monthCost(env, now);
  if (c.spent < 0.8 * c.cap) return null;
  const warned = await env.DB.prepare("SELECT value FROM settings WHERE key = 'cost_warned'").first();
  if (warned?.value === c.month) return null;
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cost_warned', ?)").bind(c.month).run();
  const admins = (await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all()).results.map((u) => u.id);
  await pushTo({ title: '80% מהתקרה החודשית', body: `החודש עליתי לכם בערך $${c.spent.toFixed(2)} מתוך $${c.cap}. כשמגיעים לתקרה אני נח עד סוף החודש. אפשר להעלות אותה בהגדרות → הבית.`, url: './#settings' }, admins);
  return c;
}

/* ---------------- 👎 ---------------- */
export async function saveFeedback(env, user, chatId, note, catalog, kind = 'down') {
  const db = env.DB;
  // only an answer in my own chat (or the house's): never a line from someone else's thread (0b)
  const row = await db.prepare("SELECT * FROM chat WHERE id = ? AND role = 'shuki' AND (thread = ? OR thread IS NULL)").bind(chatId, user.id).first();
  // a distress answer has no 👍/👎 and is never copied out of its thread (0b, r11 q013, q073–q074): the existing words
  if (!row || JSON.parse(row.content).sensitive) throw new Error('התשובה הזאת כבר לא בצ\'אט');
  const c = JSON.parse(row.content);
  // the explanation itself is a distress: it isn't kept here (it goes to the chat, where it's handled and kept only with the writer)
  if (note && distressOf(String(note))) note = '';
  const up = kind === 'up';
  await db.prepare('INSERT INTO feedback (ts, user_id, chat_id, question, reply, note, state, kind) VALUES (?,?,?,?,?,?,?,?)').bind(
    // only Shuki's answer and the explanation (r11 q022, r0t p3): not the question that was asked, not the house's stock
    Date.now(), user.id, chatId, '', JSON.stringify({ reply: c.reply, lines: c.proposal?.lines?.map((l) => l.text) || [] }), String(note || '').slice(0, 500), '', up ? 'up' : 'down',
  ).run();
  // the thumb stays pressed; the other one lets go
  if (up) { c.up = true; delete c.down; } else { c.down = true; delete c.up; }
  await db.prepare('UPDATE chat SET content = ? WHERE id = ?').bind(JSON.stringify(c), chatId).run();
  return { ok: true };
}

/* ---------------- CSV for a spreadsheet (decision 112) ---------------- */
// a cell that starts like a formula (=, +, -, @) is text, not a formula, when the spreadsheet opens it
const csvCell = (v) => { let t = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(t) && typeof v !== 'number') t = `'${t}`; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const csv = (rows) => `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`; // the BOM tells Excel it's UTF-8 (Hebrew)
export async function exportCsv(db, what, tz, reader) {
  if (!reader) throw new Error('exportCsv needs a reader');
  const mine = reader.all ? '1' : `(p.private_to IS NULL OR p.private_to = ${Number(reader.id)})`;
  const day = (ts) => (ts ? local(ts, tz).date : '');
  if (what === 'history') {
    const rows = (await db.prepare(`SELECT l.ts, l.kind, p.name, u.name AS who FROM product_log l JOIN products p ON p.id = l.product_id LEFT JOIN events e ON e.id = l.event_id LEFT JOIN users u ON u.id = e.user_id WHERE e.undone IS NULL AND ${mine} ORDER BY l.ts`).all()).results;
    return csv([['תאריך', 'מוצר', 'מה', 'מי'], ...rows.map((r) => [day(r.ts), r.name, { purchase: 'קנייה', out: 'נגמר', return: 'החזרה' }[r.kind] || r.kind, r.who || ''])]);
  }
  const rows = (await db.prepare(`SELECT p.*, l.name AS loc, c.name AS cat FROM products p LEFT JOIN locations l ON l.id = p.location_id LEFT JOIN categories c ON c.id = p.category_id WHERE p.deleted IS NULL AND ${mine} ORDER BY c.sort, p.name`).all()).results;
  return csv([['מוצר', 'כמות', 'יחידה', 'מיקום', 'קטגוריה', 'קבוע', 'מינימום', 'חנות', 'מותג', 'תוקף'],
    ...rows.map((p) => [p.name, p.count_type === 'level' ? ({ plenty: 'הרבה', little: 'מעט', none: 'נגמר' }[p.level] || '') : p.qty ?? 0, p.count_type === 'pack' ? 'יחידות' : p.unit || '', p.loc || '', p.cat || '', p.is_basic ? 'כן' : '', p.is_basic ? p.target ?? '' : '', STORE_NAMES[p.shop || p.store] || '', p.brand || '', day(p.expires)])]);
}

/* ---------------- delete the house (decision 110): everything goes, the server waits for a new setup ---------------- */
const ALL_TABLES = ['house_guests', 'meal_plan_items', 'meal_plan', 'cooked_log', 'chat', 'proposals', 'noticed', 'connectors', 'feedback', 'lessons', 'facts', 'routines', 'leftovers', 'backups', 'maybe', 'away', 'shopping', 'list_items', 'batches', 'product_log',
  'product_photos', 'receipt_aliases', 'recipe_photos', 'recipe_ingredients', 'recipes', 'events', 'products', 'devices', 'pairing_codes', 'pair_attempts', 'removed', 'usage', 'settings', 'users', 'locations', 'categories'];
export const DEFAULT_LOCATIONS = ['מקרר', 'מקפיא', 'מזווה', 'ארון מטבח', 'ארון אמבטיה', 'ארון ניקיון', 'מחסן'];
export const DEFAULT_CATEGORIES = [['ירקות ופירות', 1], ['מוצרי חלב, גבינות וביצים', 2], ['בשר, עוף ודגים', 3], ['תחליפי בשר', 4], ['לחם ומאפים', 5], ['יבשים', 6], ['שימורים ורטבים', 7],
  ['תבלינים ושמנים', 8], ['חטיפים ומתוקים', 9], ['משקאות', 10], ['ניקיון וכביסה', 11], ['טואלטיקה והיגיינה', 12], ['תרופות ועזרה ראשונה', 13], ['חד-פעמי ונייר', 14],
  ['תחזוקת בית', 15], ['חיות מחמד', 16], ['תינוק', 17], ['אחר', 99]]; // תינוק: stage 8, ו6 (migration 0030)
export async function deleteHouse(db) {
  const have = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results.map((r) => r.name));
  await db.batch([
    ...ALL_TABLES.filter((t) => have.has(t)).map((t) => db.prepare(`DELETE FROM ${t}`)),
    ...DEFAULT_LOCATIONS.map((n, i) => db.prepare('INSERT INTO locations (name, sort) VALUES (?, ?)').bind(n, i + 1)),
    ...DEFAULT_CATEGORIES.map(([n, s]) => db.prepare('INSERT INTO categories (name, sort) VALUES (?, ?)').bind(n, s)),
  ]);
}

/* ---------------- a house nobody used for two weeks ---------------- */
export const IDLE_YES = 'כן, נעבור', IDLE_NO = 'לא עכשיו';
/** The first time someone opens the chat after two quiet weeks: offer, once, to go over what may have changed. */
export async function idleOffer(env, now = Date.now()) {
  const db = env.DB;
  const last = (await db.prepare("SELECT MAX(ts) AS ts FROM events WHERE type NOT IN ('undo')").first())?.ts;
  if (!last || now - last < 14 * DAY) return false;
  const done = await db.prepare("SELECT value FROM settings WHERE key = 'idle_offer'").first();
  if (done && Number(done.value) >= last) return false; // already offered for this quiet stretch
  if (await serverCardUp(db, now)) return false; // one card from the server at a time (r12 q031); asked once it's gone
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('idle_offer', ?)").bind(String(now)),
    ...chatRows(db, now, null, 'shuki', { reply: 'התגעגעתי! עבר קצת זמן מאז שדיברנו כאן. האם נעבור יחד על כמה דברים שאולי השתנו?', face: 'sad', options: [IDLE_YES, IDLE_NO], offer: 'idle', card: 1 }),
  ]);
  return true;
}
/** "yes, let's go over it": the basics and what spoils, a dozen at most, as the recount card. */
export async function idleRecount(env, now = Date.now()) {
  const S = await loadAll(env.DB, SHARED); // the whole house is asked: nothing private (0b)
  const ps = S.products.filter((p) => !p.deleted && !p.occasional && (p.is_basic || (p.shelf_days && p.shelf_days <= 21) || p.count_type === 'batches') && !isOut(p))
    .sort((a, b) => (b.is_basic - a.is_basic) || ((a.shelf_days || 99) - (b.shelf_days || 99))).slice(0, 12).map((p) => p.id);
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_at', ?)").bind(String(now)),
    env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_ids', ?)").bind(JSON.stringify(ps)),
    env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_kind', 'idle')"),
  ]);
  return ps.length;
}

/* ---------------- a new version (open source: UPDATE_REPO = "owner/repo") ---------------- */
const newer = (a, b) => { const x = String(a).replace(/^v/, '').split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
/** GitHub that doesn't answer (or answers slowly) never holds up the daily run: 10 seconds, then on without it (the owner 03/10). */
export const UPDATE_MS = 10e3;
export async function checkUpdate(env, ms = UPDATE_MS) {
  if (!env.UPDATE_REPO || !/^[\w.-]+\/[\w.-]+$/.test(env.UPDATE_REPO)) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${env.UPDATE_REPO}/releases/latest`, { headers: { 'user-agent': 'shuki', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    const j = await r.json();
    const v = newer(j.tag_name, VERSION) ? JSON.stringify({ tag: String(j.tag_name).slice(0, 30), url: String(j.html_url || '').slice(0, 200) }) : null;
    await env.DB.prepare(v ? "INSERT OR REPLACE INTO settings (key, value) VALUES ('update_available', ?)" : "DELETE FROM settings WHERE key = 'update_available' AND ? IS NOT NULL").bind(v || '1').run();
    return v;
  } catch (e) { console.error('checkUpdate', e.name === 'TimeoutError' ? `no answer in ${ms}ms` : e.message); return null; }
}

/* ---------------- adding someone to the house (settings, and the first meeting) ---------------- */
const DAY_MS = 86400e3;
/**
 * Someone who leaves frees their name (stage 13, d4, question 107): an invisible WORD JOINER (U+2060) at its end, one more for
 * each earlier one with that name, so the next person with that name gets a new id and nothing of theirs. Reads the same.
 * Returns the statement, for the batch of the leaving.
 */
export async function freeName(db, id) {
  const u = await db.prepare('SELECT name FROM users WHERE id = ?').bind(id).first();
  if (!u) return null;
  const base = u.name.replace(/\u2060+$/, '');
  const taken = new Set((await db.prepare('SELECT name FROM users WHERE name = ? OR name LIKE ?').bind(base, `${base}\u2060%`).all()).results.map((r) => r.name));
  let k = 1; while (taken.has(base + '\u2060'.repeat(k))) k++;
  return db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(base + '\u2060'.repeat(k), id);
}
/** { name, gender: 'm'|'f'|'p', role: 'member'|'child' } → { id, name, code, expires } or { error }. Always a new person, with a new id: someone who left freed their name (freeName), and comes back as someone new (stage 13, d4). */
export async function addMember(db, add, now = Date.now()) {
  const name = String(add?.name || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!name) return { error: ['m', 'f', 'p'].includes(add?.gender) ? byPerson(add, 'מה השם שלו?', 'מה השם שלה?', 'מה השם שלהם?') : 'מה השם שלו או שלה?' };
  if (!['m', 'f', 'p'].includes(add.gender)) return { error: 'איך לפנות אליו או אליה?' };
  const ex = await db.prepare('SELECT id, active FROM users WHERE name = ?').bind(name).first();
  if (ex?.active) return { error: `כבר יש בבית ${name}` };
  if (ex) { const free = await freeName(db, ex.id); if (free) await free.run(); } // left before freeName existed, and not freed
  if ((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').first()).n >= 12) return { error: 'אפשר עד 12 אנשים בבית' };
  const role = add.role === 'child' ? 'child' : 'member';
  const u = await db.prepare('INSERT INTO users (name, gender, role, active, created) VALUES (?, ?, ?, 1, ?) RETURNING id').bind(name, add.gender, role, now).first();
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  await db.prepare('INSERT OR REPLACE INTO pairing_codes (code, user_id, expires, used, created) VALUES (?, ?, ?, NULL, ?)').bind(code, u.id, now + 7 * DAY_MS, now).run();
  return { id: u.id, name, code, expires: now + 7 * DAY_MS };
}
