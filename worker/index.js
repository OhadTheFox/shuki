// Shuki server: serves the app (Workers Static Assets), the household API over D1,
// Shuki's chat (Claude), and the scheduled push reminders.

import { loadAll, execute, undoLast, newId, deleteBlocked } from './store.js';
import { buyDefaults, noticedList, noticedText, scanPatterns, answer as answerNoticed, yesActions } from './instincts.js';
import { hasSpare, pesachSeason, oneLine, legacyGrowth, withHa, definite, PESACH_OK, hebrewDate, islamicDate, religionOf, extraStores, isFreezer, listNeed, passoverOut, notBuying, sameTimeNextDay, isMissing, isOut, suggestedBuy, describe, nextExpiry, expiring, mood, local, digestMessages, monthStart as monthStartTz, DAY, learn, runningOutSoon, growth, STORE_NAMES, STORES, BASE_STORES, HOUSE, EVENT_STORES, setHouse, localToTs, validTz, recountPick, awayNow, tripSummaryLines, catchUp, cleanOutfit, WEEKDAYS, routinesDue, weeklyPatterns, offSeason, MONTHS } from './domain.js';
const monthStart = (ts) => monthStartTz(ts, HOUSE.tz);
import { testKey, llmKey, providerOf, PROVIDERS } from './llm.js';
import { handleRpc } from './mcp.js';
import { onboardStep, inOnboarding, introBubbles, helloBubbles, joinedBubble, aboutHouse, startState, RESUME_YES, LATER } from './onboarding.js';
import { think, record, saveChat, setAsk, openAsk, queueAsk, againQuestion, theDish, describeActions, askOnOpen } from './shuki.js';
import { SHOP_Q, applyShop } from './shops.js';
import { restartStep, relinkOwners } from './restart.js';
import { factsFor, shabbatKeepers, forgetPerson, forgetMarks, unlinkGoneChats, shabbatFromSettings, forget, mineWins } from './facts.js';
import { distressOf, forgetSensitive, isDistressKey, stillSensitive } from './distress.js';
import { SHARED, sees, forgetPrivate, isPrivateName, privateFor } from './private.js';
import { factWarnHits, guestHash, chat, applyProposal, approveMappingCard, savePhoto, classifyChametz, catalogFor, LESSON_LEN, ensureHosting, cleanStoreName, recipeFromInput, recipeIdeas, cookedCard, planCard, missingActions, cardFor } from './shuki.js';
import { planRows, planView, plannable, addDish, moveDish, releaseDish, releaseCount, recordPlanItems, forgetOldPlan, unlistQuestion, forDishes, todayOf, weekNeeds, UNLIST_YES, UNLIST_NO, PLAN_GONE } from './plan.js';
import { fixRecipeRows, relinkRecipes, countCooked, loadRecipes, saveRecipe, editRecipe, deleteRecipe, kosherHouse, kosherProblem, CATEGORIES, kosherKindOf, leftoverKind } from './recipes.js';
import { sendPush, pushAllowed } from './webpush.js';
import { addMember, freeName, VERSION, SECRET_SETTINGS, stateSettings, exportCsv, deleteHouse, exportHouse, dailyBackup, listBackups, restoreDay, monthCost, costWarning, saveFeedback, idleOffer, idleRecount, IDLE_YES, IDLE_NO, checkUpdate } from './house.js';
import { chatRows, serverCardUp, answerServerCard, CARD_DAY, dayOver } from './thread.js';
import { byPerson, byGender, isWoman, isPlural, parentKind } from '../public/hebrew.js';
import { isNight } from '../public/night.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const SHOP_TTL = 6 * 60 * 60e3; // decision 29: a shopping trip that nobody closed ends by itself after 6 hours
const ROUTINE_HOUR = 7; // the morning run: weekly buys, the day after moving
const MAYBE_WAIT = 48 * 3600e3;  // "let's think about it": Shuki asks again after 48 hours
const maybeDue = (m) => m.due_at ?? m.added + MAYBE_WAIT; // a reminder has its own time
const SHORTCUT_PATHS = new Set(['/api/say', '/api/shortcut/shop']); // all a Siri key may do

async function sha256(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function auth(req, env) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('authorization') || '');
  if (!m) return null;
  const row = await env.DB.prepare('SELECT d.id AS device_id, d.kind, u.id, u.name, u.gender, u.role FROM devices d JOIN users u ON u.id = d.user_id WHERE d.token_hash = ? AND u.active = 1').bind(await sha256(m[1])).first();
  if (row) await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(Date.now(), row.device_id).run();
  return row;
}

/**
 * p7 (approved 02/10, 05/10): taken out by someone else, their phones hear it first, right away and outside the 2 a day
 * (c05), and each remembers who did it, for the screen after the 401 (c06); not on "לצאת מהבית", nor when the one who
 * takes them out has no name yet. The same from "להתחיל מהתחלה" (worker/restart.js, 56). Returns the rows to write with
 * the removal, in its batch.
 */
export async function outOfHouse(env, target, by, now) {
  const db = env.DB;
  if (target.id === by.id || !String(by.name || '').trim()) return [];
  const phones = (await db.prepare('SELECT token_hash, push_sub FROM devices WHERE user_id = ?').bind(target.id).all()).results;
  const msg = { title: 'שוקי', body: `${by.name} ${byPerson(by, 'הוציא', 'הוציאה', 'הוציאו')} ${byPerson(target, 'אותך', 'אותך', 'אתכם')} מהבית. הטלפון הזה כבר לא מחובר אליי.`, url: './' };
  for (const d of phones) if (d.push_sub && env.VAPID_PRIVATE_JWK) await Promise.resolve().then(() => push(env, JSON.parse(d.push_sub), msg)).catch(() => 0); // a push that fails doesn't stop the removal
  return phones.map((d) => db.prepare('INSERT OR REPLACE INTO removed (token_hash, by_name, by_gender, ts) VALUES (?, ?, ?, ?)').bind(d.token_hash, by.name, byPerson(by, 'm', 'f', 'p'), now));
}
/** p7: a phone whose person someone else took out of the house: { removed: { name, gender } } (migration 0026), else {}. */
async function removedBy(req, env) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('authorization') || '');
  const r = m && await env.DB.prepare('SELECT by_name, by_gender FROM removed WHERE token_hash = ?').bind(await sha256(m[1])).first();
  return r ? { removed: { name: r.by_name, gender: r.by_gender } } : {};
}

/** A reminder or a weekly buy this person may see (0b): not of another's private product, nor by text from the private list added by another grown-up. */
async function maybeSeen(db, user, x) {
  if (x.private_to != null) return x.private_to === user.id; // a private reminder or weekly buy (migration 0024): the column, not the text
  if (x.product_id != null) return !!(await db.prepare('SELECT 1 AS y FROM products WHERE id = ? AND (private_to IS NULL OR private_to = ?)').bind(x.product_id, user.id).first());
  return true;
}

/** Everything the app needs, in one response. */
/**
 * What a person sees in the chat (0b): their own thread and the house's messages; a grown-up also sees each child's
 * chat unless they turned it off for that child (child_chat:<grown-up>:<child> = '0', r11 q039, r12 q016; each grown-up's own,
 * stage 5 b01), never what's sensitive.
 * A child is told, in the approved words (D9), who can see. Others' actions come as gray lines, in the journal's own
 * words (D7ב, approved 02/10).
 */
export async function chatFor(db, user, limit = 60) {
  const users = (await db.prepare('SELECT id, name, gender, role, active FROM users').all()).results;
  // b01 (02/10, 05/10): each grown-up's own, child_chat:<grown-up>:<child> = '0' (migration 0025); no row: they see
  const off = (await db.prepare("SELECT key FROM settings WHERE key LIKE 'child_chat:%:%' AND value = '0'").all()).results.map((r) => r.key.split(':').map(Number));
  const watches = (adult, kid) => !off.some(([, a, k]) => a === adult && k === kid);
  const kids = user.role === 'child' ? [] : users.filter((u) => u.role === 'child' && u.active === 1 && watches(user.id, u.id)).map((u) => u.id);
  const rows = (await db.prepare('SELECT c.*, u.name FROM chat c LEFT JOIN users u ON u.id = c.user_id WHERE c.thread = ? OR c.thread IS NULL OR c.thread IN (SELECT value FROM json_each(?)) ORDER BY c.ts DESC, c.id DESC LIMIT ?').bind(user.id, JSON.stringify(kids), limit).all()).results.reverse();
  const now = Date.now();
  const msgs = rows.map((r) => ({ ...r, content: JSON.parse(r.content) })).filter((m) => !(m.role === 'shuki' && m.content.card && !m.content.answered && (m.ts < now - CARD_DAY || dayOver(m.content, now)))) // the house's, or one person's (א4) // a server card nobody answered: gone after a day (r12 q032)
    .filter((m) => (m.thread === user.id || m.thread == null
    ? (!m.content.only || m.content.only === user.id) && m.content.notFor !== user.id
    : !m.content.sensitive && !m.content.only));
  // the same message in two threads I see (to me and to my child): once
  // (the one in my own thread stays: in stage 5 a child's thread is a tab of its own, and a tell to me is in mine)
  const key = (m) => `${m.ts}|${m.role}|${JSON.stringify(m.content)}`, own = new Set(msgs.filter((m) => m.thread === user.id).map(key));
  const seenRows = new Set();
  for (let i = msgs.length - 1; i >= 0; i--) { const k = key(msgs[i]); if (seenRows.has(k) || (own.has(k) && msgs[i].thread !== user.id)) msgs.splice(i, 1); else seenRows.add(k); }
  const from = msgs[0]?.ts ?? Date.now() - 86400e3; // with no messages: the last day's actions, not the whole journal
  // others' actions since the oldest message shown, in the journal's words (D7ב); what's private is filtered with the journal (0b part 3)
  // q08 (approved 02/10, 05/10): in a child's chat a grown-up is "אמא" / "אבא" (every grown-up a parent, as in D9), and
  // "אמא מיכל" when two grown-ups are of the same gender; a brother or sister keeps the name. Only when the line starts
  // with the doer's own name (a rule taught by a child and approved by a parent starts with the child's)
  const asChild = (e) => {
    const by = user.role === 'child' && users.find((u) => u.id === e.user_id && u.active === 1 && u.role !== 'child'); // one who left is "מי שגר כאן" (forgetPerson)
    if (!by || !e.summary.startsWith(`${by.name} `) || isPlural(by)) return e.summary; // who chose the plural: by name (7ב, question 8)
    const parent = byPerson(by, 'אבא', 'אמא', 'אבא');
    const twin = users.some((u) => u.id !== by.id && u.active === 1 && u.role !== 'child' && parentKind(u) === parentKind(by));
    return `${twin ? `${parent} ${by.name}` : parent}${e.summary.slice(by.name.length)}`;
  };
  const gray = (await db.prepare("SELECT id, ts, user_id, summary FROM events WHERE (user_id IS NULL OR user_id != ?) AND type != 'undo' AND undone IS NULL AND summary IS NOT NULL AND summary != '' AND private_to IS NULL AND ts >= ? ORDER BY ts DESC LIMIT 30").bind(user.id, from).all()).results.reverse()
    .map((e) => ({ id: `e${e.id}`, ts: e.ts, role: 'event', thread: user.id, content: { gray: asChild(e) } }));
  const out = [...msgs, ...gray].sort((a, b) => a.ts - b.ts);
  const adults = users.filter((u) => u.role !== 'child' && u.active === 1 && watches(u.id, user.id)); // D9: only who really sees
  if (user.role === 'child' && adults.length) {
    const women = adults.filter(isWoman).length, men = adults.length - women;
    // D9 as approved (02/10, question 19): two of the same are named twice. Who chose the plural (7ב, the owner r7d, 8ב): alone,
    // by name; with another, "ההורים"
    const plural = adults.some(isPlural);
    const who = plural ? (adults.length === 1 ? `${adults[0].name} יכולים` : 'ההורים יכולים') : adults.length >= 3 ? 'ההורים יכולים' : men && women ? 'אבא ואמא יכולים' : women > 1 ? 'אמא ואמא יכולות' : women ? 'אמא יכולה' : men > 1 ? 'אבא ואבא יכולים' : 'אבא יכול'; // ש9 (05/10): three or more, "ההורים"
    out.unshift({ id: 'parents', ts: from, role: 'shuki', thread: user.id, content: { reply: `${who} לראות את השיחה שלנו.`, face: 'happy', fixed: 'parents_see' } });
  }
  return out;
}

