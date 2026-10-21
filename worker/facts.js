// What Shuki knows about the people and the house (stage 0c, docs/stage0-0c-proposal.md): one table, one filter.
// The server decides what is private, by the key; a key that isn't in the list is refused (an emotional state has no
// key: r11 q014). Facts are only about people who live in the house (r11, decided after the round, 7).
import { newId } from './store.js';
import { norm } from './domain.js';
import { byPerson } from '../public/hebrew.js';

/** about: who it can be about · private: 1 = only the person themself, always · multi: more than one value at a time */
export const KEYS = {
  diet: { about: 'person', private: 0 }, // vegetarian, vegan, eats fish
  allergy: { about: 'person', private: 0, multi: true },
  avoid: { about: 'person', private: 0, multi: true }, // doesn't eat X
  kosher: { about: 'person', private: 0 },
  shabbat: { about: 'person', private: 0 },
  period: { about: 'person', private: 0 }, // keto, a diet: with until
  likes: { about: 'person', private: 0, multi: true }, // favourite dishes
  suggest_optin: { about: 'person', private: 0 },
  shopday_optin: { about: 'person', private: 0 }, // מ25: a reminder the evening before the big shop
  soon_optin: { about: 'person', private: 0 }, // מ26: what is about to run out, when going shopping
  substitute: { about: 'person', private: 0, multi: true }, // { from: { id, name }, to: { id, name } } (r10 q036)
  fasting: { about: 'person', private: 0 },
  training: { about: 'person', private: 0 },
  no_ask: { about: 'person', private: 0, multi: true }, // "stop asking about…"
  pregnancy: { about: 'person', private: 1 }, // r11 q008, r10 q109
  health: { about: 'person', private: 1, multi: true },
  meat_milk_wait: { about: 'house', private: 0 },
  appliance: { about: 'house', private: 0, multi: true },
  broken: { about: 'house', private: 0, multi: true }, // with until
  habit: { about: 'house', private: 0, multi: true },
  kitniyot: { about: 'house', private: 0 }, // does the house eat kitniyot on Passover: "כן" / "לא" (c11, r0t trim)
};
/** פ5 (the owner 06/10, r7b): the value of the health fact after "לזכור?" about an eating disorder: no calories or weight. */
export const ED_VALUE = 'בלי קלוריות ומשקל';
const HOUSE_WORDS = /^(הבית|בית|כולם|house)$/;

/** Who a fact action is about: { about, about_id, user } or an error in Hebrew for the model. */
export function subjectOf(a, state, user) {
  const k = KEYS[a.key];
  if (!k) return { error: `fact: אין מפתח "${a.key}". מה שאין לו מפתח הוא כלל (lesson). מצב רגשי לא נשמר בכלל` };
  if (k.about === 'house') return HOUSE_WORDS.test(String(a.about || 'הבית').trim()) || !a.about ? { about: 'house', about_id: 0 } : { error: `fact: ${a.key} הוא על הבית` };
  const name = String(a.about || user.name).trim();
  const who = (state.users || []).find((u) => u.name === name && u.active !== 0);
  if (!who) return { error: `fact: "${name}" לא גר בבית. על מי שלא גר בבית אני לא שומר מידע` };
  if (user.role === 'child' && who.id !== user.id) return { error: 'fact: ילד לא מספר עובדות על אחרים' };
  return { about: 'person', about_id: who.id, user: who };
}

