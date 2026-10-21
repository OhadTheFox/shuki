// Shuki app: chat, shopping list, inventory, settings. Vanilla JS, no build.
import { amount, of, byGender, everyText as routineEvery, parentsOr, byPerson, inPlace as placeIn } from './hebrew.js';
import { mount as mountShuki, MOOD_NAMES, FACES_KNOWN } from './shuki.js';
import { reaction } from './reactions.js';
import { ITEMS, SLOTS } from './wardrobe.js';
import { recipeStatus, parseIngredients, parseLine, lineOf, warnNow, withFacts } from './recipes.js';
import { isNight, nightStart } from './night.js';

/* ================= helpers ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROUTES = ['chat', 'list', 'inventory', 'recipes', 'settings'];
const routeOf = (h) => { const r = String(h || '#chat').slice(1); return ROUTES.includes(r) ? r : 'chat'; }; // "#__proto__" was a blank screen (Q-6)
const store = {
  keys() { try { return Object.keys(localStorage).filter((k) => k.startsWith('shuki.')).map((k) => k.slice(6)); } catch { return []; } },
  get(k, d = null) { try { const v = localStorage.getItem(`shuki.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`shuki.${k}`, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(`shuki.${k}`); } catch { /* ignore */ } },
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const DAY = 86400e3;
/** Hebrew-friendly matching: ignore niqqud, punctuation and the definite article (a leading he) on the first word. */
const norm = (t) => String(t || '').toLowerCase().replace(/[\u0591-\u05C7]/g, '').replace(/["'`׳״.,;:!?()\-_/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
const matches = (p, q) => {
  const nq = norm(q); if (!nq) return true;
  const hay = norm(`${p.name} ${p.aliases.join(' ')}`);
  const words = hay.split(' ');
  return hay.includes(nq) || nq.split(' ').every((w) => { const b = w.replace(/^ה(?=..)/, ''); return words.some((x) => x.includes(b) || x.replace(/^ה(?=..)/, '').includes(b)); });
};
const BASE_STORES = [['super', 'סופר'], ['pharm', 'פארם'], ['greengrocer', 'ירקן']];
const STORES = [...BASE_STORES]; // plus the household's own (a butcher, a health food store), from the server
const STORE_NAME = Object.fromEntries(STORES);
function syncStores() {
  const extra = (S?.stores || []).filter((x) => x.custom).map((x) => [x.id, x.name]);
  STORES.length = 0; STORES.push(...BASE_STORES, ...extra);
  for (const k of Object.keys(STORE_NAME)) delete STORE_NAME[k];
  Object.assign(STORE_NAME, Object.fromEntries(STORES));
}
const TYPES = [['units', 'ביחידות'], ['pack', 'באריזות'], ['level', 'בערך (הרבה / מעט / אין)'], ['inuse', 'אחד בשימוש ועוד בארון'], ['batches', 'כל אחד עם תוקף משלו']];
const LEVELS = [['plenty', 'הרבה'], ['little', 'מעט'], ['none', 'אין']];
const fmtDate = (ts) => new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
const fmtTime = (ts) => new Date(ts).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const daysLeft = (ts) => Math.ceil((ts - Date.now()) / DAY);
const expText = (ts) => { const d = daysLeft(ts); return d < 0 ? 'פג תוקף' : d === 0 ? 'בתוקף עד היום' : d === 1 ? 'בתוקף עד מחר' : d === 2 ? 'בתוקף עוד יומיים' : `בתוקף עד ${fmtDate(ts)}`; };

const ICON = {
  chat: '<path d="M4 5h16v11H10l-5 4v-4H4z" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.5h5" stroke-linecap="round"/>',
  recipes: '<path d="M4 11h16v2a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7z" stroke-linejoin="round"/><path d="M2.5 11h19M9 7.5c0-1.5 1.5-1.5 1.5-3M14 7.5c0-1.5 1.5-1.5 1.5-3" stroke-linecap="round"/>',
  list: '<rect x="5" y="4" width="14" height="17" rx="1.5"/><path d="M9 3h6v3H9zM8.5 11l1.5 1.5 2.5-3M8.5 16.5h7" stroke-linecap="round" stroke-linejoin="round"/>',
  inventory: '<path d="M3 9 12 4l9 5v11H3z" stroke-linejoin="round"/><path d="M7 20v-7h10v7M7 16.5h10"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke-linecap="round"/>',
};
const svg = (d, stroke = 'currentColor', w = 2.4) => `<svg viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${w}" aria-hidden="true">${d}</svg>`;
const TICK = svg('<path d="M3 13l6 6L22 3" stroke-linecap="round" stroke-linejoin="round"/>', '#E2261C', 4.5);
/** q10, q11 (approved 02/10): a private product has a drawn lock beside its name; a screen reader says "רק אתה רואה" / "רק את רואה" */
const LOCK = svg('<rect x="5" y="11" width="14" height="9.5" rx="2" stroke-linejoin="round"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" stroke-linecap="round"/>', 'currentColor', 2.2);
const lockHtml = (x) => (x?.private_to != null && x.private_to === S.me?.id ? `<span class="lock" role="img" aria-label="${byPerson(S?.me, 'רק אתה רואה', 'רק את רואה', 'רק אתם רואים')}">${LOCK}</span>` : '');
const SMALL_TICK = svg('<path d="M4 13l5 5L20 5" stroke-linecap="round" stroke-linejoin="round"/>', '#E2261C', 4);
/* ---------- product photos: small JPEGs, kept in Cache Storage so they show with no signal ---------- */
const photoUrl = new Map(); // "id:ts" -> blob url
const thumb = (p, cls = 'thumb') => (p?.photo ? `<img class="${cls}" data-photo="${p.id}" data-v="${p.photo}" alt="">` : '');
async function photoSrc(id, v, src = `/api/photo/${id}`) {
  const key = `${id}:${v}`;
  if (photoUrl.has(key)) return photoUrl.get(key);
  const req = new Request(`/photo-cache/${id}-${v}.jpg`);
  let blob;
  try { const c = await caches.open('shuki-photos'); const hit = await c.match(req); if (hit) blob = await hit.blob(); } catch { /* no cache api */ }
  if (!blob) {
    const r = await fetch(src, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error('no photo');
    blob = await r.blob();
    try { const c = await caches.open('shuki-photos'); await c.put(req, new Response(blob, { headers: { 'content-type': 'image/jpeg' } })); } catch { /* ignore */ }
  }
  const url = URL.createObjectURL(blob); photoUrl.set(key, url); return url;
}
function hydratePhotos(root) {
  root?.querySelectorAll?.('img[data-photo]:not([src])').forEach((img) => {
    photoSrc(img.dataset.photo, img.dataset.v).then((u) => { img.src = u; }).catch(() => img.remove());
  });
}
const SCISSORS = svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.3 7.8 20 18M8.3 16.2 20 6" stroke-linecap="round"/>', '#FFD21A');

/* ================= state ================= */
let token = store.get('token');
let S = store.get('state');            // last server state (also used offline)
syncStores();
let queue = store.get('queue', []);   // offline actions [{op_id, ts, actions, context}]
let online = navigator.onLine;
let route = routeOf(location.hash);
let openedFresh = !location.hash;      // opened from the icon: the shopper lands on the list (once the server says so), everyone else on the chat
let mascot = null;
let awakeUntil = 0; // t3: until when Shuki is waking up (the chat's reactions wait for it)
let houseWas = null; // the house's mood at the last renderBand (allStocked on its change)
let partyWaits = false; // question 21: a level-up party waiting for the action's message to go
let undoing = false; // question 21: a "לבטל" on its way: the party waits for it too (the reviewer of bf7de10)
/** A momentary reaction by name (public/reactions.js), then back to the lasting mood. */
const feel = (name) => { const r = reaction(name); if (r) { mascot?.react(r.mood, r.ms, r); document.body.dataset.lastReaction = `${name}:${r.mood}`; } return !!r; }; // the last one stays readable (tests)
let chatLog = store.get('chat', []);
let pendingChat = null;               // { text, image } while waiting for Shuki
let pendingAfter = 0;                 // the newest message's id when it was sent: a row of mine after it is that message, kept by the server already
const recent = [];                    // timestamps of my successful updates (afro laugh streak)

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-levels': '21' /* stage 10, question 18: this app knows 21 levels */, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    setOnline(false);
    const e = new Error('אין קליטה'); e.offline = true; throw e;
  }
  setOnline(true);
  if (res.status === 401) {
    // p7 (approved 02/10): taken out by someone else (c06); any other way, as before, with a full stop
    let by = (await res.json().catch(() => null))?.removed; if (by && !by.name) by = null;
    unpaired = by ? `${by.name} ${byPerson(by, 'הוציא', 'הוציאה', 'הוציאו')} ${byPerson(S?.me, 'אותך', 'אותך', 'אתכם')} מהבית, אז הטלפון הזה כבר לא מחובר אליי. אם זו טעות, אפשר לבקש קוד חדש מאחד מחברי הבית.` : 'הטלפון הזה כבר לא מחובר אליי. אפשר לבקש קוד חדש מאחד מחברי הבית.';
    wipeLocal(); render(); throw new Error(unpaired);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'אופס, משהו השתבש. אפשר לנסות שוב'); e.status = res.status; throw e; }
  return data;
}
function setOnline(v) { if (online !== v) { online = v; renderBand(); if (route === 'chat') renderChatComposer(); } }

async function refresh(opts = {}) {
  if (!token) return;
  const seen = new Set((S?.list || []).map((i) => i.id));
  let fresh;
  try { fresh = await api('GET', '/api/state'); } catch { return; /* offline: keep cached */ }
  if (!token) return; // logged out while it was on its way
  const hadState = !!S;
  // nothing new: the screen stays as it is (a "sure?" waiting for its second tap isn't reset under a finger)
  const same = opts.quiet && hadState && JSON.stringify({ ...fresh, now: 0 }) === JSON.stringify({ ...S, now: 0 });
  S = fresh; store.set('state', S); syncStores(); applyQueueLocally();
  if (openedFresh) { openedFresh = false; if (route === 'chat' && S.shopping?.some((t) => t.mine)) { location.hash = '#list'; return; } }
  // don't rebuild the screen under someone's thumbs: it would close the keyboard and drop what they typed
  if (same) { /* nothing to redraw */ } else if (typingInMain()) { renderBand(); renderNav(); renderLater = true; } else render();
  if (!same) syncRecipeSheet();
  // in the store: what the other one just added shows up here, with a heads-up
  if (hadState && myTrip()) {
    const news = S.list.filter((i) => !seen.has(i.id) && i.added_by && i.added_by !== S.me.id);
    if (news.length) {
      const who = S.users.find((u) => u.id === news[0].added_by);
      toast(`${who?.name || ''} ${byPerson(who, 'הוסיף', 'הוסיפה', 'הוסיפו')} לרשימה: ${news.map((i) => productOf(i.product_id)?.name || i.text).join(', ')}`);
      feel('othersAdded');
    }
  }
  noticeGrowth();
}
let renderLater = false;
const typingInMain = () => { const a = document.activeElement; return !!a?.closest?.('#main') && isText(a); };
document.addEventListener('focusout', () => setTimeout(() => { if (renderLater && !typingInMain()) { renderLater = false; render(); } }, 400));
const myTrip = () => S?.shopping?.find((t) => t.mine);
const otherTrip = () => S?.shopping?.find((t) => !t.mine);

/** My Shuki as he's dressed now. */
const myLook = () => ({ level: S?.growth?.level || 1, wear: S?.outfit || {} });

/** Shuki grew a level: say so once per device, with what he got. */
// Stage 10 (t13): what was seen is kept in points (the level's `from`), not in a level's number, which changed with 21
// levels; `seenGrowth`, because `seenAt` is still on some phones from round 16 (a timestamp). The old `seenLevel` goes.
function noticeGrowth() {
  const g = S?.growth; if (!g) return;
  const seen = store.get('seenGrowth', null);
  if (seen == null) { store.set('seenGrowth', g.from); store.del('seenLevel'); return; } // first run (and the first after 21 levels): no party for the starting level
  // the level went down (16/10: points are days now): no party, and from here a level up is a party again
  if (g.from < seen) { store.set('seenGrowth', g.from); return; }
  if (g.from > seen && !partyWaits) {
    // question 21 (the owner 14/10): the party waits until the action's message (and its "לבטל") is gone, and comes then; by the
    // state of then, so an undo that took the level back throws no party
    partyWaits = true;
    (function party() {
      if (document.querySelector('.toast') || undoing) { setTimeout(party, 300); return; }
      partyWaits = false;
      const now = S?.growth; if (!now || now.from <= store.get('seenGrowth', -1)) return;
      store.set('seenGrowth', now.from);
      mascot?.setLook(myLook());
      feel('levelUp');
      const got = ITEMS.find((x) => x.level === now.level);
      toast(`גדלתי! עליתי לרמה ${now.level}: ${now.name}.${got ? ` וקיבלתי ${got.name}!` : ''}`);
    })();
  }
}

/* ---------- actions with offline queue ---------- */
/** Set by a 401 (this phone was disconnected): the pairing screen says so, until it's left or the app is reopened (walkthrough finding 10). */
let unpaired = null;
/**
 * This phone is no longer the house's (unpaired from afar, logged out, the house deleted): nothing of the house stays
 * on it, not the list, the chat, the searches, the photos, nor actions waiting for a signal (review A-7, QA Q-4).
 */
function wipeLocal() {
  token = null; S = null; queue = []; chatLog = []; houseWas = null; partyWaits = false; undoing = false;
  for (const k of store.keys()) store.del(k);
  for (const u of photoUrl.values()) URL.revokeObjectURL(u);
  photoUrl.clear();
  forgetPhotos();
}
let lastActError = null;
async function act(actions, { context, silent } = {}) {
  lastActError = null;
  const job = { op_id: uid(), ts: Date.now(), actions, context, by: S?.me?.id }; // whose it is: sent later only as them
  localApply(actions);
  render();
  try {
    const r = await api('POST', '/api/actions', job);
    if (r.nothing) { await refresh(); return r; } // question 41 (stage 5): nothing happened, so no "עודכן" and no "לבטל" (it would undo the one before)
    if (!silent) { if (r.eventId) toastUndo('עודכן'); else toast('עודכן'); } // 57: "לבטל" only with an action to undo
    await refresh();
    const open = () => S.list.filter((i) => i.status === 'open' && !i.ordered).length;
    celebrate(actions.some((a) => a.op?.type === 'discard') ? 'toss' : actions.some((a) => a.kind === 'check') ? (open() ? 'tick' : 'listEmpty') : actions.some((a) => a.kind === 'leftover' && a.gone) ? 'yum' : null);
    return r;
  } catch (e) {
    if (e.offline) { queue.push(job); store.set('queue', queue); toast('אין קליטה, נשמר בטלפון ויישלח כשתהיה קליטה'); }
    else { lastActError = e.message; toast(e.message); await refresh(); }
    return null;
  }
}
async function flushQueue() {
  if (!queue.length || !token) return;
  // what someone else queued on this phone isn't sent as whoever is paired now (Q-4)
  if (S?.me?.id && queue.some((j) => j.by && j.by !== S.me.id)) { queue = queue.filter((j) => !j.by || j.by === S.me.id); store.set('queue', queue); }
  while (queue.length) {
    try { await api('POST', '/api/actions', queue[0]); }
    catch (e) { if (e.offline || e.status >= 500) return; { toast('מוצר שסימנת בלי קליטה לא נשמר. כדאי לבדוק את הרשימה'); feel('error'); } } // a server hiccup: kept, sent again later
    queue.shift(); store.set('queue', queue);
  }
  toast('מה שסימנת בסופר עודכן ברשימה');
  await refresh();
}
function applyQueueLocally() { for (const j of queue) localApply(j.actions); }

/** Optimistic changes for the list screen, so it works with no signal. */
function localApply(actions) {
  if (!S) return;
  for (const a of actions) {
    const item = a.item_id != null && S.list.find((i) => i.id === a.item_id);
    if (a.kind === 'check' && item) Object.assign(item, { status: 'checked', bought_qty: a.amount ?? 1, pending: true, ...(a.store && { store: a.store }) });
    else if (a.kind === 'uncheck' && item) Object.assign(item, { status: 'open', bought_qty: null, pending: true });
    else if (a.kind === 'finish') S.list = S.list.filter((i) => !(i.status === 'checked' && (!a.store || i.store === a.store) && (i.checked_by == null || i.checked_by === S.me?.id)));
    else if (a.kind === 'list_add') S.list.push({ id: -Date.now(), product_id: a.product_id ?? null, text: a.text ?? null, store: a.store || 'super', status: 'open', source: 'manual', pending: true });
    else if (a.kind === 'list_remove') S.list = S.list.filter((i) => i.id !== a.item_id);
  }
}

function celebrate(name) {
  if (name === 'toss') { recent.length = 0; feel(name); return; }
  const now = Date.now();
  recent.push(now);
  while (recent.length && now - recent[0] > 5 * 60e3) recent.shift();
  if (recent.length >= 4) { recent.length = 0; mascot?.react('laughing', 2600, { fx: 'afro' }); } // a run of updates: he laughs with the afro (t7)
  else if (!(name && feel(name))) mascot?.react(Math.random() < .5 ? 'happy' : 'excited', 1400);
}

/* ---------- toast ---------- */
let toastTimer;
function toast(text, button) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(text)}</span>${button ? `<button type="button">${esc(button.label)}</button>` : ''}`;
  if (button) el.querySelector('button').onclick = () => { el.remove(); button.run(); };
  document.body.append(el);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), button ? 4500 : 3000);
}
function toastUndo(text) {
  toast(text, { label: 'לבטל', run: async () => { undoing = true; try { await api('POST', '/api/undo'); toast('בוטל'); feel('oops'); await refresh(); } catch (e) { toast(e.message); } finally { undoing = false; } } });
}

/* ================= frame ================= */
const TITLES = { chat: "צ'אט", list: 'רשימת קניות', inventory: 'מלאי', recipes: 'מתכונים', settings: 'הגדרות' };
function bandSub() {
  if (!S) return '';
  if (route === 'list') {
    const st = listStore();
    const mine = S.list.filter((i) => i.store === st && !i.ordered);
    const onWay = S.list.filter((i) => i.store === st && i.ordered).length;
    const inCart = mine.filter((i) => i.status === 'checked').length;
    if (!mine.length && onWay) return onWay === 1 ? 'מוצר אחד בדרך במשלוח' : `${onWay} מוצרים בדרך במשלוח`;
    return !mine.length ? 'אין מוצרים ברשימה' : inCart ? `${inCart} מתוך ${mine.length} בעגלה` : (mine.length === 1 ? 'מוצר אחד ברשימה' : `${mine.length} מוצרים ברשימה`);
  }
  if (route === 'inventory') return S.products.length === 1 ? 'מוצר אחד בבית' : `${S.products.length} מוצרים בבית`;
  if (route === 'recipes') { const n = (S.recipes || []).filter((x) => !x.status).length; return !n ? '' : n === 1 ? 'מתכון אחד' : `${n} מתכונים`; }
  if (route === 'settings') return `המכשיר של ${S.me.name}`;
  if (S.away?.now) return `בחופשה עד ${fmtDate(S.away.end - 1)} · בלי תזכורות`;
  if (!S.mood.basics) return ''; // a new house: nothing to say yet
  return basicsLine(S.mood);
}
/**
 * t1 (stage 10, decision 1): Shuki is "מבין" from a distress answer until my next message in my own chat (question 19);
 * not while a message of mine is on its way. A parent never sees it for a child: those rows are the child's only, and only
 * my own chat counts, not the open tab.
 */
function distressLast() {
  if (pendingChat || !S?.me) return false;
  // question 19 (the owner 14/10): only a new message of mine ends it; a bubble of Shuki's that isn't an answer to me (a card to
  // the house, "{ילד} ביקש… האם לאשר?", the morning's) doesn't. If the answer to my new message is distress, it's back.
  for (let i = chatLog.length - 1; i >= 0; i--) {
    const m = chatLog[i];
    if (!(m.thread == null || m.thread === S.me.id)) continue;
    if (m.role === 'user' && (m.user_id == null || m.user_id === S.me.id)) return false;
    if (m.role === 'shuki' && m.content?.distress) return true;
  }
  return false;
}
/**
 * Walkthrough finding 7: the basics below their minimum (out, or less than the minimum), the same number in the chat's
 * header and in settings. "צריך להשלים", since "חסרים" read as if they were all gone. `ofAll`: settings adds "מתוך N".
 */
function basicsLine(m, ofAll = false) {
  const n = m.basics - (m.inStock ?? Math.round(m.ratio * m.basics));
  if (n <= 0) return 'כל המוצרים הקבועים בבית';
  if (!ofAll || m.basics === 1) return n === 1 ? 'צריך להשלים מוצר קבוע אחד' : `צריך להשלים ${n} מוצרים קבועים`;
  return n === 1 ? `צריך להשלים מוצר אחד מתוך ${m.basics} מוצרים קבועים` : `צריך להשלים ${n} מתוך ${m.basics} מוצרים קבועים`;
}
/** The mascot's name for a screen reader (פ25, r12 q001, the owner 06/10, r7b): the lasting mood and its reason. */
function moodShown() { return distressLast() ? 'understanding' /* t1; before no reception (question 2) */ : !online ? 'sleepy' /* t6 (stage 10, decision 6): no reception is sleepy, not crying */ : S.brainError?.kind === 'credit' ? 'hungry' : (!S.brain || S.brainError) ? 'sleepy' : S.mood.mood; }
function moodLabel() {
  // n1 (the owner r10p): in distress, by who reads it, as D1's "אני כאן איתך"
  if (moodShown() === 'understanding') return `שוקי. מצב הרוח שלי: ${MOOD_NAMES.understanding}. אני כאן ${byPerson(S.me, 'איתך', 'איתך', 'איתכם')}.`;
  const why = !online ? 'אין קליטה' : (!S.brain || S.brainError) ? 'אני לא זמין כרגע'
    : S.mood.mood === 'sleepy' && !S.mood.never ? 'אשמח לשמוע מה חדש בבית' : S.mood.basics ? basicsLine(S.mood) : ''; // not before the first update (r7c, question 100)
  return `שוקי. מצב הרוח שלי: ${MOOD_NAMES[moodShown()] || ''}${why ? `. ${why}` : ''}`;
}
function renderBand() {
  const band = $('.band'); if (!band) return;
  band.querySelector('h1').textContent = TITLES[route] || "צ'אט";
  band.querySelector('.sub').textContent = bandSub();
  band.querySelector('.offline').hidden = online && !queue.length;
  band.querySelector('.offline').textContent = online ? (queue.length === 1 ? 'עדכון אחד מחכה לשליחה' : `${queue.length} עדכונים מחכים לשליחה`) : 'אין קליטה';
  // allStocked when the house's own mood turns to the full stock, and only when that is the face shown: never over "מבין",
  // no reception or no model, nor when "מבין" ends (the reviewer of 67f9002)
  if (S && mascot) { const was = houseWas ?? S.mood.mood, shown = moodShown(); houseWas = S.mood.mood; mascot.setMood(shown); mascot.setLabel(moodLabel()); mascot.setCalm(!online || !S.brain || !!S.brainError); mascot.setNight(() => !!S?.tz && isNight(Date.now(), S.tz)); /* t5 */ if (was !== 'ecstatic' && S.mood.mood === 'ecstatic' && shown === 'ecstatic') feel('allStocked'); if (store.get('seenGrowth', -1) >= (S.growth?.from ?? 0)) mascot.setLook(myLook()); }
}
function renderNav() {
  $('.nav').innerHTML = ['chat', 'list', 'inventory', 'recipes', 'settings'].map((r) => {
    const badge = r === 'list' && S ? S.list.filter((i) => i.status === 'open' && !i.ordered).length : 0; // what's on its way isn't to buy
    const ask = r === 'chat' && S ? S.recount?.length || 0 : 0; // the weekly recount waits in the chat
    return `<a href="#${r}" class="${r === route ? 'on' : ''}" ${r === route ? 'aria-current="page"' : ''}>${svg(ICON[r])}${{ chat: `צ'אט${ask ? ` <small class="navn">(${ask === 1 ? 'שאלה פתוחה אחת' : `${ask} שאלות פתוחות`})</small>` : ''}`, list: `רשימה${badge ? ` <small class="navn">(${badge === 1 ? 'מוצר אחד' : `${badge} מוצרים`})</small>` : ''}`, inventory: 'מלאי', recipes: 'מתכונים', settings: 'הגדרות' }[r]}</a>`;
  }).join('');
  requestAnimationFrame(fitNav);
  if (navSize && !$('.nav').dataset.sized) { $('.nav').dataset.sized = '1'; navSize.observe($('.nav')); if ($('.band')) navSize.observe($('.band')); }
}
/** Question 51: a tab of two lines ("(4 שאלות פתוחות)") makes the bar taller than --nav-h, and the composer above it then
 * sat 5px into it. What sits above the bar keeps clear of it by its real height (the safe area and the bar's own 8px aside). */
function fitNav() {
  const nav = $('.nav'); if (!nav || !nav.offsetHeight) return;
  const h = Math.round(nav.offsetHeight - (parseFloat(getComputedStyle(nav).paddingBottom) - 8));
  document.documentElement.style.setProperty('--nav-h', `${Math.max(64, h)}px`);
  // 59: the child tabs stick under the band, when it sticks (not while typing, nor in landscape)
  const band = $('.band'); document.documentElement.style.setProperty('--band-h', `${band && getComputedStyle(band).position === 'sticky' ? band.offsetHeight : 0}px`);
}
addEventListener('resize', () => requestAnimationFrame(fitNav));
const navSize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fitNav()) : null; // also when it comes back after typing, or a font swaps in

function frame() {
  document.body.innerHTML = `
    <div id="app" dir="rtl" lang="he">
      <header class="band"><h1></h1><p class="sub"></p><span class="offline" hidden></span><div class="mascot" title="שוקי"></div></header>
      <main id="main"></main>
      <div id="spoken" class="sr" aria-live="polite"></div>
    </div>
    <nav class="nav" dir="rtl" aria-label="מסכים"></nav>`;
  mascot = mountShuki($('.band .mascot'), S?.mood?.mood || 'happy', myLook());
  $('.band .mascot').onclick = () => feel('poke');
}

/** A field's name across a redraw: its id, the place it renames, or its place in its form ("מיקום חדש" in #newLoc). */
function fieldKey(el) {
  if (el.id) return `#${el.id}`;
  if (el.dataset.loc) return `loc:${el.dataset.loc}`;
  const f = el.closest('form[id]');
  return f ? `${f.id}:${[...f.querySelectorAll('input, textarea')].indexOf(el)}` : null;
}
function render() {
  if (!token) return renderPair();
  if (!$('#app') || !$('.nav')) frame();
  renderBand(); renderNav();
  const main = $('#main');
  main.className = route === 'chat' ? 'chat-mode' : '';
  document.body.classList.toggle('on-chat', route === 'chat');
  if (!S) { main.innerHTML = '<div class="empty">טוען…</div>'; return; }
  // a redraw must not eat what someone filled in and hasn't sent yet (a date just picked, half a word)
  // home19 (typing, 18/10): also a field with no id (settings: the house's name, a new place, store or category), and a field
  // drawn with a value that was changed (the house's name typed anew came back as it was): what was typed in it stays
  const fields = () => [...main.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea')];
  const kept = fields().map((el) => [fieldKey(el), el.value, el.value !== el.defaultValue]).filter(([k, v, typed]) => k && (v || typed));
  const a = document.activeElement, focus = main.contains(a) && isText(a) && fieldKey(a) && a.selectionStart != null ? { k: fieldKey(a), s: a.selectionStart, e: a.selectionEnd, dir: a.selectionDirection } : null;
  ({ chat: renderChat, list: renderList, inventory: renderInventory, recipes: renderRecipes, settings: renderSettings }[route] || renderChat)(main);
  // …nor a space at its end: the searches come back trimmed from the store (home19, item 6: "חומץ " lost its space, and the
  // caret put back after it glued the next letter to the word)
  const now = new Map(fields().map((el) => [fieldKey(el), el]));
  for (const [k, v, typed] of kept) { const el = now.get(k); if (el && (typed ? el.value !== v : !el.value || (el.value !== v && el.value === v.trim()))) el.value = v; }
  // …nor the caret, a selection or the focus of the field being typed in (16/10, the owner's iPhone: the caret jumped to the end)
  if (focus) { const el = now.get(focus.k); if (el && isText(el)) { if (document.activeElement !== el) el.focus({ preventScroll: true }); try { el.setSelectionRange(focus.s, focus.e, focus.dir); } catch { /* not a text field */ } } }
  hydratePhotos(main);
}
window.addEventListener('hashchange', () => { route = routeOf(location.hash); shownKey = null; shownConn = null; shownCode = null; devs = null; document.querySelector('.scrim')?.remove(); render(); if (route !== 'chat') window.scrollTo(0, 0); if (route === 'chat') loadChat(); else refresh({ quiet: true }); }); // another tab: what the others did meanwhile

/* ================= pairing ================= */
function renderPair() {
  mascot?.destroy(); mascot = null;
  document.body.classList.remove('on-chat', 'nobrain', 'kid', 'typing', 'focused'); // nothing of the screen it came from (finding 10: blue after a 401 in the chat)
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const android = /android/i.test(navigator.userAgent);
  // Safari 26 hides Share behind ⋯, and "הוספה למסך הבית" behind "הצגת עוד" (its user agent says "Version/26"; the iOS number there is frozen at 18) (approved 01/10; walkthrough finding 8)
  const safari26 = +(/Version\/(\d+)/.exec(navigator.userAgent)?.[1] || 0) >= 26;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  document.body.innerHTML = `
    <div id="app" dir="rtl" lang="he" style="grid-template-rows:auto 1fr">
      <header class="band"><h1>שוקי</h1><p class="sub">הרובוט לניהול המלאי של הבית</p><span class="offline" hidden></span></header>
      <main><form class="pair" id="pair">
        <div class="big"></div>
        <h2>נעים מאוד, אני שוקי</h2>
        ${android && !standalone ? `<div class="howto"><b>התקינו אותי בטלפון שלכם:</b><ol><li>ב-Chrome פותחים את התפריט (שלוש הנקודות למעלה)</li><li>"התקנת האפליקציה" או "הוספה למסך הבית"</li><li>פותחים אותי מהאייקון ומקלידים שם את הקוד</li></ol></div>` : ''}
        ${ios && !standalone ? `<div class="howto"><b>התקינו אותי בטלפון שלכם:</b><ol><li>${safari26 ? 'ב-Safari לוחצים על ⋯ (שלוש הנקודות) ← שיתוף' : 'ב-Safari לוחצים על כפתור השיתוף'}</li><li>${safari26 ? 'לוחצים על "הצגת עוד" ואז על "הוספה למסך הבית"' : '"הוספה למסך הבית"'}</li><li>פותחים אותי מהאייקון ומקלידים שם את הקוד</li></ol></div>` : ''}
        <p>הקלידו את הקוד שקיבלתם (6 ספרות). צריך את זה רק פעם אחת בכל טלפון.</p>
        <input class="field code" id="code" inputmode="numeric" autocomplete="one-time-code" aria-label="קוד חיבור" required>
        <button class="btn go" type="submit">להתחבר</button>
        <p class="err" id="err" hidden></p>
      </form></main>
    </div>`;
  const m = mountShuki($('.pair .big'), 'excited');
  // a pasted code often comes with a space or a dash ("944 080"): keep the digits
  const codeIn = $('#code');
  codeIn.oninput = () => { const d = codeIn.value.replace(/\D/g, '').slice(0, 6); if (d !== codeIn.value) codeIn.value = d; };
  $('#pair').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#err'); err.hidden = true;
    try {
      const r = await api('POST', '/api/pair', { code: $('#code').value.trim(), name: navigator.platform || '' });
      token = r.token; store.set('token', token); unpaired = null; m.destroy();
      document.body.innerHTML = ''; render(); await refresh(); loadChat();
    } catch (x) { err.textContent = x.message; err.hidden = false; m.react('confused', 2000); }
  };
  if (unpaired) { $('#err').textContent = unpaired; $('#err').hidden = false; }
  // a brand-new house: set it up instead (the one-time code from the deploy or the server's log)
  api('GET', '/api/setup').then((r) => { if (r.needed && $('#pair')) setupForm(m); }).catch(() => {});
}

