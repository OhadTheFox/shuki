// wrangler 4.144's local server drops idle keep-alive connections sooner than 4.40 did. A request sent on one that
// was just closed fails with "other side closed" before it reaches the worker, so it is safe to send it once more.
// Imported first by the integration tests.
const f = globalThis.fetch;
globalThis.fetch = async (...a) => {
  try { return await f(...a); } catch (e) {
    if (/other side closed|ECONNRESET|socket hang up/i.test(`${e.cause?.message || ''} ${e.cause?.code || ''}`)) return f(...a);
    throw e;
  }
};
