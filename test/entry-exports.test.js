// The Worker's entry module (worker/index.js) may export only what workerd takes as an entrypoint (a function or an object):
// a string there stops the runtime from starting at all (stage 9, מ14's PESACH_END; caught by restart.itest under wrangler).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as entry from '../worker/index.js';

test('worker/index.js exports only functions and objects', () => {
  const bad = Object.entries(entry).filter(([, v]) => !(typeof v === 'function' || (v && typeof v === 'object'))).map(([k]) => k);
  assert.deepEqual(bad, []);
});