const tzList = () => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['Asia/Jerusalem']; } };
const myTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem'; } catch { return 'Asia/Jerusalem'; } };
function tzSelect(id, cur) { const list = tzList(); if (!list.includes(cur)) list.unshift(cur); return `<select class="field" id="${id}">${list.map((z) => `<option value="${esc(z)}" ${z === cur ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>`; }

function setupForm(m) {
  const f = $('#pair'); f.id = 'setup'; f.classList.add('setup');
  f.innerHTML = `<div class="big"></div>
    <h2>ברוכים הבאים לשוקי!</h2>
    <p>כדי שנוכל לנהל את המלאי של הבית, צריך להקים את הבית באפליקציה.</p><p>אנחנו מקימים את הבית פעם אחת. מי שמקים הוא מנהל הבית באפליקציה. לאחר שנקים את הבית, נוסיף את שאר חברי הבית.</p>
    <label>קוד הקמה<small>8 הספרות שבחרתם בהתקנה. אם לא בחרתם, הקוד מופיע בלוג של השרת.</small><input class="field code" id="s-code" inputmode="numeric" autocomplete="one-time-code" required></label>
    <label>מפתח Claude או ChatGPT<small>כדי שאוכל לדבר איתכם אני צריך מפתח של Claude או ChatGPT. אפשר להוסיף אותו גם אחר כך בהגדרות.</small><input class="field" id="s-key" dir="ltr" autocomplete="off" spellcheck="false" placeholder="sk-ant-..."></label>
    <button class="btn go" type="submit">להקים את הבית</button>
    <p class="err" id="err" hidden></p>`;
  m.destroy(); const m2 = mountShuki($('.big', f), 'excited');
  const c = $('#s-code'); c.oninput = () => { const d = c.value.replace(/\D/g, '').slice(0, 8); if (d !== c.value) c.value = d; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#err'); err.hidden = true;
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'מקים…';
    try {
      // the time zone is the phone's; the name, how to talk to me and the house's name Shuki asks in the chat (30/09)
      const r = await api('POST', '/api/setup', { code: c.value, key: $('#s-key').value.trim() || undefined, tz: myTz(), device: navigator.platform || '' });
      token = r.token; store.set('token', token); m2.destroy();
      document.body.innerHTML = ''; location.hash = r.restored ? '#settings' : '#chat'; render(); await refresh(); loadChat();
      toast(r.restored ? `שחזרתי ${r.restored.products || 0} מוצרים! עכשיו צריך לחבר את הטלפונים של חברי הבית: בהגדרות יש קוד לכל אחד` : 'הבית הוקם. אני מחכה לך בצ\'אט!');
    } catch (x) { err.textContent = x.message; err.hidden = false; m2.react('confused', 2000); btn.disabled = false; btn.textContent = 'להקים את הבית'; }
  };
}

/* ================= chat ================= */
// Shuki's new bubbles come in one after another, each with its face (decision 180)
const fresh = new Map(); let seenChat = null;
async function loadChat() {
  if (!token) return;
  // while waiting for Shuki the server has my message already: loading now would show it twice, and his answer would come
  // in before the reply does (15/10, the first use: back to the app in the middle of the mapping). sendChat loads after it
  if (pendingChat) return;
  try {
    const r = await api('GET', '/api/chat');
    const known = seenChat ?? new Set((r.messages || []).map((m) => m.id)); // the first load isn't "new"
    const news = r.messages.filter((m) => m.role === 'shuki' && !known.has(m.id));
    fresh.clear(); news.forEach((m, k) => fresh.set(m.id, k * 900));
    seenChat = new Set(r.messages.map((m) => m.id));
    chatLog = r.messages; store.set('chat', chatLog.slice(-40)); if (route === 'chat') renderThread();
    renderBand(); // t1: "מבין" follows the chat
    const wait = Math.max(0, awakeUntil - Date.now()); // t3: the yawn first (the reviewer of 3386ecb)
    news.forEach((m, k) => { if (m.content.reaction) setTimeout(() => feel(m.content.reaction), wait + k * 900); });
    return news;
  } catch { return null; } // offline: null, so a sender can tell it didn't load (question 19)
}
/** Pairing codes in the first meeting: one line each, with a way to send it (WhatsApp...). */
function codesHtml(codes) {
  return `<span class="codes">${codes.map((x) => `<span class="coderow"><b><bdi>${esc(x.name)}</bdi></b><span class="num" dir="ltr">${esc(x.code)}</span><button class="btn" type="button" data-share-code="${esc(x.code)}" data-name="${esc(x.name)}" data-gender="${esc(x.gender || '')}">לשלוח ל${esc(x.name)}</button></span>`).join('')}</span>`;
}

function renderChat(main) {
  // the thread is redrawn whole on every refresh: a screen reader hears only Shuki's new answers to me, in #spoken (פ25, q002),
  // which is outside #main, so a redraw doesn't touch it (question 99)
  main.innerHTML = `<section class="chat"><div class="thread" id="thread"></div>
    <form class="composer" id="composer">
      <button type="button" class="rbtn cam" id="cam" title="צילום קבלה או מוצר" aria-label="צילום קבלה או מוצר">${svg('<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z" stroke-linejoin="round"/><path d="M9 8h6M9 12h6" stroke-linecap="round"/>', '#15110E')}</button><input type="file" id="photo" accept="image/*" hidden>
      <div class="pill"><textarea id="say" rows="1" placeholder="כתבו לשוקי…" aria-label="הודעה אליי" enterkeyhint="send"></textarea>
      <button class="sendb" id="send" type="submit" aria-label="שליחה">${svg('<path d="M12 19V5M6 11l6-6 6 6" stroke-linecap="round" stroke-linejoin="round"/>', '#15110E', 3)}</button></div>
    </form></section>`;
  renderThread();
  renderChatComposer();
  const ta = $('#say');
  const hasText = () => $('#composer')?.classList.toggle('has-text', !!ta.value.trim());
  // the height follows the text, and the caret stays where it is while it does (16/10: iOS could lose it to the resize)
  ta.oninput = () => { const s0 = ta.selectionStart, e0 = ta.selectionEnd; ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`; if (ta.selectionStart !== s0 || ta.selectionEnd !== e0) ta.setSelectionRange(s0, e0); hasText(); syncKeyboard(); mascot?.lookAt('down', 700); };
  // iOS: a tap on send must not take the focus from the text field (that shifts the page mid-tap and the tap is lost)
  $('#send').addEventListener('pointerdown', (e) => e.preventDefault());
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); $('#composer').requestSubmit(); } };
  $('#composer').onsubmit = (e) => { e.preventDefault(); const t = ta.value.trim(); if (t && !pendingChat) { ta.value = ''; ta.style.height = 'auto'; hasText(); sendChat({ text: t }); } };
  $('#cam').onclick = () => $('#photo').click(); // stage 13, d11: a button VoiceOver reaches (a label around a hidden input wasn't)
  $('#photo').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    // a receipt (what we bought) or a product (a new thing to add, with its photo)
    sheet(`<h2>מה בתמונה?</h2><div class="kinds"><button class="btn go" type="button" id="k-rec">קבלה</button><button class="btn blue" type="button" id="k-prod">מוצר אחד</button><button class="btn yel" type="button" id="k-shelf">מקרר / מדף</button><button class="btn yel" type="button" id="k-recipe">מתכון</button></div><div class="acts"><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
      $('#k-rec', el).onclick = async () => { close(); try { sendChat({ text: 'צילמתי קבלה', image: await shrink(f) }); } catch { toast('לא הצלחתי לקרוא את התמונה'); } };
      $('#k-shelf', el).onclick = async () => { close(); try { sendChat({ text: 'צילמתי מה יש כאן', image: await shrink(f), kind: 'shelf' }); } catch { toast('לא הצלחתי לקרוא את התמונה'); } };
      $('#k-recipe', el).onclick = async () => { close(); try { sendChat({ text: 'צילמתי מתכון', image: await shrink(f), kind: 'recipe' }); } catch { toast('לא הצלחתי לקרוא את התמונה'); } };
      $('#k-prod', el).onclick = async () => {
        close();
        try { sendChat({ text: 'צילמתי מוצר', image: await shrink(f), kind: 'product', thumb: (await shrink(f, 320, 0.7)).data }); } catch { toast('לא הצלחתי לקרוא את התמונה'); }
      };
    });
  };
}
function renderChatComposer() {
  const off = !online;
  const brainless = !!S?.brainError || S?.brain === false;
  const noBrain = brainless && !S?.aboutMe; // the name, how to talk to them and the house's name need no model (approved 01/10)
  for (const id of ['say', 'send', 'photo']) { const el = document.getElementById(id); if (el) el.disabled = off || (id === 'photo' ? brainless : noBrain) || (id !== 'say' && !!pendingChat); }
  { const cam = document.getElementById('cam'), ph = document.getElementById('photo'); if (cam && ph) cam.setAttribute('aria-disabled', String(ph.disabled)); } // stage 13: VoiceOver hears when the camera is off (no visual change) // the text field stays on while Shuki answers, so the keyboard doesn't drop
  const say = $('#say'); if (say) say.placeholder = off ? 'אין קליטה' : noBrain ? 'אני לא זמין כרגע' : byPerson(S?.me, 'כתוב לי…', 'כתבי לי…', 'כתבו לי…');
  // no credit / no key: say so plainly (the admin gets what to do), the list and the inventory work as usual
  let bar = $('#brainBar');
  document.body.classList.toggle('nobrain', noBrain); // the thread leaves room for the bar
  if (!noBrain) { bar?.remove(); return; }
  const admin = S.me?.role === 'admin';
  const text = !S.brain ? (admin ? 'אין לי מפתח של Claude או ChatGPT, אז אני לא יכול לדבר. מוסיפים אותו בהגדרות → הבית.' : 'אני עוד לא יכול לדבר איתכם, כי אין לי מפתח. הרשימה והמלאי עובדים כרגיל.')
    : admin ? (S.brainError.kind === 'credit' ? (S.provider === 'openai' ? 'נגמר לי הקרדיט בחשבון ChatGPT, אז אני לא יכול לחשוב. מוסיפים קרדיט בקונסולה של OpenAI ולוחצים על "בדיקה".' : 'נגמר לי הקרדיט בחשבון Claude, אז אני לא יכול לחשוב. מוסיפים קרדיט בקונסולה של Anthropic ולוחצים על "בדיקה".') : `יש בעיה עם מפתח ${S.provider === 'openai' ? 'ChatGPT' : 'Claude'}. מחליפים אותו בהגדרות → הבית.`) : 'שוקי לא זמין כרגע. הרשימה והמלאי עובדים כרגיל.';
  if (!bar) { bar = document.createElement('div'); bar.id = 'brainBar'; bar.className = 'brainbar'; $('#composer')?.prepend(bar); }
  bar.innerHTML = `<span>${esc(text)}</span>${admin && S.brain ? '<button class="btn" type="button" id="brainCheck">בדיקה</button>' : ''}`;
  $('#brainCheck')?.addEventListener('click', async (e) => { e.target.disabled = true; try { const r = await api('POST', '/api/brain/check'); toast(r.ok ? 'חזרתי!' : r.error); if (r.ok) feel('welcomeBack'); await refresh(); } catch (x) { toast(x.message); } e.target.disabled = false; });
}

/** Once a week: "is this still right?" for a few products nobody has looked at in a while. */
function recountCard() {
  const ps = (S.recount || []).map(productOf).filter(Boolean);
  if (!ps.length) return '';
  return `<div class="msg bot">${S.recountKind === 'idle' ? 'בואו נבדוק: האם זה עדיין נכון?' : 'בדיקה שבועית: האם זה עדיין נכון?'}</div>
    <div class="coupon recount">${ps.map((p) => `<div class="rq"><span><bdi>${esc(p.name)}</bdi><small>${esc(haveText(p))}</small></span><button class="btn yel" type="button" data-rc-yes="${p.id}">הסטטוס מעודכן</button><button class="btn" type="button" data-rc-fix="${p.id}">הסטטוס לא מעודכן, ${byPerson(S?.me, 'בוא', 'בואי', 'בואו')} נתקן</button></div>`).join('')}</div>`;
}
/** "a little left" of something that isn't basic: to the list, remind me, or not needed. Shown in the chat and on the list. */
function lowCard() {
  const xs = (S.lowAsk || []).filter((x) => productOf(x.id));
  if (!xs.length) return '';
  const names = xs.map((x) => x.name); const all = names.length > 1 ? `${names.slice(0, -1).join(', ')} ו${names.at(-1)}` : names[0];
  return `<div class="msg bot">נשאר מעט ${esc(all)}. ${byPerson(S.me, 'האם תרצה', 'האם תרצי', 'האם תרצו')} שאוסיף את זה לרשימה?</div>
    <div class="coupon recount low-card">${xs.map((x) => `<div class="rq low"><span>${thumb(productOf(x.id), 'thumb sm')}<bdi>${esc(x.name)}</bdi><small>${esc(haveText(productOf(x.id)))}</small></span><span class="three"><button class="btn yel" type="button" data-low="${x.id}" data-d="list">להוסיף לרשימה</button><button class="btn" type="button" data-low="${x.id}" data-d="remind">תזכיר לי בעוד 3 ימים</button><button class="btn" type="button" data-low="${x.id}" data-d="no">לא צריך לעשות כלום כרגע</button></span></div>`).join('')}</div>`;
}
function wireLow(root) {
  root.querySelectorAll('[data-low]').forEach((b) => (b.onclick = async () => {
    const row = b.closest('.rq'); row.classList.add('gone');
    try {
      const r = await api('POST', '/api/low', { id: +b.dataset.low, decision: b.dataset.d, days: 3 });
      const nm = productOf(+b.dataset.low)?.name || '';
      toast(b.dataset.d === 'list' ? `${nm} ${byGender(nm,'נוסף','נוספה','נוספו')} לרשימה` : b.dataset.d === 'remind' ? `אזכיר לכם ב-${fmtDate(r.at)}` : 'בסדר, לא הוספתי');
      await refresh();
    } catch (e) { row.classList.remove('gone'); toast(e.offline ? 'אין קליטה, אפשר לנסות שוב אחר כך' : e.message); }
  }));
}
/** Past its date: thrown away, or still fine (a nose knows better than a label). */
const expKey = (x) => `${x.id}:${x.expires}`;
function expiredCard() {
  const ok = new Set(store.get('expOk', []));
  const xs = (S.expired || []).filter((x) => !ok.has(expKey(x)) && productOf(x.id));
  if (!xs.length) return '';
  return `<div class="msg bot">${xs.length === 1 ? `לפי מה שאני יודע, פג התוקף של ${esc(xs[0].name)}. מה עשיתם ${byGender(xs[0].name, 'איתו', 'איתה', 'איתם', 'איתן')}?` : 'לפי מה שאני יודע, פג התוקף של אלה. מה עשיתם איתם?'}</div>
    <div class="coupon recount expired-card">${xs.map((x) => `<div class="rq"><span>${thumb(productOf(x.id), 'thumb sm')}<bdi>${esc(x.name)}</bdi><small>התוקף עבר ב-${fmtDate(x.expires)}</small></span><span class="three"><button class="btn yel" type="button" data-ex-toss="${x.id}">זרקנו</button><button class="btn" type="button" data-ex-date="${x.id}">המוצר עדיין בתוקף</button><button class="btn" type="button" data-ex-ok="${x.id}">המוצר עדיין בסדר</button></span></div>`).join('')}</div>`;
}
function wireRecount(th) {
  th.querySelectorAll('[data-ex-toss]').forEach((b) => (b.onclick = () => { b.closest('.rq').classList.add('gone'); act([{ kind: 'op', product_id: +b.dataset.exToss, op: { type: 'discard' } }]); }));
  th.querySelectorAll('[data-ex-ok]').forEach((b) => (b.onclick = () => {
    const x = S.expired.find((e) => e.id === +b.dataset.exOk); if (!x) return;
    store.set('expOk', [...store.get('expOk', []), expKey(x)].slice(-60));
    b.closest('.rq').classList.add('gone');
    const p = productOf(x.id);
    if (p && p.count_type !== 'batches') act([{ kind: 'op', product_id: x.id, op: { type: 'set', expires: Date.now() + 2 * DAY } }], { silent: true });
    else renderThread(); // ש2: the next card comes, as after the others
  }));
  th.querySelectorAll('[data-ex-date]').forEach((b) => (b.onclick = () => {
    const x = S.expired.find((e) => e.id === +b.dataset.exDate); if (!x) return;
    sheet(`<h2>עד מתי <bdi>${esc(x.name)}</bdi> בתוקף?</h2><input class="field num" type="date" id="exNew" required>
      <div class="acts"><button class="btn go" type="button" id="exSave">שמירה</button><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
      $('#exSave', el).onclick = () => {
        const v = $('#exNew', el).value; if (!v) return;
        close(); b.closest('.rq')?.classList.add('gone');
        store.set('expOk', [...store.get('expOk', []), expKey(x)].slice(-60));
        act([{ kind: 'op', product_id: x.id, op: { type: 'set', expires: new Date(`${v}T12:00:00`).getTime() } }], { silent: true });
      };
    });
  }));
  th.querySelectorAll('[data-rc-yes]').forEach((b) => (b.onclick = () => { b.closest('.rq').classList.add('gone'); act([{ kind: 'confirm', product_id: +b.dataset.rcYes }], { silent: true }); }));
  th.querySelectorAll('[data-rc-fix]').forEach((b) => (b.onclick = () => countSheet(productOf(+b.dataset.rcFix))));
}
/** "fix it": how many are there really. */
function countSheet(p, extra = []) {
  if (!p) return;
  const lvl = p.count_type === 'level';
  let n = p.count_type === 'inuse' ? p.qty || 0 : +(p.qty || 0);
  let open = p.is_open ? 1 : 0; let level = p.level || 'plenty';
  const unit = p.count_type === 'pack' ? 'יחידות' : p.count_type === 'inuse' ? 'כמה סגורים יש בארון' : p.unit || '';
  sheet(`<h2>כמה <bdi>${esc(p.name)}</bdi> יש?</h2>
    ${lvl ? `<div class="levels" id="c-level">${LEVELS.map(([v, t]) => `<button type="button" data-v="${v}" class="${level === v ? 'on' : ''}">${t}</button>`).join('')}</div>`
    : `<div class="stepper"><button type="button" data-d="1" aria-label="עוד">${svg('<path d="M12 5v14M5 12h14" stroke-linecap="round"/>', '#15110E', 3.4)}</button><output id="c-n" class="num">${n}</output><button type="button" data-d="-1" aria-label="פחות">${svg('<path d="M5 12h14" stroke-linecap="round"/>', '#15110E', 3.4)}</button></div>
    <p style="text-align:center;margin:0;font-family:var(--label)">${esc(unit)}</p>
    ${p.count_type === 'inuse' ? `<label class="switch">יש אחד פתוח<input type="checkbox" id="c-open" ${open ? 'checked' : ''}></label>` : ''}`}
    <div class="acts"><button class="btn go" type="button" id="c-ok">שמירה</button><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
    el.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { n = Math.max(0, n + +b.dataset.d); $('#c-n', el).textContent = n; }));
    el.querySelectorAll('#c-level [data-v]').forEach((b) => (b.onclick = () => { level = b.dataset.v; el.querySelectorAll('#c-level button').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#c-ok', el).onclick = () => {
      if ($('#c-open', el)) open = $('#c-open', el).checked ? 1 : 0;
      close();
      act([{ kind: 'op', product_id: p.id, op: lvl ? { type: 'set', level } : p.count_type === 'inuse' ? { type: 'set', qty: n, is_open: open } : { type: 'set', qty: n } }, ...extra]);
    };
  });
}

/** A load already on its way when I sent brought my message from the server: it shows once, there. */
const echoed = (log) => log.some(({ m }) => m.role === 'user' && (m.id || 0) > pendingAfter && (m.user_id == null || m.user_id === S.me.id) && (m.content?.text || '') === (pendingChat.text || ''));
function renderThread() {
  const th = $('#thread'); if (!th) return;
  if (!chatLog.length && !pendingChat) {
    const first = !S.products.length;
    th.innerHTML = `${chatTabs()}<div class="msg bot">${first
      ? 'היי! אני שוקי, הרובוט החמוד שעוזר לנהל את המלאי בבית. אני עדיין לא מכיר את הבית שלכם!\nכשתרצו להתחיל, תוכלו לכתוב לי "בוא נכיר". אפשר גם להתחיל מלספר לי מה יש בבית כרגע. למשל: "במקרר יש 3 יוגורטים, 6 ביצים וחלב"'
      : 'היי! מה נגמר? מה קניתם?'}</div>${serverCard()}`;
    wireRecount(th); wireLow(th); wireLeftovers(th); hydratePhotos(th); wireThreadBar(th);
    return;
  }
  // q05: a grown-up reads a child's chat in its own tab; q01: no names above the messages
  const tab = chatTab(), kid = tab !== 'me';
  const log = chatLog.map((m, i) => ({ m, i })).filter(({ m }) => (kid ? m.thread === tab : m.thread == null || m.thread === S.me.id));
  seeTab(tab);
  const last = log.length ? log.at(-1).i : -1;
  // D7ב (q02, q03): a gray line is a kraft note; three or more in a row are one note, with the rest in the bottom sheet
  const rows = [];
  for (const x of log) { const prev = rows.at(-1); if (x.m.role === 'event' && prev?.gray) prev.gray.push(x.m); else rows.push(x.m.role === 'event' ? { gray: [x.m] } : x); }
  th.innerHTML = chatTabs() + rows.map((row) => {
    if (row.gray) return grayNote(row.gray);
    const { m, i } = row, c = m.content;
    if (m.role === 'user') return `<div class="msg me">${c.fb ? `<span class="fbmark" aria-label="על תשובה לא טובה">${THUMB_DOWN}</span>` : ''}${esc(c.text)}${c.image ? '<small> (תמונה)</small>' : ''}</div>`;
    const fb = m.id && c.ai && !kid && !c.distress; // q05, q12: no 👍/👎 in a child's chat or on a distress answer
    let h = `<div class="msg bot${fb ? ' hasfb' : ''}${fresh.has(m.id) ? ' fresh' : ''}" style="${fresh.has(m.id) ? `animation-delay:${fresh.get(m.id)}ms` : ''}">${c.distress || c.tel ? telHtml(c.reply) : c.link === 'privacy' ? privacyHtml(c.reply) : esc(c.reply)}${c.undo && i >= last - 2 && !kid ? '<button class="linkish fix" type="button" data-fix>לבטל</button>' : ''}${c.codes ? codesHtml(c.codes) : ''}${fb ? thumbs(m.id, c) : ''}</div>`;
    if (c.proposal) h += coupon(c.proposal, i, c);
    if (i === last && !kid && c.options?.length && !c.proposal && !(c.card && (isChild() || c.answered))) h += /* 66: a child sees no buttons on a card to the house; nobody on one already closed */ `<div class="chips">${c.options.map((o) => `<button class="chip" type="button" data-opt="${esc(o)}">${thumb(S.products.find((p) => norm(p.name) === norm(o)), 'thumb sm')}${esc(o)}</button>`).join('')}</div>`;
    return h;
  }).join('') + (kid ? '' : pendingChat ? `${echoed(log) ? '' : `<div class="msg me">${esc(pendingChat.text)}</div>`}<div class="msg bot typing" aria-label="אני חושב"><i></i><i></i><i></i></div>` : serverCard());
  wireRecount(th); wireLow(th); wireLeftovers(th); hydratePhotos(th);
  // home20 round 3, fix 3 (the owner 19/10): while the chat ends in a card waiting for an answer, the tabs ("הצ'אט שלי" / a child)
  // scroll with the chat instead of staying stuck at the top, so the card has the room for its lines and its buttons
  { const ms = th.querySelectorAll('.msg'), last = [...th.querySelectorAll('.coupon')].at(-1);
    th.classList.toggle('cardup', !!last && last.classList.contains('pending') && (!ms.length || !!(ms[ms.length - 1].compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING))); }
  requestAnimationFrame(() => {
    // keyboard up (iOS): bring the last message just above the composer. Scrolling the page to its very end under the
    // keyboard makes Safari shrink the viewport and the composer floats above a gap.
    const c = $('#composer'), end = th.lastElementChild;
    if (document.body.classList.contains('typing') && c && end) window.scrollBy(0, end.getBoundingClientRect().bottom - c.getBoundingClientRect().top + 12);
    else window.scrollTo(0, document.documentElement.scrollHeight);
    // home20 round 2, fix 8 (the owner 19/10): a card taller than the room left under the stuck tabs ("הצ'אט שלי" / a child) or band
    // had its first lines under them ("לתכנן דגים להיום?"): the newest card, when it is the chat's last, starts just under them
    const msgs = th.querySelectorAll('.msg'), cp = [...th.querySelectorAll('.coupon')].at(-1);
    if (cp && (!msgs.length || msgs[msgs.length - 1].compareDocumentPosition(cp) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      const under = Math.max(0, ...[...document.querySelectorAll('.band, .chattabs')].filter((e) => ['sticky', 'fixed'].includes(getComputedStyle(e).position)).map((e) => e.getBoundingClientRect().bottom));
      const top = cp.getBoundingClientRect().top;
      if (top < under + 8) window.scrollBy(0, top - under - 8);
    }
  });
  // "כן, אכתוב לך" sends nothing: the cursor goes to the box, for the words (17/10, ש4)
  th.querySelectorAll('[data-opt]').forEach((b) => (b.onclick = () => (b.dataset.opt === 'כן, אכתוב לך' ? $('#say')?.focus() : sendChat({ text: b.dataset.opt }))));
  th.querySelectorAll('.coupon').forEach(wireCoupon);
  th.querySelectorAll('[data-fix]').forEach((b) => (b.onclick = async () => { try { await api('POST', '/api/undo'); toast('ביטלתי. מה יש שם?'); feel('oops'); await refresh(); } catch (e) { toast(e.message); } }));
  th.querySelectorAll('[data-share-code]').forEach((b) => (b.onclick = () => shareOut(`היי ${b.dataset.name}! הוספתי ${byPerson(b.dataset.gender, 'אותך', 'אותך', 'אתכם')} לשוקי, הרובוט שמנהל לנו את המלאי בבית. פותחים את ${location.origin} ב-${/Android/i.test(navigator.userAgent) ? 'Chrome' : 'Safari'}, מוסיפים למסך הבית ומקלידים את הקוד ${b.dataset.shareCode}`, 'ההודעה הועתקה')));
  wireThreadBar(th);
}
/** 👍 / 👎 beside each of Shuki's answers: one stays pressed, and 👎 can teach him a rule. */
function thumbs(id, c) {
  return `<span class="fb"><button class="up${c.up ? ' on' : ''}" type="button" data-up="${id}" aria-pressed="${!!c.up}" aria-label="תשובה טובה">${THUMB_UP}</button><button class="down${c.down ? ' on' : ''}" type="button" data-down="${id}" aria-pressed="${!!c.down}" aria-label="תשובה לא טובה">${THUMB_DOWN}</button></span>`;
}
const THUMB_UP = svg('<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.3a2 2 0 0 0 2-1.7l1.4-9A2 2 0 0 0 19.7 9zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" stroke-linejoin="round"/>', 'currentColor', 2);
const THUMB_DOWN = svg('<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.7a2 2 0 0 0-2 1.7l-1.4 9A2 2 0 0 0 4.3 15zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" stroke-linejoin="round"/>', 'currentColor', 2);
/** ש2 (the owner 05/10, q13, b04): one card from the server at a time, at the end of the chat, in a fixed order; each with all its products */
// 8 (the owner 05/10 noon): a server card saved as a chat row ("התגעגעתי", moving) comes before them all: while one waits for
// its answer, it is the only one, and the others wait
const rowCardWaits = () => chatLog.some((m) => m.content?.card && !m.content.answered && (m.thread == null || m.thread === S.me.id));
const serverCard = () => (rowCardWaits() ? '' : expiredCard() || lowCard() || leftoverCard() || recountCard() || suggestCard());
/** q05 (approved 02/10): "הצ'אט שלי" and a tab for each child a grown-up sees, with a red dot when there's something new. */
const kidsISee = () => (isChild() ? [] : S.users.filter((u) => u.role === 'child' && S.settings?.[`child_chat:${S.me.id}:${u.id}`] !== '0'));
let openTab = 'me';
function chatTab() { if (openTab !== 'me' && !kidsISee().some((u) => u.id === openTab)) openTab = 'me'; return openTab; }
const newest = (id) => Math.max(0, ...chatLog.filter((m) => (id === 'me' ? m.thread == null || m.thread === S.me.id : m.thread === id)).map((m) => m.ts || 0));
function seeTab(tab) { store.set(`seenTab:${tab}`, Math.max(newest(tab), store.get(`seenTab:${tab}`, 0))); }
function chatTabs() {
  const kids = kidsISee(); if (!kids.length) return '';
  const tab = chatTab(), dot = (id) => (id !== tab && newest(id) > store.get(`seenTab:${id}`, 0) ? '<i class="dot" role="img" aria-label="יש הודעות חדשות"></i>' : '');
  return `<div class="flaps chattabs" role="tablist">${[['me', "הצ'אט שלי"], ...kids.map((u) => [u.id, u.name])].map(([id, n]) => `<button type="button" role="tab" aria-selected="${id === tab}" class="flap ${id === tab ? 'on' : ''}" data-tab="${id}">${esc(n)}${dot(id)}</button>`).join('')}</div>`;
}
/** D1–D6 (q12): the phone numbers in bold, and they call. */
const telHtml = (t) => esc(t).replace(/(?<!\d)(\d{3,5})(?!\d)/g, '<a href="tel:$1"><b>$1</b></a>');
// r13l (15/10): what's kept and what's sent, the README's Privacy; the recording answer's last "כאן", and a link in settings
const PRIVACY_URL = 'https://github.com/OhadTheFox/shuki#privacy';
const privacyHtml = (t) => esc(t).replace(/כאן(?=\.?$)/, `<a href="${PRIVACY_URL}" target="_blank" rel="noopener">כאן</a>`);
/** D7ב: one gray line, or the first three of a run and "ועוד N עדכונים" (the words of the old "since" bar), the rest in a sheet. */
function grayNote(xs) {
  if (xs.length < 3) return xs.map((m) => `<div class="gray">${esc(m.content.gray)}</div>`).join('');
  const shown = xs.slice(0, 3).map((m) => m.content.gray);
  // 2 (the owner 05/10): "ועוד עדכון אחד" for one, and the "ועוד" underlined, so it's clear it opens
  const more = xs.length - 3, html = more > 0 ? `${esc(shown.join(', '))} <u>${more === 1 ? 'ועוד עדכון אחד' : `ועוד ${more} עדכונים`}</u>` : esc(`${shown.slice(0, -1).join(', ')} ו${shown.at(-1)}`);
  return `<button type="button" class="gray more" data-grays="${esc(xs.map((m) => m.id).join(','))}">${html}</button>`;
}
function wireThreadBar(th) {
  th.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { openTab = b.dataset.tab === 'me' ? 'me' : +b.dataset.tab; renderThread(); }));
  th.querySelectorAll('[data-grays]').forEach((b) => (b.onclick = () => {
    const ids = new Set(b.dataset.grays.split(',')), xs = chatLog.filter((m) => ids.has(String(m.id)));
    sheet(`<div class="journal">${xs.map((m) => `<div class="rowline"><span>${esc(m.content.gray)}</span><small>${esc(fmtDate(m.ts))}</small></div>`).join('')}</div><div class="acts"><button class="btn" type="button" data-close>סגירה</button></div>`);
  }));
  const press = (id, up) => { const m = chatLog.find((x) => x.id === id); if (m) { m.content.up = up || undefined; m.content.down = !up || undefined; } renderThread(); };
  th.querySelectorAll('[data-up]').forEach((b) => (b.onclick = async () => {
    if (b.classList.contains('on')) return;
    try { await api('POST', '/api/feedback', { chat_id: +b.dataset.up, up: true }); press(+b.dataset.up, true); feel('thumbsUp'); }
    catch (x) { toast(x.offline ? 'אין קליטה' : x.message); }
  }));
  th.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => { if (!b.classList.contains('on')) sheet(`<h2>אוי! מה לא היה טוב?</h2><p>${byPerson(S?.me, 'תעזור לי', 'תעזרי לי', 'תעזרו לי')} להשתפר לפעם הבאה.</p>
    <textarea class="field" id="fb-note" rows="3" maxlength="500" aria-label="מה לא היה טוב" placeholder="למשל: כשאני אומר חלב, אני מתכוון לסויה"></textarea>
    <div class="acts"><button class="btn go" type="button" id="fb-send">שליחה</button><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
    $('#fb-send', el).onclick = async () => {
      const id = +b.dataset.down, note = $('#fb-note', el).value.trim();
      try { await api('POST', '/api/feedback', { chat_id: id, note }); close(); press(id, false); feel('thumbsDown'); }
      catch (x) { toast(x.offline ? 'אין קליטה' : x.message); return; }
      // with words: Shuki fixes what went wrong and asks whether to learn it
      if (note) sendChat({ text: note, feedback: id }); else toast('תודה, שמרתי');
    };
  }); }));
}