export async function buildState(env, user, now = Date.now(), { assistant = false } = {}) {
  const db = env.DB;
  await relinkOwners(db); // מ29, before the products are read
  // one round trip at a time was a second or more on D1 after every change: what doesn't depend on something else is asked together
  const [S, [last, waste, settings, undoable, journal, offList]] = await Promise.all([loadAll(db, user), db.batch([
    // Shuki's mood: another's private action ("זרקתי" on her own product, question 49) doesn't change it here, only for her (פ8, r7b)
    db.prepare("SELECT MAX(ts) AS ts FROM events WHERE type NOT IN ('undo','list_add','list_remove') AND (private_to IS NULL OR private_to = ?)").bind(user.id),
    db.prepare('SELECT MAX(ts) AS ts FROM events WHERE waste = 1 AND undone IS NULL AND (private_to IS NULL OR private_to = ?)').bind(user.id),
    db.prepare('SELECT key, value FROM settings'),
    db.prepare("SELECT id, summary, ts FROM events WHERE user_id = ? AND undone IS NULL AND type != 'undo' AND before IS NOT NULL ORDER BY ts DESC, id DESC LIMIT 1").bind(user.id),
    db.prepare('SELECT ts, summary, undone, type FROM events WHERE private_to IS NULL OR private_to = ? ORDER BY ts DESC, id DESC LIMIT 60').bind(user.id), // another's private product: not in my journal (0b part 3)
    db.prepare('SELECT COUNT(*) AS n FROM events WHERE off_list > 0 AND undone IS NULL AND (private_to IS NULL OR private_to = ?) AND ts >= ?').bind(user.id, monthStart(now)),
  ])]);
  const byProduct = {};
  for (const b of S.batches) (byProduct[b.product_id] ||= []).push(b);
  // home19 (10): a line that came on the list by itself (auto) is checked again only when its product is written (syncList), so a
  // rule that changed with a deploy left it there (the smoked paprika, 17/10: open and running out with one closed, which since
  // home18 isn't missing). Here, when the house is read: such a line whose product no longer needs it goes
  const stale = S.items.filter((i) => i.source === 'auto' && i.status === 'open' && i.product_id != null && (() => { const p = S.products.find((x) => x.id === i.product_id); return !!p && p.count_type !== 'batches' && !listNeed(p); })());
  if (stale.length) { await db.batch(stale.map((i) => db.prepare("DELETE FROM list_items WHERE id = ? AND source = 'auto' AND status = 'open'").bind(i.id))); S.items = S.items.filter((i) => !stale.includes(i)); }
  const [outCounts, [logRows, xpRow, shopRows, maybeRows, awayRows, lastTrip], dropped, allRecipes, routineRows, leftoverRows, lessonRows, usualBuy, noticedRows, connectorRows, cost] = await Promise.all([
    db.prepare("SELECT product_id, COUNT(*) AS n FROM events WHERE type = 'out' AND undone IS NULL AND ts >= ? GROUP BY product_id").bind(now - 60 * DAY).all(),
    db.batch([
    db.prepare('SELECT product_id, ts, kind FROM product_log WHERE ts >= ? ORDER BY ts').bind(now - 180 * DAY),
    // my Shuki grows with the care I give the house, a day at a time (xpOf, the owner 16/10)
    xpQuery(db, user.id),
    db.prepare('SELECT s.*, u.name, u.gender FROM shopping s JOIN users u ON u.id = s.user_id WHERE s.ended IS NULL AND s.started > ? ORDER BY s.started').bind(now - SHOP_TTL),
    db.prepare('SELECT m.*, u.name AS by_name, u.gender AS by_gender FROM maybe m LEFT JOIN users u ON u.id = m.added_by WHERE m.decided IS NULL ORDER BY m.added'), // by_gender: whose daily reminder, also of one who left (10, 05/10)
    db.prepare('SELECT * FROM away ORDER BY start'),
    db.prepare('SELECT s.summary, s.ended, u.name, u.gender FROM shopping s JOIN users u ON u.id = s.user_id WHERE s.summary IS NOT NULL AND s.ended > ? ORDER BY s.ended DESC LIMIT 1').bind(now - DAY),
    ]),
    // a sum for the whole house: nothing private, not even the reader's own (פ9, r12 q013)
    db.prepare("SELECT COUNT(*) AS n FROM maybe WHERE decision = 'drop' AND decided >= ? AND private_to IS NULL AND (product_id IS NULL OR product_id NOT IN (SELECT id FROM products WHERE private_to IS NOT NULL))").bind(monthStart(now)).first(),
    loadRecipes(db, S.products),
    db.prepare('SELECT r.id, r.product_id, r.text, r.weekday, r.every, r.store, r.added_by, r.private_to, COALESCE(p.name, r.text) AS name FROM routines r LEFT JOIN products p ON p.id = r.product_id AND p.deleted IS NULL ORDER BY r.weekday, r.id').all(),
    db.prepare('SELECT id, text, made, asked, kosher_kind FROM leftovers WHERE gone IS NULL ORDER BY made').all(),
    db.prepare('SELECT l.id, l.text, l.added, l.edited, u.name AS by_name FROM lessons l LEFT JOIN users u ON u.id = l.added_by ORDER BY l.added, l.id').all(),
    buyDefaults(db), // decision 122: the amount usually bought is what the cart offers
    noticedList(db, user.id),
    db.prepare('SELECT id, name, created, last_used FROM connectors WHERE user_id = ? ORDER BY created').bind(user.id).all(),
    monthCost(env, now),
  ]);
  const outN = Object.fromEntries(outCounts.results.map((r) => [r.product_id, r.n]));
  const paceSkip = (() => { try { return JSON.parse(settings.results.find((r) => r.key === 'pace_skip')?.value || '[]'); } catch { return []; } })();
  const babyCat = S.categories.find((c) => c.name === 'תינוק')?.id;
  const learned = learn(logRows.results, awayRows.results, now, paceSkip, new Set(S.products.filter((p) => babyCat != null && p.category_id === babyCat).map((p) => p.id))); // מ12: a period's window doesn't teach the usual pace; מ16: a baby's things, the last month
  // מ15 (q058): in Ramadan, last Ramadan's pace (kept, since learn() reads 180 days) in place of the usual one, until 1 Shawwal
  const ramadan = (() => { try { return JSON.parse(settings.results.find((r) => r.key === 'ramadan_pace')?.value || 'null'); } catch { return null; } })();
  const hijri = islamicDate(now, HOUSE.tz);
  if (ramadan?.pace && hijri.month === 9 && ramadan.year < hijri.year) {
    for (const [pid, every] of Object.entries(ramadan.pace)) {
      const l = learned[pid]; if (!(every > 0)) continue;
      if (l) { l.next += (every - l.every) * DAY; l.every = every; continue; }
      // bought only in Ramadan (dates): no usual pace to change, so last Ramadan's, from the last buy (the reviewer of 3720e8f)
      const lastBuy = logRows.results.filter((r) => String(r.product_id) === pid && r.kind === 'purchase').at(-1)?.ts;
      if (lastBuy) learned[pid] = { every, next: lastBuy + every * DAY, samples: 0, lastBuy };
    }
  }
  const g = growth(xpOf(xpRow.results, HOUSE.tz));
  const outfit = await myOutfit(env, user, g.level, settings.results);
  const kosher = kosherHouse(HOUSE.notes);
  // a child's suggestion is seen by the grown-ups and by the child who made it
  // question 88 (a) (the owner 06/10, r7b): an ingredient linked to someone else's private product doesn't carry its number in the
  // JSON; it reads as one that isn't in the inventory, as it already does on the screen and in the prompt
  const notMine = new Set((await db.prepare('SELECT id FROM products WHERE private_to IS NOT NULL AND private_to != ?').bind(user.id).all()).results.map((r) => r.id));
  for (const r of allRecipes) if (notMine.size) r.ings = r.ings.map((i) => (notMine.has(i.product_id) ? { ...i, product_id: null } : i));
  const recipes = allRecipes.filter((r) => !r.status || user.role !== 'child' || r.suggested_by === user.id).map((r) => ({ ...r, kosher: kosher ? kosherProblem(r.ings) : null, by_name: r.suggested_by ? S.users.find((u) => u.id === r.suggested_by)?.name || null : null, by_gender: r.suggested_by ? S.users.find((u) => u.id === r.suggested_by)?.gender || null : null }));
  // 0b part 3: a reminder or a weekly buy of someone else's private product (or of a name from the private list) isn't mine to see
  const seen = new Set(S.products.map((p) => p.id));
  // private_to (migration 0024, the owner 04/10): one made after a secret or with a name from the fixed list; not the text
  const theirs = (x) => (x.private_to != null ? x.private_to !== user.id : x.product_id != null && !seen.has(x.product_id));
  const routines = routineRows.results.filter((r) => r.name && !theirs(r));
  maybeRows.results = maybeRows.results.filter((m) => !theirs(m));
  // what a card of mine still waiting puts on the list (the mapping's end card): "נשאר מעט… להוסיף?" doesn't ask it again
  const pendingListed = new Set();
  for (const r of (await env.DB.prepare("SELECT actions FROM proposals WHERE user_id = ? AND status = 'pending' AND created > ?").bind(user.id, now - DAY).all()).results) {
    try { for (const a of JSON.parse(r.actions).actions || []) if (a.kind === 'list_add' && a.product_id != null) pendingListed.add(a.product_id); } catch { /* not a card */ }
  }
  const leftovers = leftoverRows.results;
  const lessons = lessonRows.results;
  const facts = mineWins((await factsFor(db, user, { now, assistant })) // a connected assistant: nothing private, not even the person's own (r11 q028, r0t p4)
    .filter((f) => !(f.key === 'no_ask' && !(f.about === 'person' && f.about_id === user.id))), user.id); // the owner 05/10: "לא לשאול" only to its own person
  // פ6: what the reader sees ("מה למדתי", ask_again, Shabbat) has her private row over the shared one; `.all` keeps every row
  // home19 (the manager, 18/10): "שימו לב: יש במתכון בוטנים" from the facts, worked out with every state (an edit that adds the peanuts
  // warns, an ended fact takes its warning)
  for (const r of recipes) r.factWarn = factWarnHits(r, { facts, users: S.users });

  // moving soon (d85): no "צפוי להיגמר" either, like "עומד להיגמר" below: finish what there is
  const moving = settings.results.some((r) => r.key === 'moving' && r.value);
  const products = S.products.map((p) => ({
    ...p,
    aliases: JSON.parse(p.aliases || '[]'),
    batches: byProduct[p.id] || [],
    missing: isMissing(p),
    out: isOut(p),
    suggested: usualBuy.get(p.id) ?? suggestedBuy(p),
    text: describe(p),
    next_expiry: nextExpiry(p, byProduct[p.id] || []),
    learned: learned[p.id] ? (moving || offSeason(learned[p.id], now) ? { ...learned[p.id], next: null } : learned[p.id]) : null, // out of season, or moving (d85): no "runs out soon"
    ...(user.role !== 'child' && deleteBlocked(p, S.users, user) && { noDelete: deleteBlocked(p, S.users, user) }), // q17: D15 instead of "מחיקה"
  }));
  const onList = new Set(S.items.filter((i) => i.product_id && i.status === 'open').map((i) => i.product_id));
  const m = mood({ products: S.products, lastUpdate: last.results[0]?.ts, lastWaste: waste.results[0]?.ts, now });
  // a child's distress mark never leaves the server (0b): no one, not the parent, learns there was one
  const set = Object.fromEntries(settings.results.filter((r) => !SECRET_SETTINGS.has(r.key) && !isDistressKey(r.key) && !/^(tells|learnask|pushes|later|eating|left|suggest_day):/.test(r.key)
    && (!r.key.startsWith('child_chat:') || r.key.startsWith(`child_chat:${user.id}:`))).map((r) => [r.key, r.value])); // b01: only my own choice of a child's chat
  // this week's recount: the picked products nobody has looked at since
  const since = Number(set.recount_at || 0);
  const recount = JSON.parse(set.recount_ids || '[]').filter((id) => { const p = S.products.find((x) => x.id === id); return p && !(p.counted >= since); });
  const aw = awayRows.results.filter((w) => (w.kind || 'away') === 'away'), gs = awayRows.results.filter((w) => w.kind === 'guests');
  const away = awayNow(aw, now) || aw.find((w) => w.start > now) || null;
  const guests = awayNow(gs, now) || gs.find((w) => w.start > now) || null;
  const prefs = notifyPrefs(set, user.id);
  // א5 (stage 8, approved r8p; the look ב: a bubble with buttons at the bottom of the chat): to a grown-up who said yes,
  // once a day ("כן, תציע" or "לא עכשיו" hides it until tomorrow), about what expires soonest and hasn't yet
  const optIn = user.role !== 'child' && !assistant && facts.some((f) => f.about === 'person' && f.about_id === user.id && f.key === 'suggest_optin' && f.value === 'כן');
  const soon = optIn && settings.results.find((r) => r.key === `suggest_day:${user.id}`)?.value !== local(now, HOUSE.tz).date && expiring(S.products, byProduct, now, 2).find((x) => x.e >= now && x.p.private_to == null);
  // the product's name with "the": by the dishes' rule ("הגבינה הצהובה"), and where it can't tell, as the digest says it ("החלב 3%")
  const theName = (n) => { const t = theDish(n); return t.startsWith('"') ? withHa(n) : t; };
  const dayOf = (ts) => Date.parse(`${local(ts, HOUSE.tz).date}T00:00:00Z`) / DAY;
  const suggest = soon ? { id: soon.p.id, name: soon.p.name,
    text: `${digestMessages({ expiring: [{ name: soon.p.name, days: dayOf(soon.e) - dayOf(now), date: local(soon.e, HOUSE.tz).date.split('-').slice(1).reverse().map(Number).join('.') }] })[0].body.replace(withHa(soon.p.name), theName(soon.p.name))} ${byPerson(user, 'האם תרצה', 'האם תרצי', 'האם תרצו')} רעיון למנה ${byGender(soon.p.name, 'איתו', 'איתה', 'איתם', 'איתן')}?`,
    ask: `מה אפשר להכין עם ${theName(soon.p.name)}?` } : null;
  // home20 (section 16): the week's plan, against the house (the screen's stamps and the model's line)
  const plan = planView(await planRows(db, now), { recipes, products, list: S.items }, now);
  return {
    now,
    me: { id: user.id, name: user.name, gender: user.gender, role: user.role || 'member' },
    house: HOUSE.name,
    tz: HOUSE.tz,
    keyFrom: env.KEY_FROM || (llmKey(env) ? 'server' : null),
    provider: providerOf(env),
    ...(user.role === 'admin' && { keys: { anthropic: !!env.ANTHROPIC_API_KEY, openai: !!env.OPENAI_API_KEY, app: env.APP_KEYS || {} } }),
    vapid: env.VAPID_PUBLIC || null,
    brain: !!llmKey(env),
    users: S.users.filter((u) => u.active !== 0).map((u) => ({ id: u.id, name: u.name, gender: u.gender, role: u.role || 'member' })),
    locations: S.locations,
    categories: S.categories,
    products,
    list: S.items,
    mood: m,
    expiring: expiring(S.products, byProduct, now, 2).map((x) => ({ id: x.p.id, name: x.p.name, expires: x.e })),
    // past the date and still at home: Shuki asks "did you throw it out?"
    suggest,
    expired: expiring(S.products, byProduct, now, 0).filter((x) => x.e < now).map((x) => ({ id: x.p.id, name: x.p.name, expires: x.e })),
    suggestBasic: products.filter((p) => !p.is_basic && (outN[p.id] || 0) >= 3).map((p) => ({ id: p.id, name: p.name, times: outN[p.id] })),
    offListThisMonth: offList.results[0]?.n || 0,
    soon: set.moving ? [] : runningOutSoon(S.products, learned, onList, now, 2), // moving soon: finish what there is
    growth: g,
    outfit,
    shopping: shopRows.results.map((x) => ({ id: x.id, user_id: x.user_id, name: x.name, gender: x.gender, store: x.store, started: x.started, mine: x.user_id === user.id })),
    settings: set,
    moving: set.moving ? Number(set.moving) : null,
    shabbat: facts.some((f) => f.about === 'person' && f.about_id === user.id && f.key === 'shabbat' && f.value === 'כן'),
    facts, // what Shuki knows, as this reader may see it (0c)
    stores: STORES.map((id) => ({ id, name: STORE_NAMES[id], custom: !BASE_STORES.includes(id), ...(EVENT_STORES[id] && { event: true, until: EVENT_STORES[id].until }) })),
    pesach: HOUSE.pesach,
    // its panel in the settings only when Passover mode is on, Passover is near, or someone spoke of it this week (the owner 16/10)
    pesachPanel: HOUSE.pesach || pesachSeason(now) || !!(await env.DB.prepare("SELECT 1 AS x FROM chat WHERE ts > ? AND role = 'user' AND (thread IS NULL OR thread = ?) AND content LIKE '%פסח%' LIMIT 1").bind(now - 7 * DAY, user.id).first()), // someone spoke of Passover this week: what people wrote, in the shared threads and mine (17/10, ש10)
    recipes,
    plan,
    recipeCategories: CATEGORIES,
    lessons,
    // decision 124: "I noticed that...", with yes / no
    ...(user.role !== 'child' && { houseGuests: (await db.prepare('SELECT id, name, eats FROM house_guests ORDER BY id').all()).results }), // מ27: not to a child
    hostingItems: await hostingItems(db),
    noticed: noticedRows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, text: noticedText(r, { users: S.users || [], products: S.products, categories: S.categories, locations: S.locations, me: user }) })).filter((x) => x.text),
    routines,
    leftovers,
    // three days after it was cooked (or after the last "still there"): Shuki asks once more
    leftoverAsk: leftovers.filter((x) => !x.asked && now - x.made >= LEFTOVER_ASK).map((x) => x.id), // asked once: "עוד יש" means it stays until someone says it's gone (r0t d97)
    recount,
    maybe: maybeRows.results.map((x) => ({ ...x, due: now >= maybeDue(x) })),
    // "a little left" of something that isn't basic: ask once what to do (list / remind me / not needed)
    lowAsk: S.products.filter((p) => !p.deleted && !p.is_basic && p.level === 'little' && !isOut(p) && !hasSpare(p) // another one closed at home: nothing to ask (16/10)
      && !S.items.some((i) => i.product_id === p.id && i.status !== 'done')
      && !maybeRows.results.some((m) => m.product_id === p.id)
      && set[`lowok:${p.id}`] !== String(p.updated)
      && !pendingListed.has(p.id) // in a card still waiting (the mapping's end card): not asked twice (the reviewer)
      && !(set.catalog_area && now - Number(set.catalog_area_at || 0) < 12 * 3600e3) && !(set.onboard && !(() => { try { const o = JSON.parse(set.onboard); return o.done || o.paused; } catch { return true; } })())).map((p) => ({ id: p.id, name: p.name })), // not while mapping (or in the first meeting, not paused): one card at its end (16/10)
    maybeDroppedThisMonth: dropped?.n || 0,
    away: away && { start: away.start, end: away.end, now: away.start <= now },
    guests: guests && { start: guests.start, end: guests.end, now: guests.start <= now },
    // three trips to its store without it: "still want it?"
    stale: S.items.filter((i) => i.status === 'open' && i.approved && (i.skipped || 0) >= 3).map((i) => ({ id: i.id, store: i.store, name: i.product_id ? S.products.find((p) => p.id === i.product_id)?.name : i.text })), // d45: and its store (it said "בסופר" always)
    brainError: (() => { const r = settings.results.find((x) => x.key === 'brain_error'); return r ? JSON.parse(r.value) : null; })(),
    // the name, how to talk to them and the house's name need no model: the chat stays open for them even with no key (approved 01/10)
    aboutMe: (() => { const r = settings.results.find((x) => x.key === 'onboard'); const o = r ? JSON.parse(r.value) : null; return !!o && o.user === user.id && !o.done && ['me', 'mygender', 'house'].includes(o.step); })(),
    connectors: connectorRows.results,
    fellBack: user.role === 'admin' ? (() => { const r = settings.results.find((x) => x.key === 'fell_back'); return r ? JSON.parse(r.value) : null; })() : undefined,
    notify: prefs,
    roommates: HOUSE.roommates,
    notes: HOUSE.notes,
    lastTrip: lastTrip.results[0] ? { ...JSON.parse(lastTrip.results[0].summary), name: lastTrip.results[0].name, gender: lastTrip.results[0].gender, ended: lastTrip.results[0].ended } : null,
    undo: undoable.results[0] || null,
    journal: journal.results,
    recountKind: set.recount_kind || 'weekly',
    version: VERSION,
    ...(user.role === 'admin' && {
      cost,
      update: set.update_available ? JSON.parse(set.update_available) : null,
    }),
  };
}


/** A day after the hosting: its tab goes; anything still open on it moves to the supermarket. */
async function endHostings(env, now) {
  const done = Object.entries(EVENT_STORES).filter(([, e]) => e.until <= now).map(([id]) => id);
  if (!done.length) return 0;
  // מ27 (q063): what was bought on them, by name only (not who, not when), for the next hosting's "בפעם הקודמת"
  const bought = (await env.DB.prepare(`SELECT DISTINCT COALESCE(p.name, i.text) AS name FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.store IN (${done.map(() => '?').join(',')}) AND i.status != 'open' AND i.private_to IS NULL AND (p.id IS NULL OR p.private_to IS NULL)`).bind(...done).all()).results.map((r) => r.name).filter(Boolean);
  if (bought.length) await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('hosting_items', ?)").bind(JSON.stringify(bought.slice(0, 20))).run();
  const extra = extraStores(done); // ב7: what the other lists keep (a guests' note) stays
  await env.DB.batch([env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('stores', ?)").bind(JSON.stringify(extra)), ...done.map((id) => env.DB.prepare("UPDATE list_items SET store = 'super' WHERE store = ? AND status = 'open'").bind(id))]);
  return done.length;
}
/** מ27: the names bought for the last hosting */
const hostingItems = async (db) => { try { return JSON.parse((await db.prepare("SELECT value FROM settings WHERE key = 'hosting_items'").first())?.value || '[]'); } catch { return []; } };
/** Claude can't answer (no credit, bad key): once per episode, the admins hear about it. */
async function tellAdminsNoBrain(env, kind) {
  const had = await env.DB.prepare("SELECT value FROM settings WHERE key = 'brain_error'").first();
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('brain_error', ?)").bind(JSON.stringify({ kind, ts: Date.now() })).run();
  if (had) return;
  const admins = (await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all()).results.map((u) => u.id);
  const P = PROVIDERS[providerOf(env)].label, where = providerOf(env) === 'openai' ? 'OpenAI' : 'Anthropic';
  await pushOthers(env, { id: -1 }, { title: 'אני לא מצליח לחשוב', body: kind === 'credit' ? `נגמר לי הקרדיט בחשבון ${P}, אז אני לא יכול לחשוב. מוסיפים קרדיט בקונסולה של ${where} ולוחצים על "בדיקה" בהגדרות.` : `יש בעיה עם המפתח של ${P}. מחליפים אותו בהגדרות → הבית.`, url: './#settings' }, admins, 'messages');
}
/** Decision 143: Shuki thought with the other provider. The admin hears once (until the usual one works again). */
async function noteFallback(env, fb) {
  const had = await env.DB.prepare("SELECT value FROM settings WHERE key = 'fell_back'").first();
  if (!fb) { if (had && !env.FELL_BACK) await env.DB.prepare("DELETE FROM settings WHERE key = 'fell_back'").run(); return; }
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('fell_back', ?)").bind(JSON.stringify({ ...fb, ts: Date.now() })).run();
  if (had) return;
  const admins = (await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all()).results.map((u) => u.id);
  const from = PROVIDERS[fb.from].label, to = PROVIDERS[fb.to].label;
  await pushOthers(env, { id: -1 }, { title: `עברתי ל-${to}`, body: `${fb.why === 'credit' ? `נגמר הקרדיט ב-${from}` : `${from} לא עונה כרגע`}, אז בינתיים אני חושב עם ${to}. כש-${from} יחזור, אחזור אליו לבד.`, url: './#settings' }, admins, 'messages');
}

/** Passover mode on: classify what isn't classified yet (chametz, and kitniyot once, c11), and say what chametz is at home. */
async function markChametz(env, user) {
  const db = env.DB;
  const todo = (await db.prepare('SELECT id, name, chametz, kitniyot FROM products WHERE deleted IS NULL AND (chametz IS NULL OR kitniyot IS NULL)').all()).results;
  if (todo.length) {
    const yes = await classifyChametz(env, todo.map((p) => ({ id: p.id, name: p.name, chametz: p.chametz == null ? undefined : false, kitniyot: p.kitniyot == null ? undefined : false })));
    await db.batch(todo.map((p) => db.prepare('UPDATE products SET chametz = COALESCE(chametz, ?), kitniyot = COALESCE(kitniyot, ?) WHERE id = ?').bind(yes.chametz.has(p.id) ? 1 : 0, yes.kitniyot.has(p.id) ? 1 : 0, p.id)));
  }
  // what came on the list by itself goes off it; what someone put there on purpose stays
  await db.prepare(`DELETE FROM list_items WHERE status = 'open' AND source = 'auto' AND product_id IN (SELECT id FROM products WHERE chametz = 1${HOUSE.noKitniyot ? ' OR kitniyot = 1' : ''})`).run();
  const S = await loadAll(db, user); // the names go back to whoever turned it on: not someone else's private product (0b)
  return S.products.filter((p) => p.chametz && !isOut(p)).map((p) => p.name);
}
/**
 * c11 (approved 03/10): when Passover mode goes on, Shuki asks once "האם אוכלים קטניות בפסח?"; the answer is the house's
 * fact "kitniyot" (no journal line, like shabbat from settings). Until it's answered: kitniyot aren't chametz, as before.
 */
async function askKitniyot(env, user) {
  const db = env.DB;
  if (await db.prepare("SELECT 1 AS x FROM facts WHERE about = 'house' AND key = 'kitniyot'").first()) return;
  if (await db.prepare("SELECT 1 AS x FROM settings WHERE key = 'kitniyot_asked'").first()) return;
  // the owner 05/10: asked only once it really is (releaseAsk marks it when it comes out of the queue); waiting in the queue, not again
  if (await db.prepare("SELECT 1 AS x FROM settings s JOIN users u ON s.key = 'askq:' || u.id AND u.active = 1 WHERE s.value LIKE '%\"kitniyot\":true%'").first()) return; // anyone's in the house now
  // the buttons (r0t-8, approved 04/10): "כן, אוכלים" / "לא אוכלים"
  const ask = { actions: [], kitniyot: true, done: 'סגור!', nope: 'בסדר.', choices: { 'כן, אוכלים': {}, 'לא אוכלים': { no: true } } }, bubble = { askOnly: true, reply: 'האם אוכלים קטניות בפסח?', face: 'happy', options: ['כן, אוכלים', 'לא אוכלים'], for: user.id };
  // a question of theirs still open isn't overwritten: this one waits until it's answered (as in r0t-4)
  if (await openAsk(db, user.id)) return queueAsk(db, user.id, { ask, bubble, ts: Date.now() });
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('kitniyot_asked', ?)").bind(String(Date.now())).run();
  await setAsk(env, user, ask);
  await saveChat(env, null, 'shuki', bubble, Date.now());
}

/**
 * The house's own settings for this request: its stores, Passover mode, time zone and name (for the rules), and the
 * Claude key and push keys when they were set up in the app rather than as server secrets.
 */
async function withHouse(env) {
  const rows = (await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('stores', 'pesach', 'tz', 'house_name', 'anthropic_key', 'openai_key', 'provider', 'vapid', 'house_mode', 'house_notes', 'shop_produce', 'shop_care') UNION ALL SELECT 'kitniyot', value FROM facts WHERE about = 'house' AND key = 'kitniyot'").all()).results;
  const set = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  setHouse(set);
  // the key the admin entered in the app wins over the server's; its kind picks the provider (Claude or ChatGPT)
  const out = { ...env };
  if (set.anthropic_key) out.ANTHROPIC_API_KEY = set.anthropic_key;
  if (set.openai_key) out.OPENAI_API_KEY = set.openai_key;
  out.PROVIDER = set.provider || env.PROVIDER || (!env.ANTHROPIC_API_KEY && env.OPENAI_API_KEY ? 'openai' : 'anthropic');
  out.APP_KEYS = { anthropic: !!set.anthropic_key, openai: !!set.openai_key };
  out.KEY_FROM = set.anthropic_key || set.openai_key ? 'app' : llmKey(out) ? 'server' : null;
  if (/^REPLACE_/.test(env.VAPID_PUBLIC || '')) out.VAPID_PUBLIC = ''; // wrangler.toml as published: no key yet
  if (!(out.VAPID_PUBLIC && out.VAPID_PRIVATE_JWK)) {
    // no push keys configured: make a pair once and keep it
    let v = set.vapid && JSON.parse(set.vapid);
    if (!v) { v = await makeVapid(); await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid', ?)").bind(JSON.stringify(v)).run(); v = JSON.parse((await env.DB.prepare("SELECT value FROM settings WHERE key = 'vapid'").first()).value); }
    out.VAPID_PUBLIC = v.publicKey; out.VAPID_PRIVATE_JWK = JSON.stringify(v.privateJwk);
  }
  out.VAPID_SUBJECT ||= 'mailto:shuki@users.noreply.github.com';
  return out;
}
async function makeVapid() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey));
  const publicKey = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { publicKey, privateJwk: await crypto.subtle.exportKey('jwk', k.privateKey) };
}
const hasUsers = async (db) => !!(await db.prepare('SELECT 1 AS x FROM users WHERE active = 1 LIMIT 1').first());
/** Rate limit for codes (pairing, setup): 5 wrong per address per 15 minutes, 20 per hour for everyone. */
/**
 * Wrong codes: 5 from one address in 15 minutes locks that address; 20 from everywhere in an hour locks the pairing
 * screen for guesses (a spread-out guesser). A lock of the second kind doesn't lock the house out (security review,
 * A-1): a code the admin made in the last 15 minutes still works, and the setup code is checked per address only.
 */
async function tooManyTries(db, ip, now) {
  const [mine, all] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM pair_attempts WHERE ip = ? AND ts > ?').bind(ip, now - 15 * 60e3),
    db.prepare('SELECT COUNT(*) AS n FROM pair_attempts WHERE ts > ?').bind(now - 3600e3),
  ]);
  return { mine: mine.results[0].n >= 5, all: all.results[0].n >= 20 };
}
const FRESH_CODE = 15 * 60e3;
/** Stage 13, d3 (S13-2): a phone of the app (not a shortcut key or a tool) connected now as this person. */
/**
 * Shuki's points (the owner 16/10): one for each day, by the house's clock, on which this person did an update that counts, and one
 * more on a day they finished a shopping trip (at most one a day). Not counted: waste, undo, deleting, an update undone, and
 * what the mapping or the first meeting added (events.source). Runs on the events there are: no event is changed.
 */
// one row an hour (the reviewer: every event to the worker was ~27 ms of CPU a thousand on each state load), each hour put on
// its house-local day by its middle (a time zone that is half an hour off moves the day mid-hour)
const xpQuery = (db, uid) => db.prepare("SELECT CAST(ts / 3600000 AS INTEGER) AS h, MAX(type = 'finish') AS f FROM events WHERE user_id = ? AND undone IS NULL AND waste = 0 AND type NOT IN ('undo', 'delete', 'discard') AND source IS NULL GROUP BY h").bind(uid);
export function xpOf(rows, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
  const days = new Set(), trips = new Set();
  for (const r of rows || []) {
    const d = fmt.format(new Date(r.h != null ? r.h * 3600000 + 1800000 : r.ts)); // rows of hours, or events (tests)
    days.add(d); if (r.f === 1 || r.f === true || r.type === 'finish') trips.add(d);
  }
  return days.size + trips.size;
}
/** The only phone of an admin, when no other admin has one (17/10, ש3): it isn't disconnected, or nobody could make a code again. */
export const lastAdminPhone = async (db, deviceId) => {
  const d = await db.prepare('SELECT d.kind, u.role FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = ? AND u.active = 1').bind(deviceId).first();
  if (!d || d.kind !== 'app' || d.role !== 'admin') return false;
  return !(await db.prepare("SELECT 1 AS x FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id != ? AND d.kind = 'app' AND u.role = 'admin' AND u.active = 1 LIMIT 1").bind(deviceId).first());
};
/** The approved words (17/10) where the button "ניתוק המכשיר הזה" was. */
export const onlyPhoneLine = (u) => byPerson(u, 'זה המכשיר היחיד שלך, ואין עוד מנהל עם טלפון. כדי לנתק אותו, קודם חבר טלפון נוסף.', 'זה המכשיר היחיד שלך, ואין עוד מנהל עם טלפון. כדי לנתק אותו, קודם חברי טלפון נוסף.', 'זה המכשיר היחיד שלכם, ואין עוד מנהל עם טלפון. כדי לנתק אותו, קודם חברו טלפון נוסף.');
const hasPhone = async (db, uid) => !!(await db.prepare("SELECT 1 AS x FROM devices WHERE user_id = ? AND kind = 'app' LIMIT 1").bind(uid).first());
/** The approved words (r13a, 15/10) to an admin who asks for a code for someone who has a phone: they make it from theirs.
 * The person by their gender, the reader by theirs. About someone "בלשון רבים": הם יוצרים / שלהם / להם, by 7ב's rule (not in
 * the approved words; the stage 13 report). */
