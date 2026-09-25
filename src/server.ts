/* TRIUMP AI — server statis + API. Node 24 menjalankan TypeScript langsung,
   tanpa build dan tanpa dependency.

     npm run serve            -> http://localhost:7474
     PORT=8080 npm run serve

   Hanya public/ yang disajikan. Data runtime (OTP, sesi, user) ada di data/.
   Rahasia (SMTP, Anthropic, X) dibaca dari .env — lihat .env.example.

   Endpoint:
     POST /api/otp/send     {email}        kirim kode 6 digit (email palsu ditolak)
     POST /api/otp/verify   {email, otp}   buat sesi (cookie HttpOnly)
     GET  /api/me                          user yang login (atau null)
     POST /api/logout
     GET  /api/x/login                     sign in / tautkan akun X (OAuth 2.0 PKCE)
     GET  /api/x/callback                  balikan dari X
     POST /api/x/disconnect
     POST /api/wallet/nonce {address}      pesan "Sign in with Ethereum" untuk ditandatangani
     POST /api/wallet/verify {address, signature}   sign in / tautkan wallet
     POST /api/wallet/disconnect
   Satu akun bisa punya email, X, dan wallet sekaligus; masuk lewat salah satunya.
   Studio, TriumpCode (web + CLI), paket & kuota: lihat src/apps.ts                    */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, stat, mkdir, rename } from 'node:fs/promises';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { resolveMx } from 'node:dns/promises';
import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect, type Socket } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { DISPOSABLE } from './disposable.ts';
import { recoverPersonalSign, keccak256 } from './evm.ts';
import { handleApps, handlePreview, type Ctx } from './apps.ts';

const ROOT = resolve(import.meta.dirname, '..', 'public');
const DATA = resolve(import.meta.dirname, '..', 'data');
const PORT = Number(process.env.PORT || 7474);
const HOST = process.env.HOST || '127.0.0.1';
const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const SITE_URL = env('SITE_URL', `http://localhost:${PORT}`).replace(/\/$/, '');

