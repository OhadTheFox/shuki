import { amount, daysText, of, genderOf, byGender, unitForms } from '../public/hebrew.js';
// Pure inventory rules. No database, no clock: `now` is always passed in.
// Tested with `node --test test/`.

export const DAY = 86400e3;
/** A place that is a freezer: any whose name has "מקפיא" in it ("המקפיא", "מקפיא במרפסת"; decision 83, r0t d83). */
export const isFreezer = (name) => /מקפיא/.test(String(name || ''));
export const BASE_STORES = ['super', 'pharm', 'greengrocer'];
export const STORES = [...BASE_STORES];
export const STORE_NAMES = { super: 'סופר', pharm: 'פארם', greengrocer: 'ירקן' };
// Passover: what's made of wheat, barley, rye, oats or spelt (a first guess by name)
const CHAMETZ_BASE = /לחם|לחמני|פית[הו]|(^|\s)חל(ה|ות)($|\s)|בייגל|פסטה|ספגטי|פתיתים|קוסקוס|בורגול|קמח|בירה|וויסקי|ויסקי|עוגי|עוגה|עוגת|קרקר|פריכיות? (חיטה|כוסמין)|דגני|קורנפלקס|גרנולה|שיבולת|ביסלי|פרצל|בורקס|פיצה|מאפ|קרואסון|לזניה|אטריות|נודלס|שקדי מרק|פירורי לחם|ופל|וופל|כוסמין|שעורה|גריסים|מלוואח|ג'חנון|בצק/;
// "קמח מצה", "מצות", what is "לפסח" isn't chametz, whatever else is in its name (stage 9, מ14)
export const PESACH_OK = /מצה|מצות|לפסח/;
export const CHAMETZ_WORDS = { test: (name) => !PESACH_OK.test(String(name)) && CHAMETZ_BASE.test(String(name)), source: CHAMETZ_BASE.source };
// and kitniyot (c11, r0t trim): rice, corn, legumes, seeds (a first guess by name; the model adds what the list misses)
// a reminder's text that is already something to do ("להוציא עוף מהמקפיא"), not a product to buy
export const TODO_RE = /^(לה\S{2,}|לקנות|לנקות|לשלם|לבדוק|לסדר|לזרוק|לשים|לקחת|לתקן|לשלוח|לחדש|לבשל|לאפות|להזמין)(\s|$)/;
/** r0t-7: the same local time on the next calendar day (a clock change doesn't move it by an hour). */
export function sameTimeNextDay(ts, tz = HOUSE.tz) {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ts);
  const [y, m, d] = local(ts, tz).date.split('-').map(Number);
  return localToTs(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10), hm, tz);
}
/** r0t-7: a reminder that isn't for buying (cooking, a task): it leaves "תזכורות" once it went out. */
export const notBuying = (t) => TODO_RE.test(String(t || '').trim()) && !/^לקנות(\s|$)/.test(String(t || '').trim());
export const KITNIYOT_WORDS = /אורז|תירס|פופקורן|שעועית|עדשים|חומוס|אפונה|(^|\s)פול($|\s)|סויה|טופו|שומשום|טחינה|בוטנ|במבה|קטניות|דוחן|כוסמת|חרדל/;
/** Passover mode keeps it off the list: chametz, and kitniyot in a house that doesn't eat them on Passover (c11). */
export const passoverOut = (p) => !!p.chametz || (HOUSE.noKitniyot && !!p.kitniyot);
/** House-wide settings the rules depend on: the household's own stores (a butcher, a deli) and Passover mode. Set once per request. */
export const HOUSE = { pesach: false, noKitniyot: false, tz: 'Asia/Jerusalem', name: 'הבית', roommates: false, notes: '', shop: {} };
export const EVENT_STORES = {}; // id → { until }: hosting lists
/** The house's own stores and hosting lists as they are kept in settings.stores, every field carried over (a hosting's
 * `until` and its guests' `note`, ב7); `skip`: ids left out. One builder for every place that writes them again. */
export const extraStores = (skip = []) => STORES.filter((k) => !BASE_STORES.includes(k) && !skip.includes(k))
  .map((k) => ({ id: k, name: STORE_NAMES[k], ...(EVENT_STORES[k] && { until: EVENT_STORES[k].until, ...(EVENT_STORES[k].date && { date: EVENT_STORES[k].date }), ...(EVENT_STORES[k].note && { note: EVENT_STORES[k].note }),
    ...(EVENT_STORES[k].guests?.length && { guests: EVENT_STORES[k].guests }), ...(EVENT_STORES[k].counted?.length && { counted: EVENT_STORES[k].counted }) }) })); // מ27: the guests' food (with who told), what was counted
export function setHouse(settings = {}) {
  let extra = [];
  try { extra = JSON.parse(settings.stores || '[]'); } catch { /* bad row */ }
  STORES.length = 0; STORES.push(...BASE_STORES);
  for (const k of Object.keys(STORE_NAMES)) if (!BASE_STORES.includes(k)) delete STORE_NAMES[k];
  for (const k of Object.keys(EVENT_STORES)) delete EVENT_STORES[k];
  for (const x of extra) if (x && x.id && x.name && !BASE_STORES.includes(x.id)) { STORES.push(x.id); STORE_NAMES[x.id] = x.name; if (x.until) EVENT_STORES[x.id] = { until: x.until, ...(/^\d{4}-\d{2}-\d{2}$/.test(x.date || '') && { date: x.date }), ...(x.note && { note: String(x.note) }), ...(Array.isArray(x.guests) && { guests: x.guests }), ...(Array.isArray(x.counted) && { counted: x.counted }) }; } // note: the guests' restriction, ב7
  HOUSE.pesach = settings.pesach === '1';
  HOUSE.noKitniyot = /^(לא|בלי)/.test(String(settings.kitniyot || '').trim()); // the house's fact "kitniyot" (c11): "לא", "בלי קטניות"
  HOUSE.tz = validTz(settings.tz) ? settings.tz : 'Asia/Jerusalem';
  HOUSE.name = String(settings.house_name || 'הבית');
  HOUSE.roommates = settings.house_mode === 'roommates';
  HOUSE.notes = String(settings.house_notes || '');
  HOUSE.shop = { shop_produce: settings.shop_produce, shop_care: settings.shop_care }; // home18 (5): where the house buys produce and care
}
export function validTz(tz) { if (!tz || typeof tz !== 'string') return false; try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }
export const COUNT_TYPES = ['units', 'pack', 'level', 'inuse', 'batches'];
export const LEVELS = ['plenty', 'little', 'none'];
export const LEVEL_NAMES = { plenty: 'הרבה', little: 'מעט', none: 'אין' };

const round = (n) => Math.round(n * 100) / 100;
const pos = (n) => Math.max(0, round(n));

/** Default target for a basic product when none was given. */
export function defaultTarget(p) {
  if (p.count_type === 'pack') return p.pack_size || 1; // one pack (17/10, ש15; a quarter of one before); bought at half of it (isMissing)
  return 1;
}

