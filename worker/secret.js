// After a secret (a message marked secret, the first answer to Shuki's offer after one, or one the model marked personal),
// only what can be the writer's alone is kept (the owner 04/10). One list of every kind that reaches execute() and
// applyProposal(): allowed (and how it stays the writer's), or dropped. A kind in neither fails test/secret-kinds.test.js.
import { subjectOf, KEYS, factValue } from './facts.js';

/** Kept after a secret, marked private: the server makes each the writer's alone (or nothing, when there's nothing of theirs). */
export const SECRET_ALLOWED = [
  'create', // a private product
  'list_add', // a private line; on a shared product, the writer's own copy (21(א))
  'op', 'edit', // on the writer's own copy, made if there's none
  'delete', 'confirm', // only on the writer's own copy; otherwise nothing ("לא היה מה לעדכן.")
  'check', 'arrived', // the writer's own copy bought; the shared line stays
  'order', // the writer's own line, ordered
  'list_remove', 'uncheck', 'keep', // only on the writer's own line; otherwise nothing
  'remind', 'routine', // private_to (migration 0024)
  'fact', // only about the writer, private
  'shabbat', // a fact about the writer, private
  'fact_end', // only a fact about the writer
  'undo', // the writer's own last action; its line is private when the original was
  'cancel', // closes a card, keeps nothing
  'alias', 'photo', // only on the writer's own private product
  'tell', // only with a recipient (`to`): the writer chose whom to tell
];
/** Dropped after a secret: the house's, or seen by others. */
export const SECRET_DROPPED = [
  'lesson', 'leftover', 'recipe', 'recipe_note', 'favorite', 'moving', 'plan', // the house's (plan: home20, the weekly plan)
  'away', 'guests', 'hosting', 'shopping', 'catalog_area', 'kitniyot', // states of the house, and "X is at the store"
  'approve', 'fact_confirm', 'fact_keep', 'fact_share', 'finish', // seen by others; answers to Shuki's own questions
];

/**
 * The actions of a secret turn: only what's allowed, each the writer's alone. `S`: { users, products, facts } as the
 * writer sees them (facts with about, about_id, key, value, private). Returns { kept, dropped, nothing }: `nothing` are
 * the dropped ones that would change nothing she sees of a shared fact about her, which says "לא היה מה לעדכן." (the owner
 * 04/10; פ6).
 */
export function secretGate(actions, user, S) {
  const kept = [], dropped = [], nothing = [];
  const aboutMe = (a) => { const s = subjectOf(a, S, user); return s.about === 'person' && s.about_id === user.id; };
  // a fact about the writer the whole house sees: a secret doesn't change it; a private row of hers wins over it, for her
  // alone (פ6, question 50). Only a private write that changes nothing she sees (the shared one's value, "אני שומרת שבת"
  // when Shabbat is "כן") is "לא היה מה לעדכן."; a change, an end or Shabbat turned off is kept, private
  const me = (S.facts || []).filter((f) => f.about === 'person' && f.about_id === user.id);
  const same = (f, key, value) => f.key === key && (value == null || String(f.value) === String(value));
  const shared = (key, value) => me.some((f) => !f.private && same(f, key, value));
  const ended = (key, value) => me.some((f) => f.private && f.ended && same(f, key, value));
  const ownRow = (key) => me.some((f) => f.private && !f.ended && f.key === key);
  const onShared = (a) => user.role !== 'child' && ((a.kind === 'fact' && KEYS[a.key] && shared(a.key, factValue(a)) && !ended(a.key, KEYS[a.key].multi ? factValue(a) : null) && (KEYS[a.key].multi || !ownRow(a.key)))
    || (a.kind === 'shabbat' && a.on !== false && shared('shabbat', 'כן') && !ended('shabbat')));
  const ok = (a) => {
    if (!SECRET_ALLOWED.includes(a.kind)) return false;
    if (onShared(a)) { nothing.push(a); return false; }
    if (a.kind === 'fact') return aboutMe(a);
    if (a.kind === 'fact_end') {
      const ids = (a.ids || []).map(Number);
      return ids.length > 0 && ids.every((id) => (S.facts || []).some((f) => f.id === id && f.about === 'person' && f.about_id === user.id));
    }
    if (a.kind === 'tell') return !!String(a.to || '').trim();
    if (a.kind === 'alias' || a.kind === 'photo') return (S.products || []).some((p) => p.id === Number(a.product_id) && p.private_to === user.id);
    return true;
  };
  // ending a shared fact about her: it ends for her alone (a private ended row, applyProposal, פ6)
  for (const a of actions) {
    if (!ok(a)) { dropped.push(a); continue; }
    kept.push(a.kind === 'undo' || a.kind === 'cancel' || a.kind === 'tell' ? a : { ...a, private: true });
  }
  return { kept, dropped, nothing };
}

