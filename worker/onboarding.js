// The first meeting (decisions 150-169, 179-181): run by the server, step by step, in fixed words.
// Who Shuki is → who you are → who lives with you → mapping place by place → what's always bought → anything else.
// The model only reads the free answers (onboardParse); it never decides what comes next, so there are no loops.
// The state lives in settings ('onboard'), so it can stop in the middle and go on tomorrow.
import { execute } from './store.js';
// what the first meeting adds isn't counted for Shuki's levels (the owner 16/10): its events say where they came from
const execOnboarding = (env, user, actions) => execute(env, user, actions, { source: 'onboarding' });
import { addMember } from './house.js';
import { shopAsk, shopsDue } from './shops.js';
import { placesWereAsked } from './dups.js';
import { norm } from './domain.js';
import { llmKey } from './llm.js';
import { writeFact } from './facts.js';
import { kosherHouse } from './recipes.js';
import { toWriter, askFact } from './shuki.js';
import { amount, of, byGender, byPerson, rememberAsk, inPlace as placeIn } from '../public/hebrew.js';

const KEY = 'onboard';
export const SKIP = 'נדלג על זה';
/** ז2's buttons (the owner r8z 11/10, question 46): "יש נדלג על זה ואין תשובה חיובית, ואז זה לא מובן." */
export const LIFE_YES = 'כן, אכתוב לך', LIFE_NO = 'לא', LIFE_LATER = 'בוא נדלג על זה כרגע';
export const LIFE_OPTIONS = [LIFE_YES, LIFE_NO, LIFE_LATER];
export const ONE_ENOUGH = 'לא, אחד מספיק', ONE_ENOUGH_F = 'לא, אחת מספיקה'; // by the product's gender (stage 10, t53; the owner r10p n2)
export const RESUME_YES = 'כן, נמשיך', LATER = 'אחר כך', DONE_MAPPING = 'זהו, סיימנו למפות', NO_MORE = 'לא, זהו', ONE_EACH = 'לא, אחד מכל אחד מספיק';

// how a place sounds inside a sentence ("in the kitchen cupboard", "the fridge is mapped")
const PLACE = { 'מקרר': ['במקרר', 'המקרר'], 'מקפיא': ['במקפיא', 'המקפיא'], 'מזווה': ['במזווה', 'המזווה'], 'ארון מטבח': ['בארון המטבח', 'ארון המטבח'], 'ארון אמבטיה': ['בארון האמבטיה', 'ארון האמבטיה'], 'ארון ניקיון': ['בארון הניקיון', 'ארון הניקיון'], 'מחסן': ['במחסן', 'המחסן'] };
const placeOf = (p) => PLACE[p]?.[0] || placeIn(p); // home18: the shared rule for any other place
const thePlace = (p) => PLACE[p]?.[1] || p;
// "A, B and C"; before a number the "and" takes a hyphen ("ו-2")
const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ו${/^\d/.test(xs.at(-1)) ? '-' : ''}${xs.at(-1)}`);
// "2 cartons of milk", as people say it: "2 קרטוני חלב 3%"
const howMany = (n, unit, name) => (n > 1 ? of(n, unit, name) : name);
// once they said they live alone, Shuki talks to one person ("tell me", in his or her form), not to a household
const you = (s, u, plural, m, f) => (s?.alone ? byPerson(u, m, f, plural) : plural); // alone in the plural (7ב): the house's words

/** Decision 179, in the approved words: who Shuki is, in four bubbles, each with its face. */
export function introBubbles({ askMe = false } = {}) {
  // a house set up without a name: after who he is, Shuki first asks who they are (the name, how to talk to them, the house)
  if (askMe) return [...introBubbles().slice(0, 3), { reply: 'מה השם שלך?', face: 'excited', reaction: 'love' }];
  return [
    { reply: 'אני שוקי, הרובוט החמוד שעוזר לכם לנהל את המצרכים בבית ולבשל איתם דברים טעימים.', face: 'hungry', reaction: 'yum' },
    { reply: 'אפשר לדבר איתי חופשי: לספר לי מה יש בבית, מה עומד להיגמר, מה חסר ומה תרצו לקנות. אני אעזור לכם לנהל את המלאי בכיף ואפילו אכין לכם רשימה לסופר.', face: 'laughing', reaction: 'poke' },
    { reply: 'אני גם אזכיר לכם כשהתוקף של מוצר, או של אוכל שהכנתם, עומד לפוג ואעזור לכם להחליט מה לבשל לפי ספר המתכונים שלכם.', face: 'happy', reaction: 'thumbsUp' },
    { reply: 'אני שמח ללמוד את הבית שלכם ואני אוהב שמטפלים בי. האם נתחיל? ספרו לי קצת עליכם: מי מנהל את האפליקציה ומי עוד גר בבית?', face: 'excited', reaction: 'love' },
  ];
}
/** Decision 168: someone who joins later gets hello and what Shuki does, without the mapping. */
export function helloBubbles(u) {
  return [
    { reply: `היי ${u.name}! אני שוקי, הרובוט החמוד של הבית. אני עוזר לכם לנהל את המצרכים ולבשל איתם דברים טעימים.`, face: 'excited', reaction: 'newMember' },
    { reply: `אפשר לספר לי מה נגמר, מה ${byPerson(u, 'קנית', 'קנית', 'קניתם')} ומה צריך ואני אעדכן את המלאי ואת הרשימה של כולם. אני גם מזכיר כשהתוקף של משהו עומד לפוג ועוזר עם מתכונים. ${byPerson(u, 'נסה', 'נסי', 'נסו')} למשל: "נגמר החלב".`, face: 'happy', reaction: 'poke' },
    { reply: `הצ'אט ${byPerson(u, 'שלך', 'שלך', 'שלכם')} איתי אישי. המלאי, הרשימה והמתכונים משותפים לכל הבית.`, face: 'happy' }, // q16 (approved 02/10): the chat is personal now
  ];
}
/** To everyone already in the house, when someone joins (approved 01/10, the owner's text; q16, 02/10: without the rest). */
export function joinedBubble(u) {
  return { reply: `${u.name} ${byPerson(u, 'הצטרף', 'הצטרפה', 'הצטרפו')} לבית שלך! ${byPerson(u, 'ברוך הבא', 'ברוכה הבאה', 'ברוכים הבאים')}!`, face: 'excited', reaction: 'newMember' };
}

/**
 * To someone who just joined, after the hello (approved 01/10, finding 2): what Shuki knows about the house so far.
 * `others`: the names of everyone else in the house; `places`: the places that have something in them, in order.
 * The house notes are about food: a sentence that starts with the joiner's name is said to them ("את צמחונית"); in the
 * plural the name stays (7ב, question 5: "אתם צמחוני" would be wrong).
 */
