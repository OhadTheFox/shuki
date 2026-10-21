// Stage 0 measurement (docs/stage0-measure-set.md). Run under the shared test lock, through its script (the owner 03/10), which
// says who holds it:
//   SESSION="..." tools/test-lock.sh node tools/measure/run.mjs <step> [--label before] [--approved]
// Steps, in order:
//   selftest   everything with the fake model only: build every request, replay fake answers, server checks,
//              the cache run and the scenario. No key, no cost. Checks the tool itself, not Shuki.
//   capture    builds the exact request the server sends for every real message (fake model, no cost)
//   estimate   counts their tokens (count_tokens: free) and prints what a full run is expected to cost
//   batch      sends them through the Batch API (real model)               needs --approved
//   seq        sends them one after another, regular calls, the cache warm  needs --approved
//              (instead of batch, the owner 07/10): the first writes the cache, every one after it reads it
//   replay     runs the real answers (batch's, seq's) back through the server and checks them (a second call: real, charged)
//   server     the server-side checks, with the fake model's scripted answers (no cost)
//   cache      the cache control and the run of five (real model, regular)   needs --approved
//   scenario   "Michal and the milk" (real model, regular)                   needs --approved
//   report     docs/stage0-results/<label>.json and .md
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { ROOT, NOW, sha, cost, estimate, guard, spent, ledger, ledgerOpen, ledgerDrop, LEDGER_FILE, high, anthropic, key, model, house, stopIfOver } from './lib.mjs';
import { SET as STAGE0, S7, S8, S9, S13, LEGAL, FIRST, CACHE, SCENARIO, shared, sharedName } from './set.mjs';

// SET=s7: stage 7's set (docs/stage7-plan.md); SET=s8, SET=s9: stages 8 and 9's (docs/stage8-plan.md, docs/stage9-plan.md); no
// cache run and no scenario there
const SETS = { s7: S7, s8: S8, s9: S9, s13: S13, legal: LEGAL, first: FIRST }; // first: the first use's day (15/10) // s13: stage 13's injection messages (d8); legal: r13l's recording trigger
if (process.env.SET && !Object.hasOwn(SETS, process.env.SET)) { console.error(`SET=${process.env.SET}: no such set (${Object.keys(SETS).join(', ')}; none = stage 0's)`); process.exit(2); }
const SET = SETS[process.env.SET] || STAGE0;
const SET_NAME = Object.keys(SETS).find((k) => SETS[k] === SET) || 's0';

const args = process.argv.slice(2);
const step = args[0];
const s0 = SET === STAGE0; // stage 7's set never writes over stage 0's runs
// stage 8 on, every set after stage 7's: a label of its own for every run (stage 9: not by its name, any later set too)
const own = SET !== STAGE0 && SET !== S7;
const label = step === 'selftest' ? (s0 ? 'selftest' : `${SET_NAME}-selftest`) : args.includes('--label') ? args[args.indexOf('--label') + 1] : s0 ? 'before' : own ? null : 's7';
// stage 8 (docs/stage8-plan.md, "המודל האמיתי"): a new label for every run, never a default one that a later run writes over
if (args.includes('--label') && !label) { console.log('--label needs a value'); process.exit(1); }
if (!label) { console.log(`SET=${SET_NAME}: every run needs its own --label (${SET_NAME}a, ${SET_NAME}b, ${SET_NAME}-full…)`); process.exit(1); }
const approved = args.includes('--approved');
const W = `/tmp/shuki-measure-${label}`; mkdirSync(W, { recursive: true });
const save = (f, x) => writeFileSync(`${W}/${f}`, JSON.stringify(x, null, 1));
const load = (f, d) => (existsSync(`${W}/${f}`) ? JSON.parse(readFileSync(`${W}/${f}`, 'utf8')) : d);
const cid = (m, run) => `m${SET.indexOf(m)}-r${run}`; // Batch ids: [a-zA-Z0-9_-] only
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; // ONLY=7,21: just these messages (debugging)
const ROUND = process.env.ROUND || null; // ROUND=A: stage 8's messages of one round (`round` on the message); none = all of them
// ט2 (stage 8): FULL=1 runs every message once, and the safety ones (3 runs in the plan's table) 3 times; RUNS=n forces n
if (process.env.RUNS && !(Number.isInteger(Number(process.env.RUNS)) && Number(process.env.RUNS) > 0)) { console.error('RUNS must be a whole number above 0'); process.exit(2); }
const FULL = process.env.FULL === '1';
// what goes out: the runs, and which messages (ROUND, ONLY); a step in another mode would send, replay or count others
const MODE = [SET_NAME, process.env.RUNS ? `RUNS=${process.env.RUNS}` : FULL ? 'FULL' : 'plain', process.env.ROUND && `ROUND=${process.env.ROUND}`, process.env.ONLY && `ONLY=${process.env.ONLY}`].filter(Boolean).join(' ');
const runsOf = (m) => (process.env.RUNS ? Number(process.env.RUNS) : FULL ? (m.runs === 3 ? 3 : 1) : m.runs || 1);
const REAL = SET.filter((m) => m.real && (!ONLY || ONLY.includes(m.id)) && (!ROUND || m.round === ROUND));
// nothing to run (an empty set, a ROUND or ONLY that matches nothing): say so, never a capture that writes {} over a label
if (!REAL.length && ['selftest', 'capture', 'estimate', 'batch', 'seq', 'replay'].includes(step)) { console.log(`no messages to run${ROUND ? ` in ROUND=${ROUND}` : ''}${ONLY ? ` for ONLY=${ONLY.join(',')}` : ''}`); process.exit(1); }
const OUT_TOKENS = (m) => (m.body.image || m.id === '19' ? 900 : 350); // what an answer is expected to be, for the estimate
const WEIGHTS = { א: 55, ב: 15, ג: 12, ד: 8, ה: 1, ו: 5, ז: 2, ח: 2 }; // an assumption, not a measurement (0א)