export const phoneTaken = (t, reader) => `ל${t.name} כבר יש טלפון שמחובר אליי. קוד לטלפון נוסף ${byPerson(t, 'הוא יוצר', 'היא יוצרת', 'הם יוצרים')} מהטלפון ${byPerson(t, 'שלו', 'שלה', 'שלהם')}. אם הטלפון ${byPerson(t, 'שלו', 'שלה', 'שלהם')} אבד, ${byPerson(reader, 'אתה יכול', 'את יכולה', 'אתם יכולים')} לנתק אותו קודם ב"מכשירים", ואז ליצור ${byPerson(t, 'לו', 'לה', 'להם')} קוד.`;
/** The approved words (r13a) to someone as whom another phone just connected. */
export const newPhoneLine = (u) => byPerson(u, 'טלפון חדש התחבר אליי עכשיו בשם שלך. אם זה לא אתה, אתה יכול לנתק אותו בהגדרות, ב"מכשירים".', 'טלפון חדש התחבר אליי עכשיו בשם שלך. אם זו לא את, את יכולה לנתק אותו בהגדרות, ב"מכשירים".', 'טלפון חדש התחבר אליי עכשיו בשם שלכם. אם אלה לא אתם, אתם יכולים לנתק אותו בהגדרות, ב"מכשירים".');
async function wrongTry(db, ip, now) {
  await db.batch([db.prepare('INSERT INTO pair_attempts (ip, ts) VALUES (?, ?)').bind(ip, now), db.prepare('DELETE FROM pair_attempts WHERE ts < ?').bind(now - 86400e3)]);
}
/** A new install: the one-time setup code (from the deploy, the server's log, or SETUP_CODE). */
export async function setupCode(env) {
  if (env.SETUP_CODE) return String(env.SETUP_CODE);
  if (await hasUsers(env.DB)) return null;
  let row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'setup_code'").first();
  if (!row) {
    const code = String(10000000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90000000));
    await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('setup_code', ?)").bind(code).run();
    row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'setup_code'").first();
    console.log(`shuki: setup code ${row.value}`);
  }
  return row.value;
}
const GENDERS = ['m', 'f', 'p']; // p: "בלשון רבים" (q043, stage 7ב); its words are what m gets until they are approved
/** b01: the house's old child_chat:<child> = '0' becomes each grown-up's own, as migration 0025 does (the same SQL). */
async function childChatEach(db) {
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO settings (key, value) SELECT 'child_chat:' || u.id || ':' || substr(s.key, 12), '0' FROM settings s JOIN users u ON u.role != 'child' AND u.active = 1 WHERE s.key LIKE 'child_chat:%' AND instr(substr(s.key, 12), ':') = 0 AND s.value = '0'"),
    db.prepare("DELETE FROM settings WHERE key LIKE 'child_chat:%' AND instr(substr(key, 12), ':') = 0"),
  ]);
}
/** Put a backup file (from "download a backup") into a new, empty house. Columns the file doesn't know keep their defaults. */
const RESTORE_ORDER = ['house_guests', 'users', 'locations', 'categories', 'products', 'batches', 'list_items', 'events', 'product_log', 'receipt_aliases', 'recipes', 'recipe_ingredients', 'cooked_log', 'meal_plan', 'meal_plan_items', 'maybe', 'feedback', 'lessons', 'facts', 'routines', 'leftovers', 'noticed', 'settings'];
async function restoreBackup(db, bk) {
  if (typeof bk !== 'object' || !Array.isArray(bk.products) || !Array.isArray(bk.locations)) throw new Error('זה לא קובץ גיבוי שלי');
  await db.batch(['locations', 'categories'].map((t) => db.prepare(`DELETE FROM ${t}`))); // the new install's starter places and categories
  const counts = {};
  for (const t of RESTORE_ORDER) {
    const rows = Array.isArray(bk[t]) ? bk[t] : [];
    if (!rows.length) continue;
    const cols = new Set((await db.prepare(`PRAGMA table_info(${t})`).all()).results.map((c) => c.name));
    const stmts = [];
    for (const row of rows) {
      if (t === 'settings' && SECRET_SETTINGS.has(row.key)) continue;
      const keys = Object.keys(row).filter((k) => cols.has(k));
      if (!keys.length) continue;
      stmts.push(db.prepare(`INSERT OR REPLACE INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map((k) => row[k] ?? null)));
    }
    for (let i = 0; i < stmts.length; i += 200) await db.batch(stmts.slice(i, i + 200));
    counts[t] = stmts.length;
  }
  await shabbatFromSettings(db); // a backup from before 0c keeps "keeps Shabbat" as a setting
  await childChatEach(db); // and one from before stage 5 keeps the house's child_chat:<child> (as migration 0025)
  return counts;
}

/** For aboutHouse: the house's name, everyone else in it, how much is in stock and where, and the house notes. */
async function houseFacts(db, uid) {
  const [set, people, stock, places] = await db.batch([
    db.prepare("SELECT key, value FROM settings WHERE key IN ('house_name', 'house_notes')"),
    db.prepare('SELECT name FROM users WHERE active = 1 AND id != ? ORDER BY id').bind(uid),
    db.prepare('SELECT COUNT(*) AS n FROM products WHERE deleted IS NULL AND private_to IS NULL'),
    db.prepare('SELECT l.name FROM locations l WHERE EXISTS (SELECT 1 FROM products p WHERE p.location_id = l.id AND p.deleted IS NULL AND p.private_to IS NULL) ORDER BY l.sort, l.id'),
  ]);
  const s = Object.fromEntries(set.results.map((r) => [r.key, r.value]));
  return { house: s.house_name || 'הבית', others: people.results.map((r) => r.name).filter(Boolean), products: stock.results[0]?.n || 0, places: places.results.map((r) => r.name), notes: s.house_notes || '' };
}

const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 30);

async function body(req) { try { return await req.json(); } catch { return {}; } }

/**
 * Decision 145: another assistant talks to Shuki over MCP (Streamable HTTP, JSON answers, no sessions).
 * The secret address /mcp/<token> (or the token as a Bearer header) says whose connection it is.
 */
async function handleMcp(req, env) {
  const url = new URL(req.url);
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  // a web page can't use someone's connection from their browser
  const origin = req.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
  const token = url.pathname.split('/')[2] || (/^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('authorization') || '') || [])[1];
  const row = /^[0-9a-f]{64}$/.test(token || '') && (await env.DB.prepare('SELECT c.id AS connector_id, c.name AS via, u.id, u.name, u.gender, u.role FROM connectors c JOIN users u ON u.id = c.user_id WHERE c.token_hash = ? AND u.active = 1').bind(await sha256(token)).first());
  if (!row) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unknown or revoked Shuki connection' } }, 401);
  await env.DB.prepare('UPDATE connectors SET last_used = ? WHERE id = ?').bind(Date.now(), row.connector_id).run();
  let msg; try { msg = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const user = { id: row.id, name: row.name, gender: row.gender, role: row.role };
  const ctx = { env, user, via: row.via || 'עוזר', connector: row.connector_id, version: VERSION, state: await buildState(env, user, Date.now(), { assistant: true }), chat };
  const answers = [];
  for (const m of (Array.isArray(msg) ? msg : [msg]).slice(0, 20)) { const a = await handleRpc(m, ctx); if (a) answers.push(a); if (a?.result && m.method === 'tools/call') ctx.state = await buildState(env, user, Date.now(), { assistant: true }); }
  if (!answers.length) return new Response(null, { status: 202 });
  return json(Array.isArray(msg) ? answers : answers[0]);
}

async function handleApi(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname;
  const db = env.DB;

  /* ---- a new house: is it set up yet, and setting it up with the one-time code ---- */
  if (path === '/api/setup' && req.method === 'GET') {
    const need = !(await hasUsers(db));
    if (need) await setupCode(env); // made now if missing, so it shows in the log
    return json({ needed: need });
  }
  if (path === '/api/setup' && req.method === 'POST') {
    const b = await body(req);
    const now = Date.now(); const ip = req.headers.get('cf-connecting-ip') || 'local';
    if (await hasUsers(db)) return json({ error: 'הבית כבר הוקם. צריך לבקש קוד חיבור ממנהל הבית.' }, 409);
    if ((await tooManyTries(db, ip, now)).mine) return json({ error: 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד רבע שעה.' }, 429);
    const code = await setupCode(env);
    if (!code || String(b.code || '').replace(/\D/g, '') !== code) { await wrongTry(db, ip, now); return json({ error: 'קוד ההקמה לא נכון' }, 400); }
    // the name, how to talk to them and the house's name: Shuki asks in the chat, as the first thing he says (30/09).
    // (still accepted here, for a restore and for older clients)
    const name = cleanName(b.name), house = String(b.house || '').trim().slice(0, 40);
    const askMe = !name;
    if (b.gender != null && !GENDERS.includes(b.gender)) return json({ error: 'איך לפנות אליך?' }, 400);
    const gender = GENDERS.includes(b.gender) ? b.gender : 'm';
    const tz = validTz(b.tz) ? b.tz : 'Asia/Jerusalem';
    let prov = null;
    if (b.key) { const t = await testKey(env, String(b.key).trim()); if (!t.ok) return json({ error: t.error }, 400); prov = t.provider; }
    const token = randomToken();
    // a backup from another install (moving from Cloudflare to Node, a new server): everything comes back
    let restored = null;
    // a restore that fails half way leaves nothing behind, so the setup can be tried again
    if (b.backup) { try { restored = await restoreBackup(db, b.backup); } catch (e) { await deleteHouse(db); await setupCode(env); return json({ error: /[\u0590-\u05FF]/.test(e.message || '') ? e.message : 'לא הצלחתי לשחזר מהגיבוי. הקובץ אולי פגום' }, 400); } }
    // the one who sets up is someone in the backup only while they live there (stage 13, d4: not someone who left, by name)
    const me = restored && (await db.prepare('SELECT id FROM users WHERE name = ? AND active = 1').bind(name).first());
    if (restored && !me) { const gone = await db.prepare('SELECT id FROM users WHERE name = ?').bind(name).first(); if (gone) await (await freeName(db, gone.id)).run(); }
    await db.batch([
      me ? db.prepare("UPDATE users SET role = 'admin', active = 1, gender = ? WHERE id = ?").bind(gender, me.id) : db.prepare("INSERT INTO users (name, gender, role, active, created) VALUES (?, ?, 'admin', 1, ?)").bind(name, gender, now),
      ...((house || !restored) && !askMe ? [db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_name', ?)").bind(house || `הבית של ${name}`)] : []),
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tz', ?)").bind(tz),
      db.prepare("DELETE FROM settings WHERE key = 'setup_code'"),
      ...(b.key ? [db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`${prov}_key`, String(b.key).trim()), db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider', ?)").bind(prov)] : []),
    ]);
    // the phone is the one who set up (stage 13: not the newest admin a backup has, A-8)
    const u = me ? await db.prepare('SELECT id, name FROM users WHERE id = ?').bind(me.id).first() : await db.prepare("SELECT id, name FROM users WHERE role = 'admin' AND active = 1 ORDER BY id DESC LIMIT 1").first();
    await db.prepare('INSERT INTO devices (user_id, token_hash, name, created, last_seen) VALUES (?,?,?,?,?)').bind(u.id, await sha256(token), String(b.device || '').slice(0, 60), now, now).run();
    // a new, empty house: Shuki offers to map it together
    // decisions 150, 179: a new house starts with Shuki saying who he is, in four bubbles, and the first meeting begins
    if (!restored && !(env.TEST_RESET === '1' && b.onboard === false)) { // tests of other things can start past it
      await db.batch([...introBubbles({ askMe }).flatMap((m, k) => chatRows(db, now + k, null, 'shuki', { ...m, for: u.id, only: u.id })), // the first meeting is the admin's alone (approved 01/10, finding 2)
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboard', ?)").bind(JSON.stringify(startState(u.id, askMe)))]);
    }
    return json({ token, user: u, ...(restored && { restored }) });
  }

  if (path === '/api/pair' && req.method === 'POST') {
    const { code, name } = await body(req);
    const now = Date.now();
    const ip = req.headers.get('cf-connecting-ip') || 'local';
    const lock = await tooManyTries(db, ip, now);
    if (lock.mine) return json({ error: 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד רבע שעה.' }, 429);
    const row = await db.prepare('SELECT c.* FROM pairing_codes c JOIN users u ON u.id = c.user_id AND u.active = 1 WHERE c.code = ?').bind(String(code ?? '').trim()).first();
    const good = row && !row.used && row.expires >= now;
    const hadPhone = good && (await hasPhone(db, row.user_id)); // stage 13, d3: another phone as someone who has one
    // everyone is locked out of guessing: only a code made in the last few minutes gets through (and no guess is counted)
    // ...but a wrong guess is still counted, so one address can't keep guessing while the house is locked (stage 13, S13-1)
    if (lock.all && !(good && row.created > now - FRESH_CODE)) {
      if (!good && !(row?.used && now - row.used < 60e3)) await wrongTry(db, ip, now);
      return json({ error: 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד רבע שעה.' }, 429);
    }
    if (!good) {
      // the same code again a moment after it worked (a double tap): not a guess (QA, Q-9)
      if (!(row?.used && now - row.used < 60e3)) await wrongTry(db, ip, now);
      return json({ error: 'הקוד לא נכון או שהוא כבר לא בתוקף' }, 400);
    }
    const token = randomToken();
    await db.batch([
      db.prepare('UPDATE pairing_codes SET used = ? WHERE code = ?').bind(now, row.code),
      db.prepare('INSERT INTO devices (user_id, token_hash, name, created, last_seen) VALUES (?,?,?,?,?)').bind(row.user_id, await sha256(token), String(name || '').slice(0, 60), now, now),
    ]);
    const user = await db.prepare('SELECT id, name, gender, role FROM users WHERE id = ?').bind(row.user_id).first();
    // stage 13, d3: someone who already has a phone hears that another one joined as them, in their chat and by push; not
    // hidden, and not in a child's hidden time (but a parent doesn't see it in that time either)
    if (hadPhone) {
      const said = newPhoneLine(user);
      const hidden = await stillSensitive(db, user, now);
      await db.batch(chatRows(db, now, null, 'shuki', { reply: said, face: 'happy', for: user.id, ...(hidden && { only: user.id }) }));
      await pushOthers(env, { id: -1 }, { title: 'שוקי', body: said, url: './#settings' }, [user.id], 'messages').catch(() => {});
    }
    // the first phone of someone who joined later: hello, who Shuki is and what to ask him (decision 168)
    const before = (await db.prepare('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?').bind(row.user_id).first()).n;
    // and one question about food (r9-100, in the decision's words): the answer is saved as their fact (shuki.js, chatTurn: joinFood)
    const foodAsk = { reply: `האם יש משהו ש${byPerson(user, 'אתה לא אוכל', 'את לא אוכלת', 'אתם לא אוכלים')}?`, face: 'happy' };
    if (before === 1) await db.batch([...[...helloBubbles(user), ...aboutHouse(user, await houseFacts(db, user.id)), foodAsk].flatMap((m, k) => chatRows(db, now + 1 + k, null, 'shuki', { ...m, for: user.id, only: user.id })),
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')").bind(`joinfood:${user.id}`)]);
    // and everyone already in the house hears that they joined (approved 01/10; q16, 02/10)
    if (before === 1) {
      const others = (await db.prepare('SELECT id FROM users WHERE active = 1 AND id != ?').bind(user.id).all()).results;
      if (others.length) await db.batch(others.flatMap((o) => chatRows(db, now, null, 'shuki', { ...joinedBubble(user), for: o.id, only: o.id })));
    }
    return json({ token, user: { id: user.id, name: user.name } });
  }

  const user = await auth(req, env);
  if (!user) return json({ error: 'הטלפון הזה כבר לא מחובר אליי', ...(await removedBy(req, env)) }, 401); // p7: and who took them out
  if (user.kind === 'shortcut' && !SHORTCUT_PATHS.has(path)) return json({ error: 'המפתח הזה רק לקיצורי דרך' }, 403);
  const admin = user.role === 'admin';

  try {
    // the app gets only the settings it reads (stage 9, task 0); the server's own callers of buildState (chat, recipes, MCP) keep them all
    if (path === '/api/state' && req.method === 'GET') { const st = await buildState(env, user); return json({ ...st, settings: stateSettings(st.settings, user.id), ...(!(Number(req.headers.get('x-levels')) >= 21) && st.growth && { growth: legacyGrowth(st.growth.xp) }) }); } // question 18: an app still on 15 levels (the cached copy, once after the deploy) gets its own numbers, so no false party

    if (path === '/api/actions' && req.method === 'POST') {
      // Direct actions from the app's own screens (list, inventory). Chat goes through proposals.
      const b = await body(req);
      if (Array.isArray(b.actions)) b.actions = b.actions.filter((a) => a && typeof a === 'object' && typeof a.kind === 'string'); // Q-2
      if (!Array.isArray(b.actions) || !b.actions.length) return json({ error: 'אין פעולות' }, 400);
      if (b.actions.length > 500) return json({ error: 'יותר מדי פעולות בבת אחת' }, 400);
      const dels = b.actions.filter((a) => a.kind === 'delete').length;
      if (dels > 5 && !b.sure) return json({ error: `בטוח? ${dels} מוצרים יימחקו מהמלאי`, needSure: dels }, 409);
      const r = await execute(env, user, b.actions, { opId: b.op_id, context: b.context, now: b.ts && Math.abs(Date.now() - b.ts) < 7 * DAY ? b.ts : undefined });
      const notify = r.replay ? [] : [...await tellShoppers(env, user, r.added), ...await childAsked(env, user, r.added), ...await tellResponsible(env, user, r.ranOut, r.added)];
      const fin = b.actions.find((a) => a.kind === 'finish');
      let trip = null;
      if (!r.replay && fin) { const e = await endShopping(env, user, { bought: r.finished, store: fin.store }); notify.push(...e.notify); trip = e.summary; }
      return json({ ok: true, ...r, notify, trip });
    }

    if (path === '/api/shopping' && req.method === 'POST') {
      const b = await body(req);
      return json(b.on === false ? await endShopping(env, user) : await startShopping(env, user, b.store));
    }

    if (path === '/api/logout' && req.method === 'POST') {
      if (await lastAdminPhone(db, user.device_id)) return json({ error: onlyPhoneLine(user) }, 409);
      await db.prepare('DELETE FROM devices WHERE id = ?').bind(user.device_id).run();
      return json({ ok: true });
    }

    if (path === '/api/undo' && req.method === 'POST') {
      const r = await undoLast(env, user);
      if (r?.conflict) return json({ error: r.conflict }, 409);
      return r ? json({ ok: true, ...r }) : json({ error: 'אין מה לבטל' }, 404);
    }

    if (path === '/api/chat' && req.method === 'POST') {
      const b = await body(req);
      const t = String(b.text || '').trim();
      // 0b: a possible distress goes straight to chat(), before "missed you", starting over and the first meeting
      const distress = !!(t && distressOf(t));
      // 66 (the owner 05/10): the idle card's buttons work once, for a grown-up, while it's still open (no second recount); a
      // child's press on a card to the house isn't taken
      const last = !distress && !b.image && (t === IDLE_YES || t === IDLE_NO) && await db.prepare("SELECT content, ts FROM chat WHERE role = 'shuki' AND (thread = ? OR thread IS NULL) ORDER BY ts DESC, id DESC LIMIT 1").bind(user.id).first();
      const idleOpen = last && JSON.parse(last.content).offer === 'idle' && !JSON.parse(last.content).answered && last.ts > Date.now() - CARD_DAY && user.role !== 'child';
      // מ14: the Passover card's buttons, once, for a grown-up, while it's open: "כן, תכבה" turns the mode off as the switch in
      // the settings does, and asks what to do with what is left of Passover (q056); "עוד לא" leaves it
      // (read before the next message marks the card answered; only while it is the last thing Shuki said to them: "עוד לא"
      // typed as the answer to something else isn't this card's)
      const lastP = !distress && !b.image && (t === PESACH_OFF || t === PESACH_NOT_YET) && user.role !== 'child' && HOUSE.pesach
        && await db.prepare("SELECT id, content, ts FROM chat WHERE role = 'shuki' AND (thread = ? OR thread IS NULL) ORDER BY ts DESC, id DESC LIMIT 1").bind(user.id).first();
      const pc = lastP && JSON.parse(lastP.content).offer === 'pesach_end' && !JSON.parse(lastP.content).answered && lastP.ts > Date.now() - 7 * DAY ? lastP : null;
      if ((t || b.image) && !distress) await answerServerCard(db, t, Date.now(), user); // a card from the server, answered by the next message: it stays (r12 q032; the owner 05/10) // write:server_card
      if (pc) {
        const now = Date.now();
        await db.prepare("UPDATE chat SET content = json_set(content, '$.answered', 1) WHERE id = ?").bind(pc.id).run(); // write:pesach
        let reply = 'בסדר.', options;
        if (t === PESACH_OFF) {
          await pesachOff(env); // write:pesach
          const left = (await db.prepare("SELECT id, name, qty, count_type FROM products WHERE deleted IS NULL AND private_to IS NULL AND (qty > 0 OR level IN ('plenty', 'little'))").all()).results.filter((p) => PESACH_OK.test(p.name));
          reply = 'סגור!';
          if (left.length) {
            const names = left.map((p) => p.name), off = left.map((p) => ({ kind: 'op', product_id: p.id, op: { type: 'discard', amount: p.count_type === 'level' ? null : p.qty || 1 } }));
            reply = PESACH_LEFT(names);
            options = ['תשאיר במלאי', 'תוריד מהמלאי'];
            await setAsk(env, user, { actions: off, done: 'סגור!', nope: 'בסדר.', onlyChoices: true, choices: { 'תוריד מהמלאי': { actions: off, done: 'סגור!' }, 'תשאיר במלאי': { no: true } } }); // write:ask
          }
        }
        await db.batch([...chatRows(db, now, user.id, 'user', { text: t }), ...chatRows(db, now + 1, null, 'shuki', { reply, face: 'happy', for: user.id, ...(options && { options }) })]); // write:chat_save
        return json({ reply, face: 'happy', ...(options && { options }) });
      }
      if (idleOpen) {
        { // (its own block, as it was)
          const now = Date.now();
          const n = t === IDLE_YES ? await idleRecount(env, now) : 0; // write:idle
          const reply = t === IDLE_NO ? 'בסדר, אני פה כשצריך.' : n ? `יאללה! בכל שורה: "הסטטוס מעודכן" אם זה נכון, או "${byPerson(user, 'בוא', 'בואי', 'בואו')} נתקן".` : 'אין לי עוד מה לבדוק. ספרו לי מה נגמר.';
          await db.batch([
            ...chatRows(db, now, user.id, 'user', { text: t }),
            ...chatRows(db, now + 1, null, 'shuki', { reply, face: 'happy', for: user.id }),
          ]);
          return json({ reply, face: 'happy', recount: n });
        }
      }
      // "להתחיל מהתחלה" (approved 01/10): the admin empties the inventory, the list and the chat, after a yes
      if (!distress && !b.image && t) {
        const bubbles = await restartStep(env, user, t, { think, record, saveChat, outOfHouse }); // write:restart
        if (bubbles) {
          const now = Date.now();
          await db.batch(bubbles.flatMap((m, k) => chatRows(db, now + 1 + k, null, 'shuki', { ...m, for: user.id }))); // write:restart
          return json({ ...bubbles.at(-1), onboard: true, bubbles: bubbles.length });
        }
      }
      // the first meeting (decisions 150-169): the server runs it; a message that isn't an answer goes to the normal chat
      if (!distress && !b.image && t && (await inOnboarding(db, user, t))) {
        const now = Date.now();
        const st = await buildState(env, user); // write:state
        await saveChat(env, user, 'user', { text: t, only: user.id }, now); // write:onboarding
        let r;
        try { r = await onboardStep(env, user, t, st, { think, record }); } // write:onboarding
        catch (e) { // the model didn't answer (even after trying again): nothing is lost, the same question stays
          console.error('onboarding', e?.message);
          r = { bubbles: [{ reply: 'לא הצלחתי לקרוא את זה כרגע. האם אפשר לכתוב לי את זה שוב?', face: 'confused' }] };
        }
        let bubbles = r.bubbles;
        if (r.chat) {
          const o = await chat(env, user, { ...b, saved: true, onboarding: true }, await buildState(env, user)); // write:turn
          bubbles = [{ reply: 'האם נמשיך להכיר?', face: 'happy', options: [RESUME_YES, LATER] }];
          if (o.proposal || o.options?.length) bubbles[0].delay = true; // it waits under Shuki's answer
          await db.batch(bubbles.flatMap((m, k) => chatRows(db, Date.now() + 5 + k, null, 'shuki', { ...m, for: user.id, only: user.id }))); // write:onboarding
          return json({ ...o, onboard: true });
        }
        if (bubbles.length) await db.batch(bubbles.flatMap((m, k) => chatRows(db, now + 1 + k, null, 'shuki', { ...m, for: user.id, only: user.id }))); // write:onboarding (ז2's "כן, אכתוב לך" has none) (a bubble about a pregnancy carries its own `sensitive`)
        // ז2: an answer about a pregnancy, and what Shuki said back, go after 7 days, like a personal message (פ12)
        if (r.sensitive) await db.prepare("UPDATE chat SET content = json_set(content, '$.sensitive', json('true')) WHERE ts = ? AND user_id = ? AND role = 'user'").bind(now, user.id).run(); // all threads: the writer's own row of this turn // write:onboarding
        return json({ ...bubbles.at(-1), onboard: true, bubbles: bubbles.length });
      }
      if (t && !distress && !b.image) await approveMappingCard(env, user, t); // a mapping's button approves its waiting card first (17/10, ש2) // write:card
      const out = await chat(env, user, b, await buildState(env, user)); // write:turn
      if (out.away) await setAway(env, user, out.away.until, null, out.away.end); // write:states
      if (out.guests) await setAway(env, user, out.guests.until, null, out.guests.end, 'guests'); // write:states
      if (out.brainError) await tellAdminsNoBrain(env, out.brainError); // write:system
      await noteFallback(env, out.fellBack); delete out.fellBack; // write:system
      if (out.childAdded) { out.notify = await childAsked(env, user, out.childAdded); delete out.childAdded; } // write:child
      if (out.shopping === 'start') out.notify = (await startShopping(env, user, out.store)).notify; // write:states
      else if (out.shopping === 'end') out.notify = (await endShopping(env, user)).notify; // write:states
      return json(out);
    }
    if (path === '/api/chat' && req.method === 'GET') {
      await idleOffer(env);
      await askOnOpen(env, user); // home18 (5, 6, 7): at most one question a day, when an admin opens the chat
      return json({ messages: await chatFor(db, user) });
    }

    /* ---- the weekly plan (home20, section 16) ---- */
    if (path === '/api/plan' && req.method === 'GET') return json((await buildState(env, user)).plan);
    if (path === '/api/plan' && req.method === 'POST') {
      if (user.role === 'child') return json({ error: 'את זה משנים המבוגרים בבית. אשמח לעזור בכל דבר אחר!' }, 403); // a child sees the plan (the owner 18/10)
      const b = await body(req); const now = Date.now();
      const row = b.id != null ? await db.prepare('SELECT m.*, COALESCE(r.name, m.text) AS name FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id WHERE m.id = ?').bind(Number(b.id)).first() : null;
      if (['move', 'remove', 'skip', 'cooked'].includes(b.op) && !row) return json({ error: PLAN_GONE }, 404);
      // what the week misses for these dishes (all when none), as list lines that say which dishes they are for
      const weekLines = async (ids) => {
        const st = await buildState(env, user);
        const live = st.plan.dishes.filter((d) => d.status === 'planned');
        const { actions } = weekNeeds({ recipes: st.recipes, products: st.products, list: st.list }, live);
        const names = new Map(live.map((d) => [d.id, d.name]));
        return { st, lines: actions.filter((x) => !ids || x.for.some(([d]) => ids.includes(d))).map((x) => ({ ...x.action, plan_for: x.for, note: forDishes(x.for.map(([d]) => names.get(d))) })) };
      };
      if (b.op === 'add') {
        const day = String(b.day || '');
        if (!plannable(day, now)) return json({ error: 'day' }, 400);
        const rid = b.recipe_id != null ? Number(b.recipe_id) : null;
        if (rid != null && !(await db.prepare("SELECT id FROM recipes WHERE id = ? AND (status IS NULL OR status = '')").bind(rid).first())) return json({ error: 'המתכון לא נמצא' }, 404);
        if (rid == null && !oneLine(b.text, 60)) return json({ error: 'text' }, 400);
        const id = await addDish(db, user, { day, recipe_id: rid, text: rid == null ? b.text : null }, now);
        const { lines } = await weekLines([id]);
        return json({ ok: true, id, missing: lines.length });
      }
      if (b.op === 'list' || b.op === 'card') { // the toast's "להוסיף לרשימה" (at once), the week's (a card, as "לתכנן את השבוע" had)
        const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : null;
        const { st, lines } = await weekLines(ids);
        if (!lines.length) return json({ added: 0, proposal: null });
        if (b.op === 'card') return json({ proposal: await cardFor(env, user, st, lines, { planList: true }) });
        const r = await execute(env, user, lines.map(({ note: _n, plan_for: _p, ...a }) => a));
        await recordPlanItems(db, lines, r.items);
        return json({ added: lines.length, notify: [...await tellShoppers(env, user, r.added || []), ...await childAsked(env, user, r.added || [])] });
      }
      if (b.op === 'move') {
        const day = String(b.day || '');
        if (!plannable(day, now, -1)) return json({ error: 'day' }, 400);
        await moveDish(db, row.id, day, now);
        return json({ ok: true });
      }
      if (b.op === 'remove' || b.op === 'skip') { // "להוריד מהתכנון"; "לא" about yesterday. Asked about the list only when something would come off
        if (b.op === 'remove') await db.prepare('DELETE FROM meal_plan WHERE id = ?').bind(row.id).run();
        else await db.prepare("UPDATE meal_plan SET status = 'skipped', updated = ? WHERE id = ?").bind(now, row.id).run();
        const n = b.undo ? 0 : await releaseCount(db, user, row.id, now);
        if (!n) { await db.prepare('DELETE FROM meal_plan_items WHERE plan_id = ?').bind(row.id).run(); return json({ ok: true }); }
        return json({ ok: true, ask: unlistQuestion(row.name), yes: UNLIST_YES, no: UNLIST_NO });
      }
      if (b.op === 'unlist') { const r = await releaseDish(env, user, Number(b.id), now); return json({ ok: true, removed: r.removed }); }
      if (b.op === 'keep') { await db.prepare('DELETE FROM meal_plan_items WHERE plan_id = ?').bind(Number(b.id)).run(); return json({ ok: true }); }
      if (b.op === 'cooked') { // a dish without a recipe ("דגים"): only marked; one with a recipe goes through /api/recipes/<id>/cooked
        await db.prepare("UPDATE meal_plan SET status = 'cooked', updated = ? WHERE id = ?").bind(now, row.id).run();
        await releaseDish(env, user, row.id, now);
        return json({ ok: true });
      }
      return json({ error: 'op' }, 400);
    }

    /* ---- recipes (round 21) ---- */
    if (path === '/api/recipes' && req.method === 'POST') { // save from the form or from an idea
      const b = await body(req);
      if (!String(b.name || '').trim()) return json({ error: 'name' }, 400);
      if (!(Array.isArray(b.ings) ? b.ings.length : String(b.ingredients || '').trim())) return json({ error: 'ingredients' }, 400);
      const r = await saveRecipe(db, user, b);
      if (r.suggested) { // the grown-ups hear it in the approved words ("{שם} הציע / הציעה מתכון: {…}. האם לשמור?", r8z question 31)
        const adults = (await db.prepare("SELECT id FROM users WHERE active = 1 AND role != 'child'").all()).results.map((u) => u.id);
        r.notify = await pushOthers(env, user, { title: 'שוקי', body: `${user.name} ${byPerson(user, 'הציע', 'הציעה', 'הציעו')} מתכון: ${String(b.name).trim().slice(0, 80)}. האם לשמור?`, url: './#recipes' }, adults, 'requests');
      }
      return json(r);
    }
    if (path === '/api/recipes/read' && req.method === 'POST') return json(await recipeFromInput(env, user, await body(req)));
    if (path === '/api/recipes/ideas' && req.method === 'POST') { const b = await body(req); return json(await recipeIdeas(env, user, await buildState(env, user), Array.isArray(b.not) ? b.not.slice(0, 12).map((x) => oneLine(x, 80)).filter(Boolean) : [])); }
    if (path === '/api/recipes/plan' && req.method === 'POST') {
      const b = await body(req); const st = await buildState(env, user);
      const chosen = st.recipes.filter((r) => !r.status && (b.ids || []).map(Number).includes(r.id));
      return json(await planCard(env, user, st, chosen));
    }
    const rm = /^\/api\/recipes\/(\d+)(?:\/(edit|delete|approve|cooked|missing|photo|favorite))?$/.exec(path);
    if (rm) {
      const id = Number(rm[1]); const verb = rm[2];
      if (verb === 'photo' && req.method === 'GET') {
        const r = await db.prepare('SELECT data FROM recipe_photos WHERE recipe_id = ?').bind(id).first();
        return r ? new Response(Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000' } }) : json({ error: 'אין תמונה' }, 404);
      }
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      const b = await body(req);
      const row = await db.prepare('SELECT id, status, suggested_by FROM recipes WHERE id = ?').bind(id).first();
      if (!row) return json({ error: 'המתכון לא נמצא' }, 404);
      const adult = user.role !== 'child';
      const ownWaiting = row.status === 'suggested' && row.suggested_by === user.id; // a child changes only their own suggestion, before it's approved
      if (verb === 'delete') { if (!adult && !ownWaiting) return json({ error: 'את זה משנים המבוגרים בבית. אשמח לעזור בכל דבר אחר!' }, 403); await deleteRecipe(db, id); return json({ ok: true }); }
      if (verb === 'approve') {
        if (!adult) return json({ error: 'את זה משנים המבוגרים בבית. אשמח לעזור בכל דבר אחר!' }, 403);
        if (b.yes) await db.prepare('UPDATE recipes SET status = NULL WHERE id = ?').bind(id).run(); else await deleteRecipe(db, id);
        return json({ ok: true });
      }
      if (verb === 'edit') { if (!adult && !ownWaiting) return json({ error: 'את זה משנים המבוגרים בבית. אשמח לעזור בכל דבר אחר!' }, 403); return json(await editRecipe(db, id, b, user)); }
      if (verb === 'favorite') { // ג10: the star on the recipe page, the grown-ups'
        if (!adult) return json({ error: 'את זה משנים המבוגרים בבית. אשמח לעזור בכל דבר אחר!' }, 403);
        if (row.status === 'suggested') return json({ error: 'קודם צריך לאשר את המתכון' }, 400);
        await db.prepare('UPDATE recipes SET favorite = ? WHERE id = ?').bind(b.on ? 1 : 0, id).run();
        return json({ ok: true });
      }
      const st = await buildState(env, user); const recipe = st.recipes.find((r) => r.id === id);
      const people = Number(b.people) > 0 && Number(b.people) < 100 ? Math.round(b.people) : null;
      if (verb === 'cooked') {
        // home20: the planned dish it was made for (the week's "הכנו את זה", "כן, הכנו" about yesterday: made yesterday evening)
        const dish = b.plan != null && (await db.prepare("SELECT id, day FROM meal_plan WHERE id = ? AND recipe_id = ? AND status != 'cooked'").bind(Number(b.plan), id).first());
        const at = dish && dish.day < todayOf(Date.now()) ? Math.min(Date.now(), Date.parse(`${dish.day}T17:00:00Z`)) : undefined;
        const r = await cookedCard(env, user, st, recipe, people, { plan: dish?.id, at });
        if (!r.proposal) { const done = await countCooked(db, id, user.id, at, dish?.id ?? null); if (done) await releaseDish(env, user, done); } // nothing to take off: it still counts
        return json(r);
      }
      if (verb === 'missing') { // "להוסיף את מה שחסר לרשימה": straight onto the list
        const actions = missingActions(st, [recipe], people);
        if (!actions.length) return json({ added: 0 });
        const r = await execute(env, user, actions);
        if (r.error) return json(r, 400);
        return json({ added: actions.length, notify: [...await tellShoppers(env, user, r.added || []), ...await childAsked(env, user, r.added || [])] });
      }
    }

    const pm = /^\/api\/proposals\/([\w-]+)\/(apply|reject)$/.exec(path);
    if (pm && req.method === 'POST') {
      const b = await body(req);
      const r = await applyProposal(env, user, pm[1], pm[2], b); // write:card
      if (r.status === 'applied' && r.added?.length) r.notify = [...await tellShoppers(env, user, r.added), ...await childAsked(env, user, r.added)]; // write:shoppers
      if (r.status === 'applied' && r.ranOut?.length) (r.notify ||= []).push(...await tellResponsible(env, user, r.ranOut, r.added)); // מ19 // write:responsible
      for (const t of r.status === 'applied' ? r.tell || [] : []) (r.notify ||= []).push(...await pushOthers(env, user, { title: `${user.name} ${byPerson(user, 'מבקש', 'מבקשת', 'מבקשים')}`, body: t.text, url: './#chat' }, t.to, 'messages')); // write:tell
      return json(r);
    }

    /* ---- tests only: an empty house between scenarios (the variable is never set in production) ---- */
    if (path === '/api/__recipes' && req.method === 'POST' && env.TEST_RESET === '1') { // tests only: saved recipes to start from
      const b = await body(req);
      for (const x of b.recipes || []) await db.prepare('INSERT INTO recipes (id, name, ingredients, text, tags, serves, added_by, added) VALUES (?,?,?,?,?,?,?,?)').bind(newId(), String(x.name), String(x.ingredients || ''), String(x.text || ''), x.tags || null, x.serves || null, user.id, Date.now()).run();
      return json({ ok: true });
    }
    if (path === '/api/__schedule' && req.method === 'POST' && env.TEST_RESET === '1') { // tests only: the hourly run at a chosen time
      const b = await body(req);
      return json(await runSchedule(env, Number(b.now) || Date.now()));
    }
    if (path === '/api/__reset' && req.method === 'POST' && env.TEST_RESET === '1') {
      await db.batch(['house_guests', 'chat', 'proposals', 'list_items', 'batches', 'product_log', 'events', 'maybe', 'shopping', 'away', 'product_photos', 'receipt_aliases', 'recipes', 'recipe_ingredients', 'recipe_photos', 'cooked_log', 'meal_plan', 'meal_plan_items', 'lessons', 'facts', 'routines', 'leftovers', 'noticed', 'connectors', 'products'].map((t) => db.prepare(`DELETE FROM ${t}`)).concat([
        db.prepare("DELETE FROM settings WHERE key NOT IN ('digest_hour', 'house_name', 'tz', 'vapid', 'anthropic_key', 'openai_key', 'provider')"),
        // people added by the last scenario go; the two of the fixture stay
        db.prepare('DELETE FROM devices WHERE user_id > 2'), db.prepare('DELETE FROM pairing_codes WHERE user_id > 2'), db.prepare('DELETE FROM users WHERE id > 2'),
        db.prepare("UPDATE users SET active = 1, role = CASE id WHEN 1 THEN 'admin' ELSE 'member' END WHERE id <= 2"),
      ]));
      return json({ ok: true });
    }

    /* ---- product photos ---- */
    const ph = /^\/api\/photo\/(\d+)$/.exec(path);
    if (ph) {
      const id = Number(ph[1]);
      if (req.method === 'GET') {
        const r = await db.prepare('SELECT data FROM product_photos WHERE product_id = ? AND product_id IN (SELECT id FROM products WHERE private_to IS NULL OR private_to = ?)').bind(id, user.id).first(); // not another's private product (0b)
        if (!r) return json({ error: 'אין תמונה' }, 404);
        const bin = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
        return new Response(bin, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000' } });
      }
      if (!(await db.prepare('SELECT id FROM products WHERE id = ? AND deleted IS NULL AND (private_to IS NULL OR private_to = ?)').bind(id, user.id).first())) return json({ error: 'מוצר לא נמצא' }, 404);
      if (req.method === 'POST') {
        const { data } = await body(req);
        if (typeof data !== 'string' || data.length > 90000 || !/^\/9j\/[A-Za-z0-9+/=]+$/.test(data)) return json({ error: 'תמונה לא תקינה' }, 400); // small JPEG only
        return json({ ok: true, photo: await savePhoto(env, id, data) });
      }
      if (req.method === 'DELETE') {
        await db.batch([db.prepare('DELETE FROM product_photos WHERE product_id = ?').bind(id), db.prepare('UPDATE products SET photo = NULL WHERE id = ?').bind(id)]);
        return json({ ok: true });
      }
    }

    /* ---- "check": can Shuki think again? ---- */
    if (path === '/api/brain/check' && req.method === 'POST') {
      if (!llmKey(env)) return json({ ok: false, error: 'אין לי מפתח של Claude או ChatGPT. מוסיפים אותו בהגדרות → הבית.' });
      const t = await testKey(env, llmKey(env), providerOf(env));
      if (t.ok) await db.prepare("DELETE FROM settings WHERE key = 'brain_error'").run();
      return json(t);
    }

    /* ---- the people in the house (the admin adds, renames, removes; everyone can fix their own name) ---- */
    if (path === '/api/members' && req.method === 'POST') {
      const b = await body(req);
      const now = Date.now();
      const code = async (uid) => { const c = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); await db.prepare('INSERT OR REPLACE INTO pairing_codes (code, user_id, expires, used, created) VALUES (?, ?, ?, NULL, ?)').bind(c, uid, now + 7 * DAY, now).run(); return { code: c, expires: now + 7 * DAY }; };
      if (b.add) {
        if (!admin) return json({ error: 'רק מנהל הבית מוסיף אנשים' }, 403);
        const r = await addMember(db, b.add, now);
        return r.error ? json(r, 400) : json({ ok: true, ...r });
      }
      const target = b.id != null ? await db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').bind(Number(b.id)).first() : null;
      if (!target) return json({ error: 'אין בבית מישהו כזה' }, 404);
      const admins = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND role = 'admin'").first()).n;
      if (b.edit) {
        if (!admin && target.id !== user.id) return json({ error: 'רק מנהל הבית משנה פרטים של אחרים' }, 403);
        const name = b.edit.name != null ? cleanName(b.edit.name) : target.name;
        if (!name) return json({ error: 'מה השם?' }, 400);
        if (name !== target.name && (await db.prepare('SELECT id FROM users WHERE name = ? AND id != ?').bind(name, target.id).first())) return json({ error: `השם ${name} כבר תפוס` }, 400);
        const gender = GENDERS.includes(b.edit.gender) ? b.edit.gender : target.gender;
        await db.prepare('UPDATE users SET name = ?, gender = ? WHERE id = ?').bind(name, gender, target.id).run();
        return json({ ok: true });
      }
      if (b.role) {
        if (!admin) return json({ error: 'רק מנהל הבית יכול לשנות את זה' }, 403);
        if (!['admin', 'member', 'child'].includes(b.role)) return json({ error: 'תפקיד לא מוכר' }, 400);
        if (b.role !== 'admin' && target.role === 'admin' && admins <= 1) return json({ error: 'צריך שיישאר לפחות מנהל אחד' }, 400);
        await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(b.role, target.id).run();
        return json({ ok: true });
      }
      if (b.remove) {
        // r13l (15/10): everyone may leave by themself, the same as the admin taking them out
        if (!admin && target.id !== user.id) return json({ error: 'רק מנהל הבית מוציא מהבית' }, 403);
        if (target.role === 'admin' && admins <= 1) return json({ error: 'אי אפשר להוציא את המנהל היחיד. קודם מעבירים ניהול למישהו אחר' }, 400);
        // the name stays in the history; the phones and codes go
        await db.batch([
          ...await outOfHouse(env, target, user, now),
          // their chat and their assistants' threads go (r11 q015)
          db.prepare('DELETE FROM chat WHERE thread = ? OR thread IN (SELECT -id FROM connectors WHERE user_id = ?)').bind(target.id, target.id),
          db.prepare("UPDATE users SET active = 0, role = 'member' WHERE id = ?").bind(target.id),
          db.prepare('DELETE FROM devices WHERE user_id = ?').bind(target.id),
          db.prepare('DELETE FROM pairing_codes WHERE user_id = ?').bind(target.id),
          db.prepare('DELETE FROM settings WHERE key IN (?, ?, ?)').bind(`ask:${target.id}`, `askq:${target.id}`, `eating:${target.id}`), // their waiting questions go with them (64), and פ5's mark
          // when they left: a restore from a copy made before it gives nothing private back, even if they (or someone with their
          // name) came back since (the owner 08/10, question 105); 30 days, like `removed`, longer than the copies (7)
          db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`left:${target.id}`, String(now)),
          db.prepare('DELETE FROM connectors WHERE user_id = ?').bind(target.id), // and the other assistants they connected
        ]);
        await forgetPrivate(db, target.id); // their private products, quietly
        await forgetPerson(db, target.id); // what Shuki knew about them goes for real (r11 q015)
        await forgetMarks(db, target.id); // and his own marks about them (stage 8, question 21)
        await (await freeName(db, target.id))?.run(); // the name is free for someone new, with a new id (stage 13, d4); after the above, which look for it
        // one card about what was theirs (every house since stage 9, מ1); what's ticked leaves the stock, the rest becomes shared (decision 86)
        const theirs = (await db.prepare('SELECT id, name FROM products WHERE owner = ? AND deleted IS NULL ORDER BY name').bind(target.id).all()).results;
        // who left by themself: the card goes to an admin who stays (r13l)
        const decider = target.id !== user.id ? user : await db.prepare("SELECT id FROM users WHERE active = 1 AND role = 'admin' ORDER BY id LIMIT 1").first();
        if (theirs.length && decider) {
          const id = crypto.randomUUID();
          await db.batch([
            db.prepare('INSERT INTO proposals (id, user_id, created, actions) VALUES (?,?,?,?)').bind(id, decider.id, now, JSON.stringify({ actions: theirs.map((p) => ({ kind: 'delete', product_id: p.id })), context: 'report', share: target.id })),
            ...chatRows(db, now, null, 'shuki', { reply: `${target.name} ${byPerson(target, 'יצא', 'יצאה', 'יצאו')} מהבית. מה עושים עם הדברים ${byPerson(target, 'שלו', 'שלה', 'שלהם')}? מה שתסמנו יירד מהמלאי והשאר יהיה משותף.`, face: 'neutral', for: decider.id, status: 'pending', proposal: { id, status: 'pending', lines: theirs.map((p) => ({ icon: 'delete', text: `${p.name} — להוריד מהמלאי` })) } }),
          ]);
        }
        return json({ ok: true, self: target.id === user.id, ...(theirs.length && decider && { card: true }) });
      }
      if (b.code) {
        if (!admin && target.id !== user.id) return json({ error: 'רק מנהל הבית יוצר קודים לאחרים' }, 403);
        if (target.id !== user.id && target.role === 'child' && (await hasPhone(db, target.id))) return json({ error: phoneTaken(target, user) }, 409); // stage 13, d3; a grown-up's second phone is allowed (16/10: an iPhone home-screen app keeps its own data, apart from Safari), and the "טלפון חדש" line still reaches them
        return json({ ok: true, ...(await code(target.id)) });
      }
      return json({ error: 'לא הבנתי את הבקשה. האם אפשר לנסות שוב?' }, 400);
    }

    /* ---- phones: a new or replaced phone gets a code from here; a lost one is disconnected from here ---- */
    if (path === '/api/devices' && req.method === 'GET') {
      const rows = (await db.prepare('SELECT d.id, d.name, d.kind, d.created, d.last_seen, d.user_id, u.name AS who FROM devices d JOIN users u ON u.id = d.user_id WHERE u.active = 1 ORDER BY d.user_id, d.created').all()).results;
      return json({ devices: rows.map((d) => ({ ...d, mine: d.id === user.device_id })), onlyPhone: await lastAdminPhone(db, user.device_id) });
    }
    if (path === '/api/devices/code' && req.method === 'POST') {
      const b = await body(req);
      const uid = Number(b.user_id);
      const target = await db.prepare('SELECT id, name, gender, role FROM users WHERE id = ? AND active = 1').bind(uid).first();
      if (!target) return json({ error: 'אין בבית מישהו כזה' }, 400);
      if (uid !== user.id && !admin) return json({ error: 'רק מנהל הבית יוצר קודים לאחרים' }, 403);
      if (uid !== user.id && target.role === 'child' && (await hasPhone(db, uid))) return json({ error: phoneTaken(target, user) }, 409); // stage 13, d3: only a child's (16/10)
      const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      const expires = Date.now() + DAY;
      await db.prepare('INSERT OR REPLACE INTO pairing_codes (code, user_id, expires, used, created) VALUES (?, ?, ?, NULL, ?)').bind(code, uid, expires, Date.now()).run();
      return json({ code, expires });
    }
    const dv = /^\/api\/devices\/(\d+)$/.exec(path);
    if (dv && req.method === 'DELETE') {
      const id = Number(dv[1]);
      if (id === user.device_id) return json({ error: 'את המכשיר הזה מנתקים מ"ניתוק המכשיר"' }, 400);
      const dev = await db.prepare('SELECT user_id FROM devices WHERE id = ?').bind(id).first();
      if (dev && dev.user_id !== user.id && !admin) return json({ error: 'רק מנהל הבית מנתק מכשירים של אחרים' }, 403);
      if (await lastAdminPhone(db, id)) return json({ error: 'זה הטלפון היחיד של מנהל בבית, ואין עוד מנהל עם טלפון' }, 409);
      await db.prepare('DELETE FROM devices WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    /* ---- Shuki's wardrobe (mine) ---- */
    if (path === '/api/outfit' && req.method === 'POST') {
      const b = await body(req);
      const xp = xpOf((await xpQuery(db, user.id).all()).results, HOUSE.tz);
      const level = growth(xp).level;
      const wear = cleanOutfit(b.wear || {}, level);
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`outfit:${user.id}`, JSON.stringify({ level, wear })).run();
      return json({ ok: true, wear });
    }

    /* ---- errors from the phones, into Workers Logs ---- */
    if (path === '/api/log' && req.method === 'POST') {
      const b = await body(req);
      console.error('client', user.id, String(b.where || '').slice(0, 40), String(b.msg || '').slice(0, 500), String(b.ua || '').slice(0, 160));
      return json({ ok: true });
    }

    /* ---- "a little left" of a non-basic product: to the list, remind me in a few days, or not needed ---- */
    if (path === '/api/low' && req.method === 'POST') {
      const b = await body(req);
      const p = await db.prepare('SELECT *, COALESCE(shop, store) AS store FROM products WHERE id = ? AND deleted IS NULL AND (private_to IS NULL OR private_to = ?)').bind(Number(b.id), user.id).first();
      if (!p) return json({ error: 'מוצר לא נמצא' }, 404);
      const now = Date.now();
      if (b.decision === 'list') { const r = await execute(env, user, [{ kind: 'list_add', product_id: p.id }]); return json({ ok: true, notify: await tellShoppers(env, user, r.added) }); }
      if (b.decision === 'remind') {
        const days = Math.min(30, Math.max(1, Number(b.days) || 3));
        await db.prepare("INSERT INTO maybe (text, product_id, store, added_by, added, due_at, kind, private_to) VALUES (?,?,?,?,?,?, 'remind', ?)").bind(p.name, p.id, p.store, user.id, now, now + days * DAY, p.private_to ?? null).run(); // a private product's: private too
        return json({ ok: true, at: now + days * DAY });
      }
      if (b.decision === 'no') { await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`lowok:${p.id}`, String(p.updated)).run(); return json({ ok: true }); }
      return json({ error: 'בחירה לא מוכרת' }, 400);
    }

    /* ---- "let's think about it" ---- */
    if (path === '/api/maybe' && req.method === 'POST') {
      const b = await body(req);
      if (b.id) { // decide: list | drop
        const m = await db.prepare('SELECT * FROM maybe WHERE id = ? AND decided IS NULL').bind(Number(b.id) || 0).first();
        if (!m || !(await maybeSeen(db, user, m))) return json({ error: 'מישהו כבר טיפל בזה' }, 404);
        if (!['list', 'drop'].includes(b.decision)) return json({ error: 'בחירה לא מוכרת' }, 400);
        let r = {};
        // the product may have been deleted in the two days it waited: then it goes on the list as text
        const alive = m.product_id && (await db.prepare('SELECT id FROM products WHERE id = ? AND deleted IS NULL').bind(m.product_id).first());
        // a private reminder's line is private too (private_to, migration 0024; the reviewer, 04/10)
        const own = m.private_to != null ? { private: true } : {};
        if (b.decision === 'list') r = await execute(env, user, [alive ? { kind: 'list_add', product_id: m.product_id, store: m.store, ...own } : { kind: 'list_add', text: m.text, store: m.store, ...own }]);
        await db.prepare('UPDATE maybe SET decided = ?, decision = ? WHERE id = ?').bind(Date.now(), b.decision, m.id).run();
        // gave up on a reminder about something running low: don't ask about it again until it changes
        if (b.decision === 'drop' && alive) { const pu = await db.prepare('SELECT updated FROM products WHERE id = ?').bind(m.product_id).first(); if (pu) await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`lowok:${m.product_id}`, String(pu.updated)).run(); }
        const notify = b.decision === 'list' ? await tellShoppers(env, user, r.added) : [];
        return json({ ok: true, notify });
      }
      const text = String(b.text || '').trim().slice(0, 80);
      if (!text) return json({ error: 'לא קיבלתי כלום. האם אפשר לכתוב שוב?' }, 400);
      const mp = b.product_id ? (await db.prepare('SELECT id, private_to FROM products WHERE id = ? AND deleted IS NULL AND (private_to IS NULL OR private_to = ?)').bind(b.product_id, user.id).first()) : null;
      // private (migration 0024): a private product's, or a name from the fixed list / "only me", as a list line would be
      const mto = mp?.private_to ?? privateFor(user, b, text);
      await db.prepare('INSERT INTO maybe (text, product_id, store, added_by, added, private_to) VALUES (?,?,?,?,?,?)').bind(text, mp?.id ?? null, STORE_NAMES[b.store] ? b.store : 'super', user.id, Date.now(), mto ?? null).run();
      return json({ ok: true });
    }

    /* ---- away ---- */
    // hosting a meal (round 20 review): a hosting list that closes by itself after the meal
    if (path === '/api/hosting' && req.method === 'POST') {
      const b = await body(req);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) return json({ error: 'מתי הארוחה?' }, 400);
      const n = Math.round(+b.people || 0);
      const store = await ensureHosting(env, { name: n > 1 && n < 100 ? `ארוחה ל-${n}` : 'ארוחה', date: b.date });
      return json({ store });
    }
    if (path === '/api/away' && req.method === 'POST') {
      const b = await body(req);
      return json(await setAway(env, user, b.until, b.from, b.end, b.kind));
    }

    /* ---- Siri / Shortcuts ---- */
    if (path === '/api/shortcut/token' && req.method === 'POST') {
      // one key per person; making a new one retires the old one
      const t = randomToken(); const now = Date.now();
      await db.batch([
        db.prepare("DELETE FROM devices WHERE user_id = ? AND kind = 'shortcut'").bind(user.id),
        db.prepare("INSERT INTO devices (user_id, token_hash, name, kind, created, last_seen) VALUES (?,?,?,?,?,?)").bind(user.id, await sha256(t), 'סירי (קיצורי דרך)', 'shortcut', now, now),
      ]);
      return json({ token: t });
    }
    if (path === '/api/say' && req.method === 'POST') {
      // "Hey Siri, Shuki" → dictated text → here. Answers in plain text, for Siri to read out.
      const b = await body(req);
      if (!String(b.text || '').trim()) return new Response('לא שמעתי כלום. האם אפשר לנסות שוב?', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      const out = await chat(env, user, { text: b.text }, await buildState(env, user)); // write:turn
      if (out.shopping === 'start') await startShopping(env, user, out.store); // write:states
      else if (out.shopping === 'end') await endShopping(env, user); // write:states
      let say = out.reply || '';
      let pushed = 0, pushBody = null;
      if (out.proposal) {
        const waits = `ההצעה מחכה לאישור ${byPerson(user, 'שלך', 'שלך', 'שלכם')} באפליקציה.`;
        say += ` ${waits}`;
        // a card with something private on it: no product's name on a locked screen (decision 3, the owner 06/10, r7b), the words Siri says
        pushBody = out.proposal.lines.some((l) => l.mine) ? waits : out.proposal.lines.map((l) => l.text).slice(0, 4).join(' · ');
        pushed = (await pushMine(env, user, { title: 'האם לאשר?', body: pushBody, url: './#chat' })).length;
      }
      return new Response(say, { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-shuki-pushed': String(pushed), ...(env.TEST_RESET === '1' && pushBody && { 'x-shuki-push-body': encodeURIComponent(pushBody) }) } }); // the body, for the tests only
    }
    if (path === '/api/shortcut/shop' && req.method === 'POST') {
      // arrived at the store (a Shortcuts automation): open shopping mode and read back the list
      const b = await body(req);
      const r = await startShopping(env, user, b.store);
      const S = await loadAll(db, user);
      const names = S.items.filter((i) => i.status === 'open' && !i.ordered && i.store === r.store).map((i) => (i.product_id ? S.products.find((p) => p.id === i.product_id)?.name : i.text)).filter(Boolean);
      const list = names.length ? `ברשימה: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` ועוד ${names.length - 8}` : ''}.` : 'הרשימה ריקה!';
      return new Response(`פתחתי מצב קניות ב${STORE_NAMES[r.store]}. ${list}`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    if (path === '/api/suggest' && req.method === 'POST') { // א5: the card is done for today, either button
      if (user.role === 'child') return json({ error: 'את זה משנים המבוגרים בבית. אשמח לעזור בכל דבר אחר!' }, 403);
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`suggest_day:${user.id}`, local(Date.now(), HOUSE.tz).date).run();
      return json({ ok: true });
    }
    if (path === '/api/settings' && req.method === 'POST') {
      const b = await body(req);
      // a child changes only their own notifications; the rest is the house's
      if (user.role === 'child' && ['digest_hour', 'locations', 'addCategory', 'addStore', 'removeStore', 'pesach', 'deleteRecipe'].some((k) => b[k] != null)) return json({ error: 'את זה משנים המבוגרים בבית. אשמח לעזור בכל דבר אחר!' }, 403);
      const stmts = [];
      // the hour of the daily summary: a whole hour, 0–23 (anything else used to stop the summary quietly: Q-5)
      if (b.digest_hour != null) {
        const h = Number(b.digest_hour);
        if (!Number.isInteger(h) || h < 0 || h > 23) return json({ error: 'בחירה לא מוכרת' }, 400);
        stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('digest_hour', ?)").bind(String(h)));
      }
      if (Array.isArray(b.locations)) for (const l of b.locations) {
        if (!l || typeof l !== 'object' || typeof (l.name ?? '') !== 'string') continue; // Q-2: only a name and a number
        if (l.id && !String(l.name || '').trim()) continue; // a place needs a name
        if (l.id) stmts.push(db.prepare('UPDATE locations SET name = ?, sort = ? WHERE id = ?').bind(String(l.name).slice(0, 40), Number(l.sort) || 0, Number(l.id) || 0));
        else if (l.name) stmts.push(db.prepare('INSERT OR IGNORE INTO locations (name, sort) VALUES (?, ?)').bind(String(l.name).slice(0, 40), Number(l.sort ?? 50) || 0));
      }
      if (b.addCategory) stmts.push(db.prepare('INSERT OR IGNORE INTO categories (name, sort) VALUES (?, 50)').bind(String(b.addCategory).slice(0, 40)));
      // the household's own stores (a butcher, a deli): tabs on the list, a store for products
      const extra = extraStores(); // ב7: a hosting's guests' note stays
      if (b.addStore != null) {
        const name = cleanStoreName(b.addStore);
        if (!name) return json({ error: 'לחנות צריך שם' }, 400);
        if (Object.values(STORE_NAMES).some((n) => n === name) || ['סופר', 'פארם', 'ירקן'].includes(name)) return json({ error: 'כבר יש חנות כזו' }, 400);
        if (extra.filter((x) => !x.until).length >= 5) return json({ error: 'אפשר עד 5 חנויות משלכם' }, 400);
        extra.push({ id: `s${Date.now().toString(36)}`, name });
        stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('stores', ?)").bind(JSON.stringify(extra)));
      }
      if (b.removeStore != null) {
        const id = String(b.removeStore);
        if (BASE_STORES.includes(id) || !extra.some((x) => x.id === id)) return json({ error: 'אי אפשר למחוק את החנות הזו' }, 400);
        // what was bought there goes back to the supermarket
        stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('stores', ?)").bind(JSON.stringify(extra.filter((x) => x.id !== id))),
          db.prepare('UPDATE products SET shop = NULL WHERE shop = ?').bind(id),
          db.prepare("UPDATE list_items SET store = 'super' WHERE store = ?").bind(id), db.prepare("UPDATE maybe SET store = 'super' WHERE store = ?").bind(id),
          db.prepare("UPDATE shopping SET store = 'super' WHERE store = ? AND ended IS NULL").bind(id));
      }
      if (b.notify && typeof b.notify === 'object') { // my own notifications
        const cur = notifyPrefs(Object.fromEntries((await db.prepare('SELECT key, value FROM settings WHERE key = ?').bind(`notify:${user.id}`).all()).results.map((x) => [x.key, x.value])), user.id);
        for (const k of NOTIFY_KINDS) if (k in b.notify) cur[k] = !!b.notify[k];
        stmts.push(db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`notify:${user.id}`, JSON.stringify(cur)));
      }
      // home18 (5): where the house buys produce and care (the answer to Shuki's question, changed here); its products move with it
      for (const k of ['produce', 'care']) if (b[`shop_${k}`] != null) {
        if (!admin) return json({ error: 'רק מנהל הבית משנה את זה' }, 403);
        if (!Object.values(SHOP_Q[k].options).includes(b[`shop_${k}`])) return json({ error: 'בחירה לא מוכרת' }, 400);
        await applyShop(db, k, b[`shop_${k}`]);
      }
      if (b.house_name != null || b.tz != null || b.anthropicKey != null || b.house_mode != null || b.house_notes != null) {
        if (b.house_mode != null) { if (!admin) return json({ error: 'רק מנהל הבית משנה את זה' }, 403); stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_mode', ?)").bind(b.house_mode === 'roommates' ? 'roommates' : 'family')); }
        if (b.house_notes != null) { if (!admin) return json({ error: 'רק מנהל הבית משנה את זה' }, 403); stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_notes', ?)").bind(String(b.house_notes).slice(0, 600))); }
        if (!admin) return json({ error: 'רק מנהל הבית משנה את זה' }, 403);
        if (b.house_name != null) { const n = String(b.house_name).trim().slice(0, 40); if (!n) return json({ error: 'לבית צריך שם' }, 400); stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_name', ?)").bind(n)); }
        if (b.tz != null) { if (!validTz(b.tz)) return json({ error: 'אזור זמן לא מוכר' }, 400); stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tz', ?)").bind(b.tz)); }
        if (b.anthropicKey != null) { // the name stays for old apps; any key works: "sk-ant-..." Claude, "sk-..." ChatGPT
          const k = String(b.anthropicKey).trim();
          if (!k) stmts.push(db.prepare("DELETE FROM settings WHERE key IN ('anthropic_key', 'openai_key', 'provider')"));
          // decision 172: a Claude key and a ChatGPT key can both be kept; the newest one is the main one
          else { const t = await testKey(env, k); if (!t.ok) return json({ error: t.error }, 400); stmts.push(db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`${t.provider}_key`, k), db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider', ?)").bind(t.provider), db.prepare("DELETE FROM settings WHERE key = 'brain_error'")); }
        }
      }
      if (b.dropKey != null || b.primary != null) {
        if (!admin) return json({ error: 'רק מנהל הבית משנה את זה' }, 403);
        const which = b.dropKey ?? b.primary;
        if (!['anthropic', 'openai'].includes(which)) return json({ error: 'ספק לא מוכר' }, 400);
        const other = which === 'anthropic' ? 'openai' : 'anthropic';
        if (b.dropKey != null) {
          stmts.push(db.prepare('DELETE FROM settings WHERE key = ?').bind(`${which}_key`));
          if (providerOf(env) === which) stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider', ?)").bind(other));
        } else {
          if (!(which === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY)) return json({ error: 'אין מפתח כזה' }, 400);
          stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('provider', ?)").bind(which));
        }
      }
      if (b.costCap != null) {
        if (!admin) return json({ error: 'רק מנהל הבית משנה את זה' }, 403);
        const c = Math.round(Number(b.costCap) * 100) / 100;
        if (!(c >= 1 && c <= 1000)) return json({ error: 'תקרה בין $1 ל-$1000' }, 400);
        stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cost_cap', ?)").bind(String(c)), db.prepare("DELETE FROM settings WHERE key = 'cost_warned'"));
      }
      if (b.deleteRecipe != null) await deleteRecipe(db, Number(b.deleteRecipe));
      let chametz;
      if (b.pesach != null) {
        stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pesach', ?)").bind(b.pesach ? '1' : '0'));
        if (b.pesach) { chametz = await markChametz(env, user); await askKitniyot(env, user); }
      }
      if (stmts.length) await db.batch(stmts);
      // Passover is over (r10 q055, r0t r10-8): the regular chametz that ran out or is short goes back on the list at once
      let back = 0;
      if (b.pesach === false) back = await pesachOff(env);
      return json({ ok: true, ...(chametz && { chametz }), ...(back && { chametzBack: back }) });
    }

    if (path === '/api/push/subscribe' && req.method === 'POST') {
      const { subscription: s, on } = await body(req);
      if (s && (!s.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth)) return json({ error: 'המנוי להתראות לא תקין' }, 400);
      await db.prepare('UPDATE devices SET push_sub = COALESCE(?, push_sub), push_on = ? WHERE id = ?')
        .bind(s ? JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }) : null, on === false ? 0 : 1, user.device_id).run();
      return json({ ok: true });
    }
    if (path === '/api/push/test' && req.method === 'POST') {
      const d = await db.prepare('SELECT push_sub FROM devices WHERE id = ?').bind(user.device_id).first();
      if (!d?.push_sub) return json({ error: 'ההתראות לא הופעלו בטלפון הזה' }, 404);
      const status = await push(env, JSON.parse(d.push_sub), { title: 'שוקי', body: 'היי! ההתראות עובדות', url: './#chat' }).catch(() => 0);
      return json({ ok: status >= 200 && status < 300, status });
    }

    if (path === '/api/export' && req.method === 'GET') {
      return new Response(JSON.stringify(await exportHouse(db, user), null, 1), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="shuki-${local(Date.now(), HOUSE.tz).date}.json"` },
      });
    }
    if (path === '/api/export.csv' && req.method === 'GET') {
      const what = url.searchParams.get('what') === 'history' ? 'history' : 'inventory';
      return new Response(await exportCsv(db, what, HOUSE.tz, user), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="shuki-${what}-${local(Date.now(), HOUSE.tz).date}.csv"` } });
    }
    if (path === '/api/house/delete' && req.method === 'POST') {
      // the admin types the house's name; everything goes, and the next visit starts a new setup
      if (!admin) return json({ error: 'רק מנהל הבית יכול למחוק את הבית' }, 403);
      const b = await body(req);
      if (String(b.name || '').trim() !== (HOUSE.name || '').trim()) return json({ error: 'השם לא תואם לשם הבית' }, 400);
      await deleteHouse(db);
      return json({ ok: true });
    }
    if (path === '/api/backups' && req.method === 'GET') {
      if (!admin) return json({ error: 'רק מנהל הבית יכול לשחזר' }, 403);
      return json({ backups: await listBackups(db) });
    }
    if (path === '/api/backups/restore' && req.method === 'POST') {
      if (!admin) return json({ error: 'רק מנהל הבית יכול לשחזר' }, 403);
      const b = await body(req);
      const r = await restoreDay(env, String(b.day || ''));
      await db.prepare("INSERT INTO events (id, ts, user_id, type, summary) VALUES (?,?,?,'restore',?)").bind(newId(), Date.now(), user.id, `${user.name} ${byPerson(user, 'החזיר', 'החזירה', 'החזירו')} את הבית לגיבוי מ-${String(b.day).startsWith('before:') ? 'לפני השחזור' : String(b.day).split('-').reverse().slice(0, 2).map(Number).join('.')}`).run();
      return json({ ok: true, ...r });
    }
    if (path === '/api/feedback' && req.method === 'POST') {
      const b = await body(req);
      return json(await saveFeedback(env, user, Number(b.chat_id), b.note, b.up ? '' : catalogFor(await buildState(env, user)), b.up ? 'up' : 'down'));
    }
    if (path === '/api/leftovers' && req.method === 'POST') {
      // "is Sunday's pasta still in the fridge?": gone, or still there (asked again in three days)
      const b = await body(req);
      // "נשארו שאריות" after "הכנו את זה" on a recipe's page (round 21): a new one, named after the recipe
      if (b.id == null && String(b.text || '').trim()) { await db.prepare('INSERT INTO leftovers (text, made, added_by, kosher_kind) VALUES (?,?,?,?)').bind(oneLine(b.text, 60), Date.now(), user.id, await leftoverKind(db, b.text, Date.now())).run(); /* מ18: also after "הכנו" in the app */ return json({ ok: true }); }
      await db.prepare(b.gone ? 'UPDATE leftovers SET gone = ? WHERE id = ?' : 'UPDATE leftovers SET asked = ? WHERE id = ?').bind(Date.now(), Number(b.id)).run();
      return json({ ok: true });
    }
    if (path === '/api/routines' && req.method === 'POST') {
      // "every week" in the settings: a grown-up stops a weekly buy
      if (user.role === 'child') return json({ error: 'רק מבוגר משנה קניות קבועות' }, 403);
      const b = await body(req);
      const r = await db.prepare('SELECT * FROM routines WHERE id = ?').bind(Number(b.id)).first();
      if (r && (await maybeSeen(db, user, r))) await db.prepare('DELETE FROM routines WHERE id = ?').bind(r.id).run(); // another's private one: as if it isn't there (0b)
      return json({ ok: true });
    }
    if (path === '/api/connectors' && req.method === 'POST') {
      // decision 145: my own secret address for another assistant. Shown once; only its hash is kept.
      const b = await body(req);
      if (b.delete) { await db.prepare('DELETE FROM connectors WHERE id = ? AND user_id = ?').bind(Number(b.id), user.id).run(); return json({ ok: true }); }
      const n = (await db.prepare('SELECT COUNT(*) AS n FROM connectors WHERE user_id = ?').bind(user.id).first()).n;
      if (n >= 5) return json({ error: 'אפשר עד 5 חיבורים. מנתקים אחד ישן קודם.' }, 400);
      const token = randomToken();
      const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 30) || 'עוזר';
      await db.prepare('INSERT INTO connectors (user_id, token_hash, name, created) VALUES (?,?,?,?)').bind(user.id, await sha256(token), name, Date.now()).run();
      return json({ ok: true, token, path: `/mcp/${token}` });
    }
    if (path === '/api/house-guests' && req.method === 'POST') { // מ27: "על האורחים", a grown-up deletes; a child sees nothing
      if (user.role === 'child') return json({ error: 'לא נמצא' }, 404);
      const b = await body(req);
      if (!b.delete) return json({ error: 'לא נמצא' }, 404);
      const g = await db.prepare('SELECT name FROM house_guests WHERE id = ?').bind(Number(b.id)).first();
      if (!g) return json({ error: 'לא נמצא' }, 404);
      await db.batch([db.prepare('DELETE FROM house_guests WHERE id = ?').bind(Number(b.id)), db.prepare('DELETE FROM settings WHERE key = ?').bind(`guest_seen:${await guestHash(db, g.name)}`)]); // asked again only after three more
      return json({ ok: true });
    }
    if (path === '/api/noticed' && req.method === 'POST') {
      // decision 124: "I noticed that..." answered in settings. Yes does what the chat card would; no is final.
      if (user.role === 'child') return json({ error: 'את זה מבוגר צריך לאשר' }, 403);
      const b = await body(req);
      const row = await db.prepare(`SELECT * FROM noticed WHERE id = ? AND kind != 'shopday' AND status IN ('watching', 'asked', 'expired'${b.yes ? '' : ", 'yes'"})`).bind(Number(b.id)).first(); // "stop" also undoes a yes; an expired row on an old settings screen is an answer too (מ31)
      if (!row || (row.kind === 'owner' && row.user_id !== user.id)) return json({ error: 'מישהו כבר ענה על זה' }, 404); // מ1: "only you add…" is theirs to answer
      if (!b.yes) { await answerNoticed(db, row.id, false); return json({ ok: true }); }
      const S2 = await loadAll(db, user);
      const actions = yesActions(row, { users: S2.users, products: S2.products });
      if (!actions.length) { await answerNoticed(db, row.id, true); return json({ ok: true, reaction: 'learned' }); }
      const id = crypto.randomUUID();
      await db.prepare('INSERT INTO proposals (id, user_id, created, actions) VALUES (?,?,?,?)').bind(id, user.id, Date.now(), JSON.stringify({ actions: actions.map((a, i) => (i ? a : { ...a, noticed: row.id })), context: 'report' })).run();
      const r = await applyProposal(env, user, id, 'apply', {});
      return json({ ...r, reaction: row.kind === 'regular' ? 'approved' : 'learned' }, r.error ? 400 : 200); // a new regular product: a happy face
    }
    // d45 "להחליף" (approved 02/10, 05/10): the box goes and the count starts over, as "להשאיר"; Shuki asks in my own chat
    // "מה לקנות במקום X?" (c03); the line stays until the answer, and an answer with a product makes a card that adds it and
    // takes the old one off (chatTurn, `swap`). Not a turn: Shuki's question and the waiting answer are mine alone
    if (path === '/api/stale-swap' && req.method === 'POST') {
      const b = await body(req);
      const it = await db.prepare("SELECT i.id, i.text, p.name FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.id = ? AND i.status = 'open' AND (i.private_to IS NULL OR i.private_to = ?) AND (p.private_to IS NULL OR p.private_to = ?)").bind(Number(b.item_id), user.id, user.id).first();
      if (!it) return json({ error: 'לא נמצא' }, 404); // existing words
      const name = it.name || it.text;
      await db.prepare('UPDATE list_items SET skipped = 0 WHERE id = ?').bind(it.id).run();
      const ask = { actions: [], swap: { item_id: it.id, name }, nope: 'בסדר.' }, bubble = { askOnly: true, reply: `מה לקנות במקום ${name}?`, face: 'happy', for: user.id, only: user.id };
      // 58 (the owner 05/10): it takes the place of a question of mine still open, and the chat opens with it; the answer is only
      // the next message (takeAsk), and with no product going on the list it closes and the old line stays. The question it
      // took the place of goes back to the queue, with its bubble, and is asked again after the answer (9, 05/10 noon)
      const was = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(`ask:${user.id}`).first();
      const old = was && JSON.parse(was.value);
      if (old && !old.swap && Date.now() - (old.ts || 0) < 24 * 3600e3) {
        // its bubble: the last question of Shuki's in my chat, the one with its buttons when it has them
        const qs = (await db.prepare("SELECT content FROM chat WHERE thread = ? AND role = 'shuki' AND (json_extract(content, '$.askOnly') IS NOT NULL OR json_extract(content, '$.options') IS NOT NULL) ORDER BY ts DESC, id DESC LIMIT 5").bind(user.id).all()).results.map((r) => JSON.parse(r.content));
        const keys = old.choices ? JSON.stringify(Object.keys(old.choices)) : null;
        const { status: _s, answered: _a, ...asked } = (keys && qs.find((c) => JSON.stringify(c.options || []) === keys)) || qs[0] || {};
        // only the question: a bubble saved with the answer before it ("הוספתי חלב. אגב, שמתי לב ש… ?") comes back from the
        // question on, so nothing reads as done twice; first in the queue, so it's the one asked after the answer
        const parts = String(asked.reply || '').split(/(?<=[.!?])\s+/), from = parts.findIndex((t) => /^אגב/.test(t));
        const question = asked.askOnly ? asked.reply : (from >= 0 ? parts.slice(from) : parts.slice(-1)).join(' ');
        if (question) {
          const qrow = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(`askq:${user.id}`).first();
          await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`askq:${user.id}`, JSON.stringify([{ ask: old, bubble: { ...asked, reply: question, for: asked.for ?? user.id, only: user.id }, ts: Date.now() }, ...(qrow ? JSON.parse(qrow.value) : [])])).run();
        }
      }
      await setAsk(env, user, ask); await saveChat(env, null, 'shuki', bubble, Date.now());
      return json({ ok: true });
    }
    // 0b: a grown-up turns off (or on) seeing a child's chat, for that child (r11 q039, r12 q016); their own, not the
    // house's (stage 5, b01): child_chat:<grown-up>:<child>
    if (path === '/api/child-chat' && req.method === 'POST') {
      const b = await body(req);
      if (user.role === 'child') return json({ error: 'את זה מבוגר צריך לאשר' }, 403); // existing words
      const kid = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'child' AND active = 1").bind(Number(b.id)).first();
      if (!kid) return json({ error: 'אין בבית מישהו כזה' }, 404); // existing words
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`child_chat:${user.id}:${kid.id}`, b.see === false ? '0' : '1').run();
      return json({ ok: true });
    }
    // what Shuki knows (0c): deleting one is real. Your own; a grown-up also a child's and the house's
    if (path === '/api/facts' && req.method === 'POST') {
      const b = await body(req);
      const f = await db.prepare('SELECT f.*, u.role AS about_role FROM facts f LEFT JOIN users u ON f.about = \'person\' AND u.id = f.about_id WHERE f.id = ?').bind(Number(b.id)).first();
      const may = f && ((f.about === 'person' && f.about_id === user.id) || (user.role !== 'child' && (f.about === 'house' || f.about_role === 'child')));
      if (!may) return json({ error: 'את זה כבר שכחתי' }, 404); // the words for a rule that's gone (existing); not "forbidden", so nothing is revealed
      if (b.delete) { await forget(db, 'id = ?', [f.id]); return json({ ok: true }); }
      return json({ error: 'bad' }, 400);
    }
    if (path === '/api/lessons' && req.method === 'POST') {
      // "what Shuki learned": a grown-up fixes the wording or takes a rule away
      if (user.role === 'child') return json({ error: 'רק מבוגר משנה את מה שלמדתי' }, 403);
      const b = await body(req); const id = Number(b.id);
      if (!(await db.prepare('SELECT 1 AS x FROM lessons WHERE id = ?').bind(id).first())) return json({ error: 'את זה כבר שכחתי' }, 404);
      if (b.delete) { await db.prepare('DELETE FROM lessons WHERE id = ?').bind(id).run(); return json({ ok: true }); }
      const t = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, LESSON_LEN);
      if (!t) return json({ error: 'אי אפשר לשמור את זה ריק. כדי שאשכח את זה: מחיקה' }, 400);
      await db.prepare('UPDATE lessons SET text = ?, edited = ? WHERE id = ?').bind(t, Date.now(), id).run();
      return json({ ok: true });
    }
  } catch (e) {
    console.error('api', req.method, path, user.id, e.stack || String(e));
    // the app's own refusals are in Hebrew and go back as they are; anything else (a database error) stays in the log
    return /[\u0590-\u05FF]/.test(e.message || '') ? json({ error: e.message }, 400) : json({ error: 'אופס, משהו השתבש. אפשר לנסות שוב עוד רגע' }, 500);
  }
  return json({ error: 'לא נמצא' }, 404);
}

function push(env, sub, message) {
  if (!pushAllowed(sub?.endpoint, env.PUSH_ALLOW)) return Promise.resolve(0);
  return sendPush(sub, message, { publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT }).then((r) => r.status);
}

/**
 * Push a message to other people in the house (never to the sender). Returns what was sent, for the app and the tests.
 * Without VAPID keys (local runs) nothing leaves the server, but the plan is still returned.
 */
async function pushOthers(env, user, message, onlyUserIds, kind = 'shopping') {
  const prefs = await allPrefs(env);
  const devs = (await env.DB.prepare('SELECT d.id, d.push_sub, u.id AS uid, u.name FROM devices d JOIN users u ON u.id = d.user_id WHERE d.user_id != ? AND u.active = 1 AND d.push_on = 1 AND d.push_sub IS NOT NULL').bind(user.id).all()).results
    .filter((d) => (!onlyUserIds || onlyUserIds.includes(d.uid)) && prefs(d.uid)[kind] !== false);
  const quiet = await quietNow(env);
  const sent = [];
  for (const d of devs) {
    if (quiet(d.uid)) { sent.push({ to: d.name, ...message, quiet: true }); continue; }
    let status = 0;
    if (env.VAPID_PRIVATE_JWK) status = await push(env, JSON.parse(d.push_sub), message).catch(() => 0);
    if (status === 404 || status === 410) await env.DB.prepare('UPDATE devices SET push_sub = NULL WHERE id = ?').bind(d.id).run();
    sent.push({ to: d.name, ...message, delivered: status >= 200 && status < 300 }); // not the raw status of someone else's device
  }
  return sent;
}

const openTrips = (env, now = Date.now()) => env.DB.prepare('SELECT * FROM shopping WHERE ended IS NULL AND started > ?').bind(now - SHOP_TTL).all().then((r) => r.results);

/** "I'm going shopping": open a trip (or move it to another store) and tell the others, so they can add what's missing. */
async function startShopping(env, user, store) {
  const now = Date.now();
  store = STORE_NAMES[store] ? store : 'super';
  const mine = (await openTrips(env, now)).find((t) => t.user_id === user.id);
  if (mine) {
    if (mine.store === store) return { ok: true, trip: mine, notify: [] };
    await env.DB.prepare('UPDATE shopping SET store = ? WHERE id = ?').bind(store, mine.id).run();
  } else await env.DB.prepare('INSERT INTO shopping (user_id, store, started) VALUES (?,?,?)').bind(user.id, store, now).run();
  const notify = await pushOthers(env, user, { title: `${user.name} בקניות עכשיו`, body: `${byPerson(user, 'הוא', 'היא', 'הם')} ב${STORE_NAMES[store]}. האם חסר משהו? מה שתוסיפו לרשימה אעביר ${byPerson(user, 'אליו', 'אליה', 'אליהם')} מיד.`, url: './#list' });
  return { ok: true, store, notify };
}

/**
 * Close my trip and say how it went: what came from the list, what didn't, and what stayed on the list.
 * `bought`: names that left the list with this "done shopping" (none when the trip is just closed).
 */
async function endShopping(env, user, { bought = [], store = null } = {}) {
  const db = env.DB;
  const now = Date.now();
  const mine = (await openTrips(env, now)).find((t) => t.user_id === user.id);
  if (!mine && !bought.length) return { ok: true, notify: [] };
  store ||= mine?.store || null;
  // the trip's window; without a trip, since the first thing I checked in this shop
  const from = mine?.started ?? (await db.prepare("SELECT MIN(checked) AS t FROM list_items WHERE checked_by = ? AND status = 'done' AND checked > ?").bind(user.id, now - DAY).first())?.t ?? now;
  const [offRows, openRows] = await db.batch([
    // bought by me in the window, through anything but the list (chat, receipt, "I bought")
    db.prepare(`SELECT DISTINCT p.name FROM product_log l JOIN events e ON e.id = l.event_id JOIN products p ON p.id = l.product_id
      WHERE l.kind = 'purchase' AND e.user_id = ? AND e.undone IS NULL AND p.private_to IS NULL AND l.ts >= ? AND l.product_id NOT IN (SELECT product_id FROM list_items WHERE product_id IS NOT NULL AND checked >= ?)`).bind(user.id, from, from),
    db.prepare(`SELECT COALESCE(p.name, i.text) AS name FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.status = 'open' AND i.private_to IS NULL AND p.private_to IS NULL ${store ? 'AND i.store = ?' : ''} ORDER BY i.added`).bind(...(store ? [store] : [])),
  ]);
  const priv = new Set((await db.prepare('SELECT name FROM products WHERE private_to IS NOT NULL').all()).results.map((r) => r.name));
  const summary = { bought: bought.filter((n) => !priv.has(n)), offList: offRows.results.map((r) => r.name), forgot: openRows.results.map((r) => r.name), store };
  if (mine) await db.prepare('UPDATE shopping SET ended = ?, summary = ? WHERE id = ?').bind(now, JSON.stringify(summary), mine.id).run();
  const lines = tripSummaryLines(summary);
  const notify = await pushOthers(env, user, { title: `${user.name} ${byPerson(user, 'סיים', 'סיימה', 'סיימו')} קניות`, body: lines.join('. ') || 'עדכנתי את המלאי.', url: './#list' });
  return { ok: true, ended: mine?.id, notify, summary };
}

/** My saved outfit, with whatever a new level just unlocked put on. */
async function myOutfit(env, user, level, settingsRows) {
  const raw = settingsRows.find((r) => r.key === `outfit:${user.id}`)?.value;
  const o = catchUp(raw ? JSON.parse(raw) : null, level);
  if (o.changed) await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`outfit:${user.id}`, JSON.stringify({ level: o.level, wear: o.wear })).run();
  return o.wear;
}

/** Push to my own phones (not the Siri key). */
async function pushMine(env, user, message, kind = 'reminders', atTheirHour = false) {
  if ((await allPrefs(env))(user.id)[kind] === false) return [];
  // decision 173: a reminder someone set for a time goes out at that time, quiet hours or not
  if (!atTheirHour && (await quietNow(env))(user.id)) return [{ to: user.name, ...message, quiet: true }];
  const devs = (await env.DB.prepare("SELECT id, push_sub FROM devices WHERE user_id = ? AND kind = 'app' AND push_on = 1 AND push_sub IS NOT NULL").bind(user.id).all()).results;
  const sent = [];
  for (const d of devs) {
    let status = 0;
    if (env.VAPID_PRIVATE_JWK) status = await push(env, JSON.parse(d.push_sub), message).catch(() => 0);
    sent.push({ to: user.name, ...message, status });
  }
  return sent;
}

/**
 * "we're abroad until the 10th": learning skips these days, and Shuki's own pushes wait. A reminder someone asked for still
 * goes at its time (the owner 03/10, r0t trim). `end`: we're back.
 */
async function setAway(env, user, until, from, end, kind = 'away') {
  const db = env.DB; const now = Date.now();
  kind = kind === 'guests' ? 'guests' : 'away';
  const cur = awayNow((await db.prepare('SELECT * FROM away WHERE kind = ?').bind(kind).all()).results, now) || await db.prepare('SELECT * FROM away WHERE start > ? AND kind = ? ORDER BY start LIMIT 1').bind(now, kind).first();
  if (end || until === null) {
    if (cur) await db.prepare(cur.start > now ? 'DELETE FROM away WHERE id = ?' : 'UPDATE away SET end = ? WHERE id = ?').bind(...(cur.start > now ? [cur.id] : [now, cur.id])).run();
    return { ok: true, away: null };
  }
  const endTs = dayEnd(until); const startTs = from ? dayStart(from) : now;
  if (from && !startTs) throw new Error('תאריך יציאה לא תקין');
  if (!endTs || endTs <= now || endTs <= startTs || endTs - startTs > 120 * DAY) throw new Error('תאריך חזרה לא תקין');
  if (cur) await db.prepare('UPDATE away SET start = ?, end = ?, set_by = ? WHERE id = ?').bind(Math.min(cur.start, startTs), endTs, user.id, cur.id).run();
  else await db.prepare('INSERT INTO away (start, end, set_by, kind) VALUES (?,?,?,?)').bind(startTs, endTs, user.id, kind).run();
  return { ok: true, away: { start: startTs, end: endTs, kind } };
}
// "YYYY-MM-DD" in the house's time zone → the local midnight that starts / ends it
const dayStart = (d) => localToTs(d, '00:00');
const dayEnd = (d) => { const s = dayStart(d); return s && s + DAY; };

/** A child put something on the list: the grown-ups hear about it, to say yes or no. */
async function childAsked(env, user, added) {
  if (user.role !== 'child' || !added?.length) return [];
  const adults = (await env.DB.prepare("SELECT id FROM users WHERE active = 1 AND role != 'child'").all()).results.map((u) => u.id);
  return pushOthers(env, user, { title: `${user.name} ${byPerson(user, 'מבקש', 'מבקשת', 'מבקשים')}`, body: `${added.slice(0, 6).join(', ')} · לאשר ברשימה`, url: './#list' }, adults, 'requests');
}

/** Someone added to the list while someone else is in the store: tell the shopper right away. */
async function tellShoppers(env, user, added) {
  if (!added?.length) return [];
  const trips = (await openTrips(env)).filter((t) => t.user_id !== user.id);
  if (!trips.length) return [];
  return pushOthers(env, user, { title: `${user.name} ${byPerson(user, 'הוסיף', 'הוסיפה', 'הוסיפו')} לרשימה`, body: added.slice(0, 6).join(', '), url: './#list' }, trips.map((t) => t.user_id));
}

/**
 * מ19: a product someone is in charge of ("אבי אחראי על הקפה"), marked out by someone else: a push to them alone (shopping,
 * so their settings and quiet hours count). Not when they're shopping now and tellShoppers already says it was added.
 */
/** מ19's push: "נגמר הקפה" / "מיכל סימנה שהקפה נגמר. הוא כבר ברשימה." ("הן" for one plural and feminine) */
export const RESPONSIBLE_PUSH = (user, x) => { const out = byGender(x.name, 'נגמר', 'נגמרה', 'נגמרו'), the = definite(x.name);
  return { title: `${out} ${the}`, body: `${user.name} ${byPerson(user, 'סימן', 'סימנה', 'סימנו')} ש${the} ${out}.${x.listed ? ` ${byGender(x.name, 'הוא', 'היא', 'הם', 'הן')} כבר ברשימה.` : ''}`, url: './#list' }; };
async function tellResponsible(env, user, ranOut = [], added = []) {
  if (!ranOut.length) return [];
  const trips = new Set((await openTrips(env)).filter((t) => t.user_id !== user.id).map((t) => t.user_id));
  const sent = [];
  for (const x of ranOut) {
    if (added.slice(0, 6).includes(x.name) && trips.has(x.responsible)) continue; // "…הוסיף לרשימה" with it reached them already
    sent.push(...await pushOthers(env, user, RESPONSIBLE_PUSH(user, x), [x.responsible]));
  }
  return sent;
}

const LEFTOVER_ASK = 3 * DAY; // leftovers: "still in the fridge?" three days after they were cooked

/** Friday 10:00, for whoever keeps Shabbat (decision 118): one push with the basics that are missing. */
async function beforeShabbat(env, now) {
  const l = local(now, HOUSE.tz);
  if (l.wd !== 5 || l.hour !== 10) return {};
  const keepers = await shabbatKeepers(env.DB);
  if (!keepers.length) return {};
  let sent = 0, body = null; const bodies = {};
  for (const u of keepers) {
    // nothing private in it, not even their own (the owner 06/10, r7b): no private product's name on a locked screen
    const missing = (await loadAll(env.DB, u)).products.filter((p) => p.private_to == null && p.is_basic && (isOut(p) || isMissing(p))).map((p) => p.name);
    if (!missing.length) continue;
    body = `לשבת צריך להשלים: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ` ועוד ${missing.length - 6}` : ''}.`;
    bodies[u.id] = body;
    const key = `shabbat_sent:${u.id}:${l.date}`;
    if (await env.DB.prepare('SELECT 1 AS x FROM settings WHERE key = ?').bind(key).first()) continue;
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, '1')").bind(key).run();
    if (!(await useShukiPush(env.DB, u.id, now))) continue; // two a day at most (0b): it's about today, so it's dropped
    sent += (await pushMine(env, u, { title: 'לשבת', body, url: './#list' })).length;
  }
  // the words, for the tests only (the hourly log stays without what the house is missing)
  return { shabbatSent: sent, ...(env.TEST_RESET === '1' && sent && body && { shabbatBody: body, shabbatBodies: bodies }) };
}

/** The morning after moving day: Shuki offers to map the new place, once (decision 85). */
/** Passover is over: the mode goes off, and the regular chametz that ran out or is short goes back on the list at once (r10
 * q055, r0t r10-8). From the settings' switch and from the card's "כן, תכבה" (מ14). Returns how many went back. */
async function pesachOff(env) {
  const db = env.DB;
  HOUSE.pesach = false;
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pesach', '0')").run();
  const S = await loadAll(db, { all: true });
  const open = new Set(S.items.filter((i) => i.status === 'open' && i.product_id).map((i) => i.product_id));
  const due = S.products.filter((p) => p.is_basic && passoverOut(p) && !open.has(p.id) && listNeed(p));
  if (due.length) await execute(env, SHUKI, due.map((p) => ({ kind: 'list_add', product_id: p.id, store: p.store })));
  return due.length;
}
/** מ14 (q056): what is left of Passover at home; one product by its kind ("איתן" for one plural and feminine) */
export const PESACH_LEFT = (names) => `סגור! נשארו מפסח: ${names.length > 1 ? `${names.slice(0, -1).join(', ')} ו${names.at(-1)}` : names[0]}. מה לעשות ${names.length > 1 ? 'איתם' : byGender(names[0], 'איתו', 'איתה', 'איתם', 'איתן')}?`;
const PESACH_END = 'פסח נגמר. האם לכבות את מצב הפסח?', PESACH_OFF = 'כן, תכבה', PESACH_NOT_YET = 'עוד לא'; // q054 (approved), the buttons (approved r9p)
/**
 * מ14 (q054): the morning after Passover (כ״ב ניסן in Israel, כ״ג abroad), while the mode is on: one card to the house, once a
 * year (pesach_end:<Hebrew year>), when no other card of the server's is up (else the next morning, within the week).
 */
async function pesachEnd(env, now) {
  if (!HOUSE.pesach || local(now, HOUSE.tz).hour !== ROUTINE_HOUR) return {};
  const h = hebrewDate(now, HOUSE.tz), last = ['Asia/Jerusalem', 'Asia/Tel_Aviv', 'Israel'].includes(HOUSE.tz) ? 22 : 23;
  if (h.month !== 'Nisan' || h.day < last || h.day > last + 6) return {};
  const key = `pesach_end:${h.year}`;
  if ((await env.DB.prepare('SELECT 1 AS x FROM settings WHERE key = ?').bind(key).first()) || (await serverCardUp(env.DB, now))) return {};
  await env.DB.batch([env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(key, String(now)),
    ...chatRows(env.DB, now, null, 'shuki', { reply: PESACH_END, face: 'happy', options: [PESACH_OFF, PESACH_NOT_YET], card: 1, offer: 'pesach_end' })]);
  return { pesachEnd: true };
}
/**
 * מ15 (q058): the morning after 1 Shawwal (within the week), once a year, in a house that keeps Ramadan (a Muslim house, or a
 * grown-up's fast in it): each product's pace inside Ramadan (learn() on the month's rows alone) is kept for next Ramadan in
 * settings.ramadan_pace = { year, pace: { pid: every } }, and the month's window goes into pace_skip (מ12), so the usual pace
 * isn't taught by it. Only products the whole house sees.
 */
async function ramadanPace(env, now) {
  if (local(now, HOUSE.tz).hour !== ROUTINE_HOUR) return {};
  const h = islamicDate(now, HOUSE.tz);
  if (h.month !== 10 || h.day > 7) return {};
  const db = env.DB;
  const cur = await db.prepare("SELECT value FROM settings WHERE key = 'ramadan_pace'").first();
  if (cur && (() => { try { return JSON.parse(cur.value).year === h.year; } catch { return false; } })()) return {};
  const facts = (await db.prepare("SELECT about, about_id, key, value FROM facts WHERE ended IS NULL AND private = 0 AND ((about = 'house' AND key = 'habit') OR (about = 'person' AND key = 'fasting'))").all()).results;
  if (religionOf(facts) !== 'muslim' && !facts.some((f) => f.key === 'fasting' && /רמדאן/.test(f.value || ''))) return {};
  // the month: from the first day of Ramadan to the first of Shawwal, by the day (at this hour, close enough for a pace in days)
  let to = now; while (islamicDate(to - DAY, HOUSE.tz).month === 10) to -= DAY;
  let from = to - DAY; while (islamicDate(from - DAY, HOUSE.tz).month === 9) from -= DAY;
  from -= ROUTINE_HOUR * 3600e3; to -= ROUTINE_HOUR * 3600e3;
  const rows = (await db.prepare('SELECT product_id, ts, kind FROM product_log WHERE ts >= ? AND ts < ? AND product_id IN (SELECT id FROM products WHERE private_to IS NULL AND deleted IS NULL) ORDER BY ts').bind(from, to).all()).results;
  const pace = Object.fromEntries(Object.entries(learn(rows)).map(([pid, l]) => [pid, l.every]));
  const wins = [...new Set(rows.map((r) => r.product_id))].map((product_id) => ({ product_id, from, to }));
  const skip = await db.prepare("SELECT value FROM settings WHERE key = 'pace_skip'").first();
  const all = [...(() => { try { return JSON.parse(skip?.value || '[]'); } catch { return []; } })(), ...wins];
  await db.batch([db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ramadan_pace', ?)").bind(JSON.stringify({ year: h.year, pace })),
    ...(wins.length ? [db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pace_skip', ?)").bind(JSON.stringify(all))] : [])]);
  return { ramadanPace: Object.keys(pace).length };
}
/**
 * מ17 (q029, "קובע לבד"): in a kosher house, the morning run fills meat / dairy / parve on food products that have none: the
 * first time all of them (kosher_filled), then only new ones. MEAT = meat; a plant milk = parve; MILK = dairy; vegetables and
 * fruit, and spices and oils, with none of them = parve (44ב: not dry goods nor cans, but for the basic ones of 46: "קמח", "אורז בסמטי"). What isn't clear stays empty (the model asks when it comes up).
 */
const KOSHER_FOOD = ['ירקות ופירות', 'מוצרי חלב, גבינות וביצים', 'בשר, עוף ודגים', 'תחליפי בשר', 'לחם ומאפים', 'יבשים', 'שימורים ורטבים', 'תבלינים ושמנים', 'חטיפים ומתוקים', 'משקאות', 'תינוק'];
async function kosherFill(env, now) {
  if (!kosherHouse(HOUSE.notes) || local(now, HOUSE.tz).hour !== ROUTINE_HOUR) return {};
  const db = env.DB;
  const since = Number((await db.prepare("SELECT value FROM settings WHERE key = 'kosher_filled'").first())?.value) || 0;
  const rows = (await db.prepare(`SELECT p.id, p.name, c.name AS category FROM products p JOIN categories c ON c.id = p.category_id WHERE p.deleted IS NULL AND p.kosher_kind IS NULL
    AND c.name IN (${KOSHER_FOOD.map(() => '?').join(',')}) AND p.created > ?`).bind(...KOSHER_FOOD, since).all()).results;
  const set = rows.map((p) => [p.id, kosherKindOf(p.name, p.category)]).filter(([, k]) => k);
  await db.batch([...set.map(([id, k]) => db.prepare('UPDATE products SET kosher_kind = ? WHERE id = ? AND kosher_kind IS NULL').bind(k, id)),
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('kosher_filled', ?)").bind(String(now))]);
  return { kosherFilled: set.length };
}
/**
 * מ25: the evening before the house's day for the big shop (noticed `shopday`), to whoever said "כן, תזכיר" (shopday_optin):
 * one push, only when the list has something on it (nothing private), once a day (shopday_sent:<id>:<date>).
 */
/** question 39 (r9z): up to three things by name, four and more by the count */
export const SHOPDAY_BODY = (names) => (names.length > 3 ? `ברשימה יש ${names.length} מוצרים.` : `ברשימה יש ${names.length > 1 ? `${names.slice(0, -1).join(', ')} ו${names.at(-1)}` : names[0]}.`);
async function shopdayReminders(env, now) {
  const db = env.DB, l = local(now, HOUSE.tz);
  const row = await db.prepare("SELECT data FROM noticed WHERE kind = 'shopday' AND count >= 3 AND status NOT IN ('no', 'expired')").first();
  const v = (() => { try { return JSON.parse(row?.data || '{}').v || null; } catch { return null; } })();
  if (!v || v.weekday !== (l.wd + 1) % 7) return {};
  const names = (await db.prepare("SELECT COALESCE(p.name, i.text) AS name FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.status = 'open' AND i.approved = 1 AND i.ordered IS NULL AND i.private_to IS NULL AND (p.id IS NULL OR p.private_to IS NULL) ORDER BY i.added").all()).results.map((r) => String(r.name || '').trim()).filter(Boolean); // not a child's line waiting
  if (!names.length) return {};
  const who = (await db.prepare("SELECT u.* FROM users u JOIN facts f ON f.about = 'person' AND f.about_id = u.id AND f.key = 'shopday_optin' AND f.value = 'כן' AND f.ended IS NULL WHERE u.active = 1 AND u.role != 'child'").all()).results;
  const sent = [], prefs = await allPrefs(env), quiet = await quietNow(env, now);
  for (const u of who) {
    if (prefs(u.id).reminders === false || quiet(u.id)) continue; // nothing goes, so nothing is spent (the reviewer of 661bd57)
    const key = `shopday_sent:${u.id}:${l.date}`;
    if ((await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '1')").bind(key).run()).meta?.changes !== 1) continue;
    if (!(await useShukiPush(db, u.id, now))) continue; // two a day at most (0b)
    sent.push(...await pushMine(env, u, { title: v.kind === 'delivery' ? 'מחר משלוח' : 'מחר קניות', body: SHOPDAY_BODY(names), url: './#list' }));
  }
  return sent.length ? { shopday: sent } : {};
}
/**
 * מ28: the morning after a vacation ended (away, kind 'away', ended within the last day or so; back:<id>), one card to the
 * house: to mark as thrown away what spoils (shelf_days up to 21), was at home when it started, ran past its days inside it,
 * and nobody bought or updated meanwhile. Nothing private. One card from the server at a time (else tomorrow, within the week).
 */
export const BACK_HOME = (names) => (names.length > 1 ? 'ברוכים השבים! אלה כנראה כבר לא טובים אחרי החופשה. האם לסמן שזרקתם אותם?'
  : `ברוכים השבים! ${/^[א-ת'׳״"]+(\s+[\d.,%]+%?)?$/.test(names[0].trim()) ? `ה${names[0].trim()}` : names[0]} כנראה כבר לא ${byGender(names[0], 'טוב', 'טובה', 'טובים', 'טובות')} אחרי החופשה. האם לסמן שזרקתם ${byGender(names[0], 'אותו', 'אותה', 'אותם', 'אותן')}?`);
async function backHome(env, now) {
  if (local(now, HOUSE.tz).hour !== ROUTINE_HOUR) return {};
  const db = env.DB;
  const trips = (await db.prepare("SELECT * FROM away WHERE kind = 'away' AND end <= ? AND end > ? AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'back:' || away.id) ORDER BY end DESC").bind(now, now - 7 * DAY).all()).results;
  const w = trips[0];
  if (!w || (await serverCardUp(db, now)) || awayNow((await db.prepare("SELECT * FROM away WHERE kind = 'away'").all()).results, now)) return {};
  const freezers = new Set((await db.prepare('SELECT id, name FROM locations').all()).results.filter((l) => isFreezer(l.name)).map((l) => l.id));
  const bought = Object.fromEntries((await db.prepare("SELECT product_id, MAX(ts) AS ts FROM product_log WHERE kind = 'purchase' AND ts < ? GROUP BY product_id").bind(w.start).all()).results.map((r) => [r.product_id, r.ts]));
  const ps = (await db.prepare('SELECT * FROM products WHERE deleted IS NULL AND private_to IS NULL').all()).results.filter((p) => p.private_to == null && p.shelf_days && p.shelf_days <= 21 && !isOut(p)
    && !freezers.has(p.location_id) && (p.updated || 0) < w.start && ((e) => e > w.start && e <= w.end)(p.expires ?? (bought[p.id] ?? p.updated ?? w.start) + p.shelf_days * DAY)); // spoiled inside it (a known expiry first; not in a freezer)
  await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`back:${w.id}`, String(now)).run();
  if (!ps.length) return {};
  const actions = ps.map((p) => ({ kind: 'op', product_id: p.id, op: { type: 'discard', amount: null } })); // all of it (an open one too)
  const id = crypto.randomUUID();
  await db.batch([db.prepare('INSERT INTO proposals (id, user_id, created, actions) VALUES (?, 0, ?, ?)').bind(id, now, JSON.stringify({ actions, context: 'report', forAdults: true, day: local(now, HOUSE.tz).date })), // good until the day ends (the owner 13/10); the house's card: any grown-up
    ...chatRows(db, now, null, 'shuki', { reply: BACK_HOME(ps.map((p) => p.name)), face: 'happy', card: 1, day: local(now, HOUSE.tz).date, proposal: { id, lines: describeActions(actions, { products: ps, list: [], locations: [], categories: [], users: [] }), status: 'pending' } })]);
  return { backHome: ps.length };
}
async function afterMoving(env, now) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'moving'").first();
  if (!row || now < Number(row.value) + DAY / 2 || local(now, HOUSE.tz).hour !== ROUTINE_HOUR) return {};
  if (await serverCardUp(env.DB, now)) return {}; // one card from the server at a time (r12 q031): tomorrow morning
  await env.DB.batch([
    env.DB.prepare("DELETE FROM settings WHERE key = 'moving'"),
    ...chatRows(env.DB, now, null, 'shuki', { reply: 'איזה כיף שעברתם לבית חדש! האם נעבור יחד על מקומות האחסון? אזור אחרי אזור ואני אעדכן איפה כל דבר.', face: 'excited', options: ['כן, נתחיל למפות', 'אחר כך'], card: 1 }),
  ]);
  return { movedIn: true };
}
/**
 * א4 (stage 8, docs/stage8-plan.md): in the morning, a period (keto, a diet) whose `until` has passed: one card, to the
 * person alone, in their own chat, asked once ("האם את עדיין בקיטו?" [כן, עדיין] [כבר לא]). One card from the server at a
 * time (serverCardUp), and not over a question of theirs that still waits: tomorrow then. A private period: only in their chat.
 */
async function periodEnds(env, now) {
  const db = env.DB;
  if (local(now, HOUSE.tz).hour !== ROUTINE_HOUR || (await serverCardUp(db, now))) return {};
  // not one she already ended for herself in a secret (a private ended row of hers, פ6)
  const due = (await db.prepare(`SELECT f.* FROM facts f JOIN users u ON u.id = f.about_id WHERE f.about = 'person' AND f.key = 'period' AND f.until IS NOT NULL AND f.until <= ?
    AND f.ended IS NULL AND u.active = 1 AND u.role != 'child' AND NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = 'period_end:' || f.id)
    AND NOT EXISTS (SELECT 1 FROM facts e WHERE e.about = 'person' AND e.about_id = f.about_id AND e.key = 'period' AND e.private = 1 AND e.ended = 1) ORDER BY f.until LIMIT 10`).bind(now).all()).results;
  let f = null, user = null;
  for (const x of due) { // the first whose person has no question of theirs waiting (theirs: tomorrow)
    const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(x.about_id).first();
    if (!(await openAsk(db, u.id))) { f = x; user = u; break; }
  }
  if (!f) return {};
  const q = againQuestion(f, user);
  await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`period_end:${f.id}`, String(now)).run(); // asked: never twice
  if (!q) return {};
  const keep = { actions: [{ kind: 'fact_keep', id: f.id, until: true }], done: 'סגור!' };
  await setAsk(env, user, { ...keep, day: local(now, HOUSE.tz).date, nope: 'סגור, שכחתי.', choices: { 'כן, עדיין': keep, 'כבר לא': { actions: [{ kind: 'fact_end', key: 'period', ids: [f.id] }], done: 'סגור, שכחתי.' } } });
  await db.batch(chatRows(db, now, null, 'shuki', { reply: q, face: 'happy', options: ['כן, עדיין', 'כבר לא'], card: 1, day: local(now, HOUSE.tz).date, to: [user.id], for: user.id, ...(f.private && { only: user.id, sensitive: true }) }));
  return { periodEnd: f.id };
}
/**
 * In the morning: weekly buys whose day is tomorrow go on the list (Shuki adds them), and a product bought on the
 * same weekday three weeks running, and who buys where, are noticed (worker/instincts.js).
 */
