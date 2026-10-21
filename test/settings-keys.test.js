// P60 (stage 9, task 0): every key the server writes to settings has a place on the list of what may leave the server
// (worker/house.js): the state, a person's download (the house's, or their own mark), or never. A new key that isn't on it
// fails here, so it can't go out to everyone by default again (Avi's state had Michal's question waiting for her, with its fact).
// The keys are found here, not listed by hand: each `INTO settings` in worker/, and what its key is built from.
// Run: node --test test/settings-keys.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SECRET_SETTINGS, STATE_SETTINGS, HOUSE_SETTINGS, PERSON_MARKS, FACT_MARKS, PRODUCT_MARKS, HOUSE_MARKS, NEVER_OUT, inDownload, stateSettings } from '../worker/house.js';

const DIR = new URL('../worker/', import.meta.url);
// a key built from something the scan can't read: what it can be
const KNOWN = { '${prov}_key': ['anthropic_key', 'openai_key'], '${t.provider}_key': ['anthropic_key', 'openai_key'] };
// a write whose key comes from a loop: its line, and what the key is (medDone's keys are medKey(x), a few lines above it)
const KNOWN_LINES = [{ file: 'index.js', has: 'for (const k of medDone.keys())', keys: ['med_warned:'] }];

/** The first argument of a call that starts at `i` (just after the opening parenthesis), as written. */
function firstArg(src, i) {
  let depth = 0, q = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (q) {
      if (c === '\\') j++;
      else if (c === q) q = null;
      else if (q === '`' && c === '$' && src[j + 1] === '{') { let d = 1; j += 2; for (; j < src.length && d; j++) { if (src[j] === '{') d++; else if (src[j] === '}') d--; } j--; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') q = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (!depth) return src.slice(i, j).trim(); depth--; }
    else if (c === ',' && !depth) return src.slice(i, j).trim();
  }
  return null;
}
/** A key expression as the key, or its prefix up to the first `${` ("ask:${uid}" → "ask:"). */
function keyOf(expr, src, before = src.length, file = '') {
  if (KNOWN[`${file} ${expr}`]) return KNOWN[`${file} ${expr}`];
  const lit = /^'([^']*)'$/.exec(expr) || /^"([^"]*)"$/.exec(expr);
  if (lit) return [lit[1]];
  if (expr.startsWith('`')) { const body = expr.slice(1, -1); if (KNOWN[body]) return KNOWN[body]; return [body.split('${')[0]]; }
  // a name: its const in the same function, above the write (a value, or an arrow that returns one). Not a parameter of the
  // function, nor a const of another function above it: then the scan can't tell, and says so
  const name = /^([A-Za-z_$][\w$]*)(\(.*\))?$/.exec(expr);
  const fn = [...src.slice(0, before).matchAll(/(?:function\s*[\w$]*\s*\(([^)]*)\)|\(([^()]*)\)\s*=>\s*\{)/g)].at(-1);
  if (name && fn && new RegExp(`(^|[\\s,{(])${name[1].replace('$', '\\$')}([\\s,=})]|$)`).test(fn[1] ?? fn[2] ?? '')) return null;
  if (name) {
    // the nearest definition above the write (a function's own `const key`)
    const defs = [...src.slice(0, before).matchAll(new RegExp(`const ${name[1].replace('$', '\\$')} = (?:\\([^)]*\\)\\s*=>\\s*|[a-z]+\\s*=>\\s*)?([\`'"][^\\n]*)`, 'g'))];
    // a helper (anywhere in the file), the same function, or the module's own
    const def = defs.filter((d) => !fn || name[2] || d.index > fn.index || !d.index || src[d.index - 1] === '\n').at(-1) || (name[2] ? new RegExp(`const ${name[1].replace('$', '\\$')} = (?:\\([^)]*\\)\\s*=>\\s*|[a-z]+\\s*=>\\s*)?([\`'"][^\\n]*)`).exec(src) : null);
    if (def) { const v = def[1]; const end = v[0] === '`' ? v.indexOf('`', 1) : v.indexOf(v[0], 1); return keyOf(v.slice(0, end + 1), src); }
  }
  return null;
}
function writtenKeys(files = readdirSync(DIR).filter((x) => x.endsWith('.js')).map((f) => [f, readFileSync(new URL(f, DIR), 'utf8')])) {
  const out = [], unknown = [];
  for (const [f, src] of files) {
    for (const m of src.matchAll(/INTO settings \(key, value\) (VALUES \(([^)]*)\)|SELECT ([^\n]*))/g)) {
      const at = `${f}:${src.slice(0, m.index).split('\n').length}`;
      const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
      if (/VALUES \([^)]*\)\s*,\s*\(/.test(src.slice(m.index, m.index + 300).split('\n')[0])) { unknown.push(`${at} several rows in one VALUES: one key a write`); continue; }
      const known = KNOWN_LINES.find((k) => k.file === f && line.includes(k.has));
      if (known) { known.keys.forEach((key) => out.push({ key, at })); continue; }
      if (m[3]) { const lit = /'([a-z_]+:)'/.exec(m[3]); (lit ? out.push({ key: lit[1], at }) : unknown.push(at)); continue; }
      const first = m[2].split(',')[0].trim();
      if (first !== '?') { const k = keyOf(first, src, m.index, f); (k ? k.forEach((key) => out.push({ key, at })) : unknown.push(`${at} ${first}`)); continue; }
      const b = src.indexOf('.bind(', m.index);
      const expr = b < 0 ? null : firstArg(src, b + 6);
      const k = expr && keyOf(expr, src, m.index, f);
      if (k) k.forEach((key) => out.push({ key, at })); else unknown.push(`${at} ${expr}`);
    }
  }
  return { out, unknown };
}
const prefix = (key) => (key.includes(':') ? key.split(':')[0] : null);
const placed = (key) => {
  const p = prefix(key);
  if (p == null) return SECRET_SETTINGS.has(key) || STATE_SETTINGS.has(key) || HOUSE_SETTINGS.has(key) || NEVER_OUT.has(key);
  return [PERSON_MARKS, FACT_MARKS, PRODUCT_MARKS, HOUSE_MARKS, NEVER_OUT].some((s) => s.has(p));
};

