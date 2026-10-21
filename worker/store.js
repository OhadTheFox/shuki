// Data access + the single write path. Every change goes through `execute()`:
// load the whole (small) household into memory, apply actions, write the diff
// and ONE journal event in one D1 batch (atomic), so undo restores exactly that.

import { withDefaults, observe, storeDefaults, placeDefaults } from './instincts.js';
import { categoryByName, storesFor, oneLine, localToTs, applyOp, levelToCount, listNeed, suggestedBuy, isOut, norm, STORES, BASE_STORES, COUNT_TYPES, LEVELS, STORE_NAMES, HOUSE, CHAMETZ_WORDS, KITNIYOT_WORDS, passoverOut, EVENT_STORES, byGender } from './domain.js';
import { privateFor, sees } from './private.js';
import { byPerson, isWoman } from '../public/hebrew.js';

// Time-based ids (they sort by creation). Many are made in the same millisecond (a receipt, "make me a list"),
// so a counter keeps them apart; the random start keeps two servers (or restarts) from lining up.
const SHOP_TTL = 6 * 3600e3; // decision 29: a shopping trip nobody closed is over after 6 hours (the same in index.js)
let idSeq = Math.floor(Math.random() * 1000);
export const newId = () => Date.now() * 1000 + (idSeq = (idSeq + 1) % 1000);

const FIELD_NAMES = { pack_size: 'יחידות באריזה', qty: 'כמות', target: 'כמות מינימום', shelf_days: 'חיי מדף', expires: 'תוקף', open_days: 'ימים אחרי פתיחה' };
const PRODUCT_FIELDS = ['name', 'aliases', 'category_id', 'location_id', 'count_type', 'unit', 'pack_size', 'qty', 'level', 'is_open',
  'is_basic', 'target', 'store', 'store2', 'shelf_days', 'expires', 'open_days', 'chametz', 'occasional', 'brand', 'owner', 'reserve_location_id', 'reserve_qty', 'only_brand', 'kosher_kind', 'responsible'];

/**
 * The house as one reader may see it (0b): without anyone else's private products, their batches and list lines.
 * reader: the person, or { all: true } for the server itself (execute, the daily copy, jobs that filter per recipient).
 */
export async function loadAll(db, reader) {
  if (!reader) throw new Error('loadAll needs a reader (a user, or { all: true } for the server itself)');
  const [products, batches, items, users, locations, categories] = await db.batch([
    db.prepare('SELECT * FROM products WHERE deleted IS NULL ORDER BY name'),
    db.prepare('SELECT b.* FROM batches b JOIN products p ON p.id = b.product_id WHERE p.deleted IS NULL'),
    db.prepare("SELECT * FROM list_items WHERE status != 'done' ORDER BY added"),
    db.prepare('SELECT * FROM users'),
    db.prepare('SELECT * FROM locations ORDER BY sort, id'),
    db.prepare('SELECT * FROM categories ORDER BY sort, id'),
  ]);
  const hidden = new Set(products.results.filter((p) => !sees(reader, p.private_to)).map((p) => p.id));
  return {
    products: products.results.filter((p) => !hidden.has(p.id)).map(fromRow),
    batches: batches.results.filter((b) => !hidden.has(b.product_id)),
    items: items.results.filter((i) => sees(reader, i.private_to) && !hidden.has(i.product_id)),
    users: users.results, locations: locations.results, categories: categories.results,
  };
}

/**
 * Whose private thing this action is about (users.id), or null when it's shared: a private product or line, or a new one
 * that will be. Names are matched only among what the writer may see, so another's private product is never found by
 * name (0b part 3). `all`: the card's other actions, so a line added with a private product of the same name goes with it.
 */
/** A product's name, as typed: also with "ה" in front ("השוקולד מריר"), as list_add finds it. */
const sameText = (name, text) => norm(name) === norm(text || '') || norm(name) === norm(text || '').replace(/^ה/, '');
function privateOwner(a, S, user, all = []) {
  const visible = (p) => sees(user, p.private_to);
  if (a.kind === 'create') return privateFor(user, a, a.product?.name);
  // made after a message marked secret (the card marks it, the owner 04/10): what it does to a product is journaled for the writer alone
  if (a.private === true && user?.role !== 'child' && user?.id != null && ['op', 'edit', 'delete', 'confirm'].includes(a.kind)) return user.id;
  // a name from the private list (or "only me") added by a grown-up, when the product of that name is shared: a private
  // line of its own (the owner 02/10, question 21)
  const ownLine = (p) => a.kind === 'list_add' && p && p.private_to == null && privateFor(user, a, p.name);
  if (a.product_id != null) { const p = S.products.find((x) => x.id === Number(a.product_id)); return ownLine(p) ? privateFor(user, a, p.name) : p?.private_to ?? null; }
  if (a.kind === 'list_add') {
    const named = (p) => visible(p) && sameText(p.name, a.text);
    const known = S.products.find((p) => named(p) && p.private_to === user.id) || S.products.find(named); // the writer's own first
    if (known) return ownLine(known) ? privateFor(user, a, known.name) : known.private_to ?? null;
    const made = all.find((x) => x.kind === 'create' && norm(x.product?.name || '') === norm(a.text || ''));
    return (made && privateFor(user, made, made.product?.name)) ?? privateFor(user, a, a.text);
  }
  if (a.item_id != null) { // list_remove, uncheck, check, arrived, order, keep, approve: by the line, or the product it's for
    const i = S.items.find((x) => x.id === Number(a.item_id));
    return i?.private_to ?? (i?.product_id != null ? S.products.find((p) => p.id === i.product_id)?.private_to ?? null : null);
  }
  return null;
}

// In the database a product at the household's own store is store='super' + shop=<id> (see migration 0006).
// Everywhere else there is just `store`.
export const fromRow = (p) => { const { shop, ...rest } = p; return shop ? { ...rest, store: shop } : rest; };
const toRow = (p) => (BASE_STORES.includes(p.store) || p.store == null ? { ...p, shop: null } : { ...p, store: 'super', shop: p.store });

function upsert(db, table, row) {
  if (table === 'products') row = toRow(row);
  const cols = Object.keys(row);
  return db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...cols.map((c) => row[c] ?? null));
}

