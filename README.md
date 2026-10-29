# Rekap Posyandu

Aplikasi web untuk kader: input rekap, lihat/ubah/hapus, dan unduh PDF dengan format persis template.
Setiap tanggal pemeriksaan yang berbeda menjadi satu baris baru. Siap di-hosting di **Vercel**
dengan database online (**Turso** atau **Postgres**).

## Jalankan di komputer (Node.js 22+)

    npm install
    cp .env.example .env     # isi JWT_SECRET (dan KODE_DAFTAR)
    npm start                # http://localhost:3000

Tanpa `DATABASE_URL`, data disimpan di SQLite lokal (`data/`), hanya untuk percobaan.

## Pengaturan (environment variable)

| Nama | Keterangan |
| --- | --- |
| `DATABASE_URL` | `postgresql://...` (Postgres) atau `libsql://...` (Turso). Kosong = SQLite lokal |
| `TURSO_AUTH_TOKEN` | Token Turso (bila memakai Turso) |
| `JWT_SECRET` | Rahasia login, minimal 16 karakter. **Wajib di Vercel** |
| `KODE_DAFTAR` | Bila diisi, pendaftaran kader wajib memasukkan kode ini |
| `TOKEN_HARI` | Masa berlaku login (bawaan 7 hari) |
| `DB_POOL_MAX` | Maks. koneksi Postgres per instance (bawaan 1) |
| `DB_SSL_NO_VERIFY` | Isi `1` hanya bila muncul error sertifikat SSL di Postgres (mis. pooler Supabase) |

## Deploy ke Vercel

1. Siapkan database (Turso atau Postgres) dan salin `DATABASE_URL`-nya.
2. Push proyek ini ke GitHub.
3. Di Vercel: Add New > Project > impor repository, Framework Preset **Other**.
4. Isi Environment Variables di atas, lalu Deploy.

Tabel dibuat otomatis saat pertama kali dipakai.

## Struktur

- `app.js` : server & rute API (juga diekspor sebagai handler untuk Vercel)
- `api/index.js` : pintu masuk fungsi Vercel; `vercel.json` mengarahkan `/api/*` ke sini
- `src/db.js` : lapisan database (Postgres / libSQL / SQLite)
- `src/schemas.js` : kolom laporan (form, validasi, dan PDF ikut berubah otomatis)
- `public/` : tampilan web
