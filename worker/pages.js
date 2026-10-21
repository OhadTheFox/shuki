// A recipe link sent in the chat (decision 139): Shuki reads the page and offers to save the recipe.
// The page is someone else's text: it goes to the model as data, and the only thing it can lead to is a recipe card.

const MAX_BYTES = 1_500_000, MAX_TEXT = 12_000, TIMEOUT = 8000;
// sites that show a login wall or a video instead of the recipe: Shuki asks for a screenshot instead
export const CLOSED_SITES = /(^|\.)(tiktok\.com|instagram\.com|facebook\.com|fb\.watch|youtube\.com|youtu\.be|threads\.net|x\.com|twitter\.com)$/i;

export const firstUrl = (text) => (String(text || '').match(/https?:\/\/[^\s<>"']+/) || [])[0] || null;

const PRIVATE4 = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^198\.1[89]\./, /^2(2[4-9]|[3-5]\d)\./];
/** Anything that isn't plainly a public address: private, loopback, link-local, and IPv6 forms that wrap an IPv4 one. */
export function isPrivateIp(raw) {
  const ip = String(raw || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return PRIVATE4.some((re) => re.test(ip));
  if (!ip.includes(':')) return true; // not an address we understand
  if (/^(::|::1|0:0:0:0:0:0:0:[01])$/.test(ip) || /^(f[cd]|fe[89ab])/.test(ip)) return true;
  if (/^64:ff9b:/.test(ip) || /^2002:/.test(ip)) return true; // NAT64 and 6to4 carry an IPv4 address inside
  const mapped = /^(?:0*:)*:?ffff:(.+)$/.exec(ip) || /^::(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) {
    const v = mapped[1];
    if (v.includes('.')) return isPrivateIp(v);
    const [hi, lo] = v.split(':').map((h) => parseInt(h || '0', 16));
    return isPrivateIp([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
  }
  return false;
}

/** Only public https pages: no IP addresses, no local names, no ports (the Node server could otherwise reach its own network). */
export function checkUrl(raw) {
  let u; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[') || /\.(local|localhost|internal|lan|home|arpa)$/.test(h) || h === 'localhost') return null;
  return u;
}

/** HTML → the readable text (the recipe's JSON-LD first, when the page has it). */
export function pageText(html) {
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const recipe = /"@type"\s*:\s*"?\[?\s*"Recipe"/.test(ld) ? ld : '';
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return (recipe ? `${recipe.replace(/\s+/g, ' ').slice(0, MAX_TEXT / 2)}\n\n` : '') + body.slice(0, MAX_TEXT - Math.min(recipe.length, MAX_TEXT / 2));
}

/**
 * { text } of a public page, { closed: true } for TikTok and the like, or { error }.
 * env.PAGE_FETCH (the Node server) connects only to the address it checked, so a public name can't lead inside.
 */
export async function readPage(env, raw) {
  const u = checkUrl(raw);
  if (!u) return { error: 'bad url' };
  if (CLOSED_SITES.test(u.hostname)) return { closed: true };
  let url = u;
  for (let hop = 0; hop < 4; hop++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT);
    let res;
    try { res = await (env.PAGE_FETCH || fetch)(url.href, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Shuki recipe reader)', accept: 'text/html' } }); }
    catch { clearTimeout(t); return { error: 'unreachable' }; }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(t);
      const next = checkUrl(new URL(res.headers.get('location'), url).href);
      if (!next) return { error: 'bad redirect' };
      if (CLOSED_SITES.test(next.hostname)) return { closed: true };
      url = next; continue;
    }
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) { clearTimeout(t); return { error: `status ${res.status}` }; }
    // read at most MAX_BYTES
    const reader = res.body.getReader(); const parts = []; let n = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; parts.push(value); if (n > MAX_BYTES) { ctl.abort(); break; } }
    } catch { /* cut off at the limit or by the timeout: use what arrived */ }
    clearTimeout(t);
    const html = new TextDecoder().decode(concat(parts));
    const text = pageText(html);
    return text.length > 200 ? { text, url: url.href } : { error: 'empty' };
  }
  return { error: 'too many redirects' };
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