const SHUKI = { id: null, name: 'שוקי', gender: 'm', role: 'admin' };
const HELLO_YES = 'בוא נכיר!';
const MED_CATEGORY = 'תרופות ועזרה ראשונה';
async function weeklyBuys(env, now) {
  const db = env.DB; const l = local(now, HOUSE.tz);
  if (l.hour !== ROUTINE_HOUR) return {};
  const routines = (await db.prepare('SELECT r.* FROM routines r LEFT JOIN products p ON p.id = r.product_id WHERE r.product_id IS NULL OR p.deleted IS NULL').all()).results;
  let added = 0;
  const lastBuy = Object.fromEntries((await db.prepare("SELECT l.product_id, MAX(l.ts) AS ts FROM product_log l JOIN routines r ON r.product_id = l.product_id WHERE l.kind = 'purchase' AND r.every IS NOT NULL GROUP BY l.product_id").all()).results.map((x) => [x.product_id, x.ts]));
  for (const r of routinesDue(routines, now, HOUSE.tz, lastBuy)) {
    // a private weekly buy (private_to, migration 0024: after a secret, or a name from the fixed list): its line is its
    // owner's alone, added as theirs (their own product, the owner 04/10), not by Shuki for everyone; one who left: nobody's
    const owner = r.private_to != null && (await db.prepare('SELECT id, name, gender, role, active FROM users WHERE id = ?').bind(r.private_to).first());
    if (r.private_to != null && !owner?.active) continue;
    const own = owner ? { private: true } : {};
    await execute(env, owner || SHUKI, [r.product_id ? { kind: 'list_add', product_id: r.product_id, store: r.store, ...own } : { kind: 'list_add', text: r.text, store: r.store, ...own }], { opId: `routine:${r.id}:${l.date}` });
    await db.prepare('UPDATE routines SET last_added = ? WHERE id = ?').bind(l.date, r.id).run();
    added++;
  }
  // what the house does the same way (every Friday, who buys where): shown under "I noticed that..." and asked in a reply
  await scanPatterns(env, now, weeklyPatterns);
  return { ...(added && { weeklyAdded: added }) };
}

