'use strict';
/**
 * Definisi format rekapitulasi (dipakai oleh form di browser, validasi server, dan PDF).
 *
 * Untuk MENGUBAH kolom: cukup ubah file ini. Tidak perlu menyentuh bagian lain.
 *
 *  L(key, label)            -> satu kolom berisi satu angka
 *  L(key, label, [bagian])  -> satu kolom yang berisi beberapa angka dipisah "/" (mis. "40/5/0"),
 *                              persis seperti template Excel
 *  G(label, ...anak)        -> kelompok kolom (judul di atas kolom-kolom di bawahnya)
 *  G1(label, ...anak)       -> sama seperti G, tetapi judulnya tepat satu baris header (sel tidak digabung ke bawah)
 *  GK(judulForm, ...anak)   -> kelompok "kosong": tidak digambar di header PDF (sel kosong tanpa garis di
 *                              template), hanya dipakai untuk mengelompokkan kolom dan judul di form
 *  tanpaGaris: true        -> (pada kelompok) judul ditulis tanpa kotak/garis
 *  bulanMulai: n            -> (pada jenis) kolom "Bulan dan Tahun" mulai dari baris header ke-n (0 = paling atas)
 *  L(...).formLabel         -> label yang lebih jelas di form (label header PDF tetap persis template)
 *
 * Kelompok boleh bersarang (lihat "ibu"). Label dibuat persis seperti template referensi.
 */

const L = (key, label, parts) => (parts ? { key, label, parts } : { key, label });
const G = (label, ...children) => ({ label, children });
const G1 = (label, ...children) => ({ label, children, baris: 1 });
const GK = (formLabel, ...children) => ({ label: '', formLabel, kosong: true, baris: 1, children });
const F = (leaf, formLabel) => ({ ...leaf, formLabel });

