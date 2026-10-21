// Stage 0 measurement: the pieces every run uses. Prices, the spend ledger, the local "model" the server talks to
// (fake, replay or a proxy to Anthropic) and the server itself against the fixed house (test/measure-house.mjs).
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { openSync } from 'node:fs';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const NOW = 1791298800000; // Tue 06/10/2026 18:00 Asia/Jerusalem, the same as in test/measure-house.mjs
export const CAP = 30; // dollars for all of the stages until launch (the owner 14/10; 35–37.5 for home18–home20 rounds only, 17/10–19/10)
export const sha = (s) => createHash('sha256').update(s).digest('hex');

/* ---- prices (verified 01/10 on platform.claude.com/docs/en/about-claude/pricing) ---- */
const PRICE = { 'claude-sonnet-5': { in: 2, out: 10 } };
const WRITE = 1.25, READ = 0.1, BATCH = 0.5;
/** Dollars for one call's usage. batch = the Batch API's 50% (it stacks with the cache multipliers). */
export function cost(model, u, batch = false) {
  const p = PRICE[model]; if (!p) throw new Error(`no price for ${model}`);
  const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * WRITE + (u.cache_read_input_tokens || 0) * READ;
  return ((input * p.in + (u.output_tokens || 0) * p.out) / 1e6) * (batch ? BATCH : 1);
}
/** The most and the least a request can cost: nothing read from the cache, or the tools and instructions read. */
export function estimate(model, tokens, out, batch, cachedPrefix) {
  const max = cost(model, { cache_creation_input_tokens: tokens, output_tokens: out }, batch);
  const min = cost(model, { cache_read_input_tokens: cachedPrefix, cache_creation_input_tokens: tokens - cachedPrefix, output_tokens: out }, batch);
  return { min, max };
}

/* ---- the spend ledger (docs/stage0-spend.md): a call is written when it goes out, at the high estimate, and
   corrected by its real usage when it comes back. One that never comes back stays at the high estimate. ---- */
