// Every write to the database in one turn of chat() and in applyProposal(), outside execute(), and in the routes that run
// a turn or follow a card's approval (worker/index.js, worker/mcp.js), is listed in
// SECRET_WRITES (worker/secret.js) and marked `// write:<name>` where it happens (the owner 04/10). The writers are found
// here, not listed by hand: a function in worker/ with INSERT / UPDATE / DELETE / REPLACE, or one that calls such a
// function. A new write, or a new helper that writes, called with no mark fails this.
// Run: node --test test/secret-writes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { functions, writers, writeLines, routeLines, blindSpots } from './secret-writes.lib.js';
import { SECRET_WRITES } from '../worker/secret.js';

test('the writers are found, also through a helper', () => {
  const w = writers(functions());
  for (const k of ['shuki.js:saveChat', 'shuki.js:setAsk', 'shuki.js:record', 'recipes.js:countCooked', 'instincts.js:turnedDown', 'instincts.js:notice', 'store.js:execute', 'facts.js:writeFact']) assert.ok(w.has(k), k);
  for (const k of ['secret.js:secretGate', 'secret.js:secretReply', 'facts.js:subjectOf']) assert.ok(!w.has(k), `${k} doesn't write`);
});

test('every write of the turn is marked, with a name from SECRET_WRITES', () => {
  const lines = writeLines();
  assert.ok(lines.length > 50, `only ${lines.length} lines found`);
  const unmarked = lines.filter((x) => !x.mark).map((x) => `worker/shuki.js:${x.line} ${x.calls.join(',')} ${x.text}`);
  assert.deepEqual(unmarked, [], 'writes with no `// write:<name>`');
  const unknown = lines.filter((x) => x.mark && !(x.mark in SECRET_WRITES)).map((x) => `worker/shuki.js:${x.line} write:${x.mark}`);
  assert.deepEqual(unknown, [], 'marks not in SECRET_WRITES');
  const used = [...lines, ...routeLines()];
  const unused = Object.keys(SECRET_WRITES).filter((k) => !used.some((x) => x.mark === k));
  assert.deepEqual(unused, [], 'names in SECRET_WRITES that nothing uses');
});

test('the routes around a turn are marked too: /api/chat, /api/say, ask_shuki (MCP), a card approved (the owner 04/10)', () => {
  const lines = routeLines();
  for (const f of ['index.js', 'mcp.js']) assert.ok(lines.some((x) => x.file === f), `nothing found in ${f}`);
  for (const n of ['setAway', 'startShopping', 'childAsked', 'tellAdminsNoBrain', 'tellShoppers', 'chat']) assert.ok(lines.some((x) => x.calls.includes(n)), `${n} wasn't found in the routes`);
  const unmarked = lines.filter((x) => !x.mark).map((x) => `worker/${x.file}:${x.line} ${x.calls.join(',')} ${x.text}`);
  assert.deepEqual(unmarked, [], 'writes with no `// write:<name>`');
  const unknown = lines.filter((x) => x.mark && !(x.mark in SECRET_WRITES)).map((x) => `worker/${x.file}:${x.line} write:${x.mark}`);
  assert.deepEqual(unknown, [], 'marks not in SECRET_WRITES');
});

test("nothing the scan can't follow: every SQL write in a known function; no default export, import * or import() (the owner 04/10)", () => {
  // the Worker's own entry (Cloudflare needs `export default { fetch }`): its routes are scanned by ROUTES above
  const allowed = (x) => /^index\.js:\d+ export default$/.test(x);
  assert.deepEqual(blindSpots().filter((x) => !allowed(x)), []);
  assert.ok(blindSpots().filter(allowed).length <= 1, 'more than the one default export of the Worker');
});
