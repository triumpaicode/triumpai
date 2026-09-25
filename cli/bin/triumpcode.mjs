#!/usr/bin/env node
/* TriumpCode — AI coding agent in your terminal, by TRIUMP AI.

   triumpcode login            sign in with your TRIUMP AI account (opens the browser)
   triumpcode                  start an interactive session in the current folder
   triumpcode -p "task"        run one task and exit (writes/commands need --yes)
   triumpcode whoami | logout

   Flags: --yes (approve every write and command), --server <url>
   No dependencies: Node 18.17+ only. The AI runs on the TRIUMP AI server; every
   file read, write and command runs here, on your machine, inside this folder. */
import { readFile, writeFile, mkdir, readdir, stat, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { join, resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import * as readline from 'node:readline';

const VERSION = '0.1.0';
const CONFIG_DIR = join(homedir(), '.triumpcode');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const DEFAULT_SERVER = 'https://triumpai.com';
const ROOT = process.cwd();

/* ---------------- tampilan ---------------- */
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c('2'), bold = c('1'), green = c('38;5;82'), blue = c('38;5;117'), red = c('38;5;203'), yellow = c('38;5;221'), gray = c('38;5;245'), cyan = c('36');
const out = (s = '') => process.stdout.write(s);
const line = (s = '') => out(s + '\n');

function banner(who, plan) {
  line();
  line(`  ${green('▲')} ${bold('TriumpCode')} ${dim('v' + VERSION + ' · by TRIUMP AI')}`);
  if (who) line(`  ${dim('signed in as')} ${who} ${dim('·')} ${plan === 'pro' ? green('PRO') : gray('FREE')}`);
  line(`  ${dim('folder')} ${ROOT}`);
  line(`  ${dim('/help for commands · Ctrl+C to stop a task · /exit to quit')}`);
  line();
}

/* Markdown ringan, dirender per baris supaya aman saat streaming */
let inFence = false;
function renderLine(l) {
  if (/^\s*```/.test(l)) { inFence = !inFence; return dim(l); }
  if (inFence) return cyan(l);
  if (/^#{1,6}\s/.test(l)) return bold(l.replace(/^#{1,6}\s/, ''));
  l = l.replace(/^(\s*)[-*]\s/, '$1• ');
  l = l.replace(/\*\*([^*]+)\*\*/g, (_, t) => bold(t));
  l = l.replace(/`([^`]+)`/g, (_, t) => cyan(t));
  return l;
}
function textPrinter() {
  let buf = '', started = false;
  return {
    push(t) {
      if (!started) { out('\n'); started = true; }
      buf += t;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { line('  ' + renderLine(buf.slice(0, i))); buf = buf.slice(i + 1); }
    },
    flush() { if (buf) { line('  ' + renderLine(buf)); buf = ''; } inFence = false; return started; },
  };
}
function spinner(label) {
  if (!process.stdout.isTTY) return { stop() {}, label() {} };
  const f = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0; const t0 = Date.now();
  const cols = () => Math.max(20, (process.stdout.columns || 80) - 8);
  const draw = () => { const s = `${label} (${Math.round((Date.now() - t0) / 1000)}s)`; out(`\r\x1b[2K  ${green(f[i++ % f.length])} ${dim(s.slice(0, cols()))}`); };
  const t = setInterval(draw, 90);
  return { stop() { clearInterval(t); out('\r\x1b[2K'); }, label(l) { label = l; } };
}

/* ---------------- config & HTTP ---------------- */
async function loadConfig() {
  try { return JSON.parse(await readFile(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
async function saveConfig(cfg) {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i >= 0) { args.splice(i, 1); return true; } return false; };
const opt = (n) => { const i = args.indexOf(n); if (i >= 0) { const v = args[i + 1]; args.splice(i, 2); return v; } return null; };
const AUTO_YES = flag('--yes') || flag('-y');
const SERVER_ARG = opt('--server');
const PRINT = opt('-p') ?? opt('--print');

let cfg = await loadConfig();
const server = () => (SERVER_ARG || process.env.TRIUMPCODE_SERVER || cfg.server || DEFAULT_SERVER).replace(/\/$/, '');

async function api(path, { method = 'GET', body, token = cfg.token } = {}) {
  const r = await fetch(server() + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({ ok: false, error: `Server error (${r.status})` }));
  return { status: r.status, ...j };
}

/* ---------------- login (device code) ---------------- */
function openBrowser(url) {
  const cmd = platform() === 'darwin' ? ['open', [url]] : platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch {}
}
async function login() {
  const d = await api('/api/cli/device/start', { method: 'POST', body: {}, token: null }).catch(() => null);
  if (!d || !d.ok) { line(red(`  Could not reach ${server()}.`)); process.exit(1); }
  line();
  line(`  Open ${blue(d.verify_url)}`);
  line(`  and confirm this code: ${bold(green(d.user_code))}`);
  line();
  openBrowser(d.verify_url);
  const sp = spinner('waiting for approval in the browser…');
  const until = Date.now() + d.expires_in * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, (d.interval || 3) * 1000));
    const p = await api(`/api/cli/device/poll?device_code=${encodeURIComponent(d.device_code)}`, { token: null }).catch(() => null);
    if (p?.status === 'approved') {
      sp.stop();
      cfg = { ...cfg, server: server(), token: p.token };
      await saveConfig(cfg);
      const me = await api('/api/cli/me');
      line(`  ${green('✓')} Logged in as ${whoLabel(me.user)}`);
      return true;
    }
    if (p?.status === 'expired') break;
  }
  sp.stop();
  line(red('  Login code expired. Run `triumpcode login` again.'));
  process.exit(1);
}
const whoLabel = (u) => !u ? '?' : u.x ? '@' + u.x : u.email || (u.wallet ? u.wallet.slice(0, 6) + '…' + u.wallet.slice(-4) : 'account');

/* ---------------- izin ---------------- */
let rl = null;
const always = { write: AUTO_YES, run: AUTO_YES };
/* antrean baris input: aman untuk terminal maupun input lewat pipe */
const lineQueue = [], lineWaiters = [];
let inputClosed = false;
function nextLine(promptStr) {
  if (!rl) return Promise.resolve(null);
  if (inputClosed) out(promptStr); else { rl.setPrompt(promptStr); rl.prompt(); }
  if (lineQueue.length) { const l = lineQueue.shift(); if (!process.stdin.isTTY) line(l); return Promise.resolve(l); }
  if (inputClosed) return Promise.resolve(null);
  return new Promise((r) => lineWaiters.push(r));
}
async function ask(q) {
  const a = await nextLine(q);
  return a === null ? 'n' : a.trim().toLowerCase();
}
async function permit(kind, label) {
  if (always[kind]) return true;
  if (!rl) return false; // mode -p tanpa --yes: tolak
  const a = await ask(`  ${yellow('?')} ${label} ${dim('[y]es / [n]o / [a]lways')} `);
  if (a === 'a' || a === 'always') { always[kind] = true; return true; }
  return a === 'y' || a === 'yes' || a === '';
}

/* ---------------- tool lokal ---------------- */
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage', '.venv', '__pycache__', '.turbo', 'vendor']);
async function inside(p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('path is required');
  const abs = resolve(ROOT, p);
  const rel = relative(ROOT, abs);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('path is outside the working folder');
  // cegah lolos lewat symlink
  let probe = abs;
  while (!existsSync(probe) && probe !== dirname(probe)) probe = dirname(probe);
  const real = await realpath(probe).catch(() => probe), rootReal = await realpath(ROOT);
  const r2 = relative(rootReal, real);
  if (r2 === '..' || r2.startsWith('..' + sep) || isAbsolute(r2)) throw new Error('path is outside the working folder');
  return abs;
}
const show = (p) => relative(ROOT, p) || '.';
function globRe(g) {
  if (!g) return null;
  const re = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp((g.includes('/') ? '^' : '(^|/)') + re + '$');
}
async function walk(dir, acc, max = 2000) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (acc.length >= max) break;
    if (SKIP.has(e.name) || (e.name.startsWith('.') && e.name !== '.github' && e.name !== '.env.example')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, acc, max); else if (e.isFile()) acc.push(full);
  }
  return acc;
}
function preview(text, sign, paint, max = 12) {
  const ls = text.split('\n');
  const shown = ls.slice(0, max).map((l) => '    ' + paint(sign + ' ' + l));
  if (ls.length > max) shown.push('    ' + dim(`… ${ls.length - max} more lines`));
  return shown.join('\n');
}

const TOOLS = {
  async read_file(i) {
    const p = await inside(i.path);
    line(`  ${blue('●')} Read ${bold(show(p))}`);
    const s = await stat(p);
    if (s.size > 2_000_000) throw new Error('file is larger than 2 MB; use search instead');
    const all = (await readFile(p, 'utf8')).split('\n');
    const from = Math.max(1, Number.isInteger(i.offset) ? i.offset : 1), lim = Number.isInteger(i.limit) ? i.limit : 2000;
    const part = all.slice(from - 1, from - 1 + lim);
    const body = part.map((l, k) => `${String(from + k).padStart(5)}\t${l}`).join('\n');
    return body + (from - 1 + lim < all.length ? `\n… (${all.length - (from - 1 + lim)} more lines; use offset)` : '');
  },
  async list_files(i) {
    const base = await inside(i.path || '.');
    line(`  ${blue('●')} List ${bold(show(base))}${i.pattern ? dim(' ' + i.pattern) : ''}`);
    const re = globRe(i.pattern);
    const files = (await walk(base, [])).map((f) => relative(ROOT, f).split(sep).join('/')).filter((f) => !re || re.test(f));
    return files.length ? files.join('\n') + (files.length >= 2000 ? '\n… (truncated)' : '') : '(no files)';
  },
  async search(i) {
    if (typeof i.pattern !== 'string' || !i.pattern) throw new Error('pattern is required');
    const base = await inside(i.path || '.');
    line(`  ${blue('●')} Search ${bold(i.pattern)} ${dim('in ' + show(base))}`);
    let re; try { re = new RegExp(i.pattern); } catch { throw new Error('invalid regular expression'); }
    const g = globRe(i.glob), hits = [];
    for (const f of await walk(base, [])) {
      const rel = relative(ROOT, f).split(sep).join('/');
      if (g && !g.test(rel)) continue;
      const s = await stat(f).catch(() => null);
      if (!s || s.size > 1_000_000) continue;
      const txt = await readFile(f, 'utf8').catch(() => '');
      if (txt.includes('\u0000')) continue;
      txt.split('\n').forEach((l, k) => { if (hits.length < 200 && re.test(l)) hits.push(`${rel}:${k + 1}: ${l.slice(0, 300)}`); });
      if (hits.length >= 200) break;
    }
    return hits.length ? hits.join('\n') : 'No matches.';
  },
  async write_file(i) {
    if (typeof i.content !== 'string') throw new Error('content must be a string');
    const p = await inside(i.path);
    const existed = existsSync(p);
    line(`  ${green('●')} ${existed ? 'Overwrite' : 'Create'} ${bold(show(p))} ${dim(`(${i.content.split('\n').length} lines)`)}`);
    line(preview(i.content, '+', green));
    if (!(await permit('write', existed ? 'Overwrite this file?' : 'Create this file?'))) return { denied: true };
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, i.content);
    return `${existed ? 'Overwrote' : 'Created'} ${show(p)}`;
  },
  async edit_file(i) {
    if (typeof i.old_string !== 'string' || typeof i.new_string !== 'string' || !i.old_string) throw new Error('old_string and new_string are required');
    const p = await inside(i.path);
    const cur = await readFile(p, 'utf8');
    const n = cur.split(i.old_string).length - 1;
    if (n === 0) throw new Error('old_string not found. Read the file again and copy the exact text.');
    if (n > 1 && !i.replace_all) throw new Error(`old_string appears ${n} times; add more context or set replace_all`);
    line(`  ${green('●')} Edit ${bold(show(p))}${n > 1 ? dim(` (${n} places)`) : ''}`);
    line(preview(i.old_string, '-', red, 8));
    line(preview(i.new_string, '+', green, 8));
    if (!(await permit('write', 'Apply this edit?'))) return { denied: true };
    const next = i.replace_all ? cur.split(i.old_string).join(i.new_string) : cur.replace(i.old_string, () => i.new_string);
    await writeFile(p, next);
    return `Edited ${show(p)}`;
  },
  async run_command(i) {
    if (typeof i.command !== 'string' || !i.command.trim()) throw new Error('command is required');
    line(`  ${yellow('●')} Run ${bold(i.command)}`);
    if (!(await permit('run', 'Run this command?'))) return { denied: true };
    const timeout = Math.min(600, Math.max(1, Number.isInteger(i.timeout_seconds) ? i.timeout_seconds : 120)) * 1000;
    return await new Promise((res) => {
      const sh = platform() === 'win32' ? ['cmd', ['/d', '/s', '/c', i.command]] : ['/bin/sh', ['-c', i.command]];
      const child = spawn(sh[0], sh[1], { cwd: ROOT, env: process.env });
      let buf = '';
      const onData = (d) => { const s = d.toString(); buf = (buf + s).slice(-20000); out(dim(s.replace(/^/gm, '    '))); };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      const t = setTimeout(() => { child.kill('SIGTERM'); buf += `\n(timed out after ${timeout / 1000}s)`; }, timeout);
      running = child;
      child.on('close', (code) => { clearTimeout(t); running = null; if (buf && !buf.endsWith('\n')) out('\n'); res(`exit code ${code}\n${buf || '(no output)'}`); });
      child.on('error', (e) => { clearTimeout(t); running = null; res(`failed to start: ${e.message}`); });
    });
  },
};
let running = null;

/* ---------------- percakapan ---------------- */
let messages = [];
let aborter = null;

async function envContext() {
  const top = (await readdir(ROOT).catch(() => [])).filter((n) => !SKIP.has(n)).slice(0, 60);
  return `<env>\nworking directory: ${ROOT}\nplatform: ${platform()}\ndate: ${new Date().toISOString().slice(0, 10)}\ngit repository: ${existsSync(join(ROOT, '.git')) ? 'yes' : 'no'}\ntop-level entries: ${top.join(', ') || '(empty)'}\n</env>`;
}

async function streamTurn() {
  aborter = new AbortController();
  const r = await fetch(server() + '/api/cli/turn', {
    method: 'POST', signal: aborter.signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
    body: JSON.stringify({ messages }),
  });
  if (!(r.headers.get('content-type') || '').includes('event-stream')) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j.error || `Server error (${r.status})`), { status: r.status });
  }
  const tp = textPrinter();
  let sp = spinner('thinking…'), final = null, err = null, thought = '';
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      if (!raw.startsWith('data: ')) continue;
      const ev = JSON.parse(raw.slice(6));
      if (ev.t === 'thinking') {
        thought += ev.text;
        const last = thought.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/).filter(Boolean).pop() || '';
        sp.label('thinking · ' + (last.length > 70 ? last.slice(0, 68) + '…' : last));
      }
      else if (ev.t === 'text') { sp.stop(); sp = { stop() {}, label() {} }; tp.push(ev.text); }
      else if (ev.t === 'tool_start') { tp.flush(); sp.stop(); thought = ''; sp = spinner('preparing ' + ev.name.replace('_', ' ') + '…'); }
      else if (ev.t === 'message') final = ev;
      else if (ev.t === 'error') err = ev;
    }
  }
  sp.stop();
  if (tp.flush()) line();
  if (err) throw Object.assign(new Error(err.error), { retryable: err.retryable });
  if (!final) throw Object.assign(new Error('Connection closed early.'), { retryable: true });
  return final;
}