/** A fact action checked before it's proposed: '' when it's fine. */
export function factProblem(a, state, user) {
  const s = subjectOf(a, state, user);
  if (s.error) return s.error;
  // a private fact only from the person themself: told by someone else, even the question would show it
  if (KEYS[a.key].private && s.about_id !== user.id) return `fact: ${a.key} נשמר רק כשהאדם עצמו מספר`;
  if (!String(a.value ?? '').trim()) return 'fact: חסר value';
  // no substitute for cleaning or toiletries (r10 q043, r0t r10-14): soap is soap
  if (a.key === 'substitute') {
    const cat = Object.fromEntries((state.categories || []).map((c) => [c.id, c.name]));
    const v = norm(typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value));
    const hit = (state.products || []).find((p) => !p.deleted && /^(ניקיון|טואלטיקה)/.test(cat[p.category_id] || '') && v.includes(norm(p.name)));
    if (hit) return `fact: אין תחליף במוצרי ניקיון וטואלטיקה (${hit.name}). אל תשמור`;
  }
  if (!String(a.text || '').trim()) return 'fact: חסר text (המשפט בעברית, כמו בכלל)';
  return '';
}

const valueOf = (a) => (typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value).trim().slice(0, 200));
/** A fact's value as it's saved (the gate after a secret compares the same, worker/secret.js). */
export const factValue = valueOf;
const tsOf = (d) => { const t = d ? Date.parse(`${d}T12:00:00Z`) : NaN; return Number.isFinite(t) ? t : null; };

/**
 * Write one approved fact. `by` = who told it (in the action, for an ask answered by someone else); `user` = who
 * approved it now. A fact about yourself, or an adult's about a child, is confirmed; about another adult it waits
 * for them (r9 principle 5). Single-valued keys replace the old value. Returns { id, pending }.
 */
