// Stage 5: screenshots at 390×844 to compare with the mock-ups (the owner 05/10), into docs/stage5-shots/. Not a test: it
// only shoots. Run: UIS="test/stage5-shots.cjs" tools/runall.sh <OUT> ui
const browser = require(process.env.PW)[process.env.PW_BROWSER || 'chromium'];
const lib = require('./sweep-lib.cjs');
const { phone, d1 } = lib;
const DIR = `${__dirname}/../docs/stage5-shots`; require('node:fs').mkdirSync(DIR, { recursive: true });
(async () => {
  const b = await browser.launch();
  d1("INSERT OR REPLACE INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
  const avi = await phone(b, { w: 390, h: 844 }), michal = await phone(b, { w: 390, h: 844, user: 2 }), kid = await phone(b, { w: 390, h: 844, user: 3 });
  const ONLY = process.env.SHOTS ? process.env.SHOTS.split(',') : null; // only these names ("1,2,4")
  const shot = async (p, name) => { if (ONLY && !ONLY.includes(name.split('-')[0])) return; await p.waitForTimeout(500); await p.screenshot({ path: `${DIR}/${name}.png` }); console.log('shot', name); };
  await avi.api('POST', '/api/actions', { actions: ['חלב 3%', 'לחם', 'ביצים', 'קוטג\'', 'עגבניות'].map((name) => ({ kind: 'create', product: { name, count_type: 'units', qty: 2 } })) });
  const id = async (n) => (await avi.state()).products.find((p) => p.name === n).id;
  // one gray line: Michal buys milk, Avi says something after (Yoavi says hi first, so his chat shows the lines after it)
  await kid.api('POST', '/api/chat', { text: 'היי' });
  await avi.api('POST', '/api/chat', { text: 'היי' });
  await michal.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: await id('חלב 3%'), op: { type: 'purchase', amount: 1 } }] }); // a purchase: no card covers the lines
  await avi.api('POST', '/api/chat', { text: 'מה חסר?' });
  await avi.reload2(); await avi.go('#chat'); await shot(avi, '1-gray-one');
  // a run of four
  for (const n of ['לחם', 'ביצים', 'קוטג\'', 'עגבניות']) await michal.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: await id(n), op: { type: 'purchase', amount: 1 } }] }); // a purchase: no card covers the lines
  await avi.reload2(); await avi.go('#chat'); await shot(avi, '2-gray-run');
  await avi.evaluate(() => document.querySelector('#thread .gray.more')?.scrollIntoView({ block: 'center' })); await shot(avi, '10-gray-four'); // a run of exactly four (05/10 noon)
  await avi.click('#thread .gray.more'); await avi.waitForSelector('.sheet .journal'); await shot(avi, '3-gray-sheet'); await avi.click('.sheet-x');
  // the child's chat with "אמא קנתה…" (q08), before any card of the house is up
  await kid.reload2(); await kid.go('#chat'); await kid.evaluate(() => { const g = document.querySelector('#thread .gray'); if (g) g.scrollIntoView({ block: 'center' }); }); await shot(kid, '8-kid-chat-ima');
  // the child's tabs, with a red dot; and a card from his message (c04)
  await kid.api('POST', '/api/chat', { text: 'שלום מיואבי' });
  const card = JSON.stringify({ reply: 'להוסיף במבה לרשימה?', face: 'happy', proposal: { id: 'p-shot', status: 'pending', lines: [{ icon: 'list', text: 'להוסיף במבה לרשימה?' }] }, status: 'pending', for: 3 }).replace(/'/g, "''");
  d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now()}, NULL, 'shuki', '${card}', 3)`);
  await avi.reload2(); await avi.go('#chat'); await avi.evaluate(() => window.scrollTo(0, 0)); await shot(avi, '4-tabs-dot');
  await avi.click('.chattabs [data-tab="3"]'); await shot(avi, '5-kid-card-c04');
  await avi.click('.chattabs [data-tab="me"]');
  // the composer above the bar, with "(N שאלות פתוחות)" in two lines
  d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_at', '${Date.now()}'), ('recount_ids', '[${await id('לחם')},${await id('ביצים')},${await id('קוטג\'')},${await id('עגבניות')}]')`);
  await avi.reload2(); await avi.go('#chat'); await avi.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await shot(avi, '6-composer-over-bar');
  // focus on the blue, on a tab and on the gray note
  await avi.evaluate(() => window.scrollTo(0, 0)); await avi.focus('.chattabs [data-tab="3"]'); await avi.keyboard.press('Shift+Tab'); await avi.keyboard.press('Tab'); await shot(avi, '7-focus-tab');
  // the settings: the house and "מה למדתי" without the opacity (ש22)
  await avi.go('#settings'); await avi.waitForTimeout(600); await avi.evaluate(() => document.querySelector('.house')?.scrollIntoView()); await shot(avi, '9-settings-house');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