/** What one run of a message shows: the server's answer, its card, and the state and chats to check against. */
function context(h, who, res, call) {
  const tool = call?.response?.content?.find((b) => b.type === 'tool_use')?.input || {};
  return {
    who, res, reply: res.reply || '', options: res.options || [], lines: (res.proposal?.lines || []).map((l) => l.text).join(' | '), actions: tool.actions || [], tool,
    state: (w) => h.api(w, 'GET', '/api/state'), chat: async (w) => (await h.api(w, 'GET', '/api/chat')).messages || [],
  };
}
async function send(h, mdl, m, body = m.body, who = m.who) {
  const before = mdl.st.calls.length;
  process.stderr.write(`· ${m.id ? `#${m.id}` : ''} ${who}: ${String(body.text).split('\n')[0].slice(0, 40)}\n`);
  const t0 = Date.now();
  const res = await h.api(who, 'POST', '/api/chat', body);
  return { res, calls: mdl.st.calls.slice(before), ms: Date.now() - t0 }; // in replay (the answer recorded): the server's own time

}
async function apply(h, who, res, sure = false) {
  if (res.proposal?.id) return h.api(who, 'POST', `/api/proposals/${res.proposal.id}/apply`, sure ? { sure: true } : {});
  return null;
}
/** A real call the server gave up on (its own timeout) may still be out: wait for it (up to 5 minutes), so its time and usage are known. */
async function settle(mdl) { for (let i = 0; i < 300 && mdl.st.calls.some((c) => c.real && c.ms === undefined); i++) await new Promise((r) => setTimeout(r, 1000)); }
const runOne = async (fn, c) => { try { return await fn(c); } catch (e) { return [`check error: ${e.message}`]; } };
// round 3 (the owner 19/10): every scenario's check, and the checks every scenario gets (set.mjs, shared: no curse)
const runCheck = async (fn, c) => [...await runOne(fn, c), ...shared(c), ...await runOne(sharedName, c)]; // and the writer's own name (fix 2)
/** The local server sometimes drops a connection (ECONNRESET): start it again, clean house, and run that message once more. */
async function retry(h, what, fn) {
  try { return await fn(); } catch (e) {
    if (!/fetch failed/.test(e.message)) throw e;
    process.stderr.write(`! ${what}: the local server dropped the connection (${e.cause?.code || ''}), restarting it and running again\n`);
    await h.restart(h.clock); h.reset();
    return fn();
  }
}

/** A clean fixed house, and what the message needs on it first (seed: SQL, the stage 7 set). */
const fresh = (h, m) => { h.reset(); if (m.seed) h.sql(m.seed); };
/** The server's clock for this message (stage 8: `now`, e.g. 03:00 for "אני רעב" at night): it starts again only when it changes. */
async function at(h, m) { const t = m.now ?? NOW; if (h.clock !== t) { await h.restart(t); h.clock = t; } }

/* ---- capture: the exact request for each real message, from a clean fixed house ---- */
async function capture(h, mdl) {
  mdl.st.mode = { kind: 'fake' };
  const out = {};
  for (const m of REAL) {
    await at(h, m);
    const { calls } = await retry(h, `#${m.id}`, () => { fresh(h, m); return send(h, mdl, m); });
    // the server answered by itself, without the model (0b: distress, D1–D6): nothing to send; its answer is checked in replay
    out[m.id] = calls.length ? calls[0].body : null;
  }
  save('requests.json', out);
  return out;
}

/* 0b with the real model (03/10): whether someone else sees it is checked on the real answer too, not only on a scripted one
   (the server's own check, minus the ones that need several sends) */
/** What the message's check compares to, taken right after the house is reset and before the message (server.pre). */
const preOf = async (h, m) => (m.server?.pre ? m.server.pre(context(h, m.who, {})) : null);
const privacy = async (m, c) => (m.server?.check && !m.server.times ? (await runOne(m.server.check, c)).map((f) => `privacy: ${f}`) : []);

/* ---- replay: the recorded answers back through the server, from a clean house, and the checks ---- */
async function replay(h, mdl, results, kind, seq = {}) {
  const rows = [];
  const reqs = load('requests.json');
  const seqSent = load('seq-sent.json', {});
  for (const m of REAL) for (let run = 1; run <= runsOf(m); run++) {
    await at(h, m);
    if (reqs[m.id] === null) { // the server's own answer (no model): the same checks, on what the server says
      mdl.st.mode = { kind: 'replay', recorded: {}, real: false };
      let pre = null;
      const { res, calls } = await retry(h, `#${m.id}`, async () => { fresh(h, m); pre = await preOf(h, m); const x = await send(h, mdl, m); if (m.apply) await apply(h, m.who, x.res); return x; });
      const c = { ...context(h, m.who, res, null), pre };
      rows.push({ id: m.id, group: m.group, who: m.who, run, model: 'השרת', how: 'בלי מודל', manual: !!m.manual, usage: null, cost: 0, regular: 0, second: [], replayed: false,
        reply: c.reply, lines: c.lines, options: c.options, fails: calls.length ? ['the server called the model'] : [...await runCheck(m.check, c), ...await privacy(m, c)] });
      continue;
    }
    // seq's answer to this very request (not one captured before), else the batch's; seq's is a regular call, at full price
    const s = seqSent[cid(m, run)] === sha(JSON.stringify(reqs[m.id])) ? seq[cid(m, run)] : null;
    const r = s || results[cid(m, run)], how = s ? 'רגיל' : 'Batch';
    if (!r) { rows.push({ id: m.id, group: m.group, run, model: kind, how, fails: ['no answer from the batch or seq'] }); continue; }
    mdl.st.mode = { kind: 'replay', recorded: { [sha(JSON.stringify(reqs[m.id]))]: r }, real: approved && kind === 'אמיתי', run: label, what: () => `#${m.id} קריאה שנייה מהשרת` };
    let pre = null;
    const { res, calls, ms } = await retry(h, `#${m.id}`, async () => { mdl.st.mode.firstDone = false; fresh(h, m); pre = await preOf(h, m); const x = await send(h, mdl, m); if (m.apply) await apply(h, m.who, x.res); return x; }); // a second try starts over: its first request is matched again
    const c = { ...context(h, m.who, res, calls.at(-1)), pre }; // the answer the server kept (after a second call)
    const second = calls.slice(1);
    rows.push({
      id: m.id, group: m.group, who: m.who, run, model: kind, how, manual: !!m.manual,
      usage: r.usage, cost: kind === 'אמיתי' ? cost(reqs[m.id].model, r.usage, !s) : 0, regular: kind === 'אמיתי' ? cost(reqs[m.id].model, r.usage, false) : 0,
      second: second.map((x) => ({ usage: x.response?.usage, cost: x.cost || 0, error: x.error, ms: x.ms, call: x })),
      modelMs: s ? load('seq-ms.json', {})[cid(m, run)] : undefined, serverMs: ms, // 15/10: the time to the answer, the model's (seq) and the server's
      replayed: !!calls[0]?.replayed, reply: c.reply, lines: c.lines, options: c.options, tool: c.tool, // the answer the checks read (a second call's too)
      fails: calls[0]?.replayed ? [...await runCheck(m.check, c), ...await privacy(m, c)] : ['the server sent a different request than the one captured'],
      // a scenario's function (the owner 13/10, 51): checked and reported, but not failing the run (a known gap)
      gaps: m.gap && calls[0]?.replayed ? await runOne(m.gap, c) : undefined, // undefined: not checked
    });
  }
  return rows;
}

/* ---- server: the server-side checks, with scripted answers from the fake model ---- */
async function server(h, mdl) {
  const rows = [];
  for (const m of SET.filter((x) => x.server)) {
    await at(h, m);
    mdl.st.mode = { kind: 'fake', answer: m.server.answer };
    let pre = null;
    const res = await retry(h, `#${m.id}`, async () => { fresh(h, m); pre = await preOf(h, m); let r; for (let i = 0; i < (m.server.times || 1); i++) { ({ res: r } = await send(h, mdl, m)); if (m.server.apply) await apply(h, m.who, r); } return r; });
    const fails = await runCheck(m.server.check, { ...context(h, m.who, res), pre });
    // "as expected" only when the failures are exactly the ones expected before stage 0b, for the reason written there
    const expected = m.server.before && fails.length ? JSON.stringify([...fails].sort()) === JSON.stringify([...m.server.before.fails].sort()) : null;
    rows.push({ id: m.id, group: m.group, who: m.who, model: 'מדומה', how: 'שרת', reply: res.reply, fails, expected, why: m.server.before?.why });
  }
  return rows;
}

/* ---- in a row (cache run, scenario): regular calls through the proxy; the variable block of each is kept ---- */
async function inARow(h, mdl, steps, kind, what) {
  mdl.st.mode = kind === 'אמיתי' ? { kind: 'proxy', run: label, what: () => what } : { kind: 'fake' };
  const rows = [];
  let prevBlock = null;
  for (const s of steps) {
    // the local server sometimes drops a connection: start it again, keep the house as it is (the run goes on from here)
    const once = async () => { const x = await send(h, mdl, s, s.body || { text: s.text }, s.who); if (s.apply) await apply(h, s.who, x.res); return x; };
    const { res, calls } = await once().catch(async (e) => {
      if (!/fetch failed/.test(e.message)) throw e;
      process.stderr.write(`! ${s.name || s.text}: the local server dropped the connection, restarting it (the house stays) and sending again\n`);
      await h.restart(h.clock); return once();
    });
    const c = context(h, s.who, res, calls.at(-1));
    // 0e: the cached parts after the instructions (part 2, the house; part 3, the catalog): a change here is a cache rewrite
    const sys = calls[0]?.body?.system;
    const block = sys ? sys.filter((b, k) => k > 0 && b.cache_control).map((b) => b.text).join('\n\n=== part ===\n\n') : null;
    rows.push({
      step: s.name || s.text || s.body?.text, who: s.who, model: kind, how: 'רגיל', calls: calls.map((x) => ({ usage: x.response?.usage, ms: x.ms, cost: x.cost || 0, error: x.error })),
      blockChanged: prevBlock === null ? null : block !== prevBlock, blockDiff: prevBlock && block && block !== prevBlock ? diff(prevBlock, block) : [],
      reply: c.reply, lines: c.lines, fails: await runCheck(s.check || (() => []), c),
    });
    if (block !== null) prevBlock = block;
  }
  return rows;
}
const diff = (a, b) => { const A = new Set(a.split('\n')), B = new Set(b.split('\n')); return [...[...A].filter((l) => !B.has(l)).map((l) => `- ${l}`), ...[...B].filter((l) => !A.has(l)).map((l) => `+ ${l}`)].slice(0, 20); };
const cacheSteps = () => CACHE.run.map((id) => { const m = SET.find((x) => x.id === id); return { who: m.who, body: m.body, apply: true, name: `#${id}` }; });
/** The control: one captured request, byte for byte the same, sent twice straight to Anthropic (no server in between). */
async function control(real) {
  const req = load('requests.json')[CACHE.control]; if (!req) throw new Error('run capture first');
  const rows = [];
  for (const n of [1, 2]) {
    const close = real ? ledgerOpen(label, `ביקורת המטמון ${n} (#${CACHE.control})`, req.model, await high(req)) : null;
    const t0 = Date.now();
    const out = real ? JSON.parse(await anthropic('/v1/messages', req)) : { usage: { input_tokens: 0, output_tokens: 0 } };
    const call = { usage: out.usage, ms: real ? Date.now() - t0 : undefined, cost: real ? close(out.usage) : 0 };
    rows.push({ step: `ביקורת ${n}: אותה בקשה (#${CACHE.control}), בלי השרת`, who: '—', model: real ? 'אמיתי' : 'מדומה', how: 'רגיל', calls: [call], blockChanged: n === 1 ? null : false, blockDiff: [], reply: '', lines: '', fails: [] });
  }
  return rows;
}

/* ---- Batch ---- */
async function batch() {
  const reqs = load('requests.json'); if (!reqs) throw new Error('run capture first');
  const requests = REAL.filter((m) => reqs[m.id]).flatMap((m) => Array.from({ length: runsOf(m) }, (_, i) => ({ custom_id: cid(m, i + 1), params: reqs[m.id] })));
  // a batch already sent for this label is picked up again, never sent twice (a dropped connection, a restart)
  let b = load('batch.json');
  if (b?.done) { console.log(`batch ${b.id}: its answers are in already (batch-results.json); nothing written again`); return; }
  if (b?.id) console.log(`batch ${b.id}: already sent, waiting for it`);
  else {
    // in the ledger before it goes out, at the high estimate (the file's rule; the cap counts it while it is out)
    // a send that broke before the batch had an id may still have gone out: its open row stays, and this one gets its own
    // (counting too much is allowed, too little never; the owner 03/10)
    ledgerOpen(label, `Batch (${requests.length} בקשות), נשלח`, requests[0].params.model, load('estimate.json').batch.max);
    const row = /\[[^\]]+\]/.exec(readFileSync(LEDGER_FILE(), 'utf8').trim().split('\n').at(-1))[0];
    save('batch.json', { ledgerRow: row });
    b = { id: JSON.parse(await anthropic('/v1/messages/batches', { requests })).id, ledgerRow: row }; save('batch.json', b); console.log(`batch ${b.id}: ${requests.length} requests sent (real model)`);
  }
  let st;
  for (;;) {
    try { st = JSON.parse(await anthropic(`/v1/messages/batches/${b.id}`, null, 'GET')); if (st.processing_status === 'ended') break; } catch (e) { console.log(`status check failed (${e.cause?.code || e.message}), trying again`); }
    await new Promise((r) => setTimeout(r, 30e3));
  }
  if (new URL(st.results_url).origin !== new URL(process.env.MEASURE_API || 'https://api.anthropic.com').origin) throw new Error('results_url is not Anthropic: the key is not sent there');
  // a failed fetch of the results throws: the batch is not marked done, and a run again collects them
  const lines = (await fetch(st.results_url, { headers: { 'x-api-key': key(), 'anthropic-version': '2023-06-01' } }).then((r) => { if (!r.ok) throw new Error(`results: ${r.status}`); return r.text(); })).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const results = {};
  for (const l of lines) {
    if (l.result.type !== 'succeeded') { console.log(`${l.custom_id}: ${l.result.type} ${l.result.error?.error?.type || ''}`); continue; }
    results[l.custom_id] = l.result.message;
    ledger(label, `Batch ${l.custom_id}`, l.result.message.model, l.result.message.usage, true);
  }
  // every request answered: its rows by usage take the open row's place. A batch that failed or came back in part keeps
  // the open row at the high estimate too, so the ledger never counts less than was spent (the owner 03/10)
  if (b.ledgerRow && Object.keys(results).length === requests.length) ledgerDrop(b.ledgerRow);
  else if (b.ledgerRow) console.log(`${requests.length - Object.keys(results).length} of ${requests.length} not answered: the open row ${b.ledgerRow} stays at the high estimate`);
  save('batch-results.json', results); save('batch.json', { ...b, done: true }); // a run again writes nothing twice
  console.log(`${Object.keys(results).length}/${requests.length} answered; spent so far $${spent().toFixed(2)}`);
  stopIfOver();
}

