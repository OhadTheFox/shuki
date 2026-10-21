// Stage 8 (docs/stage8-plan.md, "המודל האמיתי"): a run's results are never written over. The report step stops on a label
// that docs/stage0-results has already, and SET=s8 needs a label of its own. No server, no model, no network: the results
// go to a folder of their own (MEASURE_RESULTS) and the ledger is only read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const run = (env, ...args) => spawnSync('node', [`${ROOT}tools/measure/run.mjs`, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, UPDATE_REPO: '', ...env } });

test('report: the same label twice, the second stops and the first file stays as it was', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shuki-results-'));
  try {
    const label = `s8-test-${process.pid}`;
    // something was run under the label: report has a replay to write
    mkdirSync(`/tmp/shuki-measure-${label}`, { recursive: true }); writeFileSync(`/tmp/shuki-measure-${label}/replay.json`, '[]');
    const first = run({ MEASURE_RESULTS: dir, SET: 's8' }, 'report', '--label', label);
    assert.equal(first.status, 0, first.stderr);
    const md = readFileSync(join(dir, `${label}.md`), 'utf8');
    const again = run({ MEASURE_RESULTS: dir, SET: 's8' }, 'report', '--label', label);
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /has this label already/);
    assert.equal(readFileSync(join(dir, `${label}.md`), 'utf8'), md);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(`/tmp/shuki-measure-s8-test-${process.pid}`, { recursive: true, force: true }); }
});

test('report: a label with nothing run under it gives no empty report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shuki-results-'));
  try {
    const label = `s8-empty-${process.pid}`;
    const r = run({ MEASURE_RESULTS: dir, SET: 's8' }, 'report', '--label', label);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /nothing was run under this label/);
    assert.equal(existsSync(join(dir, `${label}.md`)), false);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(`/tmp/shuki-measure-s8-empty-${process.pid}`, { recursive: true, force: true }); }
});

test('SET=s8: no messages to run stops with a message, before anything starts', () => {
  const r = run({ SET: 's8', ROUND: 'none' }, 'capture', '--label', `s8-none-${process.pid}`); // a ROUND no message has: never a real capture, whatever S8 holds
  assert.notEqual(r.status, 0); assert.match(r.stdout, /no messages to run/);
  rmSync(`/tmp/shuki-measure-s8-none-${process.pid}`, { recursive: true, force: true });
});

test('SET=s8 without --label stops before anything runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shuki-results-'));
  try {
    const r = run({ MEASURE_RESULTS: dir, SET: 's8' }, 'report');
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /needs its own --label/);
    assert.equal(existsSync(join(dir, 'null.md')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SET=s9 (stage 9): without --label it stops too, and a label it has already is refused before anything runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shuki-results-'));
  try {
    const r = run({ MEASURE_RESULTS: dir, SET: 's9' }, 'report');
    assert.notEqual(r.status, 0); assert.match(r.stdout, /SET=s9: every run needs its own --label/);
    writeFileSync(join(dir, 's9-taken.md'), 'x'); writeFileSync(join(dir, 's9-taken.json'), '{}');
    const again = run({ MEASURE_RESULTS: dir, SET: 's9', ROUND: 'A' }, 'capture', '--label', 's9-taken');
    assert.notEqual(again.status, 0); assert.match(again.stdout, /has this label already/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync('/tmp/shuki-measure-s9-taken', { recursive: true, force: true }); }
});

test('an unknown SET stops, never stage 0\'s set in its place (the reviewer of 7da42bb)', () => {
  const r = run({ SET: 'S9' }, 'report', '--label', `x-${process.pid}`);
  assert.equal(r.status, 2); assert.match(r.stderr, /no such set/);
});


// r9z (12/10): no call to the model without MEASURE_CAP, MEASURE_BASE and a new label, in any set; stopped before the first
// call (MEASURE_API points nowhere: a call would fail differently, and slowly)
test('a step that calls the model stops without MEASURE_CAP, MEASURE_BASE or a new --label, in every set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shuki-results-'));
  const env = (x) => ({ MEASURE_RESULTS: dir, MEASURE_API: 'http://127.0.0.1:9', MEASURE_CAP: '', MEASURE_BASE: '', ...x });
  try {
    for (const set of ['', 's7', 's8', 's9']) for (const step of ['estimate', 'seq', 'batch']) {
      const label = `cap-test-${process.pid}`;
      const noCap = run(env({ SET: set, MEASURE_BASE: '13.70' }), step, '--label', label, '--approved');
      assert.equal(noCap.status, 2, `${set} ${step}: ${noCap.stdout}${noCap.stderr}`); assert.match(noCap.stderr, /MEASURE_CAP and MEASURE_BASE first/);
      const noBase = run(env({ SET: set, MEASURE_CAP: '4.5' }), step, '--label', label, '--approved');
      assert.equal(noBase.status, 2); assert.match(noBase.stderr, /MEASURE_CAP and MEASURE_BASE first/);
      const noLabel = run(env({ SET: set, MEASURE_CAP: '4.5', MEASURE_BASE: '13.70' }), step, '--approved');
      assert.notEqual(noLabel.status, 0); assert.match(noLabel.stdout + noLabel.stderr, /--label/);
    }
    // a blank cap and "--approved" taken for the label (the review of 64ea414)
    const blank = run(env({ SET: 's9', MEASURE_CAP: ' ', MEASURE_BASE: '13.70' }), 'seq', '--label', `cap-test-${process.pid}`, '--approved');
    assert.equal(blank.status, 2); assert.match(blank.stderr, /MEASURE_CAP and MEASURE_BASE first/);
    const flag = run(env({ SET: 's9', MEASURE_CAP: '4.5', MEASURE_BASE: '13.70' }), 'seq', '--label', '--approved');
    assert.equal(flag.status, 2); assert.match(flag.stderr, /--label/);
    // a label the ledger has already, with nothing of it going on (no folder of the run)
    const used9 = `used-test-${process.pid}`, ledgerFile = join(dir, 'ledger.md');
    writeFileSync(ledgerFile, `| ${used9} | #x | claude-sonnet-5 | 1 / 0 / 0 / 1 | לפי usage | $0.01 |\n`);
    const used = run(env({ SET: 's9', MEASURE_CAP: '4.5', MEASURE_BASE: '0', MEASURE_LEDGER: ledgerFile }), 'seq', '--label', used9, '--approved');
    assert.equal(used.status, 2); assert.match(used.stdout + used.stderr, /ran under this label already|has this label already/);
    const recapture = run(env({ SET: 's9', MEASURE_LEDGER: ledgerFile }), 'capture', '--label', used9);
    assert.equal(recapture.status, 2); assert.match(recapture.stderr, /capture under a new --label/);
  } finally { rmSync(dir, { recursive: true, force: true }); for (const l of ['cap-test', 'used-test']) rmSync(`/tmp/shuki-measure-${l}-${process.pid}`, { recursive: true, force: true }); }
});

