// Shuki on a serverless host without a disk (Vercel, Netlify...): the same worker code, the database on libSQL / Turso.
// The host serves public/ as static files and sends /api/* and /mcp/* here. Nothing runs by itself on these hosts,
// so the hourly job (reminders, the evening digest, the daily backup) is a URL an outside cron calls every hour:
//   GET /api/cron  with  Authorization: Bearer $CRON_SECRET   (cron-job.org, GitHub Actions, the host's own cron)
// Environment: DATABASE_URL, DATABASE_AUTH_TOKEN, CRON_SECRET, and the same keys as server/node.js (ANTHROPIC_API_KEY...).
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/index.js';
import { libsqlDb, migrate } from './libsql.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_URL', 'MODEL', 'OPENAI_API_KEY', 'OPENAI_URL', 'OPENAI_MODEL', 'PROVIDER', 'MONTHLY_COST_CAP', 'MONTHLY_TOKEN_CAP', 'PRICE_IN', 'PRICE_OUT', 'UPDATE_REPO', 'VAPID_PUBLIC', 'VAPID_PRIVATE_JWK', 'VAPID_SUBJECT', 'SETUP_CODE'];
let ready = null;
/** One database client and one migration run per warm copy of the function. */
function boot() {
  ready ||= (async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    const DB = libsqlDb(process.env.DATABASE_URL, process.env.DATABASE_AUTH_TOKEN);
    await migrate(DB, join(ROOT, 'migrations'));
    const env = { DB, ASSETS: { fetch: () => new Response('not found', { status: 404 }) } };
    for (const k of KEYS) if (process.env[k] !== undefined) env[k] = process.env[k];
    return env;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

/** The hourly job, for hosts that run a function on a schedule themselves (Netlify). */
export async function hourly() {
  const env = await boot(); const later = [];
  worker.scheduled({ scheduledTime: Date.now() }, env, { waitUntil: (p) => later.push(Promise.resolve(p).catch((e) => console.error(e))) });
  await Promise.all(later);
}

/** A Web Request in, a Web Response out. Work the worker hands to waitUntil is finished before answering. */
export async function handle(req) {
  const env = await boot();
  const later = [];
  const ctx = { waitUntil: (p) => later.push(Promise.resolve(p).catch((e) => console.error(e))) };
  const url = new URL(req.url);
  // Vercel hands the rewritten request over with the original path in ?shukipath= (vercel.json)
  const orig = url.searchParams.get('shukipath');
  if (orig && /^\/(api|mcp)(\/|$)/.test(orig)) { url.pathname = orig; url.searchParams.delete('shukipath'); req = new Request(url, req); }
  if (url.pathname === '/api/cron') {
    if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response('forbidden', { status: 403 });
    worker.scheduled({ scheduledTime: Date.now() }, env, ctx);
    await Promise.all(later);
    return new Response('ok');
  }
  // the client's address for the pairing limits, from the host's proxy header
  const headers = new Headers(req.headers);
  // the client's address as the platform saw it (Netlify's own header; else the last hop of X-Forwarded-For, review A-9)
  headers.set('cf-connecting-ip', req.headers.get('x-nf-client-connection-ip') || String(req.headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean).at(-1) || 'unknown');
  const res = await worker.fetch(new Request(req, { headers }), env, ctx);
  await Promise.all(later);
  return res;
}