/**
 * Hourly: at the evening hour — the weekly recount, "still want it?" for things waiting 48 hours,
 * the expiry digest, and the monthly off-list summary on the 1st. Nothing while the house is away.
 */
/** A promise that gives up after ms (what it was doing may go on, but nobody waits for it). */
const within = (ms, p, what) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error(`${what}: no answer in ${ms}ms`)), ms); })]).finally(() => clearTimeout(t)); };
const BACKUP_MS = 60e3; // not exported: the worker's entry module may export only handlers and functions
/**
 * The once-a-day part of the hourly run. A backup or a version check that fails or takes too long is logged and
 * skipped; the hourly run goes on (the owner 03/10). `deps` and `ms` only for tests.
 */
export async function dailyRun(env, now, deps = { dailyBackup, checkUpdate }, ms = { backup: BACKUP_MS }) {
  const db = env.DB, daily = {};
  let bk = null;
  try { bk = await within(ms.backup, deps.dailyBackup(env, now), 'backup'); } catch (e) { console.error('daily backup', e.message || e); daily.backupFailed = true; }
  if (!bk) return daily;
  daily.backup = bk.day;
  try {
    daily.chatDeleted = (await db.prepare('DELETE FROM chat WHERE ts < ?').bind(now - 90 * DAY).run()).meta?.changes || 0; // all threads: the 90-day cleanup, every thread
    if (daily.chatDeleted) await unlinkGoneChats(db); // what was learned from them stays, without the link
    await db.prepare("DELETE FROM proposals WHERE created < ? AND status != 'pending'").bind(now - 90 * DAY).run();
  } catch (e) { console.error('daily cleanup', e.stack || e); }
  if (await deps.checkUpdate(env, ms.update)) daily.update = true; // never throws; gives up by itself (UPDATE_MS)
  return daily;
}