/** "Eggs L — 6": the name is isolated so its Latin letters don't swap places with the numbers. */
const lineText = (t) => { const i = t.indexOf(' — '); return i < 0 ? `<bdi>${esc(t)}</bdi>` : `<bdi>${esc(t.slice(0, i))}</bdi> — <bdi>${esc(t.slice(i + 3))}</bdi>`; };
function coupon(p, idx, c = {}) {
  const status = p.status || 'pending';
  // q06, c04 (approved 02/10): a card from someone else's message (a child's, seen in their tab) is theirs to decide;
  // a card for the grown-ups ("{ילד} ביקש… לאשר?", with `to`) keeps its buttons
  const writer = c.for != null && c.for !== S.me.id && !Array.isArray(c.to) && S.users.find((u) => u.id === c.for);
  const skipped = new Set(p.skip || []);
  const lines = p.lines.map((l, j) => `<li data-j="${j}"${skipped.has(j) ? ' class="off"' : ''}><button type="button" class="tick" ${status !== 'pending' ? 'disabled' : ''} aria-label="לכלול" aria-pressed="${!skipped.has(j)}" aria-describedby="${esc(p.id)}-l${j}">${skipped.has(j) ? '' : SMALL_TICK}</button><span id="${esc(p.id)}-l${j}">${lineText(l.text)}${l.detail ? `<small>${esc(l.detail)}</small>` : ''}</span></li>`).join('');
  // 57 (the owner 05/10): a card that did nothing is stamped "לא היה מה לעדכן."
  const foot = status === 'pending' && writer
    ? `<small class="onlythey">את זה רק ${esc(writer.name)} ${byPerson(writer, 'יכול', 'יכולה', 'יכולים')} לאשר או לבטל.</small>`
    : status === 'pending'
    ? '<div class="row"><button class="btn go" type="button" data-do="apply">לעדכן</button><button class="btn" type="button" data-do="reject">ביטול</button></div>'
    : status === 'applied' ? `<span class="stampd">${p.nothing ? 'לא היה מה לעדכן.' : 'עודכן'}</span>` : status === 'expired' ? '<span class="stampd rej">כבר לא רלוונטי</span>' : '<span class="stampd rej">בוטל</span>';
  return `<div class="coupon ${status}" data-id="${esc(p.id)}" data-idx="${idx}"><span class="scis">${SCISSORS}</span><ul>${lines}</ul>${foot}</div>`;
}
function wireCoupon(el) {
  const skip = new Set();
  el.querySelectorAll('li .tick').forEach((b) => (b.onclick = () => {
    const li = b.closest('li'); const j = +li.dataset.j;
    if (skip.has(j)) { skip.delete(j); li.classList.remove('off'); b.innerHTML = SMALL_TICK; } else { skip.add(j); li.classList.add('off'); b.innerHTML = ''; } b.setAttribute('aria-pressed', String(!li.classList.contains('off'))); /* stage 13, d10 (Q13-5) */
  }));
  el.querySelectorAll('[data-do]').forEach((b) => (b.onclick = async () => {
    el.querySelectorAll('button').forEach((x) => (x.disabled = true));
    try {
      const r = await api('POST', `/api/proposals/${el.dataset.id}/${b.dataset.do}`, { skip: [...skip], sure: el.dataset.sure === '1' });
      if (r.status === 'pending' && r.error) {
        el.querySelectorAll('button').forEach((x) => (x.disabled = false));
        if (r.needSure) { el.dataset.sure = '1'; b.textContent = `למחוק באמת? ${r.needSure} מוצרים יימחקו מהמלאי`; feel('scared'); b.classList.add('warn'); } else toast(r.error);
        return;
      }
      // 57 (the owner 05/10): every line skipped is "בוטל"; nothing done is stamped "לא היה מה לעדכן."
      const st = r.skipped ? 'rejected' : r.status;
      const msg = chatLog[+el.dataset.idx]; if (msg) { msg.content.proposal.status = st; msg.content.status = st; if (r.status === 'applied') msg.content.proposal.skip = [...skip]; if (r.nothing && !r.skipped) msg.content.proposal.nothing = true; }
      if (r.status === 'applied' && r.nothing) { refresh(); loadChat(); } // questions 41, 43: Shuki says "לא היה מה לעדכן." in the chat
      // 57: "לבטל" only with an action to undo
      else if (r.status === 'applied') { if (r.undoable) toastUndo('עודכן'); else toast('עודכן'); refresh().then(() => celebrate(r.reaction)); } else if (r.status === 'expired') { toast(r.error); feel('oops'); } else feel('rejected');
      renderThread(); if (r.status !== 'applied') refresh();
      if (r.asked) setTimeout(loadChat, 600); // decision 160: the question that waited for this card
    } catch (e) { toast(e.message); el.querySelectorAll('button').forEach((x) => (x.disabled = false)); }
  }));
}

async function sendChat(msg) {
  if (pendingChat) return;
  openTab = 'me'; // what I write is in my own chat
  // t3 (stage 10, decision 3): my first message tonight (the house's night, 23:00–07:00 by S.tz) wakes Shuki up: 2.5 seconds,
  // then "thinking" if the answer hasn't come, and then the answer's face. Tonight's: by my own messages in my chat, on any
  // device (nothing is kept for it). A distress answer cuts it at once (question 8). Also with Reduce Motion: a still face.
  const now0 = Date.now(), wake = !!S?.tz && isNight(now0, S.tz) && !chatLog.some((m) => m.role === 'user' && (m.user_id == null || m.user_id === S.me.id) && (m.thread == null || m.thread === S.me.id) && (m.ts || 0) >= nightStart(now0, S.tz));
  pendingChat = msg; pendingAfter = Math.max(0, ...chatLog.map((m) => m.id || 0)); renderThread(); renderChatComposer();
  const woke = wake && feel('wake'), awake = woke ? now0 + 2500 : 0; awakeUntil = awake;
  const wakeTimer = woke ? setTimeout(() => { if (pendingChat) feel('thinking'); }, 2500) : 0;
  if (!woke) feel('thinking');
  try {
    const r = await api('POST', '/api/chat', msg);
    pendingChat = null;
    const loaded = await loadChat(), news = loaded || [];
    // question 19: my message ends "מבין" even when the chat didn't load after it (the reviewers of aaf46af and 9a00ad1): kept
    // here, and in the phone's copy, until it loads
    if (loaded === null && msg.text && S?.me) { // S?.me: unpaired between the two requests (a 401 wipes it)
      chatLog.push({ role: 'user', user_id: S.me.id, thread: S.me.id, ts: Date.now(), content: { text: msg.text, ...(msg.image && { image: true }) } });
      renderThread(); renderBand();
    }
    const spoken = $('#spoken'), said = news.filter((m) => m.content.for === S.me.id && m.content.reply).map((m) => m.content.reply).join(' ') || (r.limit || (r.distress && !news.length) ? r.reply : ''); // a distress answer whose chat didn't load is said too
    // emptied first, so the same words twice ("בסדר." and "בסדר.") are said again (the reviewer, פ25)
    if (spoken && said) { spoken.textContent = ''; requestAnimationFrame(() => { spoken.textContent = said; }); }
    // D13 (q07): a child's limit for today comes only in the answer; it shows, and the composer stays open
    if (r.limit && r.reply) { chatLog.push({ role: 'shuki', thread: S.me.id, content: { reply: r.reply, face: r.face } }); renderThread(); }
    if (r.applied || r.onboard) refresh(); // what the first meeting added (people, products) shows everywhere
    if (r.distress && !chatLog.some((m) => m.role === 'shuki' && m.content?.distress && m.content.reply === r.reply)) { chatLog.push({ role: 'shuki', thread: S.me.id, content: { reply: r.reply, face: r.face, distress: true } }); renderThread(); } // the chat didn't load: the words and "מבין" all the same
    if (loaded === null && S?.me) store.set('chat', chatLog.slice(-40)); // the phone's copy, after both rows (the reviewer of 8f42b5a): "מבין" stays after a reload with no reception
    clearTimeout(wakeTimer);
    if (woke && !r.distress && Date.now() < awake) await new Promise((x) => setTimeout(x, awake - Date.now())); // the yawn ends first
    if (r.distress) { renderBand(); mascot?.settle(); } // t1: "מבין" is his lasting face now (no pop); "thinking" ends
    else if (!r.onboard && !(r.reaction && feel(r.reaction)) && !(r.face === 'strong' && feel('workout'))) mascot?.react(r.face === 'ecstatic' ? 'excited' /* t7, question 6 */ : FACES_KNOWN.includes(r.face) ? r.face : r.face ? 'sad' : 'happy', 2400); // question 17: a face this app doesn't know yet // ה1: strong with its sweat and band // the first meeting's bubbles play their own faces
    if (r.shopping) {
      if (r.shopping === 'start') store.set('listStore', r.store || 'super');
      await refresh();
      if (r.shopping === 'start') setTimeout(() => { location.hash = '#list'; }, 1400);
    }
  } catch (e) {
    pendingChat = null; clearTimeout(wakeTimer); feel('error'); renderBand();
    chatLog.push({ role: 'shuki', local: true, content: { reply: e.offline ? 'אין לי קליטה כרגע. את הרשימה אפשר לסמן גם בלי קליטה.' : 'אופס, משהו השתבש. אפשר לנסות שוב' } });
    renderThread();
    // back from a suspended app (iOS), the request failed but the server may have answered: what it kept shows, else the
    // local bubble stays (an offline load returns null). The reviewer, 15/10
    loadChat();
  }
  renderChatComposer();
}

/** Downscale a photo to ≤1600px JPEG, base64 without the data: prefix. */
async function shrink(file, max = 1600, q = 0.82) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', q).split(',')[1] };
}

/* ================= list ================= */
const listStore = () => store.get('listStore', 'super');
const productOf = (id) => S.products.find((p) => p.id === id);
const catName = (id) => S.categories.find((c) => c.id === id)?.name || 'אחר';
const catSort = (id) => S.categories.find((c) => c.id === id)?.sort ?? 99;

/** Added by the other one while I'm in the store. */
const isNewForMe = (i) => { const t = myTrip(); return !!t && i.status === 'open' && i.added >= t.started && i.added_by && i.added_by !== S.me.id; };
const clock = (ts) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: S?.tz || undefined });
function tripBar() {
  const t = myTrip(), o = otherTrip();
  if (t) return `<div class="trip mine"><span><b>מצב קניות</b> · ${esc(STORE_NAME[t.store] || '')} · מאז ${clock(t.started)}</span><button class="btn" type="button" id="tripEnd">סיימתי</button></div>`;
  const other = o ? `<div class="trip other"><b>${esc(o.name)} בקניות עכשיו</b> ב${esc(STORE_NAME[o.store] || '')}. אם תוסיפו מוצרים לרשימה אעדכן ${byPerson(o, 'אותו', 'אותה', 'אותם')} מיד!</div>` : '';
  return `${other}<button class="btn trip-go" type="button" id="tripGo">${byPerson(S.me, 'אני יוצא לקניות', 'אני יוצאת לקניות', 'יוצאים לקניות')}</button>`;
}
/** "wait, do we have...?" — what the house has of it, and whether to buy. */
const locOf = (p) => S.locations.find((l) => l.id === p.location_id)?.name;
/** "יש כבר 2 קרטוני חלב במקרר": a whole sentence, with the product's name (for "add it anyway?"). */
function haveSentence(p) {
  const loc = locOf(p); const where = loc ? ` ב${loc.replace(/^ה/, '')}` : '';
  if (p.count_type === 'units' && p.qty > 0) return `יש כבר ${of(p.qty, p.unit, p.name)}${where}`;
  if (p.count_type === 'level') return `${p.level === 'little' ? 'נשאר מעט' : 'יש כבר'} ${p.name}${where}`;
  return `יש כבר ${p.name}${where}: ${p.text || ''}`.replace(/: $/, '');
}
function haveText(p) {
  const t = p.text || '';
  const loc = locOf(p);
  return `${/^(יש|נשאר|אחד|נגמר)/.test(t) ? t : `יש ${t}`}${loc ? ` · ב${loc}` : ''}`;
}
function haveVerdict(p) {
  const item = S.list.find((i) => i.product_id === p.id && i.status !== 'done');
  const soon = S.soon?.find((x) => x.id === p.id);
  if (item?.status === 'checked') return { cls: 'ok', v: 'כבר בעגלה' };
  if (item?.ordered) return { cls: 'ok', v: 'הוזמן במשלוח, בדרך' };
  if (p.out) return { cls: 'need', v: item ? 'נגמר · ברשימה' : 'נגמר · כדאי לקנות', add: !item };
  if (p.missing) return { cls: 'low', v: item ? 'פחות מהמינימום · ברשימה' : 'פחות מהמינימום · אפשר לקנות', add: !item };
  if (soon) return { cls: 'low', v: soon.in <= 0 ? 'ייגמר היום' : soon.in === 1 ? 'ייגמר מחר' : 'ייגמר בעוד יומיים', add: !item };
  return { cls: 'ok', v: 'יש מספיק בבית' };
}
const agoText = (ts) => { const d = Math.floor((Date.now() - ts) / DAY); return d < 14 ? '' : d < 60 ? `נספר לפני ${Math.round(d / 7)} שבועות` : 'נספר לפני יותר מחודשיים'; };
function haveRows(q) {
  const hits = S.products.filter((p) => matches(p, q)).slice(0, 4);
  if (!hits.length) return `<div class="hv none"><span><b>זה לא רשום אצלי</b></span><button class="btn yel" type="button" data-have-add="">להוסיף לרשימה</button></div>`;
  return hits.map((p) => {
    const x = haveVerdict(p); const old = agoText(Math.max(p.counted || 0, p.updated || 0));
    return `<div class="hv ${x.cls}"><span>${thumb(p)}<bdi>${esc(p.name)}</bdi><small>${p.out ? '' : `${esc(haveText(p))}${old ? ` · ${old}` : ''}`}</small></span><b class="vd">${esc(x.v)}</b>${x.add ? `<button class="btn yel" type="button" data-have-add="${p.id}">לרשימה</button>` : ''}</div>`;
  }).join('');
}

/** Adding something the house already has: say how much, and offer "let's think about it" instead. */
function addToList(p, st, fromText) {
  // decision 185: something new typed on the list is a product too (so buying it updates the stock and Shuki learns it);
  // a child's too, like in the chat: the product is made and the line waits for a grown-up (r0t d185)
  // "half a kilo of ground beef": the weight goes on the list line; at home it's counted as plenty / a little / none
  const w = !p && weightOf(fromText);
  const name = w ? w.name : fromText;
  const sure = () => act(p ? [{ kind: 'list_add', product_id: p.id, store: st }] : [{ kind: 'list_add', text: name, store: st, ...(w && { amount: w.n, unit: w.unit }) }, ...([{ kind: 'create', product: { name, category_id: 'אחר', ...(w ? { count_type: 'level', level: 'none' } : { qty: 0 }), ...(STORE_NAME[st] && !/^e/.test(st) && { store: st }) } }])], { silent: true });
  if (!p || p.out || p.missing || S.list.some((i) => i.product_id === p.id && i.status !== 'done')) return sure();
  sheet(`<h2><bdi>${esc(p.name)}</bdi></h2><p class="warn">${esc(haveSentence(p))}. ${byPerson(S?.me, 'האם תרצה', 'האם תרצי', 'האם תרצו')} שאוסיף לרשימה בכל זאת?</p>
    <div class="acts"><button class="btn" type="button" id="w-no">לא, יש מספיק</button><button class="btn blue" type="button" id="w-maybe">אולי, ${byPerson(S?.me, 'תשאל', 'תשאל', 'תשאל')} אותי בעוד יומיים</button><button class="btn go" type="button" id="w-yes">כן, להוסיף</button></div>`, (el, close) => {
    $('#w-no', el).onclick = () => { close(); feel('noDouble'); toast('יופי, חסכנו קנייה כפולה!'); };
    $('#w-yes', el).onclick = () => { close(); sure(); };
    $('#w-maybe', el).onclick = () => { close(); addMaybe(p.name, p.id, st); };
  });
}
async function addMaybe(text, productId, st) {
  try { await api('POST', '/api/maybe', { text, product_id: productId || null, store: st }); toast(`בסדר, אשאל אתכם שוב על ${text} בעוד יומיים`); await refresh(); }
  catch (e) { toast(e.offline ? 'אין קליטה, אפשר לנסות שוב אחר כך' : e.message); }
}
/** Two boxes (round 20 review): reminders someone asked for in the chat, and "maybe buy" for something that's already at home. */
function maybeBox() {
  const xs = S.maybe || [];
  if (!xs.length && !S.maybeDroppedThisMonth) return '';
  const rem = xs.filter((m) => m.kind === 'remind'), may = xs.filter((m) => m.kind !== 'remind');
  const at = (m) => { const t = new Date(m.due_at); const hhmm = t.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }), by = m.added_by !== S.me.id && (S.users.find((u) => u.id === m.added_by) || (m.by_name && { name: m.by_name, gender: m.by_gender })); // 10: one who left, by the name kept
    // r0t-10 (approved 04/10; question 48, the owner 05/10): someone else's daily reminder says whose it is
    if (m.repeat === 'daily') return by ? `${by.name} ${byPerson(by, 'ביקש שאזכיר לו', 'ביקשה שאזכיר לה', 'ביקשו שאזכיר להם')} כל יום ב-${hhmm}` : `אזכיר ${byPerson(S?.me, 'לך', 'לך', 'לכם')} כל יום ב-${hhmm}`; const hm = t.getHours() === 9 && !t.getMinutes() ? '' : ` ב-${t.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`; return `אזכיר ${byPerson(S?.me, 'לך', 'לך', 'לכם')} ב-${fmtDate(m.due_at)}${hm}`; };
  const left = (m) => { const h = Math.ceil((m.added + 48 * 3600e3 - Date.now()) / 3600e3); return h > 24 ? 'אשאל שוב מחר' : h > 1 ? `אשאל שוב בעוד ${h} שעות` : 'אשאל שוב בקרוב'; };
  const btn = (m, d, label, cls = '') => `<button class="btn ${cls}" type="button" data-maybe="${m.id}" data-d="${d}">${label}</button>`;
  const remBox = rem.length ? `<div class="maybe remind"><span class="cat">תזכורות</span>
    ${rem.map((m) => `<div class="rowline"><span><bdi>${esc(m.text)}</bdi><small>${m.due ? `האם הגיע הזמן לקנות ${esc(m.text)}? ${byPerson(S?.me, 'האם תרצה', 'האם תרצי', 'האם תרצו')} שאוסיף לרשימה?` : esc(at(m))}</small></span><span class="two-btn">${m.due ? btn(m, 'list', 'להוסיף לרשימה', 'yel') : ''}${btn(m, 'drop', 'כבר לא צריך')}</span></div>`).join('')}</div>` : '';
  const mayBox = may.length || S.maybeDroppedThisMonth ? `<div class="maybe"><span class="cat">אולי לקנות</span>
    ${may.map((m) => `<div class="rowline"><span><bdi>${esc(m.text)}</bdi><small>${m.due ? `האם עדיין רוצים לקנות ${esc(m.text)}?` : esc(left(m))}</small></span><span class="two-btn">${m.due ? btn(m, 'list', 'כן, להוסיף לרשימה', 'yel') : ''}${btn(m, 'drop', 'לא, ויתרנו')}</span></div>`).join('')}
    ${S.maybeDroppedThisMonth ? `<p class="saved">החודש ויתרתם על ${S.maybeDroppedThisMonth === 1 ? 'מוצר אחד שכבר היה בבית' : `${S.maybeDroppedThisMonth} מוצרים שכבר היו בבית`}</p>` : ''}</div>` : '';
  return remBox + mayBox;
}

/** After "done shopping": a receipt of what came from the list, what didn't, and what stayed behind. */
function tripReceipt(t) {
  if (!t) return;
  const part = (title, xs, cls) => (xs?.length ? `<div class="rc ${cls}"><b>${title}</b><span>${xs.map((x) => `<bdi>${esc(x)}</bdi>`).join(' · ')}</span></div>` : '');
  const body = part('מהרשימה', t.bought, '') + part('מחוץ לרשימה', t.offList, 'off') + part('נשאר ברשימה', t.forgot, 'left');
  sheet(`<h2>סיכום הקניות</h2><div class="receipt">${body || `<div class="rc"><span>${byPerson(S?.me, 'לא קנית', 'לא קנית', 'לא קניתם')} כלום מהרשימה.</span></div>`}</div>
    ${t.offList?.length ? `<p class="warn">מה ש${byPerson(S?.me, 'קנית', 'קנית', 'קניתם')} מחוץ לרשימה יופיע בסיכום החודשי.</p>` : ''}
    <div class="acts"><button class="btn go" type="button" data-close>סגירה</button></div>`);
}
async function finishShop(actions) {
  const r = await act(actions, { context: 'shopping', silent: true });
  feel('shopDone');
  if (r?.trip) tripReceipt(r.trip); else toast('יש! הקניות נסגרו');
}

function soonBox() {
  if (!S.soon?.length) return '';
  const when = (n) => (n <= 0 ? 'ייגמר היום' : n === 1 ? 'ייגמר מחר' : 'ייגמר בעוד יומיים');
  return `<div class="soon"><span class="cat">עומד להיגמר</span>${S.soon.map((x) => `<div class="rowline"><span><bdi>${esc(x.name)}</bdi> <small>${when(x.in)}</small></span><button class="btn yel" type="button" data-soon="${x.id}">להוסיף לרשימה</button></div>`).join('')}</div>`;
}
function itemRow(i) {
  const p = i.product_id && productOf(i.product_id);
  const name = p ? p.name : i.text;
  const owner = p?.owner && p.private_to == null ? S.users.find((u) => u.id === p.owner)?.name : null; // in every house (stage 9, מ2); private: the lock only
  const sub = [i.ordered && 'הוזמן, בדרך', p?.brand && (p.only_brand ? `רק ${p.brand}` : p.brand), owner && `של ${owner}`, /* מ7 (28, r9z): "רק אלפרו · של מיכל" */ !i.approved && (isChild() ? 'מחכה לאישור' : (() => { const u = S.users.find((x) => x.id === i.added_by); return u ? `${u.name} ${byPerson(u, 'ביקש', 'ביקשה', 'ביקשו')}` : 'מחכה לאישור'; })())].filter(Boolean).join(' · ');
  const buyUnit = p && (p.count_type === 'pack' ? 'אריזה' : p.unit);
  const howMany = (n) => amount(n, buyUnit);
  const q = i.want_unit ? weightText(i.want, i.want_unit) : i.status === 'checked' ? (i.bought_qty ? howMany(i.bought_qty) : '') : p ? (p.count_type === 'level' ? ({ plenty: 'יש הרבה', little: 'נשאר מעט', none: 'נגמר' }[p.level] || '') : howMany(i.want ?? p.suggested)) : i.want > 1 ? String(i.want) : '';
  if (!i.approved) return `<div class="itemw ask"><div class="item waiting"><span class="box"></span><span class="nm">${thumb(p)}<bdi>${esc(name)}</bdi>${lockHtml(i.private_to != null ? i : p)}<small>${esc(sub)}</small></span><span class="qty">${esc(q)}</span></div>${isChild() ? '' : `<span class="two-btn"><button class="btn yel" type="button" data-approve="${i.id}" data-yes="1">לאשר</button><button class="btn" type="button" data-approve="${i.id}">לדחות</button></span>`}</div>`;
  return `<div class="itemw"><button type="button" class="item ${i.status === 'checked' ? 'done' : ''} ${i.ordered ? 'ordered' : ''} ${i.pending ? 'pending' : ''}" data-item="${i.id}" aria-pressed="${i.status === 'checked'}">
    <span class="box">${i.status === 'checked' ? TICK : ''}</span>
    <span class="nm">${thumb(p)}<bdi>${esc(name)}</bdi>${lockHtml(i.private_to != null ? i : p)}${isNewForMe(i) ? '<span class="new">חדש</span>' : ''}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    <span class="qty">${esc(q)}</span></button>${i.status === 'open' && i.id > 0 && !i.ordered ? `<button type="button" class="more" data-more="${i.id}" aria-label="עוד על ${esc(name)}">${svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>', '#15110E', 2.4)}</button>` : ''}</div>`;
}

const isChild = () => S?.me?.role === 'child';
/** "חצי קילו בשר טחון", "300 גרם גבינה", "2 ק"ג עגבניות" → { n, unit, name } */
function weightOf(t) {
  const words = { 'חצי קילו': 0.5, 'רבע קילו': 0.25, 'קילו וחצי': 1.5, 'קילו': 1 };
  for (const [w, n] of Object.entries(words)) if (t.startsWith(`${w} `)) return { n, unit: 'ק"ג', name: t.slice(w.length).trim().replace(/^של /, '') };
  const m = /^(\d+(?:\.\d+)?)\s*(ק"ג|ק״ג|קילו|גרם)\s+(?:של\s+)?(.+)$/.exec(t);
  return m ? { n: Number(m[1]), unit: m[2] === 'גרם' ? 'גרם' : 'ק"ג', name: m[3].trim() } : null;
}
/** Half a kilo, 300 grams, 1.5 kg — in Hebrew */
function weightText(n, u) {
  if (u === 'גרם') return `${n} גרם`;
  return n === 0.5 ? 'חצי קילו' : n === 1 ? 'קילו' : n === 0.25 ? 'רבע קילו' : n === 1.5 ? 'קילו וחצי' : n < 1 ? `${Math.round(n * 1000)} גרם` : `${n} ק״ג`;
}
/** A line that waited three trips to its store: still want it? */
function staleBox() {
  const xs = (S.stale || []).filter((x) => S.list.some((i) => i.id === x.id && i.store === listStore()));
  if (!xs.length) return '';
  // d45 (approved 02/10, c01, c02): the question, and three buttons in a row under it
  return `<div class="maybe stale">${xs.map((x) => `<div class="staleq"><span><bdi>${esc(x.name)}</bdi> ברשימת הקניות אבל לא קניתם ${byGender(x.name, 'אותו', 'אותה', 'אותם', 'אותן')} שלוש פעמים כשהייתם ב${esc(STORE_NAME[x.store] || STORE_NAME.super)}. מה לעשות ${byGender(x.name, 'איתו', 'איתה', 'איתם', 'איתן')}?</span><span class="three-btn"><button class="btn" type="button" data-stale="${x.id}" data-d="drop">להוריד</button><button class="btn" type="button" data-stale="${x.id}" data-d="swap">להחליף</button><button class="btn yel" type="button" data-stale="${x.id}" data-d="keep">להשאיר</button></span></div>`).join('')}</div>`;
}
/** home18 (5): where the house buys, in the settings, with the words of the questions that asked it (approved 17/10) */
const SHOP_SELECTS = [['produce', 'איפה אתם קונים ירקות ופירות?', [['super', 'בסופר'], ['greengrocer', 'בירקן'], ['both', 'פעם פה פעם שם']]],
  ['care', 'איפה אתם קונים טואלטיקה ומוצרי ניקיון?', [['super', 'בסופר'], ['pharm', 'בפארם'], ['both', 'פעם פה פעם שם']]]];
const shopSelects = () => SHOP_SELECTS.map(([k, q, opts]) => `<label class="rowline adult"><span>${esc(q)}</span><select class="field" id="shop-${k}">${S.settings?.[`shop_${k}`] ? '' : '<option value="" selected></option>'}${opts.map(([v, n]) => `<option value="${v}" ${S.settings?.[`shop_${k}`] === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`).join('');
/** A greengrocer's or a pharmacy's tab only when the house said it goes there, or something is in it (home18, 5) */
const tabShown = (k) => {
  const ans = { greengrocer: S.settings?.shop_produce, pharm: S.settings?.shop_care }[k];
  if (ans === undefined && !['greengrocer', 'pharm'].includes(k)) return true;
  if (ans === k || ans === 'both') return true;
  return S.list.some((i) => i.status === 'open' && (i.store === k || (i.product_id && productOf(i.product_id)?.store2 === k)));
};
function renderList(main) {
  const st = tabShown(listStore()) ? listStore() : 'super';
  const count = (s) => S.list.filter((i) => i.store === s && i.status === 'open' && !i.ordered).length;
  const mine = S.list.filter((i) => i.store === st);
  const also = S.list.filter((i) => i.store !== st && i.status === 'open' && i.product_id && productOf(i.product_id)?.store2 === st);
  const groups = {};
  for (const i of mine) {
    const p = i.product_id && productOf(i.product_id);
    const key = p ? p.category_id : 'oneoff';
    (groups[key] ||= []).push(i);
  }
  const order = Object.keys(groups).sort((a, b) => (a === 'oneoff' ? 999 : catSort(+a)) - (b === 'oneoff' ? 999 : catSort(+b)));
  const checked = mine.filter((i) => i.status === 'checked').length;
  main.innerHTML = `
    <div class="flaps" role="tablist">${STORES.filter(([k]) => tabShown(k)).map(([k, n]) => `<button type="button" role="tab" aria-selected="${k === st}" class="flap ${k === st ? 'on' : ''}" data-store="${esc(k)}">${esc(n)}<span class="n">${count(k)}</span></button>`).join('')}</div>
    <div class="listwrap">
      ${!online || queue.length ? `<span class="stamp">${online ? 'נשלח עכשיו…' : 'אין קליטה · נשמר בטלפון'}</span>` : ''}
      ${tripBar()}
      ${myTrip() ? '<div class="have"><label for="haveQ">רגע, יש לנו…?</label><input class="field" id="haveQ" placeholder="מקלידים שם, למשל טונה" autocomplete="off"><div id="haveA"></div></div>' : ''}
      ${mine.some((i) => i.status === 'open' && !i.ordered) ? `<div class="listacts"><button class="btn share" type="button" id="shareList">העתקת הרשימה</button>${myTrip() ? '' : '<button class="btn share" type="button" id="orderAll">הזמנו משלוח</button>'}</div>` : ''}
      ${mine.some((i) => i.ordered) ? '<button class="btn yel arrived" type="button" id="arrivedAll">המשלוח הגיע</button>' : ''}
      <label class="lbl addlbl" for="addTxt">להוסיף לרשימה</label>
      <form class="adder" id="adder"><input class="field" id="addTxt" autocomplete="off"><button class="btn yel" type="submit">הוספה</button></form>
      <div class="suggest" id="sugg"></div>
      ${mine.length ? order.map((k) => `<span class="cat">${esc(k === 'oneoff' ? 'לא במלאי' : catName(+k))}</span>${groups[k].sort((a, b) => (a.status === 'checked') - (b.status === 'checked') || !!a.ordered - !!b.ordered).map(itemRow).join('')}`).join('') : `<div class="empty"><div class="mini" id="emptyShuki"></div>אין כלום לקנות ב${esc(STORE_NAME[st] || '')}!</div>`}
      ${also.length ? `<div class="also"><svg class="burst" viewBox="0 0 104 44" aria-hidden="true"><path d="M52 1 60 9 72 3 74 13 88 10 85 20 100 22 89 29 97 38 83 37 80 44 68 38 58 44 52 36 44 44 36 38 24 44 21 37 7 38 15 29 4 22 19 20 16 10 30 13 32 3 44 9Z" fill="#FFD21A" stroke="#15110E" stroke-width="2.5" stroke-linejoin="round"/><text x="52" y="27" text-anchor="middle" font-family="Secular One, Arial" font-size="13" fill="#A8150F">אפשר גם כאן</text></svg>${also.map(itemRow).join('')}</div>` : ''}
      ${S.lowAsk?.length ? `<div class="lowbox"><span class="cat">נשאר מעט</span>${lowCard()}</div>` : ''}
      ${soonBox()}
      ${staleBox()}
      ${maybeBox()}
      ${checked ? `<button class="finish" type="button" id="finish">סיימתי את הקניות<span>${checked === 1 ? 'מוצר אחד יתעדכן' : `${checked} מוצרים יתעדכנו`} במלאי</span></button>` : ''}
    </div>`;
  if ($('#emptyShuki')) mountShuki($('#emptyShuki'), 'excited', myLook());
  main.querySelectorAll('[data-store]').forEach((b) => (b.onclick = () => { store.set('listStore', b.dataset.store); render(); }));
  main.querySelectorAll('[data-approve]').forEach((b) => (b.onclick = () => act([{ kind: 'approve', item_id: +b.dataset.approve, yes: !!b.dataset.yes }], { silent: true })));
  main.querySelectorAll('[data-stale]').forEach((b) => (b.onclick = async () => {
    // c03 (approved 02/10, 05/10): "להחליף" opens the chat with Shuki's "מה לקנות במקום X?"; the line stays until the answer
    if (b.dataset.d === 'swap') {
      try { await api('POST', '/api/stale-swap', { item_id: +b.dataset.stale }); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); return; }
      await refresh(); location.hash = '#chat'; loadChat(); return;
    }
    act([b.dataset.d === 'keep' ? { kind: 'keep', item_id: +b.dataset.stale } : { kind: 'list_remove', item_id: +b.dataset.stale }], { silent: true });
  }));
  // decision 171: a tap puts it in the cart as listed; a long press (or "⋯") asks how many
  main.querySelectorAll('[data-item]').forEach((b) => {
    let t = null, held = false;
    const stop = () => clearTimeout(t);
    b.addEventListener('pointerdown', () => { held = false; stop(); t = setTimeout(() => { held = true; amountSheet(+b.dataset.item); }, 550); });
    for (const e of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(e, stop);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.onclick = () => { if (held) { held = false; return; } tapItem(+b.dataset.item); };
  });
  main.querySelectorAll('[data-more]').forEach((b) => (b.onclick = () => itemMenu(+b.dataset.more)));
  wireLow(main);
  $('#shareList')?.addEventListener('click', () => shareList(st));
  // ordered online: everything open in this store goes "on the way"; when it comes, one tap puts it all in stock
  $('#orderAll')?.addEventListener('click', () => {
    const open = mine.filter((i) => i.status === 'open' && !i.ordered && i.approved && i.id > 0);
    sheet(`<h2>הזמנתם משלוח?</h2><p>כל מה שברשימה של ${['super', 'pharm', 'greengrocer'].includes(st) ? 'ה' : ''}${esc(STORE_NAME[st])} יחכה להגעת המשלוח. ${byPerson(S?.me, 'אל תשכח', 'אל תשכחי', 'אל תשכחו')} לעדכן אותי כשהוא מגיע!</p>
      <div class="acts"><button class="btn go" type="button" id="ordGo">כן, הזמנו</button><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
      $('#ordGo', el).onclick = () => { close(); act(open.map((i) => ({ kind: 'order', item_id: i.id }))); };
    });
  });
  $('#arrivedAll')?.addEventListener('click', () => { const xs = mine.filter((i) => i.ordered); if (xs.length > 1) arrivedSheet(xs); else act(xs.map((i) => ({ kind: 'arrived', item_id: i.id }))); });
  { // a store tab past the edge comes into view (sideways only: the page itself must not move)
    const on = main.querySelector('.flap.on'), row = on?.parentElement;
    if (on && row.scrollWidth > row.clientWidth) { const a = on.getBoundingClientRect(), r = row.getBoundingClientRect(); if (a.left < r.left) row.scrollLeft -= r.left - a.left + 8; else if (a.right > r.right) row.scrollLeft += a.right - r.right + 8; }
  }
  $('#finish')?.addEventListener('click', () => finishShop([{ kind: 'finish', store: st }]));
  $('#tripGo')?.addEventListener('click', async () => {
    try { await api('POST', '/api/shopping', { on: true, store: st }); feel('shopStart'); toast(`איזה כיף! עדכנתי את כולם ש${byPerson(S.me, 'אתה', 'את', 'אתם')} בקניות`); await refresh(); }
    catch (e) { toast(e.offline ? 'אין קליטה, אי אפשר לעדכן את הבית כרגע' : e.message); }
  });
  $('#tripEnd')?.addEventListener('click', async () => {
    if (S.list.some((i) => i.status === 'checked')) return finishShop([{ kind: 'finish' }]);
    try { await api('POST', '/api/shopping', { on: false }); toast('מצב קניות נסגר'); await refresh(); } catch (e) { toast(e.message); }
  });
  main.querySelectorAll('[data-soon]').forEach((b) => (b.onclick = () => act([{ kind: 'list_add', product_id: +b.dataset.soon }])));
  main.querySelectorAll('[data-maybe]').forEach((b) => (b.onclick = async () => {
    try { await api('POST', '/api/maybe', { id: +b.dataset.maybe, decision: b.dataset.d }); const mt = (S.maybe || []).find((x) => x.id === +b.dataset.maybe)?.text || '';
    toast(b.dataset.d === 'drop' ? `בסדר, לא נקנה ${mt}` : `${mt} ${byGender(mt,'נוסף','נוספה','נוספו')} לרשימה`); if (b.dataset.d === 'drop') feel('skipped'); await refresh(); }
    catch (e) { toast(e.offline ? 'אין קליטה, אפשר לנסות שוב אחר כך' : e.message); }
  }));
  // "wait, do we have...?" — answers from what's on the phone, so it works in the store with no signal
  const hq = $('#haveQ');
  if (hq) {
    const answer = () => {
      const q = hq.value.trim(); const box = $('#haveA');
      box.innerHTML = q ? haveRows(q) : ''; hydratePhotos(box);
      box.querySelectorAll('[data-have-add]').forEach((b) => (b.onclick = () => {
        const id = +b.dataset.haveAdd;
        act([id ? { kind: 'list_add', product_id: id, store: st } : { kind: 'list_add', text: hq.value.trim(), store: st }], { silent: true });
        toast('נוסף לרשימה');
      }));
    };
    hq.oninput = answer; hq.value = store.get('haveQ', ''); answer();
    hq.addEventListener('input', () => store.set('haveQ', hq.value));
  }
  const input = $('#addTxt');
  const exactOf = (q) => S.products.find((p) => norm(p.name) === norm(q) || norm(p.name) === norm(q).replace(/^ה/, '') || p.aliases.some((a) => norm(a) === norm(q)));
  const suggest = () => {
    const q = input.value.trim(); const box = $('#sugg');
    if (!q) { box.innerHTML = ''; return; }
    const hits = S.products.filter((p) => matches(p, q) && !S.list.some((i) => i.product_id === p.id && i.status === 'open')).slice(0, 6);
    box.innerHTML = hits.map((p) => `<button type="button" class="chip" data-add="${p.id}">${esc(p.name)}</button>`).join('')
      + '<button type="button" class="chip think" id="thinkChip">לחשוב על זה</button>';
    box.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => { input.value = ''; box.innerHTML = ''; addToList(productOf(+b.dataset.add), st); }));
    $('#thinkChip').onclick = () => { const e = exactOf(q); addMaybe(e ? e.name : q, e?.id, st); input.value = ''; box.innerHTML = ''; };
  };
  input.oninput = suggest;
  $('#adder').onsubmit = (e) => {
    e.preventDefault(); const q = input.value.trim(); if (!q) return;
    input.value = ''; $('#sugg').innerHTML = '';
    const exact = exactOf(q);
    const some = exact ? [] : S.products.filter((p) => matches(p, q));
    if (some.length < 2) return addToList(exact || some[0] || null, st, q);
    // "Tabasco" and there are four: which one?
    sheet(`<h2>איזה <bdi>${esc(q)}</bdi>?</h2><div class="menu">${some.slice(0, 8).map((p) => `<button class="btn" type="button" data-pick="${p.id}">${thumb(p)}<bdi>${esc(p.name)}</bdi><small>${esc(haveText(p))}</small></button>`).join('')}
      <button class="btn" type="button" data-pick="">משהו אחר<small>"${esc(q)}" כמוצר חדש</small></button></div>
      <div class="acts"><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
      el.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { close(); addToList(b.dataset.pick ? productOf(+b.dataset.pick) : null, st, q); }));
    });
  };
}

function tapItem(id) {
  const i = S.list.find((x) => x.id === id); if (!i || id < 0) return;
  if (i.status === 'checked') return act([{ kind: 'uncheck', item_id: id }], { context: 'shopping', silent: true });
  if (i.ordered) return orderedSheet(i);
  const p = i.product_id && productOf(i.product_id);
  if (!p || p.count_type === 'level' || i.want_unit) return act([{ kind: 'check', item_id: id, amount: 1, store: listStore() }], { context: 'shopping', silent: true });
  act([{ kind: 'check', item_id: id, amount: Math.max(1, i.want ?? p.suggested ?? 1), store: listStore() }], { context: 'shopping', silent: true });
}

/** Long press on a list line: bought a different amount (or a bigger pack) than the list says. */
function amountSheet(id) {
  const i = S.list.find((x) => x.id === id); if (!i || id < 0 || i.status !== 'open' || i.ordered) return;
  const p = i.product_id && productOf(i.product_id);
  if (!p || p.count_type === 'level') return tapItem(id);
  let n = Math.max(1, i.want ?? p.suggested ?? 1);
  const pack = p.count_type === 'pack';
  const unitOf = pack ? 'אריזה' : p.unit || 'יחידה';
  const unitWord = (k) => amount(k, unitOf).replace(/^\d+ /, '').replace(/ (אחד|אחת)$/, '');
  sheet(`<h2>כמה <bdi>${esc(p.name)}</bdi> ${byPerson(S?.me, 'קנית', 'קנית', 'קניתם')}?</h2>
    <div class="stepper"><button type="button" data-d="1" aria-label="עוד">${svg('<path d="M12 5v14M5 12h14" stroke-linecap="round"/>', '#15110E', 3.4)}</button><output id="n" class="num">${n}</output><button type="button" data-d="-1" aria-label="פחות">${svg('<path d="M5 12h14" stroke-linecap="round"/>', '#15110E', 3.4)}</button></div>
    <p style="text-align:center;margin:0;font-family:var(--label)" id="nu">${esc(unitWord(n))}</p>
    ${pack ? `<label class="rowline packsz"><span>כמה יש באריזה הזאת?</span><input class="field num" id="psz" inputmode="numeric" value="${p.pack_size || 1}" aria-label="יחידות באריזה"></label>` : ''}
    <div class="acts"><button class="btn go" type="button" id="ok">לעגלה</button><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
    el.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { n = Math.max(1, n + +b.dataset.d); $('#n', el).textContent = n; $('#nu', el).textContent = unitWord(n); }));
    $('#ok', el).onclick = () => {
      // a bigger pack than usual (12 instead of 6): the stock gets what was really bought
      const sz = pack ? Math.round(+$('#psz', el).value) : 0;
      close();
      act([{ kind: 'check', item_id: id, amount: n, store: listStore(), ...(pack && sz > 0 && sz !== (p.pack_size || 1) && { units: n * sz }) }], { context: 'shopping', silent: true });
    };
  });
}

