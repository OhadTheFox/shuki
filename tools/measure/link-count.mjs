// usage: node tools/measure/link-count.mjs <repo root> <an older public/recipes.js> <recipes JSON> (counts only, nothing of the file is printed)
// how many of the 255 recipes' ingredients link to a product of the measurement house: before and after (counts only)
import { readFileSync } from 'node:fs';
const [,, ROOT, OLD, FILE] = process.argv;
const now = await import(`${ROOT}/public/recipes.js`), old = await import(OLD);
const src = readFileSync(`${ROOT}/test/measure-house.mjs`, 'utf8');
const names = [...src.matchAll(/^\s*\['([^']+)', (?:DAIRY|VEG|'[^']*')/gm)].map((m) => m[1]);
const products = names.map((name, i) => ({ id: i + 1, name, aliases: '[]' }));
const recs = JSON.parse(readFileSync(FILE, 'utf8'));
let n = 0, o = 0, a = 0, b = 0, c = 0, sizeNow = 0, sizeOld = 0, prepOld = 0;
const UNIT_SIZE = /^(גדושה|גדושות|שטוחה|שטוחות|מלאה|מלאות|עגולה|נדיבה|קטנה|גדולה) /;
for (const r of recs) for (const g of r.ings || []) {
  n++;
  const line = old.lineOf(g); // the line as the house shows it
  const pn = now.parseLine(line);
  if (UNIT_SIZE.test(g.name)) sizeOld++;
  if (pn && pn.name !== g.name) prepOld++;
  if (old.isStaple(g.name, g.unit) || old.linkProduct(g.name, products)) o++; // today: the name as stored
  if (pn && (now.isStaple(pn.name, pn.unit) || now.linkProduct(pn.name, products))) a++; // after: parsed again from its line
  if (old.isStaple(g.name, g.unit) || now.linkProduct(g.name, products)) b++; // the new linking alone, the stored name
  const po = old.parseLine(line); if (po && (old.isStaple(now.basePrep(po.name), po.unit) || old.linkProduct(now.basePrep(po.name), products))) c++; // the base name alone, the old linking
  if (/^(גדושה|גדושות|שטוחה|שטוחות|מלאה|מלאות) /.test(po?.name || '')) sizeNow++;
}
console.log(JSON.stringify({ recipes: recs.length, ingredients: n, linkedOrStapleBefore: o, after: a, namesWithSizeWordBefore: sizeOld, namesChanged: prepOld, newLinkingOnly: b, baseNameOnly: c, oldParseWithSizeWord: sizeNow, products: products.length }));