/** How much of the product is at home, in its own counting unit (for display and rules). */
export function stock(p) {
  switch (p.count_type) {
    case 'level': return p.level === 'plenty' ? 2 : p.level === 'little' ? 1 : 0;
    case 'inuse': return (p.is_open ? 1 : 0) + (p.qty || 0);
    default: return p.qty || 0;
  }
}

/**
 * A new counted product told as a level ("there's a little milk left"): little = one left and running low,
 * none = out, plenty = some. Used by create and by the proposal card, so both say the same thing.
 */
export function levelToCount(p, qtyGiven) {
  const out = { ...p };
  if (out.count_type === 'level') { if (!out.level) out.level = qtyGiven && !(Number(out.qty) > 0) ? 'none' : 'plenty'; return out; } // added to the list / reported out: none; "חצי קילו בורגול" is some (row 4)
  // "we have rice", no number: one (in use: one open)
  if (!qtyGiven && !out.level) { if (out.count_type === 'inuse') { out.is_open = 1; out.qty = 0; } else out.qty = 1; return out; }
  if (out.level) {
    if (!qtyGiven) out.qty = out.level === 'little' ? (out.count_type === 'inuse' ? 0 : 1) : out.level === 'none' ? 0 : Math.max(1, out.target ?? (out.count_type === 'pack' ? out.pack_size || 1 : 1));
    if (out.count_type === 'inuse' && out.level === 'little') out.is_open = 1;
    if (out.level !== 'little' || isOut(out)) out.level = null;
  }
  return out;
}

/** Counted things (not level) can be marked "running low": the last one is nearly used up. */
/** "נשאר מעט" but more is there (16/10, "חצי בקבוק רוטב דגים, ועוד בקבוק שלם"): a closed one in use, or another one counted. Nothing to buy yet. */
export const hasSpare = (p) => !!p && ((p.count_type === 'inuse' && Number(p.qty) > 0) || ((p.count_type === 'units' || p.count_type === 'pack') && Number(p.qty) > 1));
export const runningLow = (p) => p.count_type !== 'level' && p.level === 'little' && !isOut(p);

/** How many whole packs a pack product's minimum is (17/10, ש15): "מינימום קופסה" kept as 1 or as 12 eggs is the same box. */
export function packMin(p) {
  const size = p.pack_size || 1, t = p.target;
  if (t == null || !(t > 0)) return 1; // no minimum: one pack
  return t <= 4 && t < size ? Math.ceil(t) : Math.max(1, Math.ceil(t / size)); // 1–4 against a pack of 6 or more: packs
}
/** What is closed at home of a product, besides the one in use: in use, its closed ones; counted, the rest after the last one
 * when that one is running low; and a second place's (the balcony fridge). */
export function closedOf(p) {
  const spare = p.reserve_qty > 0 ? p.reserve_qty : 0;
  if (p.count_type === 'inuse') return (p.qty || 0) + spare;
  if (p.count_type === 'units') return Math.max(0, (p.qty || 0) - (runningLow(p) ? 1 : 0)) + spare;
  return spare;
}
/**
 * A basic product is missing when it is below its target. Non-basic products are never "missing".
 * 17/10 (ש15): something closed at home is no reason to buy, even of a basic, unless what is closed is below its minimum (smoked
 * paprika: an open one running out and another tin closed, minimum one tin: not missing). A pack (eggs, 12) is bought when half
 * of its last pack is left: minimum one box, 11 is not missing and 6 is; two boxes, 18 and less. A basic in use with nothing
 * closed: "a little left" on the open one is missing; a full open one counts as one (home18).
 */
export function isMissing(p) {
  if (!p.is_basic) return false;
  const spare = p.reserve_qty > 0 ? p.reserve_qty : 0; // more of it in a second place (the balcony fridge)
  if (p.count_type === 'level') return p.level !== 'plenty';
  if (p.count_type === 'pack' && (p.pack_size || 1) > 1) { const size = p.pack_size; return (p.qty || 0) + spare <= packMin(p) * size - size / 2; }
  const target = p.target ?? defaultTarget(p);
  const closed = closedOf(p);
  if (runningLow(p)) return closed < Math.max(1, target); // the one in use is nearly gone: buy unless enough is closed
  // home18 (the owner 17/10): the open one counts as one while it isn't running low (half, a quarter, "a little left" are runningLow)
  if (p.count_type === 'inuse') return closed + (p.is_open ? 1 : 0) < target;
  return (p.qty || 0) + spare < target;
}

/** True when nothing of it is at home. */
export function isOut(p) {
  switch (p.count_type) {
    case 'level': return p.level === 'none' || !p.level;
    case 'inuse': return !p.is_open && !(p.qty > 0);
    default: return !(p.qty > 0);
  }
}

/**
 * Suggested purchase amount, in PURCHASE units (packs for `pack`, items otherwise).
 * Basic: what brings it back to target. Otherwise: 1.
 */
export function suggestedBuy(p) {
  if (p.count_type === 'level') return 1;
  if (!p.is_basic) return 1;
  const target = p.target ?? defaultTarget(p);
  const gap = target - (p.qty || 0);
  if (gap <= 0) return 1;
  if (p.count_type === 'pack') return Math.max(1, Math.ceil(gap / (p.pack_size || 1)));
  return Math.max(1, Math.ceil(gap));
}

/* ---------- quantities in plain Hebrew (formatting shared with the app: public/hebrew.js) ---------- */
export { amount, daysText, of, genderOf, byGender };

/** One open and some closed, with the unit (approved 30/09): "בקבוק אחד פתוח, אין בקבוקים סגורים". Without a unit: "יחידה". */
function inUse(p, q, how) {
  const [one, many, g] = unitForms(p.unit || 'יחידה'), f = g === 'f';
  const open = f ? 'פתוחה' : 'פתוח', closed = q === 1 ? `${one} ${f ? 'אחת סגורה' : 'אחד סגור'}` : `${q} ${many} ${f ? 'סגורות' : 'סגורים'}`;
  const none = `אין ${many} ${f ? 'סגורות' : 'סגורים'}`;
  if (how === 'low') return `ה${one} ה${open} כמעט ${f ? 'נגמרה' : 'נגמר'}, ${q ? `יש עוד ${closed}` : none}`;
  if (how === 'open') return q ? `${one} ${f ? 'אחת' : 'אחד'} ${open} ועוד ${closed}` : `${one} ${f ? 'אחת' : 'אחד'} ${open}, ${none}`;
  return `${closed}, אין ${one} ${open}`;
}

