// Real model, empty house, first use. Prints every turn with the raw actions. BASE=http://127.0.0.1:8790
import { execSync } from 'node:child_process';
const base = 'http://127.0.0.1:8790';
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); try { return JSON.parse(x); } catch { return x; } };
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to /tmp/shuki-real --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
const avi = (await call(null, 'POST', '/api/pair', { code: '111111' })).token;
const script = JSON.parse(process.env.TURNS);
for (const [text, verb] of script) {
  const r = await call(avi, 'POST', '/api/chat', { text });
  const raw = r.proposal ? JSON.parse(d1(`SELECT actions FROM proposals WHERE id = '${r.proposal.id}'`)[0].actions).actions : [];
  console.log(`\n> ${text}\n< ${r.reply}${r.options?.length ? `\n  [${r.options.join(' | ')}]` : ''}${(r.proposal?.lines || []).map((l, i) => `\n  • ${l.text}${l.detail ? ` (${l.detail})` : ''}\n      ${JSON.stringify(raw[i]).slice(0, 260)}`).join('')}`);
  if (r.proposal && verb) { const a = await call(avi, 'POST', `/api/proposals/${r.proposal.id}/${verb}`, {}); console.log(`  → ${verb}: ${a.status}${a.error ? ' ' + a.error : ''}`); }
}
const s = await call(avi, 'GET', '/api/state');
console.log('\nSTATE: ' + s.products.map((p) => `${p.name}[${p.count_type}${p.is_basic ? ',בסיס' : ''}] ${p.text}${p.out ? ' OUT' : ''}${p.missing ? ' MISSING' : ''}`).join('\n       '));
console.log('LIST: ' + s.list.map((i) => `${i.product_id ? s.products.find((p) => p.id === i.product_id)?.name : i.text}(${i.status})`).join(', '));