export async function runSchedule(env, now = Date.now()) {
  // every hour, not only on a backup day: distress goes after a week (r11 q013), a child's 24-hour mark after a day
  await forgetSensitive(env.DB, now);
  // yesterday's counts of personal messages (tells:<id>:<day>) go
  await env.DB.prepare("DELETE FROM settings WHERE (key LIKE 'tells:%' OR key LIKE 'learnask:%' OR key LIKE 'pushes:%' OR key LIKE 'holiday:%' OR key LIKE 'shopday_sent:%') AND key NOT LIKE ?").bind(`%:${local(now, HOUSE.tz).date}`).run();
  await env.DB.prepare('DELETE FROM removed WHERE ts < ?').bind(now - 30 * DAY).run(); // p7: who took a phone out, for 30 days
  await forgetOldPlan(env.DB, now); // home20: the plan's days older than 30 days
  await env.DB.prepare("DELETE FROM settings WHERE key LIKE 'left:%' AND CAST(value AS INTEGER) < ?").bind(now - 30 * DAY).run(); // when someone left (105): as long as removed
  // מ12: a period's window older than what learn() reads (180 days) goes
  await env.DB.prepare("UPDATE settings SET value = (SELECT json_group_array(json(w.value)) FROM json_each(settings.value) w WHERE json_extract(w.value, '$.to') >= ?) WHERE key = 'pace_skip'").bind(now - 180 * DAY).run();
  const db = env.DB;
  await db.prepare('UPDATE shopping SET ended = started + ? WHERE ended IS NULL AND started <= ?').bind(SHOP_TTL, now - SHOP_TTL).run();
  // a cart nobody closed ("done" forgotten): after 6 hours its lines leave the list (the stock was updated when they were ticked)
  await db.prepare(`UPDATE list_items SET status = 'done' WHERE status = 'checked' AND checked < ? AND checked_by NOT IN (SELECT user_id FROM shopping WHERE ended IS NULL)`).bind(now - 6 * 3600e3).run();
  // what a stopped model call left held against the monthly cap (no call takes an hour)
  await db.prepare('UPDATE usage SET reserved = 0 WHERE reserved > 0').run();
  const hostingsEnded = await endHostings(env, now);
  const buys = await weeklyBuys(env, now);
  const shabbat = await beforeShabbat(env, now);
  const moved = await afterMoving(env, now);
  const pesach = await pesachEnd(env, now);
  const ramadanKept = await ramadanPace(env, now);
  const kosherKept = await kosherFill(env, now);
  const back = await backHome(env, now);
  const periodEnd = await periodEnds(env, now);
  const recipeRows = await fixRecipeRows(env.DB); // once (17/10, ש14)
  const recipeLinks = await relinkRecipes(env.DB); // once (home19, 3)
  // Claude couldn't answer: every hour, check whether it can again (credit added, key fixed)
  const be = await db.prepare("SELECT value FROM settings WHERE key = 'brain_error'").first();
  if (be && llmKey(env) && (await testKey(env, llmKey(env), providerOf(env))).ok) await db.prepare("DELETE FROM settings WHERE key = 'brain_error'").run();
  // "remind me Sunday morning": reminders go out on their own hour, not with the evening digest
  const reminders = (await db.prepare("SELECT m.*, u.name, u.gender AS by_gender FROM maybe m JOIN users u ON u.id = m.added_by WHERE m.kind = 'remind' AND m.decided IS NULL AND m.asked IS NULL AND m.due_at <= ?").bind(now).all()).results;
  const reminderBodies = [];
  // r0t-7 (04/10), after a reminder went out (a private one too): a daily one moves to the same hour the next day; one that
  // isn't for buying leaves "תזכורות" (no line); the rest waits for its answer
  const afterSent = async (m) => {
    if (m.repeat === 'daily') { let next = m.due_at; while (next <= now) next = sameTimeNextDay(next); await db.prepare('UPDATE maybe SET due_at = ? WHERE id = ?').bind(next, m.id).run(); }
    else if (notBuying(m.text)) await db.prepare("UPDATE maybe SET asked = ?, decided = ?, decision = 'drop' WHERE id = ?").bind(now, now, m.id).run(); // done: nothing more to decide
    else await db.prepare('UPDATE maybe SET asked = ? WHERE id = ?').bind(now, m.id).run();
  };
  for (const m of reminders) {
    // a private reminder (private_to, migration 0024) or a private product's: only to whoever asked for it (it already is),
    // and without its words on the locked screen (r11, decided after the round 6; r0t p6, approved 03/10)
    const hidden = m.private_to != null || (m.product_id != null && (await db.prepare('SELECT private_to FROM products WHERE id = ?').bind(m.product_id).first())?.private_to != null);
    const asked = byPerson(m.by_gender, 'ביקשת שאזכיר לך', 'ביקשת שאזכיר לך', 'ביקשתם שאזכיר לכם'); // to whoever asked, in their words
    if (hidden) { await pushMine(env, { id: m.added_by, name: m.name }, { title: 'תזכורת', body: `${asked} משהו.`, url: './#list' }, 'reminders', true); reminderBodies.push(`${asked} משהו.`); await afterSent(m); continue; }
    await pushMine(env, { id: m.added_by, name: m.name }, { title: 'תזכורת', body: /^(לה\S{2,}|לקנות|לנקות|לשלם|לבדוק|לסדר|לזרוק|לשים|לקחת|לתקן|לשלוח|לחדש|לבשל|לאפות|להזמין)(\s|$)/.test(m.text) ? `${asked} ${m.text}.` : `${asked} לקנות ${m.text}. ${byPerson(m.by_gender, 'האם תרצה', 'האם תרצי', 'האם תרצו')} שאוסיף לרשימה?`, url: './#list' }, 'reminders', true);
    await afterSent(m);
  }
  const l = local(now, HOUSE.tz);
  // once a day (the first hour of the day): a copy of the house, old chat goes, is there a new version
  const daily = await dailyRun(env, now);
  // 80% of this month's cap: the admins hear about it, once
  if (await costWarning(env, now, (m, ids) => pushOthers(env, { id: -1 }, m, ids, 'messages'))) daily.costWarned = true;
  const set = Object.fromEntries((await db.prepare('SELECT key, value FROM settings').all()).results.map((r) => [r.key, r.value]));
  const hour = Number(set.digest_hour ?? 20);
  if (l.hour !== hour) return { skipped: true, ...daily, ...buys, ...shabbat, ...moved, ...ramadanKept, ...kosherKept, ...back, ...periodEnd, ...(reminders.length && { reminders: reminders.length, ...(env.TEST_RESET === '1' && { reminderBodies }) }), ...(hostingsEnded && { hostingsEnded }) };
  if (awayNow((await db.prepare("SELECT * FROM away WHERE kind = 'away'").all()).results, now)) return { away: true, ...daily };
  const shopday = await shopdayReminders(env, now); // מ25: at the summary's hour, the day before the big shop
  const prefs = await allPrefs(env);
  const quiet = await quietNow(env, now);
  const devices = (await db.prepare("SELECT * FROM devices WHERE kind = 'app' AND push_on = 1 AND push_sub IS NOT NULL").all()).results.filter((d) => d.digest_sent !== l.date && prefs(d.user_id).expiry !== false && !quiet(d.user_id));
  // r12 q029 (0b part 5): at most two a day of what Shuki sends by himself. "Runs out soon" goes first, then what waited
  // from yesterday, the monthly summary, the weekly check and "still want it?"; past two, what belongs to today is
  // dropped, the rest waits for tomorrow
  if (!devices.length) return { sent: 0, ...daily, ...await weekly(env, now, set) };

  // 0b: each phone gets what its person may see: someone else's private product is never in their 20:00 push
  const medCat = (await db.prepare('SELECT id FROM categories WHERE name = ?').bind(MED_CATEGORY).first())?.id;
  const warned = new Set((await db.prepare("SELECT key FROM settings WHERE key LIKE 'med_warned:%'").all()).results.map((r) => r.key));
  const medKey = (x) => `med_warned:${x.p.id}:${x.e}`;
  const dayNo = (ts) => Date.parse(`${local(ts, HOUSE.tz).date}T00:00:00Z`) / DAY;
  const forWhom = new Map(); const medDone = new Map();
  async function messagesFor(uid) {
    if (forWhom.has(uid)) return forWhom.get(uid);
    const S = await loadAll(db, { id: uid });
    const byProduct = {};
    for (const b of S.batches) (byProduct[b.product_id] ||= []).push(b);
    // medicines keep for long: they're said a month ahead, once per expiry date (decision 84); the rest two days ahead
    // a private product's expiry isn't pushed at all (r11, decided 6; the owner 06/10, r7b): it stays on its own inventory screen
    // מ6 (q016): a medicine of one person goes to them alone; a child's, to the grown-ups instead (question 36)
    const role = (id) => S.users.find((u) => u.id === id)?.role;
    const medFor = (p) => p.owner == null || (role(p.owner) === 'child' ? role(uid) !== 'child' : p.owner === uid);
    const exp = expiring(S.products, byProduct, now, 30).filter((x) => x.p.private_to == null && (x.p.category_id === medCat ? medFor(x.p) && !warned.has(medKey(x)) : x.e <= now + 2 * DAY));
    for (const x of exp) if (x.p.category_id === medCat) medDone.set(medKey(x), x);
    const items = exp.map((x) => { const d = local(x.e, HOUSE.tz).date.split('-'); return { name: x.p.name, days: dayNo(x.e) - dayNo(now), date: `${+d[2]}.${+d[1]}` }; });
    let month = {};
    if (l.day === 1) {
      const from = monthStart(now - 2 * DAY), to = monthStart(now);
      const off = (await db.prepare('SELECT COUNT(*) AS n FROM events WHERE off_list > 0 AND undone IS NULL AND private_to IS NULL AND ts >= ? AND ts < ?').bind(from, to).first()).n;
      const wasted = (await db.prepare('SELECT DISTINCT p.name FROM events e JOIN products p ON p.id = e.product_id WHERE e.waste = 1 AND e.undone IS NULL AND p.private_to IS NULL AND e.ts >= ? AND e.ts < ?').bind(from, to).all()).results.map((r) => r.name); // for the whole house, nothing private (r12 q013)
      // what has been in the freezer longest (from its last purchase, or when it was first counted)
      const freezerIds = new Set(S.locations.filter((x) => isFreezer(x.name)).map((x) => x.id)); // every freezer ("מקפיא במרפסת" too, r0t d83)
      const bought = Object.fromEntries((await db.prepare("SELECT product_id, MAX(ts) AS ts FROM product_log WHERE kind = 'purchase' GROUP BY product_id").all()).results.map((r) => [r.product_id, r.ts]));
      const freezer = S.products.filter((p) => freezerIds.has(p.location_id) && !isOut(p) && p.private_to == null).map((p) => ({ name: p.name, months: Math.floor((now - (bought[p.id] || p.created || now)) / (30 * DAY)) })).filter((x) => x.months >= 1).sort((a, b) => b.months - a.months);
      // decision 128: one line on what Shuki learned last month (rules approved, and the things he noticed that got a yes)
      const taught = (await db.prepare("SELECT text FROM lessons WHERE added >= ? AND added < ? ORDER BY added").bind(from, to).all()).results.map((r) => r.text);
      // and what Shuki noticed that got a "yes" last month (r0t d128), in the words of "I noticed that…"
      const yes = (await db.prepare("SELECT n.* FROM settings s JOIN noticed n ON s.key = 'noticed_yes:' || n.id WHERE s.key LIKE 'noticed_yes:%' AND n.status = 'yes' AND CAST(s.value AS INTEGER) >= ? AND CAST(s.value AS INTEGER) < ? ORDER BY CAST(s.value AS INTEGER)").bind(from, to).all()).results;
      for (const r of yes) { const t = noticedText(r, { users: S.users || [], products: S.products, categories: S.categories, locations: S.locations }); if (t) taught.push(t); }
      // מ23 (q071, q099): the same product bought by two people on the same day (the house's day), last month; from the
      // product log (one row a product, also in "קניתי חלב ולחם"), not a hosting buy (not logged), nothing private, nobody named
      const buys = (await db.prepare(`SELECT pl.product_id, pl.ts, e.user_id, p.name FROM product_log pl JOIN events e ON e.id = pl.event_id JOIN products p ON p.id = pl.product_id
        WHERE pl.kind = 'purchase' AND e.undone IS NULL AND e.private_to IS NULL AND p.private_to IS NULL AND pl.ts >= ? AND pl.ts < ? ORDER BY pl.ts`).bind(from, to).all()).results;
      const byDay = new Map();
      for (const b of buys) { const k = `${b.product_id}|${local(b.ts, HOUSE.tz).date}`; if (!byDay.has(k)) byDay.set(k, { name: b.name, who: new Set() }); byDay.get(k).who.add(b.user_id); }
      const doubles = [...byDay.values()].filter((x) => x.who.size >= 2).map((x) => x.name);
      month = { offListLastMonth: off, wasted, freezer, taught, doubles, month: MONTHS[Number(local(now - 2 * DAY, HOUSE.tz).month.split('-')[1]) - 1] };
    }
    const all = digestMessages({ expiring: items, day: l.day, ...month });
    const msgs = [];
    for (const m of all.filter((x) => x.title === 'תוקף')) if (await useShukiPush(db, uid, now)) msgs.push(m); // today's, or not at all
    const waiting = [...await laterOf(db, uid), ...all.filter((x) => x.title !== 'תוקף')], still = [];
    for (const m of waiting) (await useShukiPush(db, uid, now) ? msgs : still).push(m);
    await setLater(db, uid, still);
    forWhom.set(uid, msgs);
    return msgs;
  }
  let sent = 0, count = 0;
  for (const d of devices) {
    const messages = await messagesFor(d.user_id); count += messages.length;
    let gone = false;
    for (const m of messages) {
      const status = await push(env, JSON.parse(d.push_sub), m).catch(() => 0);
      if (status === 404 || status === 410) { gone = true; break; }
      if (status && status < 300) sent++;
    }
    await db.prepare(gone ? 'UPDATE devices SET push_sub = NULL, digest_sent = ? WHERE id = ?' : 'UPDATE devices SET digest_sent = ? WHERE id = ?').bind(l.date, d.id).run();
  }
  for (const k of medDone.keys()) await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(k, String(now)).run();
  const messages = { length: count };
  const extra = await weekly(env, now, set);
  return { ...shopday, sent, messages: messages.length, ...(env.TEST_RESET === '1' && { digestFor: Object.fromEntries(forWhom) }) /* the words per person, for the tests only */, ...daily, ...buys, ...extra, ...(reminders.length && { reminders: reminders.length, ...(env.TEST_RESET === '1' && { reminderBodies }) }), ...(hostingsEnded && { hostingsEnded }) };
}

