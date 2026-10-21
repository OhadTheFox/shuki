// iPhone-simulator harness: the real app + the real server code, running inside the page.
// D1 is emulated with sql.js (SQLite in WebAssembly); Claude is a scripted fake.
// Opened as file:// in Simulator Safari, so no network, service worker or storage is involved.
import initSqlJs from 'sql.js/dist/sql-wasm.js';
import wasmBinary from 'sql.js/dist/sql-wasm.wasm';
import m1 from '../migrations/0001_init.sql';
import m2 from '../migrations/0002_pair_attempts.sql';
import m3 from '../migrations/0003_shopping_growth.sql';
import m4 from '../migrations/0004_count_maybe_open_away.sql';
import m5 from '../migrations/0005_remind.sql';
import m6 from '../migrations/0006_recipes_pesach.sql';
import m7 from '../migrations/0007_household.sql';
import m8 from '../migrations/0008_brand_roles_more.sql';
import m9 from '../migrations/0009_backups_feedback.sql';
import m10 from '../migrations/0010_lessons.sql';
import m11 from '../migrations/0011_round18.sql';
import m12 from '../migrations/0012_round19.sql';
import m13 from '../migrations/0013_round21.sql';
import m14 from '../migrations/0014_recipe_source.sql';
import m15 from '../migrations/0015_security.sql';
import m16 from '../migrations/0016_facts.sql';
import m17 from '../migrations/0017_threads.sql';
import m18 from '../migrations/0018_private.sql';
import m19 from '../migrations/0019_routine_every.sql';
import m20 from '../migrations/0020_cooked_log.sql';
import m21 from '../migrations/0021_fact_ask_text.sql';
import m22 from '../migrations/0022_kitniyot.sql';
import m23 from '../migrations/0023_remind_repeat.sql';
import m24 from '../migrations/0024_private_reminders.sql';
import m25 from '../migrations/0025_child_chat_each.sql';
import m26 from '../migrations/0026_removed.sql';
import m27 from '../migrations/0027_private_wins.sql';
import FIXTURE from '../test/fixture-house.sql';
import worker from '../worker/index.js';
import { fakeClaude } from './fake-claude.js';

const MIGRATIONS = [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, m21, m22, m23, m24, m25, m26, m27];

// localStorage throws on file:// in Safari; keep it in memory for this page.
try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); } catch {
  const m = new Map();
  const mem = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
  Object.defineProperty(window, 'localStorage', { value: mem, configurable: true });
}

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? +v : v);
class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.db, this.sql, a.map(norm)); }
  rows() {
    const s = this.db.prepare(this.sql); s.bind(this.args); const out = [];
    while (s.step()) out.push(s.getAsObject());
    s.free(); return out;
  }
  async all() { return { results: this.rows(), success: true, meta: {} }; }
  async first(col) { const r = this.rows()[0]; return r ? (col ? r[col] : r) : null; }
  async run() {
    if (/^\s*(SELECT|WITH)/i.test(this.sql) || /RETURNING/i.test(this.sql)) return { results: this.rows(), success: true, meta: {} };
    this.db.run(this.sql, this.args);
    const last = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    return { success: true, results: [], meta: { changes: this.db.getRowsModified(), last_row_id: last } };
  }
}
class D1 {
  constructor(db) { this.db = db; this.queue = Promise.resolve(); }
  prepare(sql) { return new Stmt(this.db, sql); }
  // one batch at a time: two requests in the page (the app's refresh and a message) must not open two transactions
  batch(list) { const run = this.queue.then(() => this.batchNow(list)); this.queue = run.catch(() => {}); return run; }
  async batchNow(list) {
    this.db.run('BEGIN');
    try { const out = []; for (const s of list) out.push(await s.run().then((r) => (/^\s*(SELECT|WITH)/i.test(s.sql) ? { ...r, results: s.rows() } : r))); this.db.run('COMMIT'); return out; }
    catch (e) { this.db.run('ROLLBACK'); throw e; }
  }
  async exec(sql) { this.db.exec(sql); return { count: 1 }; }
}

const ready = (async () => {
  const SQL = await initSqlJs({ wasmBinary });
  const db = new SQL.Database();
  for (const m of MIGRATIONS) db.exec(m);
  if (!/fresh/.test(location.hash)) db.exec(FIXTURE); // the house of the stories: Avi (admin) and Michal ("#fresh": none yet)
  if (!/fresh/.test(location.hash)) db.run("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, ?), ('222222', 2, ?)", [Date.now() + 7 * 864e5, Date.now() + 7 * 864e5]);
  window.__shukiSim = { db };
  return { DB: new D1(db), SETUP_CODE: '12345678', MODEL: 'fake', MONTHLY_TOKEN_CAP: '5000000', ANTHROPIC_API_KEY: 'sim', ANTHROPIC_URL: 'https://fake.claude/v1/messages', VAPID_SUBJECT: 'mailto:sim@example.com' };
})();

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://fake.claude/')) return new Response(JSON.stringify(fakeClaude(JSON.parse(init.body))), { headers: { 'content-type': 'application/json' } });
  const m = /(\/api\/.*)$/.exec(url);
  if (!m) return realFetch(input, init);
  const env = await ready;
  const headers = new Headers(init.headers || {}); headers.set('cf-connecting-ip', '10.0.0.1');
  const req = new Request('https://shuki.sim' + m[1], { method: init.method || 'GET', headers, body: init.body });
  await new Promise((r) => setTimeout(r, 120)); // a little network latency
  return worker.fetch(req, env, { waitUntil() {} });
};

