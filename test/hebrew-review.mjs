// Decision 166: a separate reviewer reads what Shuki said in a test (his bubbles and card lines) against
// docs/hebrew-style.md, and lists every line that isn't how an Israeli would say it.
// usage: node test/hebrew-review.mjs <transcript.txt> [out.json]   (ANTHROPIC_API_KEY from the env or .dev.vars)
// Only lines starting with "שוקי:" or "  שורה בכרטיס:" are reviewed. Exit code 1 when anything is found.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [file, outFile] = process.argv.slice(2);
const key = process.env.ANTHROPIC_API_KEY || (existsSync('.dev.vars') && /ANTHROPIC_API_KEY\s*=\s*"?([^"\n]+)/.exec(readFileSync('.dev.vars', 'utf8'))?.[1]);
if (!file || !key) { console.error('usage: node test/hebrew-review.mjs <transcript> [out.json] (needs ANTHROPIC_API_KEY)'); process.exit(2); }
const guide = readFileSync(new URL('../docs/hebrew-style.md', import.meta.url), 'utf8');
const lines = readFileSync(file, 'utf8').split('\n').filter((l) => /^(שוקי:|\s*(שורה בכרטיס|כרטיס):)/.test(l)).map((l) => l.replace(/^\s*(שוקי|שורה בכרטיס|כרטיס):\s*/, '').replace(/\s*\[כפתור קטן: לתקן\]$/, '').trim()).filter(Boolean);
const uniq = [...new Set(lines)];
if (!uniq.length) { console.log('nothing to review'); process.exit(0); }

const tool = {
  name: 'report',
  description: 'Every line that breaks the guide or does not sound like natural Israeli Hebrew.',
  input_schema: { type: 'object', properties: { issues: { type: 'array', items: { type: 'object', properties: { line: { type: 'string' }, problem: { type: 'string' }, better: { type: 'string' }, rule: { type: 'integer' } }, required: ['line', 'problem', 'better'] } } }, required: ['issues'] },
};
const system = `אתה עורך לשון ישראלי קפדן. לפניך מדריך הסגנון של רובוט בשם שוקי, ואחריו שורות שהוא כתב באפליקציה.
מצא כל שורה שיש בה טעות דקדוק, מילה פנימית, ניסוח רובוטי או מתורגם, או משהו שישראלי לא היה כותב בהודעה לבן בית.
אל תסמן שורה תקינה. אל תסמן העדפה סגנונית קטנה כשהשורה טבעית. לכל בעיה: השורה, מה הבעיה, ניסוח טוב יותר, ומספר הכלל.

${guide}`;
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({ model: process.env.REVIEW_MODEL || 'claude-sonnet-5', max_tokens: 4000, system, tools: [tool], tool_choice: { type: 'tool', name: 'report' }, messages: [{ role: 'user', content: uniq.map((l, i) => `${i + 1}. ${l}`).join('\n') }] }),
});
const j = await res.json();
if (!res.ok) { console.error('review failed:', res.status, JSON.stringify(j).slice(0, 300)); process.exit(2); }
const issues = j.content?.find((c) => c.type === 'tool_use')?.input?.issues || [];
console.log(`Hebrew review: ${uniq.length} lines, ${issues.length} issues (tokens in ${j.usage?.input_tokens}, out ${j.usage?.output_tokens})`);
for (const x of issues) console.log(`- "${x.line}"\n  ${x.problem}${x.rule ? ` (כלל ${x.rule})` : ''}\n  → ${x.better}`);
if (outFile) writeFileSync(outFile, JSON.stringify({ lines: uniq.length, issues, usage: j.usage }, null, 1));
process.exit(issues.length ? 1 : 0);
