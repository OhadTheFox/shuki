// Scans the replies Shuki wrote in docs/stage0-results for swear words (read only, no model, no cost).
//   node tools/measure/swear-scan.mjs [results-dir] [out.md]    (defaults: docs/stage0-results, docs/home20-swears.md)
// Shuki's own text only, never the user's message or the prompt sent to the model: per json item the final reply, the tool's reply
// and actions' texts, and the second call's response; the server / cache / scenario lists' replies. fu-a.md has no json: its lines are
// scanned as text. The .txt files (wordings and lines proposed for approval) are scanned apart. A word is a whole token, after
// the prefixes ו ש ב כ ל מ ה (up to three), so "כוסברה" and "מזין" and a bare "כוס" or "תחת" (under) don't count.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] || 'docs/stage0-results';
const OUT = process.argv[3] || 'docs/home20-swears.md';

const P = '[ושבכלמה]{0,3}'; // prefixes
const HE = [
  ['זיין', `^${P}(?:[תינא]?זיי?ינ?|מזדיי?ינ?|זדיי?ינ?|התזיי?ינ?)[א-ת]{0,3}$`],
  ['זין', `^${P}זין$`],
  ['כוס אמק / אמא של', null], // two words, below
  ['כוסאמק', `^${P}כוס-?(?:אמק|אמא|אמ|אמה|אמא-של|אמש)[א-ת]{0,2}$`],
  ['כוסית', `^${P}כוסית[א-ת]{0,2}$`],
  ['כוסון', `^${P}כוסו(?:ן|נת|נים|נות)$`],
  ['שרמוטה', `^${P}שרמוט[א-ת]{0,3}$`],
  ['זונה', `^${P}זונ(?:ה|ות|תי|תו)$`],
  ['חרא', `^${P}חרא(?:ה|ות|י|ים)?$`],
  ['חרבן', `^${P}(?:מ?חורבנ?|חרבנ?)[א-ת]{0,3}$`],
  ['לעזאזל', `^${P}עזאזל$`],
  ['מניאק', `^${P}מניאק[א-ת]{0,3}$`],
  ['תחת (קללה)', `^[הבל]{1,2}תחת(?:ים|ון|ונים)?$`],
  ['פאק', `^${P}פא[קק]ינג$|^${P}פאק$`],
  ['דפוק', `^${P}דפוק(?:ה|ים|ות)$`],
  ['ממזר', `^${P}ממזר[א-ת]{0,3}$`],
  ['בן כלב', null],
  ['לכל הרוחות / לעזאזל', null],
  ['עלבון: אידיוט', `^${P}אידיו[טט](?:ית|ים|ות)?$`],
  ['עלבון: מטומטם', `^${P}מטומטמ[א-ת]{0,3}$`],
  ['עלבון: דביל', `^${P}דביל[א-ת]{0,3}$`],
  ['עלבון: מפגר', `^${P}מפגר[א-ת]{0,3}$`],
  ['עלבון: טיפש', `^${P}טיפש[א-ת]{0,3}$`],
];
const EN = [
  ['fuck', /\b(?:fuck\w*|f\*+k)\b/i], ['shit', /\b(?:shit\w*|bullshit)\b/i], ['damn', /\b(?:damn\w*|goddamn\w*)\b/i],
  ['bitch', /\bbitch\w*\b/i], ['asshole', /\b(?:asshole|arse\w*)\b/i], ['bastard', /\bbastard\w*\b/i], ['crap', /\bcrap\w*\b/i],
  ['dick', /\bdick\w*\b/i], ['hell', /\bhell\b/i], ['wtf', /\bwtf\b/i], ['idiot', /\b(?:idiot\w*|stupid|moron\w*)\b/i],
];
const reHe = HE.filter(([, r]) => r).map(([w, r]) => [w, new RegExp(r)]);