// "I'll remember", "saved", "wrote down"
const KEPT_WORDS = /(אזכור|לזכור|שאזכור|זוכר|זוכרת|שמרתי|אשמור|לשמור|שאשמור|רשמתי|ארשום|לרשום|שארשום)/;
const nameOfAction = (a, products) => String(a.text || a.name || a.value || a.alias || (products || []).find((p) => p.id === Number(a.product_id))?.name || '').trim();
/**
 * The answer of a secret turn, when something was dropped: a sentence that says it remembered or saved stays only when it
 * names something that is kept and nothing that isn't. Buttons of "remember?" go. Nothing new is said: an answer left
 * empty is "בסדר", with no period (decision 7, the owner 06/10, r7b). A sentence is also split before a "ו" stuck to a word of
 * saving ("אוסיף חלב לרשימה ואזכור ש…"), and a part left without its end gets a period: the model's own words (פ29).
 */
export function secretReply(reply, options, kept, dropped, products) {
  const has = (s, a) => { const n = nameOfAction(a, products); return n.length > 1 && s.includes(n); };
  const keeps = (s) => kept.some((a) => has(s, a)) && !dropped.some((a) => has(s, a));
  const parts = String(reply || '').split(/(?<=[.?!])\s+|\s+(?=ו(?:אזכור|אשמור|ארשום|שמרתי|רשמתי))/);
  const stays = parts.map((s) => (!KEPT_WORDS.test(s) && !dropped.some((a) => has(s, a))) || keeps(s));
  // a part whose next one went (or the last one) ends with a period, unless it ends already
  const rest = parts.map((s, i) => (!stays[i] ? '' : stays[i + 1] || /[.?!]\s*$/.test(s) || !s.trim() ? s : `${s.trim()}.`)).filter((s, i) => stays[i]).join(' ').trim();
  const opts = !kept.length || (options || []).some((o) => /תזכור|תזכרי|תשמור|תשמרי/.test(o)) ? undefined : options;
  return { reply: rest || 'בסדר', options: rest ? opts : undefined };
}

/**
 * Every write to the database in one turn of chat() (and chatTurn()) and in applyProposal(), outside execute(): each line
 * that writes, or calls a function that does, carries `// write:<name>` with a name from here (the owner 04/10). What it is,
 * whether another person sees it, and what a secret turn does to it. test/secret-writes.test.js finds the writers itself:
 * a write with no mark, or a mark not in this list, fails it.
 */