const CFG = {
  otpTtl: 600,          // kode berlaku 10 menit
  resendCooldown: 45,   // jeda antar kirim ke email yang sama (detik)
  maxAttempts: 5,       // salah input maksimal
  sendPerIpHour: 10,    // kirim OTP per IP per jam
  sessionDays: 30,
  askLimit: 8, askWindow: 60, askMaxChars: 1500,
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/* ---------------- penyimpanan JSON sederhana ---------------- */
type Otp = { hash: string; expires: number; sentAt: number; attempts: number };
type Session = { uid: string; expires: number };
type User = {
  id: string; createdAt: number; lastLogin: number;
  email?: string;
  x?: { id: string; username: string; name: string; linkedAt: number };
  wallet?: string;   // alamat 0x huruf kecil, terbukti lewat tanda tangan
  proUntil?: number; // Pro aktif sampai (ms) — hadiah 3 bulan untuk holder
  holderCheckedAt?: number;
};

async function load<T>(name: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(join(DATA, name), 'utf8')) as T; } catch { return fallback; }
}
const writing = new Map<string, Promise<void>>();
async function save(name: string, data: unknown) {
  const prev = writing.get(name) ?? Promise.resolve();
  const next = prev.then(async () => {
    await mkdir(DATA, { recursive: true });
    const tmp = join(DATA, `${name}.${process.pid}.tmp`);
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await rename(tmp, join(DATA, name));
  });
  writing.set(name, next.catch(() => {}));
  return next;
}
const otps = await load<Record<string, Otp>>('otps.json', {});
const sessions = await load<Record<string, Session>>('sessions.json', {});
const users = await load<Record<string, User>>('users.json', {});   // kunci = user.id
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/* ---------------- util HTTP ---------------- */
function send(res: ServerResponse, code: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function redirect(res: ServerResponse, to: string, headers: Record<string, string | string[]> = {}) {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store', ...headers });
  res.end();
}
async function body(req: IncomingMessage, limit = 20_000): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > limit) throw new Error('too large'); }
  try { const j = JSON.parse(raw || '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
function clientIp(req: IncomingMessage) {
  // di belakang Caddy: alamat asli ada di X-Forwarded-For
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}
function cookies(req: IncomingMessage) {
  const out: Record<string, string> = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const secure = SITE_URL.startsWith('https://');
function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/* rate limit di memori: kunci -> daftar waktu */
const hits = new Map<string, number[]>();
function limited(key: string, limit: number, windowSec: number) {
  const now = Date.now(), from = now - windowSec * 1000;
  const list = (hits.get(key) || []).filter(t => t > from);
  if (list.length >= limit) { hits.set(key, list); return true; }
  list.push(now); hits.set(key, list); return false;
}

function currentUser(req: IncomingMessage): { sid: string; user: User } | null {
  const sid = cookies(req).tri_sid;
  if (!sid) return null;
  const s = sessions[sha(sid)];
  if (!s || s.expires < Date.now()) return null;
  const user = users[s.uid];
  return user ? { sid, user } : null;
}
const publicUser = (u: User | null) => u ? {
  email: u.email || null,
  x: u.x ? { username: u.x.username, name: u.x.name } : null,
  wallet: u.wallet || null,
} : null;

const findUser = (fn: (u: User) => boolean) => Object.values(users).find(fn) || null;
function newUser(): User {
  const now = Date.now(), id = randomBytes(12).toString('base64url');
  return users[id] = { id, createdAt: now, lastLogin: now };
}
/* Identitas yang baru dibuktikan: kalau sudah login -> tautkan ke akun itu,
   kalau belum -> masuk ke akun pemiliknya (atau buat akun baru).
   Identitas milik akun LAIN tidak bisa dipindah diam-diam: hasilnya 'taken'. */
function claim(req: IncomingMessage, owner: User | null): { user: User; linked: boolean } | 'taken' {
  const me = currentUser(req)?.user || null;
  if (me) {
    if (owner && owner.id !== me.id) return 'taken';
    return { user: me, linked: true };
  }
  return { user: owner || newUser(), linked: false };
}
async function startSession(user: User): Promise<string> {
  const now = Date.now();
  user.lastLogin = now;
  for (const [sk, s] of Object.entries(sessions)) if (s.expires < now) delete sessions[sk];
  const sid = randomBytes(32).toString('base64url');
  sessions[sha(sid)] = { uid: user.id, expires: now + CFG.sessionDays * 86400_000 };
  await Promise.all([save('sessions.json', sessions), save('users.json', users)]);
  return cookie('tri_sid', sid, CFG.sessionDays * 86400);
}
/* sisa cara masuk kalau `drop` dilepas — akun tidak boleh jadi tanpa pintu */
const loginMethods = (u: User) => [u.email, u.x, u.wallet].filter(Boolean).length;

/* ---------------- validasi email: tolak email palsu ---------------- */
async function checkEmail(raw: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email))
    return { ok: false, error: 'Please enter a valid email address.' };
  const domain = email.split('@')[1];
  const parts = domain.split('.');
  // cocokkan domain dan semua domain induknya (mis. xyz.mailinator.com)
  for (let i = 0; i < parts.length - 1; i++) {
    if (DISPOSABLE.has(parts.slice(i).join('.')))
      return { ok: false, error: 'Temporary / disposable email addresses are not allowed. Please use your real email.' };
  }
  if (/^(test|example|invalid|localhost)$/.test(parts[parts.length - 1]) || /^example\.(com|net|org)$/.test(domain))
    return { ok: false, error: 'Please use your real email address.' };
  // domain wajib punya server surat (MX) — domain karangan pasti gagal di sini
  try {
    const mx = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 5000)),
    ]);
    if (!mx.length || mx.every(m => !m.exchange || m.exchange === '.'))
      return { ok: false, error: 'This email domain cannot receive mail. Please use your real email.' };
  } catch (e: any) {
    if (e?.code === 'ENOTFOUND' || e?.code === 'ENODATA')
      return { ok: false, error: 'This email domain does not exist. Please check the address.' };
    // DNS sedang bermasalah: jangan kunci user asli, kode OTP tetap membuktikan kepemilikan inbox
    console.warn('[mx] lookup gagal untuk', domain, e?.code || e);
  }
  return { ok: true, email };
}

