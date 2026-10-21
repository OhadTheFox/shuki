// Web Push with WebCrypto only: RFC 8291 (aes128gcm payload encryption) + RFC 8292 (VAPID, ES256).

const enc = new TextEncoder();
const b64u = {
  encode: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); },
};
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Encrypts `payload` for the subscription keys (RFC 8291). Returns the aes128gcm body. */
export async function encryptPayload(payload, p256dhB64, authB64, { salt = crypto.getRandomValues(new Uint8Array(16)), asKeys } = {}) {
  const uaPublic = b64u.decode(p256dhB64);
  const authSecret = b64u.decode(authB64);
  const as = asKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const plain = concat(enc.encode(payload), new Uint8Array([2])); // last-record delimiter, no padding
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/** VAPID Authorization header value for the push service at `endpoint`. */
export async function vapidAuth(endpoint, { publicKey, privateJwk, subject }) {
  const aud = new URL(endpoint).origin;
  const head = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', { ...privateJwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u.encode(sig)}, k=${publicKey}`;
}

/**
 * Pushes go only to the browsers' push services (security review, A-2): a subscription is written by a device, so its
 * address could point inside the home network or at a cloud metadata service. PUSH_ALLOW adds hosts (a self-hosted
 * push service), comma separated.
 */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|web\.push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com|([a-z0-9-]+\.)*push\.apple\.com)$/i;
export function pushAllowed(endpoint, extra = '') {
  let u; try { u = new URL(endpoint); } catch { return false; }
  const more = String(extra || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (more.includes(u.host.toLowerCase()) || more.includes(u.hostname.toLowerCase())) return true;
  return u.protocol === 'https:' && !u.port && PUSH_HOSTS.test(u.hostname);
}

export async function sendPush(sub, message, vapid) {
  const body = await encryptPayload(JSON.stringify(message), sub.keys.p256dh, sub.keys.auth);
  return fetch(sub.endpoint, {
    method: 'POST',
    redirect: 'manual', // a push service answers, it doesn't send us elsewhere
    signal: AbortSignal.timeout(5000), // and one that doesn't answer doesn't hold up the rest of the house
    headers: {
      Authorization: await vapidAuth(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
}

export { b64u };