/* ------------------------------------------------------------------ */
/* 1. BAYI, BALITA, APRAS  — persis template "Rekapitulasi_BayiBalita_dan_Apras.xlsx" */
/* ------------------------------------------------------------------ */
const balita = {
  id: 'balita',
  nama: 'Bayi, Balita & Apras',
  ikon: '👶',
  deskripsi: 'Penimbangan, pengukuran, imunisasi, vitamin A dan lainnya (0–71 bulan)',
  judul: 'REKAPITULASI HASIL PEMERIKSAAN BAYI, BALITA DAN APRAS (0-71 BULAN)',
  subjudul: 'Jumlah Bayi/Balita/Apras dengan Hasil Penimbangan dan Pengukuran/Pemantauan/Pemeriksaan',
  sementara: false,
  tree: [
    G('Jumlah Sasaran',
      L('sasaran_bayi', 'Bayi (0-6 bln)'),
      L('sasaran_balita', 'Balita & Apras (26 bln-6 thn)')),
    G('Datang',
      L('datang_bayi', 'Bayi (0-6 bln)'),
      L('datang_balita', 'Balita & Apras (26 bln-6 thn)')),
    G('Tidak Datang',
      L('tdk_datang_bayi', 'Bayi (0-6 bln)'),
      L('tdk_datang_balita', 'Balita & Apras (26 bln-6 thn)')),
    G('Balita dengan ceklis perkembangan',
      L('kpsp_lengkap', 'Lengkap'),
      L('kpsp_tidak_lengkap', 'Tidak Lengkap')),
    G('BB/U (0-5 tahun)',
      L('bbu_naik', 'Naik (N)'),
      L('bbu_tidak_naik', 'Tidak Naik/Bawah Garis Merah/ Atas Garis Merah',
        ['Tidak Naik', 'Bawah Garis Merah', 'Atas Garis Merah']),
      L('bbu_gizi_baik', 'Gizi Baik'),
      L('bbu_gizi_lain', 'Gizi Buruk,Gizi Kurang/Berisiko Gizi Lebih/Gizi Lebih,Obesitas',
        ['Gizi Buruk, Gizi Kurang', 'Berisiko Gizi Lebih', 'Gizi Lebih, Obesitas'])),
    G('Hasil Pengukuran PB/TB/Umur 0-5 tahun',
      L('pbtb_normal', 'Normal'),
      L('pbtb_tidak', 'Sangat Pendek dan Pendek/ Tinggi Melebihi Normal',
        ['Sangat Pendek dan Pendek', 'Tinggi Melebihi Normal'])),
    G('Hasil Pengukuran BB/PB atau BB/TB',
      L('bbpb_baik', 'Gizi Baik'),
      L('bbpb_lain', 'Gizi Buruk,Gizi Kurang/Berisiko Gizi Lebih/Gizi Lebih,Obesitas',
        ['Gizi Buruk, Gizi Kurang', 'Berisiko Gizi Lebih', 'Gizi Lebih, Obesitas'])),
    G('Hasil Pengukuran Lingkar Kepala',
      L('lk_normal', 'Normal'),
      L('lk_tidak', 'Melebihi Normal/Kurang dari Normal',
        ['Melebihi Normal', 'Kurang dari Normal'])),
    G('Lingkaran Lengan Atas',
      L('lila_normal', 'Normal'),
      L('lila_kurang', 'Gizi Kurang/ Gizi Buruk', ['Gizi Kurang', 'Gizi Buruk'])),
    G('Bergejala TBC',
      L('tbc', 'Memenuhi 2 gejala')),
    G('Jumlah Bayi/Balita Mendapat',
      L('asi_eksklusif', 'ASI Ekslusif(0-5 Bulan)'),
      L('mpasi', 'MP ASI (>6 bulan) (Sesuai)'),
      L('imunisasi', 'Imunisasi (Bayi/Balita)'),
      L('vitamin_a', 'Vitamin A'),
      L('obat_cacing', 'Obat Cacing'),
      L('mt_lokal', 'MT Pangan Lokal')),
    { label: '', formLabel: 'Edukasi dan balita sakit', children: [
      L('edukasi', 'Jumlah sasaran mendapatkan edukasi'),
      L('balita_sakit', 'Jumlah balita sakit')] },
    G('Jumlah Sasaran yang dirujuk',
      L('rujuk_bayi', 'Bayi (0-6 Bulan)'),
      L('rujuk_balita', 'Balita & Apras (≥ 6 bln & 5 thn)')),
  ],
};