/** מ24 (q086): "המשלוח הגיע" with more than one line ordered: what came is ticked; what isn't goes back to the open list. */
function arrivedSheet(xs) {
  sheet(`<h2>האם הגיע הכל?</h2><p class="plan-q">מה שלא מסומן חוזר לרשימה.</p><div class="plan">${xs.map((i) => `<label class="switch"><span><bdi>${esc(i.product_id ? productOf(i.product_id)?.name || i.text || '' : i.text)}</bdi></span><input type="checkbox" data-came="${i.id}" checked></label>`).join('')}</div>
    <div class="acts"><button class="btn go" type="button" id="cameGo">הגיע</button><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
    $('#cameGo', el).onclick = () => {
      const came = new Set([...el.querySelectorAll('[data-came]')].filter((c) => c.checked).map((c) => +c.dataset.came));
      close();
      act(xs.map((i) => (came.has(i.id) ? { kind: 'arrived', item_id: i.id } : { kind: 'order', item_id: i.id, off: true })));
    };
  });
}

/** A line that was ordered: it came, or the order was cancelled. */
function orderedSheet(i) {
  const p = i.product_id && productOf(i.product_id);
  sheet(`<h2><bdi>${esc(p ? p.name : i.text)}</bdi></h2><p>הוזמן במשלוח ${fmtDate(i.ordered)}.</p>
    <div class="acts"><button class="btn go" type="button" id="ordCame">הגיע</button><button class="btn" type="button" id="ordOff">ביטול ההזמנה</button><button class="btn" type="button" data-close>סגירה</button></div>`, (el, close) => {
    $('#ordCame', el).onclick = () => { close(); act([{ kind: 'arrived', item_id: i.id }]); };
    $('#ordOff', el).onclick = () => { close(); act([{ kind: 'order', item_id: i.id, off: true }]); };
  });
}

/** "⋯" on a list line: what else can happen to it besides buying. */
function itemMenu(id) {
  const i = S.list.find((x) => x.id === id); if (!i) return;
  const p = i.product_id && productOf(i.product_id);
  const name = p ? p.name : i.text;
  const rm = { kind: 'list_remove', item_id: id };
  sheet(`<h2><bdi>${esc(name)}</bdi></h2>${p ? thumb(p, 'photo') : ''}
    <div class="menu">
      ${p ? '<button class="btn" type="button" data-m="have">יש בבית<small>לעדכן כמה יש ולהוריד מהרשימה</small></button>' : ''}
      ${p && p.count_type !== 'level' ? '<button class="btn" type="button" data-m="amount">קניתי כמות אחרת<small>כמה נכנס לעגלה (אפשר גם בלחיצה ארוכה על השורה)</small></button>' : ''}
      <button class="btn" type="button" data-m="order">הוזמן במשלוח<small>נשאר ברשימה באפור, שאף אחד לא יקנה בזמן הזה</small></button>
      <button class="btn" type="button" data-m="skip">${p ? 'לא צריך הפעם' : 'לא צריך'}<small>רק להוריד מהרשימה</small></button>
      ${p?.is_basic ? '<button class="btn" type="button" data-m="stop">לא קונים יותר<small>כבר לא מוצר קבוע, לא יחזור לרשימה לבד</small></button>' : ''}
      ${p ? '' : '<button class="btn" type="button" data-m="keep">להוסיף למלאי<small>האם קונים את זה שוב ושוב? אני אעקוב אחרי זה</small></button>'}
    </div>
    <div class="acts"><button class="btn" type="button" data-close>סגירה</button></div>`, (el, close) => {
    el.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => {
      close();
      const m = b.dataset.m;
      if (m === 'amount') amountSheet(id);
      else if (m === 'have') countSheet(p, [rm]);
      else if (m === 'skip') act([rm]);
      else if (m === 'order') act([{ kind: 'order', item_id: id }]);
      else if (m === 'stop') act([{ kind: 'edit', product_id: p.id, fields: { is_basic: 0 } }, rm]);
      else if (m === 'keep') productSheet(null, { name: i.text, store: i.store, then: [rm, { kind: 'list_add', text: i.text, store: i.store }] });
    }));
  });
}

/** The list as text, for WhatsApp or whoever goes to the store. */
async function shareList(st) {
  const open = S.list.filter((i) => i.store === st && i.status === 'open' && !i.ordered);
  const groups = new Map();
  for (const i of open) {
    const p = i.product_id && productOf(i.product_id);
    const k = p ? catName(p.category_id) : 'עוד';
    const u = p && (p.count_type === 'pack' ? 'אריזה' : p.unit);
    const want = i.want ?? p?.suggested;
    const q = p && p.count_type !== 'level' && (u || want > 1) ? amount(want, u) : !p && i.want > 1 ? String(i.want) : '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(`• ${p ? p.name : i.text}${q ? ` — ${q}` : ''}`);
  }
  const text = `רשימה ל${STORE_NAME[st]}:\n${[...groups].map(([k, xs]) => `${k}\n${xs.join('\n')}`).join('\n\n')}`;
  await shareOut(text, 'הרשימה הועתקה');
}
/** The phone's share sheet (WhatsApp...), or the clipboard where there is none. */
async function shareOut(text, copied) {
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast(copied); } catch { toast('לא הצלחתי להעתיק'); }
}
/** A recipe as plain text, for sending to a friend (decision 141). */
const recipeText = (x) => `${x.name}${x.serves ? ` (ל-${x.serves})` : ''}\n\nמצרכים:\n${(x.ings?.length ? x.ings.map(lineOf) : String(x.ingredients || '').split(/,\s*|\n/)).filter(Boolean).map((i) => `• ${i}`).join('\n')}${x.text ? `\n\nאופן ההכנה:\n${x.text}` : ''}${x.url ? `\n\n${x.url}` : ''}`;

/* ---------- sheet ---------- */
function sheet(html, wire) {
  document.querySelector('.scrim')?.remove();
  const scrim = document.createElement('div');
  scrim.className = 'scrim'; scrim.dir = 'rtl';
  // every window has a way out that never scrolls away: ✕ on top, and tapping outside
  // stage 13, d10 (Q13-2): the dialog is the box, so the ✕ is inside it for VoiceOver; it's named by its title; the focus goes in,
  // and back to what opened it when it closes
  const opener = document.activeElement;
  scrim.innerHTML = `<div class="sheetbox" role="dialog" aria-modal="true"><button type="button" class="sheet-x" aria-label="סגירה">${svg('<path d="M6 6l12 12M18 6 6 18" stroke-linecap="round"/>', '#15110E', 3.2)}</button><div class="sheet">${html}</div></div>`;
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc_); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  scrim.onclick = (e) => { if (e.target === scrim) close(); };
  scrim.querySelector('.sheet-x').onclick = close;
  scrim.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
  document.body.append(scrim);
  // a thin line under the title only while the window is scrolled (approved 01/10)
  const sh = scrim.querySelector('.sheet');
  sh.addEventListener('scroll', () => sh.classList.toggle('scrolled', sh.scrollTop > 0), { passive: true });
  wire?.(sh, close);
  hydratePhotos(scrim);
  const title = sh.querySelector('h2, h3');
  if (title) { title.id ||= `sheet-t${Date.now()}`; title.tabIndex = -1; scrim.firstElementChild.setAttribute('aria-labelledby', title.id); }
  (title || scrim.querySelector('.sheet-x')).focus({ preventScroll: true });
}

/* ================= inventory ================= */
function pctOf(p) {
  if (!p.is_basic) return null;
  if (p.count_type === 'inuse' && p.is_open) return null; // an open bottle: its words say it all, no percent (walkthrough finding 9)
  const t = p.target ?? (p.count_type === 'pack' ? p.pack_size || 1 : 1);
  if (p.count_type === 'level') return { plenty: 100, little: 50, none: 0 }[p.level] ?? 0;
  if (p.level === 'little' && !p.out) return Math.min(50, Math.round(((p.qty || 0) / (t || 1)) * 100)); // a little left
  if (!t) return 100;
  return Math.min(100, Math.round(((p.qty || 0) / t) * 100)); // more than the minimum is still 100% (approved 01/10)
}
/** The inventory's rows for a search: redrawn alone while someone types in the search (16/10, iPhone: the whole screen
 *  redrawn on each letter closed the keyboard and lost letters), the field itself stays as it is */
const INV_ROWS = (keys, groups, nameOf, q) => keys.length ? keys.map((k) => `<div class="loc">${esc(nameOf(k))}</div>${groups.get(k).map((p) => {
        const pct = pctOf(p);
        const exp = p.next_expiry && daysLeft(p.next_expiry) <= 2 ? `<span class="exp">${esc(expText(p.next_expiry))}</span>` : '';
        const bat = p.count_type === 'batches' && p.batches.length > 1 ? `<span class="bdg">${p.batches.length} תאריכי תוקף</span>` : p.opened && p.count_type !== 'inuse' ? '<span class="bdg">פתוח</span>' : '';
        const more = p.reserve_qty > 0 ? ` + ${p.reserve_qty} ${inPlace(S.locations.find((l) => l.id === p.reserve_location_id)?.name)}` : '';
        // whose it is, on a small line under the name, as on the list (stage 9, מ2: option ב, approved r9p)
        const own = p.owner && p.private_to == null ? S.users.find((u) => u.id === p.owner)?.name : null;
        return `<button type="button" class="fr ${pct != null && pct < 50 ? 'low' : ''}${p.out ? ' out' : ''}" data-p="${p.id}"><span>${thumb(p)}<bdi>${esc(p.name)}</bdi>${lockHtml(p)}${exp}${bat}${own ? `<small class="own">של ${esc(own)}</small>` : ''}</span><span class="q"><bdi>${esc(p.text + more)}</bdi></span><span class="pct">${pct == null ? '' : `${pct}%`}</span></button>`;
      }).join('')}`).join('') : `<div class="empty">${q ? 'לא מצאתי' : 'המלאי ריק. אפשר להתחיל להוסיף מוצרים בצ\'אט איתי, או בכפתור + שליד החיפוש'}</div>`;
function invListHtml(q) {
  const mode = store.get('invMode', 'loc');
  const list = S.products.filter((p) => !q || matches(p, q));
  const groups = new Map();
  const keyOf = (p) => (mode === 'loc' ? p.location_id : p.category_id) ?? 0;
  const nameOf = (k) => (mode === 'loc' ? S.locations.find((l) => l.id === k)?.name : S.categories.find((c) => c.id === k)?.name) || (mode === 'loc' ? 'בלי מיקום' : 'בלי קטגוריה');
  const sortOf = (k) => (mode === 'loc' ? S.locations : S.categories).find((x) => x.id === k)?.sort ?? 999;
  for (const p of list) { const k = keyOf(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const keys = [...groups.keys()].sort((a, b) => sortOf(a) - sortOf(b));
  return INV_ROWS(keys, groups, nameOf, q);
}
function renderInventory(main) {
  const mode = store.get('invMode', 'loc');
  // home19 (18/10, the owner in Chrome: the space didn't go in): the box is drawn with what was typed, its space too; only the search is trimmed
  const typed = String(store.get('invQ', '') || ''), q = typed.trim();
  const m = S.mood;
  main.innerHTML = `
    <div class="inv-tools">
      <div class="segs" role="group" aria-label="סידור המלאי"><button type="button" class="${mode === 'loc' ? 'on' : ''}" aria-pressed="${mode === 'loc'}" data-mode="loc">לפי מיקום</button><button type="button" class="${mode === 'cat' ? 'on' : ''}" aria-pressed="${mode === 'cat'}" data-mode="cat">לפי קטגוריה</button></div>
      <div class="invq"><input class="field" id="invQ" placeholder="חיפוש במלאי…" value="${esc(typed)}" aria-label="חיפוש במלאי"><button class="fab" type="button" id="addP" aria-label="מוצר חדש">${svg('<path d="M12 5v14M5 12h14" stroke-linecap="round"/>', '#15110E', 3.2)}</button></div>
    </div>
    ${leftoversBox()}
    <div class="facts">
      <h3>מה יש בבית</h3>
      <div class="serv"><span>מוצרים קבועים: <b class="num">${m.basics}</b></span></div>
      <div class="colhead">% ממה שצריך*</div>
      <div id="invList">${invListHtml(q)}</div>
      <div class="foot"><span class="fnote">* כמה מוצרים יש בבית ביחס לכמות שהגדרתם.</span><span class="barcode" id="bc"></span></div>
    </div>`;
  const w = [1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 1, 1, 3, 2, 1];
  $('#bc').innerHTML = w.map((x, i) => `<i style="width:${x * 1.3}px;margin-inline-end:${(w[(i + 7) % w.length] % 2 + 1) * 1.2}px"></i>`).join('');
  main.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { store.set('invMode', b.dataset.mode); render(); }));
  const qi = $('#invQ');
  // "לפי מיקום": a long press on a product opens the places, and a tap on one moves it there (17/10, ש13: 2 steps, no saving)
  const wireRows = () => main.querySelectorAll('[data-p]').forEach((b) => {
    let timer = 0, held = false;
    const stop = () => clearTimeout(timer);
    b.onclick = (e) => { if (held) { held = false; e.preventDefault(); return; } productSheet(productOf(+b.dataset.p)); };
    if (mode !== 'loc' || !S.locations?.length) return;
    b.onpointerdown = () => { held = false; stop(); timer = setTimeout(() => { held = true; navigator.vibrate?.(10); moveSheet(productOf(+b.dataset.p)); }, 500); };
    b.onpointerup = stop; b.onpointerleave = stop; b.onpointercancel = stop;
    b.oncontextmenu = (e) => e.preventDefault(); // no copy menu under the finger
  });
  let t = 0;
  qi.oninput = () => { store.set('invQ', qi.value); clearTimeout(t); t = setTimeout(() => { const box = $('#invList'); if (!box) return; box.innerHTML = invListHtml(qi.value.trim()); hydratePhotos(box); wireRows(); }, 150); };
  wireRows();
  $('#addP').onclick = () => productSheet(null);
  wireLeftovers(main);
}

const inPlace = (n) => placeIn(n, 'במקום נוסף'); // home18
/** The places of the house, the product's own marked: a tap on another moves it (one edit, "לבטל" as for any update). */
function moveSheet(p) {
  if (!p) return;
  sheet(`<h2><bdi>${esc(p.name)}</bdi></h2><div class="days moveto">${S.locations.map((l) => `<button class="btn${l.id === p.location_id ? ' blue' : ''}" type="button" data-to="${l.id}"${l.id === p.location_id ? ' aria-current="true"' : ''}>${esc(l.name)}</button>`).join('')}</div>`, (el, close) => {
    el.querySelectorAll('[data-to]').forEach((b) => (b.onclick = () => { close(); if (+b.dataset.to !== p.location_id) act([{ kind: 'edit', product_id: p.id, fields: { location_id: +b.dataset.to } }]); }));
  });
}
/** Leftovers (cooked food): what's in the fridge and since when; "finished" takes it away. */
function leftoversBox() {
  const xs = S.leftovers || [];
  if (!xs.length) return '';
  return `<div class="maybe leftovers"><span class="cat">שאריות</span>${xs.map((x) => `<div class="rowline"><span><bdi>${esc(x.text)}</bdi><small>${fromDay(x.made)}</small></span><button class="btn" type="button" data-lo-gone="${x.id}">גמרנו</button></div>`).join('')}</div>`;
}
/** "is Sunday's pasta still in the fridge?" — three days after it was cooked (decision 97). */
function leftoverCard() {
  const xs = (S.leftovers || []).filter((x) => (S.leftoverAsk || []).includes(x.id));
  if (!xs.length) return '';
  return xs.map((x) => `<div class="msg bot">האם ${esc(withHa(x.text))} ${fromDay(x.made)} עוד במקרר?</div><div class="chips lo"><button class="chip" type="button" data-lo-gone="${x.id}">גמרנו</button><button class="chip" type="button" data-lo-keep="${x.id}">עוד יש</button></div>`).join('');
}
/** א5 (stage 8, approved r8p, ב): to whoever said yes, once a day, a bubble with two buttons at the bottom of the chat */
function suggestCard() {
  const x = S.suggest;
  if (!x || isChild()) return '';
  return `<div class="msg bot">${esc(x.text)}</div><div class="chips sug"><button class="chip" type="button" data-sug="yes">כן, תציע</button><button class="chip" type="button" data-sug="no">לא עכשיו</button></div>`;
}
function wireLeftovers(root) {
  root.querySelectorAll('[data-sug]').forEach((b) => (b.onclick = async () => {
    const x = S.suggest; if (!x) return;
    root.querySelectorAll('[data-sug]').forEach((y) => (y.disabled = true));
    try { await api('POST', '/api/suggest', {}); S.suggest = null; } catch (e) { root.querySelectorAll('[data-sug]').forEach((y) => (y.disabled = false)); return toast(e.offline ? 'אין קליטה' : e.message); }
    if (b.dataset.sug === 'yes') sendChat({ text: x.ask }); else renderThread();
  }));
  const send = async (id, gone) => { try { await api('POST', '/api/leftovers', { id, gone }); await refresh(); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); } };
  root.querySelectorAll('[data-lo-gone]').forEach((b) => (b.onclick = () => send(+b.dataset.loGone, true)));
  root.querySelectorAll('[data-lo-keep]').forEach((b) => (b.onclick = () => send(+b.dataset.loKeep, false)));
}
const withHa = (t) => (/^[א-ת]/.test(t) && !t.startsWith('ה') ? `ה${t}` : t);
const fromDay = (ts) => { const d = dayName(ts); return /^\d/.test(d) ? `מ-${d}` : `מ${d}`; };
/** The weekday, "yesterday" or "today" (in Hebrew) for a date in the last week, else "12.10". */
function dayName(ts) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const days = Math.round((d0 - new Date(new Date(ts).setHours(0, 0, 0, 0))) / 864e5);
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days < 7) return `יום ${WEEKDAYS[new Date(ts).getDay()]}`;
  return fmtDate(ts);
}

function productSheet(p, pre = {}) {
  const isNew = !p;
  let pic = null; // a new photo, base64, waiting for "save"
  let dropPic = false;
  const d = pre.draft ? { ...pre.draft } : p ? { ...p } : { name: pre.name || '', count_type: 'units', qty: pre.then ? 0 : 1, level: 'plenty', is_open: 1, is_basic: 0, target: 1, store: pre.store || 'super', store2: null, location_id: S.locations[0]?.id, category_id: S.categories.find((c) => c.name === 'אחר')?.id, unit: '', pack_size: null, shelf_days: null };
  const opt = (list, val, empty) => `${empty ? `<option value="">${empty}</option>` : ''}${list.map(([v, n]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
  const draw = (el) => {
    const t = d.count_type;
    el.innerHTML = `
      <h2>${isNew ? 'מוצר חדש' : `<bdi>${esc(p.name)}</bdi>`}</h2>
      <div class="pic">${pic ? `<img class="photo" src="data:image/jpeg;base64,${pic}" alt="">` : !dropPic && p?.photo ? thumb(p, 'photo') : '<span class="nopic">אין תמונה</span>'}
        <span class="picbtns"><label class="btn blue">${pic || (!dropPic && p?.photo) ? 'צילום חדש' : 'צילום המוצר'}<input type="file" id="f-pic" accept="image/*" hidden></label>
        ${pic || (!dropPic && p?.photo) ? '<button class="btn" type="button" id="f-nopic">בלי תמונה</button>' : ''}</span>
        <small>כדי להבדיל בין שני מוצרים דומים</small></div>
      <label>שם<input class="field" id="f-name" value="${esc(d.name)}" required></label>
      <p class="err" id="f-err" hidden></p>
      <label>איך סופרים<select class="field" id="f-type">${opt(TYPES, t)}</select></label>
      ${t === 'level' ? `<div class="levels" id="f-level">${LEVELS.map(([v, n]) => `<button type="button" data-v="${v}" class="${d.level === v ? 'on' : ''}">${n}</button>`).join('')}</div>` : ''}
      ${t === 'inuse' ? `<label class="switch">יש אחד פתוח<input type="checkbox" id="f-open" ${d.is_open ? 'checked' : ''}></label>` : ''}
      ${t !== 'level' ? `<label>${t === 'inuse' ? 'כמה סגורים יש בארון' : t === 'pack' ? 'כמה יחידות יש בבית' : 'כמה יש בבית'}</label><div class="stepper"><button type="button" data-q="1" aria-label="עוד">${svg('<path d="M12 5v14M5 12h14" stroke-linecap="round"/>', '#15110E', 3.4)}</button><output class="num" id="f-qty">${+(d.qty || 0)}</output><button type="button" data-q="-1" aria-label="פחות">${svg('<path d="M5 12h14" stroke-linecap="round"/>', '#15110E', 3.4)}</button></div>` : ''}
      <div class="two">
        ${t === 'pack' ? `<label>כמה יחידות באריזה<input class="field num" id="f-pack" inputmode="numeric" value="${d.pack_size ?? ''}"></label>` : ''}
        ${t !== 'level' ? `<label>במה זה בא (קרטון, שקית…)<input class="field" id="f-unit" value="${esc(d.unit || '')}"></label>` : ''}
      </div>
      <div class="two">
        <label>מיקום<select class="field" id="f-loc">${opt(S.locations.map((l) => [l.id, l.name]), d.location_id, d.location_id ? '' : 'בלי מיקום')}</select></label>
        <label>קטגוריה<select class="field" id="f-cat">${opt(S.categories.map((c) => [c.id, c.name]), d.category_id ?? S.categories.find((c) => c.name === 'אחר')?.id)}</select></label>
      </div>
      ${t !== 'level' ? `<div class="two">
        <label>עוד במקום נוסף<input class="field num" id="f-rq" inputmode="decimal" value="${d.reserve_qty ?? ''}" placeholder="אין"></label>
        <label>איפה<select class="field" id="f-rloc">${opt(S.locations.map((l) => [l.id, l.name]), d.reserve_location_id || '', 'בחירה')}</select></label>
      </div>` : ''}
      <label class="switch">${t === 'inuse' ? 'מוצר קבוע: תמיד שיהיה עוד אחד סגור' : 'מוצר קבוע (תמיד צריך בבית)'}<input type="checkbox" id="f-basic" ${d.is_basic ? 'checked' : ''}></label>
      ${d.is_basic && t !== 'level' ? `<label>${t === 'inuse' ? 'כמה סגורים לשמור' : 'כמה צריך שיהיה לפחות'}<input class="field num" id="f-target" inputmode="decimal" value="${d.target ?? ''}"></label>` : ''}
      <div class="two">
        <label>קונים ב<select class="field" id="f-store">${opt(STORES.filter(([k]) => !S.stores?.find((x) => x.id === k)?.event), d.store)}</select></label>
        <label>אפשר גם ב<select class="field" id="f-store2">${opt(BASE_STORES, d.store2 || '', 'רק שם')}</select></label>
        <label>מותג<input class="field" id="f-brand" value="${esc(d.brand || '')}" maxlength="40" placeholder="למשל תנובה"></label>
        ${!isChild() && d.private_to == null ? `<label>של מי<select class="field" id="f-owner"><option value="">משותף</option>${S.users.map((u) => `<option value="${u.id}" ${d.owner === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>` : ''}
      </div>
      <div class="two">
        <label>כמה ימים מחזיק<input class="field num" id="f-shelf" inputmode="numeric" value="${d.shelf_days ?? ''}" placeholder="ריק = לא מתקלקל"></label>
        <label>אחרי פתיחה מחזיק<input class="field num" id="f-opend" inputmode="numeric" value="${d.open_days ?? ''}" placeholder="ימים"></label>
      </div>
      ${p?.next_expiry ? `<p style="margin:0;font-family:var(--label)">${esc(expText(p.next_expiry))}</p>` : ''}
      ${p?.learned ? `<p class="learned">למדתי ש${esc(p.name)} נגמר בערך כל ${p.learned.every} ימים${p.learned.next && !p.out ? `, כנראה ייגמר ב-${fmtDate(p.learned.next)}` : ''}.</p>` : ''}
      ${isNew ? '' : `<div class="acts pacts">${p.open_days && !p.out ? '<button class="btn blue" type="button" id="openBtn">פתחנו</button>' : ''}<button class="btn yel" type="button" id="outBtn">נגמר בבית</button><button class="btn" type="button" id="toss">זרקנו לפח</button>${S.me.role === 'child' ? '' : p.noDelete ? `<small class="nodel">${esc(p.noDelete)}</small>` : `<button class="btn" type="button" id="del">מחיקה</button>`}</div>`}
      <div class="acts"><button class="btn go" type="button" id="save">${isNew ? 'הוספה' : 'שמירה'}</button><button class="btn" type="button" data-close>סגירה</button></div>`; // b05, q17 (approved 02/10): the actions above "שמירה" and "סגירה"; D15 instead of "מחיקה"
    // home19 (typing, 18/10): the window draws itself again from what was read (the type of count, "מוצר קבוע", a photo), so
    // for that what was typed stays as it is, its space at the end too ("חומץ " came back "חומץ" and the next word glued on);
    // trimmed only for saving
    const read = (asTyped) => {
      const txt = (v) => (asTyped ? v : v.trim());
      d.name = txt($('#f-name', el).value);
      d.unit = $('#f-unit', el) ? txt($('#f-unit', el).value) : d.unit;
      if ($('#f-pack', el)) d.pack_size = +$('#f-pack', el).value || null;
      if ($('#f-target', el)) d.target = $('#f-target', el).value === '' ? null : +$('#f-target', el).value;
      if ($('#f-open', el)) d.is_open = $('#f-open', el).checked ? 1 : 0;
      d.location_id = $('#f-loc', el).value ? +$('#f-loc', el).value : null; d.category_id = +$('#f-cat', el).value;
      if ($('#f-rq', el)) { d.reserve_qty = $('#f-rq', el).value === '' ? null : +$('#f-rq', el).value; d.reserve_location_id = d.reserve_qty ? +$('#f-rloc', el).value || null : null; }
      d.is_basic = $('#f-basic', el).checked ? 1 : 0;
      d.store = $('#f-store', el).value; d.store2 = $('#f-store2', el).value || null;
      d.brand = txt($('#f-brand', el).value) || null; if ($('#f-owner', el)) { const was = d.owner, v = $('#f-owner', el).value ? +$('#f-owner', el).value : null; if (v !== null || was == null || S.users.some((u) => u.id === was)) d.owner = v; } // an owner who left (their card still open) isn't cleared by saving something else
      d.shelf_days = $('#f-shelf', el).value === '' ? null : +$('#f-shelf', el).value;
      d.open_days = $('#f-opend', el).value === '' ? null : +$('#f-opend', el).value;
    };
    $('#f-type', el).onchange = (e) => { read(true); d.count_type = e.target.value; draw(el); };
    $('#f-pic', el).onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { read(true); pic = (await shrink(f, 320, 0.7)).data; dropPic = false; draw(el); } catch { toast('לא הצלחתי לקרוא את התמונה'); }
    };
    $('#f-nopic', el)?.addEventListener('click', () => { read(true); pic = null; dropPic = true; draw(el); });
    hydratePhotos(el);
    $('#f-basic', el).onchange = () => { read(true); draw(el); };
    el.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { d.qty = Math.max(0, +(d.qty || 0) + +b.dataset.q); $('#f-qty', el).textContent = d.qty; }));
    el.querySelectorAll('#f-level [data-v]').forEach((b) => (b.onclick = () => { d.level = b.dataset.v; el.querySelectorAll('#f-level button').forEach((x) => x.classList.toggle('on', x === b)); }));
    const close = () => el.closest('.scrim')?.remove();
    el.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
    $('#save', el).onclick = () => {
      read(); if (!d.name) { $('#f-name', el).focus(); return; }
      // numbers only in the number fields, before anything closes (a letter used to close the page and lose everything)
      const bad = [['#f-pack', 'יחידות באריזה'], ['#f-target', 'כמות מינימום'], ['#f-shelf', 'חיי מדף'], ['#f-opend', 'אחרי פתיחה'], ['#f-rq', 'עוד במקום נוסף']]
        .find(([id]) => { const v = $(id, el)?.value.trim(); return v && !(/^\d+(\.\d+)?$/.test(v)); });
      if (bad) { const e = $('#f-err', el); e.textContent = `ב"${bad[1]}" צריך לכתוב מספר, או להשאיר ריק.`; feel('error'); e.hidden = false; $(bad[0], el).focus(); return; }
      if (d.reserve_qty && !d.reserve_location_id) { const e = $('#f-err', el); e.textContent = 'איפה נמצא המקום הנוסף?'; e.hidden = false; $('#f-rloc', el).focus(); return; }
      // two different things with one name (two scorpion sauces): the list and Shuki can't tell them apart
      const twin = S.products.find((x) => x.id !== p?.id && norm(x.name) === norm(d.name));
      if (twin) {
        const e = $('#f-err', el);
        e.textContent = `כבר יש "${twin.name}". אם זה מוצר אחר, ספרו לי מה ההבדל: טעם, צבע, גודל, מותג. למשל "${twin.name} ירוק". ואפשר גם לצרף תמונה.`;
        e.hidden = false; $('#f-name', el).focus(); mascot?.react('confused', 1600); return;
      }
      const fields = { name: d.name, count_type: d.count_type, unit: d.unit || null, pack_size: d.pack_size, qty: d.count_type === 'level' ? 0 : +d.qty || 0, level: d.count_type === 'level' ? d.level : null, is_open: d.is_open, is_basic: d.is_basic, target: d.target, store: d.store, store2: d.store2, brand: d.brand ?? null, ...(d.owner !== undefined && $('#f-owner', el) && { owner: d.owner ?? null }), location_id: d.location_id, category_id: d.category_id, shelf_days: d.shelf_days, open_days: d.open_days , ...(d.count_type !== 'level' && { reserve_qty: d.reserve_qty || null, reserve_location_id: d.reserve_qty ? d.reserve_location_id : null }) };
      close();
      const photo = pic, drop = dropPic;
      act([isNew ? { kind: 'create', product: fields } : { kind: 'edit', product_id: p.id, fields }, ...(isNew && pre.then ? pre.then : [])]).then(async (r) => {
        // refused (a twin the other phone just added): back to the sheet, with what was typed
        if (!r && online && S.products.some((x) => x.id !== p?.id && norm(x.name) === norm(d.name))) { productSheet(p, { ...pre, draft: { ...d } }); $('#save')?.click(); return; }
        if (!r && online && lastActError) { const why = lastActError; productSheet(p, { ...pre, draft: { ...d } }); const e = $('#f-err'); if (e) { e.textContent = why; e.hidden = false; } return; }
        const id = isNew ? r?.created?.[0] : p.id;
        if (!id) return;
        try {
          if (photo) await api('POST', `/api/photo/${id}`, { data: photo });
          else if (drop && p?.photo) await api('DELETE', `/api/photo/${id}`);
          if (photo || drop) await refresh();
        } catch (e) { toast(e.offline ? 'התמונה לא נשמרה, אין קליטה' : e.message); }
      });
    };
    $('#outBtn', el)?.addEventListener('click', () => { close(); act([{ kind: 'op', product_id: p.id, op: { type: 'out' } }]); });
    $('#openBtn', el)?.addEventListener('click', () => { close(); act([{ kind: 'op', product_id: p.id, op: { type: 'open' } }]); });
    $('#toss', el)?.addEventListener('click', () => { close(); act([{ kind: 'op', product_id: p.id, op: { type: 'discard' } }]); });
    const del = $('#del', el);
    del?.addEventListener('click', () => {
      if (del.dataset.sure) { close(); act([{ kind: 'delete', product_id: p.id }]); }
      else { del.dataset.sure = '1'; del.textContent = 'למחוק באמת?'; del.classList.add('sure'); feel('scared'); } // not .go: that makes its row stick to the bottom too
    });
  };
  sheet('', (el) => draw(el));
}

/* ================= Shuki's closet ================= */
/** One thing per spot, from what my Shuki has unlocked. Locked things show the level that brings them. */
function closetSheet() {
  const level = S.growth.level;
  const wear = { ...(S.outfit || {}) };
  sheet(`<h2>המלתחה שלי</h2>
    <div class="closet-prev"><div id="clPrev"></div></div>
    ${SLOTS.map(([slot, label]) => {
      const items = ITEMS.filter((x) => x.slot === slot);
      return `<div class="slot"><span class="cat">${label}</span><div class="opts">
        <button type="button" class="chip" data-slot="${slot}" data-id="">בלי</button>
        ${items.map((x) => (x.level <= level
          ? `<button type="button" class="chip" data-slot="${slot}" data-id="${x.id}">${esc(x.name)}</button>`
          : `<span class="chip locked">${esc(x.name)} · רמה ${x.level}</span>`)).join('')}
      </div></div>`;
    }).join('')}
    <div class="acts"><button class="btn go" type="button" id="clSave">שמירה</button><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
    const prev = mountShuki($('#clPrev', el), 'happy', { level, wear });
    const mark = () => el.querySelectorAll('[data-slot]').forEach((b) => b.classList.toggle('on', (wear[b.dataset.slot] || '') === b.dataset.id));
    mark();
    el.querySelectorAll('[data-slot]').forEach((b) => (b.onclick = () => {
      if (b.dataset.id) wear[b.dataset.slot] = b.dataset.id; else delete wear[b.dataset.slot];
      mark(); prev.setLook({ level, wear: { ...wear } }); prev.react('excited', 900);
    }));
    $('#clSave', el).onclick = async () => {
      try {
        const r = await api('POST', '/api/outfit', { wear });
        S.outfit = r.wear; store.set('state', S); close();
        mascot?.setLook(myLook()); mascot?.react('excited', 1800); render(); // t7: no afro here
      } catch (e) { toast(e.offline ? 'אין קליטה, אפשר לנסות שוב אחר כך' : e.message); }
    };
  });
}

/* ================= settings ================= */
const everyText = (d) => { const n = Math.max(1, Math.round(d)); return n === 1 ? 'נגמר כל יום' : n === 2 ? 'נגמר כל יומיים' : n === 7 ? 'נגמר כל שבוע' : `נגמר כל ${n} ימים`; };
// what people did in the house (bought, ran out, threw away) vs. everything else, which stays folded
const HUMAN = new Set(['purchase', 'out', 'low', 'discard', 'finish', 'list_add', 'create', 'delete']);
function journalHtml() {
  const dayOf = (ts) => { const d = new Date(ts); const t = new Date(); const y = new Date(Date.now() - 864e5); return d.toDateString() === t.toDateString() ? 'היום' : d.toDateString() === y.toDateString() ? 'אתמול' : fmtDate(ts); };
  const clockOf = (ts) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const people = S.journal.filter((j) => HUMAN.has(j.type) && !j.undone);
  let day = '';
  const rows = people.map((j) => { const d = dayOf(j.ts); const head = d !== day ? `<div class="jday">${esc(d)}</div>` : ''; day = d; return `${head}<div class="jrow"><span class="t num">${clockOf(j.ts)}</span><span>${esc(j.summary)}</span></div>`; }).join('');
  const all = S.journal.map((j) => `<div class="jrow ${j.undone ? 'u' : ''}"><span class="t num">${fmtDate(j.ts)} ${clockOf(j.ts)}</span><span>${esc(j.summary)}${j.undone ? ' (בוטל)' : ''}</span></div>`).join('');
  return `<div class="journal">${rows || '<p>עוד לא קנו או סימנו כלום.</p>'}</div>
    <details class="techlog"><summary>כל הפעולות</summary><div class="journal">${all}</div></details>`;
}
/** "what Shuki learned": the rules the house taught him (in every chat), and how often things run out. */
/** b06 (approved 02/10): the name of each kind of fact; [m, f, p] by whom it is about (the plural: 7ב, question 12). */
const FACT_NAMES = { avoid: ['לא אוכל', 'לא אוכלת', 'לא אוכלים'], allergy: 'אלרגיה', diet: 'סגנון תזונה', kosher: 'כשרות', shabbat: ['שומר שבת', 'שומרת שבת', 'שומרים שבת'], period: 'דיאטה',
  likes: ['אוהב', 'אוהבת', 'אוהבים'], substitute: 'תחליף', fasting: 'צום', training: 'שגרת אימונים', no_ask: 'לא לשאול', pregnancy: 'הריון', health: 'בריאות',
  meat_milk_wait: 'בין בשר לחלב', appliance: 'ציוד בבית', broken: 'לא עובד עכשיו', habit: 'הרגלים של הבית', suggest_optin: 'הצעות לארוחות', shopday_optin: 'תזכורת לפני קניות', soon_optin: 'מה עומד להיגמר בקניות', kitniyot: 'קטניות בפסח' }; // kitniyot: 59 (the owner 05/10)
function factText(f) {
  const n = FACT_NAMES[f.key]; if (!n) return null;
  const who = f.about === 'person' ? (f.about_id === S.me.id ? S.me.gender : f.about_gender) : 'm';
  const name = Array.isArray(n) ? byPerson(who, n[0], n[1], n[2]) : n;
  let v = f.value; try { const j = JSON.parse(v); if (j?.from?.name && j?.to?.name) v = `${j.to.name} במקום ${j.from.name}`; } catch { /* plain text */ }
  if (f.key === 'no_ask' && v === 'ללמוד') return `${name}: שאלות כדי ללמוד ${byPerson(who, 'עליך', 'עלייך', 'עליכם')}`; // 59 (the owner 05/10): "די לשאול" (NO_ASK)
  return f.key === 'shabbat' && v === 'כן' ? name : `${name}: ${v}`;
}
/** q14, r9-6 (approved 02/10): what Shuki learned, by whom it is about; what's private has a lock, and only its own person
 * sees it (factsFor); a tap opens it with "מחיקה" for its person, and for a grown-up also the house's and a child's. */
function factsHtml() {
  // 11 (05/10 noon): "לא לשאול" only to its own person
  const fs = (S.facts || []).filter((f) => factText(f) && !(f.key === 'no_ask' && !(f.about === 'person' && f.about_id === S.me.id))), adult = S.me.role !== 'child';
  const may = (f) => (f.about === 'person' && f.about_id === S.me.id) || (adult && (f.about === 'house' || S.users.find((u) => u.id === f.about_id)?.role === 'child'));
  const row = (f) => `<div class="rowline">${may(f) ? `<button class="linkish" type="button" data-fact="${f.id}"><span>${esc(factText(f))}${f.private ? lockHtml({ private_to: S.me.id }) : ''}</span></button>` : `<span class="linkish"><span>${esc(factText(f))}</span></span>`}</div>`;
  const groups = [[byPerson(S?.me, 'עליך', 'עלייך', 'עליכם'), fs.filter((f) => f.about === 'person' && f.about_id === S.me.id)], ['על הבית', fs.filter((f) => f.about === 'house')],
    ...S.users.filter((u) => u.id !== S.me.id).map((u) => [`על ${u.name}`, fs.filter((f) => f.about === 'person' && f.about_id === u.id)])];
  return groups.filter(([, xs]) => xs.length).map(([h, xs]) => `<h4>${esc(h)}</h4>${xs.map(row).join('')}`).join('');
}
function learnedHtml(learned) {
  const ls = S.lessons || [], adult = S.me.role !== 'child';
  const who = (l) => `${l.by_name ? `${esc(l.by_name)} · ` : ''}${fmtDate(l.added)}`;
  const facts = factsHtml();
  // מ27: the guests the house keeps, after the facts and before the rules; any grown-up deletes (a child doesn't get them)
  const guests = (S.houseGuests || []).length ? `<h4>על האורחים</h4>${S.houseGuests.map((g) => `<div class="rowline"><button class="linkish" type="button" data-guest="${g.id}"><span>${esc(`${g.name}: ${g.eats}`)}</span></button></div>`).join('')}` : '';
  return `<section class="panel taught"><h3>מה למדתי</h3>${facts}${guests}
    ${ls.length ? `${facts || guests ? '<h4>כללים</h4>' : ''}${ls.map((l) => `<div class="rowline">${adult ? `<button class="linkish" type="button" data-lesson="${l.id}"><span>${esc(l.text)}</span><small>${who(l)}</small></button>` : `<span class="linkish"><span>${esc(l.text)}</span><small>${who(l)}</small></span>`}</div>`).join('')}`
      : facts || guests ? '' : '<p>עוד לא למדתי כלום על הבית. אפשר לכתוב לי "תזכור ש...", או ללחוץ על האגודל למטה ליד התשובות שלי ואלמד.</p>'}
    ${(S.noticed || []).length ? `<h4>שמתי לב ש...</h4>${S.noticed.map((n) => `<div class="rowline noticed"><span>${esc(n.text)}</span>${!adult ? '' : n.status === 'yes' ? `<button class="btn" type="button" data-noticed="${n.id}" data-yes="0">להפסיק</button>` : `<span class="yn"><button class="btn go" type="button" data-noticed="${n.id}" data-yes="1">נכון, תזכור</button><button class="btn" type="button" data-noticed="${n.id}" data-yes="0">לא נכון</button></span>`}</div>`).join('')}` : ''}
    ${(S.routines || []).length ? `<h4>קניות קבועות</h4>${S.routines.map((r) => `<div class="rowline"><span><bdi>${esc(r.name)}</bdi> <small>${r.every ? `קונים ${routineEvery(r.every)}. אני מוסיף לרשימה כשמגיע הזמן` : `קונים ביום ${WEEKDAYS[r.weekday]}. אני מוסיף לרשימה יום לפני`}</small></span>${adult ? `<button class="btn" type="button" data-routine-off="${r.id}">להפסיק</button>` : ''}</div>`).join('')}` : ''}
    ${learned.length ? `<h4>כל כמה זמן נגמר</h4>${learned.map((p) => `<div class="rowline"><span><bdi>${esc(p.name)}</bdi></span><span>${everyText(p.learned.every)}</span></div>`).join('')}` : ''}
  </section>`;
}
const PROV = { anthropic: 'Claude', openai: 'ChatGPT' };
const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function wireLearned() {
  document.querySelectorAll('[data-noticed]').forEach((b) => (b.onclick = async () => {
    const yes = b.dataset.yes === '1';
    try { const r = await api('POST', '/api/noticed', { id: +b.dataset.noticed, yes }); if (yes) feel(r.reaction || 'learned'); toast(yes ? 'זוכר!' : 'בסדר, לא אזכור'); await refresh(); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); }
  }));
  document.querySelectorAll('[data-routine-off]').forEach((b) => (b.onclick = async () => {
    try { await api('POST', '/api/routines', { id: +b.dataset.routineOff }); toast('לא ייכנס יותר לבד'); await refresh(); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); }
  }));
  document.querySelectorAll('[data-fact]').forEach((b) => (b.onclick = () => {
    const f = (S.facts || []).find((x) => x.id === +b.dataset.fact); if (!f) return;
    sheet(`<h2>מה למדתי</h2><p>${esc(factText(f))}</p>
      <div class="acts"><button class="btn" type="button" id="f-del">מחיקה</button><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
      $('#f-del', el).onclick = async (e) => {
        if (e.target.dataset.sure !== '1') { e.target.dataset.sure = '1'; e.target.textContent = 'למחוק באמת?'; return; }
        try { await api('POST', '/api/facts', { id: f.id, delete: true }); close(); toast('נמחק'); await refresh(); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); }
      };
    });
  }));
  document.querySelectorAll('[data-guest]').forEach((b) => (b.onclick = () => {
    const g = (S.houseGuests || []).find((x) => x.id === +b.dataset.guest); if (!g) return;
    sheet(`<h2>מה למדתי</h2><p>${esc(`${g.name}: ${g.eats}`)}</p>
      <div class="acts"><button class="btn" type="button" id="g-del">מחיקה</button><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
      $('#g-del', el).onclick = async (e) => {
        if (e.target.dataset.sure !== '1') { e.target.dataset.sure = '1'; e.target.textContent = 'למחוק באמת?'; return; }
        try { await api('POST', '/api/house-guests', { id: g.id, delete: true }); close(); toast('נמחק'); await refresh(); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); }
      };
    });
  }));
  document.querySelectorAll('[data-lesson]').forEach((b) => (b.onclick = () => {
    const l = (S.lessons || []).find((x) => x.id === +b.dataset.lesson); if (!l) return;
    sheet(`<h2>מה למדתי</h2><textarea class="field" id="l-text" rows="3" maxlength="200" aria-label="הכלל">${esc(l.text)}</textarea>
      <div class="acts"><button class="btn go" type="button" id="l-save">שמירה</button><button class="btn" type="button" id="l-del">מחיקה</button><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
      const send = async (body, done) => { try { await api('POST', '/api/lessons', { id: l.id, ...body }); close(); toast(done); await refresh(); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); } };
      $('#l-save', el).onclick = () => send({ text: $('#l-text', el).value }, 'נשמר');
      $('#l-del', el).onclick = (e) => { if (e.target.dataset.sure !== '1') { e.target.dataset.sure = '1'; e.target.textContent = 'למחוק באמת?'; return; } send({ delete: true }, 'נמחק'); };
    });
  }));
}
/** A settings section folded under its title (approved 01/10); what's open stays open when the page is drawn again. */
const openFolds = new Set();
function fold(html) {
  if (!html) return '';
  const title = /<h3>([^<]*)<\/h3>/.exec(html)?.[1] || '';
  return `<details class="fold${/class="panel adult"/.test(html) ? ' adult' : ''}" data-fold="${esc(title)}"${openFolds.has(title) ? ' open' : ''}><summary>${esc(title)}</summary>${html}</details>`;
}
function renderSettings(main) {
  document.body.classList.toggle('kid', isChild()); // a child doesn't see the house-wide settings
  const other = S.products.filter((p) => catName(p.category_id) === 'אחר');
  const push = 'PushManager' in window && 'serviceWorker' in navigator;
  const g = S.growth;
  const learned = S.products.filter((p) => p.learned).sort((a, b) => a.learned.every - b.learned.every);
  main.innerHTML = `<div class="set">
    ${isAdmin() && S.update ? `<section class="panel update"><h3>יש גרסה חדשה</h3><p>גרסה <bdi dir="ltr">${esc(S.update.tag)}</bdi> זמינה (אצלכם <bdi dir="ltr">${esc(S.version || '')}</bdi>). איך מעדכנים: בקובץ README, בפרק "עדכון גרסה".</p>${/^https:\/\/github\.com\//.test(S.update.url || '') ? `<a class="btn" href="${esc(S.update.url)}" target="_blank" rel="noopener">מה חדש</a>` : ''}</section>` : ''}
    <section class="panel grow">
      <button type="button" class="mini" id="growShuki" aria-label="המלתחה"></button>
      <div class="lvname"><b>רמה ${g.level}</b> - <span>${esc(g.name)}</span></div>
      ${g.to ? `<div class="xp" role="progressbar" aria-label="עד הרמה הבאה" aria-valuemin="${g.from}" aria-valuemax="${g.to}" aria-valuenow="${g.xp}"><i style="width:${Math.round(((g.xp - g.from) / (g.to - g.from)) * 100)}%"></i></div><p class="xpnext">${g.to - g.xp === 1 ? 'עוד יום אחד' : `עוד ${g.to - g.xp} ימים`} לרמה ${g.level + 1}</p>` : '<p class="xpnext">הגעתי לרמה הכי גבוהה!</p>'}
      <div class="moodbox"><b>מצב הרוח שלי: ${esc(MOOD_NAMES[S.mood.mood] || '')}</b>${S.mood.basics ? `<span>${basicsLine(S.mood, true)}</span>` : ''}</div>
      <button class="btn yel closet-go" type="button" id="closetGo">המלתחה</button>
    </section>
    ${houseHtml()}
    <section class="panel"><h3>התראות</h3>
      <p>כל יום ב-${esc(S.settings.digest_hour)}:00 הודעה על מה שהתוקף שלו נגמר בעוד יומיים וב-1 לחודש סיכום של מה שקניתם מחוץ לרשימה.</p>
      ${push ? `<div class="acts" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn go" type="button" id="pushOn">להפעיל בטלפון הזה</button><button class="btn" type="button" id="pushTest">בדיקה</button></div>` : ''}
      <div class="toggles">${[['shopping', 'מישהו בקניות ומה נוסף בזמן הזה'], ['messages', 'הודעות מחברי הבית'], ['reminders', 'תזכורות ו"נחשוב על זה"'], ['expiry', 'מה עומד לפוג (בשעת הסיכום)'], ['recount', 'הבדיקה השבועית'], ['requests', 'בקשות של ילדים לרשימה']].map(([k, t]) => `<label class="switch">${t}<input type="checkbox" data-notify="${k}" ${S.notify?.[k] !== false ? 'checked' : ''}></label>`).join('')}</div>
      <p class="hint">${S.shabbat ? 'בלי התראות בין 23:00 ל-07:00, ובשבת משישי 16:00 עד שבת 19:00.' : 'בלי התראות בין 23:00 ל-07:00 (חוץ ממה שנוסף לרשימה בזמן שאתם בקניות).'}</p>
      <label class="rowline adult"><span>שעת הסיכום</span><select class="field num" id="hour" style="width:110px">${[17, 18, 19, 20, 21, 22].map((h) => `<option value="${h}" ${String(h) === S.settings.digest_hour ? 'selected' : ''}>${h}:00</option>`).join('')}</select></label>
    </section>
    <h2 class="more-h">עוד הגדרות</h2>
    ${fold(learnedHtml(learned))}
    ${fold(`<section class="panel"><h3>מארחים לארוחה</h3>
      <p>כמה תהיו? מתי? אפתח לכם רשימת אירוח לארוחה והיא תיסגר לבד אחריה.</p>
      <form class="away" id="hostForm"><label>כמה תהיו?<input class="field num" type="number" min="2" max="60" inputmode="numeric" id="hostN"></label><label>מתי?<input class="field num" type="date" id="hostDay" required></label><button class="btn yel" type="submit">לפתוח רשימת אירוח</button></form>
    </section>`)}
    ${fold(`<section class="panel"><h3>חופשה</h3>
      ${S.guests ? `<div class="rowline"><span>${S.guests.now ? 'אורחים בבית' : `אורחים מ-${fmtDate(S.guests.start)}`} עד ${fmtDate(S.guests.end - 1)}<small>אני לא לומד את הקצב של הבית מהימים האלה</small></span><button class="btn" type="button" id="guestsEnd">האורחים הלכו, אפשר לחזור ללמוד את הקצב</button></div>` : ''}
      ${S.away ? `<p>${S.away.now ? 'הבית בחופשה' : `חופשה מ-${fmtDate(S.away.start)}`} עד ${fmtDate(S.away.end - 1)}. בלי תזכורות ואני לא לומד מהימים האלה.</p><button class="btn" type="button" id="awayEnd">${S.away.now ? 'חזרנו' : 'ביטול החופשה'}</button>`
      : `<p>בזמן חופשה אין תזכורות ואני לא לומד מהימים האלה. אפשר גם לכתוב לי "אנחנו בחו"ל עד ה-10".</p>
      <form class="away" id="awayForm"><label>יוצאים ב-<input class="field num" type="date" id="awayFrom" value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10)}" required></label><label>חוזרים ב-<input class="field num" type="date" id="awayUntil" required></label><button class="btn yel" type="submit">לשמור חופשה</button></form>`}
    </section>`)}
    ${S.pesachPanel ? fold(`<section class="panel adult"><h3>פסח</h3>
      <p>${S.pesach ? 'מצב פסח פועל: לחם, פסטה, בירה וכל מה שחמץ לא חוזרים לרשימה לבד ואני לא מציע אותם.' : 'במצב פסח, חמץ (לחם, פסטה, בירה...) לא חוזר לרשימה לבד. למי ששומר.'}</p>
      <button class="btn ${S.pesach ? '' : 'yel'}" type="button" id="pesach">${S.pesach ? 'לכבות את מצב פסח' : 'להפעיל מצב פסח'}</button>
    </section>`) : '' /* 16/10: only when Passover mode is on, Passover is near, or it came up this week */}
    ${fold(`<section class="panel"><h3>חיבור לעוזר אחר</h3>
      <p>לדבר איתי מתוך Claude, ChatGPT או כל עוזר שתומך ב-MCP: "יש לנו טונה?", "תוסיף חלב לרשימה". החיבור הוא ${byPerson(S?.me, 'בשמך', 'בשמך', 'בשמכם')} ומה שאני מציע מחכה לאישור כאן.</p>
      ${(S.connectors || []).map((c) => `<div class="rowline"><span><bdi>${esc(c.name)}</bdi> <small>${c.last_used ? `בשימוש לאחרונה ${fmtDate(c.last_used)}` : 'עוד לא בשימוש'}</small></span><button class="btn" type="button" data-conn-del="${c.id}">לנתק</button></div>`).join('')}
      <div id="connBox">${shownConn ? connHelp(shownConn) : `<form class="adder" id="connForm"><input class="field" id="c-name" maxlength="30" placeholder="לאיזה עוזר? (למשל Claude)" aria-label="שם העוזר"><button class="btn blue" type="submit">יצירת כתובת</button></form>`}</div>
    </section>`)}
    ${fold(`<section class="panel"><h3>סירי וקיצורי דרך</h3>
      <p>לדבר איתי בלי לפתוח את האפליקציה: אומרים "היי סירי, שוקי" ואז "נגמר החלב". אפשר גם שמצב קניות ייפתח לבד כשמגיעים לסופר.</p>
      <div id="keyBox">${shownKey ? shortcutHelp(shownKey) : '<button class="btn blue" type="button" id="mkKey">יצירת מפתח לקיצורי דרך</button>'}</div>
    </section>`)}
    ${fold(S.suggestBasic.length ? `<section class="panel"><h3>האם קבוע?</h3><p>המוצרים האלה נגמרו כמה פעמים בחודשיים האחרונים וקניתם מהם עוד. האם תרצו שאהפוך אותם למוצרים קבועים?</p>${S.suggestBasic.map((s) => `<div class="rowline"><span>${esc(s.name)} · ${s.times} פעמים</span><button class="btn yel" type="button" data-basic="${s.id}">להפוך לקבוע</button></div>`).join('')}</section>` : '')}
    ${fold(`<section class="panel adult"><h3>מיקומים בבית</h3>
      ${S.locations.map((l) => `<div class="rowline"><input class="field" data-loc="${l.id}" value="${esc(l.name)}" aria-label="שם מיקום"></div>`).join('')}
      <form class="adder" id="newLoc"><input class="field" placeholder="מיקום חדש" aria-label="מיקום חדש"><button class="btn yel" type="submit">הוספה</button></form>
    </section>`)}
    ${fold(`<section class="panel adult"><h3>חנויות</h3>
      <p>סופר · פארם · ירקן${(S.stores || []).some((x) => x.custom && !x.event) ? '' : '. אפשר להוסיף חנויות משלכם (קצב, חנות טבע) וכל אחת מקבלת לשונית ברשימה.'}</p>
      ${(S.stores || []).filter((x) => x.custom).map((x) => `<div class="rowline"><span><bdi>${esc(x.name)}</bdi>${x.event ? `<small>רשימת אירוח, נסגרת ב-${fmtDate(x.until - 1)}</small>` : ''}</span><button class="btn" type="button" data-store-del="${x.id}">מחיקה</button></div>`).join('')}
      <form class="adder" id="newStore"><input class="field" placeholder="חנות חדשה" aria-label="חנות חדשה" maxlength="20"><button class="btn yel" type="submit">הוספה</button></form>
    </section>`)}
    ${fold(`<section class="panel adult"><h3>קטגוריות</h3>
      <details class="cats"><summary>${S.categories.length} קטגוריות</summary><div class="chips">${S.categories.map((c) => `<span class="chip">${esc(c.name)}</span>`).join('')}</div></details>
      ${other.length >= 3 ? `<p>ב"אחר" יש ${other.length} מוצרים: ${other.slice(0, 6).map((p) => esc(p.name)).join(', ')}. האם שווה קטגוריה חדשה?</p>` : ''}
      <form class="adder" id="newCat"><input class="field" placeholder="קטגוריה חדשה" aria-label="קטגוריה חדשה"><button class="btn yel" type="submit">הוספה</button></form>
    </section>`)}
    ${fold(`<section class="panel"><h3>מה קרה בבית</h3>
      ${S.undo ? `<div class="rowline"><span>הפעולה האחרונה ${byPerson(S?.me, 'שלך', 'שלך', 'שלכם')}: ${esc(S.undo.summary)}</span><button class="btn" type="button" id="undo">לבטל</button></div>` : ''}
      ${journalHtml()}
    </section>`)}
    ${fold(`<section class="panel"><h3>גיבוי</h3><p>${isAdmin() ? 'כל לילה נשמר עותק של הבית, שבוע אחורה. אפשר להחזיר את הבית ליום קודם, או להוריד את הכל לקובץ.' : 'כל המלאי, הרשימה ומה שקרה בבית, בקובץ אחד.'}</p>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn blue" type="button" id="export">הורדת גיבוי</button>${isAdmin() ? '<button class="btn" type="button" id="restoreDay">להחזיר ליום קודם</button>' : ''}</div>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" data-csv="inventory">המלאי לאקסל</button><button class="btn" type="button" data-csv="history">היסטוריית קניות לאקסל</button></div></section>`)}
    ${fold(`<section class="panel"><h3>מכשירים</h3><p>המכשיר הזה מחובר בתור ${esc(S.me.name)}.${S.brain ? '' : ' עוד אין לי מפתח, אז אני לא יכול לדבר.'}</p>
      <div id="devBox">${devicesHtml()}</div>
      <p>טלפון חדש לאחד מחברי הבית? קוד חיבור (תקף ליום):</p>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap">${S.users.filter((u) => isAdmin() || u.id === S.me.id).map((u) => `<button class="btn yel" type="button" data-code="${u.id}">קוד ל${u.id === S.me.id ? 'טלפון החדש שלי' : esc(u.name)}</button>`).join('')}</div>
      <div id="codeBox">${shownCode && !shownCode.fromHouse && !shownCode.mine ? codeHtml(shownCode) : ''}</div></section>`)}
    ${fold(advancedHtml())}
    <section class="panel" id="thisDevice"><h3>המכשיר הזה</h3>${thisDeviceHtml()}</section>
    <p class="privacy"><a class="rfrom" href="${PRIVACY_URL}" target="_blank" rel="noopener">פרטיות: מה נשמר ומה נשלח</a></p>
    <p class="appver" id="appVer"${appVersion ? '' : ' hidden'}>${appVersion ? appVerText() : ''}</p>
  </div>`;
  if (!appVersion) loadAppVersion().then(() => { const v = $('#appVer'); if (v && appVersion) { v.innerHTML = appVerText(); v.hidden = false; } });
  mountShuki($('#growShuki'), 'happy', myLook());
  main.querySelectorAll('details.fold').forEach((d) => d.addEventListener('toggle', () => { if (d.open) openFolds.add(d.dataset.fold); else openFolds.delete(d.dataset.fold); }));
  $('#growShuki').onclick = closetSheet; $('#closetGo').onclick = closetSheet;
  $('#hour').onchange = async (e) => { await api('POST', '/api/settings', { digest_hour: +e.target.value }).catch((x) => toast(x.message)); refresh(); };
  wireLearned();
  $('#pushOn')?.addEventListener('click', enablePush);
  $('#pushTest')?.addEventListener('click', async () => { try { const r = await api('POST', '/api/push/test'); toast(r.ok ? 'נשלחה התראת בדיקה' : 'השליחה נכשלה'); } catch (e) { toast(e.message); } });
  main.querySelectorAll('[data-basic]').forEach((b) => (b.onclick = () => act([{ kind: 'edit', product_id: +b.dataset.basic, fields: { is_basic: 1 } }])));
  main.querySelectorAll('[data-loc]').forEach((i) => (i.onchange = async () => {
    const was = S.locations.find((l) => l.id === +i.dataset.loc)?.name;
    if (!i.value.trim()) { i.value = was || ''; toast('למיקום צריך שם'); return; } await api('POST', '/api/settings', { locations: [{ id: +i.dataset.loc, name: i.value.trim(), sort: S.locations.find((l) => l.id === +i.dataset.loc)?.sort }] }).catch((x) => toast(x.message)); refresh(); }));
  $('#newLoc').onsubmit = async (e) => { e.preventDefault(); const i = e.target.querySelector('input'), v = i.value.trim(); if (v) { if (await api('POST', '/api/settings', { locations: [{ name: v }] }).catch((x) => toast(x.message))) i.value = ''; refresh(); } }; // emptied here: a redraw keeps what was typed (home19, typing)
  $('#newStore').onsubmit = async (e) => { e.preventDefault(); const v = e.target.querySelector('input').value.trim(); if (!v) return; try { await api('POST', '/api/settings', { addStore: v }); e.target.querySelector('input').value = ''; toast(`נוספה חנות: ${v}`); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); } refresh(); };
  main.querySelectorAll('[data-store-del]').forEach((b) => (b.onclick = async () => {
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'למחוק באמת? מה שברשימה שלה יעבור לסופר'; b.classList.add('go'); return; }
    try { await api('POST', '/api/settings', { removeStore: b.dataset.storeDel }); if (listStore() === b.dataset.storeDel) store.set('listStore', 'super'); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); } refresh();
  }));
  if ($('#pesach')) $('#pesach').onclick = async (e) => { // the panel is there only around Passover (16/10)
    e.target.disabled = true;
    try {
      const r = await api('POST', '/api/settings', { pesach: !S.pesach });
      if (r.chametz) sheet(`<h2>מצב פסח פועל</h2><p>${r.chametz.length ? `חמץ שרשום בבית: ${r.chametz.map(esc).join(', ')}. מעכשיו הם לא חוזרים לרשימה לבד.` : 'אין חמץ רשום במלאי. מעכשיו חמץ לא חוזר לרשימה לבד.'}</p><div class="acts"><button class="btn go" type="button" data-close>סגירה</button></div>`);
      else toast('מצב פסח כבוי');
    } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); }
    refresh();
  };
  $('#newCat').onsubmit = async (e) => { e.preventDefault(); const i = e.target.querySelector('input'), v = i.value.trim(); if (v) { if (await api('POST', '/api/settings', { addCategory: v }).catch((x) => toast(x.message))) i.value = ''; refresh(); } };
  $('#awayForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/away', { from: $('#awayFrom').value, until: $('#awayUntil').value }); toast('חופשה נעימה! אין תזכורות עד שתחזרו'); feel('away'); await refresh(); } catch (x) { toast(x.message); }
  });
  $('#guestsEnd')?.addEventListener('click', async () => { try { await api('POST', '/api/away', { until: null, end: true, kind: 'guests' }); toast('עודכן'); await refresh(); } catch (x) { toast(x.message); } });
  $('#hostForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('POST', '/api/hosting', { date: $('#hostDay').value, people: +$('#hostN').value || null }); store.set('listStore', r.store); feel('shopStart'); toast('פתחתי רשימת אירוח! מה צריך לקנות לארוחה?'); location.hash = '#list'; await refresh(); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); }
  });
  $('#awayEnd')?.addEventListener('click', async () => { try { await api('POST', '/api/away', { until: null }); toast('ברוכים השבים'); feel('welcomeBack'); await refresh(); } catch (x) { toast(x.message); } });
  $('#mkKey')?.addEventListener('click', async () => {
    try { const r = await api('POST', '/api/shortcut/token'); shownKey = r.token; $('#keyBox').innerHTML = shortcutHelp(r.token); wireCopy($('#keyBox')); } catch (x) { toast(x.message); }
  });
  wireCopy($('#keyBox'));
  $('#connForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('POST', '/api/connectors', { name: $('#c-name').value }); shownConn = r.path; await refresh(); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); }
  });
  wireCopy($('#connBox'));
  main.querySelectorAll('[data-conn-del]').forEach((b) => (b.onclick = async () => {
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'לנתק באמת?'; return; }
    try { await api('POST', '/api/connectors', { id: +b.dataset.connDel, delete: true }); toast('נותק'); await refresh(); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); }
  }));
  $('#undo')?.addEventListener('click', async () => { try { await api('POST', '/api/undo'); toast('בוטל'); feel('oops'); refresh(); } catch (e) { toast(e.message); } });
  $('#export').onclick = () => download('/api/export', `shuki-${new Date().toISOString().slice(0, 10)}.json`);
  main.querySelectorAll('[data-csv]').forEach((b) => (b.onclick = () => download(`/api/export.csv?what=${b.dataset.csv}`, `shuki-${b.dataset.csv === 'history' ? 'היסטוריה' : 'מלאי'}-${new Date().toISOString().slice(0, 10)}.csv`)));
  $('#restoreDay')?.addEventListener('click', restoreSheet);
  if (!devs) loadDevices();
  wireCode(main);
  wireDevices();
  wireHouse(main);
  wireThisDevice();
}