function validInput(name, i) {
  if (!i || typeof i !== 'object') return false;
  const s = (k) => typeof i[k] === 'string';
  switch (name) {
    case 'read_file': return s('path');
    case 'list_files': return (i.path === undefined || s('path')) && (i.pattern === undefined || s('pattern'));
    case 'search': return s('pattern');
    case 'write_file': return s('path') && s('content');
    case 'edit_file': return s('path') && s('old_string') && s('new_string');
    case 'run_command': return s('command');
    default: return false;
  }
}

async function runTask(userText) {
  const first = messages.length === 0;
  messages.push({ role: 'user', content: first ? `${await envContext()}\n\n${userText}` : userText });
  let retries = 0;
  for (let step = 0; step < 60; step++) {
    let msg;
    try {
      msg = await streamTurn();
      retries = 0;
    } catch (e) {
      if (e.name === 'AbortError') { rollback(); line(yellow('  ■ stopped')); return; }
      if (e.retryable && retries++ < 2) { line(dim('  (retrying…)')); continue; }
      rollback();
      line(red('  ✗ ' + e.message));
      if (e.status === 401) line(dim('  Run: triumpcode login'));
      return;
    }
    messages.push({ role: 'assistant', content: msg.content });
    if (msg.stop_reason === 'refusal') { line(yellow('  The AI declined this request.')); return; }
    if (msg.stop_reason === 'pause_turn') continue;
    const uses = msg.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) return;
    const results = [];
    for (const u of uses) {
      let content, is_error = false;
      if (msg.stop_reason === 'max_tokens') { content = 'Tool input was cut off by the output limit. Split the work into smaller steps.'; is_error = true; }
      else if (!validInput(u.name, u.input)) { content = JSON.stringify({ INVALID_JSON: JSON.stringify(u.input) }); is_error = true; }
      else {
        try {
          const r = await TOOLS[u.name](u.input);
          if (r && r.denied) { content = 'The user declined this action. Ask them or try another approach.'; is_error = true; line(dim('    declined')); }
          else content = String(r);
        } catch (e) {
          content = 'Error: ' + e.message; is_error = true;
          line(red('    ✗ ' + e.message));
        }
      }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: content.slice(0, 100_000), ...(is_error ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  line(yellow('  Stopped after 60 steps. Say "continue" to keep going.'));
}
/* giliran yang batal: buang sampai pesan user terakhir berupa teks supaya riwayat tetap valid */
function rollback() {
  while (messages.length) {
    const m = messages.at(-1);
    if (m.role === 'user' && typeof m.content === 'string') { messages.pop(); break; }
    messages.pop();
  }
}

/* ---------------- main ---------------- */
const cmd = args[0];
if (cmd === '--version' || cmd === '-v') { line(VERSION); process.exit(0); }
if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
  line(`\n  ${bold('TriumpCode')} — AI coding agent in your terminal\n\n  triumpcode login        sign in (opens your browser)\n  triumpcode              interactive session in this folder\n  triumpcode -p "task"    one task, then exit (add --yes to allow writes/commands)\n  triumpcode whoami       show account and plan\n  triumpcode logout\n\n  --yes       approve all writes and commands\n  --server    use another TRIUMP AI server\n`);
  process.exit(0);
}
if (cmd === 'login') { await login(); process.exit(0); }
if (cmd === 'logout') {
  if (cfg.token) await api('/api/cli/logout', { method: 'POST', body: {} }).catch(() => {});
  delete cfg.token; await saveConfig(cfg); line('  Logged out.'); process.exit(0);
}
if (!cfg.token) {
  line(`\n  ${bold('TriumpCode')} needs your TRIUMP AI account.`);
  await login();
}
const me = await api('/api/cli/me').catch(() => null);
if (!me) { line(red(`  Could not reach ${server()}.`)); process.exit(1); }
if (me.status === 401) { line(yellow('  Your login expired.')); await login(); }
if (cmd === 'whoami') {
  const m = await api('/api/cli/me');
  line(`  ${whoLabel(m.user)} · ${m.plan.toUpperCase()} · ${m.left.code}/${m.limits.code} tasks left today`);
  process.exit(0);
}

process.on('SIGINT', () => {
  if (running) { running.kill('SIGINT'); return; }
  if (aborter && !aborter.signal.aborted) { aborter.abort(); return; }
  line(); process.exit(0);
});

if (PRINT !== null) {
  await runTask(PRINT);
  process.exit(0);
}

banner(whoLabel(me.user), me.plan);
rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY, historySize: 200 });
rl.on('line', (l) => { const w = lineWaiters.shift(); if (w) { if (!process.stdin.isTTY) line(l); w(l); } else lineQueue.push(l); });
rl.on('close', () => { inputClosed = true; lineWaiters.splice(0).forEach((w) => w(null)); });
rl.on('SIGINT', () => {
  if (running) { running.kill('SIGINT'); return; }
  if (aborter && !aborter.signal.aborted) { aborter.abort(); return; }
  line(); rl.close(); process.exit(0);
});
const promptText = () => `${green('›')} `;
while (true) {
  const input = await nextLine(promptText());
  if (input === null) break;
  const q = input.trim();
  if (!q) continue;
  if (q === '/exit' || q === '/quit') break;
  if (q === '/help') { line(`  ${cyan('/clear')} new conversation · ${cyan('/usage')} plan & quota · ${cyan('/exit')} quit\n  Ctrl+C stops the current task. Writes and commands always ask first (a = always for this session).`); continue; }
  if (q === '/clear') { messages = []; line(dim('  Conversation cleared.')); continue; }
  if (q === '/usage') { const m = await api('/api/cli/me'); line(`  ${m.plan?.toUpperCase()} · ${m.left?.code}/${m.limits?.code} tasks left today`); continue; }
  aborter = null;
  await runTask(q);
  aborter = null;
}
rl.close();
process.exit(0);