test('the keys are found, also through a name or a helper', () => {
  const { out } = writtenKeys(); const keys = new Set(out.map((x) => x.key));
  for (const k of ['ask:', 'askq:', 'ask_once:', 'eating:', 'preg_asked:', 'period_done:', 'period_end:', 'lastphoto:', 'pick:', 'tells:', 'pushes:', 'learnask:', 'shabbat_sent:', 'onboard', 'restart', 'catalog_area', 'digest_hour', 'anthropic_key', 'child_chat:']) assert.ok(keys.has(k), k);
});

test('P60: every key the server writes to settings is on the list of what may leave the server, or of what never does', () => {
  const { out, unknown } = writtenKeys();
  assert.ok(out.length > 50, `only ${out.length} writes found`);
  assert.deepEqual(unknown, [], 'writes whose key the scan can\'t read: name it in KNOWN, or build the key where it is written');
  assert.deepEqual(out.filter((x) => !placed(x.key)).map((x) => `${x.at} ${x.key}`), [], 'keys with no place on the list (worker/house.js)');
});

test('the scan says when it can\'t tell: a key that is a parameter, a const of another function, several rows', () => {
  const src = [
    "const KEY = 'onboard';",
    "async function a(db) { const key = `pick:${1}`; await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, '1').run(); }",
    "async function mark(db, key) { await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, '1').run(); }",
    "async function b(db) { await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(KEY, '1').run(); }",
    "async function c(db) { await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, '1').run(); }",
    "async function d(db) { await db.prepare(\"INSERT INTO settings (key, value) VALUES ('x:1', '1'), ('y:1', '1')\").run(); }",
  ].join('\n');
  const { out, unknown } = writtenKeys([['t.js', src]]);
  assert.deepEqual(out.map((x) => `${x.at} ${x.key}`), ['t.js:2 pick:', 't.js:4 onboard']);
  assert.deepEqual(unknown.map((x) => x.split(' ')[0]), ['t.js:3', 't.js:5', 't.js:6']);
});

test('P60: the state carries only the summary hour and my own choice of a child\'s chat', () => {
  const set = { digest_hour: '20', 'child_chat:1:3': '0', 'child_chat:2:3': '1', 'ask:2': '{}', 'askq:2': '[]', 'preg_asked:5': '1', 'period_done:2': '{}', 'lastphoto:2': '{}', catalog_area: 'מקרר', house_notes: 'הכל כשר' };
  assert.deepEqual(stateSettings(set, 1), { digest_hour: '20', 'child_chat:1:3': '0' });
  assert.deepEqual(stateSettings(set, 3), { digest_hour: '20' });
});

test('P60: a download: the house\'s settings and my own marks only', () => {
  const own = { facts: new Set([5]), hidden: new Set([9]) };
  const yes = ['house_notes', 'digest_hour', 'ask:1', 'askq:1', 'ask_once:likes:1', 'ask_once:airfryer:house', 'holiday:1:2026-10-12', 'child_chat:1:3', 'preg_asked:5', 'lowok:7', 'noticed_yes:3'];
  const no = ['anthropic_key', 'vapid', 'ask:2', 'askq:2', 'ask_once:likes:2', 'pick:2:חלב', 'lastphoto:2', 'child_chat:2:3', 'preg_asked:6', 'period_end:6', 'period_done:1', 'eating:1', 'distress:1', 'lowok:9', 'med_warned:9:1', 'onboard', 'something_new', 'new_mark:1'];
  for (const k of yes) assert.ok(inDownload(k, 1, own), `${k} should be in my download`);
  for (const k of no) assert.ok(!inDownload(k, 1, own), `${k} shouldn't be in my download`);
});
