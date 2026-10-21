// Fake Claude for UI QA: answers by the last user text, using ids from the catalog it is sent.
const http = require('http');
// round 21: the recipes screen asks with its own tools ("recipe" arranges one, "ideas" writes three)
const RECIPE_READ = { found: true, name: 'שקשוקה', ingredients: '6 ביצים\n4 עגבניות\nקופסת רסק עגבניות\n4 שיני שום\n2 פלפלים חריפים\nחצי כוס שמן\nכפית פפריקה מתוקה\nכפית כמון\nמלח\nפלפל שחור\nפטה (לא חובה)', text: 'מטגנים את השום והפלפל החריף בהמון שמן.\nמוסיפים רסק עגבניות מרוכז.\nמוסיפים את התבלינים ונותנים להם להיפתח יפה בשמן.\nמוסיפים עגבניות טריות חתוכות לשש, עד שהמחבת מלאה.\nמכסים ומטגנים על אש נמוכה.\nאם רוצים, מפוררים פטה מעל.\nשוברים פנימה את הביצים ומפזרים עליהן מלח ופלפל.', tags: 'ארוחות בוקר, ישראלי', serves: 4 };
const IDEAS = { ideas: [
  { name: 'חביתת ירק', blurb: 'ארוחת בוקר מהירה', ingredients: '3 ביצים\nעגבנייה\nמלח', text: 'טורפים, מוסיפים ירק קצוץ ומטגנים.', tags: 'ארוחות בוקר', serves: 2 },
  { name: 'פסטה ברוטב עגבניות', blurb: 'מהמזווה, בלי לקנות כלום', ingredients: 'חבילה של פסטה\nקופסת רסק עגבניות\n2 שיני שום', text: 'מבשלים פסטה, מחממים רסק עם שום ומערבבים.', tags: 'פסטה, איטלקי', serves: 3 },
  { name: 'טוסט טונה', blurb: 'חם ונמס', ingredients: 'קופסת טונה\n4 פרוסות לחם\nגבינה צהובה', text: 'ממלאים וקולים בטוסטר.', tags: "סנדוויץ'", serves: 2 }] };

// the body as bytes first: a chunk can end in the middle of a Hebrew letter (docs/stage0-questions.md 29)
http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(parts).toString('utf8')); const last = JSON.stringify(body.messages.at(-1).content);
  const cat = Object.fromEntries((Array.isArray(body.system) ? body.system.slice(1).map((b) => b.text).join('\n') : '') /* 0e: the catalog is in its own part now */.split('רשימת קניות')[0].split('\n').filter((l) => /^\d+\|/.test(l)).map((l) => { const [id, name] = l.split('|'); return [name, +id]; }));
  const tool = body.tools?.[0]?.name || 'respond';
  let input = { reply: 'אני פה!', face: 'happy' };
  if (tool === 'recipe') input = RECIPE_READ;
  if (tool === 'ideas') input = IDEAS;
  if (process.env.FAKE_DEBUG) console.error('FAKE', last.slice(0, 300), JSON.stringify(cat).slice(0, 200));
  if (tool === 'respond' && last.includes('מקרר')) input = { reply: 'מעולה, מתחילים מהמקרר. זה מה שהבנתי:', face: 'excited', catalog_area: 'מקרר', actions: [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: true, target: 2, shelf_days: 7, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'ביצים L', count_type: 'pack', pack_size: 12, qty: 6, is_basic: true, target: 12, shelf_days: 21, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'גבינה צהובה', count_type: 'units', unit: 'אריזה', qty: 1, is_basic: true, target: 1, shelf_days: 2, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'little', is_basic: true, store: 'greengrocer', store2: 'super', category_id: 'ירקות ופירות', location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'לחם פרוס', count_type: 'units', qty: 0, is_basic: true, target: 1, shelf_days: 4, category_id: 'לחם ומאפים', location_id: 'ארון מטבח' } },
    { kind: 'create', product: { name: 'טונה בשמן', count_type: 'units', unit: 'קופסה', qty: 4, is_basic: true, target: 2, category_id: 'שימורים ורטבים', location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'סבון כלים', count_type: 'inuse', is_open: true, qty: 0, is_basic: true, target: 1, category_id: 'ניקיון וכביסה', location_id: 'ארון ניקיון' } },
  ] };
  if (last.includes('אני עושה קניות')) input = { reply: 'יאללה! פתחתי מצב קניות בסופר ועדכנתי בבית. הרשימה מחכה לך.', face: 'excited', shopping: 'start', store: 'super' };
  // stage 8, ט3 (test/stage8-walk-ui.cjs): the first meeting's answers
  if (tool === 'onboard_parse' && last.includes('מיכל שומרת כשרות')) input = { food: [{ name: 'מיכל', key: 'kosher', value: 'כן', text: 'מיכל שומרת כשרות' }] };
  if (tool === 'onboard_parse' && last.includes('אני מתאמן 4 פעמים בשבוע')) input = { life: [{ key: 'training', value: '4 פעמים בשבוע', text: 'אבי מתאמן 4 פעמים בשבוע' }] };
  // home20 (test/home20-week-ui.cjs): the weekly plan in the chat, today and tomorrow by the house's date
  if (tool === 'respond' && last.includes('היום דגים, מחר המנה של דנה')) {
    const day = (k) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now() + k * 86400e3);
    input = { reply: 'לפשטידת התרד של דנה חסרים תרד וגבינה בולגרית. האם ככה?', face: 'happy', actions: [{ kind: 'plan', date: day(0), text: 'דגים' }, { kind: 'plan', date: day(1), text: 'המנה של דנה' }] };
  }
  // home20 round 2: the model asks by itself which of Michal's dishes, with no plan (the server's question replaces it)
  if (tool === 'respond' && last.includes('מחר נכין את המנה של מיכל')) input = { reply: 'איזו מהמנות של מיכל?', face: 'happy', options: ['פשטידה', 'עוגה'] };
  if (last.includes('אני אחרי אימון')) input = { reply: 'איזה כיף! האם תרצה שנכין ביחד משהו מומלץ?', face: 'strong' }; // ה1 (stage 8)
  if (last.includes('סיימתי קניות')) input = { reply: 'כל הכבוד! סגרתי את מצב הקניות.', face: 'happy', shopping: 'end' };
  if (last.includes('נגמר החלב')) input = { reply: 'אוי, נגמר החלב', face: 'sad', actions: [{ kind: 'op', product_id: cat['חלב 3%'], op: { type: 'out' } }] };
  if (last.includes('נגמרה הגבינה')) input = { reply: 'סליחה, לא הבנתי. הכוונה לגבינה צהובה?', face: 'confused', options: ['גבינה צהובה', 'לבנה 5%', "קוטג'"] };
  if (last.includes('סימן 👎')) input = { reply: 'סליחה! לזכור את זה להבא?', face: 'sad', actions: [{ kind: 'lesson', text: 'כשאבי אומר חלב הוא מתכוון למשקה סויה' }] };
  // 15/10, the first use (test/firstuse-ui.cjs): a slow model, 10 seconds, to leave the app and come back while it thinks
  const slow = tool === 'respond' && last.includes('תחשוב לאט');
  if (slow) input = { reply: 'חשבתי לאט.', face: 'happy' };
  setTimeout(() => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'tool_use', name: tool, input }], usage: { input_tokens: 10, output_tokens: 10 } }));
  }, slow ? 10000 : 0);
}); }).listen(+process.env.PORT || 8799);