/* ------------------------------------------------------------------ */
/* 2. USIA DEWASA & LANSIA — persis template "Rekapitulasi_Lansia.xlsx" */
/* ------------------------------------------------------------------ */
const YT = (k) => [L(`${k}_ya`, 'Ya'), L(`${k}_tidak`, 'Tidak')];
const lansia = {
  id: 'lansia',
  nama: 'Usia Dewasa & Lansia',
  ikon: '🧓',
  deskripsi: 'IMT, lingkar perut, tekanan darah, gula darah, skrining PUMA/PPOK, kemandirian (AKS) dan skrining lansia (SKILAS)',
  judul: 'REKAPITULASI HASIL PEMERIKSAAN USIA DEWASA DAN USIA LANJUT (≥19 Tahun)',
  subjudul: 'Hasil Penimbangan/Pengukuran/Pemeriksaan',
  bulanMulai: 1, // "Bulan dan Tahun" mulai dari baris header ke-2 (seperti sel B9:B11 di template)
  sementara: false,
  tree: [
    { ...G1('Usia Dewasa dan Lansia',
      G('IMT',
        L('imt_sangat_kurus', 'Sangat Kurus'),
        L('imt_kurus', 'Kurus'),
        L('imt_normal', 'Normal'),
        L('imt_gemuk', 'Gemuk'),
        L('imt_obesitas', 'Obesitas')),
      G('Lingkar Perut',
        L('lp_laki', 'Laki-Laki (≥90 cm)'),
        L('lp_perempuan', 'Perempuan (≥80 cm)')),
      G('Tekanan Darah',
        L('td_rendah', 'Rendah'),
        L('td_normal', 'Normal'),
        L('td_tinggi', 'Tinggi')),
      G('Gula Darah',
        L('gd_rendah', 'Rendah'),
        L('gd_normal', 'Normal'),
        L('gd_tinggi', 'Tinggi'))), tanpaGaris: true },
    GK('Skrining PUMA/PPOK dan Tingkat Ketergantungan (AKS)',
      G('Skrining PUMA/PPOK (Usia dewasa ≥40 tahun)',
        G('Normal', F(L('puma_normal', '<6'), 'Skor <6 (Normal)')),
        G('Tinggi', F(L('puma_tinggi', '>6'), 'Skor >6 (Tinggi)'))),
      G('Tingkat Ketergantungan (AKS)',
        G('Kategori A', F(L('aks_m', 'M'), 'M (Mandiri)')),
        G('Kategori B', F(L('aks_r', 'R'), 'R (Ringan)'), F(L('aks_s', 'S'), 'S (Sedang)')),
        G('Kategori C', F(L('aks_b', 'B'), 'B (Berat)'), F(L('aks_t', 'T'), 'T (Total)')))),
    { ...G('Lansia',
      { ...G('Skrining Lansia Sederhana (SKILAS)', G('Kognitif', ...YT('skilas_kognitif')), G('Gerak', ...YT('skilas_gerak'))),
        formLabel: 'SKILAS: Kognitif dan Gerak' },
      { ...G('Skrining Lansia Sederhana (SKILAS)', G('Malnutrisi', ...YT('skilas_malnutrisi')), G('Pendengaran', ...YT('skilas_pendengaran'))),
        formLabel: 'SKILAS: Malnutrisi dan Pendengaran' },
      { ...G('Skrining Lansia Sederhana (SKILAS)', G('Penglihatan', ...YT('skilas_penglihatan')), G('Depresi', ...YT('skilas_depresi'))),
        formLabel: 'SKILAS: Penglihatan dan Depresi' }), tanpaGaris: true },
    GK('Imunisasi, Edukasi dan Rujukan',
      L('imunisasi_covid', 'Jumlah Lansia Mendpatkan Imunisasi COVID 19'),
      L('edukasi', 'Jumlah Usia Dewasa dan Lansia Mendapatkan Edukasi'),
      L('rujuk', 'Jumlah Usia Dewasa dan Lansia Dirujuk')),
  ],
};

