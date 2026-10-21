import { chatRows } from './thread.js';
import { byPerson, isWoman, isPlural } from '../public/hebrew.js';

// Distress (stage 0b, docs/stage0-0b-proposal.md §1; approved wording 02/10). The server finds it first, before any
// other route and any limit. A sure phrase gets the fixed words with no model; a suspicion asks the model, which answers
// `distress`. The message and the answer stay with the writer only, are marked sensitive and go after a week (r11 q013,
// q069–q074, q079, q036; r12 q049).

/** The text as it's matched: no niqqud, final letters as regular, a letter written 3+ times once, spaces squeezed. */
export function normalize(t) {
  return String(t || '')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[ךםןףץ]/g, (c) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[c])
    .replace(/(.)\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
// after normalize: final letters are regular (מ, נ, צ, כ, פ). A word may carry a prefix (ו, ש, כש, ה, ב, ל, מ).
const P = '(?:^|[\\s,.!?:;"\'״׳()\\[\\]-])[ושכהבלמ]{0,2}';
const WHO = '(?:אבא|אמא|בעלי|אשתי|בנ ?הזוג|בת ?הזוג|החבר|החברה|אבי|אמי)(?: שלי)?';
const HITS = '(?:מרביצ|מרביצה|מרביצימ|הרביצ|הרביצה|הרביצו|מכה|מכימ|היכה|הכה|היכתה|הכתה|הכו|היכו)';
/** Sure: the fixed words even with no model (r11 q071). kind: self | violence_home */
const SURE = [
  ['self', new RegExp(`${P}לא ?(?:רוצה|רוצימ) ?(?:יותר ?)?לחיות`)],
  ['self', new RegExp(`${P}אינ ?לי ?(?:בשביל|למה) ?(?:מה ?)?לחיות`)],
  ['self', new RegExp(`${P}(?:להתאבד|מתאבד|מתאבדת|אתאבד|התאבדות)`)],
  ['self', new RegExp(`${P}(?:לפגוע|פוגע|פוגעת|פגעתי) ?בעצמי`)],
  ['self', new RegExp(`${P}(?:לחתוכ|חותכ|חותכת|חתכתי) ?את ?עצמי`)],
  ['violence_home', new RegExp(`${P}${WHO} ?${HITS} ?(?:לי|אותי)`)],
];
/** A suspicion: the model decides (it may be "בא לי למות מבושה", or a brother). */
const SUSPECT = [
  /(?:בא ?לי|רוצה) ?למות/, /להיעלמ/, /אינ ?טעמ/,
  new RegExp(`${HITS} ?(?:לי|אותי)`),
  new RegExp(`${HITS} ?(?:ל|את ?)(?:אמא|אבא|אחי|אחותי|אחימ|אשתו|בעלה)`), // seen at home
  /פוחד(?:ת)? ?מ(?:מנו|מנה|המ)/, /אפ ?אחד ?לא ?אוהב ?אותי/, /כולמ ?צוחקימ ?עלי/,
  /ביקש ?ממני ?תמונ/, /ביקשה ?ממני ?תמונ/, /מאיימ(?:ת)? ?לפרסמ/, /שלח(?:ה)? ?לי ?תמונ/,
];
/** What the text is: { sure: kind } | { suspect: true } | null. */
export function distressOf(text) {
  const t = ` ${normalize(text)}`;
  for (const [kind, re] of SURE) if (re.test(t)) return { sure: kind };
  if (SUSPECT.some((re) => re.test(t))) return { suspect: true };
  return null;
}

/** "אבא ואמא לא יראו" / "אבא לא יראה" / "אמא לא תראה" / "אבא ואבא…" / "אמא ואמא…" / "ההורים…", by the grown-ups in the house. */
function parentsLine(users, user) {
  const wrote = byPerson(user, 'כתבת', 'כתבת', 'כתבתם'); // the child's own words: plural if they chose it
  const adults = (users || []).filter((u) => u.role !== 'child' && u.active !== 0), women = adults.filter(isWoman).length, men = adults.length - women;
  if (adults.length > 2) return `ההורים לא יראו את מה ש${wrote}.`; // 3 or more, as D9 (the owner 06/10, r7b)
  // who chose the plural (7ב, the owner r7d, 8ב): alone, by name; with another, "ההורים"
  if (adults.some(isPlural)) return adults.length === 1 ? `${adults[0].name} לא יראו את מה ש${wrote}.` : `ההורים לא יראו את מה ש${wrote}.`;
  if (men && women) return `אבא ואמא לא יראו את מה ש${wrote}.`;
  // two of the same, named twice, like D9 (approved 02/10)
  if (women > 1) return `אמא ואמא לא יראו את מה ש${wrote}.`;
  if (women) return `אמא לא תראה את מה ש${wrote}.`;
  if (men > 1) return `אבא ואבא לא יראו את מה ש${wrote}.`;
  return `אבא לא יראה את מה ש${wrote}.`;
}
/** The approved fixed words (02/10), exactly. kind: self | violence_home | online. */
export function distressWords(kind, user, users) {
  const trust = byPerson(user, 'שאתה סומך', 'שאת סומכת', 'שאתם סומכים'), here = `אני כאן ${byPerson(user, 'איתך', 'איתך', 'איתכם')}.`;
  if (user.role === 'child') {
    const p = parentsLine(users, user);
    if (kind === 'violence_home') return `${here} ${p} אפשר להתקשר ל-118, שם עונים על אלימות במשפחה. אם יש סכנה עכשיו, להתקשר למשטרה, 100. כדאי לספר גם למבוגר ${trust} עליו מחוץ לבית, כמו מורה או יועצת.`;
    if (kind === 'online') return `${here} ${p} אפשר להתקשר ל-105, שם עוזרים לילדים שנפגעו ברשת, בכל שעה. כדאי לספר גם למבוגר ${trust} עליו.`;
    return `${here} ${p} כדאי לספר למבוגר ${trust} עליו, כמו מורה או יועצת. אפשר גם לדבר עם ער"ן בטלפון 1201, בכל שעה. אם יש סכנה עכשיו, להתקשר למד"א בטלפון 101.`;
  }
  if (kind === 'violence_home') return `${here} אני ממליץ להתקשר לקו החם לאלימות במשפחה, בטלפון 118. אם יש סכנה מיידית, להתקשר למשטרה בטלפון 100. לא אספר על זה לאף אחד בבית.`;
  // D6, a grown-up harmed online (approved 02/10, question 14)
  if (kind === 'online') return `${here} אם מאיימים ${byPerson(user, 'עליך', 'עליך', 'עליכם')}, אפשר להתלונן במשטרה בטלפון 100. אם קשה ${byPerson(user, 'לך', 'לך', 'לכם')}, אפשר לדבר עם ער"ן בטלפון 1201, בכל שעה.`;
  return `${here} אפשר לדבר עכשיו עם ער"ן בטלפון 1201, בכל שעה. אם יש סכנה מיידית, להתקשר למד"א בטלפון 101. האם יש מישהו קרוב שיכול להיות ${byPerson(user, 'איתך', 'איתך', 'איתכם')} עכשיו?`;
}

/** The model's warm word, kept only if it is one sentence with no emoji and no phone number (§1). */
export function warmWord(reply) {
  const t = String(reply || '').trim();
  if (!t || /\d/.test(t) || /\p{Extended_Pictographic}/u.test(t)) return '';
  if (t.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length !== 1) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** For the model, with a suspicion: what to answer (text for the model, not for the user). */
export const SUSPECT_NOTE = '(השרת: ייתכן שזו הודעת מצוקה. החזר distress: self = מחשבות לפגוע בעצמו או למות, violence_home = אלימות בבית, online = פגיעה ברשת, none = לא מצוקה (גוזמה, אח שמרביץ במשחק, בקשה רגילה). אם יש מצוקה: reply = משפט חם אחד בלבד, בלי מספרי טלפון ובלי פעולות; השרת מוסיף את הנוסח הקבוע.)';

export const SENSITIVE_DAYS = 7; // r11 q013
export const CHILD_AFTER_MS = 24 * 3600e3; // the owner 02/10: a child's messages for 24 hours after are hidden from the parent

/**
 * Answer a distress: the writer's message and the fixed words are saved for the writer only and marked sensitive;
 * no card, no 👍/👎 (no `ai`), no notification. warm = the model's sentence (suspicion path) or ''.
 */
export async function answerDistress(env, user, { kind, warm = '', chatId = null, text = '', image = false, users, now = Date.now() }) {
  const db = env.DB;
  const reply = `${warm ? `${warm} ` : ''}${distressWords(kind, user, users)}`;
  const mark = { only: user.id, sensitive: true };
  if (chatId) {
    const row = await db.prepare('SELECT content FROM chat WHERE id = ?').bind(chatId).first();
    if (row) await db.prepare('UPDATE chat SET content = ? WHERE id = ?').bind(JSON.stringify({ ...JSON.parse(row.content), ...mark }), chatId).run();
  } else {
    await db.batch(chatRows(db, now, user.id, 'user', { text, image, ...mark }));
  }
  await db.batch(chatRows(db, now + 1, null, 'shuki', { reply, face: 'understanding', for: user.id, distress: true, ...mark })); // t1 (stage 10, decision 1): "מבין", set by the server only (not in FACES) // q12: its numbers call, no 👍/👎
  // a child: what they write in the next 24 hours stays hidden from the parent too
  if (user.role === 'child') await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(`distress:${user.id}`, String(now)).run();
  return { reply, face: 'understanding', distress: true };
}

/** A child within 24 hours of a distress: their messages and the answers are kept as sensitive too. */
export async function stillSensitive(db, user, now = Date.now()) {
  if (user.role !== 'child') return false;
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(`distress:${user.id}`).first();
  return !!r && now - Number(r.value) < CHILD_AFTER_MS;
}

/** The 24-hour mark of a child's distress: a setting that never leaves the server (state, export, backup). */
export const isDistressKey = (k) => /^distress:/.test(String(k));

/** The week is over (r11 q013): sensitive messages go, and what pointed at them; a child's 24-hour mark goes when it's over. */
export async function forgetSensitive(db, now = Date.now()) {
  await db.prepare("DELETE FROM settings WHERE key LIKE 'distress:%' AND CAST(value AS INTEGER) < ?").bind(now - CHILD_AFTER_MS).run();
  const n = (await db.prepare(`DELETE FROM chat WHERE ts < ? AND content LIKE '%"sensitive":true%'`).bind(now - SENSITIVE_DAYS * 86400e3).run()).meta?.changes || 0; // all threads: what's sensitive goes after a week, in every thread
  if (n) await db.prepare('UPDATE facts SET chat_id = NULL WHERE chat_id IS NOT NULL AND chat_id NOT IN (SELECT id FROM chat)').run(); // all threads: a link to any row that is gone
  return n;
}