/** Validate/normalise product fields coming from a client or from Shuki. */
export function cleanProduct(input, ref, keepPlace = false) {
  const out = {};
  for (const f of PRODUCT_FIELDS) if (input[f] !== undefined) out[f] = input[f];
  // a name is text (an object used to become "[object Object]": Q-1)
  // one line (stage 13, S13-8): a name with a line break could make a line of its own in the model's prompt
  if (out.name !== undefined) { out.name = oneLine(typeof out.name === 'string' || typeof out.name === 'number' ? out.name : '', 80); if (!out.name) throw new Error('צריך לתת למוצר שם'); }
  // up to 10 names, of up to 40 letters each (stage 13, S13-6: one product's aliases went into every member's prompt)
  if (out.aliases !== undefined) {
    let a = out.aliases; if (!Array.isArray(a)) { try { a = JSON.parse(a || '[]'); } catch { a = []; } }
    out.aliases = JSON.stringify((Array.isArray(a) ? a : []).filter((x) => typeof x === 'string' || typeof x === 'number').map((x) => oneLine(x, 40)).filter(Boolean).slice(0, 10));
  }
  if (out.count_type !== undefined && !COUNT_TYPES.includes(out.count_type)) throw new Error('סוג ספירה לא מוכר');
  if (out.level != null && !LEVELS.includes(out.level)) throw new Error('מצב לא מוכר');
  if (out.store !== undefined && !STORES.includes(out.store)) throw new Error('חנות לא מוכרת');
  if (out.store2 != null && !BASE_STORES.includes(out.store2)) out.store2 = null;
  // "good until the 5th": a date from the chat becomes the end of that day, in the house's time zone
  if (typeof out.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(out.expires)) { out.expires = localToTs(out.expires, '23:00'); if (!out.expires) throw new Error('תאריך לא תקין'); }
  if (out.reserve_qty !== undefined && (out.reserve_qty == null || Number(out.reserve_qty) === 0)) { out.reserve_qty = null; out.reserve_location_id = null; }
  for (const n of ['pack_size', 'qty', 'target', 'shelf_days', 'expires', 'open_days', 'reserve_qty']) if (out[n] != null) { out[n] = Number(out[n]); if (!Number.isFinite(out[n]) || out[n] < 0) throw new Error(`ב"${FIELD_NAMES[n] || n}" צריך לכתוב מספר`); }
  for (const b of ['is_open', 'is_basic', 'occasional', 'only_brand']) if (out[b] !== undefined) out[b] = out[b] ? 1 : 0;
  if (out.kosher_kind !== undefined && out.kosher_kind !== null && !['meat', 'dairy', 'parve'].includes(out.kosher_kind)) delete out.kosher_kind; // מ17
  if (out.chametz !== undefined) out.chametz = out.chametz == null ? null : out.chametz ? 1 : 0;
  if (out.brand !== undefined) out.brand = out.brand == null ? null : oneLine(out.brand, 40) || null;
  // whose it is, in every house (stage 9, מ1; before, roommates only): someone in the house, a grown-up or a child, or nobody
  if (out.owner !== undefined) out.owner = out.owner == null || out.owner === '' ? null : Number(out.owner) || null;
  if (out.owner != null && ref?.users && !ref.users.some((u) => u.id === out.owner && u.active !== 0)) delete out.owner;
  // מ19: who is in charge of buying it (an active person), or nobody
  if (out.responsible !== undefined) out.responsible = out.responsible == null || out.responsible === '' ? null : Number(out.responsible) || null;
  if (out.responsible != null && ref?.users && !ref.users.some((u) => u.id === out.responsible && u.active !== 0)) delete out.responsible;
  if (ref) {
    // category / location may arrive as names
    for (const [key, list] of [['category_id', ref.categories], ['location_id', ref.locations], ['reserve_location_id', ref.locations]]) {
      const v = out[key];
      if (v != null && typeof v === 'string' && !/^\d+$/.test(v)) {
        const hit = list.find((x) => x.name === v.trim());
        // a place that doesn't exist, on a private product's edit (it makes no new place): the place it has stays (stage 9, מ32)
        if (!hit && keepPlace && key !== 'category_id') delete out[key];
        else out[key] = hit ? hit.id : (key === 'category_id' ? list.find((x) => x.name === 'אחר')?.id ?? null : null);
      } else if (v != null) out[key] = Number(v);
    }
  }
  return out;
}

/**
 * Apply a list of actions for `user` as ONE journal event.
 * actions: the kinds in the switch below. Returns { eventId, summary, created } or throws.
 * opts: { opId, now, type, context: 'shopping' | 'catalog' | 'report' }
 */
