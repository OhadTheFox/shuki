// The measurement's seq step (the owner 07/10, instead of Batch): the captured requests one after another through the regular
// Messages API, never two at once, each as it was captured; the first writes the cache and the rest read it. Each call is
// in the ledger, a call that could pass the cap is not sent, and a run again sends only what has no answer yet.
// A fake Anthropic and a ledger of its own: no key, no network, docs/stage0-spend.md untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SET, S7 } from '../tools/measure/set.mjs';
import { cost } from '../tools/measure/lib.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const runs = (ms) => ms.reduce((a, m) => a + (m.runs || 1), 0);
const body = (id) => ({ model: 'claude-sonnet-5', max_tokens: 10, system: [{ type: 'text', text: 'I', cache_control: { type: 'ephemeral' } }, { type: 'text', text: id }], messages: [{ role: 'user', content: id }] });

/** One fake Anthropic for a test: fail(n) says whether its n-th message call fails. */
function fake(fail = () => false) {
  const st = { calls: [], inflight: 0, most: 0, n: 0 };
  const srv = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', async () => {
      const send = (code, x) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(x)); };
      const b = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (req.url === '/v1/messages/count_tokens') return send(200, { input_tokens: b.messages[0].content === 'x' ? 100 : 110 });
      if (req.url !== '/v1/messages') return send(404, {});
      st.inflight++; st.most = Math.max(st.most, st.inflight);
      await new Promise((r) => setTimeout(r, 20));
      st.inflight--;
      if (fail(++st.n)) return send(500, { error: { type: 'api_error' } });
      st.calls.push(b);
      const first = st.calls.length === 1;
      send(200, { model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: `t${st.n}`, name: 'respond', input: { reply: 'אני פה!', face: 'happy' } }],
        usage: { input_tokens: 10, cache_creation_input_tokens: first ? 100 : 0, cache_read_input_tokens: first ? 0 : 100, output_tokens: 5 } });
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ st, srv })));
}

async function setup(name, set = SET, est = { seq: { max: 1.5 } }) {
  const label = `seqtest-${name}`, W = `/tmp/shuki-measure-${label}`, ledgerFile = `/tmp/shuki-ledger-seq-${name}.md`;
  rmSync(W, { recursive: true, force: true }); mkdirSync(W, { recursive: true }); rmSync(ledgerFile, { force: true });
  writeFileSync(`${W}/requests.json`, JSON.stringify(Object.fromEntries(set.filter((m) => m.real).map((m) => [m.id, body(m.id)]))));
  if (est) writeFileSync(`${W}/estimate.json`, JSON.stringify(est));
  const run = (f, step = 'seq', extra = {}) => {
    const env = { ...process.env, MEASURE_API: `http://127.0.0.1:${f.srv.address().port}`, MEASURE_LEDGER: ledgerFile, ...extra };
    for (const k of ['ONLY', 'SET']) if (!(k in extra)) delete env[k];
    if (!('MEASURE_BASE' in extra)) env.MEASURE_BASE = '0'; if (!('MEASURE_CAP' in extra)) env.MEASURE_CAP = '1000'; // r9z: no call without them
    let out = '';
    return new Promise((ok) => { const p = spawn('node', ['tools/measure/run.mjs', step, '--label', label, '--approved'], { cwd: ROOT, env }); p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; }); p.on('exit', (code) => ok({ code, out })); });
  };
  const read = (f) => (existsSync(`${W}/${f}`) ? JSON.parse(readFileSync(`${W}/${f}`, 'utf8')) : null);
  const ledger = () => (existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8').split('\n') : []);
  const clean = () => { rmSync(W, { recursive: true, force: true }); rmSync(ledgerFile, { force: true }); };
  return { W, run, read, ledger, clean, reqs: read('requests.json') };
}
const byUsage = (l) => l.filter((x) => /\| seq m\d+-r\d+ \[[^\]]+\] \| claude-sonnet-5 \| [\d /]+ \| לפי usage \|/.test(x));
const open = (l) => l.filter((x) => /\| seq m\d+-r\d+ \[[^\]]+\] .*\| יצאה, הערכה גבוהה \|/.test(x));

