// Round 21, real model: only what's new — reading a recipe (text / photo), the categories Shuki picks, a warning
// with a swap for what the house can't eat, three ideas (a kosher house), saving from the chat as lines, and
// "I made shakshuka" against a structured saved recipe.
// Run: bash test/real-eval.sh claude-sonnet-5 test/real-r21-results.txt test/real-r21.eval.js
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { parseLine, kosherProblem, CATEGORIES, parseIngredients } from '../public/recipes.js';
const base = 'http://127.0.0.1:8790';
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); try { return JSON.parse(x); } catch { return x; } };
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to /tmp/shuki-real --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
const avi = (await call(null, 'POST', '/api/pair', { code: '111111' })).token;
const S = () => call(avi, 'GET', '/api/state');
const out = []; const results = [];
const log = (t) => { out.push(t); console.log(t); };
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
async function scenario(id, name, fn) {
  if (ONLY && !ONLY.includes(id)) return;
  log(`\n=== ${id} ${name}`);
  let v = 'ok'; try { await fn(); } catch (e) { v = `FAIL: ${e.message}`; }
  log(`=== ${id}: ${v}`); results.push({ id, name, verdict: v });
}
const must = (c, m) => { if (!c) throw new Error(m); };
const showRecipe = (r) => `${r.name} [${r.tags}] ל-${r.serves ?? '?'}${r.warn ? ` ⚠ ${r.warn}` : ''}${r.swap ? ` ↺ ${r.swap}` : ''}\n    ${String(r.ingredients).split('\n').join(' / ')}\n    ${String(r.text).slice(0, 160)}`;
const tagsOk = (tags) => String(tags || '').split(/\s*,\s*/).filter(Boolean).every((t) => CATEGORIES.includes(t));
const linesOk = (ings) => parseIngredients(ings).length >= 3 && String(ings).includes('\n');

await call(avi, 'POST', '/api/settings', { costCap: 1000 });
await call(avi, 'POST', '/api/actions', { actions: [
  { kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 8, is_basic: 1, target: 6 } },
  { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'plenty', store: 'greengrocer' } },
  { kind: 'create', product: { name: 'בצל', count_type: 'level', level: 'plenty', store: 'greengrocer' } },
  { kind: 'create', product: { name: 'רסק עגבניות', count_type: 'units', unit: 'קופסה', qty: 2 } },
  { kind: 'create', product: { name: 'פסטה', count_type: 'units', unit: 'חבילה', qty: 2 } },
  { kind: 'create', product: { name: 'חזה עוף', count_type: 'units', unit: 'מגש', qty: 1 } },
  { kind: 'create', product: { name: 'אורז', count_type: 'inuse', is_open: 1, qty: 1 } },
  { kind: 'create', product: { name: 'גבינה צהובה', count_type: 'units', unit: 'אריזה', qty: 1 } },
  { kind: 'create', product: { name: 'שמן זית', count_type: 'inuse', is_open: 1, qty: 1 } },
] });

const SHAKSHUKA = `שקשוקה ל-4
מצרכים:
6 ביצים
4 עגבניות בשלות
1 בצל
2 כפות שמן זית
קופסת רסק עגבניות
כפית פפריקה
מלח ופלפל
אופן ההכנה: מטגנים את הבצל בשמן, מוסיפים עגבניות ורסק ומבשלים 10 דקות. שוברים את הביצים לתוך הרוטב, מכסים ומבשלים עד שהחלבון מתייצב.`;

