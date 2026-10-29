'use strict';
/**
 * Server Rekap Posyandu — database Turso (libSQL), siap di-hosting di Vercel.
 * Lokal :  npm start     (lalu buka http://localhost:3000)
 * Vercel:  api/index.js memanggil `handler` dari berkas ini.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { signJwt, verifyJwt, hashPassword, checkPassword } = require('./src/auth');
const db = require('./src/db');
const { JENIS, validasiData, NAMA_BULAN } = require('./src/schemas');
const { buatPdfRekap } = require('./src/rekappdf');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const KODE_DAFTAR = process.env.KODE_DAFTAR || ''; // bila diisi, pendaftaran kader baru wajib memakai kode ini
const TOKEN_HARI = Number(process.env.TOKEN_HARI) || 7;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------------------------------------------------------------- util */
class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const bad = (m, extra) => new HttpError(400, m, extra);

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readJson(req) {
  // Di Vercel, `req.body` bisa sudah terisi (di-parse otomatis). Di Node biasa nilainya undefined.
  let pre;
  try { pre = req.body; } catch { return Promise.reject(bad('Format data tidak valid.')); }
  if (pre !== undefined && pre !== null) {
    if (Buffer.isBuffer(pre)) pre = pre.toString('utf8');
    if (typeof pre === 'string') {
      try { return Promise.resolve(pre ? JSON.parse(pre) : {}); } catch { return Promise.reject(bad('Format data tidak valid.')); }
    }
    return Promise.resolve(pre);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) { reject(new HttpError(413, 'Data terlalu besar.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('Format data tidak valid.')); }
    });
    req.on('error', reject);
  });
}