function wordsOf(sentence) {
  const out = [];
  const toks = sentence.split(/[^א-תA-Za-z'*-]+/).map((t) => t.replace(/^-+|-+$/g, '')).filter(Boolean);
  toks.forEach((t, i) => {
    for (const [w, r] of reHe) if (r.test(t) && !(w === 'פאק' && /^צ/.test(toks[i + 1] || ''))) out.push([w, t]); // "פאק צ'וי" is a cabbage
    const nxt = toks[i + 1] || '', nxt2 = toks[i + 2] || '';
    if (/^[ושבכלמה]{0,3}כוס$/.test(t) && /^(?:אמק|אמא|אמה|אמ|אמו|אמכ|אמ[א-ת]?)$/.test(nxt) && nxt.length <= 4) out.push(['כוס אמק / אמא של', `${t} ${nxt}${/^של/.test(nxt2) ? ' ' + nxt2 : ''}`]);
    if (/^[ושבכלמה]{0,3}בן$/.test(t) && /^(?:זונה|כלב|שרמוטה|מניאק)$/.test(nxt)) out.push([`בן ${nxt}`, `${t} ${nxt}`]);
    if (/^לכל$/.test(t) && /^הרוחות$/.test(nxt)) out.push(['לכל הרוחות', `${t} ${nxt}`]);
    if (/^[ושבכלמה]{0,3}(?:ללכת|לך|לכי)$/.test(t) && /^(?:להזדיין|תזדיין|תזדייני|לעזאזל|להתחפף)$/.test(nxt)) out.push(['לך לעזאזל / להזדיין', `${t} ${nxt}`]);
    if (/^הזדיין|^תזדיי?ין|^מזדיי?ין/.test(t)) out.push(['זיין', t]);
  });
  for (const [w, r] of EN) { const m = sentence.match(r); if (m) out.push([w, m[0]]); }
  return out;
}

const sentences = (t) => t.split(/(?<=[.?!…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const clip = (s) => (s.length > 160 ? s.slice(0, 157) + '…' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

const rows = [], scannedTexts = new Set(); let scanned = 0;
const perFile = {};

function scanText(file, label, scenario, run, model, ok, text, src) {
  if (typeof text !== 'string' || !text.trim()) return;
  const key = [file, scenario, run, text].join('\u0000');
  if (scannedTexts.has(key)) { rows.forEach((r) => { if (r.key === key) r.copies++; }); return; } // the same text again in another field of the item (reply and tool.reply)
  scannedTexts.add(key); scanned++;
  perFile[file] = (perFile[file] || 0) + 1;
  for (const s of sentences(text)) for (const [w, tok] of wordsOf(s)) rows.push({ key, copies: 0, file, label, scenario, run, model, ok, sentence: s, word: w, tok, src, text });
}

function shukiTexts(b) { // everything Shuki wrote in one item
  const out = [];
  if (typeof b.reply === 'string') out.push([b.reply, 'reply']);
  const t = b.tool;
  if (t) {
    if (typeof t.reply === 'string') out.push([t.reply, 'tool.reply']);
    for (const a of t.actions || []) for (const k of ['text', 'recipe_text', 'ask_text']) if (typeof a[k] === 'string') out.push([a[k], `tool.actions.${k}`]);
  }
  for (const s of b.second || []) for (const c of s.call?.response?.content || []) {
    const i = c.input; if (!i) continue;
    if (typeof i.reply === 'string') out.push([i.reply, 'second.reply']);
    for (const a of i.actions || []) for (const k of ['text', 'recipe_text', 'ask_text']) if (typeof a[k] === 'string') out.push([a[k], `second.actions.${k}`]);
  }
  return out;
}

const files = readdirSync(DIR).sort();
for (const f of files.filter((x) => x.endsWith('.json'))) {
  let j; try { j = JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch { continue; }
  const label = j.label || f.replace(/\.json$/, '');
  for (const b of j.batch || []) {
    const ok = !(b.fails && b.fails.length);
    for (const [text, src] of shukiTexts(b)) scanText(f, label, `${b.id} (${b.group || ''}, ${b.who || ''})`, b.run ?? '', b.model || '', ok, text, src);
  }
  for (const k of ['server', 'cache', 'scenario']) for (const b of j[k] || []) {
    const ok = !(b.fails && b.fails.length);
    scanText(f, label, `${k}: ${b.step || b.id || ''}${b.who && b.who !== '—' ? ` (${b.who})` : ''}`, '', b.model || '', ok, b.reply, `${k}.reply`);
  }
}

// md without a json: the table lines
for (const f of files.filter((x) => x.endsWith('.md') && !existsSync(join(DIR, x.replace(/\.md$/, '.json'))))) {
  const lines = readFileSync(join(DIR, f), 'utf8').split('\n');
  lines.forEach((l, i) => scanText(f, f.replace(/\.md$/, ''), `שורה ${i + 1}`, '', '', null, l, 'md'));
}

// the proposed wordings (not replies): apart
const txtRows = [];
for (const f of files.filter((x) => x.endsWith('.txt'))) {
  readFileSync(join(DIR, f), 'utf8').split('\n').forEach((l, i) => { for (const s of sentences(l)) for (const [w, tok] of wordsOf(s)) txtRows.push({ file: f, line: i + 1, sentence: s, word: w, tok }); });
}

const count = (arr, k) => { const m = new Map(); arr.forEach((r) => m.set(r[k], (m.get(r[k]) || 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]); };
const items = new Set(rows.map((r) => `${r.file}|${r.scenario}|${r.run}`)); // one reply of one run
const sentencesSet = new Set(rows.map((r) => r.sentence));
const raw = rows.reduce((n, r) => n + 1 + r.copies, 0); // as a plain search for the word in the files finds it
const md = [];
md.push('# home20: קללות בתשובות של שוקי (סריקה, קריאה בלבד)', '');
md.push(`נוצר על ידי \`tools/measure/swear-scan.mjs\` מ-\`${DIR}\`. בלי מודל ובלי עלות. רק הטקסט ששוקי כתב, לא הודעת המשתמש ולא ההנחיות שנשלחו למודל.`, '');
md.push('**איך נקרא כל קובץ:** ב-json: `batch[]` (התשובה `reply`, ב-`tool` ה-`reply` והטקסטים של הפעולות, ובקריאה השנייה `second[]` התשובה והטקסטים), ו-`server[]`, `cache[]`, `scenario[]` (השדה `reply`). קובצי ה-md נוצרים מאותם json ולכן לא נספרו שוב; `fu-a.md` בלי json נסרק שורה שורה. קובצי ה-txt (ניסוחים ושורות שהוצעו לאישור) נסרקו בנפרד, בסוף. מילה נספרת כמילה שלמה אחרי תחיליות (ו ש ב כ ל מ ה), לכן "כוסברה", "מזין", "כוס" לבד ו-"תחת" (במובן "מתחת") לא נספרים.', '');
md.push('## סיכום', '');
md.push(`- קבצי json שנסרקו: ${files.filter((x) => x.endsWith('.json')).length}, קבצי md בלי json: ${files.filter((x) => x.endsWith('.md') && !existsSync(join(DIR, x.replace(/\.md$/, '.json')))).length}, קבצי txt: ${files.filter((x) => x.endsWith('.txt')).length}.`);
md.push(`- **טקסטים של שוקי שנסרקו: ${scanned}** (לפי קובץ, פריט וריצה; אותה תשובה בשני שדות של אותו פריט, \`reply\` ו-\`tool.reply\`, נספרת פעם אחת).`);
md.push(`- **עם קללה: ${items.size} תשובות** (קובץ, תרחיש, ריצה), ${rows.length} שורות בטבלה, ב-${sentencesSet.size} ניסוחים שונים.`);
md.push(`- **ספירה גולמית של המילה בקבצים: ${raw}.** כל תשובה כתובה פעמיים בקובץ (ב-\`reply\` וב-\`tool.reply\`), ולכן חיפוש רגיל של "תזיין" נותן כפול מהתשובות: h18-s8.json ${rows.filter((r) => r.file === 'h18-s8.json').reduce((n, r) => n + 1 + r.copies, 0)}, h19-s8.json ${rows.filter((r) => r.file === 'h19-s8.json').reduce((n, r) => n + 1 + r.copies, 0)}, h20-safe-s8-3.json ${rows.filter((r) => r.file === 'h20-safe-s8-3.json').reduce((n, r) => n + 1 + r.copies, 0)}. קבצי ה-md לא מכילים את הטקסט; מחוץ ל-\`${DIR}\` המילה מופיעה רק בקוד, במבחנים ובציטוטים של אותן ריצות (\`worker/curses.js\`, \`test/curses.test.js\`, \`docs/home20-report.md\`, \`docs/home20-model.md\`), לא בריצות נוספות.`, '');
if (rows.length) {
  md.push('לפי מילה:', '', '| מילה | שורות |', '|---|---|');
  count(rows, 'word').forEach(([w, n]) => md.push(`| ${w} | ${n} |`));
  md.push('', 'לפי תרחיש (קובץ, פריט):', '', '| קובץ | תרחיש | שורות |', '|---|---|---|');
  const m = new Map(); rows.forEach((r) => m.set(`${r.file} | ${r.scenario}`, (m.get(`${r.file} | ${r.scenario}`) || 0) + 1));
  [...m].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => md.push(`| ${k} | ${n} |`));
  const okRows = rows.filter((r) => r.ok === true);
  md.push('', `**תשובות עם קללה שהבדיקה סימנה ✓ (בלי fails): ${new Set(okRows.map((r) => `${r.file}|${r.scenario}|${r.run}`)).size}** (${okRows.length} שורות)` + (okRows.length ? ':' : '.'));
  okRows.forEach((r) => md.push(`- ${r.file} / ${r.scenario} / ${r.word}: ${clip(r.sentence)}`));
  md.push('', '## כל השורות', '', '| קובץ | תווית | תרחיש | ריצה | מודל | בדיקה | המשפט | המילה |', '|---|---|---|---|---|---|---|---|');
  rows.forEach((r) => md.push(`| ${r.file} | ${r.label} | ${r.scenario} | ${r.run} | ${r.model} | ${r.ok === true ? '✓' : r.ok === false ? '✗' : '—'} | ${clip(r.sentence)} | ${r.word}${r.tok !== r.word ? ` (${r.tok})` : ''} |`));
} else md.push('**לא נמצאה אף קללה** בתשובות של שוקי.');
md.push('', '## קובצי txt (ניסוחים שהוצעו, לא תשובות)', '');
if (txtRows.length) { md.push('| קובץ | שורה | המשפט | המילה |', '|---|---|---|---|'); txtRows.forEach((r) => md.push(`| ${r.file} | ${r.line} | ${clip(r.sentence)} | ${r.word} (${r.tok}) |`)); } else md.push('לא נמצאה אף קללה.');
writeFileSync(OUT, md.join('\n') + '\n');
console.log(`scanned ${scanned} texts; ${items.size} replies with a swear (${rows.length} rows, ${sentencesSet.size} sentences, raw ${raw}); txt hits ${txtRows.length}; ok-marked ${rows.filter((r) => r.ok === true).length}`);