export async function execute(env, user, actions, opts = {}) {
  const db = env.DB;
  const now = opts.now ?? Date.now();
  if (opts.opId) {
    // a card split in two (shared, private) is a replay only when both parts were written; one that stopped half way goes
    // on, and the part already written replays by itself (0b)
    const rows = (await db.prepare('SELECT id, summary, op_id FROM events WHERE op_id IN (?, ?, ?) ORDER BY private_to IS NOT NULL').bind(opts.opId, `${opts.opId}:s`, `${opts.opId}:p`).all()).results;
    const seen = rows.find((r) => r.op_id === opts.opId) || (!opts.part && rows.length === 2 && rows[0]);
    if (seen) return { eventId: seen.id, summary: seen.summary, replay: true };
  }
  // 0b: a card that mixes something private with something that isn't writes two journal lines, each seen by whom it
  // should be; what's said to others (the summary, the shopper's "added") is only the shared part
  if (!opts.part) {
    // mineOf is the server's own mark (below), never taken from outside (the reviewer, 04/10)
    actions = actions.map(({ mineOf, ...a }) => a);
    const S0 = await loadAll(db, { all: true });
    // a product the writer has privately under the same name as a shared one: everything they do on that name goes to the
    // private one, and the shared one doesn't move (the owner 02/10, questions 21 and 33)
    const twinOf = (p) => p && p.private_to == null && S0.products.find((x) => !x.deleted && x.private_to === user.id && norm(x.name) === norm(p.name));
    const TWIN_KINDS = ['op', 'edit', 'delete', 'confirm', 'list_add'];
    const amountOf = (a, i) => (a.amount != null && Number.isFinite(Number(a.amount)) ? { amount: Number(a.amount) } : i.want != null && !i.want_unit ? { amount: i.want } : {});
    const LINE_KINDS = ['list_remove', 'order', 'keep', 'uncheck']; // question 38: on the shared line too, all of them
    if (user.id != null) actions = actions.map((a) => {
      // after a secret, or a message the model marked personal: what's done to a shared product is done to the writer's own
      // of that name, made if there's none, like a list line in question 21(א); the shared one doesn't move, so nobody learns
      // who did it (the owner 04/10, the reviewer's blocker 2). Deleting or confirming one she doesn't have does nothing. A child
      // has no private product: as before
      if (a.private === true && user.role !== 'child' && a.product_id != null && ['op', 'edit', 'delete', 'confirm'].includes(a.kind)) {
        const p = S0.products.find((x) => x.id === Number(a.product_id));
        if (p && !p.deleted && p.private_to == null) { const twin = twinOf(p); return twin ? { ...a, product_id: twin.id } : a.kind === 'delete' || a.kind === 'confirm' ? null : { ...a, mineOf: p.id }; }
      }
      // ...and to a shared line on the list (the reviewer's blocker 1, the owner 04/10), when she has no private product of its name
      // (with one, as in question 38 below): bought or delivered is her own product bought, "ordered" is her own line,
      // ordered; removing, un-ticking or "still want it" have nothing of hers to act on, and nothing happens
      if (a.private === true && user.role !== 'child' && a.item_id != null && ['check', 'arrived', ...LINE_KINDS].includes(a.kind)) {
        const i = S0.items.find((x) => x.id === Number(a.item_id)); const p = i?.product_id != null ? S0.products.find((x) => x.id === i.product_id) : null;
        if (i && i.private_to == null && !(p && p.private_to != null) && !(p && twinOf(p))) {
          if (p && (a.kind === 'check' || a.kind === 'arrived')) return { kind: 'op', product_id: p.id, mineOf: p.id, private: true, op: { type: 'purchase', ...amountOf(a, i) } };
          if (p && a.kind === 'order' && !a.off) return { kind: 'list_add', product_id: p.id, private: true, ordered: true };
          return null;
        }
      }
      if (a.product_id != null && TWIN_KINDS.includes(a.kind)) { const twin = twinOf(S0.products.find((x) => x.id === Number(a.product_id))); return twin ? { ...a, product_id: twin.id } : a; }
      if (a.kind === 'list_add' && a.product_id == null) { // by name: the shared product of that name is hers too
        const twin = twinOf(S0.products.find((x) => !x.deleted && x.private_to == null && sameText(x.name, a.text)));
        if (twin) return { ...a, product_id: twin.id };
      }
      // ticking the shared product's line: her own line when she has one (both look the same to her); otherwise she bought
      // her own, and the shared line stays on the list for the others
      if (a.item_id != null && (a.kind === 'check' || a.kind === 'arrived')) {
        const i = S0.items.find((x) => x.id === Number(a.item_id)); const twin = i?.product_id != null && twinOf(S0.products.find((x) => x.id === i.product_id));
        if (!twin) return a;
        const own = S0.items.find((x) => x.product_id === twin.id && x.status === 'open');
        return own ? { ...a, item_id: own.id } : { kind: 'op', product_id: twin.id, op: { type: 'purchase', ...amountOf(a, i) } };
      }
      // the other things done to the shared line (the owner 03/10, question 38, "every action"): her own line when she has
      // one; "ordered" with no line of hers adds her own, ordered; the rest have nothing of hers to act on, so nothing
      // happens, and the shared line and others' journal stay as they are
      if (a.item_id != null && LINE_KINDS.includes(a.kind)) {
        const i = S0.items.find((x) => x.id === Number(a.item_id)); const twin = i?.product_id != null && twinOf(S0.products.find((x) => x.id === i.product_id));
        if (!twin) return a;
        const own = S0.items.find((x) => x.product_id === twin.id && x.status === (a.kind === 'uncheck' ? 'checked' : 'open'));
        if (own) return { ...a, item_id: own.id };
        if (a.kind === 'order' && !a.off) return { kind: 'list_add', product_id: twin.id, ordered: true };
        return null;
      }
      return a;
    }).filter(Boolean);
    // every action of the card fell away (nothing of hers to act on): nothing is written, not even an empty event that
    // others would see in the journal or that "undo" would take (question 38, the reviewer)
    if (!actions.length) return { eventId: null, summary: '', created: [], added: [], finished: [], nothing: true };
    const owners = actions.map((a) => privateOwner(a, S0, user, actions));
    const mine = actions.filter((_, k) => owners[k] != null), rest = actions.filter((_, k) => owners[k] == null);
    // the journal line is the owner's, also when the server adds it for them (a weekly buy)
    const privateTo = owners.find((o) => o != null) ?? null;
    if (mine.length && rest.length) {
      const r1 = await execute(env, user, rest, { ...opts, part: 'shared', opId: opts.opId && `${opts.opId}:s` });
      const r2 = await execute(env, user, mine, { ...opts, part: 'private', privateTo, opId: opts.opId && `${opts.opId}:p` });
      // a retry of a card that stopped half way is not a replay: what the shared part says (pushes, the trip) still happens.
      // Nothing was done only when neither part did anything; a shared part that did nothing (an uncheck on a closed line,
      // פ8) leaves the private part's event to undo (the reviewer, 07/10)
      return { ...r1, eventId: r1.eventId ?? r2.eventId ?? null, nothing: !!(r1.nothing && r2.nothing), replay: !!(r1.replay && r2.replay), created: [...(r1.created || []), ...(r2.created || [])], items: [...(r1.items || []), ...(r2.items || [])], privateEventId: r2.eventId };
    }
    opts = { ...opts, part: mine.length ? 'private' : 'shared', privateTo };
  }
  actions = await withDefaults(env, user, actions); // decision 122: the amount this person always adds
  const S = await loadAll(db, { all: true });
  // home18 (5): what the model or the mapping made gets the store by where the house goes; the app's form keeps what was chosen
  const fromModel = String(opts.opId || '').startsWith('proposal:') || ['mapping', 'onboarding', 'mcp'].includes(opts.source);
  const catOf = (id) => S.categories.find((c) => c.id === Number(id))?.name;
  const shopRule = (f) => {
    if (f.category_id == null || catOf(f.category_id) === 'אחר') { const g = S.categories.find((c) => c.name === categoryByName(f.name)); if (g) f.category_id = g.id; }
    const st = storesFor(catOf(f.category_id), HOUSE.shop);
    if (st) { f.store = st.store; f.store2 = st.store2; }
  };
  // decision 122 (r0t d122): a product bought three times running at another store goes on that store's list
  const learnedStore = await storeDefaults(db);
  const storeOf = (p) => (STORE_NAMES[learnedStore.get(p.id)] ? learnedStore.get(p.id) : p.store);
  // and a new product with no place goes where the house puts its category (d122, text 12); a place that was given stays
  const learnedPlace = await placeDefaults(db);
  const newPlaces = [];
  // a private product (with a secret or not) makes no new place: everyone sees the places (the owner 04/10); an existing one is
  // fine, and a new name stays empty
  if (opts.part !== 'private') for (const a of actions) {
    const src = a.kind === 'create' ? a.product : a.kind === 'edit' ? a.fields : null;
    for (const v of [src?.location_id, src?.reserve_location_id]) {
      const name = typeof v === 'string' && !/^\d+$/.test(v) ? v.trim().slice(0, 40) : '';
      if (name && !S.locations.some((l) => l.name === name) && !newPlaces.some((l) => l.name === name)) newPlaces.push({ id: newId(), name, sort: 60 + newPlaces.length });
    }
  }
  S.locations.push(...newPlaces);
  // bought outside a shopping trip ("I bought milk" at the kiosk, a receipt at home): the list line is done, not left in a cart
  const trip = await db.prepare('SELECT store FROM shopping WHERE user_id = ? AND ended IS NULL AND started > ?').bind(user.id, now - SHOP_TTL).first();
  const inStore = !!trip, tripStore = trip?.store; // bought in the store I'm in: it closes with this trip
  const products = new Map(S.products.map((p) => [p.id, { ...p }]));
  // two products with the same name can't be told apart anywhere (chat, Siri, the list): each needs its own
  // only among what this person may see: another's private product is neither revealed nor blocks the name (0b)
  const sameName = (name, notId, mine = false) => [...products.values()].find((x) => !x.deleted && x.id !== notId && sees(user, x.private_to) && !(mine && x.private_to == null) && norm(x.name) === norm(name));
  const batches = new Map(); for (const b of S.batches) { if (!batches.has(b.product_id)) batches.set(b.product_id, []); batches.get(b.product_id).push({ ...b }); }
  const items = new Map(S.items.map((i) => [i.id, { ...i }]));

  const before = { products: {}, batches: {}, list_items: {} };
  const created = { products: [], list_items: [] };
  const touchedBatches = new Set();
  const deletedItems = new Set();
  const lines = [];
  // "Dan bought milk, eggs and bread": the same verb in a row is said once
  const say = (verb, obj) => { const last = lines.at(-1); if (last && last.verb === verb && obj) last.objs.push(obj); else lines.push({ verb, objs: obj ? [obj] : [] }); };
  const joinHe = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ו${xs.at(-1)}`);
  const log = []; // [product_id, 'out' | 'purchase'] for learning how fast things run out
  const ranOut = new Map(); // מ19: a product someone is in charge of, marked out by someone else: { id, name, responsible }
  let offList = 0, waste = 0, mainProduct = null, type = opts.type || null;
  const finished = []; // names that left the list with this "done shopping"

  const snapP = (id) => { if (!(id in before.products) && !created.products.includes(id)) { const orig = S.products.find((p) => p.id === id); before.products[id] = orig ? { ...orig } : null; } };
  const snapB = (id) => { if (!(id in before.batches)) before.batches[id] = S.batches.filter((b) => b.product_id === id).map((b) => ({ ...b })); touchedBatches.add(id); };
  const snapI = (id) => { if (!(id in before.list_items) && !created.list_items.includes(id)) { const orig = S.items.find((i) => i.id === id); before.list_items[id] = orig ? { ...orig } : null; } };
  // 0b: a person may only act on what they see; another's private product or line is as if it isn't there (the server's own runs see all)
  const mayTouch = (privateTo, productId) => user.id == null || (sees(user, privateTo) && (productId == null || sees(user, products.get(Number(productId))?.private_to)));
  const getP = (id) => { const p = products.get(Number(id)); if (!p || !mayTouch(p.private_to)) throw new Error('המוצר הזה כבר לא במלאי'); return p; };
  const getI = (id) => { const i = items.get(Number(id)); return i && mayTouch(i.private_to, i.product_id) ? i : null; };
  const openItemFor = (pid) => [...items.values()].find((i) => i.product_id === pid && i.status === 'open' && !deletedItems.has(i.id));
  const anyItemFor = (pid) => [...items.values()].find((i) => i.product_id === pid && i.status !== 'done' && !deletedItems.has(i.id));

  const addItem = (fields) => {
    const id = newId();
    // a child's list line waits for a grown-up; what the house itself adds (it ran out) doesn't
    const approved = user.role === 'child' && fields.source !== 'auto' && fields.source !== 'reported' ? 0 : 1;
    // a line for a private product is private too (0b)
    const private_to = fields.product_id ? products.get(fields.product_id)?.private_to ?? null : fields.private_to ?? null;
    items.set(id, { id, product_id: null, text: null, store: 'super', source: 'manual', status: 'open', added_by: user.id, added: now, checked_by: null, checked: null, bought_qty: null, approved, skipped: 0, ...fields, private_to });
    created.list_items.push(id);
    return id;
  };
  const removeItem = (id) => { snapI(id); deletedItems.add(id); };
  // the writer's own product of a shared one's name: the one they have privately, or a new one (the owner 02/10, question 21,
  // option (א)); also what a secret does to the shared one (mineOf, 04/10)
  const mineFor = (shared) => [...products.values()].find((x) => !x.deleted && x.private_to === user.id && norm(x.name) === norm(shared.name)) || (() => {
    const id = newId();
    // counted the way the shared one is ("ביצים" in packs of 12 stays in packs, פ7, the owner 06/10, r7b)
    const p = { id, name: shared.name, aliases: '[]', category_id: shared.category_id ?? null, location_id: shared.location_id ?? null, count_type: shared.count_type || 'units', unit: shared.unit ?? null, pack_size: shared.pack_size ?? null, qty: 0, level: null, is_open: 0, is_basic: 0, store: shared.store || 'super', created: now, updated: now, updated_by: user.id, deleted: null, private_to: user.id };
    Object.assign(p, levelToCount(p, false));
    products.set(id, p); created.products.push(id);
    return p;
  })();
  const target = (a) => (a.mineOf != null ? mineFor(getP(a.mineOf)) : getP(a.product_id));

  /** Keep the list in step with a product: auto items appear/disappear with the basic rule. */
  const syncList = (p, reported = false, lastSpare = false) => {
    const need = listNeed(p);
    const item = anyItemFor(p.id);
    // bought once for guests, or chametz during Passover: running out doesn't bring it back by itself
    const quiet = p.occasional || (HOUSE.pesach && passoverOut(p));
    if (need && !item) addItem({ product_id: p.id, store: storeOf(p), source: 'auto' });
    else if (!need && reported && !item && !quiet && (isOut(p) || lastSpare) && !(p.reserve_qty > 0)) addItem({ product_id: p.id, store: storeOf(p), source: 'reported' });
    else if (!need && item && item.source === 'auto' && item.status === 'open') removeItem(item.id);
  };

  const opOn = (p, op) => {
    snapP(p.id); if (p.count_type === 'batches') snapB(p.id);
    const r = applyOp(p, op, now, batches.get(p.id) || []);
    Object.assign(p, r.product, { updated: now, updated_by: user.id });
    if (p.count_type === 'batches') batches.set(p.id, r.batches);
  };

  for (const a of actions) {
    switch (a.kind) {
      case 'create': {
        const f = cleanProduct(a.product || {}, S);
        if (user.role === 'child') delete f.owner; // a child's "שלי" goes through a grown-up (מ3)
        if (!f.name) throw new Error('צריך לתת למוצר שם');
        if (sameName(f.name, undefined, privateFor(user, a, f.name) != null)) throw new Error(`כבר יש מוצר בשם "${f.name}". אם זה מוצר אחר, איך הוא שונה? (טעם, צבע, גודל)`); // a private one of its own beside a shared one (question 21)
        if (fromModel) shopRule(f); // home18 (5): the category by its name when it's missing or "אחר", and the store by the house's answer
        if (f.location_id == null && f.category_id != null && S.locations.some((l) => l.id === learnedPlace.get(Number(f.category_id)))) f.location_id = learnedPlace.get(Number(f.category_id));
        const id = newId();
        const p = { id, aliases: '[]', count_type: 'units', qty: 0, level: null, is_open: 0, is_basic: 0, store: 'super', created: now, updated: now, updated_by: user.id, deleted: null, ...f, private_to: privateFor(user, a, f.name) };
        if (p.private_to != null) p.owner = null; // private isn't "of someone" (P8): only they see it at all
        if (a.event && !p.is_basic) p.occasional = 1; // bought for guests / a holiday: not something the house keeps
        if (HOUSE.pesach && p.chametz == null) p.chametz = CHAMETZ_WORDS.test(p.name) ? 1 : 0;
        if (HOUSE.pesach && p.kitniyot == null) p.kitniyot = KITNIYOT_WORDS.test(p.name) ? 1 : 0; // c11
        Object.assign(p, levelToCount(p, f.qty != null || !!a.reported));
        products.set(id, p); created.products.push(id);
        // it was on the list as a one-off ("tomatoes"): that line is this product now
        for (const i of items.values()) {
          // only a line of the same privacy: never another's private line, or a shared one, into a private product (0b)
          if (!i.product_id && i.status === 'open' && !deletedItems.has(i.id) && (i.private_to ?? null) === (p.private_to ?? null) && norm(i.text) === norm(p.name)) {
            if (listNeed(p) || isOut(p)) { snapI(i.id); Object.assign(i, { product_id: id, text: null }); } else removeItem(i.id);
          }
        }
        if (p.count_type === 'batches' && p.qty > 0) { batches.set(id, [{ qty: p.qty, bought: now, expires: p.shelf_days ? now + p.shelf_days * 86400e3 : null }]); touchedBatches.add(id); before.batches[id] = []; }
        else if (p.shelf_days && !isOut(p) && p.expires == null) p.expires = now + p.shelf_days * 86400e3;
        if (a.bought) { // bought now, was not on any list
          if (context(opts) === 'shopping') offList++;
        }
        syncList(p, !!a.reported);
        // "תוסיף 2 עגבניות לרשימה" when there were none: the line keeps how many (15/10, row 3)
        if (a.listed && Number(a.amount) > 0) for (const i of items.values()) if (i.product_id === id && created.list_items.includes(i.id)) Object.assign(i, { want: Number(a.amount), want_unit: WEIGHTS.includes(a.unit) ? a.unit : null }); // as list_add keeps it
        // something new a child says ran out waits for a grown-up on the list, like anything else a child adds (decision 38)
        if (user.role === 'child') for (const i of items.values()) if (i.product_id === id && created.list_items.includes(i.id)) i.approved = 0;
        if (a.bought && !a.event) log.push([id, 'purchase']); else if (a.reported) log.push([id, 'out']);
        say(a.bought ? byPerson(user, 'קנה', 'קנתה', 'קנו') : byPerson(user, 'הוסיף למלאי', 'הוסיפה למלאי', 'הוסיפו למלאי'), a.bought ? `${p.name} (חדש)` : p.name);
        mainProduct ??= id; type ??= 'create';
        break;
      }
      case 'edit': {
        const p = target(a); snapP(p.id);
        const f = cleanProduct(a.fields || {}, S, opts.part === 'private');
        if (user.role === 'child' || p.private_to != null) delete f.owner; // a child asks a grown-up (מ3); private has no owner
        if (f.name && sameName(f.name, p.id, p.private_to === user.id)) throw new Error(`כבר יש מוצר בשם "${f.name}"`); // her private one beside a shared one (question 21)
        if (f.count_type && f.count_type !== p.count_type) { snapB(p.id); batches.set(p.id, f.count_type === 'batches' && p.qty > 0 ? [{ qty: p.qty, bought: now, expires: p.expires }] : []); }
        // מ7: a brand taken off takes "only that brand" with it; "only" with no brand at all isn't kept
        if (f.brand === null) f.only_brand = 0;
        if (f.only_brand && !(f.brand ?? p.brand)) delete f.only_brand;
        Object.assign(p, f, { updated: now, updated_by: user.id });
        if (f.qty != null || f.level != null || f.is_open != null) p.counted = now; // corrected by hand = counted
        if (p.count_type === 'batches') { snapB(p.id); if (f.qty != null) { const r = applyOp(p, { type: 'set', qty: f.qty }, now, batches.get(p.id) || []); batches.set(p.id, r.batches); p.qty = r.product.qty; } }
        syncList(p);
        say(byPerson(user, 'עדכן', 'עדכנה', 'עדכנו'), p.name); mainProduct ??= p.id; type ??= 'edit';
        break;
      }
      case 'delete': {
        if (user.role === 'child') throw new Error('רק מבוגר יכול למחוק מוצרים מהמלאי');
        const p = getP(a.product_id);
        // r10 q015: a product of one person goes only by them or a manager; a shared one, any grown-up (D15, approved 02/10)
        const owner = S.products.find((x) => x.id === p.id)?.owner; // as it was before this change (an edit of the owner on the same card doesn't open it)
        const no = deleteBlocked({ ...p, owner }, S.users, user); if (no) throw new Error(no);
        snapP(p.id);
        p.deleted = now; p.updated = now; p.updated_by = user.id;
        for (const i of items.values()) if (i.product_id === p.id && i.status !== 'done') removeItem(i.id);
        say(byPerson(user, 'מחק', 'מחקה', 'מחקו'), p.name); mainProduct ??= p.id; type ??= 'delete';
        break;
      }
      case 'op': {
        const p = target(a);
        const op = { ...a.op };
        const listed = anyItemFor(p.id);
        if (op.type === 'purchase' && op.amount == null && op.qty == null) op.amount = listed ? (listed.want_unit ? 1 : listed.want ?? suggestedBuy(p)) : 1;
        // a big buy (a sale, stocking up) or one for the hosting list: the stock goes up, the pace isn't learned from it
        // a big buy, in units when they were said ("30 ביצים" against one tray on the list isn't one; מ33, question 49's point 2)
        const usual = Math.max(1, listed?.want_unit ? 1 : listed?.want ?? suggestedBuy(p));
        if (op.type === 'purchase' && ((op.units != null && p.pack_size > 1 ? op.units >= 3 * usual * p.pack_size : op.amount >= 3 * usual) || isEventStore(listed?.store))) op.event = true;
        // "I returned the shampoo": gone like a toss, but it isn't waste and the buy it undoes doesn't teach the pace
        const ret = op.type === 'return';
        const wasOut = isOut(p); // מ19: ran out now, not before
        opOn(p, ret ? { ...op, type: 'discard', amount: p.count_type === 'level' ? null : op.amount ?? 1 } : op);
        if (op.type === 'discard') waste = 1;
        if (ret) log.push([p.id, 'return']);
        // bought for guests / a holiday meal: stock goes up, but it doesn't teach Shuki how fast things run out
        if (op.type === 'out' || (op.type === 'purchase' && !op.event)) log.push([p.id, op.type]);
        if (op.type === 'purchase') {
          const item = anyItemFor(p.id);
          // units said ("10 ביצים", the owner 04/10): the line remembers them, so taking it out of the cart takes back just those
          const units = p.count_type === 'pack' && op.units != null ? Number(op.units) : null;
          const unitsOf = (i) => i.bought_units ?? (i.bought_qty || 0) * (p.pack_size || 1);
          if (item && item.status === 'checked') { snapI(item.id); if (p.count_type === 'pack') item.bought_units = unitsOf(item) + (units ?? (op.amount ?? 1) * (p.pack_size || 1)); item.bought_qty = (item.bought_qty || 0) + (op.amount ?? 1); } // already in the cart: this is more of it (a receipt with more than was ticked)
          else if (item) { snapI(item.id); if (inStore && tripStore) item.store = tripStore; Object.assign(item, { status: inStore ? 'checked' : 'done', checked_by: user.id, checked: now, bought_qty: op.amount ?? suggestedBuy(p), ...(units != null && { bought_units: units }) }); }
          else if (context(opts) === 'shopping') offList++;
        }
        // the last spare was just opened ("we opened the last soap"): time to buy, basic or not
        const lastSpare = op.type === 'open' && p.count_type === 'inuse' && !(p.qty > 0);
        syncList(p, op.type === 'out' || op.type === 'low' || (op.type === 'set' && isOut(p) && !wasOut && String(opts.opId || '').startsWith('proposal:')) /* a correction to "none" on a card: decision 1, as the card says (row 8); not the count sheet (the reviewer) */ || ((op.type === 'discard' || ret) && isOut(p)) || lastSpare, lastSpare);
        if (isOut(p) && !wasOut && op.type !== 'purchase' && p.responsible != null && p.responsible !== user.id && p.private_to == null) ranOut.set(p.id, { id: p.id, name: p.name, responsible: p.responsible });
        // "mom brought lots of tomatoes": a correction that says there is enough takes it off the list, whoever put it there
        if (op.type === 'set' && !isOut(p) && !listNeed(p)) { const it = openItemFor(p.id); if (it) removeItem(it.id); }
        if (op.event) say(byPerson(user, 'קנה לאירוח', 'קנתה לאירוח', 'קנו לאירוח'), p.name);
        const verb = op.event ? null : {
          out: byPerson(user, 'סימן שנגמר', 'סימנה שנגמר', 'סימנו שנגמר'), low: byPerson(user, 'סימן שכמעט נגמר', 'סימנה שכמעט נגמר', 'סימנו שכמעט נגמר'), use: byPerson(user, 'השתמש ב', 'השתמשה ב', 'השתמשו ב'),
          open: byPerson(user, 'פתח', 'פתחה', 'פתחו'), purchase: byPerson(user, 'קנה', 'קנתה', 'קנו'), discard: byPerson(user, 'זרק', 'זרקה', 'זרקו'), return: byPerson(user, 'החזיר לחנות את', 'החזירה לחנות את', 'החזירו לחנות את'), set: byPerson(user, 'עדכן כמות:', 'עדכנה כמות:', 'עדכנו כמות:'),
        }[op.type] || op.type;
        if (verb) say(verb.endsWith(' ב') ? verb.slice(0, -2) : verb, verb.endsWith(' ב') ? `ב${p.name}` : p.name);
        mainProduct ??= p.id; type ??= op.type;
        break;
      }
      case 'list_add': {
        const want = a.amount != null && Number(a.amount) > 0 ? Number(a.amount) : null; // "add 2 milk"
        const want_unit = want && WEIGHTS.includes(a.unit) ? a.unit : null; // "half a kilo of ground beef"
        // the product is shared but this addition is private (question 21): the writer's own line, by name
        const sharedButMine = (p) => p && p.private_to == null && privateFor(user, a, p.name);
        const textNamed = !a.product_id && [...products.values()].find((x) => !x.deleted && x.private_to == null && (norm(x.name) === norm(a.text || '') || norm(x.name) === norm(a.text || '').replace(/^ה/, '')));
        const shared = a.product_id ? getP(a.product_id) : textNamed;
        const pid = shared && sharedButMine(shared) ? mineFor(shared).id : a.product_id || null;
        const textIn = a.text;
        if (pid) {
          const p = getP(pid);
          const ex = anyItemFor(p.id);
          if (ex && ex.status === 'open') { if (want && (ex.want !== want || ex.want_unit !== want_unit)) { snapI(ex.id); ex.want = want; ex.want_unit = want_unit; say(byPerson(user, 'עדכן כמות ברשימה:', 'עדכנה כמות ברשימה:', 'עדכנו כמות ברשימה:'), p.name); } break; }
          addItem({ product_id: p.id, store: STORES.includes(a.store) ? a.store : storeOf(p), source: 'manual', want, want_unit, ...(a.ordered ? { ordered: now } : {}) });
          say(byPerson(user, 'הוסיף לרשימה', 'הוסיפה לרשימה', 'הוסיפו לרשימה'), p.name);
        } else {
          const text = String(textIn || '').trim().slice(0, 80);
          if (!text) throw new Error('מה להוסיף?');
          // typed text that is a product we know: add the product (not a one-off that won't update the stock)
          const aliasOf = (x) => { try { return JSON.parse(x.aliases || '[]').map(norm); } catch { return []; } }; // home18 (6): a merged product's other name
          const byName = (x) => !x.deleted && sees(user, x.private_to) && (norm(x.name) === norm(text) || norm(x.name) === norm(text).replace(/^ה/, '') || aliasOf(x).includes(norm(text)) || aliasOf(x).includes(norm(text).replace(/^ה/, '')));
          const known = [...products.values()].find((x) => byName(x) && x.private_to === user.id) || [...products.values()].find(byName); // the writer's own first
          if (known) {
            const ex = anyItemFor(known.id);
            if (!(ex && ex.status === 'open')) { addItem({ product_id: known.id, store: STORES.includes(a.store) ? a.store : storeOf(known), source: 'manual', want, want_unit }); say(byPerson(user, 'הוסיף לרשימה', 'הוסיפה לרשימה', 'הוסיפו לרשימה'), known.name); }
            else if (want && (ex.want !== want || ex.want_unit !== want_unit)) { snapI(ex.id); ex.want = want; ex.want_unit = want_unit; say(byPerson(user, 'עדכן כמות ברשימה:', 'עדכנה כמות ברשימה:', 'עדכנו כמות ברשימה:'), known.name); }
          } else if (![...items.values()].some((i) => !i.product_id && i.status === 'open' && !deletedItems.has(i.id) && (i.private_to ?? null) === (privateFor(user, a, text) ?? null) && norm(i.text) === norm(text))) {
            // both phones typed "baking paper": one line
            const byName = fromModel && storesFor(categoryByName(text), HOUSE.shop); // home18 (5): a one-off line goes where the house buys it
            addItem({ text, store: byName ? byName.store : STORES.includes(a.store) ? a.store : 'super', source: 'manual', want, want_unit, private_to: privateFor(user, a, text) });
            say(byPerson(user, 'הוסיף לרשימה', 'הוסיפה לרשימה', 'הוסיפו לרשימה'), text);
          }
        }
        type ??= 'list_add';
        break;
      }
      case 'list_remove': {
        const i = getI(a.item_id); if (!i) throw new Error('המוצר הזה כבר לא ברשימה');
        removeItem(i.id); say(byPerson(user, 'הסיר מהרשימה', 'הסירה מהרשימה', 'הסירו מהרשימה'), i.product_id ? products.get(i.product_id)?.name : i.text); type ??= 'list_remove';
        break;
      }
      case 'order': { // ordered online: it stays on the list, greyed, so nobody buys it again on the way
        const i = getI(a.item_id); if (!i) throw new Error('המוצר הזה כבר לא ברשימה');
        if (i.status !== 'open' || !i.ordered === !!a.off) break;
        snapI(i.id); i.ordered = a.off ? null : now;
        say(a.off ? byPerson(user, 'ביטל הזמנה של', 'ביטלה הזמנה של', 'ביטלו הזמנה של') : byPerson(user, 'הזמין במשלוח', 'הזמינה במשלוח', 'הזמינו במשלוח'), i.product_id ? products.get(i.product_id)?.name : i.text); type ??= 'edit';
        break;
      }
      case 'check': // bought from the list
      case 'arrived': { // the delivery came: bought, and done at once (no cart to close)
        const i = getI(a.item_id); if (!i) throw new Error('המוצר הזה כבר לא ברשימה');
        if (i.status !== 'open') break;
        if (!i.approved) throw new Error('המוצר הזה עוד מחכה לאישור');
        snapI(i.id);
        if (a.store && STORES.includes(a.store)) i.store = a.store; // bought here ("from here too"): it closes with this store's trip
        if (i.product_id) {
          const p = getP(i.product_id);
          const listed = i.want_unit ? 1 : i.want ?? suggestedBuy(p); // what the list asked for, before this purchase changes the stock
          const amount = a.amount == null ? listed : Number(a.amount);
          if (i.want == null && !i.want_unit && a.kind === 'check') i.want = listed; // decision 174: what's short stays on the list at the end
          opOn(p, { type: 'purchase', amount, ...(a.units != null && p.count_type === 'pack' && { units: Number(a.units) }) });
          // for the hosting list, or far more than usual: not how fast the house uses it
          // in units when they were said (מ33): "30 ביצים" in the cart against one tray isn't a big buy
          const usualC = Math.max(1, i.want_unit ? 1 : i.want ?? suggestedBuy(p));
          if (!isEventStore(i.store) && (a.units != null && p.count_type === 'pack' && p.pack_size > 1 ? Number(a.units) < 3 * usualC * p.pack_size : amount < 3 * usualC)) log.push([p.id, 'purchase']);
          i.bought_qty = amount;
          if (p.count_type === 'pack') i.bought_units = a.units != null ? Number(a.units) : null; // so un-checking takes back what was really added
          say(a.kind === 'arrived' ? byPerson(user, 'קיבל במשלוח', 'קיבלה במשלוח', 'קיבלו במשלוח') : byPerson(user, 'קנה', 'קנתה', 'קנו'), p.name); mainProduct ??= p.id;
        } else say(a.kind === 'arrived' ? byPerson(user, 'קיבל במשלוח', 'קיבלה במשלוח', 'קיבלו במשלוח') : byPerson(user, 'קנה', 'קנתה', 'קנו'), i.text);
        Object.assign(i, { status: a.kind === 'arrived' ? 'done' : 'checked', checked_by: user.id, checked: now, ordered: null });
        type ??= 'purchase';
        break;
      }
      case 'uncheck': {
        const i = getI(a.item_id); if (!i || i.status !== 'checked') break;
        snapI(i.id);
        if (i.product_id && i.bought_qty) {
          const p = getP(i.product_id);
          const back = p.count_type === 'pack' ? (i.bought_units ?? i.bought_qty * (p.pack_size || 1)) : i.bought_qty;
          opOn(p, p.count_type === 'level' ? { type: 'set', level: 'little' } : { type: 'use', amount: back });
        }
        Object.assign(i, { status: 'open', checked_by: null, checked: null, bought_qty: null, bought_units: null });
        say(byPerson(user, 'הוציא מהעגלה את', 'הוציאה מהעגלה את', 'הוציאו מהעגלה את'), i.product_id ? products.get(i.product_id)?.name : i.text); type ??= 'edit';
        break;
      }
      case 'approve': { // a grown-up answers a child's request: yes (it's on the list) or no (gone)
        const i = getI(a.item_id); if (!i) throw new Error('המוצר הזה כבר לא ברשימה');
        if (user.role === 'child') throw new Error('רק מבוגר יכול לאשר');
        if (i.approved) break;
        snapI(i.id);
        const nm = i.product_id ? products.get(i.product_id)?.name : i.text;
        if (a.yes) { i.approved = 1; say(byPerson(user, 'אישר לרשימה', 'אישרה לרשימה', 'אישרו לרשימה'), nm); } else { removeItem(i.id); say(byPerson(user, 'לא אישר', 'לא אישרה', 'לא אישרו'), nm); }
        type ??= 'list_add';
        break;
      }
      case 'keep': { // "still want it" after three trips without it
        const i = getI(a.item_id); if (!i) throw new Error('המוצר הזה כבר לא ברשימה');
        snapI(i.id); i.skipped = 0; say(byPerson(user, 'השאיר ברשימה', 'השאירה ברשימה', 'השאירו ברשימה'), i.product_id ? products.get(i.product_id)?.name : i.text); type ??= 'edit';
        break;
      }
      case 'confirm': { // recount: "yes, that's still right" — nothing changes but the date it was last counted
        const p = getP(a.product_id); snapP(p.id);
        p.counted = now;
        say(byPerson(user, 'אישר שעדיין יש', 'אישרה שעדיין יש', 'אישרו שעדיין יש'), p.name); mainProduct ??= p.id; type ??= 'confirm';
        break;
      }
      case 'finish': { // shopping done: checked -> done
        const short = [];
        // only what this person ticked (decision 44, r0t d44): someone else in the same store finishes their own
        const ticked = (i) => user.id == null || i.checked_by == null || i.checked_by === user.id;
        for (const i of items.values()) if (i.status === 'checked' && (!a.store || i.store === a.store) && ticked(i)) {
          snapI(i.id); i.status = 'done';
          // what's said about the trip (the push, its summary, the reply) never names a private line (0b)
          if (i.private_to == null && !(i.product_id && products.get(i.product_id)?.private_to != null)) finished.push(i.product_id ? products.get(i.product_id)?.name : i.text);
          // decision 174: bought fewer than the list said: the rest stays on the list
          const p = i.product_id && products.get(i.product_id);
          const wanted = p && !i.want_unit && p.count_type !== 'level' ? i.want ?? suggestedBuy(p) : 0;
          if (p && i.bought_qty > 0 && wanted > i.bought_qty) short.push({ product_id: p.id, store: i.store, source: 'manual', want: wanted - i.bought_qty, approved: 1 });
        }
        for (const f of short) addItem(f);
        // a real trip to this store that ended without an open line: one more "skipped" (after three, Shuki asks)
        if (finished.length && a.store) for (const i of items.values()) if (i.status === 'open' && i.approved && !i.ordered && i.store === a.store && !deletedItems.has(i.id) && !created.list_items.includes(i.id)) { snapI(i.id); i.skipped = (i.skipped || 0) + 1; }
        say(`${byPerson(user, 'סיים', 'סיימה', 'סיימו')} קניות${a.store ? ` ב${STORE_NAMES[a.store]}` : ''}`, ''); type ??= 'finish';
        break;
      }
      default:
        throw new Error(`פעולה לא מוכרת: ${a.kind}`);
    }
  }

  // --- write ---
  const stmts = [];
  for (const l of newPlaces) stmts.push(db.prepare('INSERT OR IGNORE INTO locations (id, name, sort) VALUES (?, ?, ?)').bind(l.id, l.name, l.sort));
  const dirtyP = new Set([...Object.keys(before.products).map(Number), ...created.products]);
  for (const id of dirtyP) stmts.push(upsert(db, 'products', products.get(id)));
  for (const pid of touchedBatches) {
    stmts.push(db.prepare('DELETE FROM batches WHERE product_id = ?').bind(pid));
    for (const b of batches.get(pid) || []) stmts.push(upsert(db, 'batches', { id: b.id ?? newId(), product_id: pid, qty: b.qty, bought: b.bought, expires: b.expires ?? null }));
  }
  const dirtyI = new Set([...Object.keys(before.list_items).map(Number), ...created.list_items]);
  // nothing said and nothing changed ("uncheck" on a line that was closed, any other break): no empty line in the journal (פ8)
  if (!lines.length && !dirtyP.size && !dirtyI.size && !touchedBatches.size && !newPlaces.length) return { eventId: null, summary: '', created: [], added: [], finished: [], nothing: true };
  for (const id of dirtyI) {
    if (deletedItems.has(id)) { if (!created.list_items.includes(id)) stmts.push(db.prepare('DELETE FROM list_items WHERE id = ?').bind(id)); }
    else stmts.push(upsert(db, 'list_items', items.get(id)));
  }
  const agree = (l) => (/נגמר$/.test(l.verb) && l.objs.length ? l.verb.replace(/נגמר$/, l.objs.length > 1 ? 'נגמרו' : byGender(l.objs[0], 'נגמר', 'נגמרה', 'נגמרו')) : l.verb); // "סימנה שנגמרו עגבניות"
  const summary = `${user.name} ${lines.map((l) => (l.objs.length ? `${agree(l)} ${joinHe(l.objs)}` : l.verb)).join(', ')}`.slice(0, 300);
  const eventId = newId();
  // source: 'mapping' / 'onboarding' (migration 0035, the owner 16/10): not counted for Shuki's levels
  stmts.push(db.prepare('INSERT INTO events (id, op_id, ts, user_id, type, product_id, summary, off_list, waste, before, private_to, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(eventId, opts.opId || null, now, user.id, type || 'edit', mainProduct, summary, offList, waste,
      JSON.stringify({ ...before, created: { products: created.products, list_items: created.list_items.filter((id) => !deletedItems.has(id)) } }), opts.part === 'private' ? opts.privateTo ?? user.id : null, ['mapping', 'onboarding'].includes(opts.source) ? opts.source : null));
  for (const [pid, kind] of log) stmts.push(db.prepare('INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (?,?,?,?)').bind(eventId, now, pid, kind));
  await db.batch(stmts);
  // new list lines (typed, or because something ran out) — the shopper in the store hears about them
  // never a private line, also one that came back by itself (bought fewer than wanted at "done shopping")
  const added = created.list_items.filter((id) => !deletedItems.has(id)).map((id) => items.get(id)).filter((i) => i.private_to == null && !(i.product_id && products.get(i.product_id)?.private_to != null))
    .map((i) => (i.product_id ? products.get(i.product_id)?.name : i.text)).filter(Boolean);
  // what's private teaches no pattern and tells no shopper (0b)
  if (opts.part !== 'private') await observe(env, user, actions, now);
  // מ19: on the list now (an occasional product isn't): the push says so only then
  const outs = opts.part === 'private' ? [] : [...ranOut.values()].map((x) => ({ ...x, listed: [...items.values()].some((i) => i.product_id === x.id && i.status === 'open') }));
  return { eventId, ...(opts.part === 'private' && lines.length && { privateDone: true }), summary: opts.part === 'private' ? '' : summary, created: created.products, items: created.list_items.filter((id) => !deletedItems.has(id)), added: opts.part === 'private' ? [] : added, finished: finished.filter(Boolean), ...(outs.length && { ranOut: outs }) };
}

/** D15: a grown-up who may not delete this product gets the words why (execute, and the product's page: q17); else null. */
export function deleteBlocked(p, users, user) {
  const owner = p.owner;
  if (owner != null && owner !== user.id && user.role !== 'admin' && user.id != null && users.some((u) => u.id === owner && u.active !== 0 && u.role !== 'child')) return onlyTheyDelete(p, users, owner);
  return null;
}
/** D15 (approved 02/10; stage 5 b02, "את המוצר הזה"): who may delete a product that is one person's. */
export function onlyTheyDelete(p, users, ownerId = p.owner) {
  const owner = users.find((u) => u.id === ownerId);
  const admins = users.filter((u) => u.role === 'admin' && u.active !== 0);
  if (owner && admins.length === 1 && admins[0].id === owner.id) return `את המוצר הזה רק ${owner.name} ${byPerson(owner, 'יכול', 'יכולה', 'יכולים')} למחוק.`;
  const other = admins.filter((u) => u.id !== owner?.id);
  const women = other.length === 1 && isWoman(owner) && isWoman(other[0]); // ש11 (05/10): two women, "יכולות"; several managers, "מנהל הבית"
  return `את המוצר הזה רק ${owner.name} או ${other.length === 1 ? other[0].name : 'מנהל הבית'} ${women ? 'יכולות' : 'יכולים'} למחוק.`;
}

const context = (opts) => opts.context || 'report';
export const WEIGHTS = ['ק"ג', 'גרם'];
// the hosting list is a store of its own, marked as an event ("Friday hosting")
const isEventStore = (id) => typeof id === 'string' && id.startsWith('e') && !!EVENT_STORES[id];

/** Undo the user's latest not-yet-undone event. */
export async function undoLast(env, user, { onlyPrivate = false, now = Date.now() } = {}) {
  const db = env.DB;
  const ev = await db.prepare("SELECT * FROM events WHERE user_id = ? AND undone IS NULL AND type != 'undo' AND before IS NOT NULL ORDER BY ts DESC, id DESC LIMIT 1").bind(user.id).first();
  // after a secret, only an action that was hers alone, checked on the row that is undone (פ29): else nothing to update
  if (onlyPrivate && (!ev || ev.private_to == null)) return { nothing: true };
  if (!ev) return null;
  const b = JSON.parse(ev.before);
  // Don't silently erase what the other person did after me: if they changed the same product since, refuse.
  // (and a product I created that someone else has since bought or changed isn't deleted with my undo: QA, Q-3)
  const touched = [...Object.keys(b.products || {}).map(Number), ...(b.created?.products || []).map(Number)];
  if (touched.length) {
    // one JSON value, not a ? per product: D1 takes at most 100 variables, and an action can touch 300 products (X8)
    const rows = (await db.prepare(`SELECT p.name, p.updated, u.name AS who, u.gender FROM products p LEFT JOIN users u ON u.id = p.updated_by WHERE p.id IN (SELECT value FROM json_each(?)) AND p.updated > ? AND p.updated_by != ?`).bind(JSON.stringify(touched), ev.ts, user.id).all()).results;
    if (rows.length) return { conflict: `${rows[0].who} ${byPerson(rows[0], 'שינה', 'שינתה', 'שינו')} בינתיים את ${rows[0].name}. אפשר לתקן במסך המלאי.` };
  }
  // a product that no longer exists (a private one of someone who left, question 105) isn't made again, nor its batches or
  // list lines: they're skipped (the owner 07/10)
  const named = [...Object.keys(b.products || {}), ...Object.keys(b.batches || {}), ...Object.values(b.list_items || {}).map((r) => r?.product_id)].filter((x) => x != null).map(Number);
  const there = new Set(named.length ? (await db.prepare('SELECT id FROM products WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(named)).all()).results.map((r) => r.id) : []);
  const stmts = [];
  for (const [id, row] of Object.entries(b.products || {})) if (!row || there.has(Number(id))) stmts.push(row ? upsert(db, 'products', row) : db.prepare('DELETE FROM products WHERE id = ?').bind(Number(id)));
  for (const [pid, rows] of Object.entries(b.batches || {})) {
    if (!there.has(Number(pid))) continue;
    stmts.push(db.prepare('DELETE FROM batches WHERE product_id = ?').bind(Number(pid)));
    for (const r of rows) stmts.push(upsert(db, 'batches', r));
  }
  for (const [id, row] of Object.entries(b.list_items || {})) if (!row?.product_id || there.has(Number(row.product_id))) stmts.push(row ? upsert(db, 'list_items', row) : db.prepare('DELETE FROM list_items WHERE id = ?').bind(Number(id)));
  for (const id of b.created?.list_items || []) stmts.push(db.prepare('DELETE FROM list_items WHERE id = ?').bind(id));
  for (const id of b.created?.products || []) {
    stmts.push(db.prepare('DELETE FROM batches WHERE product_id = ?').bind(id));
    stmts.push(db.prepare('DELETE FROM list_items WHERE product_id = ?').bind(id));
    stmts.push(db.prepare('DELETE FROM products WHERE id = ?').bind(id));
  }
  stmts.push(db.prepare('DELETE FROM product_log WHERE event_id = ?').bind(ev.id));
  stmts.push(db.prepare('UPDATE events SET undone = ? WHERE id = ?').bind(now, ev.id));
  // the undo of a private line is private too (0b)
  stmts.push(db.prepare("INSERT INTO events (id, ts, user_id, type, summary, private_to) VALUES (?,?,?,'undo',?,?)").bind(newId(), now, user.id, `${user.name} ${byPerson(user, 'ביטל', 'ביטלה', 'ביטלו')}: ${ev.summary.replace(`${user.name} `, '')}`, ev.private_to ?? null));
  await db.batch(stmts);
  return { undone: ev.id, summary: ev.summary };
}