let saved;
await scenario('TEXT', 'מתכון מודבק: שם, מצרך בשורה עם כמויות, ל-4, קטגוריות רק מהרשימה; נשמר ומקושר למלאי', async () => {
  const r = await call(avi, 'POST', '/api/recipes/read', { text: SHAKSHUKA });
  must(r.recipe, JSON.stringify(r)); log(`< ${showRecipe(r.recipe)}`);
  must(/שקשוקה/.test(r.recipe.name), r.recipe.name); must(r.recipe.serves === 4, `serves ${r.recipe.serves}`);
  must(linesOk(r.recipe.ingredients), 'one per line'); must(tagsOk(r.recipe.tags), `tags ${r.recipe.tags}`);
  const eggs = parseIngredients(r.recipe.ingredients).find((i) => /ביצ/.test(i.name)); must(eggs?.qty === 6, JSON.stringify(eggs));
  must(!r.recipe.warn, `no warning expected: ${r.recipe.warn}`);
  saved = await call(avi, 'POST', '/api/recipes', r.recipe);
  const x = (await S()).recipes.find((y) => y.id === saved.id);
  log(`  ings: ${x.ings.map((i) => `${i.qty ?? ''} ${i.unit ?? ''} ${i.name} → ${i.product_id ? 'במלאי' : '—'}`).join(' / ')}`);
  must(x.ings.filter((i) => i.product_id).length >= 4, 'linked to the house');
});

await scenario('PHOTO', 'צילום של מתכון (עברית בכתב מודפס): נקרא לשדות', async () => {
  const img = existsSync('/tmp/shuki-test/recipe-photo.jpg') ? readFileSync('/tmp/shuki-test/recipe-photo.jpg').toString('base64') : null;
  must(img, 'no photo (make it with test/recipe-photo.cjs)');
  const r = await call(avi, 'POST', '/api/recipes/read', { image: { media_type: 'image/jpeg', data: img } });
  must(r.recipe, JSON.stringify(r)); log(`< ${showRecipe(r.recipe)}`);
  must(/עוגת|עוגה/.test(r.recipe.name), r.recipe.name); must(linesOk(r.recipe.ingredients), 'lines'); must(tagsOk(r.recipe.tags), `tags ${r.recipe.tags}`);
  must(/עוגות|קינוחים/.test(r.recipe.tags), `a cake: ${r.recipe.tags}`);
});

await scenario('WARN', 'בית כשר עם אלרגיה לבוטנים: מתכון שהמשתמש הדביק עם עוף, שמנת ובוטנים → "יש במתכון …" והצעה להחליף', async () => {
  await call(avi, 'POST', '/api/settings', { house_notes: 'הכל כשר. אלרגיה לבוטנים' });
  const r = await call(avi, 'POST', '/api/recipes/read', { text: 'עוף בשמנת ובוטנים ל-4: 2 חזה עוף, מיכל שמנת מתוקה, חצי כוס בוטנים קלויים, מלח. מטגנים את העוף, מוסיפים שמנת ומפזרים בוטנים.' });
  must(r.recipe, JSON.stringify(r)); log(`< ${showRecipe(r.recipe)}`);
  must(/^יש במתכון /.test(r.recipe.warn || ''), `warn: ${r.recipe.warn}`); must(/להחליף/.test(r.recipe.swap || ''), `swap: ${r.recipe.swap}`);
  must(!/[a-z]/i.test(`${r.recipe.warn}${r.recipe.swap}`), 'Hebrew only');
});