// No service worker on file://: registration fails quietly, like a browser without one.
try { Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => Promise.reject(new Error('file://')), ready: new Promise(() => {}), addEventListener() {} }, configurable: true }); } catch { /* ignore */ }
window.addEventListener('error', (e) => showErr(e.message));
window.addEventListener('unhandledrejection', (e) => showErr(String(e.reason?.message || e.reason)));
function showErr(msg) { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#000;color:#ff0;font:12px monospace;padding:6px;direction:ltr'; d.textContent = 'JS ERROR: ' + msg; document.body.append(d); }

// Simulator-only test panel (not part of the app): plays Michal's phone and fast-forwards time,
// so shopping mode, learning and growth can be exercised on one simulated iPhone.
const simApi = async (token, method, path, body) => {
  const env = await ready;
  const r = await worker.fetch(new Request('https://shuki.sim' + path, { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.0.0.2', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
  return r.json();
};
let michal;
const michalToken = async () => (michal ||= (await simApi(null, 'POST', '/api/pair', { code: '222222' })).token);
const DAY = 864e5;
const SIM = {
  'מיכל מוסיפה במבה': async () => simApi(await michalToken(), 'POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'במבה' }] }),
  'מיכל יוצאת לקניות': async () => simApi(await michalToken(), 'POST', '/api/shopping', { on: true, store: 'super' }),
  'היסטוריה: חלב נגמר כל 3 ימים': async () => {
    const { db } = window.__shukiSim; const id = db.exec("SELECT id FROM products WHERE name LIKE 'חלב%'")[0]?.values[0][0];
    if (!id) return;
    const now = Date.now();
    for (const [d, k] of [[9, 'purchase'], [6, 'out'], [5.9, 'purchase'], [2.9, 'out'], [2.5, 'purchase']]) db.run('INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (0, ?, ?, ?)', [now - d * DAY, id, k]);
  },
  'בדיקה שבועית עכשיו': async () => {
    const { db } = window.__shukiSim;
    const ids = (db.exec("SELECT id FROM products WHERE deleted IS NULL AND (qty > 0 OR level IN ('plenty','little') OR is_open = 1) LIMIT 4")[0]?.values || []).map((r) => r[0]);
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_at', ?), ('recount_ids', ?)", [String(Date.now() - 1000), JSON.stringify(ids)]);
  },
  '"נחשוב על זה" +48 שעות': async () => { window.__shukiSim.db.run('UPDATE maybe SET added = added - ?', [49 * 3600e3]); },
  'משהו פג תוקף אתמול': async () => { window.__shukiSim.db.run("UPDATE products SET expires = ? WHERE id = (SELECT id FROM products WHERE deleted IS NULL AND count_type != 'batches' AND (qty > 0 OR level != 'none') ORDER BY id LIMIT 1)", [Date.now() - DAY]); },
  'טלפון ישן של מיכל': async () => { window.__shukiSim.db.run("INSERT INTO devices (user_id, token_hash, name, created, last_seen) VALUES (2, 'old', 'iPhone ישן', ?, ?)", [Date.now() - 40 * DAY, Date.now() - 30 * DAY]); },
  'נשאר מעט: טחינה וחלב, 2 לחם לרשימה': async () => {
    const t = await michalToken();
    await simApi(t, 'POST', '/api/actions', { actions: [
      { kind: 'create', product: { name: 'טחינה', count_type: 'units', unit: 'צנצנת', qty: 1 } },
      { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 1 } },
      { kind: 'list_add', text: 'לחם', amount: 2 },
    ] });
    const { db } = window.__shukiSim;
    for (const n of ['טחינה', 'חלב 3%']) {
      const id = db.exec('SELECT id FROM products WHERE name = ?', [n])[0].values[0][0];
      await simApi(t, 'POST', '/api/actions', { actions: [{ kind: 'op', product_id: id, op: { type: 'low' } }] });
    }
  },
  'בית חדש מאפס (קוד 12345678)': async () => {
    // the page's database lives in memory: a reload on "#fresh" starts with no house at all
    location.hash = '#fresh'; location.reload();
  },
  'מלאי ומתכונים לדוגמה': async () => {
    const tk = await michalToken();
    await simApi(tk, 'POST', '/api/actions', { op_id: 'sim-seed', actions: [
      { kind: 'create', product: { name: 'ביצים L', count_type: 'pack', pack_size: 12, qty: 4, is_basic: 1, target: 12 } },
      { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'plenty' } },
      { kind: 'create', product: { name: 'שמן', count_type: 'inuse', is_open: 1, qty: 1 } },
      { kind: 'create', product: { name: 'רסק עגבניות', count_type: 'units', unit: 'קופסה', qty: 1 } },
      { kind: 'create', product: { name: 'פלפל חריף', count_type: 'level', level: 'none' } },
      { kind: 'create', product: { name: 'מלח', count_type: 'units', unit: 'שקית', qty: 1 } },
      { kind: 'create', product: { name: 'פסטה', count_type: 'units', unit: 'חבילה', qty: 3 } },
      { kind: 'create', product: { name: 'טונה בשמן', count_type: 'units', unit: 'קופסה', qty: 4, is_basic: 1, target: 4 } },
    ] });
    await simApi(tk, 'POST', '/api/recipes', { name: 'שקשוקה', serves: 4, tags: 'ארוחות בוקר', ingredients: '6 ביצים\n4 עגבניות\nקופסת רסק עגבניות\n4 שיני שום\n2 פלפלים חריפים\nחצי כוס שמן\nכפית פפריקה מתוקה\nכפית כמון\nמלח\nפלפל שחור\nפטה (לא חובה)',
      text: 'מטגנים את השום והפלפל החריף בהמון שמן.\nמוסיפים רסק עגבניות מרוכז.\nמוסיפים את התבלינים ונותנים להם להיפתח יפה בשמן.\nמוסיפים עגבניות טריות חתוכות לשש, עד שהמחבת מלאה.\nמכסים ומטגנים על אש נמוכה.\nאם רוצים, מפוררים פטה מעל.\nשוברים פנימה את הביצים ומפזרים עליהן מלח ופלפל.' });
    await simApi(tk, 'POST', '/api/recipes', { name: 'פסטה ברוטב עגבניות', serves: 3, tags: 'פסטה', ingredients: 'חבילה של פסטה\nקופסת רסק עגבניות\n2 שיני שום', text: 'מבשלים פסטה, מחממים רסק עם שום ומערבבים.' });
  },
  '+60 נקודות לי': async () => { const { db } = window.__shukiSim; for (let i = 0; i < 60; i++) db.run("INSERT INTO events (ts, user_id, type, summary) VALUES (?, 1, 'edit', 'sim')", [Date.now() - 1000]); },
};
window.addEventListener('load', () => {
  const box = document.createElement('details');
  box.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 2px);left:2px;z-index:99998;font:11px monospace;background:#000c;color:#0f0;padding:2px 4px;direction:ltr;max-width:60vw';
  box.innerHTML = '<summary>SIM</summary>' + Object.keys(SIM).map((k, i) => `<button data-sim="${i}" style="display:block;margin:3px 0;font:12px sans-serif;direction:rtl">${k}</button>`).join('');
  box.addEventListener('click', async (e) => { const b = e.target.closest('[data-sim]'); if (!b) return; b.disabled = true; await Object.values(SIM)[+b.dataset.sim](); b.disabled = false; b.textContent += ' ✓'; document.dispatchEvent(new Event('visibilitychange')); });
  document.documentElement.append(box);
  // viewport readout, to see what iOS does with the keyboard (innerHeight, visualViewport height/offsetTop, composer top)
  const vvbox = document.createElement('div');
  vvbox.style.cssText = 'position:fixed;top:60px;right:2px;z-index:99998;font:12px monospace;background:#000c;color:#ff0;padding:1px 3px;direction:ltr;pointer-events:none';
  document.documentElement.append(vvbox);
  let plog = [], t0 = 0; for (const ev of ['pointerdown', 'pointerup', 'pointercancel', 'click', 'contextmenu', 'touchcancel']) document.addEventListener(ev, (e) => { if (ev === 'pointerdown') { t0 = e.timeStamp; plog = []; } plog.push(`${ev.replace('pointer', 'p')}@${Math.round(e.timeStamp - t0)}`); window.__plog = plog.join(' '); }, true);
  setInterval(() => { const v = window.visualViewport; const c = document.querySelector('#composer'); vvbox.style.transform = `translateY(${Math.round(v?.offsetTop || 0)}px)`; vvbox.textContent = `ih${innerHeight} vh${Math.round(v?.height)} vt${Math.round(v?.offsetTop)} sy${Math.round(scrollY)} ct${c ? Math.round(c.getBoundingClientRect().top) : '-'}/${c?.style.top || ''} ${window.__plog || ''}`; }, 300);
});
