// See e2e-onboarding.sh. A new household, through the app on a phone-sized screen, against the real model:
// answers each question the way a person would (typing, or tapping Shuki's buttons) and prints the whole conversation.
// It fails on anything that isn't right: a loop, a missing step, a product that didn't get in, a page error.
const { chromium, devices } = require(process.env.PW);
const fs = require('node:fs');
const BASE = 'http://127.0.0.1:8779';
const DIR = '/tmp/shuki-test/e2e';
const out = []; const problems = [];
const log = (t) => { out.push(t); console.log(t); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let n = 0; const shot = (name) => p.screenshot({ path: `${DIR}/${String(++n).padStart(2, '0')}-${name}.png` });
  await p.goto(BASE + '/'); await p.waitForSelector('#setup', { timeout: 15000 }); await shot('setup');
  await p.fill('#s-code', '24681357');
  await p.click('#setup button[type=submit]'); await p.waitForSelector('#thread .msg.bot', { timeout: 15000 }); await p.waitForTimeout(4000);
  // the name, how to talk to me and the house's name are asked in the chat (30/09)
  for (const a of ['אבי', 'בלשון זכר', 'הבית שלנו']) { await p.fill('#say', a); await p.$eval('#composer', (f) => f.requestSubmit()); await p.waitForTimeout(2000); }
  const bots = () => p.$$eval('#thread .msg.bot', (xs) => xs.map((x) => x.innerText.replace(/\n+/g, ' ').trim()));
  const chips = () => p.$$eval('#thread [data-opt]', (xs) => xs.map((x) => x.dataset.opt));
  let seen = 0;
  const report = async () => {
    const all = await bots(); for (const m of all.slice(seen)) log(`שוקי: ${m}`); seen = all.length;
    const cs = await chips(); if (cs.length) log(`  [${cs.join(' | ')}]`);
    if (await p.$('.coupon.pending')) problems.push('an approval card during the first meeting');
    await shot('step'); return { last: all.at(-1) || '', cs };
  };
  const wait = async () => { await p.waitForFunction(() => !document.querySelector('#thread .typing'), null, { timeout: 90000 }).catch(() => problems.push('no answer in 90s')); await p.waitForTimeout(2500); };
  const type = async (text) => { log(`אבי: ${text}`); await p.fill('#say', text); await p.$eval('#composer', (f) => f.requestSubmit()); await wait(); return report(); };
  const tap = async (re, fallback) => {
    const cs = await chips(); const pick = cs.find((c) => re.test(c));
    if (!pick) { problems.push(`no button like ${re} (offered: ${cs.join(' | ') || 'none'})`); return type(fallback); }
    log(`אבי (כפתור): ${pick}`); await p.click(`#thread [data-opt="${pick}"]`); await wait(); return report();
  };
  let r = await report();
  if (!/מי מנהל את האפליקציה/.test(r.last)) problems.push('the fourth hello bubble does not ask who is in the house');
  // the conversation: each answer by what Shuki asks (a question asked twice in a row is a loop)
  const answers = [
    [/מי מנהל|מי עוד גר/, () => type('אני אבי, אני המנהל. גר איתי מיכל אשתי ושני הילדים')],
    [/השמות שלהם|בני כמה/, () => type('יואב בן 9 ואורית בת 6')],
    [/זכר או בלשון נקבה/, () => tap(/זכר|נקבה/, 'נקבה')],
    [/קוד לטלפון/, () => tap(/^לכולם$/, 'לכולם')], // r0t d152
    [/שלא אוכל משהו/, () => type('מיכל צמחונית')], // r0t r9-96
    [/מאיפה מתחילים/, () => tap(/^מקרר$/, 'מקרר')],
    [/מה יש במקרר/, () => type('2 קרטוני חלב, 10 ביצים, גבינה צהובה, 3 יוגורטים וחומוס')],
    [/^איזה|איזה סוג|איזו/, async () => { const cs = await chips(); return cs.length ? tap(new RegExp(`^${cs[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), cs[0]) : type('רגיל'); }],
    [/איפה עוד/, async () => (mapped++ ? tap(/סיימנו/, 'זהו, סיימנו למפות') : tap(/^מקפיא$/, 'מקפיא'))],
    [/מה יש במקפיא/, () => type('עוף ושתי שקיות אפונה')],
    [/קונים כל הזמן/, () => type('חלב וביצים')],
    [/יותר מאח(ד|ת)/, () => type('2 קרטוני חלב')],
    [/עוד משהו/, () => type('יש אלרגיה לבוטנים בבית')],
    [/שאזכור/, () => tap(/^כן$/, 'כן')],
  ];
  let mapped = 0, last = '', same = 0;
  for (let turn = 0; turn < 25; turn++) {
    if (/עכשיו אני מכיר את הבית/.test(r.last)) break;
    if (r.last === last) { if (++same >= 1) { problems.push(`loop: "${r.last}"`); break; } } else same = 0;
    last = r.last;
    const hit = answers.find(([re]) => re.test(r.last));
    if (!hit) { problems.push(`unexpected question: "${r.last}"`); break; }
    r = await hit[1]();
  }
  if (!/עכשיו אני מכיר את הבית/.test(r.last)) problems.push('never finished');
  const s = await p.evaluate(async () => (await fetch('/api/state', { headers: { authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` } })).json());
  log(`\nבני הבית: ${s.users.map((u) => `${u.name} (${u.role}${u.gender === 'f' ? ', נקבה' : ''})`).join(', ')}`);
  log(`במלאי: ${s.products.map((x) => `${x.name}${x.is_basic ? ` (קבוע, ${x.target})` : ''} [${s.locations.find((l) => l.id === x.location_id)?.name || '-'}]`).join(', ')}`);
  log(`הערות לבית: ${s.notes || '-'}`);
  const names = s.users.map((u) => u.name);
  for (const x of ['מיכל', 'יואב', 'אורית']) if (!names.includes(x)) problems.push(`${x} not in the house`);
  if (!s.users.some((u) => u.name === 'יואב' && u.role === 'child')) problems.push('Yoav is not a child');
  if (!/בוטנים/.test(s.notes || '')) problems.push('no allergy in the house notes');
  if (!s.products.some((x) => /^חלב/.test(x.name) && x.is_basic && x.target === 2)) problems.push('milk is not regular with 2');
  if (!s.products.some((x) => /ביצ/.test(x.name) && x.is_basic)) problems.push('eggs not regular');
  if (s.products.length < 7) problems.push(`only ${s.products.length} products`);
  if (s.products.some((x) => x.name === 'חלב')) problems.push('a milk with no kind');
  if (errs.length) problems.push(`page errors: ${errs.join(' | ')}`);
  log(`\n${problems.length ? `בעיות:\n- ${problems.join('\n- ')}` : 'עבר בלי בעיות'}`);
  fs.writeFileSync(`${DIR}/transcript.txt`, out.join('\n'));
  await b.close(); process.exit(problems.length ? 1 : 0);
})();
