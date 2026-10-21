#!/usr/bin/env node
// Stage 11 (i2): imports a file of recipes into a house, one by one, through POST /api/recipes. No model, no photos, and
// the file is never changed. The server cleans and cuts as it always does; --dry-run checks only what the server turns away
// (no name, no ingredients), the same recipe twice (in the house or earlier in the file) and the house's own categories,
// all by the rules in public/recipes.js (decision i0 ב, 15/10).
//
//   SHUKI_URL=https://… node tools/import-recipes.mjs <file> [--dry-run] [--only=<number or name>] [--delay=<ms>] [--fresh] [--pair=<code>]
//
// The token: SHUKI_TOKEN (the local house and the tests), or --pair=<code> (a code you made for yourself in the app): the
// tool pairs as "ייבוא מתכונים", keeps the token in this process only, and logs out at the end, also after an error, Ctrl-C
// or a signal. The token is never printed and never written. After a fall the run goes on from where it stopped: the
// progress file sits next to the imported file (<file>.progress-<host>-<port>.json), and the server's "same recipe" answer
// is the safety net.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { sameRecipe, categoriesOf, CATEGORIES, norm } from '../public/recipes.js';

const args = process.argv.slice(2);
const flag = (k) => { const a = args.find((x) => x === `--${k}` || x.startsWith(`--${k}=`)); return a == null ? null : a.includes('=') ? a.slice(a.indexOf('=') + 1) : true; };
const FILE = args.find((x) => !x.startsWith('--'));
const DRY = !!flag('dry-run'), FRESH = !!flag('fresh'), ONLY = flag('only'), PAIR = flag('pair');
const DELAY = Number(flag('delay') ?? process.env.SHUKI_DELAY_MS ?? 500) || 0;
const RETRY = Number(process.env.SHUKI_RETRY_MS ?? 1000); // the tests make it short: 1, 3 and 9 times this
const say = (s) => console.log(s);
const quit = (s, rc) => { if (s) say(s); process.exit(rc); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!FILE) quit('שימוש: node tools/import-recipes.mjs <קובץ> [--dry-run] [--only=<מספר או שם>] [--delay=<ms>] [--fresh] [--pair=<קוד>]', 2);
let recipes;
try { recipes = JSON.parse(readFileSync(FILE, 'utf8')); } catch { recipes = null; }
if (!Array.isArray(recipes)) quit('הקובץ לא נקרא: צריך להיות בו מערך של מתכונים.', 2);

// the address: https, or http only to this computer (by the parsed host, not by how the string starts)
const BASE = process.env.SHUKI_URL || null;
let url = null;
if (BASE) {
  try { url = new URL(BASE); } catch { url = null; }
  const local = url && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!url || !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) quit('SHUKI_URL חייב להתחיל ב-https:// (או http:// רק למחשב הזה).', 2);
}
if (!DRY && !url) quit('SHUKI_URL חייב להתחיל ב-https:// (או http:// רק למחשב הזה).', 2);

// which recipes: all, or one (--only): a number is its place in the file, from 1; a name, by norm
let picked = recipes.map((x, k) => k + 1);
if (ONLY === true || ONLY === '') quit('אין מתכון כזה בקובץ.', 2);
if (ONLY != null) {
  if (/^\d+$/.test(ONLY)) picked = Number(ONLY) >= 1 && Number(ONLY) <= recipes.length ? [Number(ONLY)] : [];
  else {
    picked = recipes.map((x, k) => (norm(x?.name) === norm(ONLY) ? k + 1 : 0)).filter(Boolean);
    if (picked.length > 1) quit(`יש שני מתכונים בשם הזה: #${picked[0]} ו-#${picked[1]}. איזה מהם? אפשר לכתוב --only=<מספר>.`, 2);
  }
  if (!picked.length) quit('אין מתכון כזה בקובץ.', 2);
}

const nameOf = (x) => String(x?.name || '').trim();
/** What the server answers 400 for (worker/index.js, POST /api/recipes): no name, or no ingredients. */
const problem = (x) => (!nameOf(x) ? 'name' : !(Array.isArray(x.ings) ? x.ings.length : String(x.ingredients || '').trim()) ? 'ingredients' : null);
const WHY = { name: 'אין שם', ingredients: 'אין מצרכים' };

