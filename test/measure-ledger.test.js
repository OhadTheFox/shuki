// The measurement's ledger and a Batch (the owner 03/10): the open row is written before it goes out, and is replaced by a row
// per request when every answer is back; a batch that fails or comes back in part keeps the open row (never counts less).
// A fake Anthropic and a ledger of its own: no key, no network, docs/stage0-spend.md untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SET } from '../tools/measure/set.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REAL = SET.filter((m) => m.real);
const N = REAL.reduce((a, m) => a + (m.runs || 1), 0);
const usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 };

async function run(mode, again = false) {
  const label = `ledgertest-${mode}${again ? '-again' : ''}`, W = `/tmp/shuki-measure-${label}`, ledgerFile = `/tmp/shuki-ledger-${mode}.md`;
  rmSync(W, { recursive: true, force: true }); mkdirSync(W, { recursive: true }); rmSync(ledgerFile, { force: true });
  writeFileSync(`${W}/requests.json`, JSON.stringify(Object.fromEntries(REAL.map((m) => [m.id, { model: 'claude-sonnet-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }]))));
  writeFileSync(`${W}/estimate.json`, JSON.stringify({ batch: { max: 1.5 } }));
  let atSend = null, ids = [];
  const srv = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
      const send = (code, x) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(typeof x === 'string' ? x : JSON.stringify(x)); };
      if (req.method === 'POST' && req.url === '/v1/messages/batches') {
        atSend = existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8') : '';
        ids = JSON.parse(Buffer.concat(parts).toString('utf8')).requests.map((r) => r.custom_id);
        return mode === 'failed' || mode === 'retry' ? send(500, { error: { type: 'api_error' } }) : send(200, { id: 'mb_1' });
      }
      if (req.url === '/v1/messages/batches/mb_1') return send(200, { processing_status: 'ended', results_url: `http://127.0.0.1:${srv.address().port}/results` });
      if (req.url === '/results') return send(200, ids.map((id, k) => JSON.stringify(mode === 'partial' && k === 0
        ? { custom_id: id, result: { type: 'errored', error: { error: { type: 'overloaded_error' } } } }
        : { custom_id: id, result: { type: 'succeeded', message: { model: 'claude-sonnet-5', usage, content: [] } } })).join('\n'));
      send(404, {});
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const env = { ...process.env, MEASURE_API: `http://127.0.0.1:${srv.address().port}`, MEASURE_LEDGER: ledgerFile };
  env.MEASURE_BASE = '0'; env.MEASURE_CAP = '1000'; delete env.ONLY; // r9z: no call without the cap and base (a fake ledger, a fake API)
  const once = () => new Promise((ok) => spawn('node', ['tools/measure/run.mjs', 'batch', '--label', label, '--approved'], { cwd: ROOT, env, stdio: 'ignore' }).on('exit', ok));
  let code = await once();
  if (mode === 'retry') { mode = 'all'; code = await once(); } // the first send broke (maybe it went out anyway); the second one goes
  if (mode === 'all' && label.endsWith('again')) code = await once(); // after it all came back: run again, nothing twice
  srv.close();
  const after = readFileSync(ledgerFile, 'utf8');
  const open = (t) => t.split('\n').filter((l) => /\| Batch \(\d+ בקשות\), נשלח \[/.test(l));
  const perRequest = after.split('\n').filter((l) => /\| Batch m[^ ]*-r\d+ \(Batch\) \|/.test(l));
  rmSync(W, { recursive: true, force: true }); rmSync(ledgerFile, { force: true });
  return { code, atSend, openAtSend: atSend == null ? null : open(atSend), openAfter: open(after), perRequest };
}

test('every answer back: open row before it goes out, then a row per request instead', async () => {
  const r = await run('all');
  assert.equal(r.code, 0);
  assert.equal(r.openAtSend.length, 1, 'no open row when it went out');
  assert.equal(r.openAfter.length, 0, 'the open row stayed');
  assert.equal(r.perRequest.length, N);
});

test('back in part: the rows that came, and the open row stays at the high estimate', async () => {
  const r = await run('partial');
  assert.equal(r.openAtSend.length, 1);
  assert.equal(r.perRequest.length, N - 1);
  assert.equal(r.openAfter.length, 1, 'the open row went though one request has no answer');
});

test('the batch failed to go out: the open row stays', async () => {
  const r = await run('failed');
  assert.notEqual(r.code, 0);
  assert.equal(r.openAtSend.length, 1);
  assert.equal(r.openAfter.length, 1, 'no row for what may have been spent');
  assert.equal(r.perRequest.length, 0);
});

test('the send broke (it may have gone out), then a second send: both open rows count, the first one is not taken out', async () => {
  const r = await run('retry');
  assert.equal(r.code, 0);
  assert.equal(r.perRequest.length, N);
  assert.equal(r.openAfter.length, 1, 'the open row of the first send went (it may have been paid for)');
});

test('run again after every answer came back: no row written twice', async () => {
  const r = await run('all', true);
  assert.equal(r.perRequest.length, N);
  assert.equal(r.openAfter.length, 0);
});
