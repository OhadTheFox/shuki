// "להתחיל מהתחלה" in the chat (approved by the owner, 01/10): the house's admin empties the inventory, the list and the
// chat, and keeps the people, the phones, the recipes, the places and what Shuki learned. A copy is saved first.
// Then Shuki asks whether the people changed: someone new is added (with a phone code), someone who left goes, after a yes.
import { addMember, saveCopy, freeName } from './house.js';
import { forgetPerson, forgetMarks, unlinkGoneChats } from './facts.js';
import { forgetPrivate } from './private.js';
import { byPerson } from '../public/hebrew.js';
import { childSaid } from './onboarding.js';
import { linkProduct } from '../public/recipes.js';

const KEY = 'restart';
export const RESTART_YES = 'כן, מתחילים מחדש', RESTART_NO = 'לא';
export const SAME = 'לא, הכל אותו דבר', CHANGED = 'כן';
const OUT_YES = 'כן, להוציא';
const MY_GENDER = ['בלשון זכר', 'בלשון נקבה', 'בלשון רבים']; // 7ב: the third, in the same order (r7d, 1.3)
const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ו${xs.at(-1)}` : xs[0] || '');

/** "להתחיל מהתחלה", "נתחיל מחדש", "לאפס הכל", "למחוק הכל". */
export const wantsRestart = (t) => /(להתחיל|נתחיל|מתחילים|להתחיל את הכל)\s+(מ?חדש|מההתחלה|מהתחלה)|לאפס\s+(את\s+)?(הכל|הבית|המלאי|הכול)|למחוק\s+(את\s+)?(הכל|הכול)(?!\s+מהרשימה)/.test(t);

async function getState(db) { const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(KEY).first(); return r ? JSON.parse(r.value) : null; }
const setState = (db, s) => (s ? db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(KEY, JSON.stringify(s)).run() : db.prepare('DELETE FROM settings WHERE key = ?').bind(KEY).run());

const TOOL = {
  name: 'people_now',
  description: 'Who lives in the house now, from one answer.',
  input_schema: {
    type: 'object',
    properties: {
      alone: { type: 'boolean', description: 'the writer lives alone now' },
      people: { type: 'array', description: 'everyone they said lives in the house now, NOT the writer', items: { type: 'object', properties: {
        name: { type: 'string', description: 'Hebrew name as written' },
        gender: { type: 'string', enum: ['m', 'f', 'unknown'], description: 'from the words or the name; unknown only for names used for both (נועם, טל, עדי, רוני, שחר, יובל) when nothing else was said' },
        child: { type: 'boolean', description: 'true ONLY when said in so many words: הבן, הבת, ילד, ילדה, הילדים, or an age under 18. Anyone else is a grown-up (false)' }, age: { type: 'integer' },
      }, required: ['name', 'gender', 'child'] } },
    },
  },
};

/** The inventory, the list and the chat go; a copy first. Recipes will link again to products as they come back. */
async function wipe(db, now) {
  await saveCopy(db, `before:${now}`, now);
  const have = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results.map((r) => r.name));
  // a recipe's ingredient remembers its product by name, and finds it again when a product with that name is back
  // only shared products: a private one's name would be in the house's copies through settings (stage 13, S13-5)
  const linked = have.has('recipe_ingredients') ? (await db.prepare('SELECT i.id, p.name FROM recipe_ingredients i JOIN products p ON p.id = i.product_id WHERE p.private_to IS NULL').all()).results : [];
  // מ29 (q108): whose a product was, by its name, for when it comes back; not a private one (its name would be in the house's
  // copies through settings), and only someone who still lives in the house
  const owners = (await db.prepare('SELECT p.name, p.owner FROM products p JOIN users u ON u.id = p.owner AND u.active = 1 WHERE p.deleted IS NULL AND p.private_to IS NULL AND p.owner IS NOT NULL').all()).results;
  const stmts = [];
  if (have.has('routines')) stmts.push(db.prepare('UPDATE routines SET text = COALESCE(text, (SELECT name FROM products WHERE products.id = routines.product_id)), product_id = NULL WHERE product_id IS NOT NULL'));
  if (have.has('recipe_ingredients')) stmts.push(db.prepare('UPDATE recipe_ingredients SET product_id = NULL WHERE product_id IS NOT NULL'));
  for (const t of ['batches', 'product_log', 'receipt_aliases', 'maybe', 'product_photos', 'noticed', 'leftovers', 'list_items', 'proposals', 'shopping', 'products', 'chat']) if (have.has(t)) stmts.push(db.prepare(`DELETE FROM ${t}`));
  stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('relink', ?)").bind(JSON.stringify(linked)));
  stmts.push(owners.length ? db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('relink_owner', ?)").bind(JSON.stringify(owners)) : db.prepare("DELETE FROM settings WHERE key = 'relink_owner'"));
  await db.batch(stmts);
  if (have.has('facts')) await unlinkGoneChats(db); // what Shuki learned stays, like the rules; the chat it came from is gone
}

/** מ29: a product that comes back after "להתחיל מהתחלה", shared and with nobody's name on it, is theirs again. Run before the
 * state is read (buildState), so the first state after it already says whose it is. */
export async function relinkOwners(db) {
  const o = await db.prepare("SELECT value FROM settings WHERE key = 'relink_owner'").first();
  if (!o) return;
  const want = JSON.parse(o.value || '[]');
  if (!want.length) { await db.prepare("DELETE FROM settings WHERE key = 'relink_owner'").run(); return; }
  const names = new Set((await db.prepare('SELECT name FROM products WHERE deleted IS NULL AND private_to IS NULL AND owner IS NULL').all()).results.map((p) => p.name));
  const back = want.filter((x) => names.has(x.name));
  if (!back.length) return;
  const rest = want.filter((x) => !back.includes(x) && !back.some((y) => y.name === x.name)); // one line for a name: the first
  await db.batch([...back.filter((x, i) => back.findIndex((y) => y.name === x.name) === i).map((x) => db.prepare('UPDATE products SET owner = ? WHERE id = (SELECT MIN(id) FROM products WHERE name = ? AND deleted IS NULL AND private_to IS NULL AND owner IS NULL)').bind(x.owner, x.name)),
    rest.length ? db.prepare("UPDATE settings SET value = ? WHERE key = 'relink_owner'").bind(JSON.stringify(rest)) : db.prepare("DELETE FROM settings WHERE key = 'relink_owner'")]);
}
/** Recipes' ingredients find their products again, by name, as the products come back after "להתחיל מהתחלה". */
export async function relink(db, products) {
  // a substitute finds its products again by name too, when they're back (r10 q108, r0t r10-3)
  const ids = new Set(products.filter((p) => !p.deleted).map((p) => p.id));
  const named = new Map(products.filter((p) => !p.deleted && p.private_to == null).map((p) => [p.name, p.id]));
  const subs = (await db.prepare("SELECT id, value FROM facts WHERE key = 'substitute'").all().catch(() => ({ results: [] }))).results;
  for (const f of subs) {
    let v; try { v = JSON.parse(f.value); } catch { continue; }
    if (!v?.from || !v?.to) continue;
    let changed = false;
    for (const side of [v.from, v.to]) if (side.name && !ids.has(side.id) && named.has(side.name)) { side.id = named.get(side.name); changed = true; }
    if (changed) await db.prepare('UPDATE facts SET value = ? WHERE id = ?').bind(JSON.stringify(v), f.id).run();
  }
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'relink'").first();
  if (!r) return;
  const left = JSON.parse(r.value || '[]');
  const byName = new Map(products.filter((p) => !p.deleted && p.private_to == null).map((p) => [p.name, p.id])); // shared only (S13-5)
  const now = left.filter((x) => byName.has(x.name));
  if (!now.length) return;
  const rest = left.filter((x) => !byName.has(x.name));
  await db.batch([
    ...now.map((x) => db.prepare('UPDATE recipe_ingredients SET product_id = ? WHERE id = ? AND product_id IS NULL').bind(byName.get(x.name), x.id)),
    rest.length ? db.prepare("UPDATE settings SET value = ? WHERE key = 'relink'").bind(JSON.stringify(rest)) : db.prepare("DELETE FROM settings WHERE key = 'relink'"),
  ]);
}

/**
 * i1 (stage 11): an ingredient with no live product finds one that was added after the recipe was saved ("ביצים" bought a
 * week after the recipe came in). Only products new since the last look are tried, so an ingredient someone unlinked by
 * hand stays as it is until a new product fits it; the first look in a house only sets the mark. Shared products only, so
 * it's the same whoever's state runs it. New = by the product's id, which the server makes from its own clock (newId), not
 * by `created`, which can be a phone's (a queued action's ts). Ten minutes back from the mark, for a product written after
 * another request's state had already moved it; `seen` keeps those from being tried twice. A new product wins only when it
 * is the best of all the house's products for that name ("חלב" stays unlinked next to an old "חלב", not "חלב שקדים").
 */
const LINK_MARGIN = 10 * 60e3 * 1000, LINK_MAX = 40; // ids are ms × 1000; at most 40 products a look: the rest, the next one
export async function linkNew(db, products) {
  const shared = products.filter((p) => !p.deleted && p.private_to == null);
  const near = (at) => shared.filter((p) => p.id > at - LINK_MARGIN && p.id <= at).map((p) => p.id);
  // home19 (2): a product that got a new alias ("מיוקל זה סוג של מיונז") is tried like a new one: the mark keeps each one's aliases
  const aliasesOf = (p) => { try { return JSON.stringify(Array.isArray(p.aliases) ? p.aliases : JSON.parse(p.aliases || '[]')); } catch { return '[]'; } };
  const al = () => Object.fromEntries(shared.filter((p) => aliasesOf(p) !== '[]').map((p) => [p.id, aliasesOf(p)]));
  const mark = (at) => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recipe_link_at', ?)").bind(JSON.stringify({ at, seen: near(at), ...(Object.keys(al()).length && { al: al() }) }));
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'recipe_link_at'").first();
  if (!r) { await mark(Math.max(0, ...shared.map((p) => p.id))).run(); return; }
  let m; try { m = JSON.parse(r.value); } catch { m = {}; }
  const at0 = Number(m.at) || 0, seen = new Set(m.seen || []);
  const fresh = shared.filter((p) => p.id > at0 - LINK_MARGIN && !seen.has(p.id)).sort((a, b) => a.id - b.id).slice(0, LINK_MAX);
  const al0 = m.al || {}; // none yet (a mark from before home19): every product with aliases, once
  const aliased = shared.filter((p) => aliasesOf(p) !== '[]' && al0[p.id] !== aliasesOf(p) && !fresh.includes(p));
  if (!fresh.length && !aliased.length) return;
  const at = Math.max(at0, ...fresh.map((p) => p.id));
  const isNew = new Set([...fresh, ...aliased].map((p) => p.id));
  // the aliases read once, not once for every ingredient
  const all = shared.map((p) => ({ id: p.id, name: p.name, aliases: Array.isArray(p.aliases) ? p.aliases : JSON.parse(p.aliases || '[]') }));
  const cand = all.filter((p) => isNew.has(p.id));
  const rows = (await db.prepare('SELECT i.id, i.name FROM recipe_ingredients i LEFT JOIN products p ON p.id = i.product_id WHERE i.product_id IS NULL OR p.id IS NULL OR p.deleted IS NOT NULL').all()).results;
  const byName = new Map(); // the same name in many recipes ("בצל"): matched once; against all only when a new one fits
  const to = new Map(); // product → its ingredients
  for (const i of rows) {
    if (!byName.has(i.name)) byName.set(i.name, linkProduct(i.name, cand) ? linkProduct(i.name, all)?.id ?? null : null);
    const pid = byName.get(i.name);
    if (pid != null && isNew.has(pid)) (to.get(pid) || to.set(pid, []).get(pid)).push(i.id);
  }
  // one statement for each product, and not over a link made meanwhile (a hand link in the recipe's edit)
  const stmts = [...to].map(([pid, ids]) => db.prepare('UPDATE recipe_ingredients SET product_id = ? WHERE id IN (SELECT value FROM json_each(?)) AND (product_id IS NULL OR product_id NOT IN (SELECT id FROM products WHERE deleted IS NULL))').bind(pid, JSON.stringify(ids)));
  // linked here, it no longer waits in "relink" for its old name to come back
  const rl = to.size ? await db.prepare("SELECT value FROM settings WHERE key = 'relink'").first() : null;
  if (rl) {
    const ids = new Set([...to.values()].flat());
    const rest = JSON.parse(rl.value || '[]').filter((x) => !ids.has(x.id));
    stmts.push(rest.length ? db.prepare("UPDATE settings SET value = ? WHERE key = 'relink'").bind(JSON.stringify(rest)) : db.prepare("DELETE FROM settings WHERE key = 'relink'"));
  }
  await db.batch([...stmts, mark(at)]);
}

const done = () => ({ reply: 'סיימנו! אפשר להתחיל לספר לי מה יש בבית.', face: 'excited', reaction: 'love' });

/** The next thing to settle about the people: a gender to ask, someone to add, someone who may have left. */
async function next(db, s, user, out, now) {
  while (s.add?.length) {
    const x = s.add[0];
    if (!['m', 'f', 'p'].includes(x.gender)) { s.step = 'gender'; await setState(db, s); out.push({ reply: `איך לפנות ל${x.name}?`, face: 'confused', options: MY_GENDER }); return out; }
    s.add.shift();
    const r = await addMember(db, { name: x.name, gender: x.gender, role: x.child && !(x.age >= 16) ? 'child' : 'member' }, now);
    if (!r.error) (s.added ||= []).push({ name: r.name, code: r.code, gender: x.gender });
  }
  if (s.added?.length) {
    out.push({ reply: `איזה כיף, עכשיו אני מכיר גם את ${and(s.added.map((x) => x.name))}!`, face: 'ecstatic', reaction: 'newMember' });
    out.push({ reply: s.added.length > 1 ? 'הנה הקודים שלהם לטלפון. הם תקפים לשבוע.' : `הנה הקוד ${byPerson(s.added[0], 'שלו', 'שלה', 'שלהם')} לטלפון. הוא תקף לשבוע.`, face: 'happy', codes: s.added, only: user.id });
    s.added = [];
  }
  if (s.leave?.length) {
    const u = s.leave[0];
    s.step = 'leave'; await setState(db, s);
    out.push({ reply: `האם ${u.name} כבר לא ${byPerson(u, 'גר', 'גרה', 'גרים')} בבית?`, face: 'confused', options: [OUT_YES, `לא, ${byPerson(u, 'נשאר', 'נשארת', 'נשארים')}`] });
    return out;
  }
  await setState(db, null);
  out.push(done());
  return out;
}

/**
 * One chat message, when it belongs to "להתחיל מהתחלה". Returns the bubbles, or null when it doesn't (then the chat goes
 * on as usual). Only the house's admin; anyone else asking gets the model's answer.
 */
export async function restartStep(env, user, t, { think, record, saveChat, outOfHouse }) {
  const db = env.DB; const now = Date.now();
  let s = await getState(db);
  if (s && s.user !== user.id) s = null;
  if (!s) {
    if (user.role !== 'admin' || !wantsRestart(t)) return null;
    await saveChat(env, user, 'user', { text: t }, now);
    await setState(db, { user: user.id, step: 'confirm', started: now });
    return [{ reply: "האם למחוק את המלאי, הרשימה והצ'אט ולהתחיל מחדש? חברי הבית והטלפונים נשארים. לפני כן אשמור גיבוי.", face: 'confused', options: [RESTART_YES, RESTART_NO] }];
  }
  const tap = (xs) => xs.includes(t);
  if (s.step === 'confirm') {
    if (t === RESTART_NO) { await setState(db, null); await saveChat(env, user, 'user', { text: t }, now); return [{ reply: 'בסדר, לא נגעתי בכלום.', face: 'happy' }]; }
    if (t !== RESTART_YES) { await setState(db, null); return null; }
    await wipe(db, now);
    await setState(db, { ...s, step: 'members' });
    return [{ reply: 'האם היו שינויים בחברי הבית? האם מישהו הצטרף או עזב?', face: 'happy', options: [CHANGED, SAME] }];
  }
  // anything that isn't an answer here ends this, and goes to the chat as usual
  const answers = { members: [SAME, CHANGED], gender: MY_GENDER, leave: [OUT_YES, `לא, ${byPerson(s.leave?.[0], 'נשאר', 'נשארת', 'נשארים')}`] }[s.step];
  if (answers && !tap(answers)) { await setState(db, null); return null; }
  await saveChat(env, user, 'user', { text: t }, now);
  if (s.step === 'members') {
    if (t === SAME) { await setState(db, null); return [done()]; }
    await setState(db, { ...s, step: 'people' });
    return [{ reply: 'ספרו לי מי גר בבית עכשיו.', face: 'excited' }];
  }
  if (s.step === 'people') {
    const users = (await db.prepare('SELECT id, name, gender, role FROM users WHERE active = 1').all()).results;
    const system = `אתה קורא תשובה אחת: מי גר בבית עכשיו. אל תנסח תשובה, רק מלא את השדות.