// MEASURE_LEDGER: another file, for the tool's own tests only (test/measure-ledger.test.js)
const LEDGER = process.env.MEASURE_LEDGER || `${ROOT}docs/stage0-spend.md`;
const HEAD = '# שלב 0: ספר ההוצאות (מודל אמיתי בלבד)\n\nכל קריאה נרשמת כשהיא יוצאת, לפי ההערכה הגבוהה, ומתעדכנת לפי usage כשהיא חוזרת. קריאה שלא חזרה נשארת בהערכה הגבוהה.\n\n| ריצה | מה | מודל | טוקנים (נכנס / כתיבה / קריאה / יוצא) | מצב | עלות |\n|---|---|---|---|---|---|\n';
const rows = () => (existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : HEAD);
const money = (l) => Number(/\| \$([\d.]+) \|$/.exec(l)?.[1] || 0);
export const LEDGER_FILE = () => LEDGER;
export const spent = () => rows().split('\n').filter((l) => /^\| /.test(l) && !/^\| ריצה/.test(l)).reduce((a, l) => a + money(l), 0);
const tok = (u) => `${u.input_tokens || 0} / ${u.cache_creation_input_tokens || 0} / ${u.cache_read_input_tokens || 0} / ${u.output_tokens || 0}`;
/** A call that came back (Batch results): written once, by its usage. */
export function ledger(run, what, model, u, batch) {
  const c = cost(model, u, batch);
  writeFileSync(LEDGER, `${rows()}| ${run} | ${what}${batch ? ' (Batch)' : ''} | ${model} | ${tok(u)} | לפי usage | $${c.toFixed(5)} |\n`);
  if (!batch) stopIfOver(); // a batch is paid for already: every line of it is written first, then checked (stopIfOver)
  return c;
}
let seq = 0;
/** A regular call going out: written now at the high estimate; returns how to correct it when it comes back. */
export function ledgerOpen(run, what, model, high) {
  const id = `[${Date.now().toString(36)}-${++seq}]`;
  stopIfOver(); // before it goes out: what is already spent
  writeFileSync(LEDGER, `${rows()}| ${run} | ${what} ${id} | ${model} | — | יצאה, הערכה גבוהה | $${high.toFixed(5)} |\n`);
  return (u) => {
    const c = cost(model, u, false);
    writeFileSync(LEDGER, rows().split('\n').map((l) => (l.includes(id) ? `| ${run} | ${what} ${id} | ${model} | ${tok(u)} | לפי usage | $${c.toFixed(5)} |` : l)).join('\n'));
    stopIfOver();
    return c;
  };
}
/** A row written when something went out (ledgerOpen) is taken out: a Batch's own rows, by usage, take its place. */
export function ledgerDrop(id) { writeFileSync(LEDGER, rows().split('\n').filter((l) => !l.includes(id)).join('\n')); }
/** The high estimate of a call: every input token written to the cache, and all of max_tokens out (count_tokens: free). */
export async function high(body) {
  const { input_tokens } = JSON.parse(await anthropic('/v1/messages/count_tokens', { model: body.model, system: body.system, tools: body.tools, tool_choice: body.tool_choice, messages: body.messages }));
  return cost(body.model, { cache_creation_input_tokens: input_tokens, output_tokens: body.max_tokens || 4096 });
}
/** A cap for one measurement (the owner 03/10: the re-measurement, up to $2.5): MEASURE_BASE = what was spent before it, MEASURE_CAP = its cap. */
const BASE = process.env.MEASURE_BASE != null ? Number(process.env.MEASURE_BASE) : null, RUN_CAP = process.env.MEASURE_CAP != null ? Number(process.env.MEASURE_CAP) : null;
const overRun = () => BASE != null && RUN_CAP != null && spent() - BASE > RUN_CAP;
/** After every call written to the ledger: past the measurement's cap, stop here. */
export function stopIfOver() { if (overRun()) throw new Error(`over the measurement cap: $${(spent() - BASE).toFixed(2)} > $${RUN_CAP} (stopped; docs/stage0-spend.md)`); }
/** Refuses before a real run that could take stage 0 over the cap, or this measurement over its own. */
export function guard(expectedMax) {
  const s = spent();
  if (s + expectedMax > CAP) throw new Error(`over the cap: spent $${s.toFixed(2)} + up to $${expectedMax.toFixed(2)} > $${CAP}`);
  if (BASE != null && RUN_CAP != null && s - BASE + expectedMax > RUN_CAP) throw new Error(`over the measurement cap: $${(s - BASE).toFixed(2)} spent in it + up to $${expectedMax.toFixed(2)} > $${RUN_CAP}`);
  return s;
}

/* ---- the key: only from .measure.env, never printed, never written anywhere ---- */
export function key() {
  if (process.env.MEASURE_API) return 'measure-test'; // a fake Anthropic (tests): the real key never goes anywhere else
  const k = /^\s*ANTHROPIC_API_KEY\s*=\s*(\S+)/m.exec(readFileSync(`${ROOT}.measure.env`, 'utf8'))?.[1];
  if (!k) throw new Error('no ANTHROPIC_API_KEY in .measure.env');
  return k;
}
const API = process.env.MEASURE_API || 'https://api.anthropic.com'; // MEASURE_API: a fake one, for the tool's own tests
/** One call to Anthropic. On an error: the status and the error type only (the message may echo the request). */
export async function anthropic(path, body, method = 'POST') {
  const r = await fetch(API + path, { method, headers: { 'x-api-key': key(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) { let t = ''; try { t = JSON.parse(text).error?.type || ''; } catch { /* not JSON */ } throw new Error(`anthropic ${path}: ${r.status} ${t}`); }
  return text;
}

/* ---- the local model: what the server's ANTHROPIC_URL points at (127.0.0.1 only) ---- */
/**
 * mode.kind:
 *  'fake'    → answers mode.answer(body) (default: an empty respond) and keeps the request. No key, no cost.
 *  'replay'  → answers with the real response recorded for this exact request (by its hash); a request it hasn't seen
 *              (the server asking a second time) goes to Anthropic only when mode.real is set, and is charged.
 *  'proxy'   → every request goes to Anthropic, timed and charged.
 * Every request and response is kept in calls (the request body never has the key in it: the server only has a fake one).
 */
export function model(port) {
  const st = { mode: { kind: 'fake' }, calls: [] };
  const srv = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', async () => {
      const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)
      const body = JSON.parse(b), m = st.mode, call = { hash: sha(b), body, real: false };
      st.calls.push(call);
      try {
        let out;
        if (m.kind === 'fake' || (m.kind === 'replay' && m.recorded?.[call.hash])) {
          out = m.kind === 'replay' ? m.recorded[call.hash] : { content: [{ type: 'tool_use', name: body.tools?.[0]?.name || 'respond', input: m.answer?.(body) || { reply: 'אני פה!', face: 'happy' } }], usage: { input_tokens: 0, output_tokens: 0 } };
          call.replayed = m.kind === 'replay';
          if (call.replayed) m.firstDone = true;
        // replay: only a second call of the server after the message's own recorded answer goes to the real model (r9z, the
        // review of 64ea414); a first request that doesn't match what was recorded is never sent
        } else if (m.kind === 'proxy' || (m.real && m.firstDone)) {
          const close = ledgerOpen(m.run, m.what?.(call) || 'קריאה רגילה', body.model, await high(body));
          const t0 = Date.now(); call.real = true; call.started = t0;
          try { out = JSON.parse(await anthropic('/v1/messages', body)); } finally { call.ms = Date.now() - t0; }
          call.cost = close(out.usage);
        } else throw new Error('replay: a request with no recorded answer (a second call from the server?)');
        call.response = out;
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
      } catch (e) {
        call.error = e.message;
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'measure', message: e.message } }));
      }
    });
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok({ st, close: () => srv.close() })));
}