test('seq: one after another, each request as captured, the first writes the cache and the rest read it; a row by usage for each', async () => {
  const f = await fake(), s = await setup('all');
  try {
    const r = await s.run(f);
    assert.equal(r.code, 0, r.out);
    const N = runs(SET.filter((m) => m.real));
    assert.equal(f.st.calls.length, N); assert.equal(f.st.most, 1, 'two calls at once');
    const order = SET.filter((m) => m.real).flatMap((m) => Array(m.runs || 1).fill(m.id));
    assert.deepEqual(f.st.calls, order.map((id) => s.reqs[id]), 'not the captured requests, in order');
    const res = s.read('seq-results.json');
    assert.equal(Object.keys(res).length, N);
    assert.equal(Object.values(res)[0].usage.cache_creation_input_tokens, 100); assert.equal(Object.values(res)[1].usage.cache_read_input_tokens, 100);
    assert.equal(byUsage(s.ledger()).length, N); assert.equal(open(s.ledger()).length, 0);
    // run again: everything is in, nothing goes out twice
    const again = await s.run(f);
    assert.equal(again.code, 0, again.out); assert.equal(f.st.calls.length, N); assert.equal(byUsage(s.ledger()).length, N);
  } finally { f.srv.close(); s.clean(); }
});

test('seq with SET=s7 and ONLY: only that message, each of its runs', async () => {
  const f = await fake(), s = await setup('only', S7);
  try {
    const m = S7.find((x) => x.real && (x.runs || 1) === 3);
    const r = await s.run(f, 'seq', { SET: 's7', ONLY: m.id });
    assert.equal(r.code, 0, r.out);
    assert.equal(f.st.calls.length, 3); assert.ok(f.st.calls.every((b) => b.messages[0].content === m.id));
    assert.deepEqual(Object.keys(s.read('seq-results.json')), [1, 2, 3].map((k) => `m${S7.indexOf(m)}-r${k}`));
  } finally { f.srv.close(); s.clean(); }
});

test('seq stops before a call that could pass the measurement cap: what came back stays, nothing open', async () => {
  const f = await fake(), s = await setup('cap', SET, { seq: { max: 0.0005 } });
  try {
    // a call at most (count_tokens 110 all written, 10 out) $0.000375; each by usage (10 in, 100 written or read, 5 out) less
    const high = cost('claude-sonnet-5', { cache_creation_input_tokens: 110, output_tokens: 10 });
    const first = cost('claude-sonnet-5', { input_tokens: 10, cache_creation_input_tokens: 100, output_tokens: 5 }), next = cost('claude-sonnet-5', { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 });
    const cap = first + next + high - 1e-6; // room for two, not for a third that could be all of its high estimate
    const r = await s.run(f, 'seq', { MEASURE_BASE: '0', MEASURE_CAP: String(cap) });
    assert.notEqual(r.code, 0); assert.match(r.out, /over the measurement cap/);
    assert.equal(f.st.calls.length, 2); assert.equal(Object.keys(s.read('seq-results.json')).length, 2);
    assert.equal(byUsage(s.ledger()).length, 2); assert.equal(open(s.ledger()).length, 0);
  } finally { f.srv.close(); s.clean(); }
});

test('seq: a call that fails keeps its open row; a run again sends only the rest', async () => {
  const f = await fake((n) => n === 2), s = await setup('fail');
  try {
    const N = runs(SET.filter((m) => m.real));
    const r = await s.run(f);
    assert.notEqual(r.code, 0);
    assert.equal(Object.keys(s.read('seq-results.json')).length, 1); assert.equal(open(s.ledger()).length, 1);
    const again = await s.run(f);
    assert.equal(again.code, 0, again.out);
    assert.equal(f.st.calls.length, N, 'the first one sent twice, or one missing');
    assert.equal(Object.keys(s.read('seq-results.json')).length, N);
    assert.equal(byUsage(s.ledger()).length, N); assert.equal(open(s.ledger()).length, 1, 'the open row of the failed call went');
  } finally { f.srv.close(); s.clean(); }
});

test('estimate: a line for seq, one cache write and a read of the tools and instructions for each one after it', async () => {
  const f = await fake(), s = await setup('estimate', SET, null);
  try {
    const r = await s.run(f, 'estimate');
    assert.equal(r.code, 0, r.out);
    const N = runs(SET.filter((m) => m.real));
    assert.match(r.out, new RegExp(`seq, the same ${N} one after another \\(1 cache write \\+ ${N - 1} cache reads of 100 tokens\\)`));
    const e = s.read('estimate.json').seq;
    const out = (m) => (m.body.image || m.id === '19' ? 900 : 350);
    const want = SET.filter((m) => m.real).flatMap((m) => Array(m.runs || 1).fill(m)).reduce((a, m, i) => a + cost('claude-sonnet-5', { ...(i ? { cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } : { cache_creation_input_tokens: 110 }), output_tokens: out(m) }), 0);
    assert.ok(Math.abs(e.min - want) < 1e-9, `${e.min} ≠ ${want}`); assert.ok(e.max >= e.min);
  } finally { f.srv.close(); s.clean(); }
});