await scenario('IDEAS', '"רוצים שאכתוב?" בבית כשר: 3 רעיונות שונים, בעיקר ממה שיש, בלי בשר וחלב ובלי אזהרות', async () => {
  const r = await call(avi, 'POST', '/api/recipes/ideas', {});
  must(r.ideas?.length === 3, JSON.stringify(r).slice(0, 300));
  for (const i of r.ideas) log(`< ${i.name} — ${i.blurb}\n    ${String(i.ingredients).split('\n').join(' / ')}\n    [${i.tags}] ל-${i.serves}`);
  must(new Set(r.ideas.map((i) => i.name)).size === 3, 'different');
  for (const i of r.ideas) {
    must(!kosherProblem(parseIngredients(i.ingredients)), `not kosher: ${i.name}`);
    must(!/בוטנ/.test(i.ingredients), `peanuts: ${i.name}`); must(tagsOk(i.tags), `tags ${i.tags}`); must(!i.warn, 'no warning on an idea');
  }
  const s = await S(); const { recipeStatus } = await import('../public/recipes.js');
  const miss = r.ideas.map((i) => recipeStatus({ serves: i.serves }, parseIngredients(i.ingredients).map((x) => ({ ...x, product_id: null })), [], null).items.length);
  log(`  (${s.products.length} מוצרים בבית; מצרכים לרעיון: ${miss.join(', ')})`);
  const again = await call(avi, 'POST', '/api/recipes/ideas', { not: r.ideas.map((i) => i.name) });
  must(again.ideas?.length && again.ideas.every((i) => !r.ideas.some((j) => j.name === i.name)), 'other ideas');
  for (const i of again.ideas) must(!kosherProblem(parseIngredients(i.ingredients)), `not kosher (second batch): ${i.name}`);
  log(`< עוד: ${again.ideas.map((i) => i.name).join(' · ')}`);
});

await scenario('CHAT-SAVE', 'בצ\'אט: "תשמור את המתכון" → כרטיס; אחרי אישור המצרכים שמורים בשורות עם כמויות', async () => {
  await call(avi, 'POST', '/api/settings', { house_notes: '' });
  const r = await call(avi, 'POST', '/api/chat', { text: 'תשמור את המתכון: פסטה ברוטב עגבניות ל-3. חבילת פסטה, קופסת רסק עגבניות, 3 שיני שום, 2 כפות שמן זית, מלח. מבשלים פסטה, מטגנים שום בשמן, מוסיפים רסק ומערבבים.' });
  log(`< ${r.reply}\n  ${(r.proposal?.lines || []).map((l) => l.text).join(' | ')}`);
  must(r.proposal?.lines.some((l) => /^לשמור את המתכון ל.+\?$/.test(l.text)), 'a recipe card with "?"');
  const a = await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {}); must(a.status === 'applied', JSON.stringify(a));
  const x = (await S()).recipes.find((y) => /פסטה/.test(y.name));
  log(`  ings: ${x.ings.map((i) => `${i.qty ?? ''} ${i.unit ?? ''} ${i.name}`).join(' / ')} [${x.tags}]`);
  must(x.ings.length >= 4 && x.ings.find((i) => /שום/.test(i.name))?.qty === 3, 'structured'); must(tagsOk(x.tags), `tags ${x.tags}`);
});

await scenario('COOKED-CHAT', '"הכנתי שקשוקה" בצ\'אט מול המתכון המובנה: שואל לפי המתכון, ואז כרטיס עם 6 ביצים', async () => {
  const r = await call(avi, 'POST', '/api/chat', { text: 'הכנתי שקשוקה' });
  log(`< ${r.reply}${r.options ? ` [${r.options.join(' | ')}]` : ''}${r.proposal ? `\n  ${r.proposal.lines.map((l) => l.text).join(' | ')}` : ''}`);
  let card = r.proposal;
  if (!card) { const r2 = await call(avi, 'POST', '/api/chat', { text: 'כן, ככה' }); log(`< ${r2.reply}${r2.proposal ? `\n  ${r2.proposal.lines.map((l) => l.text).join(' | ')}` : ''}`); card = r2.proposal; }
  must(card, 'a card'); must(card.lines.some((l) => /6 ביצים/.test(l.text)), 'six eggs'); must(card.lines.every((l) => /\?$/.test(l.text)), '"?"');
  await call(avi, 'POST', `/api/proposals/${card.id}/reject`, {});
});

const ok = results.filter((r) => r.verdict === 'ok').length;
log(`\n${ok}/${results.length} real-model round-21 scenarios ok`);
writeFileSync(new URL('./real-r21-results.json', import.meta.url), JSON.stringify(results, null, 1));
