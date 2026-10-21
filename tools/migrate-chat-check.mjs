// Stage 0b: before migration 0017 reaches a real house, run it on a COPY and compare counts (docs/stage0-0b-proposal.md
// §2). Never touches the original and never talks to a remote database.
// Run: node --disable-warning=ExperimentalWarning tools/migrate-chat-check.mjs <a copy of the house's sqlite file>
// (a D1 house: export it first, `wrangler d1 export shuki --remote --output house.sql`, load it into a local file, then
// run this on that file; for the Node server it's DB_PATH.)
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, readFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) { console.log('usage: node tools/migrate-chat-check.mjs <house.sqlite>'); process.exit(1); }
const copy = `${src}.0017-check`;
copyFileSync(src, copy);
const db = new DatabaseSync(copy);
const one = (q, ...a) => db.prepare(q).get(...a);
if (one("SELECT COUNT(*) AS n FROM pragma_table_info('chat') WHERE name = 'thread'").n) { console.log('this copy already has chat.thread (0017 ran)'); process.exit(1); }

const before = one('SELECT COUNT(*) AS n FROM chat').n;
// what the rule should do, counted before: the extra copies for `to` with several recipients, and the leavers' rows
const extra = one(`SELECT COALESCE(SUM(json_array_length(content, '$.to') - 1 - (CASE WHEN json_extract(content, '$.notFor') IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(content, '$.to') j WHERE j.key > 0 AND j.value = json_extract(content, '$.notFor')) THEN 1 ELSE 0 END)), 0) AS n
  FROM chat WHERE role != 'user' AND json_extract(content, '$.only') IS NULL AND json_type(content, '$.to') = 'array' AND json_array_length(content, '$.to') > 1`).n;
const proposals = db.prepare("SELECT json_extract(content, '$.proposal.id') AS id, COUNT(*) AS n FROM chat WHERE json_extract(content, '$.proposal.id') IS NOT NULL GROUP BY 1").all();

db.exec(readFileSync(new URL('../migrations/0017_threads.sql', import.meta.url), 'utf8'));

const after = one('SELECT COUNT(*) AS n FROM chat').n;
const left = one("SELECT COUNT(*) AS n FROM chat WHERE migrated IS NULL").n;
const byThread = db.prepare('SELECT thread, COUNT(*) AS n FROM chat GROUP BY thread ORDER BY thread').all();
const leaversLeft = one('SELECT COUNT(*) AS n FROM chat WHERE thread IN (SELECT id FROM users WHERE active = 0)').n;
const lostCards = proposals.filter((p) => !one("SELECT COUNT(*) AS n FROM chat WHERE json_extract(content, '$.proposal.id') = ?", p.id).n);
db.close();

console.log(`before: ${before} rows · copies for several recipients: +${extra} · after: ${after}`);
console.log(`by thread: ${byThread.map((r) => `${r.thread ?? 'הבית'}=${r.n}`).join(', ')}`);
const problems = [
  ...(left ? [`${left} rows not converted`] : []),
  ...(leaversLeft ? [`${leaversLeft} rows of people who left are still there`] : []),
  ...(lostCards.length ? [`${lostCards.length} cards lost`] : []),
  // after = before + copies − the leavers' rows (deleted on purpose, r11 q015)
  ...(after > before + extra ? [`more rows than expected (${after} > ${before + extra})`] : []),
];
console.log(problems.length ? `PROBLEMS: ${problems.join('; ')}` : 'ok: every row has its thread, no card was lost');
console.log(`the copy with 0017 applied: ${copy} (the original is untouched)`);
process.exit(problems.length ? 1 : 0);
