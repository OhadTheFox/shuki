// Shuki as an MCP server (decision 145): another assistant (Claude, ChatGPT, anything that speaks MCP) can ask
// what's at home, add to the list, say something ran out or was bought, and talk to Shuki, for one person.
// Each person makes a secret address in settings (/mcp/<token>); only its hash is kept, and it can be cut off.
// Plain actions are carried out at once, like the app's own screens, and can be undone. What Shuki proposes
// from a free message waits for approval in the app, as always.
import { execute } from './store.js';
import { norm, describe, STORE_NAMES } from './domain.js';

export const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_ITEMS = 20;

export const TOOLS = [
  {
    name: 'whats_at_home',
    description: "What the household has at home, from Shuki's inventory (names are in Hebrew). Optionally only what matches a word, e.g. 'חלב'.",
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'A product name or part of it, in Hebrew. Empty = everything.' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'shopping_list',
    description: "The household's shopping list: what still needs buying, by store.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add_to_list',
    description: 'Add things to the shopping list, now, in the name of the person this connection belongs to. Use the Hebrew product names.',
    inputSchema: { type: 'object', properties: { items: { type: 'array', maxItems: MAX_ITEMS, items: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'number' } }, required: ['name'] } } }, required: ['items'] },
  },
  {
    name: 'ran_out',
    description: 'Something ran out at home: it is marked as gone, and regular items go on the list by themselves.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'The product, in Hebrew' } }, required: ['name'] },
  },
  {
    name: 'bought',
    description: 'Something was bought: the stock goes up and it leaves the list.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'number', description: 'How many (packs for packed things). Default 1.' } }, required: ['name'] },
  },
  {
    name: 'ask_shuki',
    description: "Send Shuki a free message in Hebrew, as this person would in the app's chat (questions, recipes, \"we're hosting on Friday\"...). Shuki answers; if he proposes changes, they wait for approval in the Shuki app.",
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  },
];

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError && { isError: true }) });

/** The product a name means: exact, then an alias, then the only one that contains it. Several = ask which. */
function findProduct(products, name) {
  const n = norm(name).replace(/^ה(?=\S{2})/, '');
  const live = products.filter((p) => !p.deleted);
  const exact = live.filter((p) => norm(p.name) === n || norm(p.name) === norm(name));
  if (exact.length === 1) return { p: exact[0] };
  const alias = live.filter((p) => (Array.isArray(p.aliases) ? p.aliases : JSON.parse(p.aliases || '[]')).some((a) => norm(a) === n));
  if (alias.length === 1) return { p: alias[0] };
  const part = live.filter((p) => norm(p.name).split(' ').includes(n) || norm(p.name).startsWith(`${n} `));
  if (part.length === 1) return { p: part[0] };
  if (part.length > 1) return { several: part.map((p) => p.name) };
  return {};
}

/** One JSON-RPC message → its answer (null for a notification). `ctx`: { env, user, via, state, chat } */
export async function handleRpc(msg, ctx) {
  const { id, method } = msg || {};
  const params = msg?.params && typeof msg.params === 'object' ? msg.params : {}; // "params": null used to throw (A-12)
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'Invalid request');
  if (id === undefined) return null; // notifications (initialized, cancelled): nothing to answer
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: MCP_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : MCP_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'shuki', title: 'Shuki', version: ctx.version || '0' },
        instructions: `Shuki manages the home inventory and shopping list of a Hebrew-speaking household. This connection acts for ${ctx.user.name}. Product names are Hebrew; answer the user in their language.`,
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      try { return reply(await callTool(params.name, params.arguments || {}, ctx)); }
      catch (e) { return reply(text(/[֐-׿]/.test(e.message || '') ? e.message : 'Something went wrong in Shuki.', true)); }
    }
    default: return fail(-32601, `Unknown method: ${method}`);
  }
}

