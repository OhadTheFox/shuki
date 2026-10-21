// Finds every function in worker/ that writes to the database, directly (INSERT / UPDATE / DELETE / REPLACE) or through
// another such function, and every line of chat(), chatTurn() and applyProposal() that writes or calls one (the owner 04/10).
// A call is to a function defined in the same file or imported into it; a local of the same name hides it.
import { readFileSync, readdirSync } from 'node:fs';

const WRITE_SQL = /\b(INSERT|UPDATE|DELETE|REPLACE)\b/;
const DECL = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(.*?\)|[A-Za-z_$][\w$]*)\s*=>|^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/;
const code = (line) => line; // lines come with their comments already blanked (lex below)

/**
 * A small lexer: the file with every comment blanked (strings and regexes kept, so SQL stays visible), and for each line
 * whether it starts inside a template literal's text (where a line at column 0 isn't a new statement).
 */
export function lex(src) {
  const out = src.split(''), inTplAt = [true === false];
  let i = 0, line = 0, prev = '';
  const stack = []; // 'tpl' (in a template's text) or 'expr' (in its ${...}), with brace depth for expr
  const mark = () => { inTplAt[line] = stack.at(-1)?.t === 'tpl'; };
  mark();
  const nl = () => { line++; mark(); };
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i], top = stack.at(-1);
    if (c === '\n') { nl(); i++; continue; }
    if (top?.t === 'tpl') { // template text
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i++; prev = '`'; continue; }
      if (c === '$' && src[i + 1] === '{') { stack.push({ t: 'expr', d: 0 }); i += 2; prev = '{'; continue; }
      i++; continue;
    }
    if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); const e = j < 0 ? src.length : j; blank(i, e); i = e; continue; }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; for (let k = i; k < e; k++) if (src[k] === '\n') nl(); blank(i, e); i = e; continue; }
    if (c === "'" || c === '"') { let j = i + 1; while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1; i = j + 1; prev = c; continue; }
    if (c === '`') { stack.push({ t: 'tpl' }); i++; continue; }
    if (c === '/' && (!prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /\b(return|typeof|case|in|of)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) { // a regex
      let j = i + 1, cls = false;
      while (j < src.length && src[j] !== '\n' && (cls || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
      i = j + 1; while (/[a-z]/.test(src[i] || '')) i++; prev = 'a'; continue;
    }
    if (top?.t === 'expr') { if (c === '{') top.d++; else if (c === '}') { if (top.d === 0) { stack.pop(); i++; prev = '`'; continue; } top.d--; } }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { text: out.join('').split('\n'), inTplAt };
}
const calls = (line, name) => new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}\\(`).test(code(line));

/** Every top-level function of worker/*.js: { key, name, file, start, lines, locals }, and each file's visible names. */
export function functions(dir = 'worker') {
  const fns = [], visible = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(`${dir}/${file}`, 'utf8'), { text: lines, inTplAt } = lex(src), rawLines = src.split('\n');
    const names = (visible[file] = new Map()); // name here -> key (file:name)
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([\w.-]+)'/g)) for (const part of m[1].split(',')) {
      const [orig, alias] = part.trim().split(/\s+as\s+/); if (orig) names.set((alias || orig).trim(), `${m[2]}:${orig.trim()}`);
    }
    let cur = null; // inside a template literal, a line at column 0 is text, not a new statement
    lines.forEach((line, i) => {
      const inTpl = inTplAt[i];
      const m = !inTpl && DECL.exec(line);
      if (m) { cur = { name: m[1] || m[2] || m[3], file, start: i + 1, lines: [], raw: [] }; cur.key = `${file}:${cur.name}`; names.set(cur.name, cur.key); fns.push(cur); }
      else if (!inTpl && /^\S/.test(line) && !/^[}\])]/.test(line)) cur = null; // another top-level statement
      if (cur) { cur.lines.push(line); cur.raw.push(rawLines[i]); }
    });
  }
  // a local function of the same name hides it (a local that isn't a function can't be called)
  for (const f of fns) f.locals = new Set(f.lines.slice(1).flatMap((l) => [...code(l).matchAll(/(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(.*?\)|[A-Za-z_$][\w$]*)\s*=>|function\s+([A-Za-z_$][\w$]*))/g)].map((m) => m[1] || m[2])));
  return { fns, visible };
}

/** A function's body: its lines, the first one from its "{" or "=>" (a one-line function has its body there too). */
const body = (f) => [f.lines[0].replace(/^[^{]*?(\{|=>)/, ''), ...f.lines.slice(1)];
/** The functions f calls that are top-level functions (keys), not hidden by its locals. */
const callees = (f, visible) => [...visible[f.file]].filter(([n]) => !f.locals.has(n) && body(f).some((l) => calls(l, n)));

/** The keys of the functions that write, directly or through another that does. */
export function writers({ fns, visible } = functions()) {
  const w = new Set(fns.filter((f) => f.lines.some((l) => WRITE_SQL.test(code(l)))).map((f) => f.key));
  for (let changed = true; changed;) {
    changed = false;
    for (const f of fns) if (!w.has(f.key) && callees(f, visible).some(([, k]) => w.has(k))) { w.add(f.key); changed = true; }
  }
  return w;
}

/** The lines of the turn's functions that write or call a writer, with their mark (// write:<name>) or null. */
export function writeLines(targets = ['chat', 'chatTurn', 'applyProposal'], file = 'shuki.js') {
  const all = functions(), w = writers(all);
  const out = [];
  for (const f of all.fns.filter((x) => x.file === file && targets.includes(x.name))) {
    const ws = [...all.visible[f.file]].filter(([n, k]) => w.has(k) && !f.locals.has(n) && n !== f.name);
    f.lines.forEach((l, i) => {
      if (i === 0) return;
      const hit = ws.filter(([n]) => calls(l, n)).map(([n]) => n);
      if (!WRITE_SQL.test(code(l)) && !hit.length) return;
      out.push({ fn: f.name, line: f.start + i, calls: hit, mark: (f.raw[i].match(/\/\/.*?\bwrite:([a-z_]+)/) || [])[1] || null, text: f.raw[i].trim().slice(0, 120) });
    });
  }
  return out;
}

/** The routes that run a chat turn, or what comes after a card is approved: a block from its first line to its "}". */
export const ROUTES = [
  { file: 'index.js', start: "if (path === '/api/chat' && req.method === 'POST') {" },
  { file: 'index.js', start: "if (path === '/api/say' && req.method === 'POST') {" },
  { file: 'index.js', start: 'const pm = /^\\/api\\/proposals\\/([\\w-]+)\\/(apply|reject)$/.exec(path);', end: 'return json(r);' },
  { file: 'mcp.js', start: "case 'ask_shuki': {" },
];
/** The lines of each route that write or call a writer, as writeLines() does for the functions. */
export function routeLines(routes = ROUTES, dir = 'worker') {
  const all = functions(dir), w = writers(all);
  const out = [];
  for (const r of routes) {
    const raw = readFileSync(`${dir}/${r.file}`, 'utf8'), lines = lex(raw).text, rawLines = raw.split('\n');
    const i0 = rawLines.findIndex((l) => l.includes(r.start));
    if (i0 < 0) throw new Error(`route not found: ${r.file} ${r.start}`);
    // to the "}" that closes the block (or to the line `end`); strings and comments don't count
    let depth = 0, i = i0;
    for (; i < lines.length; i++) {
      if (r.end && rawLines[i].includes(r.end)) break;
      const c = code(lines[i]).replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
      depth += (c.match(/\{/g) || []).length - (c.match(/\}/g) || []).length;
      if (!r.end && i > i0 && depth <= 0) break;
    }
    // a writer passed in (ctx.chat in mcp.js) isn't imported: a name that's a writer somewhere in worker/ counts too
    const visible = all.visible[r.file];
    const ws = [...visible].filter(([, k]) => w.has(k));
    for (const k of w) { const n = k.split(':')[1]; if (!visible.has(n)) ws.push([n, k]); }
    for (let j = i0 + 1; j <= i; j++) {
      const l = lines[j];
      const hit = ws.filter(([n]) => calls(l, n)).map(([n]) => n);
      if (!WRITE_SQL.test(code(l)) && !hit.length) continue;
      out.push({ fn: `${r.file} ${r.start.slice(0, 40)}`, file: r.file, line: j + 1, calls: hit, mark: (rawLines[j].match(/\/\/.*?\bwrite:([a-z_]+)/) || [])[1] || null, text: rawLines[j].trim().slice(0, 120) });
    }
  }
  return out;
}

/** What the scan can't follow (the owner 04/10): every SQL line that writes outside a function it knows, and a default export,
 * `import *` or a dynamic import, anywhere in worker/. */
export function blindSpots(dir = 'worker') {
  const { fns } = functions(dir);
  const covered = new Set(fns.flatMap((f) => f.lines.map((_, i) => `${f.file}:${f.start + i}`)));
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const raw = readFileSync(`${dir}/${file}`, 'utf8').split('\n');
    lex(raw.join('\n')).text.forEach((c, i) => {
      const l = raw[i];
      if (WRITE_SQL.test(c) && !covered.has(`${file}:${i + 1}`)) out.push(`${file}:${i + 1} SQL outside a known function: ${l.trim().slice(0, 80)}`);
      if (/^\s*export\s+default\b/.test(c)) out.push(`${file}:${i + 1} export default`);
      if (/\bimport\s*\*/.test(c)) out.push(`${file}:${i + 1} import *`);
      if (/\bimport\s*\(/.test(c)) out.push(`${file}:${i + 1} import()`);
    });
  }
  return out;
}