/** Once a week pick products to double-check; once, 48 hours on, ask about each "let's think about it". */
async function weekly(env, now, set) {
  const db = env.DB; const out = {};
  const at = Number(set.recount_at || 0);
  if (!at) await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_at', ?)").bind(String(now)).run(); // first week: just start the clock
  else if (now - at >= 7 * DAY - 3600e3) {
    const S = await loadAll(db, SHARED);
    const ids = recountPick(S.products, now, 5);
    if (ids.length >= 3) {
      await db.batch([
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_at', ?)").bind(String(now)),
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_ids', ?)").bind(JSON.stringify(ids)),
      ]);
      out.recount = ids.length;
      const msg = { title: 'בדיקה שבועית', body: `${ids.length === 1 ? 'שאלה קצרה אחת' : `${ids.length} שאלות קצרות`}, כדי שהמלאי יישאר מעודכן.`, url: './#chat' };
      // two a day at most (0b): whoever has had theirs gets it tomorrow, with the 20:00 push. In quiet hours and on Shabbat
      // it waits the same way, like any push Shuki sends by himself (decision 98, r0t d98)
      const quiet = await quietNow(env, now);
      for (const uid of await pushAll(env, msg, 'recount', async (u) => !quiet(u) && useShukiPush(db, u, now))) await setLater(db, uid, [...await laterOf(db, uid), msg]);
    }
  }
  const due = (await db.prepare("SELECT m.*, u.name FROM maybe m JOIN users u ON u.id = m.added_by WHERE m.decided IS NULL AND m.asked IS NULL AND m.kind != 'remind' AND m.added + ? <= ?").bind(MAYBE_WAIT, now).all()).results;
  const maybeBodies = []; let hiddenN = 0;
  for (const m of due) {
    // a private one, or of a private product, isn't pushed at all (the owner 06/10, r7b): it stays under "אולי לקנות", for them alone
    const hidden = m.private_to != null || (m.product_id != null && (await db.prepare('SELECT private_to FROM products WHERE id = ?').bind(m.product_id).first())?.private_to != null);
    if (hidden) { await db.prepare('UPDATE maybe SET asked = ? WHERE id = ?').bind(now, m.id).run(); hiddenN++; continue; }
    if (!(await useShukiPush(db, m.added_by, now))) continue; // two a day at most (0b): asked tomorrow (not marked asked)
    const body = `האם להוסיף ${m.text} לרשימה, או לוותר הפעם?`; // 17/10, ש5 (the tone): no "עברו יומיים"
    await pushMine(env, { id: m.added_by, name: m.name }, { title: `לגבי ${m.text}`, body, url: './#list' }, 'reminders');
    await db.prepare('UPDATE maybe SET asked = ? WHERE id = ?').bind(now, m.id).run();
    maybeBodies.push(body);
  }
  if (due.length - hiddenN) out.maybeAsked = due.length - hiddenN;
  if (env.TEST_RESET === '1' && maybeBodies.length) out.maybeBodies = maybeBodies; // the words, for the tests only
  return out;
}