/* ---------------- SMTP (tanpa dependency) ---------------- */
async function sendMail(to: string, subject: string, html: string) {
  const host = env('SMTP_HOST'), port = Number(env('SMTP_PORT', '465'));
  const user = env('SMTP_USER'), pass = env('SMTP_PASS');
  const from = env('SMTP_FROM', user), fromName = env('SMTP_FROM_NAME', 'TRIUMP AI');
  if (!host || !user || !pass) throw new Error('SMTP is not configured (.env)');

  // 465 = TLS langsung, 587 = STARTTLS. SMTP_SECURE=true/false memaksa salah satunya.
  const implicitTls = env('SMTP_SECURE') ? env('SMTP_SECURE') === 'true' : port === 465;
  let sock: Socket = implicitTls
    ? tlsConnect({ host, port, servername: host })
    : netConnect({ host, port });
  sock.setTimeout(20_000, () => sock.destroy(new Error('SMTP timeout')));
  let buf = '', waiters: ((line: string) => void)[] = [], failed: Error | null = null;
  const onData = (d: Buffer) => {
    buf += d.toString('utf8');
    let i: number;
    // balasan multi-baris: "250-..." lanjut sampai "250 ..."
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) waiters.shift()?.(line);
    }
  };
  const attach = (s: Socket) => { s.on('data', onData); s.on('error', e => { failed = e; waiters.splice(0).forEach(w => w('000 ' + e.message)); }); };
  attach(sock);
  const reply = () => new Promise<string>(r => failed ? r('000 ' + failed.message) : waiters.push(r));
  const expect = async (codes: string[], cmd?: string) => {
    const p = reply();
    if (cmd !== undefined) sock.write(cmd + '\r\n');
    const line = await p;
    if (!codes.includes(line.slice(0, 3))) throw new Error(`SMTP: ${cmd?.startsWith('AUTH') || !cmd ? '' : cmd.split(' ')[0] + ' -> '}${line}`);
    return line;
  };
  try {
    await expect(['220']);
    await expect(['250'], `EHLO ${env('SMTP_HELO', 'triumpai.com')}`);
    if (!implicitTls) {
      await expect(['220'], 'STARTTLS');
      sock.removeListener('data', onData);
      sock = tlsConnect({ socket: sock, servername: host });
      attach(sock);
      await new Promise<void>((ok, bad) => { sock.once('secureConnect', ok); sock.once('error', bad); });
      await expect(['250'], `EHLO ${env('SMTP_HELO', 'triumpai.com')}`);
    }
    await expect(['334'], 'AUTH LOGIN');
    await expect(['334'], Buffer.from(user).toString('base64'));
    await expect(['235'], Buffer.from(pass).toString('base64'));
    await expect(['250'], `MAIL FROM:<${from}>`);
    await expect(['250', '251'], `RCPT TO:<${to}>`);
    await expect(['354'], 'DATA');
    const head = [
      `From: ${fromName} <${from}>`, `To: <${to}>`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64',
      `Date: ${new Date().toUTCString()}`, `Message-ID: <${randomBytes(12).toString('hex')}@${from.split('@')[1]}>`,
    ].join('\r\n');
    const b64 = Buffer.from(html).toString('base64').replace(/.{76}/g, '$&\r\n');
    await expect(['250'], `${head}\r\n\r\n${b64}\r\n.`);
    sock.write('QUIT\r\n');
  } finally {
    sock.end();
  }
}

function otpEmail(code: string, ttlMin: number) {
  return '<!doctype html><html><body style="margin:0;background:#07120f;font-family:Arial,Helvetica,sans-serif">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#07120f;padding:32px 0"><tr><td align="center">'
    + '<table width="440" cellpadding="0" cellspacing="0" style="max-width:440px;background:#0d1f1a;border:1px solid rgba(255,255,255,.08);border-radius:16px;overflow:hidden">'
    + '<tr><td style="padding:28px 30px 8px"><span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-.5px">TRIUMP <span style="color:#39ff14">AI</span></span></td></tr>'
    + `<tr><td style="padding:6px 30px 0;color:#9fbdb2;font-size:14px;line-height:1.6">Use this code to sign in. It expires in ${ttlMin} minutes.</td></tr>`
    + `<tr><td style="padding:22px 30px"><div style="background:rgba(57,255,20,.08);border:1px solid rgba(57,255,20,.3);border-radius:12px;padding:18px;text-align:center;font-size:38px;font-weight:900;letter-spacing:10px;color:#39ff14">${code}</div></td></tr>`
    + '<tr><td style="padding:0 30px 26px;color:#5f7a70;font-size:12px;line-height:1.6">If you did not request this, you can safely ignore this email.<br>© 2026 TRIUMP AI · triumpai.com</td></tr>'
    + '</table></td></tr></table></body></html>';
}