/* ---- the server: the token in memory only ---- */
let token = process.env.SHUKI_TOKEN || null;
let paired = false;
const ask = async (method, path, body) => {
  const r = await fetch(new URL(path, url), { signal: AbortSignal.timeout(30000), method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
/**
 * A call that goes on trying: three more times (1, 3 and 9 × RETRY ms) on the network, a 5xx, a 429 or 30 seconds with no answer.
 * null = no answer. `retried`: an earlier try may have reached the server, and only its answer was lost.
 */
async function tryHard(method, path, body) {
  for (let k = 0; k < 4; k++) {
    if (k) await sleep(RETRY * 3 ** (k - 1));
    try { const r = await ask(method, path, body); if (r.status < 500 && r.status !== 429) return { ...r, retried: k > 0 }; } catch { /* the network: try again */ } // 429: busy, try again too
  }
  return null;
}
// the device "ייבוא מתכונים" goes at the end, whatever ends the run: the pairing may still be on its way when a signal comes
let pairing = null, out = null, signalled = null;
const logout = () => (out ||= (async () => {
  if (pairing) await pairing.catch(() => {});
  if (paired) try { await ask('POST', '/api/logout', {}); } catch { /* the device stays: it's disconnected from the phones list in the app */ }
})());
// a second signal: out at once (the logout may be waiting for a slow pairing)
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) process.on(sig, () => { if (signalled) process.exit(code); signalled = code; logout().finally(() => process.exit(code)); });

const counts = { in: 0, house: 0, file: 0, rejected: 0, net: 0 };
const lists = { house: [], file: [], rejected: [], net: [] };
const houseCats = new Map();
const line = (n, x, why) => `  #${n}${nameOf(x) ? ` ${nameOf(x)}` : ''}${why ? `: ${why}` : ''}`;
function report() {
  say(`${DRY ? 'ייכנסו' : 'נכנסו'}: ${counts.in}`); // question 12: the dry run in the future
  say(`כבר בבית: ${counts.house}`);
  say(`כפולים בקובץ: ${counts.file}`);
  say(`${DRY ? 'יידחו' : 'נדחו'}: ${counts.rejected}`);
  say(`שגיאות רשת: ${counts.net}`);
  if (houseCats.size) say(`קטגוריות של הבית: ${[...houseCats].map(([c, n]) => `${c} (${n})`).join(', ')}`);
  for (const [k, title] of [['house', 'כבר בבית'], ['file', 'כפולים בקובץ'], ['rejected', DRY ? 'יידחו' : 'נדחו'], ['net', 'שגיאות רשת']]) if (lists[k].length) { say(`\n${title}:`); lists[k].forEach((l) => say(l)); }
}

let rc = 0;
/** Inside the run: stop, and still log out (process.exit would skip the finally). */
class Stop { constructor(msg, code) { this.msg = msg; this.code = code; } }
const stop = (msg, code) => { throw new Stop(msg, code); };
try {
  if (url && PAIR && PAIR !== true) {
    token = null;
    // one try only: a second one after a lost answer would send a used code, and leave the first device with no token
    pairing = ask('POST', '/api/pair', { code: String(PAIR), name: 'ייבוא מתכונים' }).catch(() => null).then((x) => { if (x?.status === 200 && x.data.token) { token = x.data.token; paired = true; } return x; });
    const r = await pairing;
    if (!r) stop('אין קליטה לשרת. עצרתי לפני המתכון הראשון. אפשר להריץ שוב עם קוד חדש.', 1); // one try (question 12 in docs/stage11-report.md)
    if (!paired) stop(r.data.error || `${r.status}`, 3); // the server's own words ("הקוד לא נכון או שהוא כבר לא בתוקף")
  }
  // the house: who I am, and the recipes it has
  let house = [];
  if (url && token) {
    const r = await tryHard('GET', '/api/state');
    if (!r) stop('אין קליטה לשרת אחרי 4 ניסיונות. עצרתי אחרי מתכון 0. אפשר להריץ שוב, ואמשיך מאותו מקום.', 1);
    if (r.status === 401) stop('הטוקן לא מחובר. עצרתי.', 3);
    if (r.status !== 200) stop(r.data.error || `${r.status}`, 3); // not the house: never import blind
    if (r.data.me?.role === 'child') stop('הטוקן של ילד: המתכונים יחכו לאישור, וההורים יקבלו התראה על כל אחד. עצרתי.', 3);
    house = (r.data.recipes || []).map((x) => ({ id: x.id, name: x.name, url: x.url }));
  } else if (!DRY) stop('הטוקן לא מחובר. עצרתי.', 3);

  // the same recipe earlier in the file: what will go in, with its place
  const before = [];
  const fileDup = (x) => sameRecipe(before, { name: nameOf(x), url: x.url || null });
  const countCats = (x) => { for (const c of categoriesOf(x.tags)) if (!CATEGORIES.includes(c)) houseCats.set(c, (houseCats.get(c) || 0) + 1); };

  const only = new Set(picked);
  if (DRY) {
    for (let n = 1; n <= recipes.length; n++) {
      const x = recipes[n - 1];
      const p = problem(x);
      const f = p ? null : fileDup(x);
      if (!p && !f) before.push({ name: nameOf(x), url: x.url || null, n });
      if (!only.has(n)) continue;
      if (p) { counts.rejected++; lists.rejected.push(line(n, x, WHY[p])); continue; }
      if (f) { counts.file++; lists.file.push(line(n, x, `כפול בקובץ, של #${f.n}`)); continue; }
      if (sameRecipe(house, { name: nameOf(x), url: x.url || null })) { counts.house++; lists.house.push(line(n, x)); continue; }
      counts.in++; countCats(x);
    }
    report();
  } else {
    const PROGRESS = `${FILE}.progress-${url.hostname.replace(/[[\]]/g, '')}-${url.port || (url.protocol === 'https:' ? 443 : 80)}.json`;
    let prog = {};
    if (!FRESH && existsSync(PROGRESS)) { try { prog = JSON.parse(readFileSync(PROGRESS, 'utf8')); } catch { prog = {}; } }
    // the newest recipe of the house when this file's import began: recipe ids are the server's clock (newId), so a recipe
    // newer than it that no line of the file is known to have made can only be one whose answer was lost
    if (!(prog._start >= 0)) prog._start = Math.max(0, ...house.map((x) => x.id));
    // every recipe the progress file says is in the house (went in, or was there already) must still be there
    const here = new Set(house.map((x) => x.id));
    const lines = Object.entries(prog).filter(([k]) => /^\d+$/.test(k)).map(([, v]) => v);
    // …and a house whose newest recipe is older than the file's start is another house (a local one made again)
    const gone = lines.map((v) => v?.id || v?.dup).find((id) => id && !here.has(id)) || (house.length && Math.max(...here) < prog._start ? prog._start : null);
    if (gone) stop(`קובץ ההתקדמות לא מתאים לבית הזה (מתכון #${gone} כבר לא שם). אפשר להריץ עם --fresh.`, 4);
    const known = new Set(lines.flatMap((v) => [v?.id, v?.dup]).filter(Boolean));
    const save = () => writeFileSync(PROGRESS, `${JSON.stringify(prog)}\n`);
    let last = 0, first = true;
    for (let n = 1; n <= recipes.length; n++) {
      const x = recipes[n - 1];
      const was = prog[n];
      const f = problem(x) ? null : fileDup(x);
      if (!problem(x) && !f) before.push({ name: nameOf(x), url: x.url || null, n });
      if (!only.has(n)) continue;
      if (was && was !== 'sending') { last = n; continue; } // done in an earlier run
      if (!first && DELAY) await sleep(DELAY);
      first = false;
      prog[n] = 'sending'; save();
      const r = await tryHard('POST', '/api/recipes', { name: x?.name, ings: Array.isArray(x?.ings) ? x.ings.map((i) => ({ qty: i?.qty ?? null, unit: i?.unit ?? null, name: i?.name })) : undefined, ingredients: x?.ingredients, text: x?.text, tags: x?.tags, serves: x?.serves, url: x?.url });
      if (!r) { counts.net++; lists.net.push(line(n, x)); save(); rc = 1; say(`אין קליטה לשרת אחרי 4 ניסיונות. עצרתי אחרי מתכון ${last}. אפשר להריץ שוב, ואמשיך מאותו מקום.`); break; }
      if (r.status === 401) { save(); stop('הטוקן לא מחובר. עצרתי.', 3); }
      if (r.status === 400) { prog[n] = { rejected: r.data.error || 'error' }; counts.rejected++; lists.rejected.push(line(n, x, WHY[r.data.error] || r.data.error)); }
      else if (r.data.id) { prog[n] = { id: r.data.id }; known.add(r.data.id); counts.in++; countCats(x); }
      else if (r.data.dup) {
        // sent before with no answer (an earlier run, or an earlier try of this one), and the recipe it matches is newer than
        // the start and came from no other line: it's this one
        if ((was === 'sending' || r.retried) && r.data.dup > prog._start && !known.has(r.data.dup)) { prog[n] = { id: r.data.dup }; known.add(r.data.dup); counts.in++; countCats(x); }
        else { prog[n] = { dup: r.data.dup }; if (f) { counts.file++; lists.file.push(line(n, x, `כפול בקובץ, של #${f.n}`)); } else { counts.house++; lists.house.push(line(n, x)); } }
      } else if (r.status < 300) { counts.net++; lists.net.push(line(n, x)); save(); rc = 1; say(`אין קליטה לשרת אחרי 4 ניסיונות. עצרתי אחרי מתכון ${last}. אפשר להריץ שוב, ואמשיך מאותו מקום.`); break; } // a 2xx with no recipe in it: as if lost
      else { prog[n] = { rejected: `${r.status}` }; counts.rejected++; lists.rejected.push(line(n, x, `${r.status}`)); } // 403, 413…: this one only
      save(); last = n;
    }
    report();
  }
} catch (e) {
  if (e instanceof Stop) { if (e.msg) say(e.msg); rc = e.code; }
  else { say(e?.message || String(e)); rc = 1; } // never the request itself: the token is in its headers
} finally { await logout(); }
process.exit(signalled ?? rc);
