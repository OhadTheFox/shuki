// Shuki without Cloudflare: the same worker code on plain Node.js (22.13+), with SQLite in one file.
//   node server/node.js            (or: docker run ... — see Dockerfile)
// Environment:
//   PORT (8787) · DB_PATH (./data/shuki.db), or DATABASE_URL + DATABASE_AUTH_TOKEN for a libSQL / Turso database · ANTHROPIC_API_KEY or OPENAI_API_KEY (or enter one in the app) · MODEL (claude-sonnet-5) · OPENAI_MODEL (gpt-5.6-terra)
//   PROVIDER (anthropic/openai) · MONTHLY_COST_CAP (dollars, default 10; the admin can change it) · UPDATE_REPO (owner/repo: tell the admin about new releases)
//   SETUP_CODE (optional; otherwise one is made and printed here) · TRUST_PROXY=1 behind a reverse proxy
//   VAPID_PUBLIC + VAPID_PRIVATE_JWK (optional; otherwise the server makes push keys and keeps them in the database)
// Phones need HTTPS to install the app and get notifications: put it behind Caddy, a Cloudflare Tunnel, Tailscale...
import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { readFileSync, readdirSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker, { setupCode } from '../worker/index.js';
import { isPrivateIp } from '../worker/pages.js';

/**
 * Recipe links (worker/pages.js): a page is fetched only from a public address, and the connection goes to the very
 * address that was checked (no second DNS answer can point it into this server's own network).
 */
function pageFetch(url, { signal, headers } = {}) {
  const lookup = (host, opts, cb) => dnsLookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return cb(new Error('private address'));
    return opts?.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
  });
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers, signal, lookup, timeout: 8000 }, (res) => {
      const parts = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n <= 1_600_000) parts.push(c); else res.destroy(); });
      const done = () => {
        const h = new Headers(); for (const [k, v] of Object.entries(res.headers)) if (v != null) h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        resolve(new Response([204, 304].includes(res.statusCode) ? null : Buffer.concat(parts), { status: res.statusCode, headers: h }));
      };
      res.on('end', done); res.on('close', done);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject); req.end();
  });
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);
const DB_PATH = resolve(process.env.DB_PATH || join(ROOT, 'data', 'shuki.db'));

/* ---------- the D1 API over node:sqlite (only what Shuki uses) ---------- */
const val = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const READS = /^\s*(SELECT|WITH|PRAGMA)\b/i;
class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args.map(val)); }
  rows() { return this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })); }
  async all() { return { results: this.rows(), success: true, meta: {} }; }
  async first(col) { const r = this.rows()[0]; return r ? (col ? r[col] : r) : null; }
  async run() { return this.runSync(); }
  runSync() {
    if (READS.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) return { results: this.rows(), success: true, meta: {} };
    const r = this.db.prepare(this.sql).run(...this.args);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}
