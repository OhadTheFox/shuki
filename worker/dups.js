// home18 (6, 7; the owner 17/10): two names for one thing are asked about, never merged alone; places whose regular products were never
// asked about are asked once. Both, and the stores' questions (worker/shops.js), at most one a day on an admin's opening of the chat.
import { norm, definite } from './domain.js';
import { byGender } from '../public/hebrew.js';
import { inPlace } from '../public/hebrew.js';

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const clean = (s) => norm(String(s || '')).replace(/["'׳״]/g, '').replace(/\s+/g, ' ').trim();
/** Two names that may be one thing: one is the other's first words ("עגבניות חתוכות" / "עגבניות חתוכות משומרות", "קוטג'" / "קוטג'
 * סגור"), one is the other with ב before it ("במעל המקרר"), or they differ by a letter or two (a typo). */
export function nearName(a, b) {
  const A = clean(a), B = clean(b);
  if (!A || !B || A === B) return false;
  const [s, l] = A.length <= B.length ? [A, B] : [B, A];
  const sw = s.split(' '), lw = l.split(' ');
  if (sw.length < lw.length && sw.every((w, i) => w === lw[i])) return true;
  if (l === `ב${s}`) return true;
  return Math.min(A.length, B.length) >= 4 && lev(A, B) <= (Math.max(A.length, B.length) >= 8 ? 2 : 1);
}
const pairKey = (kind, a, b) => `${kind}:${Math.min(a, b)}:${Math.max(a, b)}`;
const noPairs = async (db) => { const r = await db.prepare("SELECT value FROM settings WHERE key = 'dup_no'").first(); try { return new Set(JSON.parse(r?.value || '[]')); } catch { return new Set(); } };
/** The first suspected pair the house wasn't asked about: products (shared, the same kind of thing) first, then places. */
export async function nextPair(db) {
  const no = await noPairs(db);
  const ps = (await db.prepare('SELECT id, name FROM products WHERE deleted IS NULL AND private_to IS NULL ORDER BY id').all()).results;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (nearName(ps[i].name, ps[j].name) && !no.has(pairKey('p', ps[i].id, ps[j].id))) return { kind: 'p', a: ps[i], b: ps[j] };
  const ls = (await db.prepare('SELECT id, name FROM locations ORDER BY id').all()).results;
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) if (nearName(ls[i].name, ls[j].name) && !no.has(pairKey('l', ls[i].id, ls[j].id))) return { kind: 'l', a: ls[i], b: ls[j] };
  return null;
}
/** The question (approved 17/10) and its two answers. The shorter name first. */
export function pairAsk(pair) {
  const [x, y] = clean(pair.a.name).length <= clean(pair.b.name).length ? [pair.a, pair.b] : [pair.b, pair.a];
  const dup = { kind: pair.kind, a: pair.a.id, b: pair.b.id };
  if (pair.kind === 'p') return { ask: { actions: [], dup, onlyChoices: true, nope: 'בסדר.', choices: { 'כן, אותו מוצר': { dupYes: true }, 'לא, מוצר אחר': { no: true } } },
    bubble: { reply: `יש ${x.name} וגם ${y.name}. האם ${byGender(x.name, 'זה', 'זו', 'אלה', 'אלה')} אותו מוצר?`, face: 'confused', options: ['כן, אותו מוצר', 'לא, מוצר אחר'] } };
  return { ask: { actions: [], dup, onlyChoices: true, nope: 'בסדר.', choices: { 'כן, אותו מקום': { dupYes: true }, 'לא, מקום אחר': { no: true } } },
    bubble: { reply: `יש ${x.name} וגם ${y.name}. האם זה אותו מקום?`, face: 'confused', options: ['כן, אותו מקום', 'לא, מקום אחר'] } };
}
/** Asked: not again, whatever the answer. */
export async function pairAnswered(db, dup) {
  const no = await noPairs(db); no.add(pairKey(dup.kind, dup.a, dup.b));
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dup_no', ?)").bind(JSON.stringify([...no])).run();
}
/** "כן, אותו מוצר": one product. The longer name stays, the other is an alias (so both work in the chat, the search and recipes);
 * the amounts add up; regular if either was; the lines on the list and in recipes, and what hangs on it, go to it. */
export async function mergeProducts(db, aId, bId, now = Date.now()) {
  const [a, b] = await Promise.all([aId, bId].map((id) => db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first()));
  if (!a || !b) return null;
  const [keep, gone] = clean(a.name).length >= clean(b.name).length ? [a, b] : [b, a];
  let al = []; try { al = JSON.parse(keep.aliases || '[]'); } catch { /* bad row */ }
  let gl = []; try { gl = JSON.parse(gone.aliases || '[]'); } catch { /* bad row */ }
  const aliases = [...new Set([...al, gone.name, ...gl].filter((x) => clean(x) !== clean(keep.name)))].slice(0, 10);
  const same = keep.count_type === gone.count_type;
  const qty = same && keep.count_type !== 'level' ? (Number(keep.qty) || 0) + (Number(gone.qty) || 0) : keep.qty;
  const is_open = keep.count_type === 'inuse' && (keep.is_open || (same && gone.is_open)) ? 1 : keep.is_open;
  const level = keep.count_type === 'level' && keep.level !== 'plenty' && gone.level === 'plenty' ? 'plenty' : keep.level;
  const stmts = [
    db.prepare('UPDATE products SET aliases = ?, qty = ?, is_open = ?, level = ?, is_basic = ?, target = ?, updated = ? WHERE id = ?')
      .bind(JSON.stringify(aliases), qty, is_open, level, keep.is_basic || gone.is_basic ? 1 : 0, keep.target ?? gone.target ?? null, now, keep.id),
    // an open line of each: one stays
    db.prepare("DELETE FROM list_items WHERE product_id = ? AND status = 'open' AND EXISTS (SELECT 1 FROM list_items x WHERE x.product_id = ? AND x.status = 'open')").bind(gone.id, keep.id),
    ...['list_items', 'recipe_ingredients', 'batches', 'product_log', 'receipt_aliases', 'maybe', 'routines', 'noticed'].map((t) => db.prepare(`UPDATE ${t} SET product_id = ? WHERE product_id = ?`).bind(keep.id, gone.id)),
    db.prepare('UPDATE products SET deleted = ?, updated = ? WHERE id = ?').bind(now, now, gone.id),
  ];
  await db.batch(stmts);
  return { keep: keep.name, gone: gone.name };
}
/** "כן, אותו מקום": the products go to one, and the other is deleted. The one that stays: the shorter (not "במעל המקרר"). */
export async function mergePlaces(db, aId, bId) {
  const [a, b] = await Promise.all([aId, bId].map((id) => db.prepare('SELECT * FROM locations WHERE id = ?').bind(id).first()));
  if (!a || !b) return null;
  const [keep, gone] = clean(a.name).length <= clean(b.name).length ? [a, b] : [b, a];
  await db.batch([
    db.prepare('UPDATE products SET location_id = ? WHERE location_id = ?').bind(keep.id, gone.id),
    db.prepare('UPDATE products SET reserve_location_id = ? WHERE reserve_location_id = ?').bind(keep.id, gone.id),
    db.prepare('DELETE FROM locations WHERE id = ?').bind(gone.id),
  ]);
  const asked = await placesAsked(db);
  if (asked.has(gone.id)) { asked.delete(gone.id); asked.add(keep.id); await markAsked(db, [...asked]); }
  return { keep: keep.name, gone: gone.name };
}

/* ---- 7: has the regular products' question been asked about each place ---- */
export const placesAsked = async (db) => { const r = await db.prepare("SELECT value FROM settings WHERE key = 'basics_asked'").first(); try { return new Set(JSON.parse(r?.value || '[]').map(Number)); } catch { return new Set(); } };
async function markAsked(db, ids) { await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('basics_asked', ?)").bind(JSON.stringify([...new Set(ids.map(Number))])).run(); }
/** The question was asked about these places (by name or id): "כלום" or no answer counts too. */
export async function placesWereAsked(db, places) {
  const ls = (await db.prepare('SELECT id, name FROM locations').all()).results;
  const ids = places.map((p) => (typeof p === 'number' ? p : ls.find((l) => l.name === p || clean(l.name) === clean(p))?.id)).filter((x) => x != null);
  if (!ids.length) return;
  const asked = await placesAsked(db); for (const id of ids) asked.add(Number(id));
  await markAsked(db, [...asked]);
}
/** "על המגירה עוד לא שאלתי" / "על מעל המקרר": with the article, and no ב before a preposition */
const theName = (n) => { const w = String(n).trim().split(/\s+/); return inPlace(n) === n || /^ה/.test(n) ? n : w.length > 1 && /^[בל]/.test(w[1]) ? `ה${n}` : definite(n); }; // "ארון המטבח", "המגירה במטבח"
/** A place with products that was never asked about: its question (approved 17/10), the names of its products under it. */
export async function nextPlace(db) {
  const asked = await placesAsked(db);
  const ls = (await db.prepare('SELECT l.id, l.name FROM locations l WHERE EXISTS (SELECT 1 FROM products p WHERE p.location_id = l.id AND p.deleted IS NULL AND p.private_to IS NULL) ORDER BY l.sort, l.id').all()).results;
  return ls.find((l) => !asked.has(Number(l.id))) || null;
}
export async function placeAsk(db, place) {
  const names = (await db.prepare('SELECT name FROM products WHERE location_id = ? AND deleted IS NULL AND private_to IS NULL ORDER BY name').bind(place.id).all()).results.map((p) => p.name);
  const q = `על ${theName(place.name)} עוד לא שאלתי: מה מכל זה תמיד צריך להיות בבית?`;
  return { q, ask: { actions: [], placeBasics: place.id, nope: 'בסדר.', choices: { 'אין שם כאלה': { no: true } } },
    bubble: { reply: `${q}\n${names.join(', ')}`, face: 'happy', options: ['אין שם כאלה'] } };
}
