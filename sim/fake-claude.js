// Scripted stand-in for Claude in the simulator harness (same behaviour as test/fake-claude.cjs).

// round 21: the recipes screen asks with its own tools ("recipe" arranges one, "ideas" writes three)
const RECIPE_READ = { found: true, name: 'שקשוקה', ingredients: '6 ביצים\n4 עגבניות\nקופסת רסק עגבניות\n4 שיני שום\n2 פלפלים חריפים\nחצי כוס שמן\nכפית פפריקה מתוקה\nכפית כמון\nמלח\nפלפל שחור\nפטה (לא חובה)', text: 'מטגנים את השום והפלפל החריף בהמון שמן.\nמוסיפים רסק עגבניות מרוכז.\nמוסיפים את התבלינים ונותנים להם להיפתח יפה בשמן.\nמוסיפים עגבניות טריות חתוכות לשש, עד שהמחבת מלאה.\nמכסים ומטגנים על אש נמוכה.\nאם רוצים, מפוררים פטה מעל.\nשוברים פנימה את הביצים ומפזרים עליהן מלח ופלפל.', tags: 'ארוחות בוקר, ישראלי', serves: 4 };
const IDEAS = { ideas: [
  { name: 'חביתת ירק', blurb: 'ארוחת בוקר מהירה', ingredients: '3 ביצים\nעגבנייה\nמלח', text: 'טורפים, מוסיפים ירק קצוץ ומטגנים.', tags: 'ארוחות בוקר', serves: 2 },
  { name: 'פסטה ברוטב עגבניות', blurb: 'מהמזווה, בלי לקנות כלום', ingredients: 'חבילה של פסטה\nקופסת רסק עגבניות\n2 שיני שום', text: 'מבשלים פסטה, מחממים רסק עם שום ומערבבים.', tags: 'פסטה, איטלקי', serves: 3 },
  { name: 'טוסט טונה', blurb: 'חם ונמס', ingredients: 'קופסת טונה\n4 פרוסות לחם\nגבינה צהובה', text: 'ממלאים וקולים בטוסטר.', tags: "סנדוויץ'", serves: 2 }] };
export function fakeClaude(body) {
  if (body.tools?.[0]?.name === 'recipe') return { content: [{ type: 'tool_use', name: 'recipe', input: RECIPE_READ }], usage: { input_tokens: 10, output_tokens: 10 } };
  if (body.tools?.[0]?.name === 'ideas') return { content: [{ type: 'tool_use', name: 'ideas', input: IDEAS }], usage: { input_tokens: 10, output_tokens: 10 } };
  const last = JSON.stringify(body.messages.at(-1).content);
  const cat = Object.fromEntries((body.system[1]?.text || '').split('רשימת קניות')[0].split('\n').filter((l) => /^\d+\|/.test(l)).map((l) => { const [id, name] = l.split('|'); return [name, +id]; }));
  let input = { reply: 'אני פה! אפשר לספר לי מה נגמר, מה קנינו, או להתחיל לקטלג אזור בבית.', face: 'happy' };
  if (last.includes('מקרר')) input = { reply: 'מעולה, מתחילים מהמקרר. זה מה שהבנתי:', face: 'excited', catalog_area: 'מקרר', actions: [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: true, target: 2, shelf_days: 7, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'ביצים L', count_type: 'pack', pack_size: 12, qty: 6, is_basic: true, target: 12, shelf_days: 21, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'גבינה צהובה', count_type: 'units', unit: 'אריזה', qty: 1, is_basic: true, target: 1, shelf_days: 2, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'little', is_basic: true, store: 'greengrocer', store2: 'super', category_id: 'ירקות ופירות', location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'לחם פרוס', count_type: 'units', qty: 0, is_basic: true, target: 1, shelf_days: 4, category_id: 'לחם ומאפים', location_id: 'ארון מטבח' } },
    { kind: 'create', product: { name: 'טונה בשמן', count_type: 'units', unit: 'קופסה', qty: 4, is_basic: true, target: 2, category_id: 'שימורים ורטבים', location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'סבון כלים', count_type: 'inuse', is_open: true, qty: 0, is_basic: true, target: 1, category_id: 'ניקיון וכביסה', location_id: 'ארון ניקיון' } },
    { kind: 'create', product: { name: 'אקמול', count_type: 'units', unit: 'חפיסה', qty: 1, is_basic: true, target: 1, store: 'pharm', category_id: 'אחר', location_id: 'ארון מטבח' } },
  ] };
  if (last.includes('אני עושה קניות')) input = { reply: 'יאללה! פתחתי מצב קניות בסופר ועדכנתי בבית. הרשימה מחכה לך.', face: 'excited', shopping: 'start', store: 'super' };
  if (last.includes('סיימתי קניות')) input = { reply: 'כל הכבוד! סגרתי את מצב הקניות.', face: 'happy', shopping: 'end' };
  if (last.includes('נגמר החלב')) input = { reply: 'אוי, נגמר החלב', face: 'sad', actions: [{ kind: 'op', product_id: cat['חלב 3%'], op: { type: 'out' } }] };
  if (last.includes('נגמרה הגבינה')) input = { reply: 'לא הבנתי. הכוונה לגבינה צהובה?', face: 'confused', options: ['גבינה צהובה', 'לבנה 5%', "קוטג'"] };
  if (last.includes('יש לנו טונה')) input = { reply: 'כן, יש 4 קופסאות טונה במזווה. לא צריך לקנות.', face: 'happy' };
  return { content: [{ type: 'tool_use', name: 'respond', input }], usage: { input_tokens: 10, output_tokens: 10 } };
}
