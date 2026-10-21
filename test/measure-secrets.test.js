// Stage 0: what the measurement writes to docs/stage0-results must never hold a key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const dir = new URL('../docs/stage0-results/', import.meta.url);

test('no "sk-ant" in docs/stage0-results or in the spend ledger', () => {
  const files = [...(existsSync(dir) ? readdirSync(dir).map((f) => new URL(f, dir)) : []), new URL('../docs/stage0-spend.md', import.meta.url)].filter((f) => existsSync(f));
  assert.deepEqual(files.filter((f) => readFileSync(f, 'utf8').includes('sk-ant')).map(String), []);
});
