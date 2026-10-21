// Stage 0: counts the tokens of a request the server built (saved by tools/measure-capture.sh), part by part, with
// Anthropic's count_tokens endpoint (free, no model run). The key is read from .measure.env and never printed.
// Run: node tools/measure-count.mjs /tmp/shuki-measure/out/request-1.json
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.measure.env', import.meta.url), 'utf8');
const key = /^\s*ANTHROPIC_API_KEY\s*=\s*(\S+)/m.exec(env)?.[1];
if (!key) { console.log('no ANTHROPIC_API_KEY in .measure.env'); process.exit(1); }
const req = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const X = [{ role: 'user', content: 'x' }]; // count_tokens needs a message: the smallest one, the same in every count

async function count(body) {
  const r = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: req.model, ...body }),
  });
  const data = await r.json().catch(() => ({}));
  // on an error: the status and the error type only (the message may echo request details)
  if (!r.ok) { console.log(`count_tokens: ${r.status} ${data?.error?.type || ''}`); process.exit(1); }
  return data.input_tokens;
}

const base = { tools: req.tools, tool_choice: req.tool_choice };
const tools = await count({ ...base, messages: X });
const instr = await count({ ...base, system: req.system.slice(0, 1), messages: X });
const block = await count({ ...base, system: req.system, messages: X });
const full = await count({ ...base, system: req.system, messages: req.messages });
console.log(JSON.stringify({ model: req.model, tools_and_tool_prompt: tools, instructions: instr - tools, variable_block: block - instr, history_and_message: full - block, total: full }));
