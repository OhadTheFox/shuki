// Recipes in the database (round 21). The rules themselves are in public/recipes.js, shared with the app.
import { parseIngredients, linkProduct, basePrep, otherThing, UNIT_SIZE } from '../public/recipes.js';
export * from '../public/recipes.js';
import { lineOf, sameRecipe, categoriesOf, warnNow, MEAT, MILK, PAREVE } from '../public/recipes.js';
import { norm, oneLine } from './domain.js';
import { newId } from './store.js';

/**
 * A recipe was made: counted (decision 137), and a dated line for "what did we make on Friday?" (r0t r9-37). home20: the dish of
 * the same recipe planned for today or yesterday (or `planId`, the one it was made for) is cooked, with that line. Returns the
 * dish's id, or null.
 */
export async function countCooked(db, recipeId, userId, now = Date.now(), planId = null) {
  const res = await db.batch([
    db.prepare('UPDATE recipes SET cooked = cooked + 1, last_cooked = ? WHERE id = ?').bind(now, recipeId),
    db.prepare('INSERT INTO cooked_log (recipe_id, ts, user_id) VALUES (?,?,?)').bind(recipeId, now, userId ?? null),
  ]);
  return planCooked(db, recipeId, res[1]?.meta?.last_row_id ?? null, now, planId);
}
import { relink, linkNew } from './restart.js';
import { planCooked } from './plan.js';