/** Push to everyone's phones. `allow(userId)`: may this person get it now; returns the people it was held back from. */
async function pushAll(env, message, kind = 'recount', allow = async () => true) {
  const prefs = await allPrefs(env);
  const devs = (await env.DB.prepare("SELECT id, user_id, push_sub FROM devices WHERE kind = 'app' AND push_on = 1 AND push_sub IS NOT NULL").all()).results.filter((d) => prefs(d.user_id)[kind] !== false);
  const ok = new Map(), held = [];
  for (const d of devs) {
    if (!ok.has(d.user_id)) { const y = await allow(d.user_id); ok.set(d.user_id, y); if (!y) held.push(d.user_id); }
    if (ok.get(d.user_id) && env.VAPID_PRIVATE_JWK) await push(env, JSON.parse(d.push_sub), message).catch(() => 0);
  }
  return held;
}
/** r12 q029: what Shuki sends by himself, two a day per person (the counter goes with the day, runSchedule). */
const PUSHES_A_DAY = 2;
async function useShukiPush(db, uid, now) {
  const r = await db.prepare("INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1 WHERE CAST(value AS INTEGER) < ?").bind(`pushes:${uid}:${local(now, HOUSE.tz).date}`, PUSHES_A_DAY).run();
  return (r.meta?.changes || 0) > 0;
}
/** What waits for tomorrow's 20:00 push (the monthly summary, the weekly check). */
const laterOf = async (db, uid) => JSON.parse((await db.prepare('SELECT value FROM settings WHERE key = ?').bind(`later:${uid}`).first())?.value || '[]');
const setLater = (db, uid, msgs) => (msgs.length ? db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`later:${uid}`, JSON.stringify(msgs)) : db.prepare('DELETE FROM settings WHERE key = ?').bind(`later:${uid}`)).run();
/** Which notifications each person wants (all on unless they turned one off). */
export const NOTIFY_KINDS = ['shopping', 'expiry', 'reminders', 'messages', 'recount', 'requests'];
function notifyPrefs(set, uid) { let p = {}; try { p = JSON.parse(set[`notify:${uid}`] || '{}'); } catch { /* bad row */ } return Object.fromEntries(NOTIFY_KINDS.map((k) => [k, p[k] !== false])); }
/**
 * Quiet hours (decision 98): no push 23:00-07:00, and for whoever keeps Shabbat also Friday 16:00 - Saturday 19:00.
 * Whoever is in the store right now still hears what was added to the list.
 */
export function isQuiet(now, tz, shabbat) {
  const l = local(now, tz);
  if (isNight(now, tz)) return true; // the app's one night (public/night.js, stage 10 decision 4)
  return !!shabbat && ((l.wd === 5 && l.hour >= 16) || (l.wd === 6 && l.hour < 19));
}
async function quietNow(env, now = Date.now()) {
  const keep = new Set((await shabbatKeepers(env.DB)).map((u) => u.id));
  const shopping = new Set((await openTrips(env, now)).map((t) => t.user_id));
  return (uid) => !shopping.has(uid) && isQuiet(now, HOUSE.tz, keep.has(uid));
}
async function allPrefs(env) {
  const rows = (await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'notify:%'").all()).results;
  const set = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return (uid) => notifyPrefs(set, uid);
}

export default {
  async fetch(req, env, ctx) {
    // stage 0 measurement only: a fixed clock, so every run sends the model the same prompt (never set in production)
    if (env.FIXED_NOW) Date.now = () => Number(env.FIXED_NOW);
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return handleApi(req, await withHouse(env), ctx);
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return handleMcp(req, await withHouse(env));
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) {
    // the same fixed clock as fetch() (tests only): wrangler's /__scheduled sets scheduledTime from the real one
    if (env.FIXED_NOW) Date.now = () => Number(env.FIXED_NOW);
    const at = env.FIXED_NOW ? Number(env.FIXED_NOW) : (event.scheduledTime || Date.now());
    ctx.waitUntil(withHouse(env).then((e) => runSchedule(e, at)).then((r) => console.log('schedule', new Date(at).toISOString(), JSON.stringify(r))));
  },
};