/* ------------------------------------------------------------------ */
/* 3. IBU HAMIL, NIFAS, MENYUSUI — persis template "Rekapitulasi_Ibu_HamilNifasMenyusui.xlsx" */
/* ------------------------------------------------------------------ */
const NM = ['Nifas', 'Menyusui']; // kolom "a/b" pada template: nifas/menyusui
const ibu = {
  id: 'ibu',
  nama: 'Ibu Hamil, Nifas & Menyusui',
  ikon: '🤰',
  deskripsi: 'Berat badan, LiLA, tekanan darah, TTD, PMT Bumil KEK, kelas ibu hamil, vitamin A dan KB pasca persalinan',
  judul: 'REKAPITULASI HASIL PEMERIKSAAN IBU HAMIL/NIFAS/MENYUSUI',
  subjudul: '', // template ini tidak punya judul tabel tambahan
  sementara: false,
  tree: [
    G('Jumlah Sasaran',
      L('sasaran_hamil', 'Ibu Hamil'),
      L('sasaran_nifas_susui', 'Ibu Nifas/Menyusui', NM),
      G('Datang',
        L('datang_hamil', 'Ibu Hamil'),
        L('datang_nifas_susui', 'Ibu Nifas/Menyusui', NM)),
      G('Tidak Datang',
        L('tdk_datang_hamil', 'Ibu Hamil'),
        L('tdk_datang_nifas_susui', 'Ibu Nifas/Menyusui'))),
    G('Jumlah Ibu Hamil/Nifas/Menyusui dengan Hasil Penimbangan/Pengukuran/Pemeriksaan',
      G('Berat badan',
        L('bb_hijau', 'Hijau'),
        L('bb_merah', 'Merah')),
      G('Lingkar Lengan Atas',
        L('lila_hijau', 'Hijau'),
        L('lila_merah', 'Merah/KEK')),
      G('Tekanan Darah',
        L('td_hijau', 'Hijau'),
        L('td_merah', 'Merah')),
      L('tbc', 'Bergejala TBC (memenuhi 2 gejala)')),
    G('TTD',
      L('ttd_dapat', 'Jumlah Ibu Hamil Mendapatkan TTD'),
      G('Ibu Hamil Konsumsi TTD',
        L('ttd_setiap_hari', 'Setiap Hari'),
        L('ttd_tidak', 'Tidak'))),
    G('PMT Bumil KEK',
      L('pmt_dapat', 'Jumlah Ibu Hamil yang Mendapatkan PMT Bumil KEK'),
      G('Ibu Hamil Konsumsi PMT',
        L('pmt_setiap_hari', 'Setiap Hari'),
        L('pmt_tidak', 'Tidak'))),
    G('Jumlah Ibu Hamil Mengikut Kelas Ibu Hamil',
      L('kelas_ya', 'Ya'),
      L('kelas_tidak', 'Tidak')),
    G('Jumlah Ibu Nifas Mendapatkan Vitamin A',
      L('vita_ya', 'Ya'),
      L('vita_tidak', 'Tidak')),
    G('Jumlah Ibu Nifas/Menyusui Mengikuti KB Pasca Persalinan',
      L('kb_ya', 'Ya', NM),
      L('kb_tidak', 'Tidak')),
    L('edukasi', 'Jumlah Ibu Hamil/Nifas/Menyusui Mendapatkan Edukasi'),
    G('Jumlah Sasaran yang Dirujuk',
      L('rujuk_hamil', 'Ibu Hamil'),
      L('rujuk_nifas_susui', 'Ibu Nifas/ Menyusui')),
  ],
};

const JENIS = { balita, lansia, ibu };

/* ---------------- fungsi bantu ---------------- */

const isLeaf = (n) => typeof n.key === 'string';

function leaves(nodes, out = []) {
  for (const n of nodes) (isLeaf(n) ? out.push(n) : leaves(n.children, out));
  return out;
}

function depth(nodes) {
  let d = 0;
  for (const n of nodes) d = Math.max(d, isLeaf(n) ? 1 : 1 + depth(n.children));
  return d;
}

const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
  'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const MAX_ANGKA = 10_000_000;

function bersihAngka(v) {
  if (v === undefined || v === null || v === '') return 0;
  const s = String(v).trim();
  if (!/^\d{1,8}$/.test(s)) return NaN;
  const n = Number(s);
  return n <= MAX_ANGKA ? n : NaN;
}

/** Validasi & normalisasi data. Kolom kosong dianggap 0. Mengembalikan {data} atau {error}. */
function validasiData(jenisId, input) {
  const sk = JENIS[jenisId];
  if (!sk) return { error: 'Jenis rekapitulasi tidak dikenal.' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Data tidak valid.' };
  const data = {};
  for (const lf of leaves(sk.tree)) {
    const v = input[lf.key];
    if (lf.parts) {
      const arr = Array.isArray(v) ? v : [];
      const out = [];
      for (let i = 0; i < lf.parts.length; i++) {
        const n = bersihAngka(arr[i]);
        if (Number.isNaN(n)) return { error: `Isian "${lf.parts[i]}" harus berupa angka bulat (0 atau lebih).` };
        out.push(n);
      }
      data[lf.key] = out;
    } else {
      const n = bersihAngka(v);
      if (Number.isNaN(n)) return { error: `Isian "${lf.label}" harus berupa angka bulat (0 atau lebih).` };
      data[lf.key] = n;
    }
  }
  return { data };
}

/** Teks yang dicetak di sel PDF. */
function teksSel(lf, data) {
  const v = data ? data[lf.key] : undefined;
  if (v === undefined) return '';
  return Array.isArray(v) ? v.join('/') : String(v);
}

module.exports = { JENIS, leaves, depth, isLeaf, validasiData, teksSel, NAMA_BULAN };