const str = (v, max, nama, { wajib = false } = {}) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (wajib && !s) throw bad(`${nama} wajib diisi.`);
  if (s.length > max) throw bad(`${nama} terlalu panjang (maksimal ${max} huruf).`);
  return s;
};
const int = (v, min, max, nama) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${nama} tidak valid.`);
  return n;
};

/* ------------------------------------------------- pembatas percobaan login */
const gagal = new Map(); // kunci -> {n, sampai}
function cekBatas(key) {
  const g = gagal.get(key);
  if (g && g.sampai > Date.now() && g.n >= 8) {
    throw new HttpError(429, 'Terlalu banyak percobaan. Silakan coba lagi beberapa menit lagi.');
  }
}
function catatGagal(key) {
  const g = gagal.get(key);
  if (!g || g.sampai < Date.now()) gagal.set(key, { n: 1, sampai: Date.now() + 15 * 60_000 });
  else g.n++;
}
setInterval(() => { for (const [k, v] of gagal) if (v.sampai < Date.now()) gagal.delete(k); }, 10 * 60_000).unref();

/* ---------------------------------------------------------------- rute */
const routes = [];
const route = (method, pattern, { auth = true } = {}, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, auth, handler });
};

const publicUser = (u) => ({ id: u.id, username: u.username, nama: u.nama });
const tokenUntuk = (u) => signJwt({ sub: u.id, u: u.username }, TOKEN_HARI * 86400);

/* --- umum --- */
route('GET', '/api/config', { auth: false }, () => ({ kodeDaftar: Boolean(KODE_DAFTAR) }));
route('GET', '/api/jenis', { auth: false }, () => ({
  bulan: NAMA_BULAN,
  jenis: Object.values(JENIS).map(({ id, nama, ikon, deskripsi, judul, subjudul, sementara, tree }) =>
    ({ id, nama, ikon, deskripsi, judul, subjudul, sementara, tree })),
}));

/* --- akun --- */
route('POST', '/api/auth/register', { auth: false }, async ({ body, ip }) => {
  cekBatas(`reg:${ip}`);
  if (KODE_DAFTAR && body.kode !== KODE_DAFTAR) {
    catatGagal(`reg:${ip}`);
    throw new HttpError(403, 'Kode pendaftaran salah. Tanyakan kode kepada pengurus.');
  }
  const nama = str(body.nama, 60, 'Nama lengkap', { wajib: true });
  const username = str(body.username, 30, 'Nama pengguna', { wajib: true });
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
    throw bad('Nama pengguna hanya boleh huruf, angka, titik, strip; minimal 3 karakter, tanpa spasi.');
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 6 || password.length > 100) throw bad('Kata sandi minimal 6 karakter.');
  if (await db.get('SELECT 1 AS x FROM users WHERE lower(username) = lower(?)', [username])) {
    throw new HttpError(409, 'Nama pengguna sudah dipakai. Silakan pilih yang lain.');
  }
  const r = await db.get('INSERT INTO users (username, nama, pass_hash) VALUES (?,?,?) RETURNING id',
    [username, nama, hashPassword(password)]);
  const u = { id: Number(r.id), username, nama };
  return { status: 201, body: { token: tokenUntuk(u), user: publicUser(u) } };
});

route('POST', '/api/auth/login', { auth: false }, async ({ body, ip }) => {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const key = `login:${ip}:${username.toLowerCase()}`;
  cekBatas(key);
  const u = await db.get('SELECT * FROM users WHERE lower(username) = lower(?)', [username]);
  const ok = u ? checkPassword(String(body.password || ''), u.pass_hash) : (checkPassword('x', 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '=='), false);
  if (!ok) { catatGagal(key); throw new HttpError(401, 'Nama pengguna atau kata sandi salah.'); }
  gagal.delete(key);
  return { token: tokenUntuk(u), user: publicUser(u) };
});

route('GET', '/api/me', {}, ({ user }) => ({ user: publicUser(user) }));

route('POST', '/api/me/password', {}, async ({ user, body }) => {
  const lama = String(body.lama || '');
  const baru = typeof body.baru === 'string' ? body.baru : '';
  if (!checkPassword(lama, user.pass_hash)) throw new HttpError(400, 'Kata sandi lama salah.');
  if (baru.length < 6 || baru.length > 100) throw bad('Kata sandi baru minimal 6 karakter.');
  await db.run('UPDATE users SET pass_hash = ? WHERE id = ?', [hashPassword(baru), user.id]);
  return { ok: true };
});

/* --- posyandu --- */
function bacaPosyandu(body) {
  return {
    nama: str(body.nama, 80, 'Nama posyandu', { wajib: true }),
    dusun: str(body.dusun, 40, 'Dusun'),
    rt: str(body.rt, 10, 'RT'),
    rw: str(body.rw, 10, 'RW'),
    desa_kel: str(body.desa_kel, 80, 'Desa/Kelurahan', { wajib: true }),
    kecamatan: str(body.kecamatan, 60, 'Kecamatan', { wajib: true }),
  };
}
async function posyanduMilik(user, id) {
  const p = await db.get('SELECT * FROM posyandu WHERE id = ? AND user_id = ?', [Number(id) || 0, user.id]);
  if (!p) throw new HttpError(404, 'Posyandu tidak ditemukan.');
  return p;
}

route('GET', '/api/posyandu', {}, async ({ user }) => ({
  posyandu: await db.all('SELECT id, nama, dusun, rt, rw, desa_kel, kecamatan FROM posyandu WHERE user_id = ? ORDER BY nama', [user.id]),
}));
route('POST', '/api/posyandu', {}, async ({ user, body }) => {
  const p = bacaPosyandu(body);
  const r = await db.get('INSERT INTO posyandu (user_id, nama, dusun, rt, rw, desa_kel, kecamatan) VALUES (?,?,?,?,?,?,?) RETURNING id',
    [user.id, p.nama, p.dusun, p.rt, p.rw, p.desa_kel, p.kecamatan]);
  return { status: 201, body: { posyandu: { id: Number(r.id), ...p } } };
});
route('PUT', '/api/posyandu/:id', {}, async ({ user, body, params }) => {
  const cur = await posyanduMilik(user, params.id);
  const p = bacaPosyandu(body);
  await db.run('UPDATE posyandu SET nama=?, dusun=?, rt=?, rw=?, desa_kel=?, kecamatan=? WHERE id=?',
    [p.nama, p.dusun, p.rt, p.rw, p.desa_kel, p.kecamatan, cur.id]);
  return { posyandu: { id: cur.id, ...p } };
});
route('DELETE', '/api/posyandu/:id', {}, async ({ user, params }) => {
  const cur = await posyanduMilik(user, params.id);
  await db.tx([
    { sql: 'DELETE FROM rekap WHERE posyandu_id = ?', args: [cur.id] },
    { sql: 'DELETE FROM posyandu WHERE id = ?', args: [cur.id] },
  ]);
  return { ok: true };
});

/* --- rekap --- */
const cekJenis = (j) => { if (!JENIS[j]) throw bad('Jenis rekapitulasi tidak dikenal.'); return j; };
function bacaTanggal(v, tahun, bulan) {
  if (v === null || v === undefined || v === '') throw bad('Tanggal wajib dipilih. Setiap tanggal berbeda menjadi satu baris baru di rekap.');
  const t = int(v, 1, 31, 'Tanggal');
  if (t > new Date(tahun, bulan, 0).getDate()) throw bad(`Bulan ${NAMA_BULAN[bulan - 1]} ${tahun} tidak punya tanggal ${t}.`);
  return t;
}
const barisRekap = (r) => ({
  tanggal: r.tanggal,
  id: r.id, posyandu_id: r.posyandu_id, jenis: r.jenis, tahun: r.tahun, bulan: r.bulan,
  data: JSON.parse(r.data), updated_at: r.updated_at,
});
async function rekapMilik(user, id) {
  const r = await db.get(`SELECT r.* FROM rekap r JOIN posyandu p ON p.id = r.posyandu_id
                        WHERE r.id = ? AND p.user_id = ?`, [Number(id) || 0, user.id]);
  if (!r) throw new HttpError(404, 'Rekap tidak ditemukan.');
  return r;
}

route('GET', '/api/rekap', {}, async ({ user, query }) => {
  const p = await posyanduMilik(user, query.get('posyandu_id'));
  const jenis = cekJenis(query.get('jenis'));
  const tahun = int(query.get('tahun'), 2000, 2100, 'Tahun');
  const rows = await db.all('SELECT id, bulan, tanggal, updated_at FROM rekap WHERE posyandu_id=? AND jenis=? AND tahun=? ORDER BY bulan, COALESCE(tanggal,0), id',
    [p.id, jenis, tahun]);
  return { rekap: rows };
});
route('GET', '/api/rekap/:id', {}, async ({ user, params }) => ({ rekap: barisRekap(await rekapMilik(user, params.id)) }));
route('POST', '/api/rekap', {}, async ({ user, body }) => {
  const p = await posyanduMilik(user, body.posyandu_id);
  const jenis = cekJenis(body.jenis);
  const tahun = int(body.tahun, 2000, 2100, 'Tahun');
  const bulan = int(body.bulan, 1, 12, 'Bulan');
  const v = validasiData(jenis, body.data);
  if (v.error) throw bad(v.error);
  const tanggal = bacaTanggal(body.tanggal, tahun, bulan);
  const ada = await db.get('SELECT id FROM rekap WHERE posyandu_id=? AND jenis=? AND tahun=? AND bulan=? AND COALESCE(tanggal,0)=?', [p.id, jenis, tahun, bulan, tanggal]);
  if (ada) throw new HttpError(409, `Rekap tanggal ${tanggal} ${NAMA_BULAN[bulan - 1]} ${tahun} sudah ada. Pilih tanggal lain untuk menambah baris baru, atau buka rekap tersebut lalu pilih "Ubah".`, { id: ada.id });
  const r = await db.get('INSERT INTO rekap (posyandu_id, jenis, tahun, bulan, tanggal, data) VALUES (?,?,?,?,?,?) RETURNING id',
    [p.id, jenis, tahun, bulan, tanggal, JSON.stringify(v.data)]);
  return { status: 201, body: { id: Number(r.id) } };
});
route('PUT', '/api/rekap/:id', {}, async ({ user, params, body }) => {
  const cur = await rekapMilik(user, params.id);
  const v = validasiData(cur.jenis, body.data);
  if (v.error) throw bad(v.error);
  const tanggal = bacaTanggal(body.tanggal, cur.tahun, cur.bulan);
  const bentrok = await db.get('SELECT id FROM rekap WHERE posyandu_id=? AND jenis=? AND tahun=? AND bulan=? AND COALESCE(tanggal,0)=? AND id<>?',
    [cur.posyandu_id, cur.jenis, cur.tahun, cur.bulan, tanggal, cur.id]);
  if (bentrok) throw new HttpError(409, `Tanggal ${tanggal} ${NAMA_BULAN[cur.bulan - 1]} ${cur.tahun} sudah punya rekap sendiri.`, { id: bentrok.id });
  await db.run('UPDATE rekap SET data=?, tanggal=?, updated_at=? WHERE id=?', [JSON.stringify(v.data), tanggal, db.sekarang(), cur.id]);
  return { ok: true };
});
route('DELETE', '/api/rekap/:id', {}, async ({ user, params }) => {
  const cur = await rekapMilik(user, params.id);
  await db.run('DELETE FROM rekap WHERE id = ?', [cur.id]);
  return { ok: true };
});

/* --- PDF --- */
route('GET', '/api/pdf', {}, async ({ user, query }) => {
  const p = await posyanduMilik(user, query.get('posyandu_id'));
  const jenis = cekJenis(query.get('jenis'));
  const tahun = int(query.get('tahun'), 2000, 2100, 'Tahun');
  const bulanSaja = query.get('bulan') ? int(query.get('bulan'), 1, 12, 'Bulan') : null;
  const tglSaja = query.get('tanggal') ? int(query.get('tanggal'), 1, 31, 'Tanggal') : null;
  let rows = await db.all('SELECT bulan, tanggal, data FROM rekap WHERE posyandu_id=? AND jenis=? AND tahun=? ORDER BY bulan, COALESCE(tanggal,0), id',
    [p.id, jenis, tahun]);
  if (!rows.length) throw new HttpError(404, `Belum ada rekap yang diisi untuk tahun ${tahun}.`);
  if (bulanSaja) rows = rows.filter((r) => r.bulan === bulanSaja);
  if (bulanSaja && tglSaja) rows = rows.filter((r) => r.tanggal === tglSaja);
  if (!rows.length) throw new HttpError(404, `Rekap ${tglSaja ? tglSaja + ' ' : ''}${NAMA_BULAN[bulanSaja - 1]} ${tahun} belum diisi.`);
  const baris = rows.map((r) => ({ bulan: r.bulan, tanggal: r.tanggal, data: JSON.parse(r.data) }));
  const pdf = buatPdfRekap({ jenis, posyandu: p, tahun, baris });
  const nama = `Rekap-${JENIS[jenis].id}-${p.nama}-${bulanSaja ? (tglSaja ? tglSaja + '-' : '') + NAMA_BULAN[bulanSaja - 1] + '-' : ''}${tahun}.pdf`
    .replace(/[^A-Za-z0-9._-]+/g, '_');
  return { raw: pdf, type: 'application/pdf', filename: nama };
});

/* ---------------------------------------------------------- berkas statis */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Halaman tidak ditemukan.'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

/* ------------------------------------------------------------- server */
async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'self' blob:; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, url.pathname);
    }
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw new HttpError(404, 'Alamat tidak ditemukan.');
    const m = url.pathname.match(r.re);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const ctx = { params, query: url.searchParams, ip: (process.env.VERCEL && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress, body: {} };
    if (r.auth) {
      const h = req.headers.authorization || '';
      const payload = verifyJwt(h.startsWith('Bearer ') ? h.slice(7) : '');
      const user = payload && await db.get('SELECT * FROM users WHERE id = ?', [Number(payload.sub) || 0]);
      if (!user) throw new HttpError(401, 'Sesi berakhir. Silakan masuk kembali.');
      ctx.user = user;
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      ctx.body = await readJson(req);
      if (ctx.body === null || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) throw bad('Format data tidak valid.');
    }
    const out = await r.handler(ctx);
    if (out && out.raw) {
      res.writeHead(200, {
        'Content-Type': out.type,
        'Content-Length': out.raw.length,
        'Content-Disposition': `attachment; filename="${out.filename}"`,
        'Cache-Control': 'no-store',
      });
      return res.end(out.raw);
    }
    if (out && out.status) return sendJson(res, out.status, out.body);
    sendJson(res, 200, out);
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, ...(e.extra || {}) });
    console.error(e);
    sendJson(res, 500, { error: 'Terjadi kesalahan pada server. Silakan coba lagi.' });
  }
}

const server = http.createServer(handler);
if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Rekap Posyandu berjalan di http://localhost:${PORT} (database: ${db.jenis})`));
}
module.exports = handler;      // dipakai api/index.js di Vercel
module.exports.server = server;