class D1 {
  constructor(db) { this.db = db; }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(list) {
    this.db.exec('BEGIN');
    try { const out = list.map((s) => s.runSync()); this.db.exec('COMMIT'); return out; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  async exec(sql) { this.db.exec(sql); return { count: 1 }; }
}

/* ---------- database + migrations (the same files wrangler applies) ---------- */
// a libSQL / Turso database instead of the file (the same adapter the serverless hosts use: server/libsql.js)
let DB, sqlite = null;
if (process.env.DATABASE_URL) {
  const { libsqlDb, migrate } = await import('./libsql.js');
  if (process.env.DATABASE_URL.startsWith('file:')) mkdirSync(dirname(resolve(process.env.DATABASE_URL.slice(5))), { recursive: true });
  DB = libsqlDb(process.env.DATABASE_URL, process.env.DATABASE_AUTH_TOKEN);
  try { await migrate(DB, join(ROOT, 'migrations')); } catch (e) { console.error(e.message); process.exit(1); }
} else {
mkdirSync(dirname(DB_PATH), { recursive: true });
sqlite = new DatabaseSync(DB_PATH);
sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
sqlite.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
const done = new Set(sqlite.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name));
for (const f of readdirSync(join(ROOT, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  if (done.has(f)) continue;
  sqlite.exec('BEGIN');
  try {
    sqlite.exec(readFileSync(join(ROOT, 'migrations', f), 'utf8'));
    sqlite.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f);
    sqlite.exec('COMMIT'); console.log(`migration ${f}`);
  } catch (e) { sqlite.exec('ROLLBACK'); console.error(`migration ${f} failed:`, e.message); process.exit(1); }
}
DB = new D1(sqlite);
}

/* ---------- static files (what Workers Static Assets does on Cloudflare) ---------- */
// the same headers as public/_headers (which Cloudflare reads)
const SECURITY = {
  'content-security-policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'geolocation=(), microphone=(), camera=(self)',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const ASSETS = {
  async fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = resolve(PUBLIC, `.${p}`);
    if (!file.startsWith(PUBLIC + sep) || !existsSync(file) || !statSync(file).isFile()) return new Response('not found', { status: 404 });
    return new Response(readFileSync(file), { headers: { ...SECURITY, 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': /sw\.js$|index\.html$/.test(file) ? 'no-cache' : 'public, max-age=300' } });
  },
};

const env = {
  DB, ASSETS,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_URL: process.env.ANTHROPIC_URL, MODEL: process.env.MODEL || 'claude-sonnet-5',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_URL: process.env.OPENAI_URL, OPENAI_MODEL: process.env.OPENAI_MODEL, PROVIDER: process.env.PROVIDER,
  MONTHLY_COST_CAP: process.env.MONTHLY_COST_CAP, MONTHLY_TOKEN_CAP: process.env.MONTHLY_TOKEN_CAP, PRICE_IN: process.env.PRICE_IN, PRICE_OUT: process.env.PRICE_OUT, UPDATE_REPO: process.env.UPDATE_REPO,
  VAPID_PUBLIC: process.env.VAPID_PUBLIC, VAPID_PRIVATE_JWK: process.env.VAPID_PRIVATE_JWK, VAPID_SUBJECT: process.env.VAPID_SUBJECT, PUSH_ALLOW: process.env.PUSH_ALLOW, // as on Workers (a var)
  SETUP_CODE: process.env.SETUP_CODE, TEST_RESET: process.env.TEST_RESET, CHAT_PER_MINUTE: process.env.CHAT_PER_MINUTE, // as on Workers (a var)
  FIXED_NOW: process.env.TEST_RESET === '1' ? process.env.FIXED_NOW : undefined, // tests only (stage 8, test/holiday.itest.js): a fixed clock, as the measurement's
  PAGE_FETCH: pageFetch,
};
for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
const MAX_BODY = 12 * 1024 * 1024;
const ctx = { waitUntil: (p) => { Promise.resolve(p).catch((e) => console.error(e)); } };

/* ---------- HTTP ---------- */
const server = http.createServer(async (req, res) => {
  try {
    // bodies are small (the biggest is a photo, under 2 MB): anything far bigger is cut off before it fills memory
    if (Number(req.headers['content-length']) > MAX_BODY) { res.writeHead(413); res.end(); return; }
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_BODY) { res.writeHead(413); res.end(); req.destroy(); return; } chunks.push(c); }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    // behind a proxy, the address the proxy saw: the last hop (the first ones are whatever the client wrote; review A-9)
    const ip = (process.env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean).at(-1)) || req.socket.remoteAddress || 'local';
    headers.set('cf-connecting-ip', ip);
    const body = chunks.length && !['GET', 'HEAD'].includes(req.method) ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request(`http://${req.headers.host || 'localhost'}${req.url}`, { method: req.method, headers, body }), env, ctx);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error('request', req.method, String(req.url).replace(/\/mcp\/[0-9a-f]+/, '/mcp/…'), e.stack || e); // an MCP address is a secret
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
});
server.listen(PORT, async () => {
  console.log(`shuki: http://localhost:${PORT}  (database: ${process.env.DATABASE_URL ? 'libSQL' : DB_PATH})`);
  const code = await setupCode(env).catch(() => null);
  if (code) console.log(`shuki: a new house. Setup code ${code}: open the app and type it in`);
  if (process.env.RUN_SCHEDULE_ON_START) worker.scheduled({ scheduledTime: Date.now() }, env, ctx); // tests: the hourly job, now
});

/* ---------- every hour, on the hour (reminders, the evening digest) ---------- */
let lastHour = new Date().getHours();
setInterval(() => {
  const now = new Date();
  if (now.getMinutes() !== 0 || now.getHours() === lastHour) return;
  lastHour = now.getHours();
  worker.scheduled({ scheduledTime: now.getTime() }, env, ctx);
}, 20e3).unref();
process.on('SIGTERM', () => { server.close(); sqlite?.close(); process.exit(0); });