/** The products a recipe's ingredients may link to: the shared ones and the writer's own private ones (stage 13, S13-5). */
const linkable = async (db, user) => (await db.prepare('SELECT id, name, aliases, deleted FROM products WHERE deleted IS NULL AND (private_to IS NULL OR private_to = ?)').bind(user?.id ?? -1).all()).results;
/** Saves the ingredient rows of one recipe (replacing what it had), linked to products. */
export async function saveIngredients(db, recipeId, ings, products) {
  const stmts = [db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').bind(recipeId)];
  ings.slice(0, 60).forEach((i, pos) => {
    const name = oneLine(i.name, 80); if (!name) return; // one line (stage 13, S13-8)
    // only a product the writer may see: shared, or their own (stage 13, S13-5: a link to another's private product by its name
    // told a download that it exists); a product_id from the app is held to the same
    const pid = i.product_id === undefined ? linkProduct(name, products)?.id ?? null : (i.product_id == null || !products.some((p) => p.id === Number(i.product_id)) ? null : Number(i.product_id));
    const qty = Number(i.qty) > 0 && Number(i.qty) < 100000 ? Number(i.qty) : null;
    const unit = i.unit ? oneLine(i.unit, 20) || null : null;
    stmts.push(db.prepare('INSERT INTO recipe_ingredients (recipe_id, pos, qty, unit, name, product_id, line) VALUES (?,?,?,?,?,?,?)').bind(recipeId, pos, qty, unit, name, pid, oneLine(i.line || name, 120)));
  });
  stmts.push(db.prepare('UPDATE recipes SET parsed = 1, ingredients = ? WHERE id = ?').bind(ings.map(lineOf).join('\n').slice(0, 2000), recipeId));
  await db.batch(stmts);
}
/** Every recipe with its ingredients; recipes still in the old free-text form are converted once, here. */
export async function loadRecipes(db, products) {
  await relink(db, products); // after "להתחיל מהתחלה": ingredients find their products again as they come back
  // i1 (stage 11): and an ingredient that never had one finds a product added later; a bad row never stops the state
  try { await linkNew(db, products); } catch (e) { console.log('linkNew', e?.message); }
  const read = async () => (await db.prepare('SELECT id, name, ingredients, text, tags, added, added_by, serves, cooked, last_cooked, url, parsed, photo, status, suggested_by, warn, swap, source, favorite FROM recipes ORDER BY last_cooked DESC, cooked DESC, name').all()).results;
  let recipes = await read();
  const old = recipes.filter((x) => !x.parsed);
  for (const r of old) await saveIngredients(db, r.id, parseIngredients(r.ingredients), products);
  if (old.length) recipes = await read();
  const rows = (await db.prepare('SELECT id, recipe_id, pos, qty, unit, name, product_id, line FROM recipe_ingredients ORDER BY recipe_id, pos').all()).results;
  const by = {};
  for (const i of rows) (by[i.recipe_id] ||= []).push(i);
  return recipes.map((r) => ({ ...r, ings: by[r.id] || [] }));
}

const cleanUrl = (u) => (/^https:\/\/\S+$/.test(u || '') ? String(u).slice(0, 300) : null);
const cleanServes = (n) => (Number(n) > 0 && Number(n) < 100 ? Math.round(Number(n)) : null);
const cleanPhoto = (d) => (typeof d === 'string' && d.length < 400000 && /^[A-Za-z0-9+/=]+$/.test(d) ? d : null);
/**
 * Saves a recipe (from a card, the form, or an idea). The same link or name again is not saved twice: { dup: id }.
 * A child's recipe waits for a grown-up (status 'suggested'). ings: [{ qty, unit, name, product_id? }] or the
 * ingredients as text (a line each, or commas).
 */
export async function saveRecipe(db, user, r, now = Date.now()) {
  const name = oneLine(r.name, 80);
  const url = cleanUrl(r.url);
  const existing = (await db.prepare('SELECT id, name, url FROM recipes').all()).results;
  const dup = sameRecipe(existing, { name, url });
  if (dup) return { dup: dup.id };
  const products = await linkable(db, user);
  const ings = Array.isArray(r.ings) ? r.ings.map((i) => ({ qty: i.qty, unit: i.unit || null, name: String(i.name || '').trim(), ...(i.product_id !== undefined && { product_id: i.product_id }) })).filter((i) => i.name) : parseIngredients(r.ingredients);
  const photo = cleanPhoto(r.photo);
  const warn = warnNow(oneLine(r.warn, 80), ings); // home19 (4): only what is in the ingredients
  const res = await db.prepare('INSERT INTO recipes (id, name, ingredients, text, tags, serves, url, added_by, added, status, suggested_by, warn, swap, photo, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id')
    .bind(newId(), name, ings.map(lineOf).join('\n').slice(0, 2000), String(r.text || '').slice(0, 4000), categoriesOf(r.tags).join(', ') || null, cleanServes(r.serves), url, user.id, now,
      user.role === 'child' ? 'suggested' : null, user.role === 'child' ? user.id : null, warn, warn ? oneLine(r.swap, 120) || null : null, photo ? 1 : null, ['photo', 'shuki'].includes(r.source) ? r.source : null).first();
  await saveIngredients(db, res.id, ings, products);
  if (photo) await db.prepare('INSERT OR REPLACE INTO recipe_photos (recipe_id, data) VALUES (?, ?)').bind(res.id, photo).run();
  return { id: res.id, suggested: user.role === 'child' };
}

/** Edits a saved recipe: name, ingredients (with their links), steps, categories, how many it serves, the photo. */
export async function editRecipe(db, id, r, user) {
  const x = await db.prepare('SELECT id FROM recipes WHERE id = ?').bind(id).first();
  if (!x) return { error: 'המתכון לא נמצא' };
  const sets = []; const vals = [];
  if (r.name != null && oneLine(r.name)) { sets.push('name = ?'); vals.push(oneLine(r.name, 80)); }
  if (r.text != null) { sets.push('text = ?'); vals.push(String(r.text).slice(0, 4000)); }
  if (r.tags != null) { sets.push('tags = ?'); vals.push(categoriesOf(r.tags).join(', ') || null); }
  if (r.serves !== undefined) { sets.push('serves = ?'); vals.push(cleanServes(r.serves)); }
  if (sets.length) await db.prepare(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  if (Array.isArray(r.ings)) {
    const products = await linkable(db, user);
    const ings = r.ings.map((i) => ({ qty: i.qty, unit: i.unit || null, name: String(i.name || '').trim(), ...(i.product_id !== undefined && { product_id: i.product_id }) })).filter((i) => i.name);
    await saveIngredients(db, id, ings, products);
    // home19 (4, the owner 17/10): "שימו לב: יש במתכון כוסברה" goes with the cilantro; the swap goes with the last of it
    const w = await db.prepare('SELECT warn FROM recipes WHERE id = ?').bind(id).first();
    const now = warnNow(w?.warn, ings);
    if ((now || null) !== (w?.warn || null)) await db.prepare(`UPDATE recipes SET warn = ?${now ? '' : ', swap = NULL'} WHERE id = ?`).bind(now, id).run();
  }
  if (r.photo === null) await db.batch([db.prepare('DELETE FROM recipe_photos WHERE recipe_id = ?').bind(id), db.prepare('UPDATE recipes SET photo = NULL WHERE id = ?').bind(id)]);
  else if (cleanPhoto(r.photo)) await db.batch([db.prepare('INSERT OR REPLACE INTO recipe_photos (recipe_id, data) VALUES (?, ?)').bind(id, cleanPhoto(r.photo)), db.prepare('UPDATE recipes SET photo = 1 WHERE id = ?').bind(id)]);
  return { ok: true };
}

export async function deleteRecipe(db, id) {
  await db.batch(['recipe_ingredients', 'recipe_photos'].map((t) => db.prepare(`DELETE FROM ${t} WHERE recipe_id = ?`).bind(id)).concat([db.prepare('DELETE FROM recipes WHERE id = ?').bind(id)]));
}

/**
 * מ17 (q029): meat, dairy or parve by the name (and the category), or null when it isn't clear. MEAT = meat, unless it's a
 * meat substitute or says it's made of plants (the word after the first, or "צמחוני" / "טבעוני" as a word; not "רוטב סויה"
 * in a chicken's name); a plant milk = parve; MILK = dairy (also not a plant one); vegetables and fruit, and spices and oils,
 * with none of them = parve (44ב, 12/10: not dry goods nor cans: "נוטלה", "רוטב בולונז" aren't clear; but the basic
 * dry goods of BASIC_PARVE, 46); eggs = parve. Not clear: a flavour ("בטעם עוף"), pesto, alfredo.
 */
const KOSHER_PARVE = ['ירקות ופירות', 'תבלינים ושמנים']; // 44ב (the owner 12/10)
const PLANT_WORD = /(^|\s)(צמחוני|צמחונית|צמחוניים|צמחוניות|צמחי|צמחית|צמחיים|צמחיות|טבעוני|טבעונית|טבעוניים|טבעוניות|טופו|סייטן)(\s|$)|^תחליף|מן הצומח/;
const PLANT_NOUN = /^\S+ (סויה|קוקוס|שקדים|שיבולת|אורז|תירס)(\s|$)/; // "שניצל תירס", but "עוף קוקוס"
// r9z (2), after two reviews: one plain rule. A meat word anywhere (also "ועוף", "בבשר") is meat, but for what is surely plant:
// a meat substitute's category, a name that starts with "תחליף", or a plant adjective right after the meat word ("עוף צמחי",
// "חזה עוף צמחי", "כבד קצוץ צמחי") with no meat word after it; a plant noun right after a dish with no animal ("שניצל תירס").
// A dairy word is dairy but for a plant milk (PAREVE) or a plant adjective or noun right after it ("גבינה טבעונית", "יוגורט
// סויה"); "צמחוני" means no meat, not no dairy. With neither, parve only when it says it's plant-made ("צמחי", "טבעוני")
const ANIMAL_W = /^(עוף|הודו|בקר|בשר|כבש|טלה|עגל|פרגית|פרגיות|חזה|כנפיים|שוקיים|כבד)$/; // not fish: fish isn't meat (the review of f15b26a)
const ADJ_W = /^(צמחוני|צמחונית|צמחוניים|צמחוניות|צמחי|צמחית|צמחיים|צמחיות|טבעוני|טבעונית|טבעוניים|טבעוניות)$/;
const PLANT_ADJ = /^(צמחי|צמחית|צמחיים|צמחיות|טבעוני|טבעונית|טבעוניים|טבעוניות)$/; // plant-made (not "צמחוני")
const PLANT_N = /^(סויה|קוקוס|שקדים|שיבולת|אורז|תירס|טופו|סייטן)$/;
const DESC = /^(קצוץ|קצוצה|טחון|טחונה|מעושן|מעושנת|פרוס|פרוסה|פרוסות|מבושל|מבושלת|קפוא|קפואה|קפואים|טרי|טרייה|לבישול|להקצפה|מתוקה|חמוצה|מותך|מגורד|מגורדת)$/;
const prefixed = (x, t) => t(x) || (/^[וב]/.test(x) && t(x.slice(1))) || (/^וב/.test(x) && t(x.slice(2)));
const meatWord = (x, before = '') => !(/^הודו$/.test(x.replace(/^[וב]+/, '')) && /^(אגוז|אגוזי|תה|אורז)$/.test(before)) && prefixed(x, (y) => y.length > 1 && (ANIMAL_W.test(y) || MEAT.test(y))); // not "אגוזי הודו"
const PAREVE_G = new RegExp(PAREVE.source, 'g');
// 46 (the owner 12/10): basic dry goods that are parve, only as the name itself or with an adjective that changes nothing ("קמח מלא",
// "אורז בסמטי", "סוכר חום"); anything else in dry goods has no mark ("עוגיות חמאה", "קרקר גבינה", "נוטלה")
const BASIC_PARVE = /^(קמח|אורז|סוכר|מלח|פסטה|ספגטי|אטריות|פתיתים|קוסקוס|בורגול|קינואה|כוסמת|גריסים|סולת|שיבולת שועל|קוואקר|עדשים|גרגרי חומוס|חומוס יבש|שעועית|אפונה יבשה|פול|מש|קטניות)( (מלא|מלאה|מלאים|לבן|לבנה|לבנים|חום|חומה|חומים|בסמטי|יסמין|פרסי|עגול|ארוך|דק|דקה|גס|גסה|אדום|אדומה|אדומים|כתום|כתומים|כתומות|ירוק|ירוקה|ירוקים|ירוקות|שחור|שחורה|שחורים|שחורות|אדומות|לבנות|חומות|מלאות|יבש|יבשה|יבשים|יבשות|לבישול|תופח|כוסמין|אורגני|אורגנית|דגנים מלאים|ים|שולחן|מעודן|קנים|דמררה))*$/;
export function kosherKindOf(name, category = null) {
  // punctuation out and the Hebrew geresh as the ASCII one ("גבינה.", "קוטג׳"): the words as words (the review of c2f14cb)
  const n = String(name || '').trim().replace(/\s*\(לא חובה\)\s*/g, ' ').replace(/׳/g, "'").replace(/[.,!?;:()"״…]/g, ' ').replace(/\s+/g, ' ').trim().replace(/(^| )קרם פרש(?= |$)/g, '$1שמנת'); // two words, one dairy word
  if (/(בטעם|בסגנון|פסטו|אלפרדו)/.test(n) || /^תחליף חלב (אם|לתינוק)/.test(n)) return null; // infant formula: mostly dairy, not clear
  const w = n.split(/\s+/), sub = category === 'תחליפי בשר' || /^תחליף(\s|$)/.test(n);
  // the first word of a kind and its own words after it (the next animal for "חזה עוף", a descriptor for "כבד קצוץ"), then the next
  const next = (i, more) => { let j = i; while (j + 1 < w.length && more(w[j + 1])) j++; return j + 1; };
  const meatAt = w.map((x, i) => (meatWord(x, w[i - 1]) ? i : -1)).filter((i) => i >= 0);
  // a dairy word anywhere ("ופטה", "בגבינה" too), not inside a plant milk ("שמנת צמחית") nor with a plant word right after it
  // ("גבינה טבעונית", "יוגורט סויה"): any parve below gives way to it (the review of f15b26a). "לבנה", "צהובה" after another
  // word are a cheese only after "גבינה" ("שעועית לבנה", "עגבנייה צהובה"); alone, the cheese
  const v = n.replace(PAREVE_G, (m) => m.replace(/\S/g, '_')).split(/\s+/).map((x, i, a) => (i > 0 && a[i - 1] === 'תחליף' ? '_' : x)); // "תחליף חלב" isn't milk
  const milkW = (x, i) => prefixed(x, (y) => MILK.test(y)) && (!/^(לבנה|צהובה)$/.test(x.replace(/^[וב]/, '')) || i === 0 || /^גבינ/.test(v[i - 1])); // "ולבנה" too
  const dairy = v.some((x, i) => { if (!milkW(x, i)) return false; let k = i; while (k + 1 < v.length && (MILK.test(v[k + 1]) || DESC.test(v[k + 1]))) k++; return !(PLANT_ADJ.test(v[k + 1] || '') || PLANT_N.test(v[k + 1] || '')); });
  if (meatAt.length) {
    const i = meatAt[0], k = next(i, (x) => (ANIMAL_W.test(x) && !/^ב/.test(x)) || DESC.test(x)), nx = w[k] || '';
    const plantNext = ADJ_W.test(nx) || (nx === 'מן' && w[k + 1] === 'הצומח') || (!ANIMAL_W.test(w[i]) && k === i + 1 && PLANT_N.test(nx));
    if (category === 'בשר, עוף ודגים' || !(sub || (plantNext && !meatAt.some((m) => m > k)))) return 'meat';
    return dairy ? 'dairy' : 'parve'; // a plant "meat" with cheese is dairy
  }
  if (dairy) return 'dairy';
  if (sub || PAREVE.test(n)) return 'parve';
  if (w.some((x) => PLANT_ADJ.test(x)) || /מן הצומח/.test(n) || PLANT_NOUN.test(n) || /(^| )(ביצים|ביצה)( |$)/.test(n)) return 'parve';
  if (BASIC_PARVE.test(n)) return 'parve';
  return KOSHER_PARVE.includes(category) ? 'parve' : null;
}

/**
 * מ18 (q035): a leftover of a recipe cooked in the two days before it was made: meat when an ingredient is meat, dairy when
 * one is dairy (kosherKindOf). The recipe: by its name, or one cooked that day that shares a word with the leftover.
 */
export async function leftoverKind(db, text, made) {
  const cooked = (await db.prepare('SELECT r.id, r.name, MAX(c.ts) AS ts FROM cooked_log c JOIN recipes r ON r.id = c.recipe_id WHERE c.ts >= ? AND c.ts <= ? GROUP BY r.id ORDER BY ts DESC').bind(made - 2 * 86400e3, made + 3600e3).all()).results;
  const t = norm(String(text || ''));
  if (!t || !cooked.length) return null;
  const ings = async (r) => (await db.prepare('SELECT name FROM recipe_ingredients WHERE recipe_id = ?').bind(r.id).all()).results.map((x) => String(x.name || ''));
  const words = t.split(' ').filter((w) => w.length >= 3);
  let r = cooked.find((x) => norm(x.name) && (t.includes(norm(x.name)) || norm(x.name).includes(t)));
  if (!r) for (const x of cooked.filter((y) => y.ts >= made - 18 * 3600e3)) if (words.some((w) => norm(x.name).includes(w)) || (await ings(x)).some((n) => words.some((w) => norm(n).includes(w)))) { r = x; break; }
  if (!r) return null;
  const kinds = (await ings(r)).map((n) => kosherKindOf(n));
  return kinds.includes('meat') ? 'meat' : kinds.includes('dairy') ? 'dairy' : null;
}

/**
 * home19 (3, once): the ingredients with no product find one by today's rules ("שום פרוסות" from before 16/10 is garlic,
 * "פילה אנשובי", "שמן חמניות או קנולה", "עגבנייה סחוטה"). The link is kept in recipe_ingredients at saving, and linkNew tries
 * only products new since, so a better rule never reached a saved recipe. Shared products only, like linkNew. A link stays,
 * but for one the old rules made to another thing ("לימון" to "לימון פרסי שחור", "ג'ינג'ר" to "ג'ינג'ר כבוש", otherThing): it
 * goes to what today's rules find, or to none. Returns how many were linked and unlinked, or null once done.
 */
export async function relinkRecipes(db) {
  if (await db.prepare("SELECT 1 AS x FROM settings WHERE key = 'fix:recipe_links_h19'").first()) return null;
  const products = (await db.prepare('SELECT id, name, aliases, deleted, count_type, qty, level, is_open FROM products WHERE deleted IS NULL AND private_to IS NULL').all()).results;
  const rows = (await db.prepare('SELECT i.id, i.name, p.name AS pname FROM recipe_ingredients i LEFT JOIN products p ON p.id = i.product_id AND p.deleted IS NULL').all()).results;
  const byName = new Map(), to = new Map(), off = [];
  for (const i of rows) {
    const wrong = i.pname != null && otherThing(i.name, i.pname);
    if (i.pname != null && !wrong) continue;
    if (!byName.has(i.name)) byName.set(i.name, linkProduct(i.name, products)?.id ?? null);
    const pid = byName.get(i.name);
    if (pid != null) (to.get(pid) || to.set(pid, []).get(pid)).push(i.id);
    else if (wrong) off.push(i.id);
  }
  const stmts = [...to].map(([pid, ids]) => db.prepare('UPDATE recipe_ingredients SET product_id = ? WHERE id IN (SELECT value FROM json_each(?))').bind(pid, JSON.stringify(ids)));
  if (off.length) stmts.push(db.prepare('UPDATE recipe_ingredients SET product_id = NULL WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(off)));
  const linked = [...to.values()].reduce((n, x) => n + x.length, 0), unlinked = off.length;
  stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('fix:recipe_links_h19', ?)").bind(JSON.stringify({ linked, unlinked })));
  await db.batch(stmts);
  return { linked, unlinked };
}

/**
 * 17/10, ש14 (once): the list's lines that came from a recipe as it was written ("גמבות ברצועות", "שום פרוסות", "גדושה פפריקה
 * מתוקה") become what the list gets today (listName): the product at home ("גמבה"), or the name without how it's cut or the
 * spoon's size. Only a line whose words change, not bought yet (open), and not private; two that become the same: one stays.
 * Returns how many lines changed and how many went, or null once done.
 */
export async function fixRecipeRows(db) {
  if (await db.prepare("SELECT 1 AS x FROM settings WHERE key = 'fix:recipe_rows'").first()) return null;
  const products = (await db.prepare('SELECT id, name, aliases, deleted FROM products WHERE deleted IS NULL AND private_to IS NULL').all()).results;
  const rows = (await db.prepare("SELECT id, product_id, text, store FROM list_items WHERE status = 'open' AND private_to IS NULL ORDER BY added, id").all()).results;
  const taken = new Set(rows.filter((r) => r.product_id != null).map((r) => `p${r.product_id}:${r.store}`));
  for (const r of rows) if (r.product_id == null && r.text) taken.add(`t${norm(r.text)}:${r.store}`);
  const stmts = []; let changed = 0, gone = 0;
  for (const r of rows) {
    if (r.product_id != null || !r.text) continue;
    const was = String(r.text).trim(), w = was.split(/\s+/);
    const sized = w.length > 1 && UNIT_SIZE.has(w[0]) ? w.slice(1).join(' ') : was; // "גדושה פפריקה מתוקה" (0036's words)
    const nm = parseIngredients(sized)[0]?.name || sized, base = basePrep(nm);
    if (base === was) continue; // nothing of a recipe's way of writing in it
    const live = linkProduct(nm, products), key = live ? `p${live.id}:${r.store}` : `t${norm(base)}:${r.store}`;
    if (taken.has(key)) { stmts.push(db.prepare('DELETE FROM list_items WHERE id = ?').bind(r.id)); gone++; continue; }
    taken.delete(`t${norm(was)}:${r.store}`); taken.add(key);
    stmts.push(live ? db.prepare('UPDATE list_items SET product_id = ?, text = NULL WHERE id = ?').bind(live.id, r.id) : db.prepare('UPDATE list_items SET text = ? WHERE id = ?').bind(base, r.id));
    changed++;
  }
  stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('fix:recipe_rows', ?)").bind(JSON.stringify({ changed, gone })));
  await db.batch(stmts);
  return { changed, gone };
}
