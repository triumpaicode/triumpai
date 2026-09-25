/* TRIUMP AI — Studio (AI generator), TriumpCode Web, TriumpCode CLI, paket & kuota.

   Studio         POST /api/studio/generate  {id?, prompt}  -> SSE (HTML satu file)
                  GET  /api/studio/list | /api/studio/get?id= ; POST /api/studio/delete {id}
   TriumpCode web POST /api/code/new {name} ; GET /api/code/list | /api/code/get?id=
                  POST /api/code/chat {id, message} -> SSE (agent + tool file virtual)
                  POST /api/code/save-file | /api/code/delete-file | /api/code/delete
                  GET  /api/code/zip?id=
   TriumpCode CLI POST /api/cli/device/start ; GET /api/cli/device/poll?device_code=
                  POST /api/cli/device/approve {user_code} (butuh sesi web)
                  GET  /api/cli/me ; POST /api/cli/turn {messages} -> SSE  (Bearer token)
   Paket          GET  /api/plan ; POST /api/plan/check-holder
   Preview        GET  /preview/s/<id>            hasil Studio
                  GET  /preview/c/<id>/<path>     file project TriumpCode
   Preview selalu dikirim dengan header CSP `sandbox` (origin unik), jadi kode buatan
   AI tidak bisa membaca cookie login situs ini.                                        */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir, rename, readdir, unlink } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join, resolve, posix } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { makeZip } from './zip.ts';

type User = { id: string; email?: string; wallet?: string; x?: { username: string }; proUntil?: number; holderCheckedAt?: number };
export type Ctx = {
  currentUser: (req: IncomingMessage) => { user: User } | null;
  send: (res: ServerResponse, code: number, body: unknown, headers?: Record<string, string>) => void;
  body: (req: IncomingMessage, limit?: number) => Promise<Record<string, unknown>>;
  saveUsers: () => Promise<void>;
  users: Record<string, User>;
  limited: (key: string, limit: number, windowSec: number) => boolean;
  clientIp: (req: IncomingMessage) => string;
  siteUrl: string;
};

const DATA = resolve(import.meta.dirname, '..', 'data');
const PUBLIC = resolve(import.meta.dirname, '..', 'public');
const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const num = (k: string, d: number) => Number(env(k)) || d;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const newId = (n = 12) => randomBytes(n).toString('base64url');
const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- simpan JSON ---------------- */
async function loadJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return fallback; }
}
const queue = new Map<string, Promise<void>>();
function saveJson(file: string, data: unknown) {
  const next = (queue.get(file) ?? Promise.resolve()).then(async () => {
    await mkdir(resolve(file, '..'), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await rename(tmp, file);
  });
  queue.set(file, next.catch(() => {}));
  return next;
}

/* ================= paket & kuota ================= */
const LIMITS = {
  free: { studio: num('FREE_STUDIO_PER_DAY', 5), code: num('FREE_CODE_PER_DAY', 20) },
  // "Unlimited" untuk holder: batas ini hanya rem darurat terhadap penyalahgunaan (fair use)
  pro: { studio: num('PRO_STUDIO_PER_DAY', 1000), code: num('PRO_CODE_PER_DAY', 3000) },
};
const PRO_DAYS = num('HOLDER_PRO_DAYS', 90);
type Usage = Record<string, { day: string; studio: number; code: number }>;
const USAGE_FILE = join(DATA, 'usage.json');
const usage = await loadJson<Usage>(USAGE_FILE, {});

const isPro = (u: User) => (u.proUntil || 0) > Date.now();
function usageOf(u: User) {
  const r = usage[u.id];
  return r && r.day === today() ? r : { day: today(), studio: 0, code: 0 };
}
function planOf(u: User) {
  const lim = isPro(u) ? LIMITS.pro : LIMITS.free, used = usageOf(u);
  return {
    plan: isPro(u) ? 'pro' : 'free', proUntil: u.proUntil || null,
    used: { studio: used.studio, code: used.code }, limits: lim,
    left: { studio: Math.max(0, lim.studio - used.studio), code: Math.max(0, lim.code - used.code) },
  };
}
/** pakai 1 jatah; false kalau habis */
async function spend(u: User, kind: 'studio' | 'code') {
  const lim = (isPro(u) ? LIMITS.pro : LIMITS.free)[kind], r = usageOf(u);
  if (r[kind] >= lim) return false;
  r[kind]++; usage[u.id] = r;
  await saveJson(USAGE_FILE, usage);
  return true;
}
function quotaError(u: User, kind: 'studio' | 'code') {
  return isPro(u)
    ? `Fair-use limit reached for today. It resets at 00:00 UTC.`
    : `Free daily limit reached (${LIMITS.free[kind]}). Hold $TRIUMPAI on Robinhood Chain and sign in with that wallet to get 3 months unlimited.`;
}

/* ---------- cek holder: saldo token di Robinhood Chain ---------- */
const RPC = ['https://robinhood-rpc.publicnode.com', 'https://robinhood.drpc.org', 'https://rpc.mainnet.chain.robinhood.com'];
async function tokenCA(): Promise<string | null> {
  // satu sumber kebenaran: CA yang diisi owner di public/config.js
  const src = await readFile(join(PUBLIC, 'config.js'), 'utf8').catch(() => '');
  const m = src.match(/window\.TRIUMP_CA\s*=\s*["'](0x[0-9a-fA-F]{40})["']/);
  return m ? m[1] : null;
}
async function ethCall(to: string, data: string): Promise<string> {
  let last: unknown;
  for (const url of RPC) {
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
        signal: AbortSignal.timeout(8000),
      });
      const j: any = await r.json();
      if (j.result) return j.result;
      last = j.error;
    } catch (e) { last = e; }
  }
  throw new Error('RPC unreachable: ' + String((last as any)?.message || last));
}
async function holderBalance(ca: string, wallet: string) {
  const bal = BigInt(await ethCall(ca, '0x70a08231' + wallet.slice(2).toLowerCase().padStart(64, '0')));
  let dec = 18;
  try { dec = Number(BigInt(await ethCall(ca, '0x313ce567'))); } catch {}
  return { bal, dec };
}

