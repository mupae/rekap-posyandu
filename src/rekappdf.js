'use strict';
const fs = require('fs');
const path = require('path');
const { PdfDoc, textWidth } = require('./pdfwriter');
const { JENIS, leaves, depth, isLeaf, teksSel, NAMA_BULAN } = require('./schemas');

const LOGO = fs.readFileSync(path.join(__dirname, '..', 'assets', 'logo.jpg'));

const PAGE_W = 841.89; // A4 lanskap, sama seperti template
const PAGE_H = 595.28;
const MARGIN = 24;
const BULAN_W = 46;
const HEAD_SIZES = [5.6, 5.3, 5.0, 4.8, 4.6];

function lebarDasar(lf) {
  const n = lf.parts ? lf.parts.length : 1;
  return 20 + 6.5 * (n - 1);
}

/**
 * Membuat PDF rekapitulasi.
 * @param {object} o  { jenis, posyandu, tahun, baris: [{bulan(1-12), tanggal(1-31|null), data}] }
 *                  Setiap tanggal pemeriksaan = satu baris; baris diurutkan menurut tanggal.
 */
function buatPdfRekap({ jenis, posyandu, tahun, baris = [] }) {
  const sk = JENIS[jenis];
  const doc = new PdfDoc({ title: `${sk.nama} ${tahun}` });
  doc.addJpeg('Logo', LOGO);
  const pg0 = doc.addPage(PAGE_W, PAGE_H);
  const cx = PAGE_W / 2;

  /* ---------- Judul ---------- */
  const judulY = MARGIN + 14;
  pg0.text(sk.judul, cx, judulY, 11, { bold: true, align: 'center' });
  const nm = String(posyandu.nama || '').trim();
  const namaBaris = /^posyandu\b/i.test(nm) ? nm : `Posyandu ${nm}`;
  pg0.text(namaBaris.toUpperCase(), cx, judulY + 14, 10, { bold: true, align: 'center' });
  const tw = textWidth(sk.judul, 11, true);
  pg0.image('Logo', cx - tw / 2 - 38, MARGIN - 2, 32, 32);

  /* ---------- Identitas ---------- */
  const dusun = [posyandu.dusun, posyandu.rt, posyandu.rw].map((s) => String(s || '').trim()).filter(Boolean).join('/');
  const info = [
    ['Dusun/RT/RW', dusun],
    ['Desa/Kelurahan', posyandu.desa_kel || ''],
    ['Kecamatan', posyandu.kecamatan || ''],
  ];
  let iy = judulY + 38;
  const labelW = 84;
  for (const [lab, val] of info) {
    pg0.text(lab, MARGIN, iy, 8.5);
    pg0.text(`: ${val}`, MARGIN + labelW + 4, iy, 8.5);
    iy += 11.5;
  }

  /* ---------- Struktur kolom ---------- */
  const D = depth(sk.tree);
  const lvs = leaves(sk.tree);
  const tableW = PAGE_W - 2 * MARGIN;

  // Kata terpanjang pada label harus muat di kolom (tanpa terpotong), jadi ukuran huruf header
  // dipilih dari yang terbesar yang masih memungkinkan.
  const kataPanjang = (label, size) => String(label).split(/[\s/]+/)
    .reduce((m, w) => Math.max(m, textWidth(w, size, true)), 0) + 5;
  let HEAD_SIZE = HEAD_SIZES[HEAD_SIZES.length - 1];
  let width = null;
  for (const size of HEAD_SIZES) {
    const wmap = new Map();
    lvs.forEach((l) => wmap.set(l, Math.max(lebarDasar(l), kataPanjang(l.label, size))));
    (function groups(nodes) {
      for (const n of nodes) {
        if (isLeaf(n)) continue;
        groups(n.children);
        const ls = leaves(n.children);
        const total = ls.reduce((a, l) => a + wmap.get(l), 0);
        const need = n.label ? kataPanjang(n.label, size) : 0;
        if (total < need) ls.forEach((l) => wmap.set(l, wmap.get(l) * need / total));
      }
    })(sk.tree);
    const total = [...wmap.values()].reduce((a, b) => a + b, 0);
    const scale = (tableW - BULAN_W) / total;
    HEAD_SIZE = size;
    width = new Map([...wmap].map(([l, w]) => [l, w * scale]));
    if (scale >= 1) break;
  }
  const sum = (n) => (isLeaf(n) ? width.get(n) : n.children.reduce((s, c) => s + sum(c), 0));

  // Sel header: {node, level (baris awal), span (jumlah baris), x, w}.
  // Daun memanjang sampai baris terakhir; grup yang anaknya lebih dangkal dari kolom lain
  // ikut memanjang ke bawah (seperti sel yang digabung di Excel) agar anak-anaknya sejajar di baris terakhir.
  const tinggi = (n) => depth([n]);
  const cells = [];
  (function walk(nodes, level, x0) {
    let x = x0;
    for (const n of nodes) {
      const w = sum(n);
      const span = n.baris || (isLeaf(n) ? D - level : D - level - tinggi(n) + 1);
      cells.push({ node: n, level, span, x, w });
      if (!isLeaf(n)) walk(n.children, level + span, x);
      x += w;
    }
  })(sk.tree, 0, MARGIN + BULAN_W);

  /* ---------- Tinggi baris header ---------- */
  const lh = HEAD_SIZE * 1.2;
  const needed = (label, w) => Math.max(1, doc.wrap(label, HEAD_SIZE, w - 4, true).length) * lh + 5;
  const rowH = new Array(D).fill(13);
  // sel yang selesai di baris atas diproses lebih dulu; kekurangan tinggi ditambahkan ke baris terakhir sel itu
  const urut = cells.slice().sort((a, b) => (a.level + a.span) - (b.level + b.span));
  for (const c of urut) {
    const akhir = c.level + c.span - 1;
    const butuh = needed(c.node.label || ' ', c.w);
    const ada = rowH.slice(c.level, akhir + 1).reduce((a, b) => a + b, 0);
    if (butuh > ada) rowH[akhir] += butuh - ada;
  }
  const headTotal = rowH.reduce((a, b) => a + b, 0);

  /* ---------- Judul tabel ---------- */
  const subY = iy + 6;
  if (sk.subjudul) pg0.text(sk.subjudul, MARGIN + tableW / 2, subY + 8, 9.5, { bold: true, align: 'center' });
  const top = sk.subjudul ? subY + 14 : subY + 4;

  /* ---------- Gambar header ---------- */
  const drawBox = (pg, x, y, w, h, label, size, bold, garis = true) => {
    if (garis) pg.rect(x, y, w, h);
    if (!label) return;
    const lines = doc.wrap(label, size, w - 4, bold);
    const th = lines.length * size * 1.2;
    let by = y + (h - th) / 2 + size * 0.95;
    for (const ln of lines) { pg.text(ln, x + w / 2, by, size, { bold, align: 'center' }); by += size * 1.2; }
  };
  const gambarHeader = (pg, topY) => {
    const rowTop = (l) => topY + rowH.slice(0, l).reduce((a, b) => a + b, 0);
    const mulai = sk.bulanMulai || 0; // baris header tempat "Bulan dan Tahun" mulai
    drawBox(pg, MARGIN, rowTop(mulai), BULAN_W, headTotal - (rowTop(mulai) - topY), 'Bulan dan Tahun', 6, true);
    for (const c of cells) {
      if (c.node.kosong) continue; // sel kosong tanpa garis (seperti di template)
      const h = rowH.slice(c.level, c.level + c.span).reduce((a, b) => a + b, 0);
      drawBox(pg, c.x, rowTop(c.level), c.w, h, c.node.label, HEAD_SIZE, true, !c.node.tanpaGaris);
    }
  };
  gambarHeader(pg0, top);

  /* ---------- Baris data: satu baris untuk setiap tanggal ---------- */
  // Tabel selalu punya minimal 10 baris; yang belum terisi dibiarkan kosong (tetap bergaris).
  // Kalau satu halaman tidak cukup, lanjut ke halaman berikutnya dengan header dan format yang sama.
  const MIN_BARIS = 10;
  const ROW_MAX = 30;
  const ROW_MIN = 16;
  const daftar = baris.slice().sort((a, b) => (a.bulan - b.bulan) || ((a.tanggal || 0) - (b.tanggal || 0)));
  const total = Math.max(daftar.length, MIN_BARIS);
  const sisaHal1 = PAGE_H - MARGIN - (top + headTotal);
  const rh = Math.max(ROW_MIN, Math.min(ROW_MAX, sisaHal1 / total));
  let pg = pg0;
  let y = top + headTotal;
  for (let i = 0; i < total; i++) {
    const r = daftar[i]; // undefined = baris kosong
    if (y + rh > PAGE_H - MARGIN + 0.5) { // halaman penuh -> halaman lanjutan dengan header tabel diulang
      pg = doc.addPage(PAGE_W, PAGE_H);
      gambarHeader(pg, MARGIN);
      y = MARGIN + headTotal;
    }
    drawBox(pg, MARGIN, y, BULAN_W, rh, r ? `${r.tanggal ? r.tanggal + ' ' : ''}${NAMA_BULAN[r.bulan - 1]} ${tahun}` : '', 7, false);
    for (const lf of lvs) {
      const w = width.get(lf);
      const x = cells.find((k) => k.node === lf).x;
      pg.rect(x, y, w, rh);
      const t = r ? teksSel(lf, r.data) : '';
      if (t) {
        const size = Math.min(8, 8 * ((w - 3) / Math.max(textWidth(t, 8, false), 1)));
        pg.text(t, x + w / 2, y + rh / 2 + size * 0.35, size, { align: 'center' });
      }
    }
    y += rh;
  }
  return doc.build();
}

module.exports = { buatPdfRekap };
