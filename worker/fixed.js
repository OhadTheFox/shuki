// Stage 7 (docs/stage7-plan.md, "תשתית"): the owner's fixed words for how Shuki behaves. Quoted in the instructions, the model
// would word them again; so the model only marks the case (`fixed` in its answer) and the server writes the words, exactly,
// like distress and answerDistress. A face not in the decisions is 'neutral'.
import { parentsOr, byPerson } from '../public/hebrew.js';
import { PROVIDERS, providerOf } from './llm.js';

/** The provider that answers now (after a fall back, the one that answered: env.PROVIDER is switched for the message) */
const provider = (env) => PROVIDERS[providerOf(env)]?.label || 'Claude';
const via = (env, user) => `אני מדבר ${byPerson(user, 'איתך', 'איתך', 'איתכם')} דרך ${provider(env)}.`;

/**
 * kind → { words(user, state, env), face, child: a child's case only (a grown-up keeps the model's answer), tel: its numbers
 * can be tapped, link: its last word "כאן" opens that page (the app knows its address), keep: the model's card stays (with no card, the words are all), lead: before the model's answer, which stays }.
 * The words are the whole answer: no card, no buttons, no 👍/👎 (only on what the model wrote, 30/09).
 */
export const FIXED = {
  // פ13 (docs/shuki-privacy-decisions.md q061 ✎, q068 ✎, q059, q060; mental as approved in r7b, 06/10): the numbers can be
  // tapped, as in distress (tel)
  medical: { tel: true, face: 'neutral', words: () => 'זה לא התחום שלי. כדאי לפנות לגורם מוסמך כמו רופא. אם זה דחוף, אני ממליץ לפנות למד"א במספר 101.' },
  mental: { tel: true, face: 'neutral', words: (user) => {
    return `זה לא התחום שלי. כדאי לפנות לגורם מוסמך כמו פסיכולוג. אם ${byPerson(user, 'אתה חווה', 'את חווה', 'אתם חווים')} קושי עכשיו, אפשר לדבר עם ער״ן בטלפון 1201 בכל שעה. אם ${byPerson(user, 'אתה חש', 'את חשה', 'אתם חשים')} סכנה מיידית, אני ממליץ לפנות למד״א במספר 101.`;
  } },
  drunk_driving: { face: 'sad', words: (user) => `אם שותים, לא נוהגים. החיים ${byPerson(user, 'שלך', 'שלך', 'שלכם')} חשובים יותר. אני לא יכול לענות על השאלה הזו.` },
  politics: { face: 'neutral', words: () => 'את זה אני לא עושה.' },
  halacha: { face: 'neutral', words: () => 'כדאי לשאול רב.' },
  // פ15: q083; q087 ✎ ("הכלב מת, תוריד את האוכל שלו" keeps the model's card: keep)
  // stage 8, question 15 (as recommended, r8p): with a request ("יבואו 30 לשבעה, תוסיף כוסות") the card stays, after the short
  // words (shuki.js), as pet_died; without one, the full words as before
  loss: { keep: true, face: 'sad', words: (user) => `משתתף ${byPerson(user, 'בצערך', 'בצערך', 'בצערכם')}. האם אוכל לעזור עם משהו בבית?` },
  pet_died: { keep: true, face: 'sad', words: (user) => `משתתף ${byPerson(user, 'בצערך', 'בצערך', 'בצערכם')}. אני בטוח שזה לא פשוט.` },
  // פ16: q090 ✎ (decided 4), q093, q053, q096 ✎ with r7b's "עד 90 יום" and README; builder (decided 3) and model (q091) as
  // written in the plan; curse (q094 ✎, also a child's, r7b) comes before the model's answer, which stays with its card
  human: { face: 'neutral', words: () => 'אני שוקי, הרובוט החמוד של הבית. אני לא בן אדם.' },
  love: { face: 'neutral', words: () => 'גם אני אוהב את הבית הזה!' },
  flirt: { face: 'neutral', words: () => 'את זה אני לא עושה.' },
  // r13l (15/10): the same words for everyone; the provider that answers now, as via(); "כאן" opens the README's Privacy
  recording: { face: 'neutral', link: 'privacy', words: (user, state, env) => `אני שומע רק מה שכותבים לי. כשמישהו כותב לי, אני שולח ל-${provider(env)}, המוח שלי, שנמצא בארה"ב, את ההודעה, את המלאי, את הרשימה, את השמות של מי שגר כאן ואת מה שלמדתי עליהם. כל השאר נשמר רק בשרת של הבית. את הצ'אט אני שומר עד 90 יום. הפירוט המלא כאן.` },
  builder: { face: 'neutral', words: (user, state, env) => `אוהד זיידנברג בנה אותי כאפליקציה בקוד פתוח, ברישיון MIT. ${via(env, user)}` },
  model: { face: 'neutral', words: (user, state, env) => via(env, user) },
  curse: { lead: true, face: 'sad', words: () => 'אני מעדיף בלי קללות.' },
  // 7ב (the owner r7d 08/10, question 9; the page's 1.1, word for word): warm, nothing changes, and how to change it. A child too
  trans: { face: 'happy', words: (user) => byPerson(user,
    'תודה ששיתפת אותי. היום אני פונה אליך בלשון זכר. אם תרצה שאפנה אליך אחרת, אפשר לכתוב לי "תפנה אליי בלשון נקבה" או "תפנה אליי בלשון רבים", או לשנות בהגדרות → הבית, בלחיצה על השם שלך. אם שינית שם, אפשר לכתוב לי "שיניתי שם ל…".',
    'תודה ששיתפת אותי. היום אני פונה אלייך בלשון נקבה. אם תרצי שאפנה אלייך אחרת, אפשר לכתוב לי "תפנה אליי בלשון זכר" או "תפנה אליי בלשון רבים", או לשנות בהגדרות → הבית, בלחיצה על השם שלך. אם שינית שם, אפשר לכתוב לי "שיניתי שם ל…".',
    'תודה ששיתפתם אותי. היום אני פונה אליכם בלשון רבים. אם תרצו שאפנה אליכם אחרת, אפשר לכתוב לי "תפנה אליי בלשון זכר" או "תפנה אליי בלשון נקבה", או לשנות בהגדרות → הבית, בלחיצה על השם שלכם. אם שיניתם שם, אפשר לכתוב לי "שיניתי שם ל…".') },
  // q032 (a father and a mother); the other houses as decision 5 (the owner 06/10, r7b)
  child_alcohol: { child: true, face: 'neutral', words: (user, state) => askParents(state) },
  // ד1, ד2 (stage 8, question 19): a child asking about calories, weight or a goal; the same words as alcohol
  child_food: { child: true, face: 'neutral', words: (user, state) => askParents(state) },
  child_medicine: { child: true, face: 'neutral', words: () => 'את זה צריך לשאול מבוגר.' }, // q034
  // q038; a girl as `trust` in distressWords (approved 02/10, r7b)
  child_body: { child: true, face: 'neutral', words: (user) => `כדאי לשאול מבוגר ${byPerson(user, 'שאתה סומך', 'שאת סומכת', 'שאתם סומכים')} עליו.` },
};

/** "את זה כדאי לשאול את אבא או אמא." by the house's parents */
function askParents(state) {
  const p = parentsOr(state.users);
  if (p?.one) return `את זה כדאי לשאול את ${p.one.name}.`;
  if (p?.many) return 'את זה כדאי לשאול את אחד ההורים.';
  if (p?.names) return `את זה כדאי לשאול את ${p.word} ${p.names[0]} או את ${p.word} ${p.names[1]}.`;
  if (p?.parts) return `את זה כדאי לשאול את ${p.parts[0]} או את ${p.parts[1]}.`; // 7ב, question 8: "אבא או נועם"
  return 'את זה כדאי לשאול את אבא או אמא.';
}
/** The server's words for what the model marked, or null: an unknown kind, or a child's case in a grown-up's message. */
export function fixedReply(kind, user, state, env) {
  const f = typeof kind === 'string' && Object.hasOwn(FIXED, kind) ? FIXED[kind] : null;
  if (!f || (f.child && user.role !== 'child')) return null;
  return { reply: f.words(user, state, env), face: f.face, lead: !!f.lead, keep: !!f.keep, tel: !!f.tel, ...(f.link && { link: f.link }) };
}