/** What is in the house now, the way you'd say it. */
export function describe(p) {
  const q = round(p.qty || 0);
  if (runningLow(p)) return p.count_type === 'inuse' ? inUse(p, q, 'low') : q > 1 ? `${amount(q, p.count_type === 'pack' ? 'יחידה' : p.unit)}, כמעט נגמר` : 'נשאר מעט';
  switch (p.count_type) {
    case 'level': return { plenty: 'יש הרבה', little: 'נשאר מעט', none: 'נגמר' }[p.level || 'none'];
    case 'inuse':
      if (p.is_open) return inUse(p, q, 'open');
      return q ? inUse(p, q, 'closed') : 'נגמר';
    case 'pack': return q ? amount(q, 'יחידה') : 'נגמר';
    default: return q ? amount(q, p.unit) : 'נגמר';
  }
}

/**
 * Apply an operation to a product. Returns { product, batches } — new objects, inputs untouched.
 * `batches` is only meaningful for count_type 'batches' (array of {id?, qty, bought, expires}).
 *
 * ops:
 *   out                       – it ran out
 *   low                       – it is running low
 *   use   {amount}            – used some (units / items)
 *   open                      – opened a new one (inuse: spare -> open)
 *   purchase {amount}         – bought `amount` purchase units
 *   discard {amount?}         – threw away (all, or amount)
 *   set   {qty?, level?, is_open?} – absolute correction
 */
export function applyOp(product, op, now, batches = []) {
  // "set level" on something counted: little = running low, none = out, plenty = at least one
  if (product.count_type !== 'level' && op.type === 'set' && op.level && op.qty == null) {
    if (op.level === 'little') return applyOp(product, { type: 'low' }, now, batches);
    if (op.level === 'none') return applyOp(product, { type: 'out' }, now, batches);
    return applyOp(product, { type: 'set', qty: Math.max(product.qty || 0, 1) }, now, batches);
  }
  const p = { ...product };
  let b = batches.map((x) => ({ ...x }));
  // the model sometimes puts the number in qty ("used 2 eggs"): for anything but a correction, that is the amount
  const amt = op.amount != null ? Number(op.amount) : op.type !== 'set' && op.qty != null ? Number(op.qty) : null;
  // a fresh purchase sets the expiry, unless an opened one at home runs out sooner
  const setExpiry = () => { if (p.shelf_days && p.count_type !== 'batches') { const e = now + p.shelf_days * DAY; p.expires = p.opened && p.expires && p.expires < e ? p.expires : e; } };
  const gone = () => { if (isOut(p)) { p.expires = null; p.opened = null; } };
  const sumBatches = () => { p.qty = pos(b.reduce((a, x) => a + x.qty, 0)); };
  const takeFromBatches = (n) => { // oldest expiry first
    b.sort((x, y) => (x.expires ?? Infinity) - (y.expires ?? Infinity) || x.bought - y.bought);
    for (const x of b) { const t = Math.min(x.qty, n); x.qty = round(x.qty - t); n -= t; if (n <= 0) break; }
    b = b.filter((x) => x.qty > 0);
    sumBatches();
  };

  switch (op.type) {
    case 'out':
      if (p.count_type === 'level') p.level = 'none';
      else if (p.count_type === 'inuse') {
        // the open one finished; if there is a spare, it gets opened
        if (p.qty > 0) { p.qty = pos(p.qty - 1); p.is_open = 1; } else p.is_open = 0;
      } else if (p.count_type === 'batches') { b = []; p.qty = 0; }
      else p.qty = 0;
      gone();
      break;
    case 'low':
      if (p.count_type === 'level') p.level = 'little';
      else if (p.count_type === 'inuse') { if (!p.is_open && p.qty > 0) { p.qty = pos(p.qty - 1); } p.is_open = 1; p.level = 'little'; }
      else {
        if (p.qty > 1) p.qty = p.count_type === 'pack' ? Math.min(p.qty, Math.max(1, Math.floor((p.pack_size || 2) / 4))) : 1;
        else if (!(p.qty > 0)) p.qty = 1; // "almost out" means there is still some
        if (p.count_type === 'batches' && !b.length) { b.push({ qty: p.qty, bought: now, expires: null }); }
        p.level = 'little';
      }
      break;
    case 'use': {
      const n = amt ?? 1;
      if (p.count_type === 'level') p.level = p.level === 'plenty' ? 'little' : 'none';
      else if (p.count_type === 'inuse') p.qty = pos(p.qty - n);
      else if (p.count_type === 'batches') takeFromBatches(n);
      else p.qty = pos(p.qty - n);
      break;
    }
    case 'open': // opened a new one (inuse: from the spares). Once open it keeps open_days, if that is shorter.
      if (p.count_type === 'inuse') { if (p.qty > 0) p.qty = pos(p.qty - 1); p.is_open = 1; }
      if (p.open_days) { p.opened = now; const e = now + p.open_days * DAY; if (!p.expires || e < p.expires) p.expires = e; }
      break;
    case 'purchase': {
      const n = amt ?? suggestedBuy(p);
      if (p.count_type === 'level') p.level = 'plenty';
      else if (p.count_type === 'pack') p.qty = pos(p.qty + (op.units != null ? Number(op.units) : n * (p.pack_size || 1))); // a 30 when it's usually a 12: units win
      else if (p.count_type === 'inuse') { if (!p.is_open) { p.is_open = 1; p.qty = pos(p.qty + n - 1); } else p.qty = pos(p.qty + n); }
      else if (p.count_type === 'batches') { b.push({ qty: n, bought: now, expires: p.shelf_days ? now + p.shelf_days * DAY : null }); sumBatches(); }
      else p.qty = pos(p.qty + n);
      setExpiry();
      break;
    }
    case 'bring': { // from the second place into the usual one ("I brought 2 in from the balcony")
      const n = Math.min(amt ?? p.reserve_qty ?? 0, p.reserve_qty || 0);
      p.qty = round((p.qty || 0) + n); p.reserve_qty = round((p.reserve_qty || 0) - n) || null;
      if (p.level === 'little' && n > 0) p.level = null;
      break;
    }
    case 'discard':
      if (amt == null || p.count_type === 'level') return applyOp(p, { type: 'out' }, now, b);
      if (p.count_type === 'batches') {
        // throw away the ones that expire first
        takeFromBatches(amt);
      } else p.qty = pos(p.qty - amt);
      gone();
      break;
    case 'set':
      if (op.qty != null) p.qty = pos(Number(op.qty));
      if (op.level != null && LEVELS.includes(op.level)) p.level = op.level;
      if (op.is_open != null) p.is_open = op.is_open ? 1 : 0;
      if (op.expires !== undefined) p.expires = op.expires;
      if (op.qty != null || op.level != null) p.counted = now; // someone looked and counted
      if (isOut(p)) p.opened = null;
      if (p.count_type === 'batches' && op.qty != null) {
        const cur = b.reduce((a, x) => a + x.qty, 0);
        if (op.qty < cur) takeFromBatches(cur - op.qty);
        else if (op.qty > cur) { b.push({ qty: round(op.qty - cur), bought: now, expires: p.shelf_days ? now + p.shelf_days * DAY : null }); sumBatches(); }
      }
      break;
    default:
      throw new Error(`פעולה לא מוכרת: ${op.type}`);
  }
  if (p.count_type === 'level' && !p.level) p.level = 'none';
  if (p.count_type !== 'level' && op.type !== 'low' && !(op.type === 'set' && op.level) && op.type !== 'open' && op.type !== 'use') p.level = null;
  if (p.count_type !== 'level' && isOut(p)) p.level = null;
  return { product: p, batches: b };
}