export async function writeFact(db, user, a, state, now = Date.now()) {
  const teller = (state.users || []).find((u) => u.id === (a.by ?? user.id)) || user;
  const s = subjectOf(a, state, teller);
  if (s.error) return { error: s.error };
  // r13l (l4): a child's pregnancy or health is never kept, whoever approves it (also a grown-up's card queued before this)
  if ((a.key === 'pregnancy' || a.key === 'health') && (teller.role === 'child' || s.user?.role === 'child')) return { error: 'fact: הריון ובריאות של ילד לא נשמרים' };
  const k = KEYS[a.key];
  const self = s.about === 'house' || s.about_id === teller.id;
  const forChild = s.user?.role === 'child' && teller.role !== 'child';
  // a child's fact about themself waits for a grown-up (question (b), docs/stage0-questions.md): the grown-up's yes approves it
  const confirmed = teller.role === 'child' ? (user.role !== 'child' ? user.id : null) : self || forChild ? teller.id : null;
  const value = valueOf(a);
  // private because of a secret: it replaces only private rows, never one the house sees (the owner 04/10)
  const onlyPrivate = a.private === true && s.about === 'person' && teller.role !== 'child' ? ' AND private = 1' : '';
  // מ11: a new period instead of one that is on takes what the old one changed (its links), or they'd never come back
  const old = a.key === 'period' ? (await db.prepare(`SELECT links, since FROM facts WHERE about = ? AND about_id = ? AND key = 'period' AND ended IS NULL AND links IS NOT NULL${onlyPrivate} ORDER BY id DESC LIMIT 1`).bind(s.about, s.about_id).first()) ?? null : null;
  // each link keeps when its own change began (`since`), so the window learn() skips starts there, not at the new row (the reviewer of 7bac8ec)
  const carried = old?.links ? (() => { try { return JSON.stringify(JSON.parse(old.links).map((l) => ({ ...l, since: l.since ?? old.since }))); } catch { return null; } })() : null;
  if (!k.multi) await forget(db, `about = ? AND about_id = ? AND key = ?${onlyPrivate}`, [s.about, s.about_id, a.key]);
  else await forget(db, `about = ? AND about_id = ? AND key = ? AND value = ?${onlyPrivate}`, [s.about, s.about_id, a.key, value]);
  let eventId = null;
  // only a fact the whole house may see, and that is confirmed, goes in the journal (in the words a rule uses today)
  // private: the key's own (health, pregnancy...) or the card's, made after a message marked secret (the owner 04/10)
  // (a person's fact, told by a grown-up: a child's is never private, the owner 02/10, 4; nor one about the house, nobody would see it)
  const priv = k.private || (a.private === true && s.about === 'person' && teller.role !== 'child') ? 1 : 0;
  if (!priv && confirmed) eventId = await taughtLine(db, teller, s, a.text, now, state.lines);
  // with ask_again, the question for that day in the model's words (r0t-2)
  const askText = tsOf(a.ask_again) && typeof a.ask_text === 'string' && a.ask_text.trim() ? a.ask_text.trim().slice(0, 200) : null;
  const r = await db.prepare('INSERT INTO facts (about, about_id, key, value, since, until, ask_again, ask_text, told_by, confirmed_by, private, source, chat_id, event_id, created, updated, links) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(s.about, s.about_id, a.key, value, now, tsOf(a.until), tsOf(a.ask_again), askText, teller.id, confirmed, priv, a.source || 'chat', a.chat_id ?? null, eventId, now, now, carried).run();
  return { id: r.meta?.last_row_id, pending: !confirmed, about: s.user || null };
}

/**
 * The journal's line for a fact someone taught (approved by the owner 15/10): "הילה לימדה אותי שהיא לא אוכלת כוסברה, ושהיא
 * פסקטריאנית, אוכלת דגים." About themself the name becomes he / she / they; about someone else (or the house) the text as
 * it is: "the owner לימד אותי שהילה צמחונית." No colon. All that one person taught about one subject in one message is one
 * line (`lines`, a Map the caller keeps for the message): the next fact is added to it with ", וש". A fact forgotten later
 * takes its whole line with it (forget): nothing of it stays in the journal. Returns the line's event id.
 */
async function taughtLine(db, teller, s, text, now, lines) {
  const esc = (x) => String(x || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let t = String(text || '').trim().replace(/[.!]+$/, '').slice(0, 200);
  if (s.about === 'person' && s.about_id === teller.id) { // "הילה לא אוכלת" / "היא לא אוכלת" / "שהילה…" → "היא לא אוכלת"; "אצלו…" stays
    const m = new RegExp(`^ש?(${esc(teller.name)}|הוא|היא|הם|הן)\\s+`).exec(t);
    if (m) t = `${byPerson(teller, 'הוא', 'היא', 'הם')} ${t.slice(m[0].length)}`;
  } else if (s.user?.name) t = t.replace(new RegExp(`^ש(?=${esc(s.user.name)}\\s)`), ''); // "שהילה צמחונית": no "ש" twice
  const key = `${teller.id}:${s.about}:${s.about_id}`, had = lines?.get(key);
  const clauses = [...(had?.clauses || []), t];
  const summary = `${teller.name} ${byPerson(teller, 'לימד', 'לימדה', 'לימדו')} אותי ש${clauses.join(', וש')}.`;
  if (had) { await db.prepare('UPDATE events SET summary = ? WHERE id = ?').bind(summary, had.id).run(); had.clauses = clauses; return had.id; }
  const id = newId();
  await db.prepare("INSERT INTO events (id, ts, user_id, type, summary) VALUES (?,?,?,'lesson',?)").bind(id, now, teller.id, summary).run();
  lines?.set(key, { id, clauses });
  return id;
}

/** The person a fact is about says yes: it's confirmed, and if the house may see it, it goes in the journal now. */
export async function confirmFact(db, user, id, text, now = Date.now()) {
  const f = await db.prepare("SELECT * FROM facts WHERE id = ? AND about = 'person' AND about_id = ? AND confirmed_by IS NULL").bind(id, user.id).first();
  if (!f) return false;
  let eventId = null;
  if (!f.private && text) eventId = await taughtLine(db, user, { about: 'person', about_id: user.id, user }, text, now);
  await db.prepare('UPDATE facts SET confirmed_by = ?, event_id = COALESCE(?, event_id), updated = ? WHERE id = ?').bind(user.id, eventId, now, id).run();
  return true;
}

/** Real deletion of the facts matching `where`, with the journal lines they wrote. */
export async function forget(db, where, binds = []) {
  const rows = (await db.prepare(`SELECT id, event_id FROM facts WHERE ${where}`).bind(...binds).all()).results;
  if (!rows.length) return 0;
  const ev = rows.map((r) => r.event_id).filter(Boolean);
  await db.batch([
    ...(ev.length ? [db.prepare('DELETE FROM events WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ev))] : []),
    db.prepare('DELETE FROM facts WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(rows.map((r) => r.id))),
  ]);
  return rows.length;
}
/** "Forget what I said" (r11 q016): what was learned from that message. */
export async function forgetChat(db, chatId, user) {
  // a rule learned from it goes too, with its "{name} taught me" journal line (0b part 4, the owner 02/10); only one this
  // person taught (a child's message can't take away a rule a grown-up approved)
  const rules = (await db.prepare('SELECT id, text, added_by FROM lessons WHERE chat_id = ? AND added_by = ?').bind(chatId, user.id).all()).results;
  // and "want me to remember…?" about it, still waiting for an answer (mine, or the grown-ups' about a child's)
  await db.batch([
    db.prepare("DELETE FROM settings WHERE key LIKE 'ask:%' AND (json_extract(settings.value, '$.from') = ? OR EXISTS (SELECT 1 FROM json_each(settings.value, '$.actions') j WHERE json_extract(j.value, '$.chat_id') = ?))").bind(chatId, chatId), // `from`: a vacation question of it (66)
    // and what waits in the queue from it (the owner 05/10, 65): forgetting a message forgets its waiting questions too
    db.prepare("UPDATE settings SET value = (SELECT json_group_array(json(q.value)) FROM json_each(settings.value) q WHERE NOT EXISTS (SELECT 1 FROM json_each(q.value, '$.ask.actions') j WHERE json_extract(j.value, '$.chat_id') = ?) AND (json_extract(q.value, '$.bubble.of') IS NULL OR json_extract(q.value, '$.bubble.of') != ?) AND (json_extract(q.value, '$.ask.from') IS NULL OR json_extract(q.value, '$.ask.from') != ?)) WHERE key LIKE 'askq:%'").bind(chatId, chatId, chatId),
    db.prepare("DELETE FROM chat WHERE json_extract(content, '$.of') = ?").bind(chatId), // all threads: the question to the grown-ups about it
  ]);
  if (rules.length) await db.batch(rules.flatMap((l) => [
    db.prepare("DELETE FROM events WHERE type = 'lesson' AND user_id IS ? AND substr(summary, -?) = ?").bind(l.added_by, ` אותי: ${l.text}`.length, ` אותי: ${l.text}`),
    db.prepare('DELETE FROM lessons WHERE id = ?').bind(l.id),
  ]));
  return forget(db, 'chat_id = ?', [chatId]);
}
/** Someone left the house (r11 q015): what Shuki knew about them goes; on what they told about others, their name goes. */
export async function forgetPerson(db, userId) {
  const n = await forget(db, "about = 'person' AND about_id = ?", [userId]);
  // the history stays, without the name (r11 q015, r0t p2, approved 03/10): "מי שגר כאן" / "מי שגרה כאן" in its place, and
  // the verb stays as it was written ("מי שגרה כאן קנתה חלב")
  const u0 = await db.prepare('SELECT name, gender FROM users WHERE id = ?').bind(userId).first();
  const u = u0 && { ...u0, name: u0.name.replace(/\u2060+$/, '') }; // a name freed when they left (stage 13, d4) reads as it was
  if (u?.name) await db.prepare('UPDATE events SET summary = ? || substr(summary, ?) WHERE user_id = ? AND substr(summary, 1, ?) = ?')
    .bind(byPerson(u, 'מי שגר כאן', 'מי שגרה כאן', 'מי שגרו כאן'), u.name.length + 1, userId, u.name.length + 1, `${u.name} `).run();
  // a rule that names them goes too ("כשדנה אומרת חלב…", the owner 06/10, r7b, question 15): the name, with the letters that
  // stick to a Hebrew word before it (כש, ל, ו…), as a whole word
  if (u?.name) {
    const re = new RegExp(`(?:^|[^\u05D0-\u05EA])[ובכלמשה]{0,3}${u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\u05D0-\u05EA])`);
    const named = (await db.prepare('SELECT id, text FROM lessons').all()).results.filter((l) => re.test(l.text || ''));
    if (named.length) await db.batch(named.map((l) => db.prepare('DELETE FROM lessons WHERE id = ?').bind(l.id)));
  }
  await db.batch([
    db.prepare('UPDATE facts SET told_by = NULL WHERE told_by = ?').bind(userId),
    db.prepare('UPDATE facts SET confirmed_by = NULL WHERE confirmed_by = ? AND about_id != ?').bind(userId, userId),
  ]);
  return n;
}
/* ---- stage 8 (docs/stage8-plan.md): Shuki's own marks about a person in settings ---- */
/**
 * A question Shuki asks once only, ever, per person (or 'house', once for the whole house) and kind ("askOnce": 'fish',
 * 'suggest', 'airfryer' for the house, 'boxes'…): true
 * the first time. The mark is written when the question is asked, not when it's answered, so one that was never answered
 * isn't asked again either. It isn't a fact: not in the journal, not in "מה שוקי למד".
 */
export async function askOnce(db, uid, kind, now = Date.now()) {
  return ((await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(`ask_once:${kind}:${uid}`, String(now)).run()).meta?.changes || 0) > 0;
}
/** Was it asked already? (reads only) */
export const askedOnce = async (db, uid, kind) => !!(await db.prepare('SELECT 1 AS x FROM settings WHERE key = ?').bind(`ask_once:${kind}:${uid}`).first());
/**
 * Someone left (question 105), or a restore brought back a copy from before they left: Shuki's marks about them go, as
 * their facts do (stage 8, question 21). One who comes back with the same id starts without them, and is asked again.
 */
export async function forgetMarks(db, uid) {
  await db.batch([
    db.prepare('DELETE FROM settings WHERE key LIKE ? OR key LIKE ? OR key LIKE ? OR key IN (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(`ask_once:%:${uid}`, `holiday:${uid}:%`, `shopday_sent:${uid}:%`, `period_done:${uid}`, `baby_born:${uid}`, `likes_asked:${uid}`, `recipe_tip:${uid}`, `suggest_day:${uid}`, `joinlife:${uid}`, `life_later:${uid}`, `ramadan_asked:${uid}`, `pregbasics_asked:${uid}`),
    db.prepare("DELETE FROM noticed WHERE kind = 'owner' AND user_id = ?").bind(uid), // מ1: "only they add…" was theirs alone
    db.prepare('UPDATE products SET responsible = NULL WHERE responsible = ?').bind(uid), // מ19: nobody is in charge of what they were (also after a restore)
    // מ29: their lines in what "להתחיל מהתחלה" keeps of whose a product was
    db.prepare("UPDATE settings SET value = (SELECT json_group_array(json(q.value)) FROM json_each(settings.value) q WHERE json_extract(q.value, '$.owner') != ?) WHERE key = 'relink_owner'").bind(uid),
    dropOrphanMarks(db),
  ]);
}
/** A period's "asked at its end" is the fact's (period_end:<fact id>): once the fact is gone, so is the mark. Also after any
 * restore, gone or not: a copy brings back marks of facts deleted since (facts aren't restored). */
export const dropOrphanMarks = (db) => db.prepare("DELETE FROM settings WHERE key LIKE 'period_end:%' AND CAST(substr(key, 12) AS INTEGER) NOT IN (SELECT id FROM facts)");

/**
 * א4 (stage 8): a period that ended ("כבר לא", "לא" to "still on keto?", fact_end) leaves a record of itself before the
 * fact goes: settings period_done:<person> = { value, since, until, ended, links, private }, so מ12 (stage 9) can ask
 * "להחזיר את הלחם לקבועים?". Not in a backup or a download (it may hold a private value), kept through a restore.
 */
export async function periodDone(db, ids, now = Date.now(), { who, onlyPrivate = false, own = false } = {}) {
  // only what the same delete really takes (the same rule as its forget): their own period, or (a card's fact_end) a shared
  // one they told; `own`: their own only (the "no" to a question, whose forget is about_id alone)
  const rows = (await db.prepare(`SELECT * FROM facts WHERE id IN (SELECT value FROM json_each(?)) AND about = 'person' AND key = 'period'
    AND (about_id = ?${own ? '' : ' OR (private = 0 AND told_by = ?)'})${onlyPrivate ? ' AND private = 1' : ''}`).bind(JSON.stringify(ids.map(Number)), who ?? -1, ...(own ? [] : [who ?? -1])).all()).results;
  if (rows.length) await db.batch(rows.map((f) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`period_done:${f.about_id}`,
    JSON.stringify({ value: f.value, since: f.since, until: f.until, ended: now, links: f.links ? JSON.parse(f.links) : [], private: f.private ? 1 : 0 }))));
  // מ12 (q024): the period's window on each product it changed, for learn() to skip: only a product and dates, not who or
  // what the period was; not a private one's (the house sees no pace that changes because of it)
  const wins = rows.filter((f) => !f.private && f.links).flatMap((f) => { try { return JSON.parse(f.links).map((l) => ({ product_id: l.product_id, from: l.since ?? f.since, to: now })); } catch { return []; } });
  if (wins.length) {
    const cur = await db.prepare("SELECT value FROM settings WHERE key = 'pace_skip'").first();
    const all = [...(() => { try { return JSON.parse(cur?.value || '[]'); } catch { return []; } })(), ...wins]; // a broken value (a restore) doesn't stop the fact_end
    await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pace_skip', ?)").bind(JSON.stringify(all)).run();
  }
  return rows;
}

/** A message deleted for another reason (90 days, a restart): the fact stays, the link goes. */
export const unlinkGoneChats = (db) => db.prepare('UPDATE facts SET chat_id = NULL WHERE chat_id IS NOT NULL AND chat_id NOT IN (SELECT id FROM chat)').run(); // all threads: a link to any row that is gone

/**
 * The one filter (0c). The reader gets all their own facts, private ones too. About others and the house: only what
 * the house may see, confirmed and not past `until`. A child's private fact never reaches a parent or the admin
 * (r11 q008, r12 q015). An unconfirmed allergy is kept for the model as a caution (r9 "a red line for the whole house").
 * assistant: a connected assistant asking for the reader: nothing private, not even the reader's own (r11 q028).
 */
export async function factsFor(db, reader, { assistant = false, now = Date.now() } = {}) {
  const rows = (await db.prepare(`SELECT f.*, u.name AS about_name, u.gender AS about_gender FROM facts f
    LEFT JOIN users u ON f.about = 'person' AND u.id = f.about_id
    WHERE (f.until IS NULL OR f.until > ?) AND (f.about = 'house' OR u.active = 1) ORDER BY f.about, f.about_id, f.key, f.id`).bind(now).all()).results;
  return rows.filter((f) => {
    const mine = f.about === 'person' && f.about_id === reader?.id;
    if (assistant) return !f.private && !!f.confirmed_by;
    if (mine) return true;
    if (f.private) return false;
    return !!f.confirmed_by || f.key === 'allergy';
  });
}

/**
 * פ6 (question 50): a private fact of the person wins over the shared one, for them alone. On a key with one value, a
 * private row of theirs hides the shared row of that key; on a key with many, a row of theirs that ended (private = 1,
 * ended = 1) hides the shared one of that value. An ended row itself is never shown. Others see no change: the private
 * row is filtered out for them already (factsFor). The rows it was given stay on the list as `.all` (not in the JSON).
 */
export function mineWins(facts, meId) {
  const mine = facts.filter((f) => f.about === 'person' && f.about_id === meId && f.private);
  const out = facts.filter((f) => !f.ended && !beaten(f, mine, meId));
  out.all = facts.all || facts;
  return out;
}
/** Is this shared fact about the person hidden by a private row of theirs? */
const beaten = (f, mine, meId) => !f.private && f.about === 'person' && f.about_id === meId
  && mine.some((m) => m.key === f.key && (KEYS[f.key]?.multi ? m.ended && String(m.value) === String(f.value) : true));
/** Every row the reader may see, also what mineWins hid (the cached part of the prompt, the gate, fact_end). */
export const allFacts = (facts) => facts?.all || facts || [];

const show = (f) => { try { const v = JSON.parse(f.value); return v && typeof v === 'object' ? (v.from && v.to ? `${v.from.name} → ${v.to.name}` : f.value) : f.value; } catch { return f.value; } };
/**
 * 0.5 (stage 8, decisions 1–2, r8p 1 and 17): a diet value says they eat fish: "דג" in a part of the value (between
 * commas) with no "בלי" / "לא" / "ללא" / "אין" before it ("צמחונית, אוכלת דגים", "צמחונים, דגים מותר"; not "צמחונית, בלי
 * דגים" nor "לא אוכלת דגים"), or "פסקטרי". One rule for the "⚠" on a recipe (dietHits) and the line to the model below.
 */
export const eatsFish = (value) => /פסקטר/.test(String(value || '')) || affirms(value, /דג/);
/** A word said of the person, not denied: in a part of the value (between commas, periods or semicolons) with no "בלי" /
 * "לא" / "ללא" / "אין" before it, also with "ו" ("ולא"): "צמחונית, לא טבעונית" isn't vegan, "ולא אוכלת דגים" no fish. */
export const affirms = (value, re) => String(value || '').split(/[,،;.]/).some((part) => {
  const i = part.search(re);
  return i >= 0 && !/(^|\s)ו?(בלי|לא|ללא|אין)(\s|$)/.test(part.slice(0, i));
});
export const isVegan = (value) => affirms(value, /טבעונ/);
/** Vegetarian (also pescatarian), not vegan: the diets the "⚠" on meat, pork and gelatin is for (0.5) */
export const isVegetarian = (value) => (affirms(value, /צמחונ/) || /פסקטר/.test(String(value || ''))) && !isVegan(value);
// r9-12 (r0t trim): "צמחוני" doesn't eat fish until they say otherwise; the server says it, the instructions don't
const vegetarian = (f) => f.key === 'diet' && isVegetarian(f.value) && !eatsFish(f.value);
const line = (f, u) => `${f.key}: ${show(f)}${vegetarian(f) ? ` (${byPerson(u, 'לא אוכל', 'לא אוכלת', 'לא אוכלים')} דגים)` : ''}${f.until ? ` (עד ${new Date(f.until).toISOString().slice(0, 10)})` : ''}${f.confirmed_by ? '' : ' (עוד לא אושר)'}`;
/**
 * What the model gets (0e): the cached part is the same for whoever writes (the house's facts, and a line for each
 * person with what the house may see, plus unconfirmed allergies marked); the writer's own facts, private ones too,
 * go in the part without the cache.
 */
export function factsText(facts, users, me) {
  const shared = facts.filter((f) => !f.private && (f.confirmed_by || f.key === 'allergy'));
  const house = shared.filter((f) => f.about === 'house').map(line);
  const people = users.filter((u) => u.active !== 0).map((u) => { const fs = shared.filter((f) => f.about === 'person' && f.about_id === u.id); return fs.length ? `${u.name}: ${fs.map((f) => line(f, u)).join('; ')}` : null; }).filter(Boolean);
  // r10-4 (r0t trim): the writer's own substitute is marked, so "יש חלב?" is answered with theirs
  // פ6: a private row that wins over a shared one says so (for the model), an ended one says it's over for them, and the
  // shared row it hides isn't repeated here
  const own = facts.filter((f) => f.about === 'person' && f.about_id === me.id);
  const privs = own.filter((f) => f.private);
  const wins = (m) => own.some((f) => !f.private && f.key === m.key && (KEYS[m.key]?.multi ? m.ended && String(f.value) === String(m.value) : true));
  const WINS = ' (פרטי: גובר על מה שכתוב עליך למעלה)';
  const mine = own.filter((f) => !beaten(f, privs, me.id)).map((f) => (f.ended ? `${f.key}: ${show(f)}: נגמר${WINS}` : `${line(f, me)}${f.key === 'substitute' ? byPerson(me, ' (התחליף שלך)', ' (התחליף שלך)', ' (התחליף שלכם)') : ''}${f.private && wins(f) ? WINS : ''}`));
  return {
    cached: house.length || people.length ? `עובדות על הבית ועל האנשים (מה שגלוי לכל הבית; "עוד לא אושר" = מישהו אחר סיפר, עדיין זהירות):\n${[...house, ...people].join('\n')}` : '',
    writer: mine.length ? `העובדות של ${me.name} עצמו/עצמה/עצמם (כולל פרטיות: אל תספר אותן לאחרים):\n${mine.join('\n')}` : '',
  };
}

/* ---- Shabbat: a fact about the person now (it was the setting shabbat:<id>) ---- */
// פ6: who stopped in a secret (a private ended row of theirs) doesn't keep it, whatever the house's row says
const NOT_ENDED = "f.ended IS NULL AND NOT EXISTS (SELECT 1 FROM facts e WHERE e.about = 'person' AND e.about_id = f.about_id AND e.key = f.key AND e.private = 1 AND e.ended = 1)";
export const keepsShabbat = async (db, userId) => !!(await db.prepare(`SELECT 1 AS x FROM facts f WHERE f.about = 'person' AND f.about_id = ? AND f.key = 'shabbat' AND f.value = 'כן' AND ${NOT_ENDED}`).bind(userId).first());
export async function setShabbat(db, user, on, now = Date.now(), priv = false) {
  // private: said after a secret (the owner 04/10); who keeps Shabbat still gets no pushes then (shabbatKeepers doesn't look at it)
  // ...and the house's row stays (פ6): turned off over a shared "כן", a private ended row says so; on over it, nothing to write
  await forget(db, `about = 'person' AND about_id = ? AND key = 'shabbat'${priv ? ' AND private = 1' : ''}`, [user.id]);
  const shared = priv && !!(await db.prepare("SELECT 1 AS x FROM facts WHERE about = 'person' AND about_id = ? AND key = 'shabbat' AND value = 'כן' AND private = 0").bind(user.id).first());
  if (on ? !shared : shared) await db.prepare("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, ended, source, created, updated) VALUES ('person', ?, 'shabbat', 'כן', ?, ?, ?, ?, ?, 'settings', ?, ?)").bind(user.id, now, user.id, user.id, priv ? 1 : 0, on ? null : 1, now, now).run();
}
export const shabbatKeepers = async (db) => (await db.prepare(`SELECT u.id, u.name FROM facts f JOIN users u ON u.id = f.about_id WHERE f.about = 'person' AND f.key = 'shabbat' AND f.value = 'כן' AND u.active = 1 AND ${NOT_ENDED}`).all()).results;
/** An old backup restored: its shabbat:<id> settings become facts, only where there's none yet and only for who's in the house. */
export const shabbatFromSettings = (db, now = Date.now()) => db.prepare(`INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated)
  SELECT 'person', u.id, 'shabbat', 'כן', ?, u.id, u.id, 0, 'migration', ?, ? FROM settings s JOIN users u ON u.id = CAST(substr(s.key, 9) AS INTEGER)
  WHERE s.key LIKE 'shabbat:%' AND s.value = '1' AND u.active = 1 AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.about = 'person' AND f.about_id = u.id AND f.key = 'shabbat')`).bind(now, now, now).run();