/* ---------------- handler API ---------------- */
async function otpSend(req: IncomingMessage, res: ServerResponse) {
  const b = await body(req);
  const chk = await checkEmail(String(b.email || ''));
  if (!chk.ok) return send(res, 400, chk);
  const email = chk.email, now = Date.now();
  for (const [k, v] of Object.entries(otps)) if (v.expires < now) delete otps[k];
  const k = sha(email), rec = otps[k];
  if (rec && now - rec.sentAt < CFG.resendCooldown * 1000)
    return send(res, 429, { ok: false, error: 'Please wait a moment before requesting another code.' });
  if (limited('send:' + clientIp(req), CFG.sendPerIpHour, 3600))
    return send(res, 429, { ok: false, error: 'Too many codes requested. Try again later.' });

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  try {
    await sendMail(email, 'Your TRIUMP AI login code', otpEmail(code, Math.round(CFG.otpTtl / 60)));
  } catch (e: any) {
    console.error('[smtp]', e?.message || e);
    // server surat tujuan menolak alamatnya -> kotak surat tidak ada
    if (/RCPT -> 5\d\d/.test(e?.message || '')) return send(res, 400, { ok: false, error: 'This mailbox does not exist. Please check the address.' });
    return send(res, 500, { ok: false, error: 'Could not send the email right now. Please try again.' });
  }
  otps[k] = { hash: sha(code + email), expires: now + CFG.otpTtl * 1000, sentAt: now, attempts: 0 };
  await save('otps.json', otps);
  send(res, 200, { ok: true, email, ttl: CFG.otpTtl });
}

async function otpVerify(req: IncomingMessage, res: ServerResponse) {
  const b = await body(req);
  const email = String(b.email || '').trim().toLowerCase();
  const code = String(b.otp || '').replace(/\D/g, '');
  const k = sha(email), rec = otps[k], now = Date.now();
  if (!rec || rec.expires < now) return send(res, 400, { ok: false, error: 'Code expired. Request a new one.' });
  if (rec.attempts >= CFG.maxAttempts) {
    delete otps[k]; await save('otps.json', otps);
    return send(res, 429, { ok: false, error: 'Too many attempts. Request a new code.' });
  }
  const a = Buffer.from(rec.hash), c = Buffer.from(sha(code + email));
  if (a.length !== c.length || !timingSafeEqual(a, c)) {
    rec.attempts++; await save('otps.json', otps);
    return send(res, 400, { ok: false, error: 'Incorrect code.' });
  }
  delete otps[k]; await save('otps.json', otps);
  const got = claim(req, findUser(u => u.email === email));
  if (got === 'taken') return send(res, 409, { ok: false, error: 'That email is already used by another account.' });
  got.user.email = email;
  if (got.linked) { await save('users.json', users); return send(res, 200, { ok: true, user: publicUser(got.user) }); }
  send(res, 200, { ok: true, user: publicUser(got.user) }, { 'Set-Cookie': await startSession(got.user) });
}

async function logout(req: IncomingMessage, res: ServerResponse) {
  const sid = cookies(req).tri_sid;
  if (sid && sessions[sha(sid)]) { delete sessions[sha(sid)]; await save('sessions.json', sessions); }
  send(res, 200, { ok: true }, { 'Set-Cookie': cookie('tri_sid', '', 0) });
}

/* ---------------- X (Twitter) OAuth 2.0 + PKCE ---------------- */
const X_CLIENT_ID = env('X_CLIENT_ID'), X_CLIENT_SECRET = env('X_CLIENT_SECRET');
const X_REDIRECT = env('X_REDIRECT_URI', `${SITE_URL}/api/x/callback`);
const xPending = new Map<string, { verifier: string; uid: string | null; back: string; expires: number }>();