/** Earliest expiry of a product (batches: the soonest non-empty batch). */
export function nextExpiry(p, batches = []) {
  if (p.count_type === 'batches') {
    const e = batches.filter((x) => x.qty > 0 && x.expires).map((x) => x.expires);
    return e.length ? Math.min(...e) : null;
  }
  return isOut(p) ? null : p.expires || null;
}

/** Products (with their soonest expiry) that expire within `days` from now, soonest first. Already-expired included. */
export function expiring(products, batchesByProduct, now, days = 2) {
  const limit = now + days * DAY;
  return products
    .map((p) => ({ p, e: nextExpiry(p, batchesByProduct[p.id] || []) }))
    .filter((x) => x.e && x.e <= limit)
    .sort((a, b) => a.e - b.e);
}

/**
 * Shuki's mood from the state of the house.
 *   lastUpdate : ts of the latest inventory change (any user)
 *   lastWaste  : ts of the latest discard (no longer changes the mood: decision 131)
 * Priority: sad > sleepy > by stock ratio. Afro only when neither applies.
 */
export function mood({ products, lastUpdate, lastWaste, now }) {
  const basics = products.filter((p) => p.is_basic && !p.deleted);
  const inStock = basics.filter((p) => !isMissing(p)).length;
  const ratio = basics.length ? inStock / basics.length : 1;
  const info = { basics: basics.length, inStock, ratio: round(ratio) };
  // a house never updated is sleepy too, but not "3 days" (`never`: the app's label has no reason for it; r7c, question 100)
  if (!lastUpdate) return { mood: 'sleepy', ...info, never: true };
  if (now - lastUpdate > 3 * DAY) return { mood: 'sleepy', ...info };
  // a toss is only the moment's cry (decision 131, r0t d131): it doesn't keep the afro away for a week
  if (basics.length && ratio === 1 && now - lastUpdate <= 2 * DAY) return { mood: 'ecstatic', ...info };
  if (ratio > 0.8) return { mood: 'happy', ...info };
  if (ratio >= 0.5) return { mood: 'neutral', ...info };
  return { mood: 'hungry', ...info };
}

/** Should a list item exist for this product right now, and from which source? */
export function listNeed(p) {
  if (p.deleted) return null;
  if (HOUSE.pesach && passoverOut(p)) return null; // Passover: chametz (and kitniyot, c11) doesn't come back on the list by itself
  if (isMissing(p)) return 'auto';
  return null;
}

/** Normalise Hebrew/English product text for matching: lower case, no niqqud, no punctuation, single spaces. */
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'`׳״.,;:!?()\-_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match free text to products by name/aliases. Exact normalised match first, then word containment. */
export function findProducts(products, text) {
  const q = norm(text);
  if (!q) return [];
  const qs = [q, q.replace(/^ה/, '')];
  const names = (p) => [p.name, ...(JSON.parse(p.aliases || '[]'))].map(norm);
  const exact = products.filter((p) => names(p).some((n) => qs.includes(n) || qs.includes(n.replace(/^ה/, ''))));
  if (exact.length) return exact;
  return products.filter((p) => names(p).some((n) => n.includes(qs[1]) || qs[1].includes(n)));
}

/** A name or a short text on one line (stage 13, S13-8): no line breaks or control characters, so a name can't start a line of
 * its own in the model's prompt ("- [כלל 99] …"); runs of spaces become one. */
export const oneLine = (s, n = 80) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, n);