async function checkHolder(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const me = ctx.currentUser(req);
  if (!me) return ctx.send(res, 401, { ok: false, error: 'Sign in first.' });
  const u = me.user;
  if (!u.wallet) return ctx.send(res, 400, { ok: false, error: 'Link the wallet that holds the token first.' });
  if (ctx.limited('holder:' + u.id, 6, 600)) return ctx.send(res, 429, { ok: false, error: 'Too many checks. Try again in a few minutes.' });
  const ca = await tokenCA();
  if (!ca) return ctx.send(res, 200, { ok: true, holder: false, live: false, message: 'The token is not live yet. Come back after launch.', ...planOf(u) });
  try {
    const { bal, dec } = await holderBalance(ca, u.wallet);
    const min = BigInt(Math.round(num('HOLDER_MIN_TOKENS', 1) * 1e6)) * 10n ** BigInt(dec) / 1_000_000n;
    const holder = bal >= min && bal > 0n;
    u.holderCheckedAt = Date.now();
    // 3 bulan gratis diberikan sekali, saat pertama kali terbukti holder
    if (holder && !u.proUntil) u.proUntil = Date.now() + PRO_DAYS * 86400_000;
    await ctx.saveUsers();
    ctx.send(res, 200, {
      ok: true, holder, live: true,
      message: holder ? (isPro(u) ? 'Holder verified — unlimited is active for 3 months.' : 'Holder verified, but your 3 unlimited months have ended.') : 'No $TRIUMPAI found in this wallet yet.',
      ...planOf(u),
    });
  } catch (e: any) {
    ctx.send(res, 502, { ok: false, error: 'Could not reach Robinhood Chain. Try again shortly.' });
  }
}

/* ================= Claude ================= */
const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') || 'missing', maxRetries: 2 });
const MODEL = {
  studio: env('STUDIO_MODEL', 'claude-opus-5'),
  code: env('CODE_MODEL', 'claude-opus-5'),
};
const hasKey = () => !!env('ANTHROPIC_API_KEY');
/* Fallback server-side: kalau model menolak (refusal), API menjalankan ulang di model
   pengganti yang direkomendasikan Anthropic. Hanya untuk model yang mendukungnya. */
const FALLBACK_MODELS = /^claude-(opus-5$|fable-5-1$)/;

type StreamOpts = {
  model: string; system: string; messages: any[]; tools?: any[]; effort: 'low' | 'medium' | 'high' | 'xhigh';
  onText?: (t: string) => void; onToolStart?: (name: string) => void; onThinking?: (t: string) => void; signal?: AbortSignal;
};
/** satu giliran model (streaming) -> pesan final */
async function streamTurn(o: StreamOpts): Promise<Anthropic.Beta.BetaMessage> {
  const params: any = {
    model: o.model, max_tokens: 64000, system: o.system, messages: o.messages,
    output_config: { effort: o.effort },
    // ringkasan pemikiran ditampilkan ke pengguna supaya jeda sebelum jawaban tidak terasa macet
    thinking: { type: 'adaptive', display: 'summarized' },
    cache_control: { type: 'ephemeral' },
    ...(o.tools ? { tools: o.tools } : {}),
  };
  if (FALLBACK_MODELS.test(o.model)) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
  const stream = client.beta.messages.stream(params, { signal: o.signal });
  if (o.onText) stream.on('text', o.onText);
  stream.on('streamEvent', (ev: any) => {
    if (o.onToolStart && ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') o.onToolStart(ev.content_block.name);
    if (o.onThinking && ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta' && ev.delta.thinking) o.onThinking(ev.delta.thinking);
  });
  return await stream.finalMessage();
}
function apiErrorText(e: unknown) {
  // saldo API habis / akun bermasalah: jangan tampilkan detail billing ke pengunjung
  if (e instanceof Anthropic.APIError && /credit balance|billing|quota/i.test(String((e as any).message))) {
    console.error('[ai] SALDO API HABIS — isi kredit di console.anthropic.com');
    return 'TRIUMP AI is temporarily unavailable. Please try again a little later.';
  }
  if (e instanceof Anthropic.RateLimitError) return 'The AI is busy right now. Please retry in a moment.';
  if (e instanceof Anthropic.AuthenticationError) return 'AI is not configured correctly on the server.';
  if (e instanceof Anthropic.BadRequestError) return 'The AI rejected this request.';
  if (e instanceof Anthropic.APIUserAbortError) return 'Stopped.';
  if (e instanceof Anthropic.APIError) return `AI service error (${e.status ?? 'network'}).`;
  return 'Something went wrong while talking to the AI.';
}
const isApiError = (e: unknown) => e instanceof Anthropic.APIError;
/* API menolak blok teks kosong di riwayat; model kadang membuka blok teks lalu langsung
   memanggil tool. Buang blok itu sebelum disimpan / dikirim balik (blok thinking tetap utuh). */
const cleanContent = (content: any[]) => content.filter((b: any) => !(b?.type === 'text' && !String(b.text || '').trim()));

/* ---------------- SSE ---------------- */
function sse(req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  return {
    signal: ac.signal,
    emit: (ev: Record<string, unknown>) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); },
    end: () => { clearInterval(ping); if (!res.writableEnded) res.end(); },
  };
}