function xLogin(req: IncomingMessage, res: ServerResponse, url: URL) {
  const me = currentUser(req);
  // kembali ke halaman asal (hanya path lokal)
  const back = /^\/[a-z0-9\-]*(\.html)?$/i.test(url.searchParams.get('back') || '') ? url.searchParams.get('back')! : '/';
  if (!X_CLIENT_ID) return redirect(res, back + '?x=notconfigured');
  const now = Date.now();
  for (const [k, v] of xPending) if (v.expires < now) xPending.delete(k);
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  xPending.set(state, { verifier, uid: me?.user.id || null, back, expires: now + 10 * 60_000 });
  const q = new URLSearchParams({
    response_type: 'code', client_id: X_CLIENT_ID, redirect_uri: X_REDIRECT,
    scope: 'tweet.read users.read', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  redirect(res, `https://x.com/i/oauth2/authorize?${q}`);
}

async function xCallback(req: IncomingMessage, res: ServerResponse, url: URL) {
  const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
  const pend = xPending.get(state); xPending.delete(state);
  const back = pend?.back || '/';
  if (url.searchParams.get('error')) return redirect(res, back + '?x=denied');
  if (!pend || pend.expires < Date.now() || !code) return redirect(res, back + '?x=error');
  // mulai sebagai user A tapi balik sebagai user lain -> tolak
  if (pend.uid && currentUser(req)?.user.id !== pend.uid) return redirect(res, back + '?x=error');
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: X_REDIRECT, code_verifier: pend.verifier, client_id: X_CLIENT_ID });
    // app "confidential" (punya client secret) wajib pakai Basic auth
    if (X_CLIENT_SECRET) headers.Authorization = 'Basic ' + Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64');
    const tr = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers, body: form });
    const tok: any = await tr.json().catch(() => ({}));
    if (!tr.ok || !tok.access_token) { console.error('[x] token', tr.status, tok); return redirect(res, '/?x=error'); }
    const ur = await fetch('https://api.x.com/2/users/me', { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const u: any = await ur.json().catch(() => ({}));
    if (!ur.ok || !u.data?.id) { console.error('[x] users/me', ur.status, u); return redirect(res, '/?x=error'); }
    const got = claim(req, findUser(x => x.x?.id === u.data.id));
    if (got === 'taken') return redirect(res, back + '?x=taken');
    // token X tidak disimpan: yang dibutuhkan hanya identitas akun
    got.user.x = { id: u.data.id, username: u.data.username, name: u.data.name, linkedAt: Date.now() };
    if (got.linked) { await save('users.json', users); return redirect(res, back + '?x=connected'); }
    redirect(res, back + '?x=signedin', { 'Set-Cookie': await startSession(got.user) });
  } catch (e) {
    console.error('[x]', e);
    redirect(res, back + '?x=error');
  }
}

/* ---------------- wallet: Sign in with Ethereum (EIP-4361) ---------------- */
const CHAIN_ID = 4663; // Robinhood Chain
const walletNonces = new Map<string, { message: string; expires: number }>();

function checksum(addr: string) {
  const a = addr.toLowerCase().replace(/^0x/, '');
  const h = Buffer.from(keccak256(Buffer.from(a, 'ascii'))).toString('hex');
  return '0x' + [...a].map((c, i) => parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c).join('');
}

