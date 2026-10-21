// A private product (stage 0b, docs/stage0-0b-proposal.md §3; the owner 01/10): only who added it sees it, everywhere.
// Private = (a) a name from the fixed list (r11 q050, q051, q055, q056), failing closed even when the model didn't say,
// or (b) the writer asked for it in so many words (the model's `private`). Period products are ordinary (q052).
// A child's addition is never private: it waits for a parent, who sees it (the owner 02/10, 4).
import { norm } from './domain.js';

const LIST = /(קונדומ|קונדום|כונדומ|אמצעי ?מניעה|גלולו?ת ?(?:למניעת|נגד) ?הי?ריונ|גלולה ?(?:למחרת|של ?היום ?שאחרי)|חומרי? ?סיכה|ג ?ל ?סיכה|צעצועי? ?מינ|ויברטור|ויאגרה|ויאגרא|בדיקו?ת ?הי?ריונ|טסט ?הי?ריונ|בדיקו?ת ?ביוצ)/;
export const isPrivateName = (name) => LIST.test(norm(String(name || '')).replace(/[ךםןףץ]/g, (c) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[c]));

/** Who a new product or line is private to: the writer, or nobody. */
// a child's create the grown-ups approve (מ3, forChild) is never the approving grown-up's private product
export const privateFor = (user, a, name) => (user?.role !== 'child' && !a?.forChild && (a?.private === true || isPrivateName(name)) ? user.id : null);

/** Can this reader see a row that carries private_to? A server job sees all ({ all: true }). */
export const sees = (reader, privateTo) => privateTo == null || !!reader?.all || privateTo === reader?.id;
/** A reader who sees only what isn't private to anyone: for what goes to the whole house (the weekly check, "missed you"). */
export const SHARED = Object.freeze({ id: -1 });

/**
 * Someone left the house: what only they saw goes quietly, and isn't part of the card about their things (0b part 3).
 * Their private products go for real, with their private journal lines; a shared line ("סיימתי קניות") keeps no row of
 * theirs for undo, as a download leaves them out (exportHouse). Who comes back gets none of it (the owner 07/10, question 105 (א))
 */
export async function forgetPrivate(db, userId) {
  const mineP = (await db.prepare('SELECT id, name FROM products WHERE private_to = ?').bind(userId).all()).results;
  const ids = mineP.map((r) => r.id);
  const items = (await db.prepare('SELECT id FROM list_items WHERE private_to = ? OR product_id IN (SELECT value FROM json_each(?))').bind(userId, JSON.stringify(ids)).all()).results.map((r) => r.id);
  const P = JSON.stringify(ids), I = JSON.stringify(items);
  const gone = new Set(ids), goneI = new Set(items);
  // the shared lines that hold, for undo, a row of theirs (one JSON value, not a ? per id: D1 takes at most 100)
  const shared = (await db.prepare(`SELECT id, before FROM events WHERE private_to IS NULL AND before IS NOT NULL AND json_valid(before) AND (
    EXISTS (SELECT 1 FROM json_each(before, '$.products') j WHERE CAST(j.key AS INTEGER) IN (SELECT value FROM json_each(?1)))
    OR EXISTS (SELECT 1 FROM json_each(before, '$.batches') j WHERE CAST(j.key AS INTEGER) IN (SELECT value FROM json_each(?1)))
    OR EXISTS (SELECT 1 FROM json_each(before, '$.created.products') j WHERE j.value IN (SELECT value FROM json_each(?1)))
    OR EXISTS (SELECT 1 FROM json_each(before, '$.list_items') j WHERE CAST(j.key AS INTEGER) IN (SELECT value FROM json_each(?2))
      OR json_extract(j.value, '$.private_to') = ?3 OR json_extract(j.value, '$.product_id') IN (SELECT value FROM json_each(?1))))`).bind(P, I, userId).all()).results;
  const theirs = (row) => row && (row.private_to === userId || gone.has(Number(row.product_id)));
  const cleaned = shared.map((e) => {
    const b = JSON.parse(e.before);
    for (const id of Object.keys(b.products || {})) if (gone.has(Number(id))) delete b.products[id];
    for (const id of Object.keys(b.batches || {})) if (gone.has(Number(id))) delete b.batches[id];
    for (const [id, row] of Object.entries(b.list_items || {})) if (goneI.has(Number(id)) || theirs(row)) delete b.list_items[id];
    if (b.created) { b.created.products = (b.created.products || []).filter((id) => !gone.has(Number(id))); b.created.list_items = (b.created.list_items || []).filter((id) => !goneI.has(Number(id))); }
    return db.prepare('UPDATE events SET before = ? WHERE id = ?').bind(JSON.stringify(b), e.id);
  });
  // their own cards that name one (their chat is gone with them, question 106)
  const named = (x) => mineP.some((p) => new RegExp(`"product_id":${p.id}(?!\\d)`).test(x) || x.includes(JSON.stringify(p.name)));
  const cards = ids.length ? (await db.prepare('SELECT id, actions FROM proposals WHERE user_id = ?').bind(userId).all()).results.filter((c) => named(c.actions)) : [];
  const ofTheirs = 'product_id IN (SELECT value FROM json_each(?))';
  await db.batch([
    ...cleaned,
    ...cards.map((c) => db.prepare('DELETE FROM proposals WHERE id = ?').bind(c.id)),
    // a reminder or weekly buy only they could see: private to them (migration 0024), or of a private product of theirs
    ...['maybe', 'routines'].map((t) => db.prepare(`DELETE FROM ${t} WHERE private_to = ? OR ${ofTheirs}`).bind(userId, P)),
    ...['batches', 'list_items', 'receipt_aliases', 'product_photos', 'product_log', 'noticed'].map((t) => db.prepare(`DELETE FROM ${t} WHERE ${ofTheirs}`).bind(P)),
    db.prepare('DELETE FROM list_items WHERE private_to = ?').bind(userId),
    db.prepare(`UPDATE recipe_ingredients SET product_id = NULL WHERE ${ofTheirs}`).bind(P), // the recipe keeps the line, unlinked
    db.prepare(`UPDATE events SET product_id = NULL WHERE ${ofTheirs}`).bind(P),
    db.prepare('DELETE FROM product_log WHERE event_id IN (SELECT id FROM events WHERE private_to = ?)').bind(userId),
    db.prepare('DELETE FROM events WHERE private_to = ?').bind(userId), // their private journal lines, with the names
    db.prepare(`DELETE FROM products WHERE id IN (SELECT value FROM json_each(?))`).bind(P),
  ]);
}