/** Local date/hour parts in a time zone. */
export function local(ts, tz = HOUSE.tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`, day: +p.day, hour: +p.hour, wd: new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay() };
}

/** "2026-10-04" + "09:00" in Israel → timestamp. null when not a real date/time. */
export function localToTs(date, time = '09:00', tz = HOUSE.tz) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{1,2}:\d{2}$/.test(String(time))) return null;
  const [h, m] = String(time).split(':').map(Number);
  if (h > 23 || m > 59) return null;
  const guess = Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  if (!Number.isFinite(guess)) return null;
  // the zone's offset at that moment, in minutes (Israel: +120 or +180; India: +330; New York: -240 or -300), from the whole
  // local date and time, so a zone more than 12 hours away (Tonga +13, Kiritimati +14) isn't a day off (stage 13, d9)
  // (and once more at the moment found, for a night the clock changes; a date that doesn't exist, 30/02, is null)
  const offAt = (t) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t; };
  if (new Date(guess).toISOString().slice(0, 10) !== String(date)) return null;
  const first = guess - offAt(guess);
  return guess - offAt(first);
}

export const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export const withHa = (name) => (/^[א-ת]/.test(name) && !name.startsWith('ה') ? `ה${name}` : name); // the definite article on the first word ("the cream")
/**
 * A product's name with the definite article where Hebrew puts it (stage 9): one word "השוקו"; a construct, on its second word
 * ("חלב הסויה", "דגני הבוקר", "נייר הטואלט", "שוקולד החלב"); a noun and its adjective, on both ("הגבינה הבולגרית",
 * "הקפה השחור", "המים המינרליים"); a kind or a brand after it, on the noun only ("הפסטה פנה", "הקוקה קולה"); nothing after
 * "של", "בטעם", "לשיער"… ("הטונה בשמן", "הקפה של אבי"); a third word only when it is an adjective ("חזה העוף הטחון").
 */
const ADJ = new Set('ורוד ורודה ורודים וורוד וורודה וורודים לבן לבנה לבנים שחור שחורה ירוק ירוקה אדום אדומה צהוב צהובה כתום מלא מלאה טחון טחונה טחונים קפוא קפואה קפואים טרי טרייה טריים נמס חריף חריפה מתוק מתוקה חמוץ חמוצה חמוצים מר מריר מרירה מעושן מעושנת קלוי קלויה קלויים מבושל מבושלת מיובש מיובשת מיובשים קצוץ קצוצה שלם שלמה שלמים גדול גדולה גדולים קטן קטנה קטנים רגיל רגילה רגילים דל דלה רזה עבה דק דקה כבד קל קלה מוגז מוגזים מינרליים אחיד חום מלוח מלוחה מתובל מתובלת עדין עדינה עמיד עמידה יבש יבשה גס גסה רך רכה קשה נטול נטולת'.split(' '));
const KIND = /^(זירו|לייט|דיאט|קולה|פנה|ספגטי|פוזילי|פטוצ'יני|בסמטי|יסמין|פרסי|ספלט|קלאסי|תנובה|טרה|יטבתה|שטראוס|עלית|אסם|תלמה|אלפרו|נסטלה|יוטבתה|גד|זוגלובק|סנו|פרסיל|טורא)$/; // a kind or a brand, not described
const AFTER = /^(של|עם|בלי|ללא|בטעם|בתוספת|ב(שמן|מים|רוטב|מלח)|ל(שיער|חתול|חתולים|כלב|כלבים|כלים|כביסה|פנים|גוף|תינוק|תינוקות|ילדים|מדיח|רצפה|ידיים|אמבטיה|שירותים))$/;
const FEM_T = new Set(['שמנת', 'שעועית', 'קשת']); // nouns that end in "ת" and aren't a construct
const NOT_ADJ = new Set(['זית', 'חלבי', 'עלי', 'מכונה', 'מרוקו', 'מזוזה', 'מטוס', 'מחוז', 'מקור', 'מכון']); // nouns that look like adjectives
const VAV = /^(וניל|ורוד|ורודה|ורודים|וורוד|וורודה|ורד|ורדים|וורדים|ופל|ופלים|וופל|וופלים|ויטמין|ויטמינים|ויסקי|וודקה|ואסאבי|ורמוט)$/; // words that begin with "ו", not "and"
// passive participles, by name (a pattern took "תפוז", "תפוח", "אגוז", "מזון" for them)
const PARTICIPLE = new Set('פרוס פרוסה פרוסים גרוס גרוסה כתוש כתושה עגול עגולה קלוף קלופה קלופים חתוך חתוכה חתוכים קצוץ קצוצה טחון טחונה ארוז ארוזה מטוגן מטוגנת מטוגנים מבושל מבושלת מבושלים מצונן מצוננת מעושן מעושנת מיובש מיובשת מיובשים מגורד מגורדת מתובל מתובלת מומלח מומלחת מוקפא מוקפאת מוקפאים'.split(' '));
export function definite(name) {
  // two things joined by "ו" ("שמפו ומרכך"): each its own article, "השמפו והמרכך"
  // …but not a word that starts with "ו" itself ("סוכר וניל", "פסטה ורודה", "מי ורדים")
  const and = String(name || '').trim().match(/^(.+?)\s+ו([א-ת]{2,}.*)$/);
  if (and && !VAV.test(`ו${and[2].split(/\s+/)[0]}`)) return `${definite(and[1])} ו${definite(and[2])}`;
  const w = String(name || '').trim().split(/\s+/);
  const ha = (x) => (/^[א-ת]/.test(x) && !x.startsWith('ה') ? `ה${x}` : x);
  let k = w.findIndex((x, n) => n > 0 && (AFTER.test(x) || !/^[א-ת]/.test(x))); if (k < 0) k = w.length; // the article stops here
  if (k === 1) return [ha(w[0]), ...w.slice(1)].join(' ');
  const [a, b] = w;
  // a passive participle is one too: "פרוס", "כתוש", "עגול"; "מטוגן", "מצונן"
  const adj = (x) => ADJ.has(x) || PARTICIPLE.has(x) || (/^מ[א-ת]ו[א-ת]{2}$/.test(x) && !NOT_ADJ.has(x)) || (/(ית|י)$/.test(x) && x.length > 2 && !NOT_ADJ.has(x)); // "המשומר", "המנופה"
  const fem = (x) => (/ה$/.test(x) && !['קפה', 'תה'].includes(x)) || FEM_T.has(x), pl = (x) => /(ים|ות)$/.test(x);
  let core;
  if (KIND.test(b)) core = [ha(a), b];
 else if (adj(b) && (ADJ.has(b) || PARTICIPLE.has(b) || (/^מ[א-ת]ו[א-ת]{2}$/.test(b) && !NOT_ADJ.has(b)) || (!/י$/.test(a) && !(/ת$/.test(a) && !/ות$/.test(a) && !FEM_T.has(a))))) core = [ha(a), ha(b)]; // "הגבינה הבולגרית", "היוגורט הטבעי"
  else if (/י$/.test(a) || (/ת$/.test(a) && !/ות$/.test(a) && !FEM_T.has(a))) core = [a, ha(b)]; // "דגני הבוקר", "עוגת השמרים"
  else if ((fem(a) && /(ה|ת)$/.test(b)) || (pl(a) && pl(b))) core = [ha(a), ha(b)]; // "השמנת החמוצה", "הביצים האורגניות"
  else core = [a, ha(b)]; // "שוקולד החלב", "נייר הטואלט", "סבון הכלים"
  return [...core, ...w.slice(2, k).map((x) => (adj(x) ? ha(x) : x)), ...w.slice(k)].join(' ');
}
/** The Hebrew date, in numbers and the month's English name ("Nisan"): for Passover's end (stage 9, מ14) */
export function hebrewDate(now, tz = HOUSE.tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-u-ca-hebrew', { year: 'numeric', month: 'long', day: 'numeric', timeZone: tz }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { year: Number(String(p.year).replace(/\D/g, '')), month: String(p.month), day: Number(p.day) };
}
/** The Islamic date (Umm al-Qura), in numbers: Ramadan is month 9, Shawwal 10 (stage 9, מ15) */
export function islamicDate(now, tz = HOUSE.tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: tz }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { year: Number(String(p.year).replace(/\D/g, '')), month: Number(p.month), day: Number(p.day) };
}
const andHe = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ו${xs.at(-1)}` : xs[0] || '');
const whenLeft = (x) => (x.days <= 0 ? 'היום' : x.days === 1 ? 'מחר' : x.days === 2 ? 'בעוד יומיים' : x.days < 14 ? `בעוד ${x.days} ימים` : `ב-${x.date}`);
const monthsText = (n) => (n === 1 ? 'חודש' : n === 2 ? 'חודשיים' : `${n} חודשים`);

/**
 * Push messages for the evening run. Facts only, no advice (decisions 91, 108):
 *   expiring : [{ name, days, date }] -> one sentence: the cream's expiry is tomorrow, the milk's in two days
 *   on the 1st: last month's off-list buys and what was thrown away, and what has been in the freezer longest.
 */
const lower = (t) => String(t).replace(/\.$/, '');

