// The daily part of the hourly run never waits forever (the owner 03/10): GitHub that doesn't answer, a backup that hangs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUpdate } from '../worker/house.js';
import { dailyRun } from '../worker/index.js';

const never = () => new Promise(() => {});
/** fetch like the real one: it never answers, but stops when its signal is aborted */
const silentFetch = (_url, opts = {}) => new Promise((_, no) => opts.signal?.addEventListener('abort', () => no(opts.signal.reason)));
// the timer holds the process until the race ends (Node 22 cancels the file when only unref'd timers are left: q69), then it goes
const inTime = (p, ms) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error(`still waiting after ${ms}ms`)), ms); })]).finally(() => clearTimeout(t)); };
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

test('checkUpdate: GitHub that never answers → null, in time', async () => {
  const f = globalThis.fetch; globalThis.fetch = silentFetch;
  try { assert.equal(await quiet(() => inTime(checkUpdate({ UPDATE_REPO: 'o/r', DB: {} }, 50), 2000)), null); } finally { globalThis.fetch = f; }
});

test('dailyRun: a backup that never ends → the run goes on without it, in time', async () => {
  const run = dailyRun({ DB: {} }, Date.now(), { dailyBackup: never, checkUpdate: async () => null }, { backup: 50 });
  const daily = await quiet(() => inTime(run, 2000));
  assert.equal(daily.backup, undefined); assert.equal(daily.backupFailed, true);
});

test('dailyRun: a backup that fails → the run goes on without it', async () => {
  const daily = await quiet(() => dailyRun({ DB: {} }, Date.now(), { dailyBackup: async () => { throw new Error('disk'); }, checkUpdate: async () => null }, { backup: 50 }));
  assert.equal(daily.backupFailed, true);
});
