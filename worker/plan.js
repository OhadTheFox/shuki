// home20 (section 16, docs/home19-proposals.md; the owner 18/10: "אחלה"): the weekly plan. A dish on a day of the house (its local
// date), a saved recipe or a dish without one. The week is worked out here, for the screen, the chat and the server alike:
// the days in order against a virtual inventory, so the eggs Wednesday takes aren't counted again on Friday.
import { local, norm, oneLine, HOUSE, DAY, definite, withHa } from './domain.js';
import { byGender } from '../public/hebrew.js';
import { recipeStatus } from './recipes.js';
import { loadAll, execute } from './store.js';

export const PLAN_DAYS = 7; // seven days from today (the proposal's "שבעה ימים מהיום"; docs/stage0-questions.md)
const KEEP_DAYS = 30; // days that ended more than 30 days ago go; what was made stays in cooked_log
const AHEAD = 13; // the chat may plan up to two weeks ahead
export const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export const addDays = (date, k) => new Date(Date.parse(`${date}T12:00:00Z`) + k * DAY).toISOString().slice(0, 10);
export const todayOf = (now) => local(now, HOUSE.tz).date;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
export const weekdayOf = (date) => new Date(Date.parse(`${date}T12:00:00Z`)).getUTCDay();
/** The plan's days: today and the six after it. */
export const planDays = (now) => Array.from({ length: PLAN_DAYS }, (_, k) => addDays(todayOf(now), k));
export const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(Date.parse(`${d}T12:00:00Z`)).toISOString().slice(0, 10) === d;
/** A day the plan takes: today up to two weeks ahead (yesterday too, for "לא, להעביר להיום" and the screen's own move). */
export const plannable = (d, now, from = 0) => isDate(d) && daysBetween(todayOf(now), d) >= from && daysBetween(todayOf(now), d) <= AHEAD;