export function digestMessages({ expiring: items = [], day, offListLastMonth, wasted = [], freezer = [], taught = [], doubles = [], month }) {
  const out = [];
  if (items.length) {
    const xs = items.slice(0, 4).map((x, i) => `${i ? 'של' : 'התוקף של'} ${withHa(x.name)}${i ? '' : ' עומד לפוג'} ${whenLeft(x)}`);
    out.push({ title: 'תוקף', body: `${andHe(xs)}${items.length > 4 ? ` ועוד ${items.length - 4} מוצרים` : ''}.`, url: './#inventory' });
  }
  if (day === 1 && offListLastMonth != null) {
    const off = offListLastMonth === 0 ? 'כל מה שקניתם היה ברשימה' : offListLastMonth === 1 ? 'קניתם מוצר אחד מחוץ לרשימה' : `קניתם ${offListLastMonth} מוצרים מחוץ לרשימה`;
    const names = wasted.slice(0, 4).concat(wasted.length > 4 ? [`עוד ${wasted.length - 4}`] : []);
    const waste = !wasted.length ? 'ולא נזרק כלום' : wasted.length === 1 ? `ונזרק אחד: ${wasted[0]}` : `ונזרקו ${wasted.length}: ${andHe(names)}`;
    const learnt = !taught.length ? '' : taught.length === 1 ? ` וגם למדתי משהו חדש: ${lower(taught[0])}.` : ` וגם למדתי ${taught.length === 2 ? 'שני' : taught.length} דברים חדשים, למשל: ${lower(taught[0])}.`;
    // מ23: the same product bought twice on one day, by two people: one sentence, up to three names, nobody named
    const twiceNames = [...new Set(doubles)];
    const twice = !doubles.length ? '' : doubles.length === 1 ? ` קרה פעם אחת ש${definite(doubles[0])} ${byGender(doubles[0], 'נקנה', 'נקנתה', 'נקנו')} פעמיים באותו יום.`
      : ` קרה ${doubles.length === 2 ? 'פעמיים' : `${doubles.length} פעמים`} שמוצר נקנה פעמיים באותו יום: ${andHe(twiceNames.slice(0, 3))}${twiceNames.length > 3 ? ` ועוד ${twiceNames.length - 3}` : ''}.`;
    out.push({ title: 'סיכום החודש', body: `${month ? `ב${month}` : 'בחודש שעבר'} ${off} ${waste}.${learnt}${twice}`, url: './#list' });
  }
  if (day === 1 && freezer.length) {
    // one notification with the month's summary (the owner 02/10, question 28); without a summary, the freezer alone
    const cold = `הכי הרבה זמן במקפיא: ${andHe(freezer.slice(0, 3).map((x) => `${x.name} (${monthsText(x.months)})`))}. האם הגיע הזמן לבשל אותם?`;
    const month = out.find((m) => m.title === 'סיכום החודש');
    if (month) month.body = `${month.body} ${cold}`;
    else out.push({ title: 'מה במקפיא', body: cold, url: './#inventory' });
  }
  return out;
}

/** Epoch ms of local midnight on the 1st of the month containing `ts`, correct across DST changes. */
export function monthStart(ts, tz = HOUSE.tz) {
  const [y, m] = local(ts, tz).month.split('-').map(Number);
  const offset = (t) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(t)).map((x) => [x.type, +x.value]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
  };
  const utcMidnight = Date.UTC(y, m - 1, 1);
  return utcMidnight - offset(utcMidnight - 3 * 3600e3);
}

/* ---------- Shuki learns: how long things last ---------- */

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * From the log of purchases and run-outs, how long each product lasts and when it will run out next.
 * A "cycle" is purchase → the next time it ran out. Two cycles are enough to guess.
 * Without purchases on record (bought off the app), the gaps between run-outs are used, from 3 run-outs.
 * log: [{ product_id, ts, kind: 'out' | 'purchase' }]  →  { [product_id]: { every, next, samples } } (days / ms)
 */
export function learn(log, away = [], now = null, skips = [], short = new Set()) {
  const empty = (a, b) => away.some((w) => a < w.end && b > w.start); // the house was empty for part of [a, b]
  // מ12: a period's window on the products it changed (settings.pace_skip): its pace isn't the house's usual one
  let during = empty;
  const by = new Map();
  for (const r of log) { if (!by.has(r.product_id)) by.set(r.product_id, []); by.get(r.product_id).push(r); }
  const out = {};
  for (const [pid, all] of by) {
    const mine = skips.filter((w) => w.product_id === pid); during = mine.length ? (a, b) => empty(a, b) || mine.some((w) => a < w.to && b > w.from) : empty;
    all.sort((a, b) => a.ts - b.ts);
    // the last two months (r10 q060, r0t r10-9); with fewer than 3 purchases in them, the whole 180 days as before
    // a baby's things (מ16, q048: `short`, the category "תינוק") change fast: the last month
    // …the first window with 3 purchases: 30 days for them, then 60, then all 180 (the reviewer of 87a7259)
    const windowed = (d) => all.filter((r) => r.ts >= now - d * DAY);
    const rows = now == null ? all : [...(short.has(pid) ? [30] : []), 60].map(windowed).find((w) => w.filter((r) => r.kind === 'purchase').length >= 3) || all;
    const cycles = []; let bought = null;
    for (const r of rows) {
      if (r.kind === 'purchase') bought ??= r.ts; // the first purchase after running out starts the cycle
      else if (r.kind === 'return') bought = null; // taken back to the store: that buy doesn't count
      else if (bought != null) { if (!during(bought, r.ts)) cycles.push(r.ts - bought); bought = null; }
    }
    const outs = rows.filter((r) => r.kind === 'out').map((r) => r.ts);
    const lastBuy = rows.filter((r) => r.kind === 'purchase').at(-1)?.ts ?? null;
    let every = null, next = null;
    if (cycles.length >= 2) {
      every = median(cycles);
      next = (bought ?? outs.at(-1)) + every; // counted from the restock (or, unrecorded, from the last run-out)
    } else if (outs.length >= 3) {
      const gaps = outs.slice(1).map((t, i) => [outs[i], t]).filter(([a, b]) => !during(a, b)).map(([a, b]) => b - a);
      if (gaps.length < 2) continue;
      every = median(gaps);
      next = (bought ?? outs.at(-1)) + every;
    }
    if (every != null && every >= DAY / 2) out[pid] = { every: Math.round((every / DAY) * 10) / 10, next, samples: Math.max(cycles.length, outs.length - 1), lastBuy };
  }
  return out;
}

/** Holidays by their Hebrew date, for "what did we buy for last Rosh Hashanah?" (decision 106). */
export const HOLIDAYS = { 'ראש השנה': ['תשרי', 1], 'יום כיפור': ['תשרי', 10], 'כיפור': ['תשרי', 10], 'סוכות': ['תשרי', 15], 'חנוכה': ['כסלו', 25], 'פורים': ['אדר', 14], 'פסח': ['ניסן', 15], 'שבועות': ['סיון', 6] };
/** The last time the holiday named in `text` came (at least three weeks ago, so right before it this is last year's): { name, ts } or null. */
export function lastHoliday(text, now, tz = HOUSE.tz) {
  const name = Object.keys(HOLIDAYS).find((h) => String(text).includes(h));
  if (!name) return null;
  const [month, day] = HOLIDAYS[name];
  const f = new Intl.DateTimeFormat('he-u-ca-hebrew', { month: 'long', day: 'numeric', timeZone: tz });
  for (let d = 21; d < 420; d++) {
    const ts = now - d * DAY;
    const parts = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    if (Number(parts.day) === day && String(parts.month).startsWith(month)) return { name, ts };
  }
  return null;
}

