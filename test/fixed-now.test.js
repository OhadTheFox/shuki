// Stage 0: FIXED_NOW freezes the server's clock for measurement only. No deployment config may set it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const workflows = existsSync(new URL('.github/workflows/', root)) ? readdirSync(new URL('.github/workflows/', root)).map((f) => `.github/workflows/${f}`) : [];
const DEPLOY = ['wrangler.toml', 'Dockerfile', 'docker-compose.yml', 'netlify.toml', 'vercel.json', '.dev.vars.example', 'tools/ci-deploy.sh', 'tools/docker-publish.yml', 'tools/publish.sh', ...workflows];

test('FIXED_NOW is not set in any deployment config', () => {
  const found = DEPLOY.filter((f) => existsSync(new URL(f, root)) && readFileSync(new URL(f, root), 'utf8').includes('FIXED_NOW'));
  assert.deepEqual(found, []);
});

test('the deployment configs this check reads still exist', () => {
  for (const f of ['wrangler.toml', 'Dockerfile', 'docker-compose.yml', 'tools/ci-deploy.sh']) assert.ok(existsSync(new URL(f, root)), f);
});
