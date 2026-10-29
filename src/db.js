'use strict';
/**
 * Lapisan database yang bisa dipindah-pindah. Satu variabel menentukan pilihan: DATABASE_URL
 *
 *   postgres://...  atau postgresql://...  -> PostgreSQL (Neon, Supabase, Railway, Vercel Postgres, dsb.)
 *   libsql://...    (atau https://, file:)  -> Turso / libSQL   (token: TURSO_AUTH_TOKEN)
 *   (kosong)                                -> SQLite lokal di DATA_DIR/posyandu.db (hanya untuk komputer sendiri)
 *
 * Semua kueri ditulis dengan placeholder `?`; untuk Postgres otomatis diubah menjadi $1, $2, ...
 * API (semuanya async):  db.get(sql, args) | db.all(sql, args) | db.run(sql, args) | db.tx([{sql,args}, ...])
 * Untuk mengambil id baris baru, pakai:  INSERT ... RETURNING id   lalu db.get(...).
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./auth');

const URL_DB = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || process.env.POSTGRES_URL || '';
const JENIS_DB = /^postgres(ql)?:\/\//i.test(URL_DB) ? 'pg'
  : /^(libsql|wss?|https?|file):/i.test(URL_DB) ? 'libsql'
  : 'sqlite';

if (JENIS_DB === 'sqlite' && process.env.VERCEL) {
  throw new Error('DATABASE_URL belum diisi di Environment Variables Vercel.');
}

/* ------------------------------------------------------------------ driver */
function driverPg() {
  const { Pool } = require('pg');
  // max kecil: di serverless tiap instance hanya perlu satu koneksi.
  const cfg = { connectionString: URL_DB, max: Number(process.env.DB_POOL_MAX) || 1 };
  // Cadangan bila muncul error "self-signed certificate in certificate chain" (kadang di pooler Supabase):
  // set DB_SSL_NO_VERIFY=1. Koneksi tetap terenkripsi, tetapi sertifikat server tidak diperiksa.
  if (process.env.DB_SSL_NO_VERIFY === '1') {
    cfg.connectionString = URL_DB.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');
    cfg.ssl = { rejectUnauthorized: false };
  }
  const pool = new Pool(cfg);
  const ubah = (sql) => { let n = 0; return sql.replace(/\?/g, () => '$' + (++n)); };
  return {
    async all(sql, args = []) { return (await pool.query(ubah(sql), args)).rows; },
    async tx(list) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const s of list) await c.query(ubah(s.sql), s.args || []);
        await c.query('COMMIT');
      } catch (e) { try { await c.query('ROLLBACK'); } catch { /* abaikan */ } throw e; } finally { c.release(); }
    },
  };
}

function driverLibsql() {
  const { createClient } = require('@libsql/client');
  const c = createClient({ url: URL_DB, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
  return {
    async all(sql, args = []) { return (await c.execute({ sql, args })).rows.map((r) => ({ ...r })); },
    async tx(list) { await c.batch(list.map((s) => ({ sql: s.sql, args: s.args || [] })), 'write'); },
  };
}

function driverSqlite() {
  const { DatabaseSync } = require('node:sqlite'); // Node 22.5+, hanya dipakai saat pengembangan lokal
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const d = new DatabaseSync(path.join(DATA_DIR, 'posyandu.db'));
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return {
    async all(sql, args = []) { return d.prepare(sql).all(...args).map((r) => ({ ...r })); },
    async tx(list) {
      d.exec('BEGIN');
      try { for (const s of list) d.prepare(s.sql).run(...(s.args || [])); d.exec('COMMIT'); } catch (e) { d.exec('ROLLBACK'); throw e; }
    },
  };
}

const drv = { pg: driverPg, libsql: driverLibsql, sqlite: driverSqlite }[JENIS_DB]();

/* ------------------------------------------------------------------ skema */
const PG = JENIS_DB === 'pg';
const ID = PG ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
const NOW = PG ? "to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS')" : "(datetime('now'))";

const SKEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id         ${ID},
    username   TEXT NOT NULL,
    nama       TEXT NOT NULL,
    pass_hash  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON users (lower(username))',
  `CREATE TABLE IF NOT EXISTS posyandu (
    id         ${ID},
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nama       TEXT NOT NULL,
    dusun      TEXT NOT NULL DEFAULT '',
    rt         TEXT NOT NULL DEFAULT '',
    rw         TEXT NOT NULL DEFAULT '',
    desa_kel   TEXT NOT NULL DEFAULT '',
    kecamatan  TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ${NOW}
  )`,
  'CREATE INDEX IF NOT EXISTS idx_posyandu_user ON posyandu(user_id)',
  `CREATE TABLE IF NOT EXISTS rekap (
    id          ${ID},
    posyandu_id INTEGER NOT NULL REFERENCES posyandu(id) ON DELETE CASCADE,
    jenis       TEXT NOT NULL,
    tahun       INTEGER NOT NULL,
    bulan       INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT ${NOW},
    updated_at  TEXT NOT NULL DEFAULT ${NOW},
    tanggal     INTEGER
  )`,
  // Satu baris per tanggal (rekap tanpa tanggal dianggap tanggal 0).
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_rekap_tanggal
     ON rekap (posyandu_id, jenis, tahun, bulan, COALESCE(tanggal, 0))`,
];

let siap = null;
/** Membuat tabel bila belum ada; dijalankan sekali per instance. */
function init() {
  if (!siap) {
    siap = (async () => {
      const daftar = SKEMA.map((sql) => ({ sql }));
      // Postgres (mis. Supabase) bisa membuka tabel lewat API publik. Aktifkan RLS tanpa kebijakan
      // supaya tabel tertutup untuk API itu; aplikasi ini memakai koneksi langsung sebagai pemilik tabel.
      if (PG) for (const t of ['users', 'posyandu', 'rekap']) daftar.push({ sql: `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY` });
      // Postgres: kunci agar dua instance yang start bersamaan tidak saling bentrok.
      if (PG) daftar.unshift({ sql: 'SELECT pg_advisory_xact_lock(7270001)' });
      await drv.tx(daftar);
      if (!PG) { // database SQLite lama (hasil impor) mungkin belum punya kolom tanggal
        const kolom = await drv.all('PRAGMA table_info(rekap)');
        if (!kolom.some((c) => c.name === 'tanggal')) await drv.tx([{ sql: 'ALTER TABLE rekap ADD COLUMN tanggal INTEGER' }]);
      }
    })().catch((e) => { siap = null; throw e; });
  }
  return siap;
}

const db = {
  jenis: JENIS_DB,
  async all(sql, args = []) { await init(); return drv.all(sql, args); },
  async get(sql, args = []) { return (await db.all(sql, args))[0]; },
  async run(sql, args = []) { await db.all(sql, args); },
  async tx(list) { await init(); return drv.tx(list); },
  /** Waktu UTC "YYYY-MM-DD HH:MM:SS" (format sama dengan kolom created_at). */
  sekarang: () => new Date().toISOString().slice(0, 19).replace('T', ' '),
};

module.exports = db;