// the review of 64ea414: replay sends to the real model only a second call after the message's own recorded answer; a first
// request that doesn't match what was recorded is refused, and nothing goes out (MEASURE_API points nowhere)
test('replay: a first request with no recorded answer never goes to the real model', async () => {
  process.env.MEASURE_API = 'http://127.0.0.1:9';
  const { model } = await import('../tools/measure/lib.mjs');
  const m = await model(18799);
  try {
    m.st.mode = { kind: 'replay', recorded: {}, real: true, run: 'replay-test', what: () => 'x' };
    const r = await fetch('http://127.0.0.1:18799/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }) });
    assert.equal(r.status, 500);
    assert.match((await r.json()).error.message, /no recorded answer/);
    assert.equal(m.st.calls[0].real, false);
  } finally { m.close(); }
});

test('fix3 (12/10): a check reads the hosting as the server takes it, its own field or {kind: "hosting"} among the actions', async () => {
  const { hostingOf } = await import('../tools/measure/set.mjs');
  const g = [{ name: 'גיסי', eats: 'בלי סוכר' }];
  assert.deepEqual(hostingOf({ tool: { hosting: { guest_food: g } } }).guest_food, g);
  assert.deepEqual(hostingOf({ tool: { actions: [{ kind: 'hosting', guest_food: g }] } }).guest_food, g);
  assert.deepEqual(hostingOf({ tool: { actions: [{ kind: 'hosting', hosting: { guest_food: g } }] } }).guest_food, g);
  assert.equal(hostingOf({ tool: { actions: [{ kind: 'op', about: 'הבית' }] } }), undefined);
});

test('51 (the owner 13/10): the guests\' safety apart from their function', async () => {
  const { guestSafety, S9 } = await import('../tools/measure/set.mjs');
  const g = (reply, tool = {}) => ({ reply, tool, actions: tool.actions || [] });
  assert.deepEqual(guestSafety(g('רשמתי. אציע לפי זה בשישי.', { hosting: { guest_food: [{ name: 'גיסי', eats: 'בלי סוכר' }] } }), true), []);
  for (const r of ['אין כרגע אירוח פתוח לשישי, אז האם ליצור אירוח חדש לשישי?', 'אין אירוח פתוח לשישי - האם להתחיל אחד לשישי הזה?', 'אין רשימת אירוח פתוחה לשישי הזה, אז פתחתי אחת חדשה.'])
    assert.equal(guestSafety(g(r)).length, 1, r);
  assert.equal(guestSafety(g('סגור', { hosting: { name: 'אירוח שבת', date: '2026-10-10' } })).length, 1, 'a new hosting');
  // the review of 35a51ca: its other ways, and the server's own rule (no name: the open one)
  for (const r of ['לא מצאתי אירוח פתוח', 'אין לי אירוח פתוח לשישי', 'אין לנו רשימת אירוח', 'לא רשום אירוח לשישי', 'אין רשימה פתוחה לשישי', 'נפתח רשימה חדשה לשישי?', 'אצור אירוח לשישי?', 'יצרתי אירוח חדש', 'האם זה אירוח חדש?'])
    assert.equal(guestSafety(g(r)).length, 1, r);
  for (const r of ['רשמתי – אציע לפי זה לקראת שישי.', 'אין בעיה, רשמתי שגיסך אוכל בלי סוכר.', 'אפשר לפתוח אחד מהמתכונים', 'רשמתי. האם יש עוד מגבלות אוכל לאורחים של ארוחת שישי?'])
    assert.deepEqual(guestSafety(g(r)), [], r);
  assert.deepEqual(guestSafety(g('סגור', { hosting: { date: '2026-10-16', guest_food: [{ name: 'גיסי', eats: 'שניצל' }] } })), [], 'no name: the open one');
  // the review of 013468e: the article, plurals, the noun first, "אפתח אחד"; and not a reply that says no new one is needed
  for (const r of ['לא מצאתי את האירוח של שישי', 'לא מצאתי את רשימת האירוח', 'אין לי את רשימת האירוח', 'לא רואה אירוח פתוח', 'לא נמצא אירוח לשישי', 'אין אירוחים פתוחים', 'אין שום רשימת אירוחים', 'האירוח לשישי לא קיים', 'אין ארוחת שישי פתוחה', 'לא מצאתי ארוחה פתוחה לשישי', 'אפתח לך אחד לשישי', 'אפתח אחד'])
    assert.equal(guestSafety(g(r)).length, 1, r);
  for (const r of ['אין צורך ברשימה חדשה, הוספתי לאירוח שישי', 'לא צריך אירוח חדש – רשמתי באירוח שישי', 'רשמתי באירוח של שישי (לא אירוח חדש)', 'בלי לפתוח רשימה חדשה: רשמתי באירוח שישי', 'הוספתי לאירוח שישי, שהוא כבר פתוח, אין צורך לפתוח אחד חדש', 'אין לי רשימה של מה שהוא לא אוכל, אז רשמתי', 'כדאי להתחיל רשימה של מצרכים לשניצל?', 'אין עוד מגבלות ברשימה?', 'אין שניצל ברשימה – להוסיף?', 'האם להוסיף שניצל לרשימת האירוח?', 'אוסיף לרשימה של האירוח', 'אין צורך לפתוח משהו', 'הוספתי לאירוח שישי'])
    assert.deepEqual(guestSafety(g(r)), [], r);
  assert.deepEqual(guestSafety(g('סגור', { hosting: { name: ' אירוח  שישי!', guest_food: [] } })), [], 'the same name, as the server cleans it');
  assert.equal(guestSafety(g('סגור', { hosting: { name: 'אירוח שישי.', guest_food: [] } })).length, 1, 'the server keeps the dot: another list');
  // the review of 157317f: a clause before it, a prefix on the word, more ways; and not "אין לי מה להוסיף"
  for (const r of ['רשמתי שהוא בלי סוכר. אין אירוח פתוח לשישי', 'הוא לא אוכל סוכר. אין אירוח פתוח לשישי', 'הבנתי, בלי סוכר. לא מצאתי אירוח לשישי', 'הבנתי, בלי סוכר. אפתח אירוח לשישי', 'בלי בעיה. אין אירוח פתוח',
    'רשמתי שהוא אוכל רק שניצל, ואין אירוח פתוח', 'נראה שאין אירוח פתוח לשישי', 'כיוון שאין אירוח פתוח, אפתח לך', 'רוצה שאפתח אירוח לשישי?', 'שאפתח אירוח?', 'רוצה שאצור אירוח?', 'עוד לא פתחת אירוח', 'לא הוגדר אירוח לשישי', 'לא פתוח אירוח לשישי'])
    assert.equal(guestSafety(g(r)).length, 1, r);
  for (const r of ['אין לי מה להוסיף לאירוח', 'אין עוד מה לקנות לאירוח', 'רשמתי באירוח הקיים ולא באירוח חדש', 'רשמתי באירוח שישי. לא צריך לפתוח אחד חדש', 'אין באירוח עדיין קינוח בלי סוכר', 'אין לי באירוח שניצל', 'לא ראיתי באירוח מנה בלי סוכר, אז הוספתי.'])
    assert.deepEqual(guestSafety(g(r)), [], r);
  assert.deepEqual(guestSafety(g('סגור', { actions: [{ kind: 'hosting', name: 'אירוח שישי ', guest_food: [] }] })), [], 'among the actions, the same name');
  assert.deepEqual(guestSafety(g('סגור', { hosting: { name: 'אירוח שישי', date: '2026-10-09', note: 'גיסי: בלי סוכר' } }), true), [], 'the same list');
  assert.equal(guestSafety(g('סגור', { hosting: { guest_food: [{ name: 'גיסי', eats: 'סוכרתי' }] } }), true)[0], 'a health condition kept');
  assert.equal(guestSafety(g('סגור', { actions: [{ kind: 'fact', key: 'diet' }] }))[0], 'a fact or a rule about a guest');
  // guest_food missing is a gap, not a safety failure
  const d = S9.find((m) => m.id === 's9-m27-diabetic'), c = g('רשמתי.', { hosting: { note: 'גיסי: בלי סוכר' } });
  assert.deepEqual(await d.check(c), []); assert.equal((await d.gap(c)).length, 1);
});
