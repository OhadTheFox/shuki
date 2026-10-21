// The D1 API over libSQL (Turso, or any libSQL / sqld server), for hosts without a disk: Vercel, Netlify, and other
// serverless platforms. Also usable from server/node.js (DATABASE_URL), which is how it is tested.
//   DATABASE_URL = libsql://<db>.turso.io (or http(s)://..., or file:./x.db) · DATABASE_AUTH_TOKEN = the database token
import { createClient } from '@libsql/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const val = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
// rows as plain objects, and 64-bit integers as numbers (every id and time here fits in a double)
const plain = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, typeof r[i] === 'bigint' ? Number(r[i]) : r[i]])));
const READS = /^\s*(SELECT|WITH|PRAGMA)\b/i;

class Stmt {
  constructor(client, sql, args = []) { this.client = client; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.client, this.sql, args.map(val)); }
  async all() { return { results: plain(await this.client.execute({ sql: this.sql, args: this.args })), success: true, meta: {} }; }
  async first(col) { const r = (await this.all()).results[0]; return r ? (col ? r[col] : r) : null; }
  async run() { return shape(this.sql, await this.client.execute({ sql: this.sql, args: this.args })); }
}
function shape(sql, rs) {
  if (READS.test(sql) || /\bRETURNING\b/i.test(sql)) return { results: plain(rs), success: true, meta: {} };
  return { success: true, results: [], meta: { changes: rs.rowsAffected, last_row_id: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : null } };
}

export class LibsqlD1 {
  constructor(client) { this.client = client; }
  prepare(sql) { return new Stmt(this.client, sql); }
  /** One transaction, like D1's batch: all or nothing. */
  async batch(list) {
    const out = await this.client.batch(list.map((s) => ({ sql: s.sql, args: s.args })), 'write');
    return out.map((rs, i) => shape(list[i].sql, rs));
  }
  async exec(sql) { await this.client.executeMultiple(sql); return { count: 1 }; }
}

export function libsqlDb(url, authToken) {
  return new LibsqlD1(createClient({ url, ...(authToken && { authToken }), intMode: 'number' }));
}

/**
 * The same migration files wrangler applies, once each. Many copies of a serverless function can start at once:
 * the one that claims a file (its row in d1_migrations) runs it; if it fails, the claim is taken back.
 */
export async function migrate(db, dir, log = console.log) {
  await db.client.execute('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  const done = new Set((await db.client.execute('SELECT name FROM d1_migrations')).rows.map((r) => r[0]));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const claim = await db.client.execute({ sql: 'INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)', args: [f] });
    if (!claim.rowsAffected) continue; // another copy is running it
    try { await db.client.executeMultiple(readFileSync(join(dir, f), 'utf8')); log(`migration ${f}`); }
    catch (e) { await db.client.execute({ sql: 'DELETE FROM d1_migrations WHERE name = ?', args: [f] }); throw new Error(`migration ${f} failed: ${e.message}`); }
  }
}