/** Back to an earlier day: the nightly copies, and a copy made just before the last restore. */
async function restoreSheet() {
  let list;
  try { list = (await api('GET', '/api/backups')).backups; } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); return; }
  const label = (b) => (b.day.startsWith('before:') ? `לפני השחזור (${fmtTime(b.created)})` : `${fmtDate(Date.parse(`${b.day}T12:00:00`))}, בלילה`);
  sheet(`<h2>להחזיר את הבית ליום קודם</h2>
    <p>המלאי, הרשימה, מה שקרה בבית וההגדרות יחזרו למצב בבית ביום הקודם. חברי הבית והטלפונים נשארים. לפני כן נשמור עותק של עכשיו אז תמיד נוכל לחזור להיום.</p>
    ${list.length ? `<div class="days">${list.map((b) => `<button class="btn" type="button" data-day="${esc(b.day)}">${esc(label(b))}</button>`).join('')}</div>` : '<p>עוד אין עותקים. הראשון נשמר הלילה.</p>'}
    <div class="acts"><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
    el.querySelectorAll('[data-day]').forEach((b) => (b.onclick = async () => {
      if (!b.dataset.sure) { el.querySelectorAll('[data-day]').forEach((x) => { delete x.dataset.sure; x.classList.remove('go'); }); b.dataset.sure = '1'; b.textContent = `להחזיר באמת? ${b.textContent}`; b.classList.add('go'); return; }
      el.querySelectorAll('button').forEach((x) => (x.disabled = true));
      try { const r = await api('POST', '/api/backups/restore', { day: b.dataset.day }); close(); toast(`הבית חזר. ${r.products} מוצרים, ${r.list} ברשימה`); await refresh(); loadChat(); }
      catch (x) { toast(x.offline ? 'אין קליטה' : x.message); el.querySelectorAll('button').forEach((y) => (y.disabled = false)); }
    }));
  });
}

let devs = null, onlyPhone = false, shownCode = null;
const isAdmin = () => S?.me?.role === 'admin';
const langOf = (g) => byPerson(g, 'פנייה בלשון זכר', 'פנייה בלשון נקבה', 'פנייה בלשון רבים');
/** Settings: the house — its name, who lives here (the admin adds and removes), Shuki's key (Claude or ChatGPT), the time zone. */
/** Product photos kept on the phone (for no signal) go when the phone leaves the house. */
function forgetPhotos() { try { caches.delete('shuki-photos'); } catch { /* no cache api */ } }
/** A file from the server (it needs the token, so not a plain link). */
async function download(path, name) {
  try {
    const r = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error();
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch { toast('אין קליטה'); }
}
/** Deleting the house (admin): a backup first, then the house's name typed out. */
function deleteHouseSheet() {
  sheet(`<h2>מחיקת הבית</h2><p>הכל נמחק: המלאי, הרשימה, הצ'אט, חברי הבית והטלפונים. אי אפשר לבטל. כדאי להוריד גיבוי קודם.</p>
    <div class="acts"><button class="btn blue" type="button" id="delBk">הורדת גיבוי</button></div>
    <label>כדי למחוק, ${byPerson(S?.me, 'כתוב', 'כתבי', 'כתבו')} את שם הבית: <b><bdi>${esc(S.house || '')}</bdi></b><input class="field" id="delName" autocomplete="off"></label>
    <p class="err" id="delErr" hidden></p>
    <div class="acts"><button class="btn go" type="button" id="delGo">למחוק הכל</button><button class="btn" type="button" data-close>ביטול</button></div>`, (el, close) => {
    $('#delBk', el).onclick = () => download('/api/export', `shuki-${new Date().toISOString().slice(0, 10)}.json`);
    $('#delGo', el).onclick = async () => {
      try { await api('POST', '/api/house/delete', { name: $('#delName', el).value }); close(); wipeLocal(); forgetPhotos(); render(); }
      catch (x) { const e = $('#delErr', el); e.textContent = x.offline ? 'אין קליטה' : x.message; e.hidden = false; }
    };
  });
}
function houseHtml() {
  const a = isAdmin();
  const people = S.users.map((u) => `<div class="rowline member"><span><bdi>${esc(u.name)}</bdi><small>${langOf(u.gender)}${u.role === 'admin' ? (byPerson(u, ' · מנהל הבית', ' · מנהלת הבית', ' · מנהל הבית')) : u.role === 'child' ? (byPerson(u, ' · ילד', ' · ילדה', ' · ילד')) : ''}</small></span>
    ${a || u.id === S.me.id || (u.role === 'child' && !isChild()) ? `<button class="btn" type="button" data-mem="${u.id}">עריכה</button>` : ''}</div>`).join(''); // ש1 (05/10): a child's page for every grown-up, with only the switch
  const key = S.keyFrom === 'app' ? 'הצ\'אט פעיל (מפתח שהוזן כאן)' : S.keyFrom === 'server' ? 'הצ\'אט פעיל (מפתח שהוגדר בשרת)' : 'הצ\'אט כבוי. בלי מפתח אין צ\'אט, אבל הרשימה והמלאי עובדים.';
  return `<section class="panel house"><h3>הבית</h3>
    ${a ? `<form class="adder" id="houseName"><input class="field" value="${esc(S.house || '')}" aria-label="שם הבית" maxlength="40"><button class="btn yel" type="submit">שמירה</button></form>` : `<p><b>${esc(S.house || '')}</b></p>`}
    <h4>חברי הבית</h4>${people}
    ${a ? `<h4>${byPerson(S.me, 'הוסף חבר חדש לבית', 'הוסיפי חבר חדש לבית', 'הוסיפו חבר חדש לבית')}</h4><form class="addmem" id="addMem"><label>שם<input class="field" id="m-name" placeholder="שם" maxlength="30"></label><label>לשון פנייה<select class="field" id="m-gender"><option value="" selected disabled hidden></option><option value="m">בלשון זכר</option><option value="f">בלשון נקבה</option><option value="p">בלשון רבים</option></select></label><label>תפקיד<select class="field" id="m-role"><option value="member">מבוגר</option><option value="child">ילד</option></select></label><button class="btn yel" type="submit">הוספה</button></form>` : ''}
    <div id="memCode">${shownCode && shownCode.fromHouse ? codeHtml(shownCode) : ''}</div>
    <h4 id="h-notes-h">הערות לבית</h4>
    ${a ? `<form id="notesForm" class="notes"><textarea class="field" id="h-notes" aria-labelledby="h-notes-h" rows="2" maxlength="600" placeholder="למשל: אלרגיה לבוטנים, הכל כשר, בלי חזיר">${esc(S.notes || '')}</textarea><button class="btn yel" type="submit">שמירה</button></form>` : `<p>${esc(S.notes || 'אין')}</p>`}
    <p class="hint">אני קורא את ההערות ומזהיר כשמוסיפים משהו שלא מתאים.</p>
    ${a ? shopSelects() : ''}
    ${a ? `<label class="switch">דירת שותפים (מה חסר והצעות אוכל לכל אחד רק מהמשותף ומשלו)<input type="checkbox" id="h-room" ${S.roommates ? 'checked' : ''}></label>` : S.roommates ? '<p>דירת שותפים: מה חסר והצעות אוכל לכל אחד רק מהמשותף ומשלו.</p>' : ''}
    <h4>המוח שלי: ${S.provider === 'openai' ? 'ChatGPT' : 'Claude'}</h4><p>${key}</p>
    ${a && S.fellBack ? `<p class="warn">${S.fellBack.why === 'credit' ? `נגמר הקרדיט ב-${PROV[S.fellBack.from]}` : `${PROV[S.fellBack.from]} לא ענה`}, אז בינתיים אני חושב עם ${PROV[S.fellBack.to]}. כש-${PROV[S.fellBack.from]} יחזור, אחזור אליו לבד.</p>` : ''}
    ${a ? `<form class="adder" id="keyForm"><input class="field" id="k-key" dir="ltr" autocomplete="off" spellcheck="false" aria-label="מפתח Claude או ChatGPT"><button class="btn yel" type="submit">שמירה</button></form>
      ${S.keys ? ['anthropic', 'openai'].filter((k) => S.keys[k]).map((k) => `<div class="rowline"><span><bdi>${PROV[k]}</bdi><small>${S.provider === k ? 'המוח הראשי' : 'גיבוי: עובד כשהראשי לא עונה'}</small></span><span class="two-btn">${S.provider === k ? '' : `<button class="btn" type="button" data-primary="${k}">להפוך לראשי</button>`}${S.keys.app?.[k] ? `<button class="btn" type="button" data-dropkey="${k}">להסיר</button>` : ''}</span></div>`).join('') : ''}
      <p class="hint">אפשר לשמור מפתח של Claude וגם של ChatGPT. המפתח שנשמר אחרון הוא הראשי.</p>` : ''}
  </section>`;
}
/** Things used once: the time zone, the month's cost, deleting the house (approved 01/10: out of "הבית", into "מתקדם"). */
function advancedHtml() {
  const a = isAdmin();
  return `<section class="panel"><h3>מתקדם</h3>
    ${a ? `<label class="stack">אזור זמן${tzSelect('tzSel', S.tz || 'Asia/Jerusalem')}</label>` : `<p>אזור זמן: ${esc(S.tz || '')}</p>`}
    ${a && S.cost ? `<h4>עלות החודש</h4><button type="button" class="costrow" id="costRow">החודש עליתי לכם בערך <b class="num" dir="ltr">$${S.cost.spent.toFixed(2)}</b> מתוך <b class="num" dir="ltr">$${S.cost.cap}</b></button>
      <div class="costbar" role="progressbar" aria-label="עלות החודש" aria-valuemin="0" aria-valuemax="${S.cost.cap}" aria-valuenow="${S.cost.spent}"><i style="width:${Math.min(100, Math.round((S.cost.spent / S.cost.cap) * 100))}%"></i></div>` : ''}
    ${a ? '<div class="acts"><button class="btn" type="button" id="houseDel">מחיקת הבית</button></div>' : ''}
  </section>`;
}
function wireHouse(main) {
  const post = async (b, ok) => { try { const r = await api('POST', '/api/settings', b); if (ok) toast(ok); return r; } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); } finally { refresh(); } };
  $('#houseName')?.addEventListener('submit', (e) => { e.preventDefault(); post({ house_name: e.target.querySelector('input').value }, 'נשמר'); });
  $('#tzSel')?.addEventListener('change', (e) => post({ tz: e.target.value }, 'אזור הזמן עודכן'));
  // the cap and why there is one, in the approved words, with a pleased face (round 21)
  $('#costRow')?.addEventListener('click', () => sheet(`<h2 id="capH">תקרה חודשית ($)</h2><div class="capwhy"><div class="mini" id="capFace"></div><p>אני חייב להיות מחובר ל-${S.provider === 'openai' ? 'ChatGPT' : 'Claude'} כדי לדבר איתכם, אבל אל תדאגו! כשנגיע ל-80% מהתקציב אודיע לכם שהקרדיטים עומדים להיגמר.</p></div>
    <form class="adder" id="capForm"><input class="field num" id="capIn" inputmode="decimal" dir="ltr" value="${S.cost.cap}" aria-labelledby="capH"><button class="btn yel" type="submit">שמירה</button></form>`, (el, close) => {
    mountShuki($('#capFace', el), 'happy', myLook());
    $('#capForm', el).onsubmit = (e) => { e.preventDefault(); close(); post({ costCap: Number($('#capIn', el).value.replace(/[^\d.]/g, '')) }, 'התקרה נשמרה'); };
  }));
  $('#houseDel')?.addEventListener('click', deleteHouseSheet);
  $('#notesForm')?.addEventListener('submit', (e) => { e.preventDefault(); post({ house_notes: $('#h-notes').value }, 'נשמר'); });
  for (const k of ['produce', 'care']) $(`#shop-${k}`)?.addEventListener('change', (e) => post({ [`shop_${k}`]: e.target.value }, 'נשמר')); // home18 (5)
  $('#h-room')?.addEventListener('change', (e) => post({ house_mode: e.target.checked ? 'roommates' : 'family' }, e.target.checked ? 'דירת שותפים: מה חסר והצעות אוכל לכל אחד רק מהמשותף ומשלו' : 'עכשיו זה בית אחד'));
  main.querySelectorAll('[data-notify]').forEach((c) => (c.onchange = () => post({ notify: { [c.dataset.notify]: c.checked } })));
  $('#keyForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'בודק…';
    await post({ anthropicKey: $('#k-key').value.trim() }, 'המפתח עובד ונשמר. הצ\'אט פעיל');
  });
  main.querySelectorAll('[data-primary]').forEach((b) => (b.onclick = () => post({ primary: b.dataset.primary }, `עכשיו ${PROV[b.dataset.primary]} הוא המוח הראשי`)));
  main.querySelectorAll('[data-dropkey]').forEach((b) => (b.onclick = () => {
    const last = ['anthropic', 'openai'].filter((k) => S.keys?.[k]).length === 1;
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = last ? 'להסיר באמת? הצ\'אט ייכבה' : 'להסיר באמת?'; b.classList.add('go'); return; }
    post({ dropKey: b.dataset.dropkey }, 'המפתח הוסר');
  }));
  $('#addMem')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const name = $('#m-name').value.trim(); if (!name) return;
      // 7ב (r7d, question 13): no choice yet, a quiet stop with the focus on it, as an empty name
      const gender = $('#m-gender').value; if (!gender) { $('#m-gender').focus(); return; }
      const r = await api('POST', '/api/members', { add: { name, gender, role: $('#m-role').value } });
      shownCode = { code: r.code, expires: r.expires, who: name, fromHouse: true }; $('#m-name').value = ''; await refresh(); feel('newMember');
    } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); }
  });
  main.querySelectorAll('[data-mem]').forEach((b) => (b.onclick = () => memberSheet(S.users.find((u) => u.id === +b.dataset.mem))));
}
/** b01 (approved 02/10, 05/10): seeing a child's chat is each grown-up's own */
function wireSee(el, u) {
  $('#e-see', el)?.addEventListener('change', async (e) => {
    try { await api('POST', '/api/child-chat', { id: u.id, see: e.target.checked }); S.settings = { ...S.settings, [`child_chat:${S.me.id}:${u.id}`]: e.target.checked ? '1' : '0' }; loadChat(); }
    catch (x) { e.target.checked = !e.target.checked; toast(x.offline ? 'אין קליטה' : x.message); }
  });
}
function memberSheet(u) {
  if (!u) return;
  const a = isAdmin(), me = u.id === S.me.id;
  const admins = S.users.filter((x) => x.role === 'admin').length;
  const see = u.role === 'child' && !isChild() ? `<label class="switch">אני רוצה לראות גם את השיחה של ${esc(u.name)}<input type="checkbox" id="e-see" ${S.settings?.[`child_chat:${S.me.id}:${u.id}`] === '0' ? '' : 'checked'}></label>` : '';
  // ש1 (05/10): a grown-up who isn't the admin sees only the switch on a child's page; the server lets them do nothing else
  if (!a && !me) return sheet(`<h2>${esc(u.name)}</h2>${see}`, (el) => wireSee(el, u));
  sheet(`<h2>${esc(u.name)}</h2>
    <label>שם<input class="field" id="e-name" value="${esc(u.name)}" maxlength="30"></label>
    <label>איך לפנות אליך?<select class="field" id="e-gender">${[['m', 'בלשון זכר'], ['f', 'בלשון נקבה'], ['p', 'בלשון רבים']].map(([g, t]) => `<option value="${g}" ${u.gender === g ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    ${see}
    <div class="acts"><button class="btn go" type="button" id="e-save">שמירה</button>
      ${a || me ? `<button class="btn yel" type="button" id="e-code">קוד חיבור לטלפון</button>` : ''}
      ${a && u.role !== 'admin' ? `<button class="btn" type="button" id="e-admin">${byPerson(u, 'להפוך למנהל', 'להפוך למנהלת', 'להפוך למנהל')}</button>` : ''}
      ${a && !me && u.role !== 'admin' ? `<button class="btn" type="button" id="e-child">${u.role === 'child' ? (byPerson(u, 'מבוגר (מוסיף בלי אישור)', 'מבוגרת (מוסיפה בלי אישור)', 'מבוגר (מוסיף בלי אישור)')) : (byPerson(u, 'ילד (מה שמוסיף מחכה לאישור)', 'ילדה (מה שמוסיפה מחכה לאישור)', 'ילד (מה שמוסיף מחכה לאישור)'))}</button>` : ''}
      ${a && u.role === 'admin' && admins > 1 ? '<button class="btn" type="button" id="e-member">להוריד מניהול</button>' : ''}
      ${(a || me) && !(u.role === 'admin' && admins <= 1) ? `<button class="btn" type="button" id="e-remove">${me ? 'לצאת מהבית' : 'להוציא מהבית'}</button>` : ''}
    </div><div id="e-codebox"></div>`, (el, close) => {
    const call = async (b, msg) => { try { const r = await api('POST', '/api/members', { id: u.id, ...b }); if (msg) toast(msg); return r; } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); return null; } };
    wireSee(el, u);
    $('#e-save', el).onclick = async () => { if (await call({ edit: { name: $('#e-name', el).value, gender: $('#e-gender', el).value } }, 'נשמר')) { close(); refresh(); } };
    $('#e-code', el)?.addEventListener('click', async () => { let said = null; const r = await api('POST', '/api/members', { id: u.id, code: true }).catch((x) => { if (x.offline) toast('אין קליטה'); else said = x.message; return null; }); if (said) $('#e-codebox', el).innerHTML = `<p>${esc(said)}</p>`; if (r) { $('#e-codebox', el).innerHTML = codeHtml({ ...r, who: u.name }); wireCopy?.($('#e-codebox', el)); } });
    $('#e-admin', el)?.addEventListener('click', async () => { if (await call({ role: 'admin' }, `${u.name} ${byPerson(u, 'מנהל', 'מנהלת', 'מנהל')} עכשיו`)) { close(); refresh(); } });
    $('#e-member', el)?.addEventListener('click', async () => { if (await call({ role: 'member' }, 'עודכן')) { close(); refresh(); } });
    $('#e-child', el)?.addEventListener('click', async () => { if (await call({ role: u.role === 'child' ? 'member' : 'child' }, 'עודכן')) { close(); refresh(); } });
    $('#e-remove', el)?.addEventListener('click', async (e) => {
      if (me) return leaveSheet(); // r13l: leaving by myself, after its own question
      if (!e.target.dataset.sure) { e.target.dataset.sure = '1'; e.target.textContent = `להוציא באמת? הטלפונים של ${u.name} יתנתקו`; e.target.classList.add('go'); return; }
      const r = await call({ remove: true }, `${u.name} כבר לא מחברי הבית`); if (r) { if (shownCode?.who === u.name) shownCode = null; close(); refresh(); }
    });
  });
}
/** r13l (15/10): leaving the house by myself, the same as the admin taking me out; the owner's words (no plural feminine: the
 * app has three ways of address) */
function leaveSheet() {
  const q = byPerson(S.me, 'האם אתה בטוח שאתה רוצה לצאת מהבית? אמחק את הצ\'אט שלך, את מה שהיה פרטי לך ואת מה שלמדתי עליך.',
    'האם את בטוחה שאת רוצה לצאת מהבית? אמחק את הצ\'אט שלך, את מה שהיה פרטי לך ואת מה שלמדתי עלייך.',
    'האם אתם בטוחים שאתם רוצים לצאת מהבית? אמחק את הצ\'אט שלכם, את מה שהיה פרטי לכם ואת מה שלמדתי עליכם.');
  sheet(`<p>${esc(q)}</p><div class="acts"><button class="btn go" type="button" id="l-yes">לצאת מהבית</button><button class="btn" type="button" id="l-no">ביטול</button></div>`, (el, close) => {
    $('#l-no', el).onclick = close;
    $('#l-yes', el).onclick = async (e) => {
      e.target.disabled = true; // one tap: a second would find nobody ("אין בבית מישהו כזה")
      try { await api('POST', '/api/members', { id: S.me.id, remove: true }); } catch (x) { e.target.disabled = false; toast(x.offline ? 'אין קליטה' : x.message); return; }
      close(); unpaired = null; wipeLocal(); location.hash = ''; render(); // this phone is no longer connected: the pairing screen, as after "ניתוק"
    };
  });
}
const KIND = { app: 'טלפון', shortcut: 'קיצור דרך (סירי)' };
/** "ניתוק המכשיר הזה", in a panel of its own (17/10, ש3): an admin's only phone, with no other admin who has one, isn't disconnected. */
/** The app's version at the bottom of the settings (home19, item 14): VERSION of public/sw.js, from the worker that serves this
 *  page, or from the file when none does yet (the first visit, a browser without one) */
let appVersion = null;
const appVerText = () => `גרסה <bdi dir="ltr">${esc(appVersion)}</bdi>`;
async function loadAppVersion() {
  const sw = navigator.serviceWorker?.controller;
  if (sw) appVersion = await new Promise((ok) => { const ch = new MessageChannel(); ch.port1.onmessage = (e) => ok(e.data?.version || null); sw.postMessage('version', [ch.port2]); setTimeout(() => ok(null), 1500); });
  if (!appVersion) appVersion = await fetch('./sw.js', { cache: 'no-store' }).then((r) => r.text()).then((t) => /const VERSION = '([^']+)'/.exec(t)?.[1] || null).catch(() => null);
}
function thisDeviceHtml() {
  if (!onlyPhone) return '<button class="btn" type="button" id="logout">ניתוק המכשיר הזה</button>';
  return `<p>${byPerson(S.me, 'זה המכשיר היחיד שלך, ואין עוד מנהל עם טלפון. כדי לנתק אותו, קודם חבר טלפון נוסף.', 'זה המכשיר היחיד שלך, ואין עוד מנהל עם טלפון. כדי לנתק אותו, קודם חברי טלפון נוסף.', 'זה המכשיר היחיד שלכם, ואין עוד מנהל עם טלפון. כדי לנתק אותו, קודם חברו טלפון נוסף.')}</p>
    <button class="btn yel" type="button" data-code="${S.me.id}" data-mine="1">לחבר טלפון נוסף</button><div id="myCodeBox">${shownCode?.mine ? codeHtml(shownCode) : ''}</div>`;
}
function wireThisDevice() {
  const box = $('#thisDevice'); if (!box) return;
  box.innerHTML = `<h3>המכשיר הזה</h3>${thisDeviceHtml()}`;
  $('#logout', box)?.addEventListener('click', (e) => {
    if (!e.target.dataset.sure) { e.target.dataset.sure = '1'; e.target.textContent = 'לנתק באמת?'; e.target.classList.add('go'); return; }
    api('POST', '/api/logout').then(() => { wipeLocal(); location.hash = ''; render(); }).catch((x) => { if (x.status === 409) { toast(x.message); loadDevices(); } else { wipeLocal(); location.hash = ''; render(); } }); // as before: offline or a fault, this phone forgets the house
  });
  wireCode(box);
}
function wireCode(root) {
  root.querySelectorAll('[data-code]').forEach((b) => (b.onclick = async () => {
    const mine = !!b.dataset.mine, out = mine ? $('#myCodeBox') : $('#codeBox');
    try { const r = await api('POST', '/api/devices/code', { user_id: +b.dataset.code }); shownCode = { ...r, mine, who: S.users.find((u) => u.id === +b.dataset.code)?.name }; out.innerHTML = codeHtml(shownCode); }
    catch (x) { if (x.offline) toast('אין קליטה'); else out.innerHTML = `<p>${esc(x.message)}</p>`; } // stage 13, d3: the long words stay, not a 3-second toast
  }));
}
function devicesHtml() {
  if (!devs) return '<p>טוען…</p>';
  return devs.map((d) => `<div class="rowline dev"><span><b>${esc(d.who)}</b> · ${esc(KIND[d.kind] || d.kind || 'טלפון')}${d.name ? ` · <bdi dir="ltr">${esc(d.name)}</bdi>` : ''}<small>${d.mine ? 'המכשיר הזה' : d.last_seen ? `נראה לאחרונה ${fmtDate(d.last_seen)}` : `חובר ${fmtDate(d.created)}`}</small></span>${d.mine ? '' : `<button class="btn" type="button" data-unpair="${d.id}">ניתוק</button>`}</div>`).join('');
}
const codeHtml = (c) => `<div class="paircode"><span>הקוד של ${esc(c.who || '')}</span><b class="num" dir="ltr">${esc(c.code)}</b><small>תקף עד ${fmtTime(c.expires)}. מקלידים אותו בטלפון החדש.</small></div>`;
async function loadDevices() {
  try { const r = await api('GET', '/api/devices'); devs = r.devices; const was = onlyPhone; onlyPhone = !!r.onlyPhone; if (was !== onlyPhone) wireThisDevice(); } catch { devs = null; return; }
  const box = $('#devBox'); if (box) { box.innerHTML = devicesHtml(); wireDevices(); }
}
function wireDevices() {
  document.querySelectorAll('[data-unpair]').forEach((b) => (b.onclick = async () => {
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'לנתק באמת?'; b.classList.add('go'); return; }
    try { await api('DELETE', `/api/devices/${b.dataset.unpair}`); toast('המכשיר נותק'); await loadDevices(); } catch (x) { toast(x.message); }
  }));
}

let shownConn = null; // the MCP address, shown once (decision 145)
function connHelp(path) {
  const v = `${location.origin}${path}`;
  return `<div class="keyrow"><span>הכתובת</span><code dir="ltr">${esc(v)}</code><button class="btn" type="button" data-copy="${esc(v)}">העתקה</button></div>
    <p><b>שומרים אותה עכשיו.</b> היא מוצגת פעם אחת ומי שיש לו אותה מדבר איתי ${byPerson(S?.me, 'בשמך', 'בשמך', 'בשמכם')}. אפשר לנתק אותה כאן בכל רגע.</p>
    <ol class="steps"><li>ב-Claude: הגדרות → Connectors → הוספת מחבר מותאם (Custom connector) ומדביקים את הכתובת.</li><li>ב-ChatGPT ובעוזרים אחרים: מוסיפים שרת MCP מרוחק עם הכתובת הזאת.</li></ol>`;
}
let shownKey = null; // the Siri key stays on screen (through refreshes) until you leave settings; the server keeps only its hash
/** Step by step, with everything to paste. The key is shown once; making a new one retires the old. */
function shortcutHelp(key) {
  const origin = location.origin;
  const copy = (label, v) => `<div class="keyrow"><span>${label}</span><code dir="ltr">${esc(v)}</code><button class="btn" type="button" data-copy="${esc(v)}">העתקה</button></div>`;
  return `${copy('כתובת לדיווח', `${origin}/api/say`)}${copy('כתובת לסופר', `${origin}/api/shortcut/shop`)}${copy('כותרת Authorization', `Bearer ${key}`)}
    <p><b>שומרים את המפתח עכשיו.</b> הוא מוצג פעם אחת. יצירת מפתח חדש מבטלת את הקודם.</p>
    <ol class="steps">
      <li>באפליקציית קיצורי הדרך: קיצור חדש בשם <b>שוקי</b>.</li>
      <li>פעולה <bdi dir="ltr">Dictate Text</bdi> (הכתבת טקסט), שפה עברית.</li>
      <li>פעולה <bdi dir="ltr">Get Contents of URL</bdi>, הכתובת: "כתובת לדיווח". בהגדרות שלה:
        <code class="cfg" dir="ltr">Method: POST<br>Headers: Authorization = (הערך שלמעלה)<br>Request Body: JSON<br>text = Dictated Text</code></li>
      <li>פעולה <bdi dir="ltr">Speak Text</bdi> על התוצאה. זו התשובה שלי.</li>
      <li>אומרים "היי סירי, שוקי" ואז את ההודעה ("נגמר החלב"). הצעה לשינוי מחכה לאישור בצ'אט, ומגיעה גם התראה.</li>
    </ol>
    <p><b>כשמגיעים לסופר:</b> קיצור שני, עם <bdi dir="ltr">Get Contents of URL</bdi> ל"כתובת לסופר" ואחריו <bdi dir="ltr">Show Notification</bdi> עם התוצאה:</p>
    <code class="cfg" dir="ltr">Method: POST<br>Headers: Authorization = (הערך שלמעלה)<br>Request Body: JSON<br>store = super</code>
    <p>ואז בלשונית האוטומציה: אוטומציה חדשה מסוג <bdi dir="ltr">Arrive</bdi>, המיקום של הסופר הקבוע ו-<bdi dir="ltr">Run After Confirmation</bdi>. כשמגיעים הטלפון שואל ומצב הקניות נפתח בלי לפתוח את האפליקציה. הרשימה מופיעה בהתראה.</p>`;
}
function wireCopy(el) {
  el.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('הועתק'); } catch { toast('לא הצלחתי להעתיק, אפשר לסמן ולהעתיק ידנית'); } }));
}

async function enablePush() {
  try {
    if (!S.vapid) return toast('ההתראות עוד לא הוגדרו בשרת');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('ההתראות כבויות בטלפון הזה. אפשר להפעיל אותן בהגדרות של הטלפון.');
    const reg = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(S.vapid.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api('POST', '/api/push/subscribe', { subscription: sub.toJSON(), on: true });
    toast('ההתראות פועלות');
  } catch (e) { { toast('לא הצלחתי להפעיל התראות. אפשר לנסות שוב'); feel('error'); } }
}

/* ================= boot ================= */
// On the phone the keyboard takes half the screen: hide the tab bar while typing.
const isText = (el) => el?.matches?.('textarea, input:not([type=checkbox]):not([type=radio]), select');
// The keyboard is "open" when a text field has focus AND the visible viewport shrank (iOS keeps focus after the keyboard hides).
let fullHeight = window.visualViewport?.height || window.innerHeight;
// A text field got focus: the header stops sticking at once, so it doesn't jump to the middle while iOS scrolls the field
// into view. Out of the field (no keyboard): it sticks again (approved 01/10, walkthrough finding 3).
document.addEventListener('focusin', (e) => { if (isText(e.target)) document.body.classList.add('focused'); });
document.addEventListener('focusout', () => setTimeout(() => { if (!isText(document.activeElement)) document.body.classList.remove('focused'); }, 0));
const syncKeyboard = () => {
  const vv = window.visualViewport;
  if (vv && !isText(document.activeElement)) fullHeight = Math.max(fullHeight, vv.height);
  // iOS 26 shrinks innerHeight along with the keyboard, so compare with the tallest viewport seen without a keyboard
  const open = !!vv && isText(document.activeElement) && (vv.height < fullHeight - 120 || window.innerHeight - vv.height > 120);
  const was = document.body.classList.contains('typing');
  document.body.classList.toggle('typing', open);
  // keyboard went down: the thread's end was placed above it, bring it back above the composer and the tabs
  if (was && !open && route === 'chat') requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // iOS keeps fixed elements on the layout viewport: lift the composer above the keyboard
  // (placed from the top of the visible part, which works whether or not iOS shrinks innerHeight with the keyboard)
  const c = $('#composer');
  if (c) {
    // only when it really moved: a write on every viewport scroll (iOS scrolls it while a finger moves the caret) moved the field under the finger (16/10)
    if (open) { const top = Math.round(vv.offsetTop + vv.height - c.offsetHeight); if (Math.abs((parseFloat(c.style.top) || -99) - top) > 1) c.style.top = `${top}px`; c.style.bottom = 'auto'; }
    else { c.style.top = ''; c.style.bottom = ''; }
  }
  // the same for an open window: it sits on the visible part above the keyboard, whole, with nothing of the page under it
  const s = document.querySelector('.scrim'), sh = s?.querySelector('.sheet');
  if (s) {
    if (open) { s.style.top = `${Math.round(vv.offsetTop)}px`; s.style.height = `${Math.round(vv.height)}px`; s.style.bottom = 'auto'; if (sh) sh.style.maxHeight = `${Math.round(vv.height - 12)}px`; }
    else { s.style.top = ''; s.style.height = ''; s.style.bottom = ''; if (sh) sh.style.maxHeight = ''; }
  }
};
window.visualViewport?.addEventListener('scroll', syncKeyboard);
window.visualViewport?.addEventListener('resize', syncKeyboard);
window.addEventListener('scroll', () => { if (document.body.classList.contains('typing')) syncKeyboard(); }, { passive: true });
document.addEventListener('focusin', () => setTimeout(syncKeyboard, 350));
document.addEventListener('focusout', () => setTimeout(syncKeyboard, 350));

// errors on the phone go to the server log (a few per session), so a problem on the iPhone can be seen later
let reported = 0;
const report = (where, msg) => {
  if (!token || reported++ >= 5) return;
  fetch('/api/log', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ where, msg: String(msg).slice(0, 500), ua: navigator.userAgent }) }).catch(() => {});
};
window.addEventListener('error', (e) => report(`${route} ${e.filename?.split('/').pop() || ''}:${e.lineno || ''}`, e.message));
window.addEventListener('unhandledrejection', (e) => report(route, e.reason?.stack || e.reason));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
window.addEventListener('online', () => { setOnline(true); flushQueue(); refresh(); });
window.addEventListener('offline', () => setOnline(false));
document.addEventListener('visibilitychange', () => { if (document.hidden) return; { flushQueue(); refresh(); if (route === 'chat') loadChat(); } });
let tick = 0;
// every 30 seconds; every 10 while someone is in the store, so additions reach the shopper fast
setInterval(() => { tick++; if (!document.hidden && (S?.shopping?.length || tick % 3 === 0)) { flushQueue(); refresh({ quiet: true }); if (route === 'chat' && !pendingChat) loadChat(); } }, 10000); // the others' messages and cards show up too

if (S) applyQueueLocally();
render();
if (token) { flushQueue(); refresh(); loadChat(); }

/* ================= recipes (round 21) ================= */
// The fifth tab. The ✓/✗ is worked out here from the shared rules (public/recipes.js), so it works with no signal.
function R_STATUS(x, people) { return recipeStatus(x, x.ings || [], S.products, people || x.serves); }
function missText(n) { return n === 0 ? 'יש הכל' : n === 1 ? 'חסר מוצר אחד' : `חסרים ${n} מוצרים`; }
/** Where a recipe came from, in the list (approved words): a screenshot, a site, mine or the house's. */
function fromText(x) { return x.source === 'photo' ? 'מתכון מצילום מסך' : x.source === 'shuki' ? 'מתכון של שוקי' : x.url ? (fromTikTok(x.url) ? 'מתכון מטיקטוק' : 'מתכון מאתר') : x.added_by === S.me.id ? 'מתכון שלי' : 'מתכון של הבית'; }
/** Stage 11, question 5 (approved 15/10): a TikTok link by its host (tiktok.com, vm.tiktok.com…), not by how the string starts. */
function fromTikTok(u) { try { const h = new URL(u).hostname.toLowerCase(); return h === 'tiktok.com' || h.endsWith('.tiktok.com'); } catch { return false; } }
// (functions, not consts: the app can open straight on #recipes, before this part of the file has run)
function kosherText(k) { return { meatMilk: 'יש במתכון ערבוב של בשר וחלב', seafood: 'יש במתכון שימוש בפירות ים', pork: 'יש במתכון חזיר' }[k]; }
/** "שימו לב: …" lines for a recipe that doesn't fit the house (the kosher rules from code, the rest from Shuki when it was saved). */
function recipeWarnings(x) {
  const out = [];
  if (x.kosher) out.push(kosherText(x.kosher));
  // the kosher line comes from the code; Shuki's own words about kashrut would say it twice
  // home19 (4): only what is still in the ingredients ("יש במתכון כוסברה" goes when the cilantro was edited out); and (18/10) what
  // the house's facts find in them (the server's factWarnHits), in the same words
  for (const part of String(warnNow(withFacts(x.warn, x.factWarn), x.ings || []) || '').replace(/^שימו לב:\s*/, '').split(/(?<=\.)\s+|,\s*(?=ו?יש במתכון)/)) {
    const t = part.trim().replace(/\.$/, '').replace(/^ו(?=יש במתכון)/, ''); if (!t) continue; // ", ויש במתכון…": a line of its own
    if (x.kosher && /(בשר|עוף|חלב|שמנת|גבינה|חזיר|פירות ים|כשר)/.test(t)) continue;
    out.push(t);
  }
  return out;
}
function savedRecipes_() { return (S.recipes || []).filter((x) => !x.status); }
/** ג10 (approved r8p, option ב): a yellow star with an ink outline, before the name and on the filter */
const FAV_STAR = '<svg class="fav-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="#FFD21A" stroke="#15110E" stroke-width="2" stroke-linejoin="round"/></svg>';
function recipeOrder(xs) {
  const ready = new Map(xs.map((x) => [x.id, R_STATUS(x).missing === 0 ? 1 : 0]));
  // what can be made now first, then the favourites (ג10), then what was made last
  return [...xs].sort((a, b) => ready.get(b.id) - ready.get(a.id) || (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.last_cooked || 0) - (a.last_cooked || 0) || (b.cooked || 0) - (a.cooked || 0) || a.name.localeCompare(b.name, 'he'));
}
function recipeCats(x) { return String(x.tags || '').split(/\s*,\s*/).filter(Boolean); }
function recipeThumb(x, cls = 'rthumb') { return x.photo ? `<img class="${cls}" data-rphoto="${x.id}" alt="">` : ''; }
function hydrateRecipePhotos(root) {
  root?.querySelectorAll?.('img[data-rphoto]:not([src])').forEach((img) => {
    photoSrc(`r${img.dataset.rphoto}`, 1, `/api/recipes/${img.dataset.rphoto}/photo`).then((u) => { img.src = u; }).catch(() => img.remove());
  });
}

// home20 (section 16): "השבוע" | "כל המתכונים" at the top; the week opens by itself when something is planned from today on
// (functions and var, not let / const: the app can open straight on #recipes, before this part of the file has run)
var recView = null;
function planned() { return (S.plan?.dishes || []).filter((d) => d.status === 'planned'); }
function SEGS(v) { return `<div class="segs rec-segs" role="group"><button type="button" class="${v === 'week' ? 'on' : ''}" aria-pressed="${v === 'week'}" data-rview="week">השבוע</button><button type="button" class="${v === 'all' ? 'on' : ''}" aria-pressed="${v === 'all'}" data-rview="all">כל המתכונים</button></div>`; }
function renderRecipes(main) {
  const view = recView || (planned().length ? 'week' : 'all');
  if (view === 'week') { renderWeek(main); return; }
  renderAllRecipes(main);
  main.querySelector('.rec-tools')?.insertAdjacentHTML('afterbegin', SEGS('all'));
  wireSegs(main);
}
function wireSegs(main) {
  main.querySelectorAll('[data-rview]').forEach((b) => (b.onclick = () => { recView = b.dataset.rview; render(); main.querySelector(`[data-rview="${recView}"]`)?.focus({ preventScroll: true }); }));
}
function renderAllRecipes(main) {
  const typed = String(store.get('recQ', '') || ''), q = typed.trim(); // home19: as the inventory's
  const filter = store.get('recF', '');
  const all = savedRecipes_();
  const cats = [...new Set(all.flatMap(recipeCats))].sort((a, b) => { const i = S.recipeCategories || []; const x = i.indexOf(a), y = i.indexOf(b); return (x < 0 ? 999 : x) - (y < 0 ? 999 : y) || a.localeCompare(b, 'he'); });
  const favs = all.some((x) => x.favorite);
  const f = filter && filter !== 'now' && !(filter === 'fav' && favs) && !cats.includes(filter) ? '' : filter;
  const shown = recipeOrder(all.filter((x) => (!q || norm(`${x.name} ${x.tags || ''} ${(x.ings || []).map((i) => i.name).join(' ')}`).includes(norm(q)))
    && (!f || (f === 'now' ? R_STATUS(x).missing === 0 : f === 'fav' ? !!x.favorite : recipeCats(x).includes(f)))));
  const waiting = isChild() ? [] : (S.recipes || []).filter((x) => x.status === 'suggested');
  const card = (x) => {
    const st = R_STATUS(x); const w = recipeWarnings(x);
    return `<button type="button" class="rcard" data-rec="${x.id}">${recipeThumb(x)}<span class="rbody"><b class="rname">${x.favorite ? `<span class="fav-mark" role="img" aria-label="מנה מועדפת">${FAV_STAR}</span>` : ''}<bdi>${esc(x.name)}</bdi></b>
      <span class="rline"><span class="rstat ${st.missing ? 'miss' : 'ok'}">${missText(st.missing)}</span>${w.length ? '<span class="rwarn">שימו לב</span>' : ''}</span>
      <small class="rfrom">${esc(fromText(x))}</small></span></button>`;
  };
  const noneNow = f === 'now' && !shown.length && !q;
  const RNONE = `<div class="empty">אין מתכון שיש בשבילו את כל המוצרים בבית<div class="empty-acts"><button class="btn blue" type="button" data-plan>לתכנן את השבוע</button><button class="btn yel" type="button" data-ideas>רוצים שאכתוב בעצמי מתכון לפי המוצרים?</button></div></div>`;
  const rlist = (sh, q2) => (!all.length ? `<div class="empty">עוד אין מתכונים. אפשר להדביק לי מתכון בצ'אט או ללחוץ על +</div>`
    : f === 'now' && !sh.length && !q2 ? RNONE : sh.length ? sh.map(card).join('') : `<div class="empty">לא מצאתי מתכון כזה</div>`);
  main.innerHTML = `
    <div class="inv-tools rec-tools">
      <div class="invq"><input class="field" id="recQ" placeholder="חיפוש במתכונים…" value="${esc(typed)}" aria-label="חיפוש במתכונים"><button class="fab" type="button" id="addR" aria-label="מתכון חדש">${svg('<path d="M12 5v14M5 12h14" stroke-linecap="round"/>', '#15110E', 3.2)}</button></div>
      ${all.length ? `<div class="rfilters" role="group">${[['now', 'אפשר להכין עכשיו'], ...(favs ? [['fav', 'מועדפות']] : []), ...cats.map((c) => [c, c])].map(([k, t]) => `<button type="button" class="chip ${f === k ? 'on' : ''}" aria-pressed="${f === k}" data-rf="${esc(k)}">${k === 'fav' ? FAV_STAR : ''}${esc(t)}</button>`).join('')}</div>
      <button class="btn blue plan-go" type="button" id="planR">לתכנן את השבוע</button>` : ''}
    </div>
    ${waiting.map((x) => `<div class="rwait"><span><bdi>${esc(x.by_name || '')}</bdi> ${byPerson(x.by_gender, 'הציע', 'הציעה', 'הציעו')} מתכון: <button type="button" class="linkish" data-rec="${x.id}"><bdi>${esc(x.name)}</bdi></button>. האם לשמור?</span><span class="two-btn"><button class="btn yel" type="button" data-rok="${x.id}">כן, תשמור</button><button class="btn" type="button" data-rno="${x.id}">לא צריך</button></span></div>`).join('')}
    <div class="rlist">${rlist(shown, q)}</div>`;
  const qi = $('#recQ');
  // a search redraws only the list, a moment after the last letter; the field itself stays (16/10, iPhone)
  let t = 0;
  const search = (q2) => recipeOrder(all.filter((x) => (!q2 || norm(`${x.name} ${x.tags || ''} ${(x.ings || []).map((i) => i.name).join(' ')}`).includes(norm(q2)))
    && (!f || (f === 'now' ? R_STATUS(x).missing === 0 : f === 'fav' ? !!x.favorite : recipeCats(x).includes(f)))));
  qi.oninput = () => { store.set('recQ', qi.value); clearTimeout(t); t = setTimeout(() => { const box = main.querySelector('.rlist'); if (!box) return; const q2 = qi.value.trim(); box.innerHTML = rlist(search(q2), q2); hydratePhotos(box); box.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => recipeSheet(+b.dataset.rec))); box.querySelectorAll('[data-plan]').forEach((b) => (b.onclick = openWeek)); box.querySelectorAll('[data-ideas]').forEach((b) => (b.onclick = () => newRecipeSheet('ideas'))); }, 150); };
  main.querySelectorAll('[data-rf]').forEach((b) => (b.onclick = () => { store.set('recF', f === b.dataset.rf ? '' : b.dataset.rf); render(); }));
  main.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => recipeSheet(+b.dataset.rec)));
  $('#addR').onclick = () => newRecipeSheet();
  main.querySelectorAll('#planR, [data-plan]').forEach((b) => (b.onclick = openWeek));
  main.querySelectorAll('[data-ideas]').forEach((b) => (b.onclick = () => newRecipeSheet('ideas')));
  main.querySelectorAll('[data-rok], [data-rno]').forEach((b) => (b.onclick = async () => {
    const id = +(b.dataset.rok || b.dataset.rno);
    try { await api('POST', `/api/recipes/${id}/approve`, { yes: !!b.dataset.rok }); if (b.dataset.rok) { toast('שמרתי את המתכון!'); feel('recipeSaved'); } } catch (e) { toast(e.offline ? 'אין קליטה' : e.message); }
    refresh();
  }));
  // the filters run sideways: the chosen one comes into view
  main.querySelector('.rfilters .on')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  hydrateRecipePhotos(main);
}

