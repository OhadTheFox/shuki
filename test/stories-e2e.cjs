// Round 20: the user stories in test/stories/r20.json (written by a separate agent from the decisions and the failures),
// run through the app on an iPhone-sized screen (Playwright's iPhone 14 emulation in Chromium, not real Safari)
// against the real model. Each story gets its own empty server. Afterwards a separate judge reads each transcript
// against the story's expectations, and every line Shuki said goes to the Hebrew reviewer.
// Run: bash test/stories-e2e.sh [S01,S05,...]
const { chromium, devices } = require(process.env.PW);
const { execSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const PORT = 8781, BASE = `http://127.0.0.1:${PORT}`, OUT = '/tmp/shuki-test/stories';
const KEY = process.env.ANTHROPIC_API_KEY || /ANTHROPIC_API_KEY\s*=\s*"?([^"\n]+)/.exec(fs.readFileSync('.dev.vars', 'utf8'))?.[1];
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const stories = JSON.parse(fs.readFileSync('test/stories/r20.json', 'utf8')).filter((s) => !ONLY.length || ONLY.includes(s.id));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spend = { persona: { in: 0, out: 0 }, judge: { in: 0, out: 0 }, shuki: 0 };

async function claude(system, user, tool, bucket) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 3000, system, tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content: user }] }),
    });
    const j = await res.json();
    if (res.ok) { spend[bucket].in += j.usage.input_tokens; spend[bucket].out += j.usage.output_tokens; return j.content.find((c) => c.type === 'tool_use').input; }
    if (res.status < 500 && res.status !== 429) throw new Error(`${res.status} ${JSON.stringify(j).slice(0, 200)}`);
    await sleep(3000 * (i + 1));
  }
  throw new Error('model unavailable');
}

function d1(dir, sql) { return execSync(`npx wrangler d1 execute shuki --local --persist-to ${dir} --json --command ${JSON.stringify(sql)}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
function killServers() { try { execSync('bash test/killservers.sh', { stdio: 'ignore' }); } catch { /* none */ } }
async function startServer(dir, kind) {
  killServers();
  fs.rmSync(dir, { recursive: true, force: true });
  execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${dir}`, { stdio: 'ignore' });
  if (kind === 'fixture') {
    execSync(`npx wrangler d1 execute shuki --local --persist-to ${dir} --file test/fixture-house.sql`, { stdio: 'ignore' });
    d1(dir, "INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999)");
  }
  const p = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', dir, '--var', 'SETUP_CODE:24681357', '--var', 'MODEL:claude-sonnet-5', '--var', 'TEST_RESET:1'], { stdio: 'ignore', detached: true });
  p.unref();
  for (let i = 0; i < 90; i++) { try { await fetch(BASE + '/'); return; } catch { await sleep(500); } }
  throw new Error('server did not start');
}
const api = async (token, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${path}: ${j.error || r.status}`); return j;
};

const COUNT = { units: 'units', pack: 'pack', level: 'level' };
const LEVEL = { 'הרבה': 'plenty', 'מעט': 'little', 'אין': 'none', plenty: 'plenty', little: 'little', none: 'none' };
async function seed(dir, h, admin) {
  const people = {};
  for (const m of h.members || []) { const r = await api(admin, 'POST', '/api/members', { add: { name: m.name, gender: m.gender, role: m.role || 'member' } }); people[m.name] = r.code; }
  if (h.notes) await api(admin, 'POST', '/api/settings', { house_notes: h.notes });
  if (h.roommates) await api(admin, 'POST', '/api/settings', { house_mode: 'roommates' });
  const creates = (h.products || []).map((p) => {
    const count = COUNT[p.count] || (p.level ? 'level' : 'units');
    const product = { name: p.name, count_type: count, category_id: 'אחר', ...(p.place && { location_id: p.place }), ...(p.unit && count !== 'pack' && { unit: p.unit }), ...(p.regular && { is_basic: 1 }), ...(p.target && { target: p.target }) };
    if (count === 'level') product.level = LEVEL[p.level] || 'plenty';
    else { product.qty = Number(p.qty) || 0; if (count === 'pack') product.pack_size = p.pack_size || 12; }
    return { kind: 'create', product };
  });
  if (creates.length) await api(admin, 'POST', '/api/actions', { actions: creates });
  const st = await api(admin, 'GET', '/api/state');
  const adds = (h.list || []).map((x) => { const p = st.products.find((y) => y.name === x); return p ? { kind: 'list_add', product_id: p.id } : { kind: 'list_add', text: x }; })
    .filter((a) => !a.product_id || !st.list.some((i) => i.product_id === a.product_id && i.status === 'open'));
  if (adds.length) await api(admin, 'POST', '/api/actions', { actions: adds });
  if (h.recipes?.length) await api(admin, 'POST', '/api/__recipes', { recipes: h.recipes.map((r) => ({ ...r, text: r.text || '' })) }).catch(() => null);
  for (const l of h.lessons || []) d1(dir, `INSERT INTO lessons (text, added, added_by) VALUES ('${l.replace(/'/g, "''")}', ${Date.now()}, 1)`);
  return people;
}