/* ---- seq: the same requests one after another through the regular Messages API (the owner 07/10: no more Batch) ---- */
// The captured requests already mark the tools and instructions for the cache (system[0] in worker/shuki.js), so each goes
// as it is, byte for byte (replay finds its answer by the request's hash): the first writes the cache, every one after it
// reads it. Each call is in the ledger before it goes out, at the high estimate, and corrected by its usage; a call that
// could take it over a cap is not sent. Answers are saved as they come, so a run again after a stop sends only the rest.
async function sequential() {
  const reqs = load('requests.json'); if (!reqs) throw new Error('run capture first');
  const todo = REAL.filter((m) => reqs[m.id]).flatMap((m) => Array.from({ length: runsOf(m) }, (_, i) => ({ id: cid(m, i + 1), params: reqs[m.id] })));
  const results = load('seq-results.json', {}), sent = load('seq-sent.json', {});
  let n = 0;
  for (const { id, params } of todo) {
    const hash = sha(JSON.stringify(params));
    if (results[id] && sent[id] === hash) continue; // answered already, to this very request: never sent twice
    const max = await high(params);
    guard(max); // the next call could take stage 0 or this measurement over its cap: stop before it goes out
    const close = ledgerOpen(label, `seq ${id}`, params.model, max);
    const t0 = Date.now();
    const out = JSON.parse(await anthropic('/v1/messages', params)); // a call that fails keeps its open row (never counts less)
    results[id] = out; sent[id] = hash; n++;
    save('seq-ms.json', { ...load('seq-ms.json', {}), [id]: Date.now() - t0 }); // the model's time, as the server waits for it (no streaming)
    save('seq-results.json', results); save('seq-sent.json', sent);
    close(out.usage); // by usage; past the measurement's cap it stops here
    console.log(`${id}: cache write ${out.usage?.cache_creation_input_tokens || 0}, read ${out.usage?.cache_read_input_tokens || 0}`);
  }
  console.log(`${n} sent one after another, ${todo.length - n} answered before; spent so far $${spent().toFixed(2)}`);
}

