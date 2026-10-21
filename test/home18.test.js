// home18 (the owner's list after home17): rules without a server. Each test fails on 36ccbf9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMissing } from '../worker/domain.js';

const P = (o) => ({ id: 1, name: 'פפריקה מעושנת', aliases: '[]', count_type: 'inuse', qty: 0, level: null, is_open: 0, is_basic: 1, target: 1, pack_size: null, shelf_days: null, expires: null, ...o });

test('ה18-1: מוצר קבוע בשימוש: הפתוח נספר כאחד, כל עוד הוא לא "נשאר מעט" (חצי, רבע)', () => {
  assert.equal(isMissing(P({ is_open: 1, qty: 0 })), false, 'open and full, nothing closed, minimum 1: not on the list');
  assert.equal(isMissing(P({ is_open: 1, qty: 0, level: 'little' })), true, 'open at half or "a little left", nothing closed: on the list');
  assert.equal(isMissing(P({ is_open: 0, qty: 1 })), false, 'the open one ran out, one closed, minimum 1: not on the list (as before)');
  assert.equal(isMissing(P({ is_open: 1, qty: 1, target: 2 })), false, 'minimum 2, open and full and one closed: not on the list');
  assert.equal(isMissing(P({ is_open: 0, qty: 1, target: 2 })), true, 'minimum 2, the open one ran out and one closed: on the list');
  assert.equal(isMissing(P({ is_open: 0, qty: 0 })), true, 'nothing at all: on the list');
  assert.equal(isMissing(P({ is_open: 1, qty: 0, is_basic: 0 })), false, 'not a regular product: never');
});

test('ה18-2: "ב" לפני מקום, בפונקציה אחת: לא לפני מקום שמתחיל במילת יחס', async () => {
  const { inPlace } = await import('../public/hebrew.js');
  assert.equal(inPlace('מעל המקרר'), 'מעל המקרר');
  assert.equal(inPlace('מתחת לכיור'), 'מתחת לכיור');
  assert.equal(inPlace('ליד הדלת'), 'ליד הדלת');
  for (const w of ['על השיש', 'בתוך הארון', 'מאחורי הדלת', 'בין המקרר לקיר']) assert.equal(inPlace(w), w);
  assert.equal(inPlace('ארון מטבח'), 'בארון מטבח');
  assert.equal(inPlace('המרפסת'), 'במרפסת');
  assert.equal(inPlace('מעלית'), 'במעלית', 'a word that only starts like one');
  assert.equal(inPlace('', 'במקום השני'), 'במקום השני');
  const { readFileSync } = await import('node:fs');
  for (const f of ['worker/shuki.js', 'worker/onboarding.js', 'public/app.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/`ב\$\{(locName|n\.replace|p\})/.test(src), `${f} adds "ב" to a place by itself`);
  }
});