export const SECRET_WRITES = {
  turn: 'the turn itself (chatTurn), called by chat()',
  chat_save: "the writer's message and Shuki's answer, in her own chat: others don't see it; a secret turn marks them only/sensitive",
  distress: 'distress: what hides the message from a parent, or answers it: protective, unchanged',
  eating: 'the eating-disorder question, asked once (eating:<id>): hers, never in the state, the export or a backup',
  secret_mark: 'the message marked secret / only: protective, unchanged',
  take_back: '"forget what I said": her own chat and what came of it: unchanged',
  no_ask: '"stop asking": a fact about her; said as a secret, hers alone (private = 1)',
  self_lang: 'how Shuki talks to her (פ22): everyone sees the verbs; in a secret turn: not changed, she hears NOTHING_TO_UPDATE',
  self_name: 'her name (פ22): everyone sees it; in a secret turn: not changed, she hears NOTHING_TO_UPDATE',
  ask: "Shuki's question waiting for her answer (ask:, askq:): hers; it carries `secret`, so its \"yes\" goes through the gate",
  ask_state: 'kitniyot or a vacation from a waiting question: the house\'s; not kept when the question carries `secret`',
  card: "a card (proposals) and its status, applyProposal from the chat: it carries `secret`; the gate decides what's saved",
  execute: 'execute() and undoLast(): through the gate (each action the writer\'s alone), its journal line private',
  photo_wait: "the photo waiting for its card (photo:): hers until a card saves it, and then only on her own product",
  photo: 'a photo saved on a product: in a secret turn only on her own private product (the gate)',
  alias: 'a receipt alias on a product: in a secret turn only on her own private product (the gate)',
  pick: 'the same pick counted (pick:): leads to a rule the house sees; also on a turn that ended early, never in a secret turn',
  own_ask: "Shuki's own questions (noticed, pregnancy, learnAskToday): not in a secret turn (mayAsk)",
  period_back: "מ12: the card to put back what a period changed, with the period's end: not in a secret turn (a private period's end shows the house nothing)",
  pesach: "מ14: 'כן, תכבה' turns the house's Passover off (a house setting): from the card's button in /api/chat, never a secret turn",
  baby_born: "מ16: when her baby was born (baby_born:<her id>), her own mark, never out of the server: also in a secret turn, as the pregnancy's end itself",
  learn_pause: "מ16: after her 'כן, תתעלם' to Shuki's own question (asked only outside a secret turn): two weeks the pace isn't learned from (away kind nolearn), no reason",
  babyroom: "מ16: 'כן, תוסיף' adds the storage place 'חדר התינוק' (a house's place): the answer to Shuki's own question, asked only outside a secret turn",
  responsible: "מ19: the push to whoever is in charge of a product someone else marked out: only from the shared part of execute (a secret card has none, its shared actions are dropped), never a private product",
  soon_card: "מ26: the card of what is about to run out, when going shopping, to whoever said 'כן, תגיד': not in a secret turn, nothing private",
  guest_seen: "מ27: one hosting more for a guest by name (an HMAC with the house's salt, never the name): only through ensureHosting, which a secret turn never reaches (the hosting is dropped)",
  guest_save: "מ27: 'לזכור לפעם הבאה?' to whoever told about a guest, asked only outside a secret turn; only its 'yes' keeps a name and what they eat",
  vegan_card: "מ13: the card about the animal products among the basics, once, after her vegan diet is kept: not in a secret turn",
  period_link: "מ11: what a period changed in the basics, kept on the period's fact for its end: not in a secret turn (the edit lands on her private copy, and there is no shared period to tie it to)",
  joinfood: "the joiner's food and lifestyle questions (joinfood:, joinlife:, life_later:, stage 8's question 51): theirs, unchanged",
  holiday: "'חג שמח!' once a day for each person (holiday:<id>:<date>, stage 8, ו2): not in a secret turn, so never written in one",
  ask_once: "a question Shuki asks once only (ask_once:<kind>:<id or 'house'>, stage 8): only that it was asked (stage 9's idle: and sub: carry the product's name, as the house's catalog does); the writer's own or the house's",
  system: 'the model and its cost (usage, brain_error): no content, unchanged',
  hosting: 'the hosting list: the house\'s; not in a secret turn',
  catalog_area: 'the area being cataloged: the house\'s; not in a secret turn',
  dup: 'home18 (6, 7): two names asked about (dup_no, a merge of products or places) and the places asked what is regular (basics_asked): the house\'s, from Shuki\'s own question or a mapping, never in a secret turn',
  shop: 'where the house buys produce and care (home18, 5): the house\'s settings and its products\' stores, from Shuki\'s own question, never asked in a secret turn',
  mapstop: '"נעצור כאן" was tapped, so the list card waits for the next answer (17/10): hers, a time only; set and cleared outside a secret turn',
  cooked: '"we made it" (cooked_log, recipes.cooked): the house sees it; not in a secret turn or a secret card',
  plan: "home20: the weekly plan (meal_plan, meal_plan_items) and the list lines a dish's end takes off: the house's, like cooked; the gate drops a plan line, and none is written in a secret turn or a secret card",
  rejects: 'a turned-down line counted (noticed rejects): the house sees it; not for a secret card',
  child: "a child's request or rule for the grown-ups: as before (a child has nothing private)",
  tells: "how many personal messages she sent today: hers",
  tell: 'a message to someone she named: only with a recipient (the gate)',
  private_rows: 'a reminder, a weekly buy, a fact, Shabbat: private_to / private for her (the gate, migration 0024)',
  dropped_kinds: "a move, leftovers, a rule, a recipe, fact_confirm / keep / share: the house's; the gate drops them",
  fact_ask: "a fact about another grown-up, asked of them: the gate drops a fact about someone else",
  fact_answer: '"no" to "remember that…?" about her: her own fact goes, unchanged',
  fact_end: 'a fact ended: her private ones go; a shared one ends for her alone (a private ended row, פ6)',
  noticed_answer: '"want me to remember?" answered: none in a secret turn (mayAsk)',
  nothing_msg: '"לא היה מה לעדכן." (only when the private write changes nothing she sees, פ6) and "סגור, שכחתי.": hers',
  leaving: "someone leaving: their products become the house's; not about a secret",
  // the routes that run a turn (worker/index.js /api/chat and /api/say, worker/mcp.js ask_shuki) or follow a card's approval
  server_card: "a house card closed by the next message, before the turn (the owner 05/10): only that it was answered, no content; unchanged",
  idle: '"the status is up to date" recount, answered by its button: hers; unchanged',
  restart: '"start over", the admin\'s, after a "yes": not a secret turn; unchanged',
  onboarding: 'the first meeting, her own (only: her): unchanged',
  state: "her state built for the turn (her outfit): hers",
  states: "a vacation, guests, a shopping trip from the answer: chatTurn drops them in a secret turn, so they never get here",
  shoppers: 'who is in the store hears of new lines: never a private one (execute leaves them out)',
};

