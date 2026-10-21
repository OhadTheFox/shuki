// Stage 7, the walkthrough in WebKit (07/10): an empty first place offers the other places and "זהו, סיימנו למפות"; when the
// people step adds nobody, "רק את ואני" goes on in the singular. A fake model, like round20.itest.js.
// Run: node test/onboard-walk.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-onboard-walk';
const PORT = 8789, MOCK = 8788;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });

// the fake model answers from the script, in order: the first meeting's reader and the chat alike
const script = []; const calls = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  const body = JSON.parse(b || '{}'); calls.push(body);
  const input = script.shift() || { reply: 'ok', face: 'happy' };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name: body.tools?.[0]?.name || 'respond', input }], usage: { input_tokens: 100, output_tokens: 10 } }));
}); }).listen(MOCK);
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--test-scheduled', '--port', String(PORT), '--persist-to', STATE, '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:t', '--var', 'TEST_RESET:1', '--var', 'SETUP_CODE:13572468', '--var', 'CHAT_PER_MINUTE:1000'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch { /* text */ } return { status: r.status, data, text: txt }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
const say = async (t, text, ...outs) => { script.push(...outs); return (await call(t, 'POST', '/api/chat', { text })).data; };
let dana;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const r0 = await call(null, 'POST', '/api/setup', { code: '13572468', house: 'הבית', name: 'דנה', gender: 'f' });
  dana = r0.data.token;

  await check('W1', 'אף אחד לא נקרא מ"מי גר בבית": "רק את ואני", ומכאן ביחיד (השאלה על אוכל, ובסוף "הבית שלך")', async () => {
    let r = await say(dana, 'אני דנה, אני מנהלת. גרים איתי רון ויואב', {});
    assert.match(r.reply, /^האם יש משהו שאת לא אוכלת\?$/);
    const said = (await call(dana, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki').map((m) => m.content.reply);
    assert.ok(said.includes('נעים מאוד, דנה! אז רק את ואני.'), said.join(' | '));
  });

  await check('W2', 'מקום ראשון ריק: הכפתורים בלי המקום הזה, ועם "זהו, סיימנו למפות"; "בואי נמפה" ביחיד', async () => {
    let r = await say(dana, 'נדלג על זה', {});
    assert.equal(r.reply, 'האם יש משהו בסגנון החיים שלך שכדאי שאדע? למשל אימונים, דיאטה או הריון.'); // stage 8, ז2
    r = await say(dana, 'נדלג על זה', {});
    assert.equal(r.reply, 'יאללה, בואי נמפה את הבית! מאיפה מתחילים?');
    r = await say(dana, 'מקרר', {});
    r = await say(dana, '2 קרטוני חלב, 10 ביצים וגבינה צהובה', { none: true });
    assert.equal(r.reply, 'אז המקרר ריק. איפה עוד?');
    assert.ok(!r.options.includes('מקרר'), r.options.join(','));
    assert.equal(r.options.at(-1), 'זהו, סיימנו למפות');
    await say(dana, 'זהו, סיימנו למפות', {});
    const said = (await call(dana, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki').map((m) => m.content.reply);
    assert.ok(said.some((x) => /^בסדר, את הבית נמפה בפעם אחרת\./.test(x || '')), said.slice(-3).join(' | '));
  });

  await check('W3', 'בסוף: "הבית שלך" ו"ספרי לי", ביחיד', async () => {
    await say(dana, 'נדלג על זה', {});
    const r = await say(dana, 'לא, זהו', {});
    const said = (await call(dana, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki').map((m) => m.content.reply);
    assert.ok(said.some((x) => /^זהו, עכשיו אני מכיר את הבית שלך! מעכשיו פשוט ספרי לי/.test(x || '')), said.slice(-3).join(' | '));
    assert.ok(r);
  });

  // the meeting again from "מי גר בבית" (the reviewer of f97a582): the food question reads only s.alone
  // (a button the server answers by itself, like "לא, זהו", leaves its scripted answer unread: the script starts empty)
  const again = () => { script.length = 0; const id = d1("SELECT id FROM users WHERE name = 'דנה'")[0].id; d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('onboard', '${JSON.stringify({ step: 'people', user: id, started: Date.now() })}')`); };
  await check('W4', 'המודל קרא רק את דנה עצמה: "רק את ואני", והשאלה על אוכל ביחיד', async () => {
    again();
    const r = await say(dana, 'אני דנה', { people: [{ name: 'דנה', gender: 'f' }] });
    assert.equal(r.reply, 'האם יש משהו שאת לא אוכלת?');
    const said = (await call(dana, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki').map((m) => m.content.reply);
    assert.equal(said.filter((x) => x === 'נעים מאוד, דנה! אז רק את ואני.').length, 2, said.slice(-3).join(' | '));
  });
  await check('W5', 'מישהו נוסף באמצע (בשאלה על אוכל): מכאן ברבים, השאלה על אוכל ו"בואו נמפה"', async () => {
    again();
    let r = await say(dana, 'רק אני', {});
    assert.equal(r.reply, 'האם יש משהו שאת לא אוכלת?');
    r = await say(dana, 'אה, וגם רון גר איתי', { people: [{ name: 'רון', gender: 'm' }] });
    assert.equal(r.reply, 'האם יש מישהו בבית שלא אוכל משהו?');
    r = await say(dana, 'נדלג על זה', {});
    assert.equal(r.reply, 'האם יש משהו בסגנון החיים שלך שכדאי שאדע? למשל אימונים, דיאטה או הריון.'); // stage 8, ז2
    r = await say(dana, 'נדלג על זה', {});
    assert.equal(r.reply, 'יאללה, בואו נמפה את הבית! מאיפה מתחילים?');
  });

  await check('W6', 'מישהו נוסף בשאלה על אוכל, וגם מה הוא לא אוכל: נרשם, ולא שואלים שוב על אוכל', async () => {
    again();
    let r = await say(dana, 'רק אני', {});
    assert.equal(r.reply, 'האם יש משהו שאת לא אוכלת?');
    r = await say(dana, 'וגם עומר גר איתי, והוא לא אוכל בוטנים', { people: [{ name: 'עומר', gender: 'm' }], food: [{ name: 'עומר', key: 'avoid', value: 'בוטנים', text: 'עומר לא אוכל בוטנים' }] });
    assert.equal(r.reply, 'האם יש משהו בסגנון החיים שלך שכדאי שאדע? למשל אימונים, דיאטה או הריון.'); // stage 8, ז2
    r = await say(dana, 'נדלג על זה', {});
    assert.equal(r.reply, 'יאללה, בואו נמפה את הבית! מאיפה מתחילים?');
    const said = (await call(dana, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki').map((m) => m.content.reply);
    assert.ok(said.includes('רשמתי שעומר לא אוכל בוטנים.'), said.slice(-4).join(' | '));
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} onboarding walkthrough checks passed`);
  mock.close(); try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  process.exit(ok === results.length ? 0 : 1);
}