/* ================= STUDIO ================= */
type Design = { id: string; owner: string; title: string; createdAt: number; updatedAt: number; versions: { prompt: string; html: string; at: number }[] };
const STUDIO_DIR = join(DATA, 'studio');
/* karya galeri "Made with TRIUMP AI" ikut di repo (seed/studio); salin sekali kalau belum ada */
{
  const SEED = resolve(import.meta.dirname, '..', 'seed', 'studio');
  await mkdir(STUDIO_DIR, { recursive: true });
  for (const f of await readdir(SEED).catch(() => [] as string[])) {
    if (!f.endsWith('.json')) continue;
    const dest = join(STUDIO_DIR, f);
    try { await readFile(dest); } catch { await writeFile(dest, await readFile(join(SEED, f))); }
  }
}
const designFile = (id: string) => join(STUDIO_DIR, `${id.replace(/[^\w-]/g, '')}.json`);
const loadDesign = (id: string) => loadJson<Design | null>(designFile(id), null);

const STUDIO_SYSTEM = `You are TRIUMP AI Studio, a senior product designer and front-end engineer.
You turn a short description into a finished, production-quality design delivered as ONE self-contained HTML document: landing pages, app screens, dashboards, portfolios, posters, pitch slides, logos and brand boards, email templates, UI components, small interactive pieces.

Output rules:
- Reply with the HTML document only. Start with <!doctype html> and end with </html>. No markdown fences, no explanation before or after.
- Everything inline: CSS in <style>, JavaScript in <script>. The only external resources allowed are Google Fonts.
- No external images or stock photo URLs. Build visuals with inline SVG, CSS gradients, shapes and typography.
- Responsive from 360px phones to wide desktops, no horizontal scrolling. Accessible contrast and semantic HTML.
- Real, specific copy that fits the brief — never lorem ipsum. Match the language the user writes in for visible copy unless they ask otherwise.
- Aim for the craft of a top design studio: a clear visual idea, deliberate type scale, generous spacing, restrained palette, tasteful motion.

When a current document is provided, apply the requested change to it and return the complete updated document, keeping everything the user did not ask to change.`;