מי שכותב: ${user.name}. בני הבית הרשומים: ${users.map((u) => u.name).join(', ')}.`;
    const { out: p = {}, usage } = await think(env, [{ type: 'text', text: system }], [{ role: 'user', content: t }], TOOL);
    await record(env, usage);
    const said = (p.people || []).filter((x) => x.name?.trim()).map((x) => ({ ...x, name: x.name.trim(), child: childSaid(x, t) })).filter((x) => x.name !== user.name); // a child only when said (16/10)
    const known = new Set(users.map((u) => u.name));
    s.add = said.filter((x) => !known.has(x.name));
    s.leave = users.filter((u) => u.id !== user.id && !said.some((x) => x.name === u.name)).map((u) => ({ id: u.id, name: u.name, gender: u.gender, role: u.role }));
    return next(db, s, user, [], now);
  }
  if (s.step === 'gender') {
    s.add[0].gender = t === MY_GENDER[2] ? 'p' : t === MY_GENDER[1] ? 'f' : 'm';
    return next(db, s, user, [], now);
  }
  if (s.step === 'leave') {
    const u = s.leave.shift(); const out = [];
    if (t === OUT_YES) {
      const admins = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND role = 'admin'").first()).n;
      if (!(u.role === 'admin' && admins <= 1)) {
        await db.batch([
          ...(outOfHouse ? await outOfHouse(env, u, user, now) : []), // 56 (the owner 05/10): as from "להוציא מהבית", c05 and c06
          db.prepare('DELETE FROM chat WHERE thread = ? OR thread IN (SELECT -id FROM connectors WHERE user_id = ?)').bind(u.id, u.id), // r11 q015
          db.prepare("UPDATE users SET active = 0, role = 'member' WHERE id = ?").bind(u.id),
          db.prepare('DELETE FROM devices WHERE user_id = ?').bind(u.id),
          db.prepare('DELETE FROM pairing_codes WHERE user_id = ?').bind(u.id),
          db.prepare('DELETE FROM settings WHERE key IN (?, ?, ?)').bind(`ask:${u.id}`, `askq:${u.id}`, `eating:${u.id}`), // their waiting questions go with them (64), and פ5's mark
          db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`left:${u.id}`, String(now)), // when they left (105), as from "להוציא מהבית"
          db.prepare('DELETE FROM connectors WHERE user_id = ?').bind(u.id),
        ]);
        await forgetPrivate(db, u.id); // their private products, quietly
        await forgetPerson(db, u.id); // what Shuki knew about them goes for real (r11 q015)
        await forgetMarks(db, u.id); // and his own marks about them (stage 8, question 21)
        await (await freeName(db, u.id))?.run(); // stage 13, d4: as from "להוציא מהבית"
        out.push({ reply: `${u.name} ${byPerson(u, 'יצא', 'יצאה', 'יצאו')} מהבית.`, face: 'happy' });
      }
    }
    return next(db, s, user, out, now);
  }
  await setState(db, null);
  return null;
}
