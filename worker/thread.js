// Stage 0b: a chat for each person (docs/stage0-0b-proposal.md §2). Every row written to `chat` goes through here, so its
// thread follows one rule (the same as migration 0017): thread → only → each `to` (minus notFor) → for → NULL.
// A user's own message is in their thread. NULL = a house message from the server, for everyone.
import { local, HOUSE } from './domain.js';

export function threadsOf(userId, role, content) {
  const c = content || {};
  if (c.thread !== undefined) return [c.thread];
  if (role === 'user') return [userId ?? null];
  if (c.only != null) return [Number(c.only)];
  if (Array.isArray(c.to) && c.to.length) { const to = c.to.map(Number).filter((x) => x !== Number(c.notFor)); if (to.length) return to; }
  if (c.for != null) return [Number(c.for)];
  return [null];
}

/** The statements that write one message: a row for each thread it goes to (for db.batch). */
export const chatRows = (db, ts, userId, role, content) => threadsOf(userId, role, content).map((t) =>
  db.prepare('INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?,?,?,?,?)').bind(ts, userId ?? null, role, JSON.stringify(content), t));

/** Where a person's own chat is read from: their thread and the house messages (thread NULL). */
export const MINE = '(thread = ? OR thread IS NULL)';

/**
 * r12 q031, q032 (0b part 5): a card from the server (a house message with buttons) is one at a time, and one nobody
 * answered goes after a day. `serverCardUp`: is one up now (so another waits).
 */
export const CARD_DAY = 86400e3;
// a morning card with `day` (the owner 13/10) is good until that day ends: after it, it isn't up, nor answered, nor shown
const LIVE_DAY = "(json_extract(content, '$.day') IS NULL OR json_extract(content, '$.day') >= ?)";
export const dayOver = (c, now) => !!c?.day && c.day < local(now, HOUSE.tz).date;
// `card: 1` marks such a card (cards written before 0b keep their place in the history); `answered`, that someone did
// stage 8 (א4): a card to one person (a period that ended) is in their own thread, and counts as one at a time too
export const serverCardUp = async (db, now) => !!(await db.prepare(`SELECT 1 AS x FROM chat WHERE role = 'shuki' AND ts > ? AND json_extract(content, '$.card') = 1 AND json_extract(content, '$.answered') IS NULL AND ${LIVE_DAY} LIMIT 1`).bind(now - CARD_DAY, local(now, HOUSE.tz).date).first()); // all threads: a card from the server, the house's or one person's (א4), is one at a time for the whole house
/**
 * Someone answered a card from the server: it stays, and the next one may come. With one of its buttons, or (the owner 05/10,
 * as "להחליף") with any next message, free text or a photo: the next message closes it, and the other cards come back.
 * Only a message of whom it speaks to (`for` / `to`); a card to the whole house, only a grown-up's (the owner 05/10, 65).
 */
export async function answerServerCard(db, text, now, user) {
  const row = await db.prepare(`SELECT id, content FROM chat WHERE (thread IS NULL OR thread = ?) AND role = 'shuki' AND ts > ? AND ts <= ? AND json_extract(content, '$.card') = 1 AND json_extract(content, '$.answered') IS NULL AND ${LIVE_DAY} ORDER BY ts DESC LIMIT 1`).bind(user?.id ?? -1, now - CARD_DAY, now, local(now, HOUSE.tz).date).first();
  if (!row) return;
  const c = JSON.parse(row.content), to = Array.isArray(c.to) ? c.to : c.for != null ? [c.for] : null;
  if (to ? !to.includes(user?.id) : user?.role === 'child') return;
  await db.prepare("UPDATE chat SET content = json_set(content, '$.answered', 1) WHERE id = ?").bind(row.id).run();
}
