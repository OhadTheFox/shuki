// 51 (the owner 13/10): a run's guest scenarios again, by safety (blocking) and function (a gap), from what was kept, with no model
// and no server: node tools/measure/resplit.mjs <label> [set]. Prints a table for the report; writes nothing.
// What a row has: the final reply (after the server) and, from 13/10, the answer the checks read (`tool`). Before that, the
// first answer is seq's; a row with a second call from the server has only its final reply and what its checks found then.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { S7, S8, S9 } from './set.mjs';
const SETS = { s7: S7, s8: S8, s9: S9 };
const [label, setName = 's9'] = process.argv.slice(2);
const W = `/tmp/shuki-measure-${label}`, SET = SETS[setName];
const rows = JSON.parse(readFileSync(`${W}/replay.json`, 'utf8'));
const seq = existsSync(`${W}/seq-results.json`) ? JSON.parse(readFileSync(`${W}/seq-results.json`, 'utf8')) : {};
const batch = existsSync(`${W}/batch-results.json`) ? JSON.parse(readFileSync(`${W}/batch-results.json`, 'utf8')) : {}; // run.mjs's fallback
const OLD_SAFETY = /^(a fact or a rule about a guest|a health condition)/, OLD_GAP = /^no guest_food|^no "בלי סוכר"/;
const reqs = JSON.parse(readFileSync(`${W}/requests.json`, 'utf8'));
const sent = existsSync(`${W}/seq-sent.json`) ? JSON.parse(readFileSync(`${W}/seq-sent.json`, 'utf8')) : {};
const sha = (x) => createHash('sha256').update(x).digest('hex');
const out = [];
for (const r of rows) {
  const m = SET.find((x) => x.id === r.id); if (!m?.gap) continue;
  // not a checked answer (no answer, another request): not checked now either
  if (!r.replayed || (r.fails || []).some((f) => /^no answer from|^the server sent a different request/.test(f))) { out.push({ id: r.id, run: r.run, note: (r.fails || []).join('; ') || 'not replayed', safety: null, gap: null }); continue; }
  const key = `m${SET.indexOf(m)}-r${r.run}`; // run.mjs's cid, and only seq's answer to this very request (as run.mjs)
  const ans = sent[key] === sha(JSON.stringify(reqs[m.id])) ? seq[key] : batch[key];
  const first = ans?.content?.find((x) => x.type === 'tool_use')?.input;
  const tool = r.tool ?? (r.second?.length ? null : first);
  const c = { reply: r.reply || '', actions: tool?.actions || [], tool: tool || {}, options: r.options || [], lines: r.lines || [] };
  if (tool) { out.push({ id: r.id, run: r.run, safety: await m.check(c), gap: await m.gap(c), note: '' }); continue; }
  // the second call's answer wasn't kept (or a Batch row): safety from the final reply and the checks of then; function from then
  out.push({ id: r.id, run: r.run, safety: [...(await m.check({ ...c, tool: {}, actions: [] })), ...r.fails.filter((f) => OLD_SAFETY.test(f))], gap: r.fails.filter((f) => OLD_GAP.test(f)),
    note: `${r.second?.length ? 'קריאה שנייה' : 'בלי התשובה עצמה'}: הבטיחות לפי התשובה הסופית והבדיקות של אז (שם אירוח אחר לא נבדק); התפקוד לפי הבדיקות של אז` });
}
const mark = (xs) => (xs == null ? 'לא נבדק' : xs.length ? `✗ ${xs.join('; ')}` : '✓');
console.log('| # | ריצה | בטיחות | תפקוד (לא חוסם) | הערה |\n|---|---|---|---|---|');
for (const x of out) console.log(`| ${x.id} | ${x.run} | ${mark(x.safety)} | ${mark(x.gap)} | ${x.note} |`);
for (const id of [...new Set(out.map((x) => x.id))]) { const rs = out.filter((x) => x.id === id); console.log(`\n#${id}: בטיחות ${rs.filter((x) => x.safety && !x.safety.length).length}/${rs.length}, תפקוד ${rs.filter((x) => x.gap && !x.gap.length).length}/${rs.length}`); }