async function callTool(name, args, { env, user, via, connector, state, chat }) {
  const who = { ...user, name: `${user.name} (דרך ${via})` }; // the log says where it came from
  const products = state.products;
  switch (name) {
    case 'whats_at_home': {
      const q = norm(args.query || '');
      const list = products.filter((p) => !p.deleted && (!q || norm(p.name).includes(q) || (p.aliases || []).some((a) => norm(a).includes(q))));
      if (!list.length) return text(q ? `לא רשום אצלי שום דבר בשם "${args.query}".` : 'המלאי עוד ריק.');
      const place = (p) => state.locations.find((l) => l.id === p.location_id)?.name;
      return text(list.slice(0, 200).map((p) => `${p.name}: ${describe(p)}${place(p) ? ` (${place(p)})` : ''}`).join('\n'));
    }
    case 'shopping_list': {
      const open = state.list.filter((i) => i.status === 'open' && i.approved !== 0);
      if (!open.length) return text('הרשימה ריקה.');
      const by = new Map();
      for (const i of open) {
        const n = i.product_id ? products.find((p) => p.id === i.product_id)?.name : i.text;
        const k = STORE_NAMES[i.store] || (state.stores.find((s) => s.id === i.store)?.name) || i.store;
        (by.get(k) || by.set(k, []).get(k)).push(`${n}${i.want ? ` × ${i.want}${i.want_unit ? ` ${i.want_unit}` : ''}` : ''}${i.ordered ? ' (הוזמן)' : ''}`);
      }
      return text([...by].map(([k, xs]) => `${k}:\n${xs.map((x) => `• ${x}`).join('\n')}`).join('\n\n'));
    }
    case 'add_to_list': {
      const items = (Array.isArray(args.items) ? args.items : []).slice(0, MAX_ITEMS).filter((x) => String(x?.name || '').trim());
      if (!items.length) return text('מה להוסיף?', true);
      const actions = items.map((x) => {
        const { p } = findProduct(products, x.name);
        const amount = Number(x.amount) > 0 ? Number(x.amount) : undefined;
        return p ? { kind: 'list_add', product_id: p.id, amount } : { kind: 'list_add', text: String(x.name).trim().slice(0, 80), amount };
      });
      const r = await execute(env, who, actions);
      return text(r.summary ? `הוספתי לרשימה. ${r.summary}` : r.privateEventId || r.privateDone ? 'הוספתי לרשימה.' : 'כבר ברשימה.'); // a private line has no summary for others (0b); the words exist
    }
    case 'ran_out':
    case 'bought': {
      const f = findProduct(products, args.name);
      if (f.several) return text(`יש כמה כאלה: ${f.several.join(', ')}. איזה מהם?`, true);
      const amount = Math.max(1, Number(args.amount) || 1);
      const action = f.p
        ? { kind: 'op', product_id: f.p.id, op: name === 'ran_out' ? { type: 'out' } : { type: 'purchase', amount } }
        : name === 'ran_out'
          ? { kind: 'create', product: { name: String(args.name).trim().slice(0, 80), count_type: 'units', qty: 0 }, reported: true }
          : { kind: 'create', product: { name: String(args.name).trim().slice(0, 80), count_type: 'units', qty: amount }, bought: true };
      const r = await execute(env, who, [action]);
      return text(r.summary || 'עדכנתי.');
    }
    case 'ask_shuki': {
      const message = String(args.message || '').trim().slice(0, 2000);
      if (!message) return text('ההודעה ריקה.', true);
      const out = await chat(env, user, { text: message, via: 'mcp', connector }, state); // write:turn
      if (out.error) return text(/[\u0590-\u05FF]/.test(out.error) ? out.error : 'לא הצלחתי לענות כרגע. אפשר לנסות שוב עוד רגע.', true);
      const lines = out.proposal?.lines?.map((l) => `• ${l.text}`).join('\n');
      return text(`${out.reply}${out.options?.length ? `\n(${out.options.join(' / ')})` : ''}${lines ? `\n\nמחכה לאישור באפליקציה שלי:\n${lines}` : ''}`);
    }
    default: return text(`Unknown tool: ${name}`, true);
  }
}
