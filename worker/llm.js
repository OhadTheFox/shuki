// The model behind Shuki: Claude (Anthropic) or ChatGPT (OpenAI), chosen by the key the admin enters (decision 111).
// Everything above this file speaks Anthropic's message shape (system blocks, tool_use / tool_result);
// for OpenAI the request and the answer are translated here, so the rest of the code doesn't care.

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const OPENAI = 'https://api.openai.com/v1/chat/completions';

export const PROVIDERS = {
  anthropic: { label: 'Claude', model: 'claude-sonnet-5', price: { in: 2, out: 10 } },
  openai: { label: 'ChatGPT', model: 'gpt-5.6-terra', price: { in: 2, out: 12 } },
};

/** "sk-ant-..." is Anthropic's; any other "sk-..." is OpenAI's. */
export function providerOfKey(key) {
  const k = String(key || '').trim();
  if (/^sk-ant-[\w-]{20,}$/.test(k)) return 'anthropic';
  if (/^sk-[\w-]{20,}$/.test(k)) return 'openai';
  return null;
}

export const providerOf = (env) => (env.PROVIDER === 'openai' ? 'openai' : 'anthropic');
export const llmKey = (env) => (providerOf(env) === 'openai' ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY);
export const modelOf = (env) => (providerOf(env) === 'openai' ? env.OPENAI_MODEL : env.MODEL) || PROVIDERS[providerOf(env)].model;

/** Dollars for one call, in millionths (what the monthly cost adds up). */
export function costMicro(env, usage) {
  const p = PROVIDERS[providerOf(env)].price;
  const pin = Number(env.PRICE_IN || p.in), pout = Number(env.PRICE_OUT || p.out);
  const input = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) * 1.25 + (usage?.cache_read_input_tokens || 0) * 0.1;
  return Math.round(input * pin + (usage?.output_tokens || 0) * pout);
}

/**
 * One forced tool call. Returns { out: the tool's input, usage (Anthropic's names), use: the tool_use block }.
 * Errors read "model <status>: ..." ("credit balance" when the account is out of money), for chat() to explain.
 */
// a provider that hangs doesn't keep the request open forever (review, R-4): a minute, then "timed out"
const modelTimeout = (env) => Number(env.MODEL_TIMEOUT_MS) || 60000;
export async function callModel(env, system, messages, tool) {
  // a busy moment at the provider (overloaded, rate limit, a gateway error) is tried again twice before giving up
  for (let i = 0; ; i++) {
    try { return await (providerOf(env) === 'openai' ? callOpenAI(env, system, messages, tool) : callAnthropic(env, system, messages, tool)); }
    catch (e) {
      if (i >= 2 || !/model (429|500|502|503|504|529)|fetch failed|network/i.test(e.message) || /credit balance|insufficient_quota|billing/i.test(e.message)) throw e; // no credit isn't busy
      await new Promise((r) => setTimeout(r, env.RETRY_MS ? Number(env.RETRY_MS) : 1500 * (i + 1) ** 2));
    }
  }
}

async function callAnthropic(env, system, messages, tool) {
  const res = await fetch(env.ANTHROPIC_URL || ANTHROPIC, {
    method: 'POST',
    signal: AbortSignal.timeout(modelTimeout(env)),
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelOf(env), max_tokens: 4096, system, tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages }),
  });
  if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const use = data.content.find((c) => c.type === 'tool_use');
  return { out: use?.input || null, usage: data.usage, use };
}

