// Creates the Web Push key pair once: private JWK -> .vapid-private.json (never committed), prints the public key.
import { webcrypto as c } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
if (existsSync('.vapid-private.json')) { console.error('.vapid-private.json already exists'); process.exit(1); }
const k = await c.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await c.subtle.exportKey('jwk', k.privateKey);
const raw = Buffer.from(await c.subtle.exportKey('raw', k.publicKey));
writeFileSync('.vapid-private.json', JSON.stringify(jwk), { mode: 0o600 });
process.stdout.write(raw.toString('base64url'));