/** One ingredient for `people`, as it reads on the page: "✗ 6 ביצים (יש 4)", "✓ מלח". */
/** "(יש 4 ביצים)", "(יש קופסה אחת)" (decision, 30/09: a number always says of what). */
function ingHaveText(it) {
  if (it.unit) return amount(it.have, it.unit);
  if (it.have === 1) return /(ות)$/.test(it.name.split(/\s+/)[0]) || /^ביצ/.test(it.name) ? 'רק אחת' : 'רק אחד';
  return `${Math.round(it.have * 100) / 100} ${it.name}`;
}
function ingLine(it, k, add) {
  const t = lineOf({ ...it, qty: it.need ?? it.qty });
  const mark = it.optional ? (it.here ? '✓' : '') : it.ok ? '✓' : '✗'; // optional and not at home: no mark
  // home19 (3): of "שמן חמניות או קנולה", the one at home; (5): a ✗ is a button that puts only it on the list, with a small "+" (18/10)
  const body = `<span class="mark" aria-hidden="true">${mark}</span><span><bdi>${esc(t)}</bdi>${!it.ok && it.counted && it.have > 0 ? ` <small>(יש ${esc(ingHaveText(it))})</small>` : ''}${it.alt ? ` <small>(יש <bdi>${esc(it.alt)}</bdi>)</small>` : ''}</span>`;
  return `<li class="${it.optional ? (it.here ? 'ok' : 'opt') : it.ok ? 'ok' : 'no'}">${add && !it.ok ? `<button type="button" class="ing-add" data-ing-add="${k}">${body}<span class="ing-plus" aria-hidden="true"></span></button>` : body}</li>`;
}

