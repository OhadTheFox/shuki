// Where the server's own time goes in one turn (15/10, the first use: "Shuki is slow"). The worker runs in this process
// over node:sqlite, as server/node.js runs it, against the measurement house (test/measure-house.mjs; with
// MEASURE_RECIPES, the 255 recipes too), with a fake model that answers at once with the real answer a seq run recorded
// (or an empty one). For every message of a set: the database round trips and their time before the model is called
// (building the prompt) and after it (the card, the chat rows), the time the prompt took to build apart from the database,
// and the request's size. No key, no cost. Locally a round trip is a fraction of a millisecond: on Cloudflare each is a
// call to D1, so the count is what matters there.
//   MEASURE_RECIPES=../tiktok-export/shuki-import.json SET=first LABEL=fu-a node tools/measure/turn-cost.mjs
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, copyFileSync, rmSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, NOW } from './lib.mjs';
import * as SETS from './set.mjs';

const SET = { first: SETS.FIRST, s13: SETS.S13, s9: SETS.S9 }[process.env.SET || 'first'];
const recorded = process.env.LABEL && existsSync(`/tmp/shuki-measure-${process.env.LABEL}/seq-results.json`) ? JSON.parse(readFileSync(`/tmp/shuki-measure-${process.env.LABEL}/seq-results.json`, 'utf8')) : {};
const W = '/tmp/shuki-turn-cost'; rmSync(W, { recursive: true, force: true }); mkdirSync(W, { recursive: true });

// the house, once; every message starts from a copy of it
execFileSync('node', [`${ROOT}test/measure-house.mjs`, `${W}/house.sql`]);
const base = new DatabaseSync(`${W}/base.db`);
base.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync(`${ROOT}migrations`).filter((x) => x.endsWith('.sql')).sort()) base.exec(readFileSync(`${ROOT}migrations/${f}`, 'utf8'));
base.exec(readFileSync(`${W}/house.sql`, 'utf8')); base.close();

// the D1 API over node:sqlite (as server/node.js), counting each round trip and its time
const val = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const READS = /^\s*(SELECT|WITH|PRAGMA)\b/i;
// TRIP_MS=n: each round trip waits n ms first, as a call to D1 over the network would: the extra time to the answer,
// divided by n, is how many of them wait one after another (the others go out together, Promise.all)
let trips = [];
const TRIP = Number(process.env.TRIP_MS || 0);
const timed = async (kind, sql, fn) => { const at = performance.now(); if (TRIP) await new Promise((r) => setTimeout(r, TRIP)); const t = performance.now(); try { return fn(); } finally { trips.push({ at, ms: performance.now() - t, kind, sql: sql.slice(0, 60) }); } };
class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.db, this.sql, a.map(val)); }
  rows() { return this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })); }
  async all() { return timed('all', this.sql, () => ({ results: this.rows(), success: true, meta: {} })); }
  async first(col) { return timed('first', this.sql, () => { const r = this.rows()[0]; return r ? (col ? r[col] : r) : null; }); }
  async run() { return timed('run', this.sql, () => this.runSync()); }
  runSync() {
    if (READS.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) return { results: this.rows(), success: true, meta: {} };
    const r = this.db.prepare(this.sql).run(...this.args);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}
class D1 {
  constructor(db) { this.db = db; }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(list) { return timed('batch', `batch of ${list.length}`, () => { this.db.exec('BEGIN'); try { const o = list.map((s) => s.runSync()); this.db.exec('COMMIT'); return o; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }); }
  async exec(sql) { this.db.exec(sql); return { count: 1 }; }
}

// the fake model: when the request came, and the recorded answer
let answer = null, asked = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
  const body = Buffer.concat(parts).toString('utf8'); asked.push({ at: performance.now(), bytes: Buffer.byteLength(body), tool: JSON.parse(body).tools?.[0]?.name });
  const last = JSON.parse(body).messages.at(-1).content; if (process.env.PROBLEMS && Array.isArray(last) && last[0]?.type === 'tool_result') console.error('second call:', String(last[0].content).replace(/\n/g, ' | ')); // PROBLEMS=1: why the server asked again
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(answer || { content: [{ type: 'tool_use', name: 'respond', input: { reply: 'אני פה!', face: 'happy' } }], usage: { input_tokens: 0, output_tokens: 0 } }));
}); }).listen(8786, '127.0.0.1');

const { default: worker } = await import(`${ROOT}worker/index.js`);
const { TOKENS } = await import(`${ROOT}test/measure-house.mjs`);
const rows = [];
for (const [k, m] of SET.entries()) {
  copyFileSync(`${W}/base.db`, `${W}/m.db`);
  const db = new DatabaseSync(`${W}/m.db`); if (m.seed) db.exec(m.seed);
  const env = { DB: new D1(db), ANTHROPIC_API_KEY: 'turn-cost', ANTHROPIC_URL: 'http://127.0.0.1:8786/v1/messages', MODEL: 'claude-sonnet-5', FIXED_NOW: String(m.now ?? NOW), CHAT_PER_MINUTE: '1000', MONTHLY_COST_CAP: '1000' };
  const later = []; const ctx = { waitUntil: (p) => later.push(Promise.resolve(p).catch(() => {})) };
  answer = recorded[`m${k}-r1`] || null; asked = []; trips = [];
  const t0 = performance.now();
  const r = await worker.fetch(new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKENS[m.who]}` }, body: JSON.stringify(m.body) }), env, ctx);
  await r.text(); const t1 = performance.now(); await Promise.all(later); const t2 = performance.now();
  const call = asked.find((a) => a.tool === 'respond') || asked[0];
  const pre = trips.filter((t) => call && t.at < call.at), post = trips.filter((t) => !call || t.at >= call.at);
  const sum = (xs) => xs.reduce((a, x) => a + x.ms, 0);
  rows.push({ id: m.id, before: pre.length, beforeDb: sum(pre), build: call ? call.at - t0 - sum(pre) : null, after: post.filter((t) => t.at < t1).length, afterDb: sum(post.filter((t) => t.at < t1)), total: t1 - t0, background: t2 - t1, calls: asked.length, kb: call ? call.bytes / 1024 : 0, recorded: !!answer });
  if (process.env.TRIPS && m.id === process.env.TRIPS) for (const t of trips) console.error(`${t.at < (call?.at ?? Infinity) ? 'before' : 'after '} ${t.kind} ${t.sql}`); // TRIPS=<id>: every round trip of that message
  db.close();
}
mock.close();
const f = (x, d = 0) => (x == null ? '—' : x.toFixed(d));
console.log('| # | לפני המודל: קריאות D1 | זמן D1 (מקומי) | הכנת הפרומפט בלי D1 | אחרי המודל: קריאות D1 | עד התשובה (בלי המודל) | ברקע | קריאות למודל | גודל הבקשה | תשובה מוקלטת |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.id} | ${r.before} | ${f(r.beforeDb, 1)}ms | ${f(r.build)}ms | ${r.after} | ${f(r.total)}ms | ${f(r.background)}ms | ${r.calls} | ${f(r.kb)}KB | ${r.recorded ? 'כן' : 'לא'} |`);