/**
 * ו2 (stage 8, question 11, the owner r8p): the holiday today for "חג שמח!", by what the house celebrates: Jewish unless a house
 * fact says otherwise (habit: "חוגגים חגים מוסלמיים / נוצריים / נוצריים אורתודוקסים", or "לא חוגגים חגים"). No fasts.
 * Jewish: ראש השנה, סוכות, the first day of חנוכה, פורים (אדר ב׳ in a leap year), פסח, שבועות. Muslim: עיד אל-פיטר and עיד
 * אל-אדחא (the Umm al-Qura calendar). Christian: Christmas and Easter (Western; Orthodox by the Julian dates). Which ones and
 * how: question 45, for the owner. Returns the holiday's name or null.
 */
export function religionOf(facts = []) {
  // only a habit about the house's religion or holidays as such ("בחג שבועות אוכלים חלבי" isn't one)
  const v = facts.filter((f) => f.about === 'house' && f.key === 'habit').map((f) => String(f.value || '')).reverse()
    .find((x) => /(לא חוגגים חגים|חוגגים (את )?(חגים|חג המולד|כריסמס|עיד)|מוסלמ|איסלאמ|נוצרי|יהודי(ם|ה)?(\s|$))/.test(x)) || '';
  if (/לא חוגגים חגים/.test(v)) return null;
  if (/(מוסלמ|איסלאמ|עיד)/.test(v)) return 'muslim';
  if (/(נוצרי|חג המולד|כריסמס)/.test(v)) return /אורתודוקס/.test(v) ? 'orthodox' : 'christian'; // "יהודים אורתודוקסים" are Jewish
  return 'jewish';
}
const easter = (y, julian) => { // the computus: [month, day] in the Gregorian calendar
  if (julian) { const a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7, m = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
    const t = new Date(Date.UTC(y, m - 1, day + 13)); return [t.getUTCMonth() + 1, t.getUTCDate()]; } // 1900–2099: Julian + 13
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1];
};
export function holidayToday(now, religion, tz = HOUSE.tz) {
  if (!religion) return null;
  const [y, mo, d] = local(now, tz).date.split('-').map(Number);
  if (religion === 'jewish') {
    const p = Object.fromEntries(new Intl.DateTimeFormat('he-u-ca-hebrew', { month: 'long', day: 'numeric', timeZone: tz }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
    const day = Number(p.day), month = String(p.month);
    const leap = month.startsWith('אדר') && month !== 'אדר';
    // יום העצמאות (r8z 11/10): ה' באייר, a day earlier when it falls on Friday and two on Saturday (Thursday both), a day later on
    // Monday (so the memorial day isn't on Sunday); ה' באייר is only ever on Monday, Wednesday, Friday or Saturday
    const wd5 = (local(now, tz).wd + 5 - day + 70) % 7;
    const independence = { 5: 4, 6: 3, 1: 6 }[wd5] || 5;
    return [['ראש השנה', 'תשרי', 1], ['סוכות', 'תשרי', 15], ['חנוכה', 'כסלו', 25], ['ט״ו בשבט', 'שבט', 15], ['פורים', leap ? 'אדר ב׳' : 'אדר', 14], ['פסח', 'ניסן', 15],
      ['יום העצמאות', 'אייר', independence], ['ל״ג בעומר', 'אייר', 18], ['שבועות', 'סיוון', 6]] // ט"ו בשבט, יום העצמאות, ל"ג בעומר: r8z 11/10
      .find(([, m, dd]) => month.replace('סיון', 'סיוון') === m && day === dd)?.[0] || null; // "סיון" in older ICU data
  }
  if (religion === 'muslim') {
    const [m, dd] = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric', day: 'numeric', timeZone: tz }).format(new Date(now)).split('/').map(Number);
    return m === 10 && dd === 1 ? 'עיד אל-פיטר' : m === 12 && dd === 10 ? 'עיד אל-אדחא' : null;
  }
  const orthodox = religion === 'orthodox';
  const [em, ed] = easter(y, orthodox);
  if (mo === em && d === ed) return 'פסחא';
  return (orthodox ? mo === 1 && d === 7 : mo === 12 && d === 25) ? 'חג המולד' : null;
}

/** Passover is near (from a month before 15 Nisan) or now (until 22 Nisan): the settings show its panel then (the owner 16/10). */
export function pesachSeason(now, tz = HOUSE.tz) {
  const f = new Intl.DateTimeFormat('he-u-ca-hebrew', { month: 'long', day: 'numeric', timeZone: tz });
  const at = (ts) => Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const t = at(now);
  if (String(t.month).startsWith('ניסן') && Number(t.day) <= 22) return true;
  for (let d = 1; d <= 30; d++) { const p = at(now + d * DAY); if (String(p.month).startsWith('ניסן') && Number(p.day) === 15) return true; }
  return false;
}

export const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
/** Weekly buys whose day is tomorrow and that haven't gone on the list today. */
export function routinesDue(routines, now, tz = HOUSE.tz, lastBuy = {}) {
  const l = local(now, tz);
  // every N days (r0t d101): from the last purchase (or, before there is one, when it last went on the list or was set),
  // on the list a day before the time comes
  const from = (r) => lastBuy[r.product_id] || (r.last_added ? Date.parse(`${r.last_added}T12:00:00Z`) : r.added);
  return routines.filter((r) => r.last_added !== l.date && (r.every ? now >= from(r) + (r.every - 1) * DAY : r.weekday === (l.wd + 1) % 7));
}
/**
 * The same product bought on the same weekday three weeks running (and no weekly buy for it yet):
 * Shuki offers to make it one. `log` rows are purchases {product_id, ts}.
 */
export function weeklyPatterns(log, routines, now, tz = HOUSE.tz) {
  const have = new Set(routines.map((r) => r.product_id));
  const byP = new Map();
  for (const r of log) if (!have.has(r.product_id) && now - r.ts < 22 * DAY) (byP.get(r.product_id) || byP.set(r.product_id, []).get(r.product_id)).push(r.ts);
  const out = [];
  for (const [pid, tss] of byP) {
    const weeks = new Map(); // weekday -> set of week numbers back
    for (const ts of tss) { const wd = local(ts, tz).wd; const back = Math.floor((now - ts) / (7 * DAY)); (weeks.get(wd) || weeks.set(wd, new Set()).get(wd)).add(back); }
    for (const [wd, set] of weeks) if (set.size >= 3) { out.push({ product_id: pid, weekday: wd }); break; }
  }
  return out;
}

/** Not bought for two months (watermelon in winter): the pace stays, but nothing is suggested until it's bought again. */
export const SEASON_GAP = 60 * DAY;
export const offSeason = (l, now) => !!l?.lastBuy && now - l.lastBuy > SEASON_GAP;

/** Products that, at their usual pace, will run out within `days` and aren't marked out or on the list yet. */
export function runningOutSoon(products, learned, listProductIds, now, days = 2) {
  return products
    .filter((p) => learned[p.id]?.next != null && !isOut(p) && !listProductIds.has(p.id) && !offSeason(learned[p.id], now) && !(hasSpare(p) && !isMissing(p))) // another one closed at home: not soon (17/10, ש15)
    .map((p) => ({ id: p.id, name: p.name, in: Math.max(0, Math.round((learned[p.id].next - now) / DAY)), every: learned[p.id].every }))
    .filter((x) => x.in <= days)
    .sort((a, b) => a.in - b.in);
}

/* ---------- Shuki grows: levels and the wardrobe live in public/wardrobe.js (the app draws the same list) ---------- */
export { growth, legacyGrowth, ITEMS, SLOTS, catchUp, cleanOutfit } from '../public/wardrobe.js';

/* ---------- recount: numbers drift because nobody reports "used one can of tuna" ---------- */

/**
 * Up to `n` products to double-check this week: in stock, not touched for a while, the longest-unchecked first,
 * basics before the rest (they drive the list).
 */
export function recountPick(products, now, n = 5) {
  const last = (p) => Math.max(p.counted || 0, p.updated || p.created || 0);
  const can = products.filter((p) => !p.deleted && !isOut(p) && now - last(p) > 5 * DAY);
  const pick = [...can].sort((a, b) => (b.is_basic || 0) - (a.is_basic || 0) || last(a) - last(b)).slice(0, n);
  // a place kept for what nobody touched in more than two months, the oldest first (decision 46, r0t d46)
  const stale = can.filter((p) => now - last(p) > 60 * DAY).sort((a, b) => last(a) - last(b))[0];
  if (stale && !pick.includes(stale) && n > 0) { if (pick.length < n) pick.push(stale); else pick[n - 1] = stale; }
  return pick.map((p) => p.id);
}

/* ---------- away from home ---------- */
export const awayNow = (away, now) => away.find((w) => w.start <= now && now < w.end) || null;

/* ---------- after a shop: from the list, off the list, forgotten ---------- */

/** { bought: [names], offList: [names], forgot: [names] } → one Hebrew line per part, for the receipt and the push. */
export function tripSummaryLines({ bought = [], offList = [], forgot = [] }) {
  const join = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ו${xs.at(-1)}`);
  const few = (xs, k = 5) => join(xs.length > k ? [...xs.slice(0, k), `עוד ${xs.length - k}`] : xs);
  const out = [];
  if (bought.length) out.push(`מהרשימה: ${few(bought)}`);
  if (offList.length) out.push(`מחוץ לרשימה: ${few(offList)}`);
  if (forgot.length) out.push(`נשאר ברשימה: ${few(forgot)}`);
  return out;
}

/* ---- home18 (5, the owner 17/10): a tab of the list is a shopping trip; the store comes from where the house goes, not from the kind ---- */
// produce by its first word (a short list of the common ones), not when the name says it's dried, pickled, canned or ground
const PRODUCE = new Set(['עגבניה', 'עגבנייה', 'עגבניות', 'עגבניות שרי', 'מלפפון', 'מלפפונים', 'בצל', 'בצלים', 'שום', 'תפוח', 'תפוחים', 'תפוחי', 'גזר', 'גזרים', 'פלפל', 'פלפלים', 'חסה', 'כרוב', 'קישוא', 'קישואים',
  'חציל', 'חצילים', 'ברוקולי', 'כרובית', 'פטרוזיליה', 'כוסברה', 'שמיר', 'נענע', 'לימון', 'לימונים', 'בננה', 'בננות', 'תפוז', 'תפוזים', 'קלמנטינה', 'קלמנטינות', 'אבוקדו', 'ענבים', 'אבטיח', 'מלון',
  'אגס', 'אגסים', 'אפרסק', 'אפרסקים', 'שזיף', 'שזיפים', 'תות', 'תותים', 'מנגו', 'סלק', 'בטטה', 'בטטות', 'דלעת', 'צנונית', 'צנוניות', 'תפו"א', 'פטריות', 'סלרי', 'שעועית ירוקה', 'תרד', 'קולורבי']);
const NOT_FRESH = /(מיובש|יבש|יבשה|כבוש|כבושה|שימורי|אבקת|אבקה|רסק|מיץ|ממרח|טחון|טחונה|מעושן|מעושנת|גרגירי|מרוסק|קפוא|קפואה|שחור|לבן|אנגלי|ממולא|רוטב|תבלין)/;
const CLEANING = /(ניקוי|תרסיס|אקונומיקה|סבון כלים|נוזל כלים|מרכך כביסה|אבקת כביסה|ג'ל כביסה|ג׳ל כביסה|נוזל כביסה|מגבוני ניקוי|נוזל רצפות|דיזטול|דזיטול|(^|\s)סנו(\s|$)|פיירי|כלורקס|מסיר שומנים|מסיר אבנית)/;
const MEDS = /(אקמול|נורופן|אדוויל|אופטלגין|דקסמול|סטרפסילס|פלסטר|תחבושת|תרופה|תרופות|משחה לפצעים|טיפות עיניים|סירופ לשיעול)/;
const CARE = /(שמפו|מרכך שיער|משחת שיניים|מברשת שיניים|מברשות שיניים|דאודורנט|סבון ידיים|סבון גוף|ג'ל רחצה|תחבושות היגייניות|טמפונים|קרם גוף|קרם ידיים|קרם הגנה|חוט דנטלי|מי פה|סכיני גילוח|קצף גילוח)/;
export const SHOP_CATS = { produce: ['ירקות ופירות'], care: ['טואלטיקה והיגיינה', 'ניקיון וכביסה'], meds: ['תרופות ועזרה ראשונה'] };
/** A category by the product's name, for what the model left as "אחר" or gave a name of no category (דזיטול was "ניקוי וכביסה"). */
export function categoryByName(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  if (CLEANING.test(n)) return 'ניקיון וכביסה';
  if (MEDS.test(n)) return 'תרופות ועזרה ראשונה';
  if (CARE.test(n)) return 'טואלטיקה והיגיינה';
  const w = n.split(/\s+/).filter((x, i, all) => !(i === 0 && all.length > 1 && /^(\d+([.,]\d+)?|צרור|מארז|שקית|ארגז|קילו|ק"ג)$/.test(x))), first = w[0], two = w.slice(0, 2).join(' '); // "2 פלפל חריף", "צרור פטרוזיליה" (the live house)
  if ((PRODUCE.has(two) || PRODUCE.has(first)) && !NOT_FRESH.test(n)) return 'ירקות ופירות';
  return null;
}
/** Where a product of this category is bought, by the house's answers (shop_produce, shop_care): { store, store2 } or null.
 * Before an answer: the supermarket, with the other store as store2, so nothing is hidden. Medicines: the pharmacy. */
export function storesFor(cat, settings = {}) {
  const pick = (ans, other) => (ans === 'super' ? { store: 'super', store2: null } : ans === other ? { store: other, store2: 'super' } : { store: 'super', store2: other });
  if (SHOP_CATS.produce.includes(cat)) return pick(settings.shop_produce, 'greengrocer');
  if (SHOP_CATS.care.includes(cat)) return pick(settings.shop_care, 'pharm');
  if (SHOP_CATS.meds.includes(cat)) return { store: 'pharm', store2: null };
  return null;
}