/** The steps, one per line; a recipe written as one paragraph is split at the end of each sentence. */
function stepsOf(text) {
  let xs = String(text || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (xs.length === 1) xs = xs[0].split(/(?<=[.!])\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
  return xs.map((s) => s.replace(/^(\d{1,2}[.)]|[-•*])\s*/, '')).filter(Boolean);
}
function recipeSheet(id, people, fromSync = false) {
  const x = (S.recipes || []).find((y) => y.id === id); if (!x) return;
  const base = x.serves || null;
  const n = people || base;
  openRecipe = { id, people: n, sig: JSON.stringify(x) };
  const st = R_STATUS(x, n);
  const w = recipeWarnings(x);
  const adult = !isChild();
  const mine = x.status === 'suggested' && x.suggested_by === S.me.id;
  sheet(`<h2 data-recipe="${id}"><bdi>${esc(x.name)}</bdi></h2>
    ${adult && x.status !== 'suggested' ? `<button class="btn fav-btn ${x.favorite ? 'on' : ''}" type="button" id="rFav" aria-pressed="${!!x.favorite}">${FAV_STAR}מנה מועדפת</button>` : ''}
    ${recipeThumb(x, 'rhero')}
    ${w.map((t) => `<p class="rwarnline">שימו לב: ${esc(t)}</p>`).join('')}${w.length && x.swap ? `<p class="rswap">${esc(x.swap)}</p>` : ''}
    ${x.cooked ? `<p class="recipe-meta">${x.cooked === 1 ? 'הכנתם פעם אחת' : `הכנתם ${x.cooked} פעמים`}</p>` : ''}
    ${x.url ? `<a class="rfrom" href="${esc(x.url)}" target="_blank" rel="noopener">למתכון המקורי</a>` : ''}
    ${base ? `<div class="people"><span>כמה אנשים?</span><button type="button" class="btn" id="pMinus" aria-label="פחות" ${n <= 1 ? 'disabled' : ''}>−</button><b class="num" id="pN">${n}</b><button type="button" class="btn" id="pPlus" aria-label="יותר">+</button></div>` : ''}
    <section class="rbox"><h3>מצרכים:</h3>
    <ul class="ings">${st.items.map((it, k) => ingLine(it, k, x.status !== 'suggested')).join('')}</ul>
    ${st.missing && x.status !== 'suggested' ? '<button class="btn yel" type="button" id="rMiss">להוסיף את מה שחסר לרשימה</button>' : ''}</section>
    ${x.text && x.status !== 'suggested' ? '<button class="btn blue cook-go" type="button" id="rCook">מצב בישול</button>' : ''}
    ${x.text ? `<section class="rbox steps"><h3>אופן ההכנה</h3><ol class="rsteps">${stepsOf(x.text).map((s) => `<li${/^אם רוצים/.test(s) ? ' class="opt"' : ''}>${esc(s)}</li>`).join('')}</ol></section>` : ''}
    ${x.status !== 'suggested' ? `<div class="made-row"><button class="btn go made-go" type="button" id="rMade">הכנו את זה</button>${adult ? '<button class="btn plan-day" type="button" id="rPlan">לתכנן ליום…</button>' : ''}</div>` : ''}
    <div class="acts ractions">
      <button class="btn" type="button" id="rShare">שיתוף</button>
      ${adult || mine ? '<button class="btn" type="button" id="rEdit">עריכה</button>' : ''}
      ${adult || mine ? '<button class="btn" type="button" id="rDel">מחיקה</button>' : ''}
    </div>`, (el, close) => {
    $('#rFav', el)?.addEventListener('click', async (e) => { // ג10: the star, on or off
      const btn = e.currentTarget; btn.disabled = true;
      try { await api('POST', `/api/recipes/${id}/favorite`, { on: !x.favorite }); await refresh(); recipeSheet(id, n); $('#rFav')?.focus(); } catch (err) { toast(err.offline ? 'אין קליטה' : err.message); btn.disabled = false; btn.focus(); }
    });
    $('#pMinus', el)?.addEventListener('click', () => recipeSheet(id, Math.max(1, n - 1)));
    $('#pPlus', el)?.addEventListener('click', () => recipeSheet(id, Math.min(60, n + 1)));
    $('#rShare', el).onclick = () => shareOut(recipeText(x), 'המתכון הועתק');
    $('#rEdit', el)?.addEventListener('click', () => { close(); recipeForm(x); });
    // home19 (5, the owner 17/10): one ✗ onto the list, by its base name (no amount, not how it's cut): the product at home, or the name
    el.querySelectorAll('[data-ing-add]').forEach((b) => (b.onclick = async () => {
      const it = st.items[+b.dataset.ingAdd]; if (!it) return;
      const open = S.list.filter((i) => i.status === 'open');
      if (it.product_id ? open.some((i) => i.product_id === it.product_id) : open.some((i) => !i.product_id && norm(i.text || '') === norm(it.listName))) { toast('כבר ברשימה.'); return; }
      b.disabled = true;
      const r = await act([it.product_id ? { kind: 'list_add', product_id: it.product_id } : { kind: 'list_add', text: it.listName }], { silent: true });
      if (r && !r.nothing) { toast('הוספתי לרשימה מוצר אחד'); feel('approved'); }
      b.disabled = false;
    }));
    $('#rMiss', el)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const r = await api('POST', `/api/recipes/${id}/missing`, { people: n });
        toast(r.added === 1 ? 'הוספתי לרשימה מוצר אחד' : `הוספתי לרשימה ${r.added} מוצרים`); feel('approved'); await refresh(); recipeSheet(id, n);
      } catch (x_) { e.target.disabled = false; toast(x_.offline ? 'אין קליטה' : x_.message); }
    });
    let del = 0;
    $('#rDel', el)?.addEventListener('click', async (e) => {
      if (del === 0) { del = 1; e.target.textContent = 'האם למחוק את המתכון?'; e.target.classList.add('warn'); return; }
      if (del === 1) { del = 2; e.target.textContent = 'למחוק באמת?'; feel('scared'); return; }
      try { await api('POST', `/api/recipes/${id}/delete`, {}); close(); await refresh(); } catch (x_) { toast(x_.offline ? 'אין קליטה' : x_.message); }
    });
    $('#rCook', el)?.addEventListener('click', () => { close(); cookMode(x, n); });
    $('#rPlan', el)?.addEventListener('click', () => dayPick(x.name, null, (day) => planAdd({ day, recipe_id: x.id })));
    $('#rMade', el)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { const r = await api('POST', `/api/recipes/${id}/cooked`, { people: n }); close(); madeIt(x, r.proposal); }
      catch (x_) { e.target.disabled = false; toast(x_.offline ? 'אין קליטה' : x_.message); }
    });
  });
  hydrateRecipePhotos(document.querySelector('.scrim'));
  if (!fromSync) refresh({ quiet: true }); // shown at once from what the app has; the server's latest catches up (finding 5)
}
/**
 * Walkthrough finding 5 (approved 01/10): a recipe window that's open shows what changed on the server, in place,
 * with "כמה אנשים" and the scroll kept. A recipe deleted meanwhile: the window stays as it is (an action on it gets
 * the server's usual error). The edit form and cooking mode aren't this window, so they're never redrawn.
 */
let openRecipe = null;
function syncRecipeSheet() {
  const h = document.querySelector('.scrim .sheet > h2[data-recipe]');
  if (!h || !openRecipe || Number(h.dataset.recipe) !== openRecipe.id) return;
  const x = (S.recipes || []).find((y) => y.id === openRecipe.id);
  if (!x || JSON.stringify(x) === openRecipe.sig) return; // deleted, or nothing new
  const top = h.closest('.sheet').scrollTop;
  recipeSheet(openRecipe.id, openRecipe.people, true);
  const sh = document.querySelector('.scrim .sheet'); if (sh) { sh.scrollTop = top; sh.classList.toggle('scrolled', top > 0); }
}

/**
 * "מצב בישול" (decision, 30/09): the whole screen, big letters, one step at a time, and the screen stays on.
 * It closes only with ✕ (no tap outside, no swipe), so it survives a kitchen. The last step ends in "הכנו את זה".
 */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); }
    if (!on) { await wakeLock?.release(); wakeLock = null; }
  } catch { /* not supported, or the page is hidden: the screen may dim, nothing else breaks */ }
}
function cookMode(x, people) {
  const steps = stepsOf(x.text);
  const st = R_STATUS(x, people);
  let k = 0, ings = false;
  document.querySelector('.cook')?.remove();
  const el = document.createElement('div');
  el.className = 'cook'; el.dir = 'rtl'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  const again = () => { if (document.visibilityState === 'visible' && el.isConnected) keepAwake(true); };
  const close = () => { el.remove(); keepAwake(false); document.removeEventListener('visibilitychange', again); };
  const draw = () => {
    const last = k === steps.length - 1;
    el.innerHTML = `<div class="cook-top"><h2><bdi>${esc(x.name)}</bdi></h2><button type="button" class="sheet-x" aria-label="סגירה">${svg('<path d="M6 6l12 12M18 6 6 18" stroke-linecap="round"/>', '#15110E', 3.2)}</button></div>
      <div class="segs cook-tabs" role="group"><button type="button" class="${ings ? '' : 'on'}" data-tab="steps">אופן ההכנה</button><button type="button" class="${ings ? 'on' : ''}" data-tab="ings">מצרכים</button></div>
      ${ings ? `<ul class="ings cook-ings">${st.items.map(ingLine).join('')}</ul>`
        : `<p class="cook-n">צעד ${k + 1} מתוך ${steps.length}</p><p class="cook-step">${esc(steps[k])}</p>
      <div class="cook-nav"><button class="btn" type="button" id="cPrev" ${k === 0 ? 'disabled' : ''}>הקודם</button>${last ? '<button class="btn go" type="button" id="cMade">הכנו את זה</button>' : '<button class="btn go" type="button" id="cNext">הבא</button>'}</div>`}`;
    el.querySelector('.sheet-x').onclick = close;
    el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { ings = b.dataset.tab === 'ings'; draw(); }));
    $('#cPrev', el)?.addEventListener('click', () => { k = Math.max(0, k - 1); draw(); });
    $('#cNext', el)?.addEventListener('click', () => { k = Math.min(steps.length - 1, k + 1); draw(); });
    $('#cMade', el)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { const r = await api('POST', `/api/recipes/${x.id}/cooked`, { people }); close(); madeIt(x, r.proposal); }
      catch (x_) { e.target.disabled = false; toast(x_.offline ? 'אין קליטה' : x_.message); }
    });
  };
  draw();
  document.body.append(el);
  document.addEventListener('visibilitychange', again); // iOS lets go of the lock when the app goes to the background
  keepAwake(true);
}

/** "הכנו את זה": the card (as in the chat), then "בתיאבון!" and the leftovers. */
function madeIt(x, p) {
  const after = () => {
    feel('yum'); setTimeout(() => feel('bonAppetit'), 1300); // hungry, then happy
    sheet(`<h2>בתיאבון!</h2><p>האם נשארו שאריות?</p><div class="acts"><button class="btn yel" type="button" id="lYes">נשארו שאריות</button><button class="btn" type="button" id="lNo">לא נשארו שאריות</button></div>`, (el, close) => {
      $('#lYes', el).onclick = async () => { close(); try { await api('POST', '/api/leftovers', { text: x.name }); await refresh(); } catch (e) { toast(e.offline ? 'אין קליטה' : e.message); } };
      $('#lNo', el).onclick = close;
    });
    refresh();
  };
  if (!p) return after();
  feel('cookedCard');
  const skip = new Set(p.off || []);
  sheet(`<h2>הכנו <bdi>${esc(x.name)}</bdi>! איזה כיף! מה לעדכן במלאי?</h2>${coupon({ ...p, skip: [...skip] }, -1)}`, (el, close) => {
    const c = el.querySelector('.coupon');
    c.querySelectorAll('li .tick').forEach((b) => (b.onclick = () => {
      const li = b.closest('li'); const j = +li.dataset.j;
      if (skip.has(j)) { skip.delete(j); li.classList.remove('off'); b.innerHTML = SMALL_TICK; } else { skip.add(j); li.classList.add('off'); b.innerHTML = ''; } b.setAttribute('aria-pressed', String(!li.classList.contains('off'))); /* stage 13, d10 (Q13-5) */
    }));
    c.querySelectorAll('[data-do]').forEach((b) => (b.onclick = async () => {
      c.querySelectorAll('button').forEach((y) => (y.disabled = true));
      try {
        const r = await api('POST', `/api/proposals/${p.id}/${b.dataset.do}`, { skip: [...skip] });
        if (r.status === 'pending' && r.error) { toast(r.error); c.querySelectorAll('button').forEach((y) => (y.disabled = false)); return; }
        close();
        if (r.status === 'applied') after(); else { feel('rejected'); refresh(); }
      } catch (e) { toast(e.offline ? 'אין קליטה' : e.message); c.querySelectorAll('button').forEach((y) => (y.disabled = false)); }
    }));
  });
}