/** Anthropic-shaped messages → OpenAI chat messages (images as data URLs, tool calls and results as their own turns). */
export function toOpenAI(system, messages) {
  const sys = Array.isArray(system) ? system.map((b) => b.text).join('\n\n') : String(system || '');
  const out = [{ role: 'system', content: sys }];
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    const calls = m.content.filter((c) => c.type === 'tool_use');
    if (m.role === 'assistant' && calls.length) {
      out.push({ role: 'assistant', content: null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) });
      continue;
    }
    for (const r of m.content.filter((c) => c.type === 'tool_result')) out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content) });
    const parts = m.content.filter((c) => c.type === 'text' || c.type === 'image').map((c) => (c.type === 'text'
      ? { type: 'text', text: c.text }
      : { type: 'image_url', image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` } }));
    if (parts.length) out.push({ role: m.role, content: parts });
  }
  return out;
}

/**
 * The newer reasoning models refuse function tools on chat/completions unless reasoning is off (found on the real API,
 * 30/09: "Function tools with reasoning_effort are not supported for gpt-5.6-terra … set reasoning_effort to 'none'").
 * gpt-5.1 and later take 'none'; gpt-5 itself only goes down to 'minimal'; older models don't know the field.
 */
export function reasoningFor(model) {
  if (/^gpt-5\.\d/.test(model)) return 'none';
  if (/^gpt-5(-|$)/.test(model) && !/chat/.test(model)) return 'minimal';
  return undefined;
}
async function callOpenAI(env, system, messages, tool) {
  const model = modelOf(env);
  const send = (effort) => fetch(env.OPENAI_URL || OPENAI, {
    method: 'POST',
    signal: AbortSignal.timeout(modelTimeout(env)),
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_completion_tokens: 4096,
      ...(effort && { reasoning_effort: effort }),
      messages: toOpenAI(system, messages),
      tools: [{ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }],
      tool_choice: { type: 'function', function: { name: tool.name } },
    }),
  });
  const effort = reasoningFor(model);
  let res = await send(effort);
  // a model we guessed wrong about: once more with the other setting (a new model name, or one that dropped the field)
  if (res.status === 400) {
    const t = await res.clone().text();
    if (/reasoning_effort/.test(t)) res = await send(effort ? undefined : 'none');
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`model ${res.status}: ${/insufficient_quota|billing/i.test(t) ? 'credit balance too low. ' : ''}${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  let input = null;
  try { input = call ? JSON.parse(call.function.arguments) : null; } catch { /* broken JSON: treated as no answer */ }
  const u = data.usage || {};
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  return {
    out: input,
    usage: { input_tokens: (u.prompt_tokens || 0) - cached, cache_read_input_tokens: cached, output_tokens: u.completion_tokens || 0 },
    use: call && { type: 'tool_use', id: call.id, name: call.function.name, input: input || {} },
  };
}

/** Does this key work? Anthropic: one tiny call. OpenAI: the model list (no tokens spent). */
export async function testKey(env, key, provider = providerOfKey(key)) {
  if (!provider) return { ok: false, error: 'זה לא נראה כמו מפתח של Claude (sk-ant-...) או של ChatGPT (sk-...)' };
  try {
    if (provider === 'openai') {
      const res = await fetch(String(env.OPENAI_URL || OPENAI).replace(/chat\/completions$/, 'models'), { headers: { authorization: `Bearer ${key}` } });
      if (res.ok) return { ok: true, provider };
      if (res.status === 401) return { ok: false, error: 'המפתח לא תקין' };
      return { ok: false, error: 'ChatGPT לא ענה כמו שצריך. אפשר לנסות שוב עוד רגע' };
    }
    const res = await fetch(env.ANTHROPIC_URL || ANTHROPIC, { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: env.MODEL || PROVIDERS.anthropic.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }) });
    if (res.ok) return { ok: true, provider };
    const t = await res.text();
    if (res.status === 401) return { ok: false, error: 'המפתח לא תקין' };
    if (/credit balance/i.test(t)) return { ok: false, error: 'המפתח תקין, אבל אין בחשבון קרדיט' };
    if (/workspace/i.test(t)) return { ok: false, error: 'המפתח לא שייך לסביבת עבודה (Workspace). יוצרים מפתח מתוך סביבת עבודה בקונסולה של Anthropic' };
    return { ok: false, error: 'Claude לא ענה כמו שצריך. אפשר לנסות שוב עוד רגע' };
  } catch { return { ok: false, error: 'לא הצלחתי להגיע ל-' + (provider === 'openai' ? 'ChatGPT' : 'Claude') + '. אפשר לנסות שוב עוד רגע' }; }
}
