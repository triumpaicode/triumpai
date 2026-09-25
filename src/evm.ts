/* Verifikasi tanda tangan wallet EVM (personal_sign / EIP-191) tanpa dependency:
   keccak256 + pemulihan kunci publik secp256k1 -> alamat 0x...
   Dipakai untuk "Sign in with wallet": wallet menandatangani pesan berisi nonce,
   server memulihkan alamat penanda tangan dan membandingkannya.              */

/* ---------------- keccak256 ---------------- */
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M64 = (1n << 64n) - 1n;
const rotl = (x: bigint, n: number) => n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64;

function keccakF(s: bigint[]) {
  for (let round = 0; round < 24; round++) {
    const c = [0, 1, 2, 3, 4].map(x => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
    }
    const b = new Array<bigint>(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++)
      b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++)
      s[x + 5 * y] = b[x + 5 * y] ^ (~b[(x + 1) % 5 + 5 * y] & M64 & b[(x + 2) % 5 + 5 * y]);
    s[0] ^= RC[round];
  }
}

export function keccak256(data: Uint8Array): Uint8Array {
  const rate = 136, s = new Array<bigint>(25).fill(0n);
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
  padded.set(data);
  padded[data.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + j]);
      s[i] ^= lane;
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((s[i] >> BigInt(8 * j)) & 0xffn);
  return out;
}

/* ---------------- secp256k1 ---------------- */
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G: Pt = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
               0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
type Pt = [bigint, bigint] | null;

const mod = (a: bigint, m = P) => { const r = a % m; return r < 0n ? r + m : r; };
function inv(a: bigint, m = P) {
  let [lo, hi, x0, x1] = [mod(a, m), m, 1n, 0n];
  while (lo > 1n) { const q = hi / lo; [lo, hi] = [hi - q * lo, lo]; [x0, x1] = [x1 - q * x0, x0]; }
  return mod(x0, m);
}
function powmod(b: bigint, e: bigint, m = P) {
  let r = 1n; b = mod(b, m);
  while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; }
  return r;
}
function add(a: Pt, b: Pt): Pt {
  if (!a) return b; if (!b) return a;
  if (a[0] === b[0]) {
    if (mod(a[1] + b[1]) === 0n) return null;
    const l = mod(3n * a[0] * a[0] * inv(2n * a[1]));
    const x = mod(l * l - 2n * a[0]);
    return [x, mod(l * (a[0] - x) - a[1])];
  }
  const l = mod((b[1] - a[1]) * inv(b[0] - a[0]));
  const x = mod(l * l - a[0] - b[0]);
  return [x, mod(l * (a[0] - x) - a[1])];
}
function mul(p: Pt, k: bigint): Pt {
  let r: Pt = null, q = p; k = mod(k, N);
  while (k > 0n) { if (k & 1n) r = add(r, q); q = add(q, q); k >>= 1n; }
  return r;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const big = (b: Uint8Array) => BigInt('0x' + (hex(b) || '0'));
const be32 = (n: bigint) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');

export function pubToAddress(pt: [bigint, bigint]) {
  return '0x' + hex(keccak256(Buffer.concat([be32(pt[0]), be32(pt[1])])).slice(12));
}
export function addressOfPrivateKey(k: bigint) {
  return pubToAddress(mul(G, k) as [bigint, bigint]);
}

/** hash pesan persis seperti personal_sign / eth_sign di wallet (EIP-191) */
export function hashPersonalMessage(message: string) {
  const m = Buffer.from(message, 'utf8');
  return keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${m.length}`, 'utf8'), m]));
}

/** alamat (huruf kecil) yang menandatangani `message`, atau null kalau tanda tangan rusak */
export function recoverPersonalSign(message: string, signature: string): string | null {
  const sig = Buffer.from(signature.replace(/^0x/, ''), 'hex');
  if (sig.length !== 65) return null;
  const r = big(sig.subarray(0, 32)), s = big(sig.subarray(32, 64));
  let v = sig[64]; if (v >= 27) v -= 27;
  if (v > 1 || r <= 0n || r >= N || s <= 0n || s >= N) return null;
  const y2 = mod(r * r * r + 7n);
  let y = powmod(y2, (P + 1n) / 4n);
  if (mod(y * y) !== y2) return null;
  if (Number(y & 1n) !== v) y = P - y;
  const e = big(hashPersonalMessage(message));
  const ri = inv(r, N);
  const Q = add(mul([r, y], mod(s * ri, N)), mul(G, mod(-e * ri, N)));
  return Q ? pubToAddress(Q) : null;
}
