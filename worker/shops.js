// home18 (5, the owner 17/10): a tab of the list is a shopping trip; where the house buys produce and care, asked once.
import { HOUSE, SHOP_CATS, storesFor } from './domain.js';

export const SHOP_Q = {
  produce: { q: 'איפה אתם קונים ירקות ופירות?', options: { 'בסופר': 'super', 'בירקן': 'greengrocer', 'פעם פה פעם שם': 'both' } },
  care: { q: 'איפה אתם קונים טואלטיקה ומוצרי ניקיון?', options: { 'בסופר': 'super', 'בפארם': 'pharm', 'פעם פה פעם שם': 'both' } },
};
export const shopAsk = (kind) => ({ ask: { actions: [], shop: kind, onlyChoices: true, choices: Object.fromEntries(Object.entries(SHOP_Q[kind].options).map(([k, v]) => [k, { shopAns: v }])) },
  bubble: { reply: SHOP_Q[kind].q, face: 'happy', options: Object.keys(SHOP_Q[kind].options) } });
/** The house answered: the setting, and the products of those categories (but one whose store was set in the app's form, which
 * is any made or edited there: there is no other way to tell) and their open lines move to where the house buys them. */
export async function applyShop(db, kind, ans) {
  await (kind === 'produce' ? db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_produce', ?)") : db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_care', ?)")).bind(ans).run();
  HOUSE.shop = { ...HOUSE.shop, [`shop_${kind}`]: ans };
  const cats = SHOP_CATS[kind], st = storesFor(cats[0], HOUSE.shop);
  const manual = "SELECT product_id FROM events WHERE product_id IS NOT NULL AND type IN ('create', 'edit') AND COALESCE(op_id, '') NOT LIKE 'proposal:%' AND COALESCE(source, '') NOT IN ('onboarding', 'mapping')";
  const ids = (await db.prepare(`SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id WHERE p.deleted IS NULL AND c.name IN (${cats.map(() => '?').join(', ')}) AND p.id NOT IN (${manual})`).bind(...cats).all()).results.map((r) => r.id);
  if (!ids.length) return 0;
  await db.batch([db.prepare(`UPDATE products SET store = ?, store2 = ? WHERE id IN (SELECT value FROM json_each(?))`).bind(st.store, st.store2, JSON.stringify(ids)),
    db.prepare(`UPDATE list_items SET store = ? WHERE status = 'open' AND product_id IN (SELECT value FROM json_each(?))`).bind(st.store, JSON.stringify(ids))]);
  return ids.length;
}
/** Asked once: after the regular products' question at the end of a mapping (queued, so after its card), or, in a house that has
 * products and wasn't asked, when an admin opens the chat with no talk going on (the live house). Not asked again, answered or not. */
export async function shopsDue(db, user) {
  if (user?.role !== 'admin') return false;
  const s = Object.fromEntries((await db.prepare("SELECT key, value FROM settings WHERE key IN ('shop_produce', 'shop_care', 'shop_asked')").all()).results.map((r) => [r.key, r.value]));
  return !s.shop_asked && !s.shop_produce && !s.shop_care;
}