/* ---- estimate: count_tokens (free) on each captured request ---- */
async function estimateAll() {
  const reqs = load('requests.json'); if (!reqs) throw new Error('run capture first');
  let min = 0, max = 0, seqMin = 0, seqMax = 0, seqN = 0; const per = {};
  const first = reqs[REAL.find((m) => reqs[m.id])?.id]; // stage 0: #1
  const prefix = JSON.parse(await anthropic('/v1/messages/count_tokens', { model: first.model, tools: first.tools, tool_choice: first.tool_choice, system: first.system.slice(0, 1), messages: [{ role: 'user', content: 'x' }] })).input_tokens;
  for (const m of REAL) {
    const r = reqs[m.id]; if (!r) continue; // answered by the server, no model
    const n = JSON.parse(await anthropic('/v1/messages/count_tokens', { model: r.model, tools: r.tools, tool_choice: r.tool_choice, system: r.system, messages: r.messages })).input_tokens;
    const e = estimate(r.model, n, OUT_TOKENS(m), true, prefix);
    per[m.id] = { tokens: n, runs: runsOf(m) };
    min += e.min * runsOf(m); max += e.max * runsOf(m);
    // seq: regular price; the first call writes the cache, every one after it reads the tools and instructions (max: all
    // of max_tokens out)
    for (let i = 0; i < runsOf(m); i++, seqN++) {
      const u = seqN ? { cache_read_input_tokens: prefix, cache_creation_input_tokens: n - prefix } : { cache_creation_input_tokens: n };
      seqMin += cost(r.model, { ...u, output_tokens: OUT_TOKENS(m) }); seqMax += cost(r.model, { ...u, output_tokens: Math.max(r.max_tokens || 4096, OUT_TOKENS(m)) });
    }
  }
  const avg = Object.values(per).reduce((a, x) => a + x.tokens, 0) / Object.keys(per).length;
  const reg = estimate(first.model, Math.round(avg), 350, false, prefix);
  const rows = SET === STAGE0 ? cacheSteps().length + SCENARIO.length : 0;
  const inRow = { min: reg.min * rows, max: reg.max + reg.min * (rows - 1) + reg.max * 0.5 }; // first call cold; room for a second call
  save('estimate.json', { mode: MODE, prefix, per, batch: { min, max }, seq: { min: seqMin, max: seqMax }, inRow, total: { min: min + inRow.min, max: max + inRow.max } });
  console.log(`count_tokens (free): tools + instructions ${prefix}; a request ${Math.min(...Object.values(per).map((x) => x.tokens))}–${Math.max(...Object.values(per).map((x) => x.tokens))} tokens`);
  console.log(`Batch, ${REAL.filter((m) => reqs[m.id]).reduce((a, m) => a + runsOf(m), 0)} requests (${REAL.filter((m) => !reqs[m.id]).map((m) => `#${m.id}`).join(', ') || 'none'} answered by the server, no model): $${min.toFixed(2)}–$${max.toFixed(2)}`);
  console.log(`seq, the same ${seqN} one after another (1 cache write + ${Math.max(seqN - 1, 0)} cache reads of ${prefix} tokens): $${seqMin.toFixed(2)}–$${seqMax.toFixed(2)}`);
  console.log(`cache run + scenario, ${rows} regular calls: $${inRow.min.toFixed(2)}–$${inRow.max.toFixed(2)}`);
  console.log(`a full run: $${(min + inRow.min).toFixed(2)}–$${(max + inRow.max).toFixed(2)}; spent so far $${spent().toFixed(2)} of $20`);
}

/* ---- report ---- */
const RESULTS = () => process.env.MEASURE_RESULTS || `${ROOT}docs/stage0-results`; // MEASURE_RESULTS: the tool's own tests only
const taken = (dir = RESULTS()) => existsSync(`${dir}/${label}.md`) || existsSync(`${dir}/${label}.json`);
function report() {
  // a second call's request is not kept: it carries the whole house, and with MEASURE_RECIPES the owner's own recipes (15/10)
  const R = { label, at: new Date().toISOString(), batch: load('replay.json', []).map((r) => ({ ...r, second: (r.second || []).map(({ call, ...x }) => x) })), server: load('server.json', []), cache: load('cache.json', []), scenario: load('scenario.json', []) };
  const dir = RESULTS(); mkdirSync(dir, { recursive: true });
  // stage 8: a run's results are never written over by another run under the same label (a new label for every run),
  // and a label with nothing run under it (a new one by mistake) gives no empty report
  if (taken(dir)) throw new Error(`${label}: ${dir.replace(ROOT, '')} has this label already; give the run a new --label`);
  if (!['replay', 'server', 'cache', 'scenario'].some((f) => existsSync(`${W}/${f}.json`))) throw new Error(`${label}: nothing was run under this label (no replay, server, cache or scenario in ${W})`);
  writeFileSync(`${dir}/${label}.json`, JSON.stringify(R, null, 1));
  const $ = (x) => `$${(x || 0).toFixed(4)}`;
  const u = (x) => (x ? `${x.input_tokens || 0} / ${x.cache_creation_input_tokens || 0} / ${x.cache_read_input_tokens || 0} / ${x.output_tokens || 0}` : '—');
  const L = [`# שלב 0: מדידה, "${label}"`, '', `נוצר: ${R.at}. הבית הקבוע, שעון קבוע (${new Date(NOW).toISOString()}).`, ''];
  if (label === 'before') L.push('"לפני": היום אין נוסח קבוע בשרת, אז בבטיחות נמדד רק מה שהמודל כותב לבד.', '');
  L.push('## הודעות בודדות', '', '| # | קבוצה | מי | מודל | איך | ריצה | טוקנים (נכנס / כתיבה / קריאה / יוצא) | עלות | כהודעה רגילה | זמן | עבר | למה נכשל |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of R.batch) L.push(`| ${r.id} | ${r.group} | ${r.who || ''} | ${r.model} | ${r.how} | ${r.run} | ${u(r.usage)} | ${$(r.cost + (r.second || []).reduce((a, x) => a + x.cost, 0))} | ${$(r.regular)} | ${r.modelMs != null ? `${(r.modelMs / 1000).toFixed(1)} + ${((r.serverMs || 0) / 1000).toFixed(1)} שנ'` : '—'} | ${r.fails.length ? '✗' : '✓'}${r.manual ? ' (+ שיפוט)' : ''} | ${[...r.fails, ...(r.gaps || []).map((g) => `פער (לא חוסם): ${g}`)].join('; ')} |`);
  // safety: passes only when all three runs pass
  const safety = [...new Set(R.batch.filter((r) => r.group === 'ה').map((r) => r.id))].map((id) => { const rs = R.batch.filter((r) => r.id === id); return `#${id}: ${rs.filter((r) => !r.fails.length).length}/${rs.length}${rs.every((r) => !r.fails.length) ? ' ✓' : ' ✗'}`; });
  if (safety.length) L.push('', `בטיחות (3 מתוך 3): ${safety.join(' · ')}`);
  // 51: what a scenario does, apart from its safety: a gap is reported, it doesn't fail the run
  const gapIds = [...new Set(R.batch.filter((r) => Array.isArray(r.gaps)).map((r) => r.id))].filter((id) => SET.find((m) => m.id === id)?.gap);
  if (gapIds.length) L.push('', `תפקוד (לא חוסם): ${gapIds.map((id) => { const rs = R.batch.filter((r) => r.id === id); return `#${id}: ${rs.filter((r) => Array.isArray(r.gaps) && !r.gaps.length).length}/${rs.length}`; }).join(' · ')}`); // a row not checked doesn't pass
  // 0b with the real model (the owner 03/10, question 40): who else sees it, on the real answer; 27, 31 and 34 in a table of their own
  const seenRows = R.batch.filter((r) => ['27', '31', '34'].includes(r.id));
  if (seenRows.length) {
    L.push('', '## מי עוד רואה (27, 31, 34), על התשובה האמיתית', '', 'שאלה 40 (03/10) ושער הסוד (04/10): השרת מסמן סוד גם כשהמודל לא סימן, ושומר רק את מה שיכול להיות של הכותב בלבד (worker/secret.js). ב-#34 נבדק רק מה שנוסף אצל מיכל אחרי ההודעה של אבי (server.pre), לא מה שהבית הקבוע כבר הכיל.', '', '| # | ריצה | מי | עבר | מי עוד רואה |', '|---|---|---|---|---|');
    for (const r of seenRows) { const p = r.fails.filter((f) => f.startsWith('privacy: ')).map((f) => f.slice(9)); L.push(`| ${r.id} | ${r.run} | ${r.who || ''} | ${p.length ? '✗' : '✓'} | ${p.join(', ') || 'אף אחד'} |`); }
  }
  L.push('', '## עלות לכל קבוצה (ממוצע להודעה) ומשוקלל', '', '| קבוצה | ממוצע בפועל | ממוצע כהודעה רגילה | משקל |', '|---|---|---|---|');
  let wa = 0, wr = 0, wsum = 0;
  for (const g of Object.keys(WEIGHTS)) {
    const rs = R.batch.filter((r) => r.group === g && r.usage); if (!rs.length) continue;
    const a = rs.reduce((s, r) => s + r.cost, 0) / rs.length, b = rs.reduce((s, r) => s + r.regular, 0) / rs.length;
    wa += a * WEIGHTS[g]; wr += b * WEIGHTS[g]; wsum += WEIGHTS[g];
    L.push(`| ${g} | ${$(a)} | ${$(b)} | ${WEIGHTS[g]}% |`);
  }
  if (wsum) L.push(`| **משוקלל** | **${$(wa / wsum)}** | **${$(wr / wsum)}** | (הנחה, לא מדידה) |`);
  L.push('', '## בשרת (מודל מדומה)', '', '| # | קבוצה | עבר | מה נמצא | למה (לפני 0ב) | כצפוי? |', '|---|---|---|---|---|---|', ...R.server.map((r) => `| ${r.id} | ${r.group} | ${r.fails.length ? '✗' : '✓'} | ${r.fails.join('; ')} | ${r.fails.length ? r.why || '' : ''} | ${r.expected === null ? '' : r.expected ? 'כן, אומת: בדיוק הכשלים הצפויים' : '**לא**: כשלים אחרים מהצפוי'} |`));
  for (const [name, rows] of [['רצף המטמון', R.cache], ['התרחיש "מיכל והחלב"', R.scenario]]) {
    if (!rows.length) continue;
    L.push('', `## ${name} (${rows[0].model}, רגיל)`, '', '| שלב | מי | טוקנים (נכנס / כתיבה / קריאה / יוצא) | עלות | זמן | הבלוק השתנה? | עבר | למה נכשל |', '|---|---|---|---|---|---|---|---|');
    for (const r of rows) L.push(`| ${r.step.split('\n')[0]} | ${r.who} | ${r.calls.map((c) => u(c.usage)).join(' + ') || '— (בלי מודל)'} | ${$(r.calls.reduce((a, c) => a + c.cost, 0))} | ${r.calls.map((c) => (c.ms ? `${c.ms}ms` : '—')).join(' + ')} | ${r.blockChanged === null ? '—' : r.blockChanged ? 'כן' : 'לא'} | ${r.fails.length ? '✗' : '✓'} | ${r.fails.join('; ')} |`);
    const changed = rows.filter((r) => r.blockDiff.length);
    if (changed.length) L.push('', 'מה השתנה בבלוק:', '', ...changed.flatMap((r) => [`- ${r.step.split('\n')[0]}:`, '```', ...r.blockDiff, '```']));
  }
  // notes approved for this report (02/10)
  const seconds = R.batch.filter((r) => (r.second || []).length);
  if (seconds.length) L.push('', '## הערות', '', `- קריאות שניות מהשרת (${seconds.map((r) => `#${r.id}`).join(', ')}): ${seconds.map((r) => $((r.second || []).reduce((a, x) => a + (x.cost || 0), 0))).join(', ')}. ${seconds.some((r) => (r.second || []).some((x) => (x.cost || 0) > 0.05)) ? 'קריאה יקרה כתבה את המטמון מחדש, כי הוא פג בין ה-Batch להרצה החוזרת. זה לא מה שקורה בשימוש אמיתי, ולא ממצא ל-0ה.' : 'במטמון חם, כמו בשימוש אמיתי.'}`);
  const r21 = R.batch.find((r) => r.id === '21');
  const late = r21 && (r21.second || []).find((x) => x.late || x.error);
  if (late) L.push(`- **ממצא (גם ב-main):** קבלה שהשרת שולח לתיקון → "לא הצלחתי לחשוב כרגע". הקריאה השנייה לקחה ${late.ms ? `${Math.round(late.ms / 1000)} שניות` : 'יותר מ-5 דקות (לא חזרה)'}, וה-timeout של השרת הוא 60 שניות (MODEL_TIMEOUT_MS, worker/llm.js).`);
  if (SET === STAGE0) {
    const FOR_INSTR = { 2: 'רשם "10 אריזות ביצים" (120 ביצים) במקום 10, וחשב שהחלב כבר עודכן', 12: 'לא ביטל את הפעולה האחרונה, שאל מה קרה', 18: 'הכפיל את הרסק אבל לא את הפסטה' };
    L.push('', '## ממצאים להוראות (לקיצוץ ההוראות, לא לשלב 0)', '', ...Object.entries(FOR_INSTR).map(([id, what]) => { const r = R.batch.find((x) => x.id === id); return `- #${id}: ${what}. התשובה: "${(r?.reply || '').replace(/\n/g, ' ')}"${r?.lines ? ` · ${r.lines}` : ''}`; }));
    const sc1 = R.scenario[0];
    if (sc1?.fails.length) L.push(`- התרחיש, שלב 1: הכפתורים בלי שם מלא (צריך "חלב 3%", "חלב 1%", "חלב סויה": 166 כלל 41, הכרעה של the owner 02/10). התשובה: "${sc1.reply}"`);
    // what the server does, not the model (02/10): "תזכור ש…" is saved at once, and the server answers only "סגור, אזכור!"
    const r10 = R.batch.find((x) => x.id === '10'), sc3 = R.scenario[2];
    if (r10?.fails.some((f) => /what it remembered/.test(f)) || sc3?.fails.some((f) => /what it remembered/.test(f))) L.push('', '## ממצאים לשרת', '', `- #10 והתרחיש, שלב 3: "תזכור ש…" נשמר מיד (כמו שצריך), אבל השרת עונה רק "סגור, אזכור!" ומוריד את המילים של המודל על מה שזכר, אז שוקי לא אומר מה זכר (worker/shuki.js, המסלול "they asked for it in so many words"). התשובות: "${r10?.reply || ''}" / "${sc3?.reply || ''}". התיקון צריך נוסח: טיוטה ב-docs/stage0-0b-proposal.md.`);
  }
  L.push('', `הוצאה עד עכשיו בכל שלב 0: $${spent().toFixed(2)} מתוך $20 (docs/stage0-spend.md, כולל קריאות "לא ודאי" בהערכה הגבוהה).`);
  writeFileSync(`${dir}/${label}.md`, `${L.join('\n')}\n`);
  console.log(`${dir.replace(ROOT, '')}/${label}.md`);
}

/* ---- main ---- */
const needsServer = ['selftest', 'capture', 'replay', 'server', 'cache', 'scenario'].includes(step);
const needsReal = ['batch', 'seq', 'cache', 'scenario'].includes(step);
if (!step || !['selftest', 'capture', 'estimate', 'batch', 'seq', 'replay', 'server', 'cache', 'scenario', 'report'].includes(step)) { console.log('usage: node tools/measure/run.mjs <selftest|capture|estimate|batch|seq|replay|server|cache|scenario|report> [--label before] [--approved]'); process.exit(1); }
// r9z (12/10), after s9-fix1 (stage 0's whole set ran under a stage 9 label with no cap: in zsh `env $E` passed the
// variables as one): no call to Anthropic in any set without MEASURE_CAP, MEASURE_BASE and a --label of its own that
// nothing ran under yet (not in docs/stage0-results, not in the ledger). Stopped here, before the first call
const callsModel = ['estimate', 'batch', 'seq', 'cache', 'scenario'].includes(step) || (step === 'replay' && approved);
if (callsModel) {
  const num = (v) => v != null && String(v).trim() !== '' && Number.isFinite(Number(v));
  if (!num(process.env.MEASURE_CAP) || !num(process.env.MEASURE_BASE)) { console.error(`${step} calls the model: MEASURE_CAP and MEASURE_BASE first, on the command line itself (MEASURE_CAP=4.5 MEASURE_BASE=13.70 SET=… node tools/measure/run.mjs …)`); process.exit(2); }
  if (!args.includes('--label') || !label || label.startsWith('--')) { console.error(`${step} calls the model: every run needs its own --label`); process.exit(2); }
  const ran = existsSync(LEDGER_FILE()) && readFileSync(LEDGER_FILE(), 'utf8').split('\n').some((l) => l.startsWith(`| ${label} |`));
  // the same run going on is not a new one: a batch collecting its answers, seq sending the rest after a call failed (its own
  // files in the label's folder; seq-sent.json is written after its first answer, so a seq whose first call failed needs a new
  // label). Stage 0's cache and scenario under a label something already ran under need a new label too, on purpose
  const goingOn = (step === 'batch' && existsSync(`${W}/batch.json`)) || (step === 'seq' && existsSync(`${W}/seq-sent.json`));
  if (['estimate', 'batch', 'seq', 'cache', 'scenario'].includes(step) && (taken() || (ran && !goingOn))) { console.error(`${label}: something ran under this label already; give the run a new --label`); process.exit(2); }
}
// a new capture under a label the ledger has: seq would send the new requests as the old run going on (the review of 64ea414)
if (step === 'capture' && existsSync(LEDGER_FILE()) && readFileSync(LEDGER_FILE(), 'utf8').split('\n').some((l) => l.startsWith(`| ${label} |`))) { console.error(`${label}: something ran under this label already; capture under a new --label`); process.exit(2); }
if (SET !== STAGE0 && ['cache', 'scenario'].includes(step)) { console.log(`${step}: only in the stage 0 set`); process.exit(1); }
// stage 8: a label docs/stage0-results has already is refused before anything runs or is spent, not only at report
if (own && ['capture', 'batch', 'seq', 'replay'].includes(step) && taken()) { console.log(`${label}: ${RESULTS().replace(ROOT, '')} has this label already; give the run a new --label`); process.exit(1); }
if (needsReal && !approved) { console.log(`${step} uses the real model: run estimate, get the approval, then add --approved`); process.exit(1); }
// each step is checked against its own part of the estimate (what is already spent is in the ledger): the batch, seq, the
// regular calls of the cache run and the scenario, or the second calls of replay (rare; room for a few)
const est = load('estimate.json');
// the run mode (FULL / RUNS) is the label's: a step run in another mode would send, replay or count other runs
if (est?.mode && est.mode !== MODE && ['batch', 'seq', 'replay'].includes(step)) { console.error(`this label was estimated with ${est.mode}, not ${MODE}: run it the same way`); process.exit(2); }
const PART = { batch: est?.batch?.max, seq: est?.seq?.max, cache: est?.inRow?.max, scenario: est?.inRow?.max, replay: 0.3 };
// a batch already out is counted in the ledger by its open row: collecting its answers is not checked again
const out = step === 'batch' && load('batch.json')?.id;
// seq is checked call by call instead (guard before each one, at that call's high estimate): its upfront high bound counts
// every call as a cache write, so it refused runs that fit by the measured price (the owner 07/10: within $2.5)
if ((needsReal && !out && step !== 'seq') || (step === 'replay' && approved)) guard(PART[step] ?? est?.total?.max ?? 2.5);

let h, mdl;
try {
  if (needsServer) { mdl = await model(8781); h = await house(); h.clock = NOW; }
  if (step === 'selftest') {
    const reqs = await capture(h, mdl);
    // the same request twice from a clean house: the replay depends on it
    await at(h, REAL[0]); const again = (await retry(h, `#${REAL[0].id}`, () => { fresh(h, REAL[0]); return send(h, mdl, REAL[0]); })).calls[0].body;
    console.log(`capture: ${Object.keys(reqs).length} requests; the same request again from a clean house: ${sha(JSON.stringify(again)) === sha(JSON.stringify(reqs[REAL[0].id])) ? 'identical' : 'DIFFERENT'}`);
    const fake = Object.fromEntries(REAL.flatMap((m) => Array.from({ length: runsOf(m) }, (_, i) => [cid(m, i + 1), { content: [{ type: 'tool_use', name: 'respond', input: { reply: 'אני פה!', face: 'happy' } }], usage: { input_tokens: 0, output_tokens: 0 } }])));
    const rows = await replay(h, mdl, fake, 'מדומה');
    const own = rows.filter((r) => r.how === 'בלי מודל');
    console.log(`replay (fake answers): ${rows.filter((r) => r.replayed).length}/${rows.length - own.length} matched the captured request; ${own.length} answered by the server, ${own.filter((r) => !r.fails.length).length} pass their checks`);
    for (const r of own.filter((x) => x.fails.length)) console.log(`  #${r.id} run ${r.run} (server, no model): ${r.fails.join('; ')}`);
    await settle(mdl);
    for (const r of rows) r.second = (r.second || []).map(({ call, ...x }) => (call ? { ...x, ms: call.ms, cost: call.cost || 0, usage: call.response?.usage, error: call.error, late: call.ms > 60000 } : x));
    save('replay.json', rows);
    const srv = await server(h, mdl); save('server.json', srv);
    console.log(`server checks (fake model): ${srv.filter((r) => !r.fails.length).length}/${srv.length} pass`);
    if (SET === STAGE0) {
      h.reset(); save('cache.json', [...(await control(false)), ...(await inARow(h, mdl, cacheSteps(), 'מדומה', 'רצף המטמון'))]);
      h.reset(); save('scenario.json', await inARow(h, mdl, SCENARIO, 'מדומה', 'התרחיש'));
      console.log('cache run and scenario ran (fake model)');
    }
  }
  if (step === 'capture') { const c = await capture(h, mdl); console.log(`captured ${Object.values(c).filter(Boolean).length} requests, ${Object.values(c).filter((x) => !x).length} answered by the server (fake model, no cost)`); }
  if (step === 'estimate') await estimateAll();
  if (step === 'batch') await batch();
  if (step === 'seq') await sequential();
  if (step === 'replay') {
    let rows = await replay(h, mdl, load('batch-results.json', {}), 'אמיתי', load('seq-results.json', {}));
    // ONLY=…: the new rows replace those messages' rows, the rest stay
    if (ONLY) rows = [...load('replay.json', []).filter((r) => !ONLY.includes(r.id)), ...rows].sort((a, b) => SET.findIndex((m) => m.id === a.id) - SET.findIndex((m) => m.id === b.id) || a.run - b.run);
    save('replay.json', rows); console.log(`${rows.filter((r) => !r.fails.length).length}/${rows.length} pass`); }
  if (step === 'server') { const rows = await server(h, mdl); save('server.json', rows); console.log(`${rows.filter((r) => !r.fails.length).length}/${rows.length} pass (fake model)`); }
  // the control is saved as soon as it is done: a run again after a failure later on doesn't pay for it twice
  if (step === 'cache') { const c = load('cache-control.json') || await control(true); save('cache-control.json', c); h.reset(); save('cache.json', [...c, ...(await inARow(h, mdl, cacheSteps(), 'אמיתי', 'רצף המטמון'))]); }
  if (step === 'scenario') { h.reset(); save('scenario.json', await inARow(h, mdl, SCENARIO, 'אמיתי', 'התרחיש')); }
  if (step === 'report') report();
} finally {
  if (mdl) await settle(mdl);
  if (h) await h.stop();
  if (mdl) mdl.close();
}