const PERSONA_TOOL = { name: 'answer', description: 'What the person does next in the app.', input_schema: { type: 'object', properties: { how: { type: 'string', enum: ['type', 'tap'] }, text: { type: 'string', description: 'what to type, or the exact text of the button to tap' } }, required: ['how', 'text'] } };
const JUDGE_TOOL = { name: 'verdict', description: 'The verdict on one story.', input_schema: { type: 'object', properties: {
  expect: { type: 'array', items: { type: 'object', properties: { check: { type: 'string' }, ok: { type: 'boolean' }, why: { type: 'string' } }, required: ['check', 'ok', 'why'] } },
  must_not: { type: 'array', items: { type: 'object', properties: { check: { type: 'string' }, happened: { type: 'boolean' }, why: { type: 'string' } }, required: ['check', 'happened', 'why'] } },
  other_problems: { type: 'array', items: { type: 'string' }, description: 'anything else a real user would find broken, confusing or unnatural' },
}, required: ['expect', 'must_not', 'other_problems'] } };

(async () => {
  const browser = await chromium.launch();
  const all = [];
  for (const story of stories) {
    const dir = `/tmp/shuki-test/story-db`; const sdir = `${OUT}/${story.id}`; fs.rmSync(sdir, { recursive: true, force: true }); fs.mkdirSync(sdir, { recursive: true });
    const log = []; const problems = []; let shot = 0;
    const say = (t) => { log.push(t); };
    const h = story.house || { kind: 'fixture' };
    let ctxs = {}, pages = {}, tokens = {}, who = 'אבי', seen = {};
    try {
      await startServer(dir, h.kind);
      const errs = [];
      const open = async (name, token) => {
        const ctx = await browser.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
        if (token) await ctx.addInitScript((t) => localStorage.setItem('shuki.token', JSON.stringify(t)), token);
        const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
        ctxs[name] = ctx; pages[name] = p; seen[name] = 0; await p.goto(BASE + '/#chat'); await p.waitForTimeout(2500);
        // how the text box looks on this phone (decision 170): what the judge can't see in words
        const c = await p.evaluate(() => { const f = document.querySelector('#composer'), t = document.querySelector('#say'), b = document.querySelector('#send'); if (!f) return null; const r = f.getBoundingClientRect(), rb = b.getBoundingClientRect(), rt = t.getBoundingClientRect(); return { inView: r.bottom <= innerHeight + 1 && r.top >= 0, dir: getComputedStyle(t).direction, font: getComputedStyle(t).fontSize, box: Math.round(rt.width), send: rb.width > 0 && rb.height > 0, sendLeftOfBox: rb.right <= rt.left + 2, placeholder: t.placeholder }; });
        if (c) say(`[חלונית הכתיבה אצל ${name}: ${c.inView ? 'כולה במסך' : 'לא כולה במסך'}, כיוון ${c.dir}, גופן ${c.font}, רוחב שדה ${c.box}px, כפתור שליחה ${c.send ? 'נראה' : 'לא נראה'}${c.sendLeftOfBox ? ' משמאל לטקסט' : ''}, "${c.placeholder}"]`);
        return p;
      };
      if (h.kind === 'new') {
        const p = await open('אבי');
        await p.waitForSelector('#setup', { timeout: 15000 });
        await p.fill('#s-code', '24681357');
        await p.click('#setup button[type=submit]'); await p.waitForSelector('#thread .msg.bot', { timeout: 15000 }); await p.waitForTimeout(4500);
        for (const a of ['אבי', 'בלשון זכר', 'הבית שלנו']) { await p.fill('#say', a); await p.$eval('#composer', (f) => f.requestSubmit()); await p.waitForTimeout(2000); }
        tokens['אבי'] = await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.token')));
      } else {
        tokens['אבי'] = (await api(null, 'POST', '/api/pair', { code: '111111', name: 'iPhone' })).token;
        tokens['מיכל'] = (await api(null, 'POST', '/api/pair', { code: '222222', name: 'iPhone' })).token;
        const codes = await seed(dir, h, tokens['אבי']);
        for (const [n, c] of Object.entries(codes)) tokens[n] = (await api(null, 'POST', '/api/pair', { code: c, name: 'iPhone' })).token;
        await open('אבי', tokens['אבי']);
      }
      const page = async () => {
        if (pages[who]) return pages[who];
        if (!tokens[who]) { // someone the first meeting added: their code is in the chat, as a person would get it
          const msgs = (await api(tokens['אבי'], 'GET', '/api/chat')).messages;
          const code = msgs.flatMap((m) => m.content.codes || []).find((c) => c.name === who)?.code;
          if (!code) throw new Error(`no such person: ${who}`);
          tokens[who] = (await api(null, 'POST', '/api/pair', { code, name: 'iPhone' })).token;
        }
        const p = await open(who, tokens[who]);
        return p;
      };
      const extras = new Set(); const lastChips = {}; const lastRx = {};
      const report = async () => {
        const p = await page();
        if (!(await p.$('#thread'))) return;
        const msgs = await p.$$eval('#thread .msg.bot.hasfb, #thread .msg.me, #thread .coupon[data-id]', (xs) => xs.map((x) => ({ cls: x.className, by: x.previousElementSibling?.classList.contains('who') ? x.previousElementSibling.textContent : '', text: x.innerText.replace(/\s*לתקן\s*$/, ' [כפתור קטן: לתקן]').replace(/\s*\n+\s*/g, ' · ').replace(/\s+/g, ' ').trim(), lines: [...x.querySelectorAll('li span')].map((s) => s.innerText.replace(/\n+/g, ' · ').trim()) })));
        for (const m of msgs.slice(seen[who])) {
          if (/msg bot/.test(m.cls)) say(`שוקי: ${m.text}`);
          else if (/msg me/.test(m.cls) && m.by && m.by !== who) say(`(${who} רואה בצ'אט) ${m.by}: ${m.text}`);
          else if (/coupon/.test(m.cls)) { say(`  [כרטיס${/pending/.test(m.cls) ? ' שמחכה לאישור' : ''}]`); for (const l of m.lines) say(`  שורה בכרטיס: ${l}`); }
        }
        seen[who] = msgs.length;
        const rx = await p.evaluate(() => document.body.dataset.lastReaction || '');
        if (rx && rx !== lastRx[who]) { say(`  [שוקי מגיב באנימציה: ${rx}]`); lastRx[who] = rx; }
        const chips = await p.$$eval('#thread [data-opt]', (xs) => xs.map((b) => b.dataset.opt).join(' | '));
        if (chips && chips !== lastChips[who]) say(`  [כפתורים: ${chips}]`); lastChips[who] = chips;
        for (const t of await p.$$eval('#thread .msg.bot:not(.hasfb):not(.typing)', (xs) => xs.map((x) => x.innerText.replace(/\s+/g, ' ').trim()))) if (!extras.has(t)) { extras.add(t); say(`שוקי (הודעה של האפליקציה): ${t}`); }
        await p.screenshot({ path: `${sdir}/${String(++shot).padStart(2, '0')}.png` });
      };
      const waitAnswer = async (p) => { await p.waitForFunction(() => !document.querySelector('#thread .typing'), null, { timeout: 120000 }).catch(() => problems.push('no answer in 120s')); await p.waitForTimeout(3500); };
      const toChat = async (p) => { if (!(await p.$('#thread'))) { await p.evaluate(() => { location.hash = '#chat'; }); await p.waitForTimeout(1500); seen[who] = 0; } };
      const afterSend = {};
      const type = async (text) => {
        const p = await page(); await toChat(p); await report(); say(`${who}: ${text}`); await p.fill('#say', text); await p.$eval('#composer', (f) => f.requestSubmit()); await waitAnswer(p); await report();
        if (!afterSend[who]) { // once per person: what the text box looks like after sending
          afterSend[who] = true;
          await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(300);
          const c = await p.evaluate(() => { const t = document.querySelector('#say'), f = document.querySelector('#composer'), last = [...document.querySelectorAll('#thread .msg, #thread .coupon')].at(-1); const r = f.getBoundingClientRect(), l = last?.getBoundingClientRect(); return { empty: !t.value, h: Math.round(t.getBoundingClientRect().height), covers: !!l && l.bottom > r.top + 2 }; });
          say(`[חלונית הכתיבה אחרי השליחה: ${c.empty ? 'ריקה' : 'לא ריקה'}, גובה השדה ${c.h}px (שורה אחת), ${c.covers ? 'מסתירה את ההודעה האחרונה' : 'לא מסתירה את ההודעה האחרונה'}]`);
        }
      };
      const tap = async (text) => {
        const p = await page(); await toChat(p); await report();
        const opts = await p.$$eval('#thread [data-opt]', (xs) => xs.map((x) => x.dataset.opt));
        const pick = opts.reverse().find((o) => o === text) || opts.find((o) => o.includes(text) || text.includes(o));
        if (!pick) { problems.push(`no button "${text}" (buttons: ${opts.join(' | ') || 'none'})`); return type(text); }
        say(`${who} (כפתור): ${pick}`); await p.locator(`#thread [data-opt="${pick.replace(/"/g, '\\"')}"]`).last().click(); await waitAnswer(p); await report();
      };
      const card = async (verb) => {
        const p = await page(); await toChat(p); await report();
        const b = p.locator(`.coupon.pending [data-do="${verb}"]`).last();
        if (!(await b.count())) { problems.push(`no card to ${verb}`); say(`${who}: (אין כרטיס ל${verb === 'apply' ? 'אישור' : 'ביטול'})`); return; }
        say(`${who}: ${verb === 'apply' ? 'אישור' : 'ביטול'} של הכרטיס`); await b.click(); await p.waitForTimeout(3500); await report();
      };
      const screen = async (name) => {
        const r = { stock: 'inventory', inventory: 'inventory', list: 'list', chat: 'chat', settings: 'settings' }[name] || name;
        const p = await page(); await p.evaluate((x) => { location.hash = `#${x}`; }, r); await p.waitForTimeout(2000); if (r === 'chat') { seen[who] = 0; await report(); return; }
        const t = await p.$eval('main', (m) => { const hide = [...m.querySelectorAll('select')]; hide.forEach((x) => { x.dataset.was = x.style.display; x.style.display = 'none'; }); const t = m.innerText; hide.forEach((x) => { x.style.display = x.dataset.was; }); return t.replace(/\n{2,}/g, '\n').trim(); }); say(`[מסך ${name} אצל ${who}]\n${t.slice(0, 1800)}`);
        await p.screenshot({ path: `${sdir}/${String(++shot).padStart(2, '0')}-${name}.png`, fullPage: true });
      };
      const listLine = async (p, name) => { const b = p.locator('[data-item]', { hasText: name }).first(); if (!(await b.count())) { problems.push(`no list line "${name}"`); return null; } return b; };
      const persona = async (desc) => {
        const p = await page(); await report(); let last = '', same = 0;
        for (let turn = 0; turn < 22; turn++) {
          const bots = log.filter((l) => l.startsWith('שוקי:'));
          const lastBot = bots.at(-1) || '';
          if (/עכשיו אני מכיר את הבית/.test(lastBot)) return;
          if (lastBot === last) { if (++same >= 2) { problems.push(`onboarding stuck on: ${lastBot}`); return; } } else same = 0; last = lastBot;
          const opts = await p.$$eval('#thread [data-opt]', (xs) => xs.map((x) => x.dataset.opt));
          const a = await claude(`אתה משחק את ${who}, אדם אמיתי שהקים עכשיו את הבית באפליקציה בשם שוקי, ועונה על שאלות ההיכרות שלה. אתה ${who} (זה שכותב), לא מישהו אחר מבני הבית. הנה התיאור של הבית שלך: ${desc}
ענה כמו ישראלי שמקליד בטלפון: קצר, טבעי, בלי להסביר. ענה רק על מה שנשאל עכשיו, לפי התיאור. אם יש כפתור שמתאים בדיוק לתשובה שלך, אפשר ללחוץ עליו (how=tap עם הטקסט המדויק של הכפתור); אחרת הקלד (how=type).`,
          `השיחה עד עכשיו:\n${log.slice(-30).join('\n')}\n\nהכפתורים שמוצגים עכשיו: ${opts.slice(-6).join(' | ') || 'אין'}\nמה אתה עושה?`, PERSONA_TOOL, 'persona');
          if (a.how === 'tap' && opts.includes(a.text)) await tap(a.text); else await type(a.text);
        }
        problems.push('onboarding did not finish in 22 turns');
      };
      for (const step of story.steps) {
        const [k, v] = Object.entries(step)[0];
        if (k === 'as') { const had = !!pages[v]; who = v; const p = await page(); if (had) { await p.reload(); await p.waitForTimeout(2500); } continue; } // picking up the phone again: the app opens fresh
        if (k === 'say') await type(v);
        else if (k === 'tap') await tap(v);
        else if (k === 'approve') await card('apply');
        else if (k === 'reject') await card('reject');
        else if (k === 'screen') await screen(v);
        else if (k === 'answer_all_onboarding') await persona(v);
        else if (k === 'list_add') {
          const p = await page(); if (!(await p.$('#addTxt'))) { await p.evaluate(() => { location.hash = '#list'; }); await p.waitForTimeout(1500); }
          say(`${who} (רשימה, הוספה): ${v}`); await p.fill('#addTxt', v); await p.$eval('#adder', (f) => f.requestSubmit()); await p.waitForTimeout(1200);
          const sug = await p.$$eval('#sugg button', (xs) => xs.map((x) => x.innerText)); if (sug.length) say(`  [הצעות: ${sug.join(' | ')}]`);
          if (await p.$('#w-yes')) { say('  [חלון: יש כבר בבית, להוסיף בכל זאת?] → להוסיף'); await p.click('#w-yes'); }
          const pick = await p.$('.scrim [data-pick]'); if (pick) { const t = await p.$$eval('.scrim [data-pick]', (xs) => xs.map((x) => x.innerText)); say(`  [חלון בחירה: ${t.join(' | ')}] → ${t.at(-1)}`); await p.locator('.scrim [data-pick]').last().click(); }
          await p.waitForTimeout(2000);
        } else if (k === 'list_tap') {
          const p = await page(); const b = await listLine(p, v); if (b) { say(`${who} (רשימה): נגיעה ב${v}`); await b.click(); await p.waitForTimeout(1500); if (await p.$('.scrim')) { say(`  [נפתח חלון: ${(await p.$eval('.scrim', (x) => x.innerText)).replace(/\n+/g, ' ').slice(0, 120)}]`); problems.push('a tap opened a window'); await p.click('.scrim .sheet-x'); } }
        } else if (k === 'list_hold') {
          const p = await page(); const b = await listLine(p, v);
          if (b) {
            say(`${who} (רשימה): לחיצה ארוכה על ${v}, כמות ${step.amount}`);
            const box = await b.boundingBox(); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(800); await p.mouse.up(); await p.waitForTimeout(800);
            if (!(await p.$('.scrim #n'))) problems.push('long press opened no amount window');
            else {
              for (let i = 0; i < 60; i++) { const n = Number(await p.$eval('.scrim #n', (x) => x.textContent)); if (n === step.amount) break; await p.click(`.scrim [data-d="${n < step.amount ? 1 : -1}"]`); }
              await p.click('.scrim #ok'); await p.waitForTimeout(1500);
            }
          }
        } else if (k === 'finish_shopping') {
          const p = await page(); if (!(await p.$('#finish'))) { problems.push('no "done shopping" button'); continue; }
          say(`${who}: סיימתי את הקניות`); await p.click('#finish'); await p.waitForTimeout(2500);
          { const rx = await p.evaluate(() => document.body.dataset.lastReaction || ''); if (rx) say(`  [שוקי מגיב באנימציה: ${rx}]`); }
          if (await p.$('.scrim')) { say(`  [${(await p.$eval('.scrim .sheet', (x) => x.innerText)).replace(/\n+/g, ' · ').slice(0, 300)}]`); await p.click('.scrim .sheet-x'); }
        } else problems.push(`unknown step ${k}`);
      }
      // what the house looks like at the end
      const s = await api(tokens['אבי'], 'GET', '/api/state');
      const loc = (id) => s.locations.find((l) => l.id === id)?.name || '';
      say(`\n[מצב הבית בסוף]\nבני הבית: ${s.users.map((u) => `${u.name} (${u.role}, ${u.gender === 'f' ? 'נקבה' : 'זכר'})`).join(', ')}`);
      say(`מלאי: ${s.products.map((p) => `${p.name}: ${p.text || ''}${p.owner ? `, של ${s.users.find((u) => u.id === p.owner)?.name}` : ''}${p.is_basic ? `, קבוע (מינימום ${p.target})` : ''}${loc(p.location_id) ? `, ${loc(p.location_id)}` : ''}`).join(' | ') || 'ריק'}`);
      say(`רשימה: ${s.list.filter((i) => i.status !== 'done').map((i) => `${i.product_id ? s.products.find((p) => p.id === i.product_id)?.name : i.text}${i.want ? ` (${i.want}${i.want_unit ? ` ${i.want_unit}` : ''})` : ''}${i.status === 'checked' ? ' [בעגלה]' : ''}${i.approved ? '' : ' [מחכה לאישור]'}`).join(', ') || 'ריקה'}`);
      say(`מה שוקי למד: ${(s.lessons || []).map((l) => l.text).join(' | ') || 'אין'}`);
      say(`הערות לבית: ${s.notes || 'אין'}`);
      if (errs.length) problems.push(`page errors: ${errs.join(' | ')}`);
      try { const raw = d1(dir, 'SELECT micro FROM usage'); const u = JSON.parse(raw.slice(raw.indexOf('[')))[0]?.results || []; const c = u.reduce((a, r) => a + r.micro, 0) / 1e6; spend.shuki += c; say(`[עלות שוקי בסיפור: $${c.toFixed(3)}]`); } catch (e) { problems.push(`usage: ${e.message}`); }
    } catch (e) { problems.push(`runner: ${e.message}`); }
    for (const c of Object.values(ctxs)) await c.close().catch(() => {});
    fs.writeFileSync(`${sdir}/transcript.txt`, log.join('\n'));
    // the judge: a separate model call, with only the story and what happened
    let verdict = null;
    for (let tryN = 0; tryN < 3 && !(Array.isArray(verdict?.expect) && Array.isArray(verdict?.must_not)); tryN++) try { // a verdict without its lists is asked again
      verdict = await claude(`אתה בודק איכות עצמאי וקפדן. לפניך סיפור משתמש של אפליקציה בשם שוקי (רובוט שמנהל מלאי וקניות לבית, בעברית), והתמליל של מה שקרה כשאדם אמיתי עבר את הסיפור באפליקציה, כולל המסכים ומצב הבית בסוף.
מוסכמות של האפליקציה (לפי ההחלטות של בעל המוצר): כרטיס אישור מגיע עם משפט קצר של שוקי שמתאר אותו, לרוב כשאלה ("להוסיף חלב לרשימה?"), וכפתורי הכרטיס (אישור/ביטול) הם התשובה. זה לא נחשב "שאלה וכרטיס באותה הודעה". "שאלה וכרטיס" = שאלה נוספת שמחכה לתשובה במילים או בכפתורים משלה (איזה? כמה? לזכור?) יחד עם כרטיס. שורות שמתחילות ב"שורה בכרטיס:" הן שורות של כרטיס אחד. כפתורי תשובה מהירה (כפתורים:) אינם כרטיס. אנימציות של שוקי מופיעות בתמליל כ"[שוקי מגיב באנימציה: ...]".
שפוט כל ציפייה (ok=true רק אם התמליל מראה שהיא התקיימה), וכל "אסור" (happened=true אם זה קרה). אל תנחש לטובת האפליקציה: מה שלא מופיע בתמליל לא התקיים. בנוסף רשום כל דבר אחר שמשתמש אמיתי היה מוצא שבור, מבלבל, רובוטי או לא עברית טבעית.`,
      `הסיפור: ${story.title}\n\nציפיות:\n${story.expect.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nאסור:\n${(story.must_not || []).map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nבעיות שהמריץ עצמו מצא: ${problems.join(' | ') || 'אין'}\n\nהתמליל:\n${log.join('\n')}`, JUDGE_TOOL, 'judge');
    } catch (e) { problems.push(`judge: ${e.message}`); }
    if (verdict) for (const k of ['expect', 'must_not', 'other_problems']) { if (typeof verdict[k] === 'string') { try { verdict[k] = JSON.parse(verdict[k]); } catch { verdict[k] = null; } } if (!Array.isArray(verdict[k])) { if (k !== 'other_problems') problems.push(`judge gave no ${k}`); verdict[k] = []; } }
    const pass = !!verdict && verdict.expect.every((x) => x.ok) && verdict.must_not.every((x) => !x.happened) && !problems.length;
    all.push({ id: story.id, title: story.title, pass, problems, verdict });
    fs.writeFileSync(`${sdir}/verdict.json`, JSON.stringify({ pass, problems, verdict }, null, 1));
    console.log(`${pass ? '✓' : '✗'} ${story.id} ${story.title}${pass ? '' : `\n   ${[...problems, ...(verdict?.expect || []).filter((x) => !x.ok).map((x) => `לא התקיים: ${x.check} — ${x.why}`), ...(verdict?.must_not || []).filter((x) => x.happened).map((x) => `קרה: ${x.check} — ${x.why}`)].join('\n   ')}`}`);
    if (verdict?.other_problems?.length) console.log(`   עוד: ${verdict.other_problems.join(' | ')}`);
  }
  await browser.close(); killServers();
  const lines = all.flatMap((r) => fs.readFileSync(`${OUT}/${r.id}/transcript.txt`, 'utf8').split('\n').filter((l) => /^(שוקי:|\s*שורה בכרטיס:)/.test(l)));
  fs.writeFileSync(`${OUT}/all-shuki-lines.txt`, lines.join('\n'));
  const cost = (b) => (spend[b].in * 2 + spend[b].out * 10) / 1e6; // claude-sonnet-5, as in worker/llm.js
  const summary = { passed: all.filter((r) => r.pass).length, total: all.length, cost: { shuki: +spend.shuki.toFixed(2), persona: +cost('persona').toFixed(2), judge: +cost('judge').toFixed(2) }, results: all };
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(summary, null, 1));
  console.log(`\n${summary.passed}/${summary.total} stories passed (real model, iPhone 14 emulation in Chromium). Cost: Shuki $${summary.cost.shuki}, persona $${summary.cost.persona}, judge $${summary.cost.judge}`);
  process.exit(summary.passed === summary.total ? 0 : 1);
})();
