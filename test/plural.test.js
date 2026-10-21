// Stage 7ב, "בלשון רבים" (פ22, q043; the wording page docs/stage7b-texts.md, approved by the owner, r7d 08/10): the words to
// someone who chose the plural ('p'), exactly as approved. The second person here (22א); the third person, the model and
// the parents, and the choice itself in their own parts below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fixedReply } from '../worker/fixed.js';
import { distressWords } from '../worker/distress.js';
import { againQuestion, toYou, toWriter, houseText, LIFE_TALK, SICK_TALK } from '../worker/shuki.js';
import { helloBubbles, aboutHouse, habitQuestion, ask, joinedBubble } from '../worker/onboarding.js';
import { onlyTheyDelete } from '../worker/store.js';
import { noticedText, yesActions, ownerQuestion } from '../worker/instincts.js';
import { factsText } from '../worker/facts.js';

const noam = { id: 7, name: 'נועם', gender: 'p', role: 'member' };
const noamKid = { ...noam, role: 'child' };
const avi = { id: 1, name: 'אבי', gender: 'm', role: 'admin', active: 1 }, michal = { id: 2, name: 'מיכל', gender: 'f', role: 'member', active: 1 };
const env = { PROVIDER: 'anthropic' };

/** The p argument of every byPerson call in a source, for the app (it runs in a browser). */
function pForms(src) {
  const out = [], re = /(?<![\w$.])byPerson\(/g;
  for (let m; (m = re.exec(src));) {
    let i = m.index + m[0].length; const stack = [], commas = [];
    for (; i < src.length; i++) {
      const c = src[i], top = stack.at(-1);
      if (top === "'" || top === '"') { if (c === '\\') i++; else if (c === top) stack.pop(); continue; }
      if (top === '`') { if (c === '\\') i++; else if (c === '`') stack.pop(); else if (c === '$' && src[i + 1] === '{') { stack.push('{'); i++; } continue; }
      if ("'\"`([{".includes(c)) { stack.push(c); continue; }
      if (')]}'.includes(c)) { if (!stack.length) break; stack.pop(); continue; }
      if (c === ',' && !stack.length) commas.push(i);
    }
    out.push(src.slice(commas.at(-1) + 1, i).trim().replace(/^'|'$/g, ''));
  }
  return out;
}

test('22א: the fixed words in the plural (fixed.js)', () => {
  assert.equal(fixedReply('mental', noam, {}, env).reply, 'זה לא התחום שלי. כדאי לפנות לגורם מוסמך כמו פסיכולוג. אם אתם חווים קושי עכשיו, אפשר לדבר עם ער״ן בטלפון 1201 בכל שעה. אם אתם חשים סכנה מיידית, אני ממליץ לפנות למד״א במספר 101.');
  assert.equal(fixedReply('drunk_driving', noam, {}, env).reply, 'אם שותים, לא נוהגים. החיים שלכם חשובים יותר. אני לא יכול לענות על השאלה הזו.');
  assert.equal(fixedReply('loss', noam, {}, env).reply, 'משתתף בצערכם. האם אוכל לעזור עם משהו בבית?');
  assert.equal(fixedReply('pet_died', noam, {}, env).reply, 'משתתף בצערכם. אני בטוח שזה לא פשוט.');
  assert.equal(fixedReply('model', noam, {}, env).reply, 'אני מדבר איתכם דרך Claude.');
  assert.equal(fixedReply('child_body', noamKid, {}, env).reply, 'כדאי לשאול מבוגר שאתם סומכים עליו.');
  // m and f as before
  assert.equal(fixedReply('loss', avi, {}, env).reply, 'משתתף בצערך. האם אוכל לעזור עם משהו בבית?');
  assert.equal(fixedReply('model', michal, {}, env).reply, 'אני מדבר איתך דרך Claude.');
});

test('22א: distress in the plural (distress.js): "איתכם", "עליכם", "לכם", "שאתם סומכים", and a child\'s "שכתבתם"', () => {
  assert.equal(distressWords('self', noam, []), 'אני כאן איתכם. אפשר לדבר עכשיו עם ער"ן בטלפון 1201, בכל שעה. אם יש סכנה מיידית, להתקשר למד"א בטלפון 101. האם יש מישהו קרוב שיכול להיות איתכם עכשיו?');
  assert.equal(distressWords('online', noam, []), 'אני כאן איתכם. אם מאיימים עליכם, אפשר להתלונן במשטרה בטלפון 100. אם קשה לכם, אפשר לדבר עם ער"ן בטלפון 1201, בכל שעה.');
  assert.equal(distressWords('violence_home', noam, []), 'אני כאן איתכם. אני ממליץ להתקשר לקו החם לאלימות במשפחה, בטלפון 118. אם יש סכנה מיידית, להתקשר למשטרה בטלפון 100. לא אספר על זה לאף אחד בבית.');
  assert.equal(distressWords('online', noamKid, [avi, michal]), 'אני כאן איתכם. אבא ואמא לא יראו את מה שכתבתם. אפשר להתקשר ל-105, שם עוזרים לילדים שנפגעו ברשת, בכל שעה. כדאי לספר גם למבוגר שאתם סומכים עליו.');
  assert.equal(distressWords('online', { ...noamKid, gender: 'm' }, [avi, michal]), 'אני כאן איתך. אבא ואמא לא יראו את מה שכתבת. אפשר להתקשר ל-105, שם עוזרים לילדים שנפגעו ברשת, בכל שעה. כדאי לספר גם למבוגר שאתה סומך עליו.');
});

test('22א: "רשמתי ש…" again, in the plural (againQuestion)', () => {
  const q = (key, value) => againQuestion({ key, value }, noam);
  assert.equal(q('period', 'צבא'), 'האם אתם עדיין בצבא?');
  assert.equal(q('avoid', 'פטריות'), 'רשמתי שאתם לא אוכלים פטריות. האם זה עדיין נכון?');
  assert.equal(q('likes', 'שוקולד'), 'רשמתי שאתם אוהבים שוקולד. האם זה עדיין נכון?');
  assert.equal(q('shabbat', 'כן'), 'רשמתי שאתם שומרים שבת. האם זה עדיין נכון?');
  assert.equal(q('allergy', 'בוטנים'), 'רשמתי שיש לכם אלרגיה לבוטנים. האם זה עדיין נכון?');
  assert.equal(q('no_ask', 'ללמוד'), 'רשמתי שלא לשאול אתכם שאלות כדי ללמוד. האם זה עדיין נכון?');
  assert.equal(againQuestion({ key: 'no_ask', value: 'ללמוד' }, michal), 'רשמתי שלא לשאול אותך שאלות כדי ללמוד. האם זה עדיין נכון?');
});

test('22א: the first meeting and someone who joins, in the plural (onboarding.js)', () => {
  const [, hi2, hi3] = helloBubbles(noam);
  assert.equal(hi2.reply, 'אפשר לספר לי מה נגמר, מה קניתם ומה צריך ואני אעדכן את המלאי ואת הרשימה של כולם. אני גם מזכיר כשהתוקף של משהו עומד לפוג ועוזר עם מתכונים. נסו למשל: "נגמר החלב".');
  assert.equal(hi3.reply, "הצ'אט שלכם איתי אישי. המלאי, הרשימה והמתכונים משותפים לכל הבית.");
  const about = aboutHouse(noam, { house: 'הבית', others: ['אבי', 'מיכל'], notes: 'נועם צמחוני. אבי לא אוכל פטריות' });
  assert.equal(about[0].reply, 'אני רוצה לספר לכם מה אני יודע על הבית. קוראים לו "הבית". אתם גרים בו עם אבי ומיכל. המלאי עוד ריק.');
  assert.equal(about[1].reply, 'מה שאני יודע על האוכל בבית: נועם צמחוני. אבי לא אוכל פטריות.', 'question 5: in the plural the name stays');
  assert.equal(aboutHouse(michal, { house: 'הבית', notes: 'מיכל צמחונית' })[1].reply, 'מה שאני יודע על האוכל בבית: את צמחונית.');
  assert.equal(habitQuestion(['אבי שותה קפה'], noam), 'האם תרצו שאזכור שאבי שותה קפה?');
  assert.equal(habitQuestion(['אבי שותה קפה'], michal), 'האם תרצי שאזכור שאבי שותה קפה?');
  const alone = { alone: true };
  assert.equal(ask({ ...alone, step: 'food' }, {}, noam).reply, 'האם יש משהו שאתם לא אוכלים?');
  assert.equal(ask({ ...alone, step: 'more' }, {}, noam).reply, 'והאם יש עוד משהו שתרצו להגיד לי? למשל אלרגיה, כשרות או משהו שכדאי שאדע.');
  assert.match(ask({ ...alone, step: 'place', mapped: [] }, { locations: [] }, noam).reply, /^יאללה, בואו נמפה את הבית!/);
});

test('22א: the app gives the approved plural (public/app.js, byPerson\'s p)', () => {
  const p = pForms(readFileSync('public/app.js', 'utf8'));
  for (const w of ['רק אתם רואים', 'כתבו לי…', 'בואו', 'תעזרו לי', 'יוצאים לקניות', 'האם תרצו', 'לכם', 'לא קניתם', 'קניתם', 'אל תשכחו', 'אתם', 'עליכם', 'כתבו', 'הוסיפו חבר חדש לבית', 'אתכם', 'בשמכם', 'שלכם']) assert.ok(p.includes(w), w);
  assert.equal(p.filter((x) => x === 'בשמכם').length, 2, 'question 111 (r7e): connHelp too');
  assert.ok(readFileSync('public/app.js', 'utf8').includes("ומי שיש לו אותה מדבר איתי ${byPerson(S?.me, 'בשמך', 'בשמך', 'בשמכם')}. אפשר לנתק אותה כאן בכל רגע.</p>"));
  assert.equal(p.filter((x) => x === 'האם תרצו').length, 3); assert.equal(p.filter((x) => x === 'לכם').length, 2); assert.equal(p.filter((x) => x === 'עליכם').length, 2); // and question 32 (r9z): "נשאר מעט X. האם תרצו שאוסיף…?"
});

test('22ב: about someone who chose the plural, the third person in the plural (r7b; questions 2, 7, 12, 20)', () => {
  assert.equal(joinedBubble(noam).reply, 'נועם הצטרפו לבית שלך! ברוכים הבאים!', 'question 2: "שלך" stays');
  assert.equal(onlyTheyDelete({ owner: 7 }, [{ ...noam, role: 'admin', active: 1 }]), 'את המוצר הזה רק נועם יכולים למחוק.');
  const state = { users: [noam], products: [{ id: 3, name: 'חלב', count_type: 'pack' }] };
  assert.equal(noticedText({ kind: 'want', user_id: 7, product_id: 3, data: '{"v":2}' }, state), 'כשנועם מוסיפים חלב לרשימה, הם תמיד מוסיפים 2 אריזות. אני שם אוטומטית 2. האם זה בסדר?');
  assert.equal(noticedText({ kind: 'buyer', user_id: 7, data: '{"v":"super"}' }, state), 'נועם עושים כמעט תמיד את הסופר.');
  assert.deepEqual(yesActions({ kind: 'buyer', user_id: 7, data: '{"v":"super"}' }, state), [{ kind: 'lesson', text: 'נועם קונים בדרך כלל בסופר' }]);
  assert.equal(noticedText({ kind: 'buyer', user_id: 1, data: '{"v":"super"}' }, { users: [avi], products: [] }), 'אבי עושה כמעט תמיד את הסופר.');
  // stage 8, question 52 (r9p): a question word; 17/10 (ש5): "אתם קונים X הרבה. האם להפוך אותו / אותה / אותן למוצר קבוע?"
  const reg = (name) => noticedText({ kind: 'regular', product_id: 5 }, { users: [], products: [{ id: 5, name, is_basic: 0 }] });
  assert.equal(reg('חלב'), 'אתם קונים חלב הרבה. האם להפוך אותו למוצר קבוע?');
  assert.equal(reg('גבינה'), 'אתם קונים גבינה הרבה. האם להפוך אותה למוצר קבוע?');
  assert.equal(reg('ביצים'), 'אתם קונים ביצים הרבה. האם להפוך אותן למוצר קבוע?');
  assert.match(factsText([{ about: 'person', about_id: 7, key: 'diet', value: 'צמחוני', confirmed_by: 7 }], [noam], avi).cached, /diet: צמחוני \(לא אוכלים דגים\)/);
  const ask1 = ask({ step: 'phones', phones: [{ name: 'נועם', gender: 'p' }] }, {}, avi);
  assert.equal(ask1.reply, 'האם נועם צריכים קוד לטלפון?');
});

test('22ב: the app, the third person and the names of facts in the plural; the tags in the masculine (question 11)', () => {
  const src = readFileSync('public/app.js', 'utf8'), p = pForms(src);
  for (const w of ['הוציאו', 'הוסיפו', 'יכולים', 'אותם', 'ביקשו שאזכיר להם', 'ביקשו', 'הציעו']) assert.ok(p.includes(w), w);
  assert.match(src, /avoid: \['לא אוכל', 'לא אוכלת', 'לא אוכלים'\]/); assert.match(src, /shabbat: \['שומר שבת', 'שומרת שבת', 'שומרים שבת'\]/); assert.match(src, /likes: \['אוהב', 'אוהבת', 'אוהבים'\]/);
  for (const w of [' · מנהל הבית', ' · ילד', 'להפוך למנהל', 'מבוגר (מוסיף בלי אישור)', 'ילד (מה שמוסיף מחכה לאישור)', 'מנהל']) assert.ok(p.includes(w), w);
});

test('22ב, question 3 (r7c): the pronoun in the third person, also in the masculine and the feminine', () => {
  const src = readFileSync('worker/onboarding.js', 'utf8');
  assert.equal(src.match(/כדי ש\$\{byPerson\(\w+\[0\], 'הוא יוכל', 'היא תוכל', 'הם יוכלו'\)\} לדבר איתי מהטלפון/g)?.length, 2);
  // the owner's words (r7e 10/10, question 113): "אם הוא יאשר אני אזכור את זה.", and for several "אם הם יאשרו…"
  assert.match(readFileSync('worker/shuki.js', 'utf8'), /אם \$\{adults\.length > 1 \? 'הם יאשרו' : byPerson\(adults\[0\], 'הוא יאשר', 'היא תאשר', 'הם יאשרו'\)\} אני אזכור את זה\.`/);
});

test('22א, the reviewer: a rule said back to its own person (toYou); a rule about others stays as it is, for everyone', () => {
  const kids = 'כשהילדים אומרים חטיף הם מתכוונים לבמבה';
  for (const u of [avi, michal, noam]) assert.equal(toYou(kids, u), kids, u.gender);
  assert.equal(toYou('כשנועם אומרים חלב הם מתכוונים לחלב סויה', noam), 'כשאתם אומרים חלב, אתם מתכוונים לחלב סויה');
  assert.equal(toYou('כשנועם אומר חלב הוא מתכוון לחלב סויה', noam), 'כשאתם אומרים חלב, אתם מתכוונים לחלב סויה', 'written in the singular before');
  assert.equal(toYou('נועם שותים קפה בבוקר', noam), 'אתם שותים קפה בבוקר');
  assert.equal(toYou('נועם קונה חלב 3%', noam), 'אתם קונים חלב 3%');
  // m and f exactly as before
  assert.equal(toYou('כשאבי אומר חלב הוא מתכוון לחלב סויה', avi), 'כשאתה אומר חלב, אתה מתכוון לחלב סויה');
  assert.equal(toYou('כשמיכל אומרת חלב היא מתכוונת לחלב סויה', michal), 'כשאת אומרת חלב, את מתכוונת לחלב סויה');
  assert.equal(toYou('מיכל שותה קפה', michal), 'את שותה קפה');
  assert.equal(toYou('אבי קונים חלב', avi), 'אבי קונים חלב');
});

test('22ג: a parent who chose the plural, in a child\'s distress and alcohol words (questions 8, 8ב)', () => {
  const kid = { id: 3, name: 'יואבי', gender: 'm', role: 'child', active: 1 }, noamP = { ...noam, active: 1 };
  assert.match(distressWords('self', kid, [noamP, kid]), /^אני כאן איתך\. נועם לא יראו את מה שכתבת\. /);
  assert.match(distressWords('self', kid, [avi, noamP, kid]), /^אני כאן איתך\. ההורים לא יראו את מה שכתבת\. /);
  assert.match(distressWords('self', kid, [avi, michal, kid]), /^אני כאן איתך\. אבא ואמא לא יראו את מה שכתבת\. /);
  assert.equal(fixedReply('child_alcohol', kid, { users: [avi, noamP, kid] }, env).reply, 'את זה כדאי לשאול את אבא או את נועם.');
  assert.equal(fixedReply('child_alcohol', kid, { users: [noamP, kid] }, env).reply, 'את זה כדאי לשאול את נועם.');
  assert.equal(fixedReply('child_alcohol', kid, { users: [noamP, { ...noamP, id: 8, name: 'עדי' }, kid] }, env).reply, 'את זה כדאי לשאול את נועם או את עדי.');
});

test('22ג: what the model reads about someone who chose the plural (question 17): houseText, the instructions, the facts', () => {
  const st = { users: [{ ...noam, role: 'admin' }, { ...noamKid, id: 8, name: 'עדי' }, avi], categories: [], locations: [] };
  assert.match(houseText(st), /בני הבית: נועם \(רבים, מנהל הבית\), עדי \(רבים, ילד\), אבי \(זכר, מנהל הבית\)/);
  const shuki = readFileSync('worker/shuki.js', 'utf8');
  assert.ok(shuki.includes('רבים ("קניתם", "יש לכם") רק כשמדברים על כל הבית. ולמי שבחר רבים: "קניתם", "שימו לב", גם כשזה אדם אחד.'));
  assert.ok(shuki.includes('- גם כשמדברים על מי שבחר לשון רבים, בגוף שלישי, ברבים ובשם שלו ("נועם קנו חלב", "שהם יאשרו").'));
  assert.ok(shuki.includes("(פנה אליו/אליה בלשון ${byPerson(user, 'זכר', 'נקבה', 'רבים: \"קניתם\", \"שימו לב\"')})."));
  assert.ok(shuki.includes('(תרצה, תרצי, תרצו, תאשר)'));
  const t = factsText([{ about: 'person', about_id: 7, key: 'substitute', value: 'חלב סויה', confirmed_by: 7 }], [noam], noam);
  assert.match(t.writer, /^העובדות של נועם עצמו\/עצמה\/עצמם /); assert.match(t.writer, /\(התחליף שלכם\)/);
});

// the reviewer of 22ב: every third-person form on the page, as each file's byPerson calls give it ([file, m, p])
const PAIRS = [
  ['worker/index.js', 'הציע', 'הציעו'], ['worker/index.js', 'מבקש', 'מבקשים'], ['worker/index.js', 'יצא', 'יצאו'], ['worker/index.js', 'שלו', 'שלהם'],
  ['worker/index.js', 'החזיר', 'החזירו'], ['worker/index.js', 'הוא', 'הם'], ['worker/index.js', 'אליו', 'אליהם'], ['worker/index.js', 'סיים', 'סיימו'],
  ['worker/index.js', 'הוסיף', 'הוסיפו'], ['worker/index.js', 'הוציא', 'הוציאו'],
  ['worker/restart.js', 'גר', 'גרים'], ['worker/restart.js', 'נשאר', 'נשארים'], ['worker/restart.js', 'יצא', 'יצאו'], ['worker/restart.js', 'שלו', 'שלהם'],
  ['worker/onboarding.js', 'שלו', 'שלהם'], ['worker/facts.js', 'מי שגר כאן', 'מי שגרו כאן'], ['worker/facts.js', 'לימד', 'לימדו'],
  ['worker/shuki.js', 'ביקש', 'ביקשו'], ['worker/shuki.js', 'הוא יאשר', 'הם יאשרו'], ['worker/shuki.js', 'יכול', 'יכולים'], ['worker/shuki.js', 'אומר', 'אומרים'],
  ['worker/shuki.js', 'הוא מתכוון', 'הם מתכוונים'], ['worker/shuki.js', 'מי שגר כאן', 'מי שגרו כאן'], ['worker/shuki.js', 'לימד', 'לימדו'],
  ...['קנה', 'הוסיף למלאי', 'עדכן', 'מחק', 'קנה לאירוח', 'סימן שנגמר', 'סימן שכמעט נגמר', 'השתמש ב', 'פתח', 'זרק', 'החזיר לחנות את', 'עדכן כמות:', 'עדכן כמות ברשימה:',
    'הוסיף לרשימה', 'הסיר מהרשימה', 'ביטל הזמנה של', 'הזמין במשלוח', 'קיבל במשלוח', 'הוציא מהעגלה את', 'אישר לרשימה', 'לא אישר', 'השאיר ברשימה', 'אישר שעדיין יש', 'סיים', 'שינה', 'ביטל']
    .map((m) => ['worker/store.js', m, { 'קנה': 'קנו', 'קנה לאירוח': 'קנו לאירוח', 'לא אישר': 'לא אישרו', 'סימן שנגמר': 'סימנו שנגמר', 'סימן שכמעט נגמר': 'סימנו שכמעט נגמר', 'השתמש ב': 'השתמשו ב' }[m]
      || m.replace(/^(\S+)/, (v) => ({ 'הוסיף': 'הוסיפו', 'עדכן': 'עדכנו', 'מחק': 'מחקו', 'פתח': 'פתחו', 'זרק': 'זרקו', 'החזיר': 'החזירו', 'הסיר': 'הסירו', 'ביטל': 'ביטלו', 'הזמין': 'הזמינו', 'קיבל': 'קיבלו', 'הוציא': 'הוציאו', 'אישר': 'אישרו', 'השאיר': 'השאירו', 'סיים': 'סיימו', 'שינה': 'שינו' }[v]))]),
];
test('22ב, the reviewer: each third-person form on the page is given as p, by file', () => {
  const calls = {};
  for (const [f, m, p] of PAIRS) {
    calls[f] ||= (() => { const src = readFileSync(f, 'utf8'), out = [], re = /(?<![\w$.])byPerson\(/g;
      for (let x; (x = re.exec(src));) { const a = src.slice(x.index).match(/^byPerson\([^,]+, '([^']*)', '[^']*', '([^']*)'\)/); if (a) out.push(`${a[1]}→${a[2]}`); }
      return out; })();
    assert.ok(calls[f].includes(`${m}→${p}`), `${f}: ${m} → ${p}`);
    assert.ok(!calls[f].includes(`${m}→${m}`), `${f}: ${m} still → ${m}`);
  }
});

test('22ד: the choice in the app — "פנייה בלשון רבים", a third option, an empty first one when adding (13), the share message (6)', () => {
  const src = readFileSync('public/app.js', 'utf8'), p = pForms(src);
  assert.ok(p.includes('פנייה בלשון רבים'));
  assert.ok(src.includes('<select class="field" id="m-gender"><option value="" selected disabled hidden></option><option value="m">בלשון זכר</option><option value="f">בלשון נקבה</option><option value="p">בלשון רבים</option></select>'));
  assert.ok(src.includes("[['m', 'בלשון זכר'], ['f', 'בלשון נקבה'], ['p', 'בלשון רבים']]"), '#e-gender');
  assert.match(src, /const gender = \$\('#m-gender'\)\.value; if \(!gender\) \{ \$\('#m-gender'\)\.focus\(\); return; \}/);
  assert.match(src, /הוספתי \$\{byPerson\(b\.dataset\.gender, 'אותך', 'אותך', 'אתכם'\)\} לשוקי,/);
  assert.match(src, /data-gender="\$\{esc\(x\.gender \|\| ''\)\}"/);
});
test('22ד: "אני טרנס" (question 9) in the approved words, for all three, a child too', { skip: !existsSync('docs/stage7b-texts.md') && 'the wording page is not in the public copy' }, () => {
  const page = readFileSync('docs/stage7b-texts.md', 'utf8');
  for (const u of [noam, avi, michal, noamKid]) { const r = fixedReply('trans', u, {}, env); assert.ok(page.includes(r.reply), u.gender); assert.equal(r.face, 'happy'); }
  assert.match(fixedReply('trans', noam, {}, env).reply, /^תודה ששיתפתם אותי\. היום אני פונה אליכם בלשון רבים\./);
});

test('0ב (stage 9): toWriter: about whoever writes, in the second person; about someone else, as it is', () => {
  const u = (id, name, gender = 'm') => ({ id, name, gender });
  const yaron = u(1, 'ירון'), liron = u(2, 'לירון', 'f'), dani = u(5, 'דני :)'), avigail = u(6, 'אביגיל', 'f');
  assert.equal(toWriter('אבי לא אוכל פטריות', avi), 'אתה לא אוכל פטריות');
  assert.equal(toWriter('מיכל אלרגית לבוטנים', michal), 'את אלרגית לבוטנים');
  assert.equal(toWriter('לאבי יש מקרר קטן', avi), 'לך יש מקרר קטן');
  assert.equal(toWriter('נועם לא אוכל פטריות', noam), 'אתם לא אוכלים פטריות', 'the plural, also when the model wrote the verb in the singular');
  assert.equal(toWriter('לנועם יש מקרר', noam), 'לכם יש מקרר');
  assert.equal(toWriter('כשמיכל אומרת חלב היא מתכוונת לחלב סויה', avi), 'כשמיכל אומרת חלב היא מתכוונת לחלב סויה', 'another\'s rule');
  assert.equal(toWriter('לירון לא אוכלת פטריות', yaron, [yaron, liron]), 'לירון לא אוכלת פטריות', 'לירון is someone else, not ל+ירון');
  assert.equal(toWriter('ירון לא אוכל פטריות', yaron, [yaron, liron]), 'אתה לא אוכל פטריות');
  assert.equal(toWriter('אביגיל צמחונית', avi, [avi, avigail]), 'אביגיל צמחונית');
  assert.equal(toWriter('דני :) צמחוני', dani), 'אתה צמחוני', 'a name with regex characters');
  // the plural only where it can be said: "נועם צמחוני" isn't "אתם צמחוני" (the reviewer of 38fdba1)
  assert.equal(toWriter('נועם צמחוני', noam), 'נועם צמחוני');
  assert.equal(toWriter('נועם אלרגי לבוטנים', noam), 'נועם אלרגי לבוטנים');
  assert.equal(toWriter('נועם צמחונים', noam), 'אתם צמחונים');
  assert.equal(toWriter('נועם גם לא אוכל פטריות', noam), 'אתם גם לא אוכלים פטריות');
});

test('stage 8, question 51: LIFE_TALK, talk about food or health (a whole word, a woman too; not the dog\'s food)', () => {
  for (const t of ['מה לאכול הערב?', 'יש לי כמה מתכונים', 'אני מתאמנת כל בוקר', 'אני אוכלת בחוץ היום', 'אני אוכל כמעט רק ירקות', 'תן לי מתכון לשקשוקה', 'התאמנתי היום']) assert.ok(LIFE_TALK.test(t), t);
  for (const t of ['כמה אוכל לכלב נשאר?', 'קניתי מנורה', 'סטטיסטיקה של אוכלוסיה', 'בריאן בא מחר', 'נגמר החלב']) assert.ok(!LIFE_TALK.test(t), t);
});

test('מ1 (stage 9): ownerQuestion, the verb by the product, in three forms', () => {
  const cats = [{ id: 1, name: 'משקאות' }, { id: 2, name: 'מוצרי חלב, גבינות וביצים' }, { id: 3, name: 'יבשים' }, { id: 4, name: 'טואלטיקה והיגיינה' }, { id: 5, name: 'חטיפים ומתוקים' }];
  const q = (name, category_id, me) => ownerQuestion({ product_id: 9 }, { products: [{ id: 9, name, category_id }], categories: cats }, me);
  assert.equal(q('חלב סויה', 2, michal), 'אגב, האם רק את שותה חלב סויה?');
  assert.equal(q('חלב סויה', 2, avi), 'אגב, האם רק אתה שותה חלב סויה?');
  assert.equal(q('מיץ תפוזים', 1, noam), 'אגב, האם רק אתם שותים מיץ תפוזים?');
  assert.equal(q('דגני בוקר', 3, avi), 'אגב, האם רק אתה אוכל דגני בוקר?');
  assert.equal(q('דגני בוקר', 3, michal), 'אגב, האם רק את אוכלת דגני בוקר?');
  assert.equal(q('שמפו', 4, noam), 'אגב, האם רק אתם משתמשים בשמפו?');
  assert.equal(q('שוקולד חלב', 5, michal), 'אגב, האם רק את אוכלת שוקולד חלב?', 'chocolate isn\'t drunk');
  assert.equal(q('סבון חלב עיזים', 4, michal), 'אגב, האם רק את משתמשת בסבון חלב עיזים?');
});


test('question 31 (r9z, ב): no words of illness or health in LIFE_TALK; SICK_TALK keeps the question away', () => {
  for (const t of ['אמרו לי מהרופא', 'הרופא אמר לי לשמור', 'יש לי סוכרת', 'אני בהריון', 'הכולסטרול שלי גבוה', 'יש לי לחץ דם']) { assert.ok(!LIFE_TALK.test(t), t); assert.ok(SICK_TALK.test(t), t); }
  assert.ok(LIFE_TALK.test('הילד חולה, מה לבשל?') && SICK_TALK.test('הילד חולה, מה לבשל?'));
  for (const t of ['מה לאכול הערב?', 'קניתי חומוס']) assert.ok(!SICK_TALK.test(t), t);
  for (const t of ['יש לה כאבי בטן', 'יש לו בחילה', 'הקטן הקיא בלילה', 'יש לו נזלת ושיעול', 'יש לילד 39 חום', 'כאב לו הראש', 'יש לאורית חום, מה לבשל?', 'יש לבעלי 38 חום', 'יש לבן שלי חום']) assert.ok(SICK_TALK.test(t), t); // the review of c2f14cb
  for (const t of ['אורז חום', 'לחם חום', 'יש לחם חום בבית?', 'יש לבן חום?', 'יש לחמניות חום?', 'יש לחמניה חום']) assert.ok(!SICK_TALK.test(t), t); // the review of 8c99f48
});

test('r9z, questions 32 and 35: the low card asks with a question word, by who reads; the roommates switch says what it does', () => {
  const app = readFileSync('public/app.js', 'utf8');
  assert.ok(app.includes("נשאר מעט ${esc(all)}. ${byPerson(S.me, 'האם תרצה', 'האם תרצי', 'האם תרצו')} שאוסיף את זה לרשימה?"));
  assert.ok(app.includes('דירת שותפים (מה חסר והצעות אוכל לכל אחד רק מהמשותף ומשלו)'));
  assert.ok(app.includes("'עכשיו זה בית אחד'"));
});

test('r9z, the review of 468b797: SICK_TALK not on "חום" or "חולה על"; a cold is one', () => {
  for (const t of ['מה לבשל עם אורז חום?', 'יש לי סוכר חום, מה להכין?', 'אני חולה על שקשוקה, מה לבשל?', 'הילדים חולים על פסטה, מה להכין?']) assert.ok(!SICK_TALK.test(t), t);
  for (const t of ['אני מצוננת, מה לבשל?', 'יש לו שפעת', 'הילד חולה, מה לבשל?']) assert.ok(SICK_TALK.test(t), t);
});

test('r9z, the review of dda630e: fever in a phrase, and more symptoms, keep the question away; brown rice does not', () => {
  for (const t of ['יש לו חום, מה לבשל?', 'הילד עם חום, מה להכין?', 'כואבת לו הבטן, מה לבשל?', 'יש לה דלקת גרון', 'הוא מקיא', 'יש לו שלשול']) assert.ok(SICK_TALK.test(t), t);
  for (const t of ['מה לבשל עם אורז חום?', 'יש לי סוכר חום, מה להכין?', 'לחם חום או לבן, מה לאכול?']) assert.ok(!SICK_TALK.test(t), t);
});