/* ---- the server, against the fixed house ---- */
const S = '/tmp/shuki-measure';
const wr = (...a) => execFileSync('npx', ['wrangler', ...a], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
export async function house({ port = 8780, modelPort = 8781, now = NOW } = {}) {
  rmSync(S, { recursive: true, force: true }); mkdirSync(S, { recursive: true });
  execFileSync('node', [`${ROOT}test/measure-house.mjs`, `${S}/house.sql`]);
  wr('d1', 'migrations', 'apply', 'shuki', '--local', '--persist-to', `${S}/db`);
  // a clean house again = every table emptied (the categories and places of the migrations stay) + the fixed house
  const tables = JSON.parse(wr('d1', 'execute', 'shuki', '--local', '--persist-to', `${S}/db`, '--json', '--command', "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('d1_migrations', 'categories', 'locations', 'sqlite_sequence') AND name NOT LIKE '_cf_%'").replace(/^[^[]*/, ''))[0].results.map((r) => r.name);
  writeFileSync(`${S}/reset.sql`, `PRAGMA defer_foreign_keys = true;\n${tables.map((t) => `DELETE FROM ${t};`).join("\n")}\nDELETE FROM sqlite_sequence;\n${readFileSync(`${S}/house.sql`, 'utf8')}`);
  // the server goes on working for a moment after it answers (waitUntil): let it finish before the house is cleaned
  const reset = () => { execFileSync('sleep', ['1']); wr('d1', 'execute', 'shuki', '--local', '--persist-to', `${S}/db`, '--file', `${S}/reset.sql`); };
  reset();
  const { TOKENS } = await import(`${ROOT}test/measure-house.mjs`);
  let dev;
  const start = async (at = now) => {
    dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(port), '--persist-to', `${S}/db`, '--var', `ANTHROPIC_URL:http://127.0.0.1:${modelPort}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:measure-fake', '--var', `FIXED_NOW:${at}`, '--var', 'CHAT_PER_MINUTE:1000', '--var', 'MONTHLY_COST_CAP:1000'], { cwd: ROOT, detached: true, stdio: ['ignore', openSync(`${S}/dev.log`, 'a'), openSync(`${S}/dev.log`, 'a')] });
    for (let i = 0; i < 120; i++) { try { await fetch(`http://127.0.0.1:${port}/`); return; } catch { await new Promise((r) => setTimeout(r, 500)); } }
    throw new Error('the server did not start');
  };
  const stop = async () => { if (dev) { try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ } dev = null; await new Promise((r) => setTimeout(r, 800)); } };
  const api = async (who, method, path, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKENS[who]}` }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); try { return JSON.parse(t); } catch { return { status: r.status, text: t }; }
  };
  await start();
  const sql = (q) => wr('d1', 'execute', 'shuki', '--local', '--persist-to', `${S}/db`, '--command', q); // the stage 7 set's seed
  return { reset, sql, api, stop, restart: async (at) => { await stop(); await start(at); } };
}