export function aboutHouse(u, { house, others = [], products = 0, places = [], notes = '' }) {
  const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ו${xs.at(-1)}` : xs[0] || '');
  const who = others.length ? ` ${byPerson(u, 'אתה גר', 'את גרה', 'אתם גרים')} בו עם ${and(others)}.` : '';
  const named = places.length > 6 ? `${places.slice(0, 3).join(', ')} ועוד ${places.length - 3}` : and(places);
  const where = !places.length ? '' : places.length === 1 ? ` במקום אחד: ${places[0]}` : ` ב-${places.length} מקומות: ${named}`;
  const stock = !products ? 'המלאי עוד ריק.' : `במלאי יש ${products === 1 ? 'מוצר אחד' : `${products} מוצרים`}${where}.`;
  const out = [{ reply: `אני רוצה לספר ${byPerson(u, 'לך', 'לך', 'לכם')} מה אני יודע על הבית. קוראים לו "${house}".${who} ${stock}`, face: 'happy' }];
  const me = new RegExp(`^${String(u.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s)`);
  const food = String(notes).split(/[.\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => (u.name ? s.replace(me, byPerson(u, 'אתה', 'את', u.name)) : s));
  if (food.length) out.push({ reply: `מה שאני יודע על האוכל בבית: ${food.join('. ')}.`, face: 'happy' });
  return out;
}

export async function getState(db) {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(KEY).first();
  return r ? JSON.parse(r.value) : null;
}
const setState = (db, s) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(KEY, JSON.stringify(s)).run();
export const startState = (userId, askMe = false) => ({ step: askMe ? 'me' : 'people', user: userId, started: Date.now() });

/** Is this message part of the first meeting? Only the person who set up the house, while it isn't finished. */
export async function inOnboarding(db, user, text) {
  const s = await getState(db);
  if (!s || s.done || s.user !== user.id) return null;
  if (s.paused && !/^(כן, נמשיך|נמשיך|נמשיך להכיר|נכיר|בוא נכיר!?|בואו נכיר)$/.test(text.trim())) return null;
  return s;
}

const TOOL = {
  name: 'onboard_parse',
  description: 'Read one answer of the person during the first meeting with Shuki.',
  input_schema: {
    type: 'object',
    properties: {
      off_topic: { type: 'boolean', description: 'true if the message is not an answer to the question at all (a report like "the milk ran out", a question to Shuki)' },
      later: { type: 'boolean', description: 'true if they want to stop the meeting for now ("later", "not now", "let\'s continue tomorrow")' },
      skip: { type: 'boolean', description: 'true if they want to skip this question ("skip", "don\'t know", "no energy for this now") without stopping the meeting' },
      place: { type: 'string', description: 'a place in the house they named in this message (a room, a cupboard, the fridge), as a short Hebrew name without "ב"/"ה": מקרר, מקפיא, מזווה, ארון מטבח, מרפסת' },
      that_is_all: { type: 'boolean', description: 'true if they said this is everything there is at home / they are done mapping' },
      roommates: { type: 'boolean', description: 'true if the people they live with are roommates (שותפים), not family' },
      new_items: { type: 'array', items: { type: 'string' }, description: 'always-bought: names of things they always buy that are NOT in the product list (in Hebrew, as a shop calls them)' },
      none: { type: 'boolean', description: 'true if the answer is "nothing / no / nobody / that is all"' },
      alone: { type: 'boolean', description: 'people: the person lives alone' },
      people: { type: 'array', description: 'everyone they said lives with them, NOT the person writing. Also in later steps, when they mention someone who lives in the house', items: { type: 'object', properties: { name: { type: 'string', description: 'Hebrew name as written; empty if not said ("the kids")' }, gender: { type: 'string', enum: ['m', 'f', 'unknown'], description: 'from the words (אשתי, בעלי, הבן, הבת, בחורה) or else the name. Most Hebrew names are clear: דני, יוסי, אבי, יואב, איתי = m; מיכל, אורית, דנה = f. unknown ONLY for names used for both, like נועם, טל, עדי, רוני, שחר, יובל, when nothing else was said' }, child: { type: 'boolean', description: 'true ONLY when said in so many words: הבן, הבת, ילד, ילדה, הילדים, or an age under 18. Anyone else is a grown-up (false): אשתי, בעלי, בן/בת הזוג, a partner, a roommate, a parent, a name with nothing more' }, age: { type: 'integer' } }, required: ['name', 'gender', 'child'] } },
      items: { type: 'array', description: 'mapping: every product said to be in this place', items: { type: 'object', properties: {
        name: { type: 'string', description: 'the product in Hebrew, as a shop would call it, WITH the kind if one was said ("חלב 3%", "יוגורט טבעי", "לחם מחמצת") and without the amount or unit' },
        qty: { type: 'number', description: 'how many, if said (default 1)' },
        unit: { type: 'string', description: 'a Hebrew unit in the singular if natural: קרטון, בקבוק, שקית, קופסה, גביע, אריזה, מגש' },
        phrase: { type: 'string', description: 'how a person would say it with the amount, in natural Hebrew: "2 קרטוני חלב", "10 ביצים", "גבינה צהובה", "2 שקיות אפונה"' },
        count_type: { type: 'string', enum: ['units', 'pack', 'level', 'inuse'], description: 'units: counted one by one (milk cartons, yogurts, cheese, cans, bottles, bags); pack: eggs, toilet paper; level: vegetables, fruit, spices, sauces; inuse: only things used slowly from one open package, like dish soap, shampoo, oil, sugar, coffee (never milk, dairy or bread)' },
        category: { type: 'string', description: 'one of the categories listed' },
        generic: { type: 'boolean', description: 'true ONLY when the word is a family with kinds that people buy differently and no kind was said: חלב, גבינה, יוגורט, לחם' },
        question: { type: 'string', description: 'when generic: a short natural Hebrew question, e.g. "איזה חלב?"' },
        options: { type: 'array', items: { type: 'string' }, description: 'when generic: 4-6 common kinds, short, e.g. ["3%", "1%", "נטול לקטוז", "סויה", "שקדים", "שיבולת שועל"]' },
      }, required: ['name', 'count_type', 'category'] } },
      names: { type: 'array', items: { type: 'string' }, description: 'always-bought / pick: names of existing products they mean, exactly as in the product list' },
      targets: { type: 'array', description: 'more than one: product name exactly as in the list, and how many should always be at home', items: { type: 'object', properties: { name: { type: 'string' }, target: { type: 'integer' } }, required: ['name', 'target'] } },
      notes: { type: 'string', description: 'anything else: allergies, kashrut, vegetarian and the like, as a short Hebrew note for the house. In the food question: only what is about the whole house (the house is kosher, an allergy kept for everyone)' },
      food: { type: 'array', description: 'the food question: what each person in the house doesn\'t eat, one entry per person and kind', items: { type: 'object', properties: {
        name: { type: 'string', description: 'who, a name from the people of the house; empty = the person writing' },
        key: { type: 'string', enum: ['allergy', 'avoid', 'diet', 'kosher'], description: 'allergy; avoid = doesn\'t eat X; diet = vegetarian, vegan and the like; kosher = keeps kosher' },
        value: { type: 'string', description: 'short Hebrew: "בוטנים", "פטריות", "צמחונית", "כן"' },
        text: { type: 'string', description: 'the same as one short Hebrew sentence in the third person: "מיכל צמחונית", "יואב לא אוכל פטריות"' },
      }, required: ['key', 'value', 'text'] } },
      life: { type: 'array', description: 'the lifestyle question (stage 8, ז2): only about the person writing; training (how often), period (a diet, keto…) or pregnancy', items: { type: 'object', properties: {
        key: { type: 'string', enum: ['training', 'period', 'pregnancy'] },
        value: { type: 'string', description: 'short Hebrew: "4 פעמים בשבוע", "קיטו", "בהריון"' },
        text: { type: 'string', description: 'the same as one short Hebrew sentence in the third person: "אבי מתאמן 4 פעמים בשבוע"' },
      }, required: ['key', 'value', 'text'] } },
      kind: { type: 'string', description: 'which-one answer: only the kind they said, short, to add to the product name ("3%", "טבעי", "שקדים", "נטול לקטוז"); empty if they said the plain/regular one, any, or don\'t know' },
      habits: { type: 'array', items: { type: 'string' }, description: 'anything else: habits worth remembering, each a short Hebrew rule in third person' },
    },
  },
};

/** ז2 (approved r8p, ב; question 23): the lifestyle question, in the first meeting and to whoever joins later (question 18) */
export const lifeQuestion = (user) => byPerson(user, 'האם יש משהו בסגנון החיים שלך שכדאי שאדע? למשל אימונים או דיאטה.', 'האם יש משהו בסגנון החיים שלך שכדאי שאדע? למשל אימונים, דיאטה או הריון.', 'האם יש משהו בסגנון החיים שלכם שכדאי שאדע? למשל אימונים, דיאטה או הריון.');
const QUESTION = {
  people: 'מי מנהל את האפליקציה ומי עוד גר בבית?',
  names: 'איך קוראים להם? ואם יש ילדים, בני כמה הם?',
  gender: 'איך לפנות אליו או אליה?',
  place: 'מאיפה מתחילים למפות?',
  map: 'מה יש במקום הזה?',
  generic: 'איזה סוג?',
  basics: 'מה מכל מה שיש בבית קונים כל הזמן?',
  targets: 'האם יש משהו שצריך ממנו יותר מאחד בבית?',
  more: 'האם יש עוד משהו שחשוב שאדע?',
  food: 'האם יש מישהו בבית שלא אוכל משהו?', // r9 principle 7, r0t r9-7: a question opens with a question word
  life: 'האם יש משהו בסגנון החיים שלך שכדאי שאדע? למשל אימונים, דיאטה או הריון.', // ז2, for the model reading the answer
};

async function parse(env, think, record, state, s, text, extra = '') {
  const cats = state.categories.map((c) => c.name).join(', ');
  const prods = state.products.filter((p) => !p.deleted).map((p) => p.name).join(', ');
  const system = `אתה קורא תשובה אחת בהיכרות הראשונה עם שוקי, רובוט שמנהל את המלאי של הבית. אל תנסח תשובה: רק מלא את השדות.
השאלה ששוקי שאל: ${QUESTION[s.step] || ''} ${extra}
מי שכותב: ${s.me.name} (${byPerson(s.me, 'זכר', 'נקבה', 'רבים')}).
קטגוריות: ${cats}
מוצרים שכבר בבית: ${prods || '(אין)'}
בני הבית שכבר ידועים: ${(state.users || []).map((u) => u.name).join(', ')}
off_topic רק כשזו בכלל לא תשובה לשאלה ולא מידע על הבית (למשל שאלה לשוקי, דיווח שמשהו נגמר, נושא אחר). תשובה קצרה, לא מדויקת או עם שגיאות היא עדיין תשובה. מי שמספר על עוד מישהו שגר בבית, או על מה יש במקום כלשהו, עונה (לא off_topic).`;
  const { out, usage } = await think(env, [{ type: 'text', text: system }], [{ role: 'user', content: text }], TOOL);
  await record(env, usage);
  for (const x of out?.people || []) x.child = childSaid(x, text);
  return out || {};
}

/**
 * A child only when it was said (the owner 16/10: "אשתי הילה" came back as a child in the first meeting): an age under 18, or a
 * word for a child in the words about them ("איתי בן 4", "הבת שלנו מאיה") or "הילדים". A grown-up otherwise, whatever the
 * model marked. "בן/בת זוג" is not a child.
 */
const CHILD_WORD = /(^|[^\u05D0-\u05EA])ו?(ה?בן|ה?בת|בני|בתי|ה?ילד|ה?ילדה|ה?ילדים|ה?ילדות|ה?תינוק|ה?תינוקת|ה?נכד|ה?נכדה)(?![\u05D0-\u05EA])/; // "והבן שלנו" too (the reviewer)
export function childSaid(x, text) {
  if (!x?.child) return false;
  if (Number.isFinite(Number(x.age)) && x.age !== null && x.age !== '') return Number(x.age) < 18;
  const t = String(text || '').replace(/ב[נת][\s-]+ה?זוג/g, ' ');
  const KIDS = /(^|[^\u05D0-\u05EA])ו?ה?ילדים(?![\u05D0-\u05EA])/;
  const name = String(x.name || '').trim();
  // the words about them: the last clause with their name as a whole word ("הילה ואיתי בן 4": "איתי בן 4" is Itai's;
  // "איתי" the name, not "איתי" = with me)
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), whole = new RegExp(`(^|[^\u05D0-\u05EA])ו?${esc}(?![\u05D0-\u05EA])`);
  const parts = t.split(/[,.;:\n]|\s(?=ו\S)/);
  const at = name ? parts.map((p, k) => (whole.test(p) ? k : -1)).filter((k) => k >= 0).at(-1) : undefined;
  if (at == null) return KIDS.test(t) || CHILD_WORD.test(t); // their name isn't in it: by what was said of everyone
  const seg = parts[at];
  const age = /ב[נת]\s+(\d{1,2})(?!\d)/.exec(seg);
  if (age) return Number(age[1]) < 18;
  if (CHILD_WORD.test(seg)) return true; // "והבן שלנו יואב", "והילדים יואב"
  // "והילדים יואב ומאיה": a clause of just a name after the children's (the reviewer), not "אשתי הילה והילדים…"
  const ADULT = /(אשתי|בעלי|זוג|שותפ|אמא|אבא|הורי|סבא|סבתא|חבר)/;
  return !ADULT.test(seg) && parts.slice(0, at).some((p) => KIDS.test(p)) && seg.trim().replace(/^ו/, '').trim() === name;
}

/**
 * One message during the first meeting. Returns { bubbles: [{ reply, face, options?, reaction?, undo?, codes? }], chat?: true }
 * chat: true = not an answer; the caller answers it as a normal chat message and then asks "shall we go on?".
 */
export async function onboardStep(env, user, text, state, { think, record }) {
  const db = env.DB;
  const s = await getState(db);
  s.me = { name: user.name, gender: user.gender };
  const out = [];
  const say = (reply, more = {}) => out.push({ reply, face: 'happy', ...more });
  if (s.paused) { s.paused = false; }
  const t = text.trim();
  if (['me', 'mygender', 'house'].includes(s.step)) return aboutMe(env, s, user, t, state, { think, record }); // not skipped: Shuki needs them
  if (s.step === 'phones') return phonesAnswer(env, s, state, user, t);
  if (s.step === 'kosher') return kosherAnswer(env, s, state, user, t);
  if (t === LATER) { s.paused = true; await setState(db, s); say(`בסדר גמור. ${you(s, user, 'כשתרצו להמשיך, כתבו', 'כשתרצה להמשיך, כתוב', 'כשתרצי להמשיך, כתבי')} לי "נמשיך להכיר".`, { face: 'happy' }); return { bubbles: out }; }
  if (t === RESUME_YES || /^(נמשיך|נמשיך להכיר|נכיר|בוא נכיר!?|בואו נכיר)$/.test(t)) { await setState(db, s); return { bubbles: [again(ask(s, state, user))] }; }

  // the buttons answer without the model
  const placeTap = s.step === 'place' && (state.locations.some((l) => l.name === t) ? t : null);
  const genericTap = s.step === 'generic' && s.pending?.[s.at]?.options?.includes(t) ? t : null;
  // ז2: "כן, אכתוב לך" waits for the answer, with no words of its own; "לא" and "בוא נדלג על זה כרגע" go on as a skip
  // stage 8, question 51 (r9p): "בוא נדלג על זה כרגע" gets the question once more, later, when they talk about food or health
  if (s.step === 'life' && t === LIFE_LATER) await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')").bind(`life_later:${user.id}`).run();
  if (t === LIFE_YES) return { bubbles: [] }; // an older app sends it (17/10: the app doesn't): it only waits for the words
  const p = t === SKIP || ((s.step === 'life' || s.step === 'food') && (t === LIFE_NO || t === LIFE_LATER)) ? { skip: true } : placeTap || genericTap || t === DONE_MAPPING || t === NO_MORE || (t === OPEN_NO && (s.step === 'more' || s.step === 'targets')) || t === ONE_EACH || t === ONE_ENOUGH || t === ONE_ENOUGH_F ? {} : await parse(env, think, record, state, s, text,
    s.step === 'generic' ? `(על "${s.pending[s.at].name}")` : s.step === 'map' ? `(המקום: ${s.place})` : s.step === 'gender' ? `(על ${s.ask?.name})` : '');
  if (p.later) { s.paused = true; await setState(db, s); say(`בסדר גמור. ${you(s, user, 'כשתרצו להמשיך, כתבו', 'כשתרצה להמשיך, כתוב', 'כשתרצי להמשיך, כתבי')} לי "נמשיך להכיר".`); return { bubbles: out }; }
  if (p.off_topic) {
    // what they already told about this place is in the stock now, so the answer can use it ("my milk is running out")
    const ready = (s.pending || []).filter((it) => !it.generic && !it.created);
    if (ready.length) { await execOnboarding(env, user, ready.map((it) => createOf(it, s.place))); ready.forEach((it) => { it.created = true; }); }
    await setState(db, s); return { bubbles: [], chat: true };
  }

  // someone new who lives here, said in the middle ("and we also have a boy, Itai, 4"): added, and the meeting goes on
  if (!['people', 'names', 'gender'].includes(s.step)) {
    const known = new Set((state.users || []).map((u) => u.name));
    const fresh = (p.people || []).filter((x) => x.name?.trim() && !known.has(x.name.trim()));
    if (fresh.length) {
      const added = [], codes = [];
      for (const x of fresh) {
        const g = ['m', 'f', 'p'].includes(x.gender) ? x.gender : 'm';
        const r = await addMember(db, { name: x.name.trim(), gender: g, role: x.child ? 'child' : 'member' });
        if (!r.error) { added.push(r.name); codes.push({ name: r.name, code: r.code, gender: g }); }
      }
      if (added.length) {
        s.alone = false; // someone lives here after all: the plural from here on
        say(`איזה כיף, עכשיו אני מכיר גם את ${and(added)}!`, { face: 'ecstatic', reaction: 'newMember' });
        say(codes.length > 1 ? 'הנה הקודים שלהם לטלפון. הם תקפים לשבוע.' : `הנה הקוד ${byPerson(codes[0], 'שלו', 'שלה', 'שלהם')} לטלפון. הוא תקף לשבוע.`, { codes, only: user.id });
      }
      if (!(p.items || []).length && !(p.food || []).length && !p.names?.length && !p.targets?.length && !p.notes) { out.push(ask(s, state, user)); await setState(db, s); return { bubbles: out }; }
    }
  }
  if (p.roommates) await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_mode', 'roommates')").run();
  if (p.skip && !(p.items || []).length && !(p.life || []).length && !(p.food || []).length) { // "לא, רק שאני מתאמן", "לא, אני טבעונית": not a skip
    const next = { people: 'place', names: 'place', gender: null, food: 'food', life: 'life', place: 'basics', map: 'place', generic: null, basics: 'more', targets: 'more', more: 'done', habit: 'done' }[s.step];
    if (s.step === 'gender') { s.people.find((x) => x.name === s.ask.name).gender = 'm'; return finishPeople(env, s, state, user, out); }
    if (s.step === 'generic') { s.pending[s.at].generic = false; return nextGeneric(env, s, state, user, out); }
    if (next === 'place' && (s.step === 'people' || s.step === 'names')) { s.people = (s.people || []).filter((x) => x.name); return finishPeople(env, s, state, user, out); }
    if (next === 'place') { if (s.step === 'map') (s.mapped ||= []).push(s.place); s.step = 'place'; await setState(db, s); say('בסדר, נדלג. איפה עוד?', { options: morePlaces(s, state) }); return { bubbles: out }; }
    if (next === 'food') { s.step = 'life'; await setState(db, s); out.push(ask(s, state, user)); return { bubbles: out }; } // ז2: the lifestyle question next
    if (next === 'life') { s.step = 'place'; await setState(db, s); out.push(ask(s, state, user)); return { bubbles: out }; }
    if (next === 'basics') return toBasics(db, s, state, user, out);
    if (next === 'more') { s.step = 'more'; await setState(db, s); say(`בסדר. ${QUESTION_TEXT.more(user)}`, { options: OPEN_OPTIONS }); return { bubbles: out }; }
    return finish(db, s, user, out);
  }

  switch (s.step) {
    case 'people': case 'names': {
      if (p.alone || (p.none && !s.people?.length)) { s.people = []; s.alone = true; }
      else {
        const named = (p.people || []).filter((x) => x.name?.trim());
        const unnamed = (p.people || []).filter((x) => !x.name?.trim());
        s.people = [...(s.people || []).filter((x) => x.name), ...named];
        if (unnamed.length && s.step === 'people') { s.step = 'names'; await setState(db, s); return { bubbles: [{ reply: QUESTION.names, face: 'happy', reaction: 'thumbsUp' }] }; }
      }
      return finishPeople(env, s, state, user, out);
    }
    case 'gender': {
      // the answer may be about someone else ("Roni's a girl" when asked about Dani): each name gets what was said about it
      for (const x of p.people || []) { const w = s.people.find((y) => y.name === x.name?.trim()); if (w && ['m', 'f', 'p'].includes(x.gender)) w.gender = x.gender; }
      const who = s.people.find((x) => x.name === s.ask.name);
      const aboutOther = s.people.some((y) => y.name !== who.name && t.includes(y.name));
      // "בלשון רבים" typed: the model's list has no plural, so the words win over what it said (7ב)
      if (!aboutOther && /בלשון רבים|ברבים/.test(t)) who.gender = 'p';
      else if (who.gender === 'unknown' && !aboutOther) who.gender = /נקבה|אליה|היא|בת|אישה|בחורה|ילדה|אחות|אמא/.test(t) ? 'f' : /זכר|אליו|הוא|בן|גבר|בחור|ילד|אח\b|אבא/.test(t) ? 'm' : 'm';
      return finishPeople(env, s, state, user, out);
    }
    case 'place': {
      if (t === DONE_MAPPING || (p.that_is_all && !(p.items || []).length)) return toBasics(db, s, state, user, out);
      const named = p.place?.trim().replace(/^(ב|ה)(?=\S{3})/, '');
      const place = placeTap || state.locations.find((l) => t.includes(l.name))?.name || state.locations.find((l) => l.name === named)?.name || named || (t.split(/\s+/).length <= 3 ? t.replace(/^(ב|מה|את ה?)/, '').trim().slice(0, 40) : null);
      // "in the fridge there's milk, 6 eggs and yellow cheese": the place and what's in it in one message
      if ((p.items || []).length) { s.place = place || 'מקרר'; s.pending = p.items; s.at = -1; s.allDone = !!p.that_is_all; return nextGeneric(env, s, state, user, out); }
      if (!place) { await setState(db, s); say('לא הבנתי איזה מקום. מאיפה מתחילים?', { face: 'confused', options: morePlaces(s, state) }); return { bubbles: out }; }
      s.place = place; s.step = 'map'; await setState(db, s);
      say(`מה יש ${placeOf(place)}? אפשר לכתוב הכל ברצף, למשל "חלב, 10 ביצים וגבינה צהובה".`, { face: 'excited' });
      return { bubbles: out };
    }
    case 'map': {
      // the empty place counts as mapped before the buttons: no "מקרר" again, and "זהו, סיימנו למפות" from the first one (stage 7 walkthrough)
      if (p.none || !(p.items || []).length) { (s.mapped ||= []).push(s.place); s.step = 'place'; say(`אז ${thePlace(s.place)} ריק. איפה עוד?`, { options: morePlaces(s, state) }); await setState(db, s); return { bubbles: out }; }
      s.pending = p.items; s.at = -1; s.allDone = !!p.that_is_all;
      return nextGeneric(env, s, state, user, out);
    }
    case 'generic': {
      const it = s.pending[s.at];
      // a button is the kind itself; typed words are read ("the regular one, nothing special" = no kind)
      const kind = genericTap || (t.split(/\s+/).length <= 2 && !p.kind && !p.none && !p.skip ? t : String(p.kind || '').trim());
      const base = it.name;
      if (!kind) { it.generic = false; return nextGeneric(env, s, state, user, out); }
      it.name = kind.includes(base) ? kind : `${base} ${kind}`;
      if (it.phrase) it.phrase = withKind(it.phrase, base, kind.includes(base) ? kind.replace(base, '').trim() : kind);
      it.generic = false;
      return nextGeneric(env, s, state, user, out);
    }
    case 'basics': {
      const names = new Set(p.names || []);
      const hit = state.products.filter((x) => !x.deleted && names.has(x.name));
      if (hit.length) await execOnboarding(env, user, hit.map((x) => ({ kind: 'edit', product_id: x.id, fields: { is_basic: true, target: 1 } })));
      // always bought but not at home now (coffee): a regular product that isn't there, so it's on the list (decision 156)
      const have = new Set(state.products.map((x) => x.name));
      const missing = (p.new_items || []).map((x) => String(x).trim()).filter((x) => x && !have.has(x)).slice(0, 10);
      if (missing.length) {
        await execOnboarding(env, user, missing.map((name) => ({ kind: 'create', product: { name, count_type: 'units', qty: 0, is_basic: 1, target: 1, category_id: 'אחר' } })));
        hit.push(...missing.map((name) => ({ name })));
      }
      if (!hit.length) { s.step = 'more'; await setState(db, s); say(QUESTION_TEXT.more(user), { options: OPEN_OPTIONS }); return { bubbles: out }; }
      s.basics = hit.map((x) => x.name); s.step = 'targets'; await setState(db, s);
      say(s.basics.length > 1 ? `מעולה, מעכשיו ${and(s.basics)} הם מוצרים קבועים. כשאחד מהם ייגמר, הוא ייכנס לרשימה לבד.` : `מעולה, מעכשיו ${s.basics[0]} מוצר קבוע. ${byGender(s.basics[0], 'כשייגמר, הוא ייכנס', 'כשתיגמר, היא תיכנס', 'כשייגמרו, הם ייכנסו', 'כשייגמרו, הן ייכנסו')} לרשימה לבד.`, { face: 'excited', reaction: 'learned' });
      if (missing.length) say(`${and(missing)} ${missing.length > 1 ? 'לא בבית עכשיו, אז הוספתי אותם לרשימה' : `לא בבית עכשיו, אז הוספתי ${byGender(missing[0], 'אותו', 'אותה', 'אותם', 'אותן')} לרשימה`}.`, { face: 'happy' });
      say(targetsQuestion(s), { options: targetsOptions(s) });
      return { bubbles: out };
    }
    case 'targets': {
      const byName = new Map(state.products.map((x) => [x.name, x]));
      const ts = (p.targets || []).map((x) => ({ p: byName.get(x.name), n: Math.round(x.target) })).filter((x) => x.p && x.n > 1 && x.n < 100);
      if (ts.length) {
        await execOnboarding(env, user, ts.map((x) => ({ kind: 'edit', product_id: x.p.id, fields: { target: x.n, is_basic: true } }))); // needed always = regular
        say(`סגור, אדאג שתמיד יהיו בבית ${and(ts.map((x) => howMany(x.n, x.p.count_type === 'pack' ? null : x.p.unit, x.p.name)))}.`, { face: 'happy', reaction: 'approved' });
      }
      s.step = 'more'; await setState(db, s);
      say(QUESTION_TEXT.more(user), { options: OPEN_OPTIONS });
      return { bubbles: out };
    }
    case 'life': { // ז2 (stage 8, approved r8p: ב with examples): training, a diet (a period without until) or pregnancy, the writer's own
      const users = (await db.prepare('SELECT id, name, gender, role, active FROM users').all()).results; const lines = new Map(); // one journal line per subject (facts.js taughtLine)
      const saved = []; let preg = false;
      // a diet said as food ("אני טבעונית"), on this step: the writer's own, as in the food step
      for (const f of (p.food || []).filter((x) => !String(x?.name || '').trim() || String(x.name).trim() === user.name)) {
        if (!f?.key || !String(f.value || '').trim() || !String(f.text || '').trim()) continue;
        const w = await writeFact(db, user, { key: f.key, about: user.name, value: f.value, text: f.text, source: 'onboarding' }, { users, lines });
        if (!w.error) saved.push(String(f.text).trim().replace(/[.!]+$/, ''));
      }
      for (const f of p.life || []) {
        if (!['training', 'period', 'pregnancy'].includes(f?.key) || !String(f.value || '').trim() || !String(f.text || '').trim()) continue;
        const w = await writeFact(db, user, { key: f.key, about: user.name, value: f.value, text: f.text, source: 'onboarding' }, { users, lines });
        if (w.error) continue;
        if (f.key === 'pregnancy') preg = true; else saved.push(String(f.text).trim().replace(/[.!]+$/, ''));
      }
      // "רשמתי ש…" (r9 principle 6) to them, in the second person: "אבי מתאמן…" → "אתה מתאמן…"
      const you = (x) => (x.startsWith(`${user.name} `) ? byPerson(user, 'אתה ', 'את ', 'אתם ') + x.slice(user.name.length + 1) : x); // any name, "דני :)" too
      if (saved.length) say(`רשמתי ${and(saved.map((x) => `ש${you(x)}`))}.`, { face: 'happy', reaction: 'learned' });
      if (preg) say('מזל טוב! רשמתי את זה, וזה נשאר בינינו.', { face: 'excited', sensitive: true }); // question 46
      s.step = 'place'; await setState(db, s);
      out.push(ask(s, state, user));
      return { bubbles: out, ...(preg && { sensitive: true }) };
    }
    case 'food': { // r9-96: what each one doesn't eat is their own fact; what's about the whole house goes in the house notes
      const users = (await db.prepare('SELECT id, name, gender, role, active FROM users').all()).results; const lines = new Map(); // one journal line per subject (facts.js taughtLine)
      const saved = [], kept = [];
      for (const f of p.food || []) {
        if (!f?.key || !String(f.value || '').trim() || !String(f.text || '').trim()) continue;
        const w = await writeFact(db, user, { key: f.key, about: String(f.name || '').trim() || user.name, value: f.value, text: f.text, source: 'onboarding' }, { users, lines });
        if (!w.error) { saved.push(String(f.text).trim().replace(/[.!]+$/, '')); if (f.key === 'kosher') kept.push(f); }
        if (w.pending && w.about) await askFact(env, user, w, f); // about another grown-up: asked to them, as in the chat (15/10, the first use)
      }
      if (p.notes?.trim()) {
        const old = (await db.prepare("SELECT value FROM settings WHERE key = 'house_notes'").first())?.value || '';
        await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_notes', ?)").bind([old, p.notes.trim()].filter(Boolean).join('. ').slice(0, 600)).run();
        say(`רשמתי בהערות לבית: ${p.notes.trim()}. אני אזהיר כשמשהו לא מתאים.`, { face: 'happy', reaction: 'learned' });
      }
      if (saved.length) say(`רשמתי ${and(saved.map((x) => `ש${x}`))}.`, { face: 'happy', reaction: 'learned' }); // r9 principle 6 ("רשמתי שאורית צמחונית")
      // ב6 (stage 8, r9 "רק אחד בבית שומר כשרות"): only one person keeps kosher, in a house of more, and the house isn't
      // kosher (yet): how does the house go? Asked once, here; the buttons answer without the model
      const keepers = [...new Set(kept.filter((f) => !/^\s*(לא|בכלל לא)(\s|$)/.test(String(f.value || ''))).map((f) => String(f.name || '').trim() || user.name))];
      const notes = (await db.prepare("SELECT value FROM settings WHERE key = 'house_notes'").first())?.value || '';
      if (keepers.length === 1 && !s.alone && (s.people || []).length && !kosherHouse(notes)) s.kosherWho = keepers[0], s.step = 'kosher';
      else s.step = 'life'; // ז2
      await setState(db, s);
      out.push(ask(s, state, user));
      return { bubbles: out };
    }
    case 'more': {
      if (p.notes?.trim()) {
        const old = (await db.prepare("SELECT value FROM settings WHERE key = 'house_notes'").first())?.value || '';
        await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_notes', ?)").bind([old, p.notes.trim()].filter(Boolean).join('. ').slice(0, 600)).run();
        say(`רשמתי בהערות לבית: ${p.notes.trim()}. אני אזהיר כשמשהו לא מתאים.`, { face: 'happy', reaction: 'learned' });
      }
      if ((p.items || []).length) {
        await execOnboarding(env, user, p.items.map((it) => createOf(it, p.place?.trim().replace(/^(ב|ה)(?=\S{3})/, '') || null)));
        say(`הוספתי למלאי: ${and(p.items.map((x) => x.phrase || x.name))}.`, { undo: true, reaction: 'approved' });
      }
      // every habit in the answer, in one question (decision 181, r0t d181): "לזכור ש… ו…?"
      const habits = (p.habits || []).map((h) => String(h).trim().replace(/\.$/, '')).filter(Boolean);
      if (habits.length) { s.habits = habits; delete s.habit; s.step = 'habit'; await setState(db, s); say(habitQuestion(habits, user, (await db.prepare('SELECT id, name, gender FROM users WHERE active = 1').all()).results), { options: ['כן, תזכור', 'לא צריך'] }); return { bubbles: out }; }
      return finish(db, s, user, out);
    }
    case 'habit': {
      if (/^כן/.test(t)) { for (const h of s.habits || [s.habit]) await db.prepare('INSERT INTO lessons (text, added, added_by) VALUES (?,?,?)').bind(String(h).slice(0, 200), Date.now(), user.id).run(); say('זוכר!', { reaction: 'learned' }); }
      return finish(db, s, user, out);
    }
    default: return finish(db, s, user, out);
  }
}

/** ב6: "כל הבית" = the house notes say so (the words that are there already); "רק …" (or anything else) = nothing more */
const KOSHER_ALL = 'כל הבית';
async function kosherAnswer(env, s, state, user, t) {
  const db = env.DB, out = [];
  if (t === KOSHER_ALL || /^(כל הבית|כולם|כל הבית כשר|הבית כשר)[.!]?$/.test(t)) {
    const old = (await db.prepare("SELECT value FROM settings WHERE key = 'house_notes'").first())?.value || '';
    await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_notes', ?)").bind([old, 'הכל כשר'].filter(Boolean).join('. ').slice(0, 600)).run();
    out.push({ reply: 'רשמתי בהערות לבית: הכל כשר. אני אזהיר כשמשהו לא מתאים.', face: 'happy', reaction: 'learned' });
  } else out.push({ reply: 'בסדר', face: 'happy' });
  delete s.kosherWho; s.step = 'life'; await setState(db, s); // ז2
  out.push(ask(s, state, user));
  return { bubbles: out };
}

/** "האם תרצה שאזכור שאבי שותה קפה בבוקר ושמיכל לא אוכלת גלוטן?" (decision 181; r8z question 31) */
// question 30 (r9z): about whoever writes, in the second person, as 0ב ("…שאתה קונה ירקות בשוק בשישי?")
export const habitQuestion = (habits, u, users = []) => `${rememberAsk(u)} ${and(habits.map((h) => `ש${toWriter(String(h), u, users)}`))}?`;
const QUESTION_TEXT = {
  more: (u) => `והאם יש עוד משהו ש${byPerson(u, 'תרצה', 'תרצי', 'תרצו')} להגיד לי? למשל אלרגיה, כשרות או משהו שכדאי שאדע.`, // r0t r9-7
};

/**
 * Before the rest of the meeting (30/09): the name of whoever set up the house, how to talk to them, and the house's
 * name, asked in the chat one at a time (the setup screen only has the code and the key).
 */
const MY_GENDER = ['בלשון זכר', 'בלשון נקבה', 'בלשון רבים']; // 7ב: the third, in the same order (r7d, 1.3)
/** A first name: a man's, a woman's, or one that fits both (Noam, Tal). One small call; with no model, or if it fails: 'both' (ask). */
const NAME_TOOL = { name: 'name_gender', description: 'Whose name it is.', input_schema: { type: 'object', properties: { gender: { type: 'string', enum: ['m', 'f', 'both'], description: 'm = a man\'s name, f = a woman\'s name, both = it fits both (נועם, טל, עמית, יובל, שחר, אור)' } }, required: ['gender'] } };
export async function nameGender(env, name, { think, record } = {}) {
  if (!think || !llmKey(env)) return 'both';
  try {
    const { out, usage } = await think(env, [{ type: 'text', text: 'שם פרטי בעברית: של גבר, של אישה, או שמתאים לשניהם?' }], [{ role: 'user', content: name }], NAME_TOOL);
    if (record) await record(env, usage);
    return ['m', 'f'].includes(out?.gender) ? out.gender : 'both';
  } catch { return 'both'; }
}

async function aboutMe(env, s, user, t, state, model = {}) {
  const db = env.DB;
  if (s.step === 'me') {
    const name = t.replace(/^(היי|שלום|הי)[,!.]?\s*/, '').replace(/^(קוראים לי|שמי|השם שלי( הוא)?|אני)\s+/, '').replace(/[.!?,]+$/, '').trim().split(/\s+/).slice(0, 2).join(' ').slice(0, 30);
    if (!name || t === LATER) return { bubbles: [{ reply: 'מה השם שלך?', face: 'happy' }] };
    await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
    s.myName = name;
    // the admin, like everyone (decision 153, r0t d153): asked how to talk to them only when the name fits both
    const g = await nameGender(env, name, model);
    if (g !== 'both') {
      await db.prepare('UPDATE users SET gender = ? WHERE id = ?').bind(g, user.id).run();
      s.step = 'house'; await setState(db, s);
      return { bubbles: [{ reply: `נעים מאוד, ${name}!`, face: 'excited', reaction: 'love' }, { reply: 'איך נקרא לבית?', face: 'happy', options: [`הבית של ${name}`] }] };
    }
    s.step = 'mygender'; await setState(db, s);
    return { bubbles: [{ reply: `נעים מאוד, ${name}! איך לפנות אליך?`, face: 'excited', reaction: 'love', options: MY_GENDER }] };
  }
  if (s.step === 'mygender') {
    const gender = /בלשון רבים|ברבים/.test(t) ? 'p' : /נקבה|אליי|אלייך|בת|אישה/.test(t) ? 'f' : /זכר|אליו|בן|גבר/.test(t) ? 'm' : null;
    if (!gender) return { bubbles: [{ reply: 'איך לפנות אליך?', face: 'happy', options: MY_GENDER }] };
    await db.prepare('UPDATE users SET gender = ? WHERE id = ?').bind(gender, user.id).run();
    s.step = 'house'; await setState(db, s);
    const name = s.myName || user.name;
    return { bubbles: [{ reply: 'איך נקרא לבית?', face: 'happy', options: [`הבית של ${name}`] }] };
  }
  // the house's name
  const house = t.replace(/[.!?]+$/, '').trim().slice(0, 40) || `הבית של ${s.myName || user.name}`;
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_name', ?)").bind(house).run();
  s.step = 'people'; await setState(db, s);
  return { bubbles: [{ ...introBubbles()[3] }] };
}

/** The question of the current step again (after "shall we go on?"). */
/** The same question once more, after something else: "so, where do we start?" rather than the very same words. */
function again(b) {
  const reply = b.reply.replace(/^יאללה, (בואו|בוא|בואי) נמפה את הבית! /, '').replace(/^ספרו לי קצת עליכם: /, '').replace(/^(ו|אז )?/, 'אז ');
  return { ...b, reply: reply.replace(/^אז (ו)/, 'אז ') };
}
/** "יותר מאחד?" after the regular products: for several, or by the one product's gender (52, the owner 14/10), and its button (t53). */
function targetsQuestion(s) {
  const b = s.basics || [];
  return b.length === 1 ? `האם צריך ${byGender(b[0], 'ממנו', 'ממנה', 'מהם', 'מהן')} יותר ${byGender(b[0], 'מאחד', 'מאחת', 'מאחד', 'מאחת')} בבית?` /* 52 (the owner 14/10) */
    : 'האם יש משהו מהם שצריך ממנו יותר מאחד בבית? למשל "2 קרטוני חלב".';
}
/** An open question with only a "no" (17/10, ש4): "לא" goes on, "כן, אכתוב לך" only puts the cursor in the box (the app; nothing is sent). */
export const OPEN_NO = 'לא', OPEN_OPTIONS = [OPEN_NO, LIFE_YES];
const targetsOptions = () => OPEN_OPTIONS;
export function ask(s, state, user) {
  switch (s.step) {
    case 'me': return { reply: 'מה השם שלך?', face: 'happy' };
    case 'mygender': return { reply: 'איך לפנות אליך?', face: 'happy', options: MY_GENDER };
    case 'house': return { reply: 'איך נקרא לבית?', face: 'happy', options: [`הבית של ${s.myName || user.name}`] };
    case 'people': return { reply: 'ספרו לי קצת עליכם: מי מנהל את האפליקציה ומי עוד גר בבית?', face: 'excited' };
    case 'names': return { reply: QUESTION.names, face: 'happy' };
    case 'gender': return { reply: `איך לפנות ל${s.ask.name}?`, face: 'confused', options: MY_GENDER };
    case 'place': return { reply: s.mapped?.length ? 'איפה עוד?' : `יאללה, ${you(s, user, 'בואו', 'בוא', 'בואי')} נמפה את הבית! מאיפה מתחילים?`, face: 'excited', options: morePlaces(s, state) };
    case 'map': return { reply: `מה יש ${placeOf(s.place)}?`, face: 'excited' };
    case 'generic': return { reply: s.pending[s.at].question || `איזה ${s.pending[s.at].name}?`, face: 'confused', options: s.pending[s.at].options };
    case 'basics': return { reply: basicsQuestion(s, user), face: 'happy' }; // answered in words (17/10, ש4)
    case 'targets': return { reply: targetsQuestion(s), face: 'happy', options: targetsOptions(s) }; // the same as the first time (stage 10, question 14)
    case 'more': return { reply: QUESTION_TEXT.more(user), face: 'happy', options: OPEN_OPTIONS };
    // r9-96 (in the decision's words): one question about food, before the mapping (r10 q105). Alone: the joiner's words (r9-100)
    // s.alone only: set whenever nobody was added, and someone added later in the meeting sets the plural back
    // ז2 (approved r8p, ב; question 23: pregnancy in the plural too): by how the writer is addressed, not isWoman
    case 'life': return { reply: lifeQuestion(user), face: 'happy', options: LIFE_OPTIONS };
    case 'food': return { reply: s.alone ? `האם יש משהו ש${byPerson(user, 'אתה לא אוכל', 'את לא אוכלת', 'אתם לא אוכלים')}?` : QUESTION.food, face: 'happy', options: OPEN_OPTIONS };
    case 'phones': return s.phones.length > 1
      ? { reply: 'למי מהם צריך קוד לטלפון?', face: 'happy', options: [...s.phones.map((x) => x.name), PHONES_ALL, PHONES_NONE] }
      : { reply: `האם ${s.phones[0].name} ${byPerson(s.phones[0], 'צריך', 'צריכה', 'צריכים')} קוד לטלפון?`, face: 'happy', options: [PHONE_YES, PHONE_NO] };
    case 'habit': return { reply: habitQuestion(s.habits || [s.habit], user, state?.users || []), face: 'happy', options: ['כן, תזכור', 'לא צריך'] };
    // ב6 (approved r8p): about someone else by name; about whoever writes, to them
    case 'kosher': return s.kosherWho === user.name
      ? { reply: `האם כל הבית אוכל כשר, או רק ${byPerson(user, 'אתה', 'את', 'אתם')}?`, face: 'happy', options: [KOSHER_ALL, 'רק אני'] }
      : { reply: `האם כל הבית אוכל כשר, או רק ${s.kosherWho}?`, face: 'happy', options: [KOSHER_ALL, `רק ${s.kosherWho}`] };
    default: return { reply: 'האם נמשיך?', face: 'happy' };
  }
}

const basicsQuestion = (s, u) => `ומה מכל מה שיש בבית ${you(s, u, 'אתם קונים', 'אתה קונה', 'את קונה')} כל הזמן? אני אסמן את זה כמוצר קבוע וכשהוא ייגמר הוא ייכנס לרשימה לבד.`;

function morePlaces(s, state) {
  const done = new Set(s.mapped || []);
  return [...state.locations.map((l) => l.name).filter((n) => !done.has(n)).slice(0, 5), ...(done.size ? [DONE_MAPPING] : [])];
}

const PHONES_ALL = 'לכולם', PHONES_NONE = 'לאף אחד', PHONE_YES = 'כן', PHONE_NO = 'לא צריך';
/** The answer to "who needs a phone?": the names in it, everyone, or no one. Codes go only to them; the others' are removed. */
async function phonesAnswer(env, s, state, user, t) {
  const db = env.DB; const out = [];
  const all = s.phones || [];
  const n = norm(t);
  const none = t === PHONES_NONE || t === PHONE_NO || /^(לא|אף אחד|לאף אחד|אף אחד מהם|לא צריך|אין צורך)[\s.!]*$/.test(n);
  const every = t === PHONES_ALL || t === PHONE_YES || /(^|\s)(כולם|לכולם|כן|כל אחד|לכל אחד)(\s|$)/.test(n);
  const named = all.filter((x) => n.split(' ').some((w) => w === norm(x.name) || w.replace(/^[ול]{1,2}/, '') === norm(x.name)));
  const chosen = none ? [] : named.length ? named : every ? all : null;
  if (!chosen) { out.push(again(ask(s, state, user))); return { bubbles: out }; } // not understood: the same question, once more
  const keep = new Set(chosen.map((x) => x.code));
  for (const x of all) if (!keep.has(x.code)) await db.prepare('DELETE FROM pairing_codes WHERE code = ?').bind(x.code).run();
  if (chosen.length) out.push({ reply: chosen.length > 1 ? 'הנה קוד לכל אחד, כדי שכל אחד יוכל לדבר איתי מהטלפון שלו. הקודים תקפים לשבוע. אפשר לשלוח לכל אחד את שלו בכפתור "לשלוח ל…" שליד השם.' : `הנה קוד בשביל ${chosen[0].name}, כדי ש${byPerson(chosen[0], 'הוא יוכל', 'היא תוכל', 'הם יוכלו')} לדבר איתי מהטלפון. הוא תקף לשבוע.`, face: 'happy', codes: chosen, only: user.id });
  delete s.phones; s.step = 'food'; await setState(db, s);
  out.push(ask(s, state, user));
  return { bubbles: out };
}

async function finishPeople(env, s, state, user, out) {
  const db = env.DB;
  // a name that could be either (Noam, Tal): ask, one at a time (decision 153)
  const unclear = s.people.find((x) => x.gender === 'unknown');
  if (unclear) { s.ask = { name: unclear.name }; s.step = 'gender'; await setState(db, s); return { bubbles: [...out, ask(s, state, user)] }; }
  const added = [], codes = [];
  for (const x of s.people) {
    if (x.added) continue;
    const r = await addMember(db, { name: x.name, gender: x.gender, role: x.child ? 'child' : 'member' });
    x.added = true;
    if (!r.error) { added.push(x.name); codes.push({ name: r.name, code: r.code, gender: x.gender }); }
  }
  if (added.length && codes.length) {
    // who needs a phone (decision 152, r0t d152, approved 03/10): asked first; codes only for them
    out.push({ reply: `איזה כיף להכיר! עכשיו אני מכיר את ${and(added)}.`, face: 'ecstatic', reaction: 'newMember' });
    s.phones = codes; s.step = 'phones'; await setState(db, s);
    out.push(ask(s, state, user));
    return { bubbles: out };
  }
  // nobody added: "רק את ואני", and from here on the singular too (stage 7 walkthrough)
  if (!added.length) s.alone = true;
  s.step = 'food'; await setState(db, s);
  if (added.length) {
    out.push({ reply: `איזה כיף להכיר! עכשיו אני מכיר את ${and(added)}.`, face: 'ecstatic', reaction: 'newMember' });
    out.push({ reply: codes.length > 1 ? 'הנה קוד לכל אחד, כדי שכל אחד יוכל לדבר איתי מהטלפון שלו. הקודים תקפים לשבוע. אפשר לשלוח לכל אחד את שלו בכפתור "לשלוח ל…" שליד השם.' : `הנה קוד בשביל ${codes[0].name}, כדי ש${byPerson(codes[0], 'הוא יוכל', 'היא תוכל', 'הם יוכלו')} לדבר איתי מהטלפון. הוא תקף לשבוע.`, face: 'happy', codes, only: user.id });
  } else out.push({ reply: `נעים מאוד, ${user.name}! אז רק ${byPerson(user, 'אתה', 'את', 'אתם')} ואני.`, face: 'ecstatic', reaction: 'love' });
  out.push(ask(s, state, user));
  return { bubbles: out };
}

/**
 * "2 קרטוני חלב" + 3% → "2 קרטוני חלב 3%"; "3 יוגורטים" + טבעי → "3 יוגורטים טבעיים"; "3 יוגורטים" + וניל → "3 יוגורטים של וניל"
 * (the kind goes after the word itself, and agrees with it when it's plural)
 */
function withKind(phrase, base, rest) {
  if (!rest) return phrase;
  const words = phrase.split(' ');
  const i = words.findIndex((w) => w === base);
  if (i >= 0) { words.splice(i + 1, 0, rest); return words.join(' '); }
  // the plural of the word: final letters open up (לחם → לחמים) and a closing ה goes (גבינה → גבינות)
  const stem = base.replace(/ה$/, '').replace(/[םןץףך]$/, (c) => ({ 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' })[c]);
  const j = words.findIndex((w) => w.startsWith(stem) && /^(ים|ות)$/.test(w.slice(stem.length)));
  if (j < 0) return `${phrase} ${rest}`;
  // an adjective (טבעי, צהובה) agrees with the plural: טבעיים, צהובות; anything else is "of": של וניל
  const adj = !rest.includes(' ') && /[יה]$/.test(rest) ? rest.replace(/ה$/, '') + (words[j].endsWith('ות') ? 'ות' : 'ים') : /^\d|%/.test(rest) ? rest : `של ${rest}`;
  words.splice(j + 1, 0, adj); return words.join(' ');
}

function createOf(it, place) {
  const qty = Number(it.qty) > 0 ? Number(it.qty) : 1;
  const product = { name: String(it.name).trim().slice(0, 80), count_type: it.count_type || 'units', category_id: it.category || 'אחר', ...(place && { location_id: place }), ...(it.unit && { unit: it.unit }) };
  if (product.count_type === 'level') product.level = 'plenty';
  else if (product.count_type === 'inuse') Object.assign(product, { is_open: true, qty: Math.max(0, qty - 1) });
  else if (product.count_type === 'pack') { const size = /ביצ/.test(product.name) ? 12 : 1; Object.assign(product, { qty: Number(it.qty) > 1 ? qty : size, pack_size: size }); } // "eggs" with no number: a pack
  else product.qty = qty;
  return { kind: 'create', product };
}

async function nextGeneric(env, s, state, user, out) {
  const db = env.DB;
  // one "which one?" at a time (decision 154); the answer can be anything, not only a button (187)
  const i = s.pending.findIndex((x, k) => k > s.at && x.generic);
  if (i >= 0) {
    s.at = i; s.step = 'generic'; await setState(db, s);
    const it = s.pending[i];
    out.push({ reply: it.question || `איזה ${it.name}?`, face: 'confused', options: (it.options || []).slice(0, 6) });
    return { bubbles: out };
  }
  // everything named: into the stock now, with a small "fix it" (decision 155)
  const rest = s.pending.filter((it) => !it.created);
  if (rest.length) await execOnboarding(env, user, rest.map((it) => createOf(it, s.place)));
  const names = s.pending.map((it) => it.phrase || howMany(Number(it.qty) || 1, it.unit, it.name));
  (s.mapped ||= []).push(s.place); s.filled = (s.filled || 0) + 1;
  s.pending = null; s.step = 'place'; await setState(db, s);
  out.push({ reply: `רשמתי ${placeOf(s.place)}: ${and(names)}.`, face: 'excited', reaction: 'mapped', undo: true });
  if (s.allDone) { s.allDone = false; return toBasics(db, s, state, user, out); }
  out.push({ reply: `יש! ${thePlace(s.place)} ממופה. איפה עוד?`, face: 'ecstatic', options: morePlaces(s, state) });
  return { bubbles: out };
}

async function toBasics(db, s, state, user, out) {
  s.step = 'basics'; await setState(db, s);
  await placesWereAsked(db, s.mapped || []); // home18 (7): the question below is about every place mapped now
  if (s.filled) out.push({ reply: 'יש, מיפינו את הבית!', face: 'ecstatic', reaction: 'settled' });
  else out.push({ reply: 'בסדר, את הבית נמפה בפעם אחרת.', face: 'happy' });
  out.push({ reply: basicsQuestion(s, user), face: 'happy' });
  return { bubbles: out };
}

async function finish(db, s, user, out) {
  s.step = 'done'; s.done = Date.now(); await setState(db, s);
  // home18 (5): where the house buys produce and care, asked once, after the first meeting's last words (below)
  const shops = await shopsDue(db, user) && shopAsk('produce');
  if (shops) await db.batch([db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_asked', ?)").bind(String(Date.now())), db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`ask:${user.id}`, JSON.stringify({ ...shops.ask, ts: Date.now() }))]);
  out.push({ reply: s.alone ? `זהו, עכשיו אני מכיר את הבית ${byPerson(user, 'שלך', 'שלך', 'שלכם')}! מעכשיו פשוט ${byPerson(user, 'ספר לי מה נגמר, מה קנית', 'ספרי לי מה נגמר, מה קנית', 'ספרו לי מה נגמר, מה קניתם')} ומה צריך ואני אדאג לשאר.` : 'זהו, עכשיו אני מכיר את הבית שלכם! מעכשיו פשוט ספרו לי מה נגמר, מה קניתם ומה צריך ואני אדאג לשאר.', face: 'ecstatic', reaction: 'settled' });
  if (shops) out.push(shops.bubble);
  return { bubbles: out };
}