async function studioGenerate(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const me = ctx.currentUser(req);
  if (!me) return ctx.send(res, 401, { ok: false, error: 'Sign in to use Studio.' });
  if (!hasKey()) return ctx.send(res, 503, { ok: false, error: 'AI is not configured on the server yet.' });
  const b = await ctx.body(req);
  const prompt = String(b.prompt || '').trim().slice(0, 4000);
  if (!prompt) return ctx.send(res, 400, { ok: false, error: 'Describe what you want to design.' });
  let d: Design | null = null;
  if (b.id) {
    d = await loadDesign(String(b.id));
    if (!d || d.owner !== me.user.id) return ctx.send(res, 404, { ok: false, error: 'Design not found.' });
  }
  if (!(await spend(me.user, 'studio'))) return ctx.send(res, 429, { ok: false, error: quotaError(me.user, 'studio'), quota: true });

  const now = Date.now();
  d ||= { id: newId(9), owner: me.user.id, title: prompt.slice(0, 60), createdAt: now, updatedAt: now, versions: [] };
  const current = d.versions.at(-1)?.html;
  const out = sse(req, res);
  out.emit({ t: 'start', id: d.id, plan: planOf(me.user) });
  let html = '';
  try {
    const msg = await streamTurn({
      model: MODEL.studio, system: STUDIO_SYSTEM, effort: (env('STUDIO_EFFORT', 'medium') as any), signal: out.signal,
      onThinking: t => out.emit({ t: 'thinking', text: t }),
      messages: [{
        role: 'user',
        content: current
          ? `Current document:\n\n${current}\n\nChange request: ${prompt}`
          : `Design brief: ${prompt}`,
      }],
      onText: t => { html += t; out.emit({ t: 'delta', text: t }); },
    });
    if (msg.stop_reason === 'refusal') throw new Error('refused');
    html = extractHtml(html || msg.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''));
    if (!/<html[\s>]/i.test(html)) throw new Error('no-html');
    const title = (html.match(/<title>([^<]{1,80})<\/title>/i)?.[1] || d.title).trim();
    d.title = d.versions.length ? d.title : title;
    d.versions.push({ prompt, html, at: Date.now() });
    if (d.versions.length > 30) d.versions.splice(0, d.versions.length - 30);
    d.updatedAt = Date.now();
    await saveJson(designFile(d.id), d);
    out.emit({ t: 'done', id: d.id, title: d.title, version: d.versions.length, truncated: msg.stop_reason === 'max_tokens' });
  } catch (e: any) {
    if (e?.message !== 'refused' && e?.message !== 'no-html') console.error('[studio]', e?.status || '', e?.message || e);
    out.emit({ t: 'error', error: e?.message === 'refused' ? 'The AI declined this request. Try describing it differently.'
      : e?.message === 'no-html' ? 'The AI did not return a design. Please try again.' : apiErrorText(e) });
  }
  out.end();
}
function extractHtml(s: string) {
  s = s.trim().replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '');
  const i = s.search(/<!doctype html|<html[\s>]/i);
  const j = s.toLowerCase().lastIndexOf('</html>');
  return i >= 0 ? s.slice(i, j > i ? j + 7 : undefined) : s;
}
async function listOwned(dir: string, owner: string) {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: any[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const d: any = await loadJson(join(dir, n), null);
    if (d && d.owner === owner) out.push(d);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ================= TRIUMPCODE WEB ================= */
type Project = {
  id: string; owner: string; name: string; createdAt: number; updatedAt: number;
  files: Record<string, string>;
  messages: any[];                       // riwayat API (append-only)
  chat: { role: 'user' | 'assistant'; text: string; tools?: { name: string; path?: string; ok: boolean }[] }[];
  notes: string[];                       // edit manual user yang belum diketahui agent
};
const CODE_DIR = join(DATA, 'code');
const projFile = (id: string) => join(CODE_DIR, `${id.replace(/[^\w-]/g, '')}.json`);
const loadProject = (id: string) => loadJson<Project | null>(projFile(id), null);
const MAX_FILES = 200, MAX_FILE = 1_000_000, MAX_TOTAL = 6_000_000;

function cleanPath(p: unknown): string | null {
  let s = String(p ?? '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
  s = posix.normalize(s);
  if (!s || s === '.' || s.startsWith('..') || s.includes('\0') || s.length > 200) return null;
  return s;
}

const VFS_TOOLS = [
  { name: 'list_files', description: 'List every file in the project with its size in bytes.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read_file', description: 'Read the full text of one project file.', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Project-relative path, e.g. index.html or src/app.js' } }, required: ['path'], additionalProperties: false } },
  { name: 'write_file', description: 'Create a file or replace its whole content. Prefer edit_file for small changes to existing files.', eager_input_streaming: true,
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string', description: 'Complete file content' } }, required: ['path', 'content'], additionalProperties: false } },
  { name: 'edit_file', description: 'Replace an exact snippet in an existing file. old_string must match the file exactly and be unique unless replace_all is true.', eager_input_streaming: true,
    input_schema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_string', 'new_string'], additionalProperties: false } },
  { name: 'delete_file', description: 'Delete a project file.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
];

const CODE_WEB_SYSTEM = `You are TriumpCode, an expert software engineer building inside the TRIUMP AI browser workspace.
The project is a static web project: plain HTML, CSS and JavaScript files served from the project root, with index.html as the entry point that the user sees in a live preview next to this chat. There is no terminal, package manager or build step, so write code that runs directly in the browser; libraries may be loaded from cdn.jsdelivr.net or cdnjs.cloudflare.com and fonts from Google Fonts.

Work with the file tools: look at what exists before changing it, make focused edits with edit_file, and create new files with write_file. Keep code clean and organised across sensible files. When you finish, reply with a short summary of what changed and anything the user should know. Match the user's language in your replies.`;

type ToolOut = { content: string; is_error?: boolean; changed?: string };
function runVfsTool(p: Project, name: string, input: any): ToolOut {
  const total = () => Object.values(p.files).reduce((a, s) => a + s.length, 0);
  const bad = (m: string): ToolOut => ({ content: m, is_error: true });
  if (!input || typeof input !== 'object') return bad('INVALID_INPUT');
  if (name === 'list_files') {
    const list = Object.keys(p.files).sort().map(k => `${k} (${p.files[k].length} bytes)`);
    return { content: list.length ? list.join('\n') : '(empty project)' };
  }
  const path = cleanPath(input.path);
  if (!path) return bad('Invalid path. Use a project-relative path without "..".');
  if (name === 'read_file') {
    return path in p.files ? { content: p.files[path] || '(empty file)' } : bad(`File not found: ${path}`);
  }
  if (name === 'write_file') {
    if (typeof input.content !== 'string') return bad('content must be a string');
    if (input.content.length > MAX_FILE) return bad('File too large (max 1 MB).');
    if (!(path in p.files) && Object.keys(p.files).length >= MAX_FILES) return bad('Too many files in project.');
    if (total() - (p.files[path]?.length || 0) + input.content.length > MAX_TOTAL) return bad('Project size limit reached (6 MB).');
    const existed = path in p.files;
    p.files[path] = input.content;
    return { content: `${existed ? 'Updated' : 'Created'} ${path}`, changed: path };
  }
  if (name === 'edit_file') {
    if (typeof input.old_string !== 'string' || typeof input.new_string !== 'string') return bad('old_string and new_string must be strings');
    const cur = p.files[path];
    if (cur === undefined) return bad(`File not found: ${path}`);
    if (!input.old_string) return bad('old_string is empty');
    const count = cur.split(input.old_string).length - 1;
    if (count === 0) return bad('old_string not found in file. Read the file again and copy the exact text.');
    if (count > 1 && !input.replace_all) return bad(`old_string appears ${count} times; add more context or set replace_all.`);
    const next = input.replace_all ? cur.split(input.old_string).join(input.new_string) : cur.replace(input.old_string, () => input.new_string);
    if (next.length > MAX_FILE) return bad('File too large (max 1 MB).');
    p.files[path] = next;
    return { content: `Edited ${path}`, changed: path };
  }
  if (name === 'delete_file') {
    if (!(path in p.files)) return bad(`File not found: ${path}`);
    delete p.files[path];
    return { content: `Deleted ${path}`, changed: path };
  }
  return bad(`Unknown tool ${name}`);
}

async function codeChat(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const me = ctx.currentUser(req);
  if (!me) return ctx.send(res, 401, { ok: false, error: 'Sign in to use TriumpCode.' });
  if (!hasKey()) return ctx.send(res, 503, { ok: false, error: 'AI is not configured on the server yet.' });
  const b = await ctx.body(req);
  const p = await loadProject(String(b.id || ''));
  if (!p || p.owner !== me.user.id) return ctx.send(res, 404, { ok: false, error: 'Project not found.' });
  const text = String(b.message || '').trim().slice(0, 8000);
  if (!text) return ctx.send(res, 400, { ok: false, error: 'Type a message.' });
  if (busy.has(p.id)) return ctx.send(res, 409, { ok: false, error: 'TriumpCode is still working on this project.' });
  if (!(await spend(me.user, 'code'))) return ctx.send(res, 429, { ok: false, error: quotaError(me.user, 'code'), quota: true });

  busy.add(p.id);
  const out = sse(req, res);
  out.emit({ t: 'start', plan: planOf(me.user) });
  // riwayat terlalu panjang -> mulai percakapan baru; file project adalah state-nya
  if (JSON.stringify(p.messages).length > 600_000) p.messages = [];
  let userText = text;
  if (!p.messages.length) userText = `Project files right now:\n${Object.keys(p.files).sort().join('\n') || '(empty project)'}\n\n${text}`;
  if (p.notes.length) { userText = `(Since your last turn the user edited these files by hand: ${p.notes.join(', ')}. Re-read them before changing them.)\n\n${userText}`; p.notes = []; }
  p.messages.push({ role: 'user', content: userText });
  const entry: Project['chat'][number] = { role: 'assistant', text: '', tools: [] };
  p.chat.push({ role: 'user', text }, entry);

  let jsonRetries = 0;
  try {
    for (let step = 0; step < 30; step++) {
      let msg: Anthropic.Beta.BetaMessage;
      try {
        msg = await streamTurn({
          model: MODEL.code, system: CODE_WEB_SYSTEM, tools: VFS_TOOLS, messages: p.messages, effort: 'high', signal: out.signal,
          onText: t => { entry.text += t; out.emit({ t: 'text', text: t }); },
          onToolStart: n => out.emit({ t: 'tool_start', name: n }),
          onThinking: t => out.emit({ t: 'thinking', text: t }),
        });
        jsonRetries = 0;
      } catch (e) {
        // input tool yang tidak bisa diparse sama sekali: ulangi giliran (maks 2x)
        if (isApiError(e) || jsonRetries++ >= 2) throw e;
        continue;
      }
      if (msg.stop_reason === 'refusal') { out.emit({ t: 'text', text: '\n\n(The AI declined to continue this request.)' }); break; }
      const uses = msg.content.filter((c: any) => c.type === 'tool_use') as any[];
      p.messages.push({ role: 'assistant', content: cleanContent(msg.content) });
      if (msg.stop_reason === 'pause_turn') continue;
      if (!uses.length) break;
      const results: any[] = [];
      for (const u of uses) {
        const r = msg.stop_reason === 'max_tokens'
          ? { content: 'Tool input was cut off (output limit). Split the work into smaller files or edits.', is_error: true }
          : runVfsTool(p, u.name, u.input);
        const path = cleanPath(u.input?.path) || undefined;
        entry.tools!.push({ name: u.name, path, ok: !r.is_error });
        out.emit({ t: 'tool', name: u.name, path, ok: !r.is_error, changed: (r as ToolOut).changed });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
      }
      p.messages.push({ role: 'user', content: results });
      p.updatedAt = Date.now();
      await saveJson(projFile(p.id), p);
    }
    out.emit({ t: 'done', files: Object.keys(p.files).sort() });
  } catch (e) {
    // giliran yang gagal di tengah jalan: tutup tool_use yang menggantung supaya riwayat tetap valid
    const last = p.messages.at(-1);
    if (last?.role === 'assistant' && Array.isArray(last.content) && last.content.some((c: any) => c.type === 'tool_use')) p.messages.pop();
    if (p.messages.at(-1)?.role === 'user' && typeof p.messages.at(-1).content === 'string') p.messages.push({ role: 'assistant', content: '(interrupted)' });
    console.error('[code]', p.id, (e as any)?.status || '', (e as any)?.message || e);
    out.emit({ t: 'error', error: apiErrorText(e) });
  } finally {
    busy.delete(p.id);
    p.updatedAt = Date.now();
    await saveJson(projFile(p.id), p);
    out.end();
  }
}
const busy = new Set<string>();

function starterProject(owner: string, name: string): Project {
  const now = Date.now();
  return {
    id: newId(9), owner, name, createdAt: now, updatedAt: now, messages: [], chat: [], notes: [],
    files: {
      'index.html': `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${name.replace(/[<>&]/g, '')}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main>\n    <h1>${name.replace(/[<>&]/g, '')}</h1>\n    <p>Tell TriumpCode what to build.</p>\n  </main>\n  <script src="app.js"></script>\n</body>\n</html>\n`,
      'style.css': `body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0b1512;color:#eaf4ef}\nh1{margin:0 0 8px}\np{color:#9fbdb2}\n`,
      'app.js': `// your code here\n`,
    },
  };
}

/* ================= TRIUMPCODE CLI ================= */
type Device = { userCode: string; expires: number; uid?: string; token?: string };
const devices = new Map<string, Device>();            // device_code -> status
type CliToken = { uid: string; createdAt: number; lastUsed: number };
const TOKENS_FILE = join(DATA, 'cli_tokens.json');
const cliTokens = await loadJson<Record<string, CliToken>>(TOKENS_FILE, {});

function bearerUser(ctx: Ctx, req: IncomingMessage): User | null {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(tcli_[\w-]+)$/);
  if (!m) return null;
  const t = cliTokens[sha(m[1])];
  if (!t) return null;
  t.lastUsed = Date.now();
  return ctx.users[t.uid] || null;
}

const CLI_TOOLS = [
  { name: 'read_file', description: 'Read a text file from the working directory. Returns numbered lines. Use offset/limit for big files.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', description: '1-based first line' }, limit: { type: 'integer' } }, required: ['path'], additionalProperties: false } },
  { name: 'list_files', description: 'List files under a directory (recursive, skips node_modules/.git). Optional glob-like pattern such as "*.ts".',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, pattern: { type: 'string' } }, additionalProperties: false } },
  { name: 'search', description: 'Search file contents with a regular expression. Returns matching lines as path:line: text.',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' } }, required: ['pattern'], additionalProperties: false } },
  { name: 'write_file', description: 'Create a file or overwrite it entirely. The user is asked to approve. Prefer edit_file for changes to existing files.', eager_input_streaming: true,
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
  { name: 'edit_file', description: 'Replace an exact snippet in a file. old_string must match exactly and be unique unless replace_all is true. The user is asked to approve.', eager_input_streaming: true,
    input_schema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_string', 'new_string'], additionalProperties: false } },
  { name: 'run_command', description: 'Run a shell command in the working directory (tests, builds, git, package managers). The user is asked to approve. Output is truncated to the last 20,000 characters.',
    input_schema: { type: 'object', properties: { command: { type: 'string' }, timeout_seconds: { type: 'integer', description: 'default 120, max 600' } }, required: ['command'], additionalProperties: false } },
];
const CLI_SYSTEM = `You are TriumpCode, an AI coding agent running in the user's terminal, made by TRIUMP AI.
You work inside the user's current working directory using the tools provided: read and search before you change things, make focused edits, run the project's own commands (tests, linters, builds) to check your work, and never touch files outside the working directory.
Every write and every command needs the user's approval in the terminal; if they decline, adapt instead of retrying the same thing.
Keep replies short and concrete — the terminal is narrow. Use plain text and simple markdown (no tables). When a task is done, summarise what changed in a few lines. Match the user's language.`;

async function cliTurn(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const u = bearerUser(ctx, req);
  if (!u) return ctx.send(res, 401, { ok: false, error: 'Not logged in. Run: triumpcode login' });
  if (!hasKey()) return ctx.send(res, 503, { ok: false, error: 'AI is not configured on the server yet.' });
  if (ctx.limited('cli:' + u.id, 60, 60)) return ctx.send(res, 429, { ok: false, error: 'Too many requests. Slow down a little.' });
  let b: Record<string, unknown>;
  try { b = await ctx.body(req, 8_000_000); } catch { return ctx.send(res, 413, { ok: false, error: 'Conversation too large. Run /clear.' }); }
  const messages = b.messages;
  if (!Array.isArray(messages) || !messages.length || messages[0]?.role !== 'user')
    return ctx.send(res, 400, { ok: false, error: 'Invalid conversation.' });
  // jatah dihitung per pesan baru dari user, bukan per hasil tool
  const last = messages.at(-1);
  const fresh = last?.role === 'user' && (typeof last.content === 'string' || (Array.isArray(last.content) && !last.content.some((c: any) => c?.type === 'tool_result')));
  if (fresh && !(await spend(u, 'code'))) return ctx.send(res, 429, { ok: false, error: quotaError(u, 'code'), quota: true });
  for (const m of messages) if (m?.role === 'assistant' && Array.isArray(m.content)) m.content = cleanContent(m.content);
  const out = sse(req, res);
  try {
    const msg = await streamTurn({
      model: MODEL.code, system: CLI_SYSTEM, tools: CLI_TOOLS, messages, effort: 'high', signal: out.signal,
      onText: t => out.emit({ t: 'text', text: t }),
      onToolStart: n => out.emit({ t: 'tool_start', name: n }),
      onThinking: t => out.emit({ t: 'thinking', text: t }),
    });
    out.emit({ t: 'message', content: cleanContent(msg.content), stop_reason: msg.stop_reason });
  } catch (e) {
    out.emit({ t: 'error', error: apiErrorText(e), retryable: !isApiError(e) });
  }
  out.end();
}

/* ================= preview (CSP sandbox) ================= */
const MIME: Record<string, string> = { html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8' };
function sandboxed(res: ServerResponse, body: string, type: string) {
  res.writeHead(200, {
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    // origin unik & terisolasi walau dibuka langsung di tab baru
    'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads',
  });
  res.end(body);
}

export async function handlePreview(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  let m = pathname.match(/^\/preview\/s\/([\w-]{6,20})(?:\/(\d+))?\/?$/);
  if (m) {
    const d = await loadDesign(m[1]);
    const v = d && (m[2] ? d.versions[Number(m[2]) - 1] : d.versions.at(-1));
    if (!v) { res.writeHead(404); res.end('Not found'); return true; }
    sandboxed(res, v.html, MIME.html); return true;
  }
  m = pathname.match(/^\/preview\/c\/([\w-]{6,20})(\/.*)?$/);
  if (m) {
    const p = await loadProject(m[1]);
    if (!p) { res.writeHead(404); res.end('Not found'); return true; }
    if (!m[2]) { res.writeHead(302, { Location: `/preview/c/${m[1]}/` }); res.end(); return true; }
    let path = cleanPath(decodeURIComponent(m[2] || '/')) || 'index.html';
    if (!(path in p.files) && (path + '/index.html') in p.files) path += '/index.html';
    const body = p.files[path];
    if (body === undefined) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found in project: ' + path); return true; }
    sandboxed(res, body, MIME[path.split('.').pop()!.toLowerCase()] || 'text/plain; charset=utf-8'); return true;
  }
  return false;
}

/* ================= router ================= */
export async function handleApps(ctx: Ctx, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const m = req.method || 'GET', p = url.pathname;
  const needUser = () => { const me = ctx.currentUser(req); if (!me) ctx.send(res, 401, { ok: false, error: 'Sign in first.' }); return me?.user || null; };

  if (m === 'GET' && p === '/api/plan') {
    const u = needUser(); if (!u) return true;
    ctx.send(res, 200, { ok: true, ...planOf(u), ai: hasKey(), tokenLive: !!(await tokenCA()) }); return true;
  }
  if (m === 'POST' && p === '/api/plan/check-holder') { await checkHolder(ctx, req, res); return true; }

  /* ---- studio ---- */
  if (m === 'POST' && p === '/api/studio/generate') { await studioGenerate(ctx, req, res); return true; }
  if (m === 'GET' && p === '/api/studio/list') {
    const u = needUser(); if (!u) return true;
    const list = (await listOwned(STUDIO_DIR, u.id)).map((d: Design) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt, versions: d.versions.length }));
    ctx.send(res, 200, { ok: true, designs: list }); return true;
  }
  if (m === 'GET' && p === '/api/studio/get') {
    const u = needUser(); if (!u) return true;
    const d = await loadDesign(url.searchParams.get('id') || '');
    if (!d || d.owner !== u.id) { ctx.send(res, 404, { ok: false, error: 'Design not found.' }); return true; }
    ctx.send(res, 200, { ok: true, design: { id: d.id, title: d.title, versions: d.versions.map(v => ({ prompt: v.prompt, at: v.at })), html: d.versions.at(-1)?.html || '' } });
    return true;
  }
  if (m === 'POST' && p === '/api/studio/delete') {
    const u = needUser(); if (!u) return true;
    const b = await ctx.body(req); const d = await loadDesign(String(b.id || ''));
    if (d && d.owner === u.id) await unlink(designFile(d.id)).catch(() => {});
    ctx.send(res, 200, { ok: true }); return true;
  }

  /* ---- triumpcode web ---- */
  if (m === 'POST' && p === '/api/code/chat') { await codeChat(ctx, req, res); return true; }
  if (m === 'POST' && p === '/api/code/new') {
    const u = needUser(); if (!u) return true;
    const b = await ctx.body(req);
    const mine = await listOwned(CODE_DIR, u.id);
    if (mine.length >= 50) { ctx.send(res, 400, { ok: false, error: 'Project limit reached (50). Delete an old one first.' }); return true; }
    const proj = starterProject(u.id, String(b.name || '').trim().slice(0, 60) || 'Untitled project');
    await saveJson(projFile(proj.id), proj);
    ctx.send(res, 200, { ok: true, id: proj.id }); return true;
  }
  if (m === 'GET' && p === '/api/code/list') {
    const u = needUser(); if (!u) return true;
    const list = (await listOwned(CODE_DIR, u.id)).map((x: Project) => ({ id: x.id, name: x.name, updatedAt: x.updatedAt, files: Object.keys(x.files).length }));
    ctx.send(res, 200, { ok: true, projects: list }); return true;
  }
  if (m === 'GET' && p === '/api/code/get') {
    const u = needUser(); if (!u) return true;
    const x = await loadProject(url.searchParams.get('id') || '');
    if (!x || x.owner !== u.id) { ctx.send(res, 404, { ok: false, error: 'Project not found.' }); return true; }
    ctx.send(res, 200, { ok: true, project: { id: x.id, name: x.name, files: x.files, chat: x.chat.slice(-80), busy: busy.has(x.id) } }); return true;
  }
  if (m === 'POST' && (p === '/api/code/save-file' || p === '/api/code/delete-file' || p === '/api/code/delete' || p === '/api/code/rename')) {
    const u = needUser(); if (!u) return true;
    let b: Record<string, unknown>;
    try { b = await ctx.body(req, 1_200_000); } catch { ctx.send(res, 413, { ok: false, error: 'File too large (max 1 MB).' }); return true; }
    const x = await loadProject(String(b.id || ''));
    if (!x || x.owner !== u.id) { ctx.send(res, 404, { ok: false, error: 'Project not found.' }); return true; }
    if (busy.has(x.id)) { ctx.send(res, 409, { ok: false, error: 'TriumpCode is working on this project right now.' }); return true; }
    if (p === '/api/code/delete') { await unlink(projFile(x.id)).catch(() => {}); ctx.send(res, 200, { ok: true }); return true; }
    if (p === '/api/code/rename') { x.name = String(b.name || '').trim().slice(0, 60) || x.name; }
    else {
      const r = runVfsTool(x, p === '/api/code/save-file' ? 'write_file' : 'delete_file', { path: b.path, content: b.content });
      if (r.is_error) { ctx.send(res, 400, { ok: false, error: r.content }); return true; }
      const path = cleanPath(b.path)!;
      if (!x.notes.includes(path)) x.notes.push(path);
    }
    x.updatedAt = Date.now(); await saveJson(projFile(x.id), x);
    ctx.send(res, 200, { ok: true, files: x.files, name: x.name }); return true;
  }
  if (m === 'GET' && p === '/api/code/zip') {
    const u = needUser(); if (!u) return true;
    const x = await loadProject(url.searchParams.get('id') || '');
    if (!x || x.owner !== u.id) { ctx.send(res, 404, { ok: false, error: 'Project not found.' }); return true; }
    const zip = makeZip(Object.entries(x.files).map(([name, content]) => ({ name, data: Buffer.from(content, 'utf8') })));
    const fname = (x.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project') + '.zip';
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': zip.length, 'Content-Disposition': `attachment; filename="${fname}"`, 'Cache-Control': 'no-store' });
    res.end(zip); return true;
  }

  /* ---- triumpcode cli ---- */
  if (m === 'POST' && p === '/api/cli/device/start') {
    if (ctx.limited('dev:' + ctx.clientIp(req), 10, 600)) { ctx.send(res, 429, { ok: false, error: 'Too many login attempts.' }); return true; }
    const now = Date.now();
    for (const [k, v] of devices) if (v.expires < now) devices.delete(k);
    const deviceCode = newId(24);
    const A = 'BCDFGHJKLMNPQRSTVWXZ';
    const userCode = Array.from(randomBytes(8), (x, i) => (i === 4 ? '-' : '') + A[x % A.length]).join('');
    devices.set(deviceCode, { userCode, expires: now + 10 * 60_000 });
    ctx.send(res, 200, { ok: true, device_code: deviceCode, user_code: userCode, verify_url: `${ctx.siteUrl}/cli?code=${encodeURIComponent(userCode)}`, interval: 3, expires_in: 600 });
    return true;
  }
  if (m === 'GET' && p === '/api/cli/device/poll') {
    const d = devices.get(url.searchParams.get('device_code') || '');
    if (!d || d.expires < Date.now()) { ctx.send(res, 410, { ok: false, status: 'expired' }); return true; }
    if (!d.token) { ctx.send(res, 200, { ok: true, status: 'pending' }); return true; }
    devices.delete(url.searchParams.get('device_code')!);
    ctx.send(res, 200, { ok: true, status: 'approved', token: d.token }); return true;
  }
  if (m === 'POST' && p === '/api/cli/device/approve') {
    const u = needUser(); if (!u) return true;
    const b = await ctx.body(req);
    const code = String(b.user_code || '').toUpperCase().replace(/[^A-Z]/g, '');
    const hit = [...devices.values()].find(d => d.userCode.replace('-', '') === code && d.expires > Date.now() && !d.token);
    if (!hit) { ctx.send(res, 404, { ok: false, error: 'This code is invalid or expired. Run `triumpcode login` again.' }); return true; }
    const token = 'tcli_' + newId(32);
    cliTokens[sha(token)] = { uid: u.id, createdAt: Date.now(), lastUsed: Date.now() };
    await saveJson(TOKENS_FILE, cliTokens);
    hit.token = token; hit.uid = u.id;
    ctx.send(res, 200, { ok: true }); return true;
  }
  if (m === 'GET' && p === '/api/cli/me') {
    const u = bearerUser(ctx, req);
    if (!u) { ctx.send(res, 401, { ok: false, error: 'Not logged in.' }); return true; }
    ctx.send(res, 200, { ok: true, user: { email: u.email || null, wallet: u.wallet || null, x: u.x?.username || null }, ...planOf(u) }); return true;
  }
  if (m === 'POST' && p === '/api/cli/logout') {
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/, '');
    if (cliTokens[sha(tok)]) { delete cliTokens[sha(tok)]; await saveJson(TOKENS_FILE, cliTokens); }
    ctx.send(res, 200, { ok: true }); return true;
  }
  if (m === 'POST' && p === '/api/cli/turn') { await cliTurn(ctx, req, res); return true; }
  return false;
}