async function walletNonce(req: IncomingMessage, res: ServerResponse) {
  const b = await body(req);
  const address = String(b.address || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return send(res, 400, { ok: false, error: 'Invalid wallet address.' });
  if (limited('nonce:' + clientIp(req), 30, 600)) return send(res, 429, { ok: false, error: 'Too many requests. Try again later.' });
  const now = Date.now();
  for (const [k, v] of walletNonces) if (v.expires < now) walletNonces.delete(k);
  const site = new URL(SITE_URL);
  const message = [
    `${site.host} wants you to sign in with your Ethereum account:`,
    checksum(address), '',
    'Sign in to TRIUMP AI. This only proves you own this wallet — no transaction, no gas fee.', '',
    `URI: ${site.origin}`, 'Version: 1', `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${randomBytes(12).toString('hex')}`, `Issued At: ${new Date(now).toISOString()}`,
  ].join('\n');
  walletNonces.set(address.toLowerCase(), { message, expires: now + 5 * 60_000 });
  send(res, 200, { ok: true, message });
}

async function walletVerify(req: IncomingMessage, res: ServerResponse) {
  const b = await body(req);
  const address = String(b.address || '').trim().toLowerCase();
  const pend = walletNonces.get(address);
  walletNonces.delete(address); // sekali pakai
  if (!pend || pend.expires < Date.now()) return send(res, 400, { ok: false, error: 'Sign-in request expired. Please try again.' });
  const signer = recoverPersonalSign(pend.message, String(b.signature || ''));
  if (!signer || signer !== address) return send(res, 401, { ok: false, error: 'Signature does not match this wallet.' });
  const got = claim(req, findUser(u => u.wallet === address));
  if (got === 'taken') return send(res, 409, { ok: false, error: 'That wallet is already linked to another account.' });
  got.user.wallet = address;
  if (got.linked) { await save('users.json', users); return send(res, 200, { ok: true, user: publicUser(got.user) }); }
  send(res, 200, { ok: true, user: publicUser(got.user) }, { 'Set-Cookie': await startSession(got.user) });
}

async function unlink(req: IncomingMessage, res: ServerResponse, field: 'x' | 'wallet' | 'email') {
  const me = currentUser(req);
  if (!me) return send(res, 401, { ok: false, error: 'Not signed in.' });
  if (!me.user[field]) return send(res, 200, { ok: true, user: publicUser(me.user) });
  if (loginMethods(me.user) < 2) return send(res, 400, { ok: false, error: 'This is your only way to sign in. Link another one first.' });
  delete me.user[field]; await save('users.json', users);
  send(res, 200, { ok: true, user: publicUser(me.user) });
}

/* ---------------- file statis ---------------- */
async function serveStatic(res: ServerResponse, pathname: string, head: boolean) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT)) return send(res, 403, { ok: false });
  try {
    let f = file, st = await stat(f);
    if (st.isDirectory()) { f = join(f, 'index.html'); st = await stat(f); }
    const ext = extname(f).toLowerCase();
    const long = /\.(jpg|jpeg|png|webp|svg|woff2|ico)$/.test(ext);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      // html/js/css selalu dicek ulang supaya ganti CA langsung kebaca
      'Cache-Control': long ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (head) return res.end();
    res.end(await readFile(f));
  } catch {
    // /token -> token.html
    if (!extname(p)) {
      try { await stat(join(ROOT, p + '.html')); return serveStatic(res, p + '.html', head); } catch {}
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found');
  }
}

const ctx: Ctx = {
  currentUser, send, saveUsers: () => save('users.json', users), users, limited, clientIp, siteUrl: SITE_URL,
  body: (req, limit) => body(req, limit),
};

createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const m = req.method || 'GET', p = url.pathname;
  try {
    if (p.startsWith('/api/')) {
      if (m === 'POST' && p === '/api/otp/send') return await otpSend(req, res);
      if (m === 'POST' && p === '/api/otp/verify') return await otpVerify(req, res);
      if (m === 'GET' && p === '/api/me') return send(res, 200, { ok: true, user: publicUser(currentUser(req)?.user || null) });
      if (m === 'POST' && p === '/api/logout') return await logout(req, res);
      if (m === 'GET' && p === '/api/x/login') return xLogin(req, res, url);
      if (m === 'GET' && p === '/api/x/callback') return await xCallback(req, res, url);
      if (m === 'POST' && p === '/api/x/disconnect') return await unlink(req, res, 'x');
      if (m === 'POST' && p === '/api/wallet/nonce') return await walletNonce(req, res);
      if (m === 'POST' && p === '/api/wallet/verify') return await walletVerify(req, res);
      if (m === 'POST' && p === '/api/wallet/disconnect') return await unlink(req, res, 'wallet');
      if (await handleApps(ctx, req, res, url)) return;
      return send(res, 404, { ok: false, error: 'Not found' });
    }
    if (m !== 'GET' && m !== 'HEAD') return send(res, 405, { ok: false });
    if (p.startsWith('/preview/') && await handlePreview(req, res, p)) return;
    await serveStatic(res, p, m === 'HEAD');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { ok: false, error: 'Server error' });
  }
}).listen(PORT, HOST, () => {
  console.log(`TRIUMP AI  ->  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  SMTP ${env('SMTP_PASS') ? 'siap' : 'BELUM diisi'} · AI ${env('ANTHROPIC_API_KEY') ? 'siap' : 'BELUM diisi (ANTHROPIC_API_KEY)'} · X ${X_CLIENT_ID ? 'siap' : 'BELUM diisi (X_CLIENT_ID)'}`);
});