/** + : four ways in (approved words), then the form. */
function newRecipeSheet(start) {
  const pick = (err) => sheet(`<h2>מתכון חדש</h2>${err ? `<p class="rerr">${esc(err)}</p>` : ''}<div class="rways">
      <button class="btn" type="button" data-way="write">כתבו לי את המתכון בעצמכם</button>
      <button class="btn" type="button" data-way="paste">הדביקו טקסט או קישור למתכון</button>
      <button class="btn" type="button" data-way="photo">צרפו צילום של המתכון</button>
      <button class="btn yel" type="button" data-way="ideas">רוצים שאכתוב בעצמי מתכון לפי המוצרים?</button>
      <input type="file" accept="image/*" id="rPhoto" hidden></div>`, (el, close) => {
    el.querySelectorAll('[data-way]').forEach((b) => (b.onclick = () => {
      const w = b.dataset.way;
      if (w === 'write') { close(); recipeForm(null); }
      if (w === 'paste') pasteSheet();
      if (w === 'photo') $('#rPhoto', el).click();
      if (w === 'ideas') ideasSheet();
    }));
    $('#rPhoto', el).onchange = (e) => { const f = e.target.files?.[0]; if (f) readPhoto(f); };
  });
  const readPhoto = async (file, keep = {}) => {
    let image, small;
    try { image = (await shrink(file)).data; small = (await shrink(file, 900, 0.72)).data; } catch { return pick('לא הצלחתי לקרוא את המתכון. האם תוכלו להעלות תמונה ברורה יותר? אפשר גם להקליד את המתכון'); }
    waiting('אני מסדר את המתכון…');
    try {
      const r = await api('POST', '/api/recipes/read', { image: { media_type: 'image/jpeg', data: image } });
      if (!r.recipe) return pick(r.error === 'budget' || r.error === 'brain' ? brainText() : 'לא הצלחתי לקרוא את המתכון. האם תוכלו להעלות תמונה ברורה יותר? אפשר גם להקליד את המתכון');
      recipeForm(null, { ...r.recipe, ...keep, photo: small, source: 'photo' });
    } catch (e) { pick(e.offline ? 'אין קליטה' : 'לא הצלחתי לקרוא את המתכון. האם תוכלו להעלות תמונה ברורה יותר? אפשר גם להקליד את המתכון'); }
  };
  const waiting = (t) => sheet(`<h2>מתכון חדש</h2><p class="rwaiting">${esc(t)}</p>`);
  const pasteSheet = (val = '') => sheet(`<h2>מתכון חדש</h2><textarea class="field" id="rPaste" rows="7" placeholder="הדביקו כאן את המתכון או את הקישור">${esc(val)}</textarea><div class="acts"><button class="btn go" type="button" id="rGo">תסדר לי</button><button class="btn" type="button" data-close>ביטול</button></div>`, (el) => {
    $('#rGo', el).onclick = async () => {
      const text = $('#rPaste', el).value.trim(); if (!text) return;
      waiting('אני מסדר את המתכון…');
      try {
        const r = await api('POST', '/api/recipes/read', { text });
        if (r.video) return videoSheet(r);
        if (r.recipe) return recipeForm(null, r.recipe);
        pick(r.error === 'budget' || r.error === 'brain' ? brainText() : 'לא הצלחתי לקרוא את המתכון. אפשר גם להקליד את המתכון ואני אקרא אותו מהשיחה.');
      } catch (e) { pick(e.offline ? 'אין קליטה' : 'לא הצלחתי לקרוא את המתכון. אפשר גם להקליד את המתכון ואני אקרא אותו מהשיחה.'); }
    };
  });
  const videoSheet = (r) => sheet(`<h2>מתכון חדש</h2><p>בסרטון אין מתכון כתוב, אז שמרתי את הקישור. צרפו לי צילום מסך של המצרכים ואסדר אותם.</p><div class="acts"><button class="btn go" type="button" id="vShot">לצרף צילום</button><input type="file" accept="image/*" id="vFile" hidden></div>`, (el) => {
    $('#vShot', el).onclick = () => $('#vFile', el).click();
    $('#vFile', el).onchange = (e) => { const f = e.target.files?.[0]; if (f) readPhoto(f, { url: r.url, ...(r.name && { name: r.name }) }); };
  });
  const ideasSheet = async (not = []) => {
    waiting('אני חושב על רעיונות טעימים לארוחה בשבילכם…'); feel('thinking');
    let r;
    try { r = await api('POST', '/api/recipes/ideas', { not }); } catch (e) { mascot?.settle(); return pick(e.offline ? 'אין קליטה' : 'לא הצלחתי לחשוב על רעיונות. האם תרצו שאנסה שוב?'); }
    mascot?.react('excited', 1600);
    if (!r.ideas) return pick(r.error === 'budget' || r.error === 'brain' ? brainText() : 'לא הצלחתי לחשוב על רעיונות. האם תרצו שאנסה שוב?');
    const seen = [...not, ...r.ideas.map((i) => i.name)];
    sheet(`<h2>3 רעיונות למתכונים לפי המוצרים שיש בבית</h2><p class="hint">את הרעיונות אני כותב בעצמי, לפי המוצרים שיש לכם בבית.</p>
      ${r.ideas.map((i, k) => `<div class="idea"><b><bdi>${esc(i.name)}</bdi></b>${i.blurb ? `<p>${esc(i.blurb)}</p>` : ''}<p class="idea-ings">${esc(parseIngredients(i.ingredients).map(lineOf).join(' · '))}</p><button class="btn yel" type="button" data-idea="${k}">לשמור את המתכון</button></div>`).join('')}
      <div class="acts"><button class="btn" type="button" id="more">רעיונות אחרים</button></div>`, (el, close) => {
      $('#more', el).onclick = () => ideasSheet(seen);
      el.querySelectorAll('[data-idea]').forEach((b) => (b.onclick = async () => {
        const i = r.ideas[+b.dataset.idea]; b.disabled = true;
        const saved = await saveRecipeNow({ name: i.name, ingredients: i.ingredients, text: i.text, tags: i.tags, serves: i.serves, source: 'shuki' });
        if (saved) close(); else b.disabled = false;
      }));
    });
  };
  if (start === 'ideas') ideasSheet(); else pick();
}
function brainText() { return 'שוקי לא זמין כרגע. הרשימה והמלאי עובדים כרגיל.'; }

/** A child's saved recipe waits for the grown-ups, named by decision 5's rule (the owner 06/10, r7b), as parentWord on the server.
 *  the owner's words (07/10, r7c): in the third person, always the pronoun ("שהוא יאשר"). Two mothers keep the old words (question 104) */
function kidRecipeText() {
  const p = parentsOr(S.users);
  if (p?.one) return `שמרתי והראיתי ל${byPerson(p.one, 'אבא ', 'אמא ', '')}${p.one.name}. ברגע ש${byPerson(p.one, 'הוא יאשר', 'היא תאשר', 'הם יאשרו')}, האישור יופיע כאן.`;
  if (p?.names && p.f) return `שמרתי והראיתי ל${p.word} ${p.names[0]} או ל${p.word} ${p.names[1]}. ברגע שאחת מהן תאשר, האישור יופיע כאן.`; // the owner 07/10, question 104
  const to = p?.many ? 'להורים' : p?.names ? `ל${p.word} ${p.names[0]} או ל${p.word} ${p.names[1]}` : p?.parts ? `ל${p.parts[0]} או ל${p.parts[1]}` : 'לאבא או לאמא'; // parts: 7ב, question 8
  return `שמרתי והראיתי ${to}. ברגע שאחד מהם יאשר, האישור יופיע כאן.`;
}
/** Saves, then says so ("שמרתי את המתכון!" / a child's "שמרתי והראיתי…"); the same one twice opens it. */
async function saveRecipeNow(body) {
  try {
    const r = await api('POST', '/api/recipes', body);
    await refresh();
    if (r.dup) { toast('כבר שמור'); recipeSheet(r.dup); return true; }
    if (r.suggested) toast(kidRecipeText());
    else { toast('שמרתי את המתכון!'); feel('recipeSaved'); }
    if (route !== 'recipes') location.hash = '#recipes';
    return true;
  } catch (e) { toast(e.offline ? 'אין קליטה' : e.message); return false; }
}

/** The form: new (x = null, maybe filled from text / a photo / a link) or editing a saved recipe. */
function recipeForm(x, pre = {}) {
  const editing = !!x;
  const v = { name: x?.name ?? pre.name ?? '', text: x?.text ?? pre.text ?? '', serves: x?.serves ?? pre.serves ?? '', tags: recipeCats(x || { tags: pre.tags }), url: x?.url ?? pre.url ?? null, warn: pre.warn, swap: pre.swap, source: pre.source };
  let photo = editing ? (x.photo ? 'keep' : null) : pre.photo || null;
  const rows = editing ? (x.ings || []).map((i) => ({ line: lineOf(i), product_id: i.product_id })) : null;
  const all = [...new Set([...(S.recipeCategories || []), ...savedRecipes_().flatMap(recipeCats), ...v.tags])];
  const chosen = new Set(v.tags);
  const products = S.products.filter((p) => !p.deleted).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const rowHtml = (r, k) => `<div class="ingrow" data-k="${k}"><input class="field" data-ing="${k}" value="${esc(r.line)}" aria-label="מצרך"><label class="inglink"><select class="field" data-link="${k}" aria-label="מהמלאי">
    <option value="">לא מהמלאי</option>${products.map((p) => `<option value="${p.id}" ${p.id === r.product_id ? 'selected' : ''}>מהמלאי: ${esc(p.name)}</option>`).join('')}</select></label></div>`;
  sheet(`<h2>${editing ? 'עריכת המתכון' : 'מתכון חדש'}</h2>
    <form class="rform" id="rForm" novalidate>
      <label>שם<input class="field" id="rName" maxlength="80" value="${esc(v.name)}"></label>
      <label>כמה אנשים?<input class="field num" id="rServes" type="number" min="1" max="60" inputmode="numeric" value="${esc(v.serves || '')}"></label>
      ${editing ? `<div class="lbl">מצרכים</div><div id="ingRows">${[...rows, { line: '', product_id: null }].map(rowHtml).join('')}</div>`
        : `<label>מצרכים<textarea class="field" id="rIngs" rows="6" placeholder="כל מצרך בשורה, למשל: 4 ביצים">${esc(pre.ingredients || '')}</textarea></label>`}
      <label>הוראות<textarea class="field" id="rText" rows="5">${esc(v.text)}</textarea></label>
      <div class="lbl">קטגוריות</div>
      <div class="rcats" id="rCats">${all.map((c) => `<button type="button" class="chip ${chosen.has(c) ? 'on' : ''}" aria-pressed="${chosen.has(c)}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}<button type="button" class="chip add" id="catAdd">+ קטגוריה משלכם</button></div>
      <div class="catnew" id="catNew" hidden><input class="field" id="catName" maxlength="24" placeholder="שם הקטגוריה"><button class="btn" type="button" id="catOk">הוספה</button></div>
      <div class="lbl">תמונה</div>
      <div class="rphoto" id="rPh"></div>
      <input type="file" accept="image/*" id="rPhFile" hidden>
      <div class="acts"><button class="btn go" type="submit">${editing ? 'שמירה' : isChild() ? 'להציע מתכון' : 'שמירה'}</button><button class="btn" type="button" data-close>ביטול</button></div>
    </form>`, (el, close) => {
    const drawPhoto = () => {
      const has = photo === 'keep' || (photo && photo !== 'keep');
      $('#rPh', el).innerHTML = `${photo === 'keep' ? recipeThumb(x, 'rprev') : photo ? `<img class="rprev" src="data:image/jpeg;base64,${photo}" alt="">` : ''}<span class="two-btn"><button class="btn" type="button" id="phNew">צילום חדש</button>${has ? '<button class="btn" type="button" id="phDel">להוריד את התמונה</button>' : ''}</span>`;
      hydrateRecipePhotos(el);
      $('#phNew', el).onclick = () => $('#rPhFile', el).click();
      $('#phDel', el)?.addEventListener('click', () => { photo = null; drawPhoto(); });
    };
    drawPhoto();
    $('#rPhFile', el).onchange = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { photo = (await shrink(f, 900, 0.72)).data; drawPhoto(); } catch { toast('לא הצלחתי לקרוא את התמונה'); } };
    const wireCats = () => el.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => { const c = b.dataset.cat; if (chosen.has(c)) chosen.delete(c); else chosen.add(c); b.classList.toggle('on', chosen.has(c)); b.setAttribute('aria-pressed', chosen.has(c)); }));
    wireCats();
    $('#catAdd', el).onclick = () => { $('#catNew', el).hidden = false; $('#catName', el).focus(); };
    $('#catOk', el).onclick = () => {
      const c = $('#catName', el).value.trim().replace(/,/g, ' '); if (!c) return;
      chosen.add(c);
      if (!el.querySelector(`[data-cat="${CSS.escape(c)}"]`)) $('#catAdd', el).insertAdjacentHTML('beforebegin', `<button type="button" class="chip on" aria-pressed="true" data-cat="${esc(c)}">${esc(c)}</button>`);
      else el.querySelector(`[data-cat="${CSS.escape(c)}"]`).classList.add('on');
      $('#catName', el).value = ''; $('#catNew', el).hidden = true; wireCats();
    };
    // editing: a new empty row appears under the last one as soon as something is typed in it
    const box = $('#ingRows', el);
    box?.addEventListener('change', (e) => { if (e.target.matches('[data-link]')) e.target.dataset.chosen = '1'; });
    box?.addEventListener('input', (e) => {
      const r = e.target.closest('.ingrow'); if (!r || r !== box.lastElementChild || !e.target.matches('[data-ing]') || !e.target.value.trim()) return;
      const k = box.children.length; box.insertAdjacentHTML('beforeend', rowHtml({ line: '', product_id: null }, k));
    });
    $('#rForm', el).onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#rName', el).value.trim();
      const serves = Number($('#rServes', el).value) || null;
      let ings, ingredients;
      if (editing) {
        // home19 (4): a row typed anew ("כוסברה" → "פטרוזיליה"), or a new one, whose link wasn't chosen here: the server links it
        // by the new words (it kept the cilantro's link, or none)
        ings = [...el.querySelectorAll('.ingrow')].map((r) => { const v = r.querySelector('[data-ing]').value; const p = parseLine(v); const sel = r.querySelector('[data-link]'); const link = sel.value; const was = rows[+r.dataset.k]; const fresh = (!was || v.trim() !== was.line.trim()) && !sel.dataset.chosen; return p && { qty: p.qty, unit: p.unit, name: p.name, ...(!fresh && { product_id: link ? +link : null }) }; }).filter(Boolean);
      } else ingredients = $('#rIngs', el).value.trim();
      if (!name) { toast('איך תרצו לקרוא למתכון?'); $('#rName', el).focus(); return; }
      if (editing ? !ings.length : !ingredients) { toast('אילו מצרכים צריך?'); return; }
      const body = { name, serves, text: $('#rText', el).value.trim(), tags: [...chosen].join(', '), ...(editing ? { ings } : { ingredients, url: v.url, warn: v.warn, swap: v.swap, source: v.source }) };
      if (photo !== 'keep') body.photo = photo;
      const btn = e.submitter || el.querySelector('[type=submit]'); btn.disabled = true;
      if (editing) {
        try { await api('POST', `/api/recipes/${x.id}/edit`, body); close(); photoUrl.delete(`r${x.id}:1`); try { (await caches.open('shuki-photos')).delete(new Request(`/photo-cache/r${x.id}-1.jpg`)); } catch { /* none */ } await refresh(); toast('עודכן'); recipeSheet(x.id); }
        catch (x_) { btn.disabled = false; toast(x_.offline ? 'אין קליטה' : x_.message); }
      } else if (await saveRecipeNow(body)) close(); else btn.disabled = false;
    };
  });
}

/* ================= the week (home20, section 16; docs/home20-wordings.md) ================= */
function wdName(i) { return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][i]; }
function dateOf(d) { return new Date(`${d}T12:00:00Z`); }
/** The day's title and its small line: "היום" · "ראשון 18/10", "מחר" · "שני 19/10", "שלישי" · "20/10". */
function dayHead(d) {
  const days = S.plan?.days || [], k = days.indexOf(d), x = dateOf(d), dm = `${x.getUTCDate()}/${x.getUTCMonth() + 1}`, wd = wdName(x.getUTCDay());
  return k === 0 ? ['היום', `${wd} ${dm}`] : k === 1 ? ['מחר', `${wd} ${dm}`] : [wd, dm];
}
/** Row 10: "מה מכינים היום?", "מה מכינים מחר?", "מה מכינים ביום רביעי?" */
function pickTitle(d) { const k = (S.plan?.days || []).indexOf(d); return k === 0 ? 'מה מכינים היום?' : k === 1 ? 'מה מכינים מחר?' : `מה מכינים ביום ${wdName(dateOf(d).getUTCDay())}?`; }
/** Row 4: the week's summary. */
function weekMissText(n) { return n === 1 ? 'למנות של השבוע חסר מוצר אחד שעוד לא ברשימה' : `למנות של השבוע חסרים ${n} מוצרים שעוד לא ברשימה`; }
function DOTS() { return '<svg viewBox="0 0 24 24" fill="#15110E" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>'; }
function PLUS_S() { return svg('<path d="M12 5v14M5 12h14" stroke-linecap="round"/>', '#15110E', 3.2); }
function openWeek() { recView = 'week'; render(); document.querySelector('[data-rview="week"]')?.focus({ preventScroll: true }); }
function renderWeek(main) {
  const P = S.plan || { days: [], dishes: [], missing: 0 };
  const adult = !isChild();
  const recipeOf = (id) => (S.recipes || []).find((r) => r.id === id);
  const dish = (d, today) => {
    const stamps = d.status === 'cooked' ? '<span class="rstat ok">✓ הכנו את זה</span>'
      : d.recipe_id == null ? '<span class="rstat free">בלי מתכון</span>'
      : `<span class="rstat ${d.miss ? 'miss' : 'ok'}">${missText(d.miss || 0)}</span>${d.miss && d.listed === d.miss ? '<span class="rstat onlist">ברשימה</span>' : ''}`;
    const name = d.recipe_id != null && recipeOf(d.recipe_id) ? `<button type="button" class="linkish dname" data-wrec="${d.recipe_id}"><bdi>${esc(d.name)}</bdi></button>` : `<b class="dname"><bdi>${esc(d.name)}</bdi></b>`;
    return `<div class="dish${d.status === 'cooked' ? ' done' : ''}"><span class="dbody">${name}<span class="rline">${stamps}</span></span>${adult && d.status === 'planned' ? `<button class="more" type="button" aria-label="מה לעשות עם המנה" data-wmore="${d.id}">${DOTS()}</button>` : ''}</div>${adult && today && d.status === 'planned' ? `<button class="btn yel cookit" type="button" data-wcook="${d.id}">הכנו את זה</button>` : ''}`;
  };
  const days = P.days.map((d, k) => {
    const [t, small] = dayHead(d);
    const xs = P.dishes.filter((x) => x.day === d);
    return `<section class="day${k === 0 ? ' today' : ''}" aria-label="${esc(`${t} ${small}`)}"><h3>${esc(t)} <small>${esc(small)}</small></h3>${xs.map((x) => dish(x, k === 0)).join('')}${adult ? `<button class="addish" type="button" data-wadd="${d}">${PLUS_S()}להוסיף מנה</button>` : ''}</section>`;
  }).join('');
  const y = adult && P.yesterday;
  main.innerHTML = `
    <div class="inv-tools rec-tools">${SEGS('week')}</div>
    <div class="week">
      ${y ? `<div class="wask"><p>${esc(y.ask)}</p><span class="two-btn"><button class="btn yel" type="button" id="wYes">כן, הכנו</button><button class="btn" type="button" id="wMove">לא, להעביר להיום</button><button class="btn" type="button" id="wNo">לא</button></span></div>` : ''}
      ${adult && P.missing ? `<div class="wsum"><p>${weekMissText(P.missing)}</p><button class="btn go" type="button" id="wList">להוסיף לרשימה</button></div>` : ''}
      ${days}
    </div>`;
  wireSegs(main);
  main.querySelectorAll('[data-wrec]').forEach((b) => (b.onclick = () => recipeSheet(+b.dataset.wrec)));
  main.querySelectorAll('[data-wadd]').forEach((b) => (b.onclick = () => pickSheet(b.dataset.wadd)));
  main.querySelectorAll('[data-wmore]').forEach((b) => (b.onclick = () => dishMenu(+b.dataset.wmore)));
  main.querySelectorAll('[data-wcook]').forEach((b) => (b.onclick = () => cookDish(+b.dataset.wcook, b)));
  if (y) {
    $('#wYes', main).onclick = (e) => cookDish(y.id, e.currentTarget);
    $('#wMove', main).onclick = () => planOp({ op: 'move', id: y.id, day: P.days[0] });
    $('#wNo', main).onclick = () => planOp({ op: 'skip', id: y.id });
  }
  $('#wList', main)?.addEventListener('click', (e) => weekCard(e.currentTarget));
  hydrateRecipePhotos(main);
}
/** A change to the plan; when a dish's end could take lines off the list, the question (row 24). */
async function planOp(b, { quiet } = {}) {
  try {
    const r = await api('POST', '/api/plan', b);
    if (r.ask) unlistSheet(b.id, r);
    else if (!quiet) toast('עודכן');
    await refresh();
    return r;
  } catch (e) { toast(e.offline ? 'אין קליטה' : e.message); return null; }
}
function unlistSheet(id, r) {
  sheet(`<h2>${esc(r.ask)}</h2><div class="acts"><button class="btn yel" type="button" id="uYes">${esc(r.yes)}</button><button class="btn" type="button" id="uNo">${esc(r.no)}</button></div>`, (el, close) => {
    const go = (op) => async (e) => { e.currentTarget.disabled = true; close(); try { await api('POST', '/api/plan', { op, id }); toast('עודכן'); await refresh(); } catch (x) { toast(x.offline ? 'אין קליטה' : x.message); } };
    $('#uYes', el).onclick = go('unlist'); $('#uNo', el).onclick = go('keep');
  });
}
/** A dish onto a day (the picker, the recipe's "לתכנן ליום…"): at once, with "לבטל"; what it misses, asked (row 13). */
async function planAdd(b) {
  try {
    const r = await api('POST', '/api/plan', { op: 'add', ...b });
    await refresh();
    feel('approved');
    if (r.missing) toast(r.missing === 1 ? 'חסר מוצר אחד. האם להוסיף לרשימה?' : `חסרים ${r.missing} מוצרים. האם להוסיף לרשימה?`, { label: 'להוסיף לרשימה', run: async () => {
      try { const a = await api('POST', '/api/plan', { op: 'list', ids: [r.id] }); toast(a.added === 1 ? 'הוספתי לרשימה מוצר אחד' : `הוספתי לרשימה ${a.added} מוצרים`); feel('approved'); await refresh(); } catch (e) { toast(e.offline ? 'אין קליטה' : e.message); }
    } });
    else toast('עודכן', { label: 'לבטל', run: async () => { try { await api('POST', '/api/plan', { op: 'remove', id: r.id, undo: true }); toast('בוטל'); await refresh(); } catch (e) { toast(e.message); } } });
    return r;
  } catch (e) { toast(e.offline ? 'אין קליטה' : e.message); return null; }
}
/** "הכנו את זה" on a dish: a recipe's as on its page (the card, then the leftovers), for this dish; one without a recipe only marked. */
async function cookDish(id, btn) {
  const d = [...(S.plan?.dishes || []), ...(S.plan?.yesterday ? [S.plan.yesterday] : [])].find((x) => x.id === id); if (!d) return;
  const x = d.recipe_id != null && (S.recipes || []).find((r) => r.id === d.recipe_id);
  if (!x) { await planOp({ op: 'cooked', id }); feel('yum'); return; }
  if (btn) btn.disabled = true;
  try { const r = await api('POST', `/api/recipes/${x.id}/cooked`, { plan: id }); madeIt(x, r.proposal); }
  catch (e) { if (btn) btn.disabled = false; toast(e.offline ? 'אין קליטה' : e.message); }
}
/** "⋯": what else can happen to a dish (row 9). */
function dishMenu(id) {
  const d = (S.plan?.dishes || []).find((x) => x.id === id); if (!d) return;
  sheet(`<h2><bdi>${esc(d.name)}</bdi></h2><div class="menu">
      <button class="btn" type="button" data-dm="cook">הכנו את זה</button>
      <button class="btn" type="button" data-dm="move">להעביר ליום אחר</button>
      <button class="btn" type="button" data-dm="off">להוריד מהתכנון</button>
    </div><div class="acts"><button class="btn" type="button" data-close>סגירה</button></div>`, (el, close) => {
    el.querySelectorAll('[data-dm]').forEach((b) => (b.onclick = () => {
      close();
      if (b.dataset.dm === 'cook') cookDish(id);
      else if (b.dataset.dm === 'move') dayPick(d.name, d.day, (day) => planOp({ op: 'move', id, day }));
      else planOp({ op: 'remove', id });
    }));
  });
}
/** Which day: the week's days, as their titles say them; `not` (the day it's on) left out. */
function dayPick(name, not, then) {
  const days = (S.plan?.days || []).filter((d) => d !== not);
  sheet(`<h2><bdi>${esc(name)}</bdi></h2><div class="menu days">${days.map((d) => { const [t, small] = dayHead(d); return `<button class="btn" type="button" data-day="${d}">${esc(t)} <small>${esc(small)}</small></button>`; }).join('')}</div>
    <div class="acts"><button class="btn" type="button" data-close>סגירה</button></div>`, (el, close) => {
    el.querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => { close(); then(b.dataset.day); }));
  });
}
/** What the house has left after the week's dishes before `day` took theirs (the picker's "יש הכל", as the server's weekNeeds). */
function houseAfterPlan(day) {
  const virt = S.products.map((p) => ({ ...p }));
  const byId = new Map(virt.map((p) => [p.id, p]));
  for (const d of planned().filter((x) => x.recipe_id != null && x.day <= day)) {
    const r = (S.recipes || []).find((y) => y.id === d.recipe_id); if (!r) continue;
    for (const it of recipeStatus(r, r.ings || [], virt, r.serves).items) {
      if (!it.counted || it.need == null || it.product_id == null) continue;
      const p = byId.get(it.product_id); if (!p) continue;
      p.qty = Math.max(0, (Number(p.qty) || 0) - it.need); if (!(p.qty > 0)) p.out = true;
    }
  }
  return virt;
}
/** "מה מכינים ביום רביעי?" (2-pick): a recipe, added at once; or a dish without a recipe. */
function pickSheet(day) {
  const all = savedRecipes_();
  const virt = houseAfterPlan(day);
  const miss = new Map(all.map((x) => [x.id, recipeStatus(x, x.ings || [], virt, x.serves).missing]));
  const favs = all.some((x) => x.favorite);
  const cats = [...new Set(all.flatMap(recipeCats))];
  let f = 'now', q = '';
  const where = (x) => { const d = planned().find((y) => y.recipe_id === x.id && y.day !== day); return d ? `כבר בתכנון ${d.day === S.plan.days[0] ? 'היום' : d.day === S.plan.days[1] ? 'מחר' : `ביום ${wdName(dateOf(d.day).getUTCDay())}`}` : ''; };
  const row = (x) => {
    const pin = where(x) || (x.cooked ? (x.cooked === 1 ? 'הכנתם פעם אחת' : `הכנתם ${x.cooked} פעמים`) : '');
    return `<button type="button" class="prow" data-pick="${x.id}"><span><bdi>${esc(x.name)}</bdi><small>${missText(miss.get(x.id))}${pin ? ` · <span class="pin">${esc(pin)}</span>` : ''}</small></span><span class="plusc" aria-hidden="true">${PLUS_S()}</span></button>`;
  };
  const list = () => {
    const xs = recipeOrder(all.filter((x) => (!q || norm(`${x.name} ${x.tags || ''} ${(x.ings || []).map((i) => i.name).join(' ')}`).includes(norm(q)))
      && (!f || (f === 'now' ? miss.get(x.id) === 0 : f === 'fav' ? !!x.favorite : recipeCats(x).includes(f)))));
    return xs.length ? xs.map(row).join('') : `<div class="empty">${f === 'now' && !q ? 'אין מתכון שיש בשבילו את כל המוצרים בבית' : 'לא מצאתי מתכון כזה'}</div>`;
  };
  const chips = () => [['now', 'אפשר להכין עכשיו'], ...(favs ? [['fav', 'מועדפות']] : []), ...cats.map((c) => [c, c])].map(([k, t]) => `<button type="button" class="chip ${f === k ? 'on' : ''}" aria-pressed="${f === k}" data-pf="${esc(k)}">${k === 'fav' ? FAV_STAR : ''}${esc(t)}</button>`).join('');
  sheet(`<h2>${esc(pickTitle(day))}</h2>
    ${all.length ? `<input class="field" id="pQ" placeholder="חיפוש במתכונים…" aria-label="חיפוש במתכונים"><div class="rfilters" role="group">${chips()}</div><div class="pick">${list()}</div>` : ''}
    <label class="hint" for="pFree">או מנה בלי מתכון</label>
    <div class="freeline"><input class="field" id="pFree" placeholder="למשל: דגים, פיצה בחוץ" maxlength="60"><button class="btn yel" type="button" id="pAdd">להוסיף</button></div>`, (el, close) => {
    const redraw = () => { const box = $('.pick', el); if (box) box.innerHTML = list(); wire(); };
    const wire = () => el.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = async () => { b.disabled = true; close(); await planAdd({ day, recipe_id: +b.dataset.pick }); }));
    el.querySelectorAll('[data-pf]').forEach((b) => (b.onclick = () => { f = f === b.dataset.pf ? '' : b.dataset.pf; el.querySelectorAll('[data-pf]').forEach((c) => { c.classList.toggle('on', c.dataset.pf === f); c.setAttribute('aria-pressed', String(c.dataset.pf === f)); }); redraw(); }));
    let t = 0;
    const qi = $('#pQ', el); if (qi) qi.oninput = () => { clearTimeout(t); t = setTimeout(() => { q = qi.value.trim(); redraw(); }, 150); };
    wire();
    const free = $('#pFree', el);
    const addFree = async () => { const v = free.value.trim(); if (!v) { free.focus(); return; } $('#pAdd', el).disabled = true; close(); await planAdd({ day, text: v }); };
    $('#pAdd', el).onclick = addFree;
    free.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addFree(); } };
  });
}
/** The summary's "להוסיף לרשימה": the card (as "לתכנן את השבוע" had), every line saying which dish it is for. */
async function weekCard(btn) {
  btn.disabled = true;
  try {
    const r = await api('POST', '/api/plan', { op: 'card' });
    btn.disabled = false;
    if (!r.proposal) { await refresh(); return; }
    const skip = new Set();
    sheet(`<h2>${esc(weekMissText(r.proposal.lines.length))}</h2>${coupon(r.proposal, -1)}`, (el, close) => {
      const c = el.querySelector('.coupon');
      c.querySelectorAll('li .tick').forEach((b) => (b.onclick = () => { const li = b.closest('li'); const j = +li.dataset.j; if (skip.has(j)) { skip.delete(j); li.classList.remove('off'); b.innerHTML = SMALL_TICK; } else { skip.add(j); li.classList.add('off'); b.innerHTML = ''; } b.setAttribute('aria-pressed', String(!li.classList.contains('off'))); }));
      c.querySelectorAll('[data-do]').forEach((b) => (b.onclick = async () => {
        c.querySelectorAll('button').forEach((y) => (y.disabled = true));
        try {
          const a = await api('POST', `/api/proposals/${r.proposal.id}/${b.dataset.do}`, { skip: [...skip] });
          close();
          if (a.status === 'applied' && !a.skipped && !a.nothing) { const k = r.proposal.lines.length - skip.size; toast(k === 1 ? 'הוספתי לרשימה מוצר אחד' : `הוספתי לרשימה ${k} מוצרים`); feel('approved'); }
          refresh();
        } catch (x_) { toast(x_.offline ? 'אין קליטה' : x_.message); c.querySelectorAll('button').forEach((y) => (y.disabled = false)); }
      }));
    });
  } catch (e) { btn.disabled = false; toast(e.offline ? 'אין קליטה' : e.message); }
}