/* ---------------- the words (docs/home20-wordings.md) ---------------- */
// "להיום", "למחר", "ליום רביעי"; "של היום", "של מחר", "של יום רביעי"; a day past this week also by its date
function dayWords(date, now) {
  const k = daysBetween(todayOf(now), date);
  if (k === 0) return { to: 'להיום', of: 'של היום' };
  if (k === 1) return { to: 'למחר', of: 'של מחר' };
  const [, m, d] = date.split('-').map(Number);
  const wd = `יום ${WEEKDAYS[weekdayOf(date)]}${k < 0 || k >= PLAN_DAYS ? ` ${d}.${m}` : ''}`;
  return { to: `ל${wd}`, of: `של ${wd}` };
}
/** Row 15–17: "לתכנן דגים להיום", "לתכנן את הקציצות ברוטב ליום שישי" (a recipe with "את", a dish without one without). */
export const planLine = (dish, date, now) => (dish.recipe_id != null ? `לתכנן את ${definite(dish.name)} ${dayWords(date, now).to}` : `לתכנן ${dish.name} ${dayWords(date, now).to}`);
/** Row 18: "להוריד את הדגים מהתכנון של היום". */
export const planOffLine = (dish, date, now) => `להוריד את ${definite(dish.name)} מהתכנון ${dayWords(date, now).of}`;
/** Row 21: "בשביל הפשטידה": the dish's first word, with ה ("פשטידת התרד של דנה" → "הפשטידה"). */
export function forDish(name) {
  let w = String(name || '').trim().split(/\s+/)[0] || '';
  if (/[^יו]ת$/.test(w) && String(name).trim().includes(' ')) w = `${w.slice(0, -1)}ה`; // a construct: "פשטידת" → "פשטידה"
  return `בשביל ${withHa(w)}`;
}
/** Several dishes: "בשביל הפשטידה והעוף". */
export const forDishes = (names) => { const xs = [...new Set(names.filter(Boolean).map((n) => forDish(n).replace(/^בשביל /, '')))]; return xs.length ? `בשביל ${xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ו${xs.at(-1)}` : xs[0]}` : ''; };
export const NO_RECIPE = 'בלי מתכון';
// a dish someone else took off meanwhile (not in docs/home20-wordings.md: one constant, docs/stage0-questions.md)
export const PLAN_GONE = 'המנה הזאת כבר לא בתכנון';
/** Row 24: "האם להוריד מהרשימה את מה שנכנס בשבילה?" by the dish ("בשבילו", "בשבילן", "בשבילם"). */
export const unlistQuestion = (name) => `האם להוריד מהרשימה את מה שנכנס ${byGender(String(name || '').trim().split(/\s+/)[0], 'בשבילו', 'בשבילה', 'בשבילם', 'בשבילן')}?`;
export const UNLIST_YES = 'כן, להוריד', UNLIST_NO = 'לא, להשאיר';
/**
 * Round 2 (the owner 19/10, ג): a dish said with no day: one question for each, with the server's buttons ("היום", "מחר", then the
 * days by name).
 */
// the Hebrew checker's choice (docs/home20-wordings.md, round 2): a recipe with "את" ("באיזה יום נכין את השקשוקה?"), a dish without
// one without ("באיזה יום נכין פסטה?"). The alternative, in the report only: "לאיזה יום לתכנן את השקשוקה?"
export const whichDayQ = (name, recipe = true) => (recipe ? `באיזה יום נכין את ${definite(name)}?` : `באיזה יום נכין ${name}?`);
/** The day buttons: the week from today, "היום" and "מחר" first ({ label, date }). */
export const dayButtons = (now) => planDays(now).map((d, k) => ({ label: k === 0 ? 'היום' : k === 1 ? 'מחר' : WEEKDAYS[weekdayOf(d)], date: d }));
/**
 * The one day a message names: "היום", "מחר", "מחרתיים", "(ב)יום שלישי" / "בשלישי" / "בשבת" (the next one, today when it is
 * today: "ביום שלישי" on a Tuesday is today, round 2, ו). Two different days, or none: null.
 */
export function dayFromText(text, now) {
  const t = ` ${String(text || '').replace(/[.,!?;:"()]/g, ' ')} `, today = todayOf(now), found = new Set();
  if (/\sהיום\s/.test(t)) found.add(today);
  if (/\sמחרתיים\s/.test(t)) found.add(addDays(today, 2));
  if (/\s(ו?מחר)\s/.test(t)) found.add(addDays(today, 1));
  const names = { ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, ששי: 5, שבת: 6 };
  for (const m of t.matchAll(/\s(?:ו?ב?יום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|ששי|שבת)|ו?ב(ראשון|שני|שלישי|רביעי|חמישי|שישי|ששי|שבת))(?=\s)/g)) {
    const wd = names[m[1] || m[2]];
    found.add(addDays(today, (wd - weekdayOf(today) + 7) % 7));
  }
  return found.size === 1 ? [...found][0] : null;
}
/** Row 23: "איזו מנה של דנה?" */
export const whichDish = (who) => `איזו מנה של ${who}?`;
// a child's plan goes to the grown-ups, like a recipe suggestion (the owner 18/10). These two aren't in docs/home20-wordings.md: one
// constant each, until they are (docs/stage0-questions.md)
export const childAskedPlan = (child, lines, byPerson) => `${child.name} ${byPerson(child, 'ביקש', 'ביקשה', 'ביקשו')} ${lines}. האם לאשר?`;
export const childToldPlan = (parents) => `ביקשתי מ${parents} לאשר את התכנון.`;
/** Round 3 (the owner 19/10): whom the child's plan was asked of, by their names: "אבי או מדני" (not "אבא אבי או מאבא דני"); three or more: "ההורים". */
export const askedOf = (adults) => (adults.length === 1 ? adults[0].name : adults.length === 2 ? `${adults[0].name} או מ${adults[1].name}` : 'ההורים');

/* ---------------- the week against the house ---------------- */
const keyOf = (it) => (it.product_id != null ? `p${it.product_id}` : `t${norm(it.listName || it.name)}`);
/**
 * The dishes in the order given (day, then pos), each against what the ones before it left: for each dish its missing
 * (miss), how many of those are on the list or in the cart (listed), and the list lines the week still needs — every product
 * once, the amounts summed (not the larger one), with the dishes it is for: [{ action, for: [[dishId, qty]], key }].
 * `ignoreList`: what the dishes need whatever is on the list (to know whether a line is still needed by another dish).
 * A dish: { id, recipe_id, people? }; `recipes` by id, `products` as the state has them, `list` the list's lines.
 */
export function weekNeeds({ recipes, products, list }, dishes, { ignoreList = false } = {}) {
  const byRecipe = recipes instanceof Map ? recipes : new Map((recipes || []).filter((r) => !r.status).map((r) => [r.id, r]));
  const virt = (products || []).filter((p) => !p.deleted).map((p) => ({ ...p }));
  const byId = new Map(virt.map((p) => [p.id, p]));
  const open = (list || []).filter((i) => i.status !== 'done');
  const onList = (it) => (it.product_id != null ? open.some((i) => i.product_id === it.product_id) : open.some((i) => !i.product_id && norm(i.text || '') === norm(it.listName || it.name)));
  const need = new Map(), per = new Map();
  for (const d of dishes) {
    const r = d.recipe_id != null ? byRecipe.get(d.recipe_id) : null;
    if (!r) { per.set(d.id, { miss: 0, listed: 0, names: [] }); continue; }
    const st = recipeStatus(r, r.ings || [], virt, d.people || r.serves);
    const missing = st.items.filter((i) => !i.ok);
    let listed = 0;
    for (const it of missing) {
      if (!ignoreList && onList(it)) { listed++; continue; }
      const short = it.counted ? Math.ceil(it.short) || 0 : 0;
      const key = keyOf(it);
      let e = need.get(key);
      if (!e) need.set(key, (e = { key, product_id: it.product_id, text: it.listName || it.name, amount: 0, for: [] }));
      e.amount += short; e.for.push([d.id, short || null]);
    }
    // what this dish takes from the house: only what is counted, as "הכנו את זה" takes it off (cookedActions)
    for (const it of st.items) {
      if (!it.counted || it.need == null || it.product_id == null) continue;
      const p = byId.get(it.product_id); if (!p) continue;
      p.qty = Math.max(0, (Number(p.qty) || 0) - it.need);
      if (!(p.qty > 0)) p.out = true;
    }
    per.set(d.id, { miss: missing.length, listed, names: missing.map((i) => i.listName || i.name) });
  }
  // round 2 (the owner 19/10): a recipe counts single eggs, and a product kept as a pack is bought by the pack: the list gets packs
  // (9 eggs, a pack of 12: one pack), and the card says the eggs (`units`: "להוסיף 9 ביצים L לרשימה?"), not "9 אריזות"
  const packOf = (id) => { const p = (products || []).find((x) => x.id === id); return p?.count_type === 'pack' && Number(p.pack_size) > 1 ? Number(p.pack_size) : 0; };
  const actions = [...need.values()].map((e) => {
    const size = e.product_id != null ? packOf(e.product_id) : 0;
    const amount = size && e.amount > 0 ? Math.ceil(e.amount / size) : e.amount;
    return { key: e.key, for: e.for,
      action: e.product_id != null ? { kind: 'list_add', product_id: e.product_id, ...(amount > 1 && { amount }), ...(size && e.amount > 0 && { units: e.amount }) } : { kind: 'list_add', text: e.text, ...(amount > 1 && { amount }) } };
  });
  return { per, actions };
}

/* ---------------- what is kept ---------------- */
/** The plan's rows from yesterday (its question) to the end of the week, in order, with each dish's name. */
export async function planRows(db, now, to = addDays(todayOf(now), PLAN_DAYS - 1)) {
  return (await db.prepare('SELECT m.id, m.day, m.pos, m.recipe_id, m.text, m.status, m.cooked_log_id, m.added_by, r.name AS rname FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id WHERE m.day >= ? AND m.day <= ? ORDER BY m.day, m.pos, m.id')
    .bind(addDays(todayOf(now), -1), to).all()).results
    .filter((m) => m.rname != null || (m.recipe_id == null && m.text)) // a recipe deleted since: its dish goes with it
    .map(({ rname, ...m }) => ({ ...m, name: rname ?? m.text }));
}
/** The week as the screen and the model see it: the days, the dishes with their stamps, yesterday's question, and how many products it misses. */
export function planView(rows, state, now) {
  const today = todayOf(now), days = planDays(now);
  const week = rows.filter((m) => m.day >= today);
  const live = week.filter((m) => m.status === 'planned');
  const { per, actions } = weekNeeds(state, live);
  const y = rows.find((m) => m.day === addDays(today, -1) && m.status === 'planned' && m.recipe_id != null); // only yesterday, only a recipe
  return {
    days,
    dishes: week.map((m) => ({ id: m.id, day: m.day, pos: m.pos, recipe_id: m.recipe_id, text: m.recipe_id != null ? null : m.text, name: m.name, status: m.status, added_by: m.added_by, ...(m.status === 'planned' && m.recipe_id != null && { miss: per.get(m.id)?.miss || 0, listed: per.get(m.id)?.listed || 0 }) })),
    // row 2: in the plural, the owner's decision ("הכנתם", as "הכנתם פעם אחת")
    yesterday: y ? { id: y.id, recipe_id: y.recipe_id, name: y.name, ask: `האם הכנתם אתמול את ${definite(y.name)}?` } : null,
    missing: actions.length,
  };
}
/** The plan's line in the house's part of the instructions: "התכנון לשבוע: 2026-10-18 (ראשון): שקשוקה; …". */
export function planText(plan) {
  const live = (plan?.dishes || []).filter((d) => d.status === 'planned');
  if (!live.length) return 'התכנון לשבוע: (ריק)';
  const days = [...new Set(live.map((d) => d.day))];
  // round 2 (ה): "היום" and "מחר" by the date, so "מה אוכלים מחר?" isn't answered with today's dish
  const when = (day) => (day === plan.days?.[0] ? ', היום' : day === plan.days?.[1] ? ', מחר' : '');
  return `התכנון לשבוע (date: מנות): ${days.map((day) => `${day} (${WEEKDAYS[weekdayOf(day)]}${when(day)}): ${live.filter((d) => d.day === day).map((d) => `${d.name}${d.recipe_id == null ? ' (בלי מתכון)' : ''}`).join(', ')}`).join('; ')}`;
}

/** What weekNeeds needs, read from the database (no relinking: nothing is written here). */
export async function planState(db, user) {
  const S = await loadAll(db, user);
  const [rs, is] = await db.batch([
    db.prepare("SELECT id, name, serves, status FROM recipes WHERE status IS NULL OR status = ''"),
    db.prepare('SELECT id, recipe_id, pos, qty, unit, name, product_id, line FROM recipe_ingredients ORDER BY recipe_id, pos'),
  ]);
  const by = {}; for (const i of is.results) (by[i.recipe_id] ||= []).push(i);
  return { recipes: rs.results.map((r) => ({ ...r, ings: by[r.id] || [] })), products: S.products, list: S.items };
}

/* ---------------- the dish's lines on the list ---------------- */
/**
 * The list lines that went on only for this dish (meal_plan_items) and can come off now that it is cancelled or cooked: still
 * open (not in the cart, not bought, not ordered), and no other dish of the week needs that product. When another one does,
 * a counted line goes down by this dish's amount. Returns the actions (list_remove, or list_add with the smaller amount).
 */
export async function releaseActions(db, user, planId, now) {
  const rows = (await db.prepare('SELECT i.qty AS dish_qty, l.id, l.product_id, l.text, l.status, l.ordered, l.want, p.count_type, p.pack_size FROM meal_plan_items i JOIN list_items l ON l.id = i.list_item_id LEFT JOIN products p ON p.id = l.product_id WHERE i.plan_id = ?').bind(planId).all()).results;
  if (!rows.length) return [];
  const st = await planState(db, user);
  const others = (await planRows(db, now, addDays(todayOf(now), AHEAD))).filter((m) => m.id !== planId && m.status === 'planned' && m.day >= todayOf(now));
  const needed = new Set(weekNeeds(st, others, { ignoreList: true }).actions.map((a) => a.key));
  // another dish's own line on it counts as needed too (two dishes put the same eggs on the list)
  const shared = new Set((await db.prepare("SELECT i.list_item_id FROM meal_plan_items i JOIN meal_plan m ON m.id = i.plan_id WHERE i.plan_id != ? AND m.status = 'planned' AND m.day >= ?").bind(planId, todayOf(now)).all()).results.map((r) => r.list_item_id));
  const acts = [];
  for (const l of rows) {
    if (l.status !== 'open' || l.ordered) continue;
    const key = l.product_id != null ? `p${l.product_id}` : `t${norm(l.text || '')}`;
    if (needed.has(key) || shared.has(l.id)) {
      // a pack: the dish's qty is in single units (weekNeeds' `units`), the line's in packs
      const size = l.count_type === 'pack' && Number(l.pack_size) > 1 ? Number(l.pack_size) : 0;
      const left = l.want != null && l.dish_qty > 0 ? (size ? Math.max(1, Math.ceil((l.want * size - l.dish_qty) / size)) : l.want - l.dish_qty) : null;
      if (left != null && left > 0 && left < l.want) acts.push(l.product_id != null ? { kind: 'list_add', product_id: l.product_id, amount: left } : { kind: 'list_add', text: l.text, amount: left });
      continue;
    }
    acts.push({ kind: 'list_remove', item_id: l.id });
  }
  return acts;
}
/** Takes the dish's lines off (releaseActions), and forgets which lines were the dish's. */
export async function releaseDish(env, user, planId, now = Date.now()) {
  const acts = await releaseActions(env.DB, user, planId, now);
  let r = null;
  if (acts.length) r = await execute(env, user, acts, { now });
  await env.DB.prepare('DELETE FROM meal_plan_items WHERE plan_id = ?').bind(planId).run();
  return { removed: acts.filter((a) => a.kind === 'list_remove').length, changed: acts.length, added: r?.added || [] };
}
/** How many lines would come off: the question is asked only when there is something (the proposal). */
export const releaseCount = async (db, user, planId, now) => (await releaseActions(db, user, planId, now)).length;

/**
 * The lines a card or a button put on the list for dishes: each list_add with `plan_for` ([[dish, qty]]; a dish is its id, or the
 * card's own plan line, "a<k>", by `refs`). Only a line this did make (created): one that was on the list before isn't the dish's.
 */
export async function recordPlanItems(db, acts, createdItems, refs = {}) {
  const made = createdItems?.length ? (await db.prepare('SELECT l.id, l.product_id, l.text, p.name AS pname FROM list_items l LEFT JOIN products p ON p.id = l.product_id WHERE l.id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(createdItems)).all()).results : [];
  const stmts = [];
  for (const a of acts) {
    if (a.kind !== 'list_add' || !Array.isArray(a.plan_for)) continue;
    // a line by name may have become the product of that name (execute's "typed text that is a product we know")
    const line = made.find((l) => (a.product_id != null ? l.product_id === Number(a.product_id) : [l.text, l.pname].some((n) => n && norm(n) === norm(a.text || ''))));
    if (!line) continue;
    for (const [ref, qty] of a.plan_for) {
      const id = typeof ref === 'string' ? refs[ref] : Number(ref);
      if (id) stmts.push(db.prepare('INSERT OR REPLACE INTO meal_plan_items (plan_id, list_item_id, qty) VALUES (?,?,?)').bind(id, line.id, Number(qty) > 0 ? Number(qty) : null));
    }
  }
  if (stmts.length) await db.batch(stmts);
}

/* ---------------- writing the plan ---------------- */
/** A dish onto a day, last in it. The same dish twice on one day is once. Returns its id. */
export async function addDish(db, user, { day, recipe_id = null, text = null, by }, now = Date.now()) {
  const t = recipe_id == null ? oneLine(text, 60) : null;
  if (recipe_id == null && !t) return null;
  const same = await db.prepare("SELECT id FROM meal_plan WHERE day = ? AND status = 'planned' AND (recipe_id = ? OR (recipe_id IS NULL AND ? IS NULL AND text = ?))").bind(day, recipe_id, recipe_id, t).first();
  if (same) return same.id;
  const pos = (await db.prepare('SELECT COALESCE(MAX(pos), -1) + 1 AS n FROM meal_plan WHERE day = ?').bind(day).first()).n;
  const r = await db.prepare('INSERT INTO meal_plan (day, pos, recipe_id, text, status, added_by, created, updated) VALUES (?,?,?,?,?,?,?,?)').bind(day, pos, recipe_id, t, 'planned', by ?? user.id, now, now).run();
  return r.meta?.last_row_id ?? (await db.prepare('SELECT MAX(id) AS id FROM meal_plan').first()).id;
}
/** "להעביר ליום אחר": only the day changes, last in it; the list stays as it is. */
export async function moveDish(db, id, day, now = Date.now()) {
  const pos = (await db.prepare('SELECT COALESCE(MAX(pos), -1) + 1 AS n FROM meal_plan WHERE day = ?').bind(day).first()).n;
  await db.prepare("UPDATE meal_plan SET day = ?, pos = ?, status = 'planned', updated = ? WHERE id = ?").bind(day, pos, now, id).run();
}
/**
 * A recipe was made (countCooked): the dish of the same recipe planned for today (else yesterday) is cooked, with its line in
 * cooked_log; `planId` when it was this dish ("הכנו את זה" on it, "כן, הכנו"). A recipe made with no plan isn't planned. Returns
 * the dish's id, or null.
 */
export async function planCooked(db, recipeId, logId, now = Date.now(), planId = null) {
  const today = todayOf(now);
  const row = planId != null ? await db.prepare("SELECT id FROM meal_plan WHERE id = ? AND status != 'cooked'").bind(Number(planId)).first()
    : await db.prepare("SELECT id FROM meal_plan WHERE recipe_id = ? AND status = 'planned' AND day IN (?, ?) ORDER BY day DESC, pos, id LIMIT 1").bind(recipeId, today, addDays(today, -1)).first();
  if (!row) return null;
  await db.prepare("UPDATE meal_plan SET status = 'cooked', cooked_log_id = ?, updated = ? WHERE id = ?").bind(logId ?? null, now, row.id).run();
  return row.id;
}
/** The hourly run: days that ended more than 30 days ago go, and what was kept of their lines. */
export async function forgetOldPlan(db, now) {
  const before = addDays(todayOf(now), -KEEP_DAYS);
  await db.batch([
    db.prepare('DELETE FROM meal_plan_items WHERE plan_id IN (SELECT id FROM meal_plan WHERE day < ?) OR plan_id NOT IN (SELECT id FROM meal_plan) OR list_item_id NOT IN (SELECT id FROM list_items)').bind(before),
    db.prepare('DELETE FROM meal_plan WHERE day < ?').bind(before),
  ]);
}

/**
 * The dish a message names: a saved recipe by its name; "המנה של דנה": the one recipe Dana added, or whose name has "של דנה"
 * ({ ask } when there are several); anything else is a dish without a recipe, as it was said.
 */
export function findDish(state, a) {
  const saved = (state.recipes || []).filter((r) => !r.status);
  if (a.recipe_id != null) { const r = saved.find((x) => x.id === Number(a.recipe_id)); if (r) return { recipe_id: r.id, name: r.name }; }
  const said = oneLine(a.name || a.text, 60);
  if (!said) return null;
  const exact = saved.find((x) => norm(x.name) === norm(said));
  if (exact) return { recipe_id: exact.id, name: exact.name };
  const who = /^(?:ה)?מנה של (.+)$/.exec(norm(said))?.[1];
  if (who) {
    const u = (state.users || []).find((x) => norm(x.name) === who);
    const xs = saved.filter((x) => (u && x.added_by === u.id) || ` ${norm(x.name)} `.includes(` של ${who} `));
    if (xs.length === 1) return { recipe_id: xs[0].id, name: xs[0].name };
    if (xs.length > 1) return { ask: whichDish(u?.name || said.replace(/^(?:ה)?מנה של /, '')), options: xs.slice(0, 6).map((x) => x.name), picks: xs.slice(0, 6).map((x) => ({ recipe_id: x.id, name: x.name })) };
  }
  return { recipe_id: null, name: said };
}