/**
 * One rule (the owner 04/10): after a secret, an allowed action that would change, end or delete a row someone else sees does
 * nothing, and the writer hears "לא היה מה לעדכן.". secretGate() already leaves the shared fact, Shabbat and fact_end alone
 * (a private row wins over them for her, פ6), and execute() sends what's done to a shared product or line to the writer's own; this checks, in the database, what the
 * card would touch that isn't there: stopping a reminder or a weekly buy, a receipt alias (undoing an action: undoLast's
 * onlyPrivate, פ29). Reads only.
 * Returns { kept, nothing }.
 */
export async function secretTouches(db, user, actions) {
  if (user?.role === 'child') return { kept: actions, nothing: [] }; // a child has nothing private: as before
  const kept = [], nothing = [];
  for (const a of actions) {
    let mine = true;
    if (a.kind === 'remind' && a.off) // only her own daily reminder stops
      mine = !!(await db.prepare("SELECT 1 AS x FROM maybe WHERE kind = 'remind' AND repeat = 'daily' AND decided IS NULL AND added_by = ? AND (id = ? OR text = ?) AND private_to = ?").bind(user.id, Number(a.id) || 0, String(a.text || '').trim(), user.id).first());
    else if (a.kind === 'routine' && a.off) // only her own weekly buy stops
      mine = !!(await db.prepare(`SELECT 1 AS x FROM routines WHERE ${a.product_id != null ? 'product_id = ?' : 'text = ?'} AND private_to = ?`).bind(a.product_id != null ? a.product_id : String(a.text || '').trim().slice(0, 80), user.id).first());
    // undo: only an action of hers that was hers alone, checked inside undoLast (onlyPrivate), with nothing in between (פ29)
    else if (a.kind === 'alias') { // a receipt name the house already uses for another product stays
      const was = await db.prepare('SELECT product_id FROM receipt_aliases WHERE alias = ?').bind(String(a.alias || '').slice(0, 80)).first();
      mine = !was || was.product_id === Number(a.product_id);
    }
    (mine ? kept : nothing).push(a);
  }
  return { kept, nothing };
}
