'use strict';
/* Rekap Posyandu — antarmuka (tanpa framework). */

/* ============================== util ============================== */
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const flat = (v) => (Array.isArray(v) ? v.map(flat).join('') : v instanceof Raw ? v.s : esc(v));
function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += flat(v) + strings[i + 1]; });
  return new Raw(out);
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* abaikan */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* abaikan */ } },
};

const IKON = {
  plus: 'M12 5v14M5 12h14',
  mata: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  pensil: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  sampah: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  unduh: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  kiri: 'M15 18l-6-6 6-6',
  kanan: 'M9 18l6-6-6-6',
  centang: 'M5 13l4 4L19 7',
  simpan: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  keluar: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
};
const ikon = (n) => raw(`<svg class="ikon" viewBox="0 0 24 24" aria-hidden="true"><path d="${IKON[n]}"/></svg>`);

let toastTimer;
function toast(pesan, jenis = '') {
  const t = $('#toast');
  t.textContent = pesan;
  t.className = `toast ${jenis}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, jenis === 'galat' ? 6000 : 3500);
}

function tanya({ judul, isi, ya = 'Ya', batal = 'Batal', bahaya = false }) {
  return new Promise((resolve) => {
    const m = $('#modal');
    m.innerHTML = html`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mj">
      <h2 id="mj">${judul}</h2><p>${isi}</p>
      <div class="aksi">
        <button class="tombol" data-m="tidak">${batal}</button>
        <button class="tombol ${bahaya ? 'bahaya penuh' : 'utama'}" data-m="ya">${ya}</button>
      </div></div>`.s;
    m.hidden = false;
    const tutup = (v) => { m.hidden = true; m.innerHTML = ''; document.removeEventListener('keydown', esc_); resolve(v); };
    const esc_ = (e) => { if (e.key === 'Escape') tutup(false); };
    document.addEventListener('keydown', esc_);
    m.onclick = (e) => {
      const b = e.target.closest('[data-m]');
      if (b) tutup(b.dataset.m === 'ya');
      else if (e.target === m) tutup(false);
    };
    $('[data-m=tidak]', m).focus();
  });
}

function tglIndo(s) {
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ============================== state & API ============================== */
let token = store.get('rp_token');
const S = { user: null, posyandu: [], aktif: null, jenis: [], bulan: [], kodeDaftar: false };

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Tidak dapat terhubung ke server. Periksa sambungan internet lalu coba lagi.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  if (!res.ok) {
    if (res.status === 401 && token) keluar(true);
    const e = new Error((data && data.error) || 'Terjadi kesalahan. Silakan coba lagi.');
    e.status = res.status; e.data = data;
    throw e;
  }
  return data;
}

async function unduhPdf(params) {
  toast('PDF sedang dibuat…');
  try {
    const res = await fetch(`/api/pdf?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      let msg = 'PDF gagal dibuat.';
      try { msg = (await res.json()).error || msg; } catch { /* abaikan */ }
      return toast(msg, 'galat');
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const nama = (cd.match(/filename="([^"]+)"/) || [])[1] || 'rekap.pdf';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nama;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast('PDF berhasil dibuat. Cek folder Unduhan.', 'sukses');
  } catch {
    toast('Tidak dapat terhubung ke server.', 'galat');
  }
}

function keluar(kadaluarsa = false) {
  token = null; S.user = null; S.posyandu = []; S.aktif = null;
  store.del('rp_token');
  location.hash = '#/masuk';
  if (kadaluarsa) toast('Sesi berakhir. Silakan masuk kembali.', 'galat');
}

const jenisById = (id) => S.jenis.find((j) => j.id === id);
const isLeaf = (n) => typeof n.key === 'string';

async function muatPosyandu() {
  S.posyandu = (await api('/posyandu')).posyandu;
  const simpan = Number(store.get('rp_aktif'));
  S.aktif = S.posyandu.find((p) => p.id === simpan) || S.posyandu[0] || null;
}
function setAktif(id) {
  S.aktif = S.posyandu.find((p) => p.id === Number(id)) || S.aktif;
  if (S.aktif) store.set('rp_aktif', String(S.aktif.id));
}

/* ============================== kerangka ============================== */
const main = () => $('#utama');
function mount(view) {
  main().innerHTML = view.s;
  window.scrollTo(0, 0);
}

function renderAtas() {
  const a = $('#atas');
  if (!S.user) { a.hidden = true; return; }
  a.hidden = false;
  a.innerHTML = html`<div class="atas-isi">
    <a class="merek" href="#/"><img src="/logo.jpg" alt=""> Rekap Posyandu</a>
    <span class="atas-ruang"></span>
    ${S.posyandu.length > 1
      ? html`<select id="pilih-posyandu" aria-label="Posyandu yang aktif">
          ${S.posyandu.map((p) => html`<option value="${p.id}" ${S.aktif && p.id === S.aktif.id ? raw('selected') : ''}>${p.nama}</option>`)}
        </select>`
      : S.aktif ? html`<span class="chip">${S.aktif.nama}</span>` : ''}
    <a class="tombol-kecil" href="#/akun">${S.user.nama.split(' ')[0]}</a>
    <button class="tombol-kecil" data-act="keluar">${ikon('keluar')} Keluar</button>
  </div>`.s;
}

/* ============================== halaman: masuk / daftar ============================== */
function viewMasuk(mode = 'masuk') {
  const daftar = mode === 'daftar';
  mount(html`<section class="kartu auth">
    <img class="logo" src="/logo.jpg" alt="Logo Posyandu">
    <h1>Rekap Posyandu</h1>
    <p class="sub">Catat dan cetak laporan bulanan posyandu dengan mudah.</p>
    <div class="tab" role="tablist">
      <button role="tab" aria-selected="${!daftar}" data-act="tab-auth" data-mode="masuk">Masuk</button>
      <button role="tab" aria-selected="${daftar}" data-act="tab-auth" data-mode="daftar">Daftar Kader Baru</button>
    </div>
    <div id="galat"></div>
    <form data-form="${daftar ? 'daftar' : 'masuk'}" novalidate>
      ${daftar ? html`<label class="field"><span>Nama lengkap</span>
        <input type="text" name="nama" autocomplete="name" required maxlength="60" placeholder="Contoh: Siti Aminah"></label>` : ''}
      <label class="field"><span>Nama pengguna</span>
        ${daftar ? html`<small>Huruf kecil/angka tanpa spasi, minimal 3 karakter. Contoh: siti.aminah</small>` : ''}
        <input type="text" name="username" autocomplete="username" autocapitalize="none" required maxlength="30"></label>
      <div class="field"><label for="sandi">Kata sandi</label>
        ${daftar ? html`<small>Minimal 6 karakter.</small>` : ''}
        <div class="sandi"><input type="password" id="sandi" name="password" autocomplete="${daftar ? 'new-password' : 'current-password'}" required maxlength="100">
        <button type="button" data-act="lihat-sandi">Lihat</button></div></div>
      ${daftar && S.kodeDaftar ? html`<label class="field"><span>Kode pendaftaran</span>
        <small>Minta kode ini kepada pengurus/koordinator posyandu.</small>
        <input type="text" name="kode" autocomplete="off" required></label>` : ''}
      <button class="tombol utama" style="width:100%" type="submit">${daftar ? 'Daftar dan Masuk' : 'Masuk'}</button>
    </form>
  </section>`);
}

async function submitAuth(form, mode) {
  const f = Object.fromEntries(new FormData(form));
  const g = $('#galat');
  g.innerHTML = '';
  const btn = $('[type=submit]', form);
  btn.disabled = true;
  try {
    if (!f.username || !f.password) throw new Error('Nama pengguna dan kata sandi wajib diisi.');
    const r = await api(mode === 'daftar' ? '/auth/register' : '/auth/login', { method: 'POST', body: f });
    token = r.token; store.set('rp_token', token); S.user = r.user;
    await muatPosyandu();
    location.hash = S.posyandu.length ? '#/' : '#/posyandu/baru';
    route();
  } catch (e) {
    g.innerHTML = html`<div class="kotak galat" role="alert">${e.message}</div>`.s;
  } finally { btn.disabled = false; }
}

/* ============================== halaman: beranda ============================== */
async function viewBeranda() {
  const p = S.aktif;
  const now = new Date();
  const th = now.getFullYear();
  const bl = now.getMonth() + 1;
  mount(html`<p class="memuat">Memuat…</p>`);
  const daftar = await Promise.all(S.jenis.map((j) => api(`/rekap?posyandu_id=${p.id}&jenis=${j.id}&tahun=${th}`)));
  const terisi = (i) => daftar[i].rekap.some((r) => r.bulan === bl);
  mount(html`
    <h1>Halo, ${S.user.nama.split(' ')[0]} 👋</h1>
    <p class="sub">Pilih jenis laporan yang ingin diisi atau dilihat.</p>
    <section class="kartu">
      <div class="judul-hal"><h2 style="margin:0">Posyandu ${p.nama.replace(/^posyandu\s+/i, '')}</h2>
        <a class="tombol-kecil tombol" href="#/posyandu">Kelola Posyandu</a></div>
      <dl class="identitas">
        <dt>Dusun/RT/RW</dt><dd>${[p.dusun, p.rt, p.rw].filter(Boolean).join('/') || '-'}</dd>
        <dt>Desa/Kelurahan</dt><dd>${p.desa_kel}</dd>
        <dt>Kecamatan</dt><dd>${p.kecamatan}</dd>
      </dl>
    </section>
    <div class="grid-jenis">
      ${S.jenis.map((j, i) => html`
        <a class="kartu kartu-jenis" href="#/daftar/${j.id}/${th}">
          <span class="emoji" aria-hidden="true">${j.ikon}</span>
          <h2>${j.nama}</h2>
          <p>${j.deskripsi}</p>
          ${j.sementara ? html`<span><span class="lencana sementara">Format standar sementara</span></span>` : ''}
          <div class="status">
            <span>${S.bulan[bl - 1]} ${th}:
              ${terisi(i) ? html`<span class="lencana ok">✓ Sudah diisi</span>` : html`<span class="lencana belum">Belum diisi</span>`}</span>
            <strong style="color:var(--utama-tua)">Buka ›</strong>
          </div>
        </a>`)}
    </div>`);
}

/* ============================== halaman: daftar rekap per bulan ============================== */
async function viewDaftar(jenisId, tahun) {
  const j = jenisById(jenisId);
  if (!j) return (location.hash = '#/');
  tahun = Number(tahun) || new Date().getFullYear();
  mount(html`<p class="memuat">Memuat…</p>`);
  const { rekap } = await api(`/rekap?posyandu_id=${S.aktif.id}&jenis=${jenisId}&tahun=${tahun}`);
  const per = new Map();
  for (const r of rekap) { if (!per.has(r.bulan)) per.set(r.bulan, []); per.get(r.bulan).push(r); }
  const now = new Date();
  const bulanBaru = [...Array(12).keys()].map((i) => i + 1).find((b) => !per.has(b)) || 1;
  const bulanDefault = tahun === now.getFullYear() ? now.getMonth() + 1 : bulanBaru;
  mount(html`
    <a class="kembali" href="#/">${ikon('kiri')} Kembali ke Beranda</a>
    <div class="judul-hal"><span style="font-size:2rem" aria-hidden="true">${j.ikon}</span><h1>${j.nama}</h1>
      ${j.sementara ? html`<span class="lencana sementara">Format standar sementara</span>` : ''}</div>
    <p class="sub">Posyandu ${S.aktif.nama.replace(/^posyandu\s+/i, '')} · Setiap tanggal pemeriksaan yang berbeda menjadi satu baris baru di rekap, seperti di Excel.</p>
    <div class="tahun-bar">
      <button class="tombol" data-act="tahun" data-t="${tahun - 1}" aria-label="Tahun sebelumnya">${ikon('kiri')}</button>
      <div class="tahun" aria-live="polite">${tahun}</div>
      <button class="tombol" data-act="tahun" data-t="${tahun + 1}" aria-label="Tahun berikutnya">${ikon('kanan')}</button>
    </div>
    <div class="aksi-atas">
      <a class="tombol utama" href="#/baru/${jenisId}/${tahun}/${bulanDefault}">${ikon('plus')} Tambah Baris Rekap Baru</a>
      <button class="tombol" data-act="pdf" data-jenis="${jenisId}" data-tahun="${tahun}" ${rekap.length ? '' : 'disabled'}>${ikon('unduh')} Unduh PDF Setahun (${tahun})</button>
    </div>
    ${S.bulan.map((nama, i) => {
      const b = i + 1;
      const rows = per.get(b) || [];
      if (!rows.length) return html`
        <div class="baris-bulan kosong">
          <div class="nama"><strong>${nama} ${tahun}</strong><small>Belum diisi</small></div>
          <div class="aksi"><a class="tombol kecil utama" href="#/baru/${jenisId}/${tahun}/${b}">${ikon('plus')} Isi sekarang</a></div>
        </div>`;
      return html`
        <div class="grup-bulan">
          <div class="baris-bulan terisi kepala">
            <div class="nama"><strong>${nama} ${tahun}</strong><small>✓ ${rows.length} tanggal sudah diisi</small></div>
            <div class="aksi">
              <a class="tombol kecil utama" href="#/baru/${jenisId}/${tahun}/${b}">${ikon('plus')} Tambah tanggal</a>
              ${rows.length > 1 ? html`<button class="tombol kecil" data-act="pdf" data-jenis="${jenisId}" data-tahun="${tahun}" data-bulan="${b}">${ikon('unduh')} PDF ${nama}</button>` : ''}
            </div>
          </div>
          ${rows.map((r) => html`
          <div class="baris-bulan terisi anak">
            <div class="nama"><strong>${r.tanggal ? `${r.tanggal} ` : ''}${nama} ${tahun}</strong><small>diperbarui ${tglIndo(r.updated_at)}</small></div>
            <div class="aksi">
              <a class="tombol kecil" href="#/lihat/${r.id}">${ikon('mata')} Lihat</a>
              <a class="tombol kecil" href="#/ubah/${r.id}">${ikon('pensil')} Ubah</a>
              <button class="tombol kecil" data-act="pdf" data-jenis="${jenisId}" data-tahun="${tahun}" data-bulan="${b}" ${r.tanggal ? html`data-tanggal="${r.tanggal}"` : ''}>${ikon('unduh')} PDF</button>
              <button class="tombol kecil bahaya" data-act="hapus-rekap" data-id="${r.id}" data-nama="${r.tanggal ? r.tanggal + ' ' : ''}${nama} ${tahun}" data-jenis="${jenisId}" data-tahun="${tahun}">${ikon('sampah')} Hapus</button>
            </div>
          </div>`)}
        </div>`;
    })}`);
}

/* ============================== halaman: formulir rekap ============================== */
function fieldAngka(leaf, nilai, off) {
  if (leaf.parts) {
    const arr = Array.isArray(nilai) ? nilai : [];
    return html`<fieldset class="multi"><legend>${leaf.formLabel || leaf.label}</legend>
      <p class="petunjuk">Isi tiap angka di bawah ini.${off ? '' : ' Kosong dianggap 0.'}</p>
      <div class="kolom">${leaf.parts.map((p, i) => html`
        <label class="angka"><span>${p}</span>
          <input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="next" autocomplete="off" placeholder="0" maxlength="8"
            data-key="${leaf.key}" data-i="${i}" value="${arr[i] ?? ''}" ${off ? raw('disabled') : ''}></label>`)}</div></fieldset>`;
  }
  return html`<label class="angka"><span>${leaf.formLabel || leaf.label}</span>
    <input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="next" autocomplete="off" placeholder="0" maxlength="8"
      data-key="${leaf.key}" value="${nilai ?? ''}" ${off ? raw('disabled') : ''}></label>`;
}

function grupHtml(node, data, off, level) {
  const leaves = node.children.filter(isLeaf);
  const subs = node.children.filter((c) => !isLeaf(c));
  const tampil = node.formLabel || node.label || 'Lainnya';
  const isi = html`
    ${leaves.length ? html`<div class="kolom">${leaves.map((l) => fieldAngka(l, data[l.key], off))}</div>` : ''}
    ${subs.map((s) => grupHtml(s, data, off, level + 1))}`;
  return level === 0
    ? html`<section class="kartu grup"><h2>${tampil}</h2>${isi}</section>`
    : html`<div class="subgrup"><h3>${tampil}</h3>${isi}</div>`;
}

function formHtml(j, data, off) {
  const lepas = j.tree.filter(isLeaf);
  return html`${j.tree.filter((n) => !isLeaf(n)).map((n) => grupHtml(n, data, off, 0))}
    ${lepas.length ? grupHtml({ label: 'Lainnya', children: lepas }, data, off, 0) : ''}`;
}

function kumpulData() {
  const data = {};
  for (const el of $$('input[data-key]')) {
    const k = el.dataset.key;
    if (el.dataset.i !== undefined) { (data[k] = data[k] || [])[Number(el.dataset.i)] = el.value; }
    else data[k] = el.value;
  }
  return data;
}

let kotor = false;

async function viewForm(mode, arg) {
  mount(html`<p class="memuat">Memuat…</p>`);
  let j, tahun, bulan, rekap = null, data = {};
  if (mode === 'baru') {
    j = jenisById(arg[0]); tahun = Number(arg[1]); bulan = Number(arg[2]);
    if (!j || !(bulan >= 1 && bulan <= 12)) return (location.hash = '#/');
  } else {
    rekap = (await api(`/rekap/${arg[0]}`)).rekap;
    if (rekap.posyandu_id !== S.aktif.id && S.posyandu.some((p) => p.id === rekap.posyandu_id)) { setAktif(rekap.posyandu_id); renderAtas(); }
    j = jenisById(rekap.jenis); tahun = rekap.tahun; bulan = rekap.bulan; data = rekap.data;
  }
  const off = mode === 'lihat';
  kotor = false;
  const judulMode = { baru: 'Isi Rekap Baru', lihat: 'Lihat Rekap', ubah: 'Ubah Rekap' }[mode];
  const kembaliKe = `#/daftar/${j.id}/${tahun}`;
  const tahunIni = new Date().getFullYear();
  const now0 = new Date();
  const tglAwal = rekap ? rekap.tanggal : (tahun === now0.getFullYear() && bulan === now0.getMonth() + 1 ? now0.getDate() : '');
  const opsiTgl = (v) => html`<option value="">Pilih…</option>${Array.from({ length: 31 }, (_, i) => html`<option value="${i + 1}" ${Number(v) === i + 1 ? raw('selected') : ''}>${i + 1}</option>`)}`;
  const daftarTahun = [...new Set([tahunIni + 1, tahunIni, tahunIni - 1, tahunIni - 2, tahunIni - 3, tahun])].sort((a, b) => b - a);
  mount(html`
    <a class="kembali" href="${kembaliKe}" data-act="batal-form">${ikon('kiri')} Kembali ke daftar bulan</a>
    <div class="judul-hal"><span style="font-size:2rem" aria-hidden="true">${j.ikon}</span>
      <div><h1>${judulMode}</h1><div class="sub" style="margin:0">${j.nama} · Posyandu ${S.aktif.nama.replace(/^posyandu\s+/i, '')}</div></div></div>
    ${mode === 'baru' ? html`
      <section class="kartu"><h2>Untuk tanggal berapa?</h2>
        <p class="petunjuk" style="margin:0 0 .6rem">Tanggal yang berbeda akan menjadi <strong>baris baru</strong> di rekap.</p>
        <div class="pilih-bulan">
          <label class="field" style="margin:0"><span>Tanggal</span>
            <select class="isian" id="f-tanggal" required>${opsiTgl(tglAwal)}</select></label>
          <label class="field" style="margin:0"><span>Bulan</span>
            <select class="isian" id="f-bulan">${S.bulan.map((n, i) => html`<option value="${i + 1}" ${i + 1 === bulan ? raw('selected') : ''}>${n}</option>`)}</select></label>
          <label class="field" style="margin:0"><span>Tahun</span>
            <select class="isian" id="f-tahun">${daftarTahun.map((y) => html`<option value="${y}" ${y === tahun ? raw('selected') : ''}>${y}</option>`)}</select></label>
        </div>
        <div id="peringatan-ada"></div>
      </section>` : html`<p class="kotak info"><strong>${rekap && rekap.tanggal ? `${rekap.tanggal} ` : ''}${S.bulan[bulan - 1]} ${tahun}</strong>${rekap ? html` · terakhir diperbarui ${tglIndo(rekap.updated_at)}` : ''}</p>
      ${off ? '' : html`<section class="kartu"><div class="pilih-bulan"><label class="field" style="margin:0"><span>Tanggal</span>
        <select class="isian" id="f-tanggal" required>${opsiTgl(tglAwal)}</select></label></div>
        <p class="petunjuk" style="margin:.6rem 0 0">Jika tanggal diganti, rekap ini tetap satu baris dengan tanggal baru. Untuk menambah baris baru, pakai tombol “Tambah tanggal” di daftar.</p></section>`}`}
    ${j.sementara ? html`<p class="kotak waspada">Format laporan ini adalah <strong>standar sementara</strong> dan akan disesuaikan dengan template resmi posyandu.</p>` : ''}
    ${off ? '' : html`<p class="kotak info">Isi <strong>jumlah (angka)</strong> pada setiap kotak. Kotak yang dikosongkan dianggap <strong>0</strong>. Tekan <strong>Enter</strong> untuk pindah ke kotak berikutnya.</p>`}
    <div id="galat"></div>
    <form id="form-rekap" novalidate>${formHtml(j, data, off)}</form>
    <div class="bar-bawah"><div>
      ${off ? html`
        <a class="tombol" href="${kembaliKe}">Kembali</a>
        <button class="tombol" data-act="pdf" data-jenis="${j.id}" data-tahun="${tahun}" data-bulan="${bulan}" ${rekap.tanggal ? html`data-tanggal="${rekap.tanggal}"` : ''}>${ikon('unduh')} Unduh PDF</button>
        <a class="tombol utama" href="#/ubah/${rekap.id}">${ikon('pensil')} Ubah</a>`
      : html`
        <a class="tombol" href="${kembaliKe}" data-act="batal-form">Batal</a>
        <button class="tombol utama" data-act="simpan-rekap" data-mode="${mode}" data-jenis="${j.id}" ${rekap ? html`data-id="${rekap.id}"` : ''}>${ikon('simpan')} Simpan Rekap</button>`}
    </div></div>`);
  if (mode === 'baru') cekAda(j.id);
}

async function cekAda(jenisId) {
  const bl = Number($('#f-bulan').value), th = Number($('#f-tahun').value), tg = Number($('#f-tanggal').value) || 0;
  const box = $('#peringatan-ada');
  if (!box) return;
  try {
    const { rekap } = await api(`/rekap?posyandu_id=${S.aktif.id}&jenis=${jenisId}&tahun=${th}`);
    const ada = tg && rekap.find((r) => r.bulan === bl && (r.tanggal || 0) === tg);
    const banyak = rekap.filter((r) => r.bulan === bl).length;
    box.innerHTML = ada
      ? html`<div class="kotak waspada" style="margin:.8rem 0 0">Rekap <strong>${tg} ${S.bulan[bl - 1]} ${th}</strong> sudah pernah diisi.
          Pilih tanggal lain untuk membuat baris baru, atau <a href="#/ubah/${ada.id}">buka dan ubah rekap itu</a>.</div>`.s
      : banyak ? html`<div class="kotak info" style="margin:.8rem 0 0">${S.bulan[bl - 1]} ${th} sudah punya ${banyak} baris. Menyimpan dengan tanggal ini akan menambah <strong>baris baru</strong>.</div>`.s : '';
  } catch { box.innerHTML = ''; }
}

async function simpanRekap(btn) {
  const { mode, jenis, id } = btn.dataset;
  const g = $('#galat');
  g.innerHTML = '';
  btn.disabled = true;
  try {
    if (!$('#f-tanggal').value) throw new Error('Pilih tanggal terlebih dahulu. Setiap tanggal berbeda menjadi satu baris baru.');
    if (mode === 'baru') {
      const body = { posyandu_id: S.aktif.id, jenis, tahun: Number($('#f-tahun').value), bulan: Number($('#f-bulan').value), tanggal: $('#f-tanggal').value, data: kumpulData() };
      await api('/rekap', { method: 'POST', body });
      kotor = false;
      toast(`Baris baru ${body.tanggal} ${S.bulan[body.bulan - 1]} ${body.tahun} tersimpan.`, 'sukses');
      location.hash = `#/daftar/${jenis}/${body.tahun}`;
    } else {
      await api(`/rekap/${id}`, { method: 'PUT', body: { tanggal: $('#f-tanggal').value, data: kumpulData() } });
      kotor = false;
      toast('Perubahan tersimpan.', 'sukses');
      location.hash = `#/lihat/${id}`;
    }
  } catch (e) {
    g.innerHTML = html`<div class="kotak galat" role="alert">${e.message}${e.data && e.data.id ? html` <a href="#/ubah/${e.data.id}">Buka rekap itu</a>` : ''}</div>`.s;
    g.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally { btn.disabled = false; }
}

/* ============================== halaman: posyandu ============================== */
function viewPosyanduDaftar() {
  mount(html`
    <a class="kembali" href="#/">${ikon('kiri')} Kembali ke Beranda</a>
    <div class="judul-hal"><h1>Posyandu Saya</h1></div>
    <p class="sub">Satu akun dapat mengelola lebih dari satu posyandu.</p>
    <div class="aksi-atas"><a class="tombol utama" href="#/posyandu/baru">${ikon('plus')} Tambah Posyandu</a></div>
    ${S.posyandu.map((p) => html`
      <section class="kartu">
        <div class="judul-hal"><h2 style="margin:0">Posyandu ${p.nama.replace(/^posyandu\s+/i, '')}</h2>
          ${S.aktif && S.aktif.id === p.id ? html`<span class="lencana ok">Sedang dipakai</span>` : ''}</div>
        <dl class="identitas">
          <dt>Dusun/RT/RW</dt><dd>${[p.dusun, p.rt, p.rw].filter(Boolean).join('/') || '-'}</dd>
          <dt>Desa/Kelurahan</dt><dd>${p.desa_kel}</dd>
          <dt>Kecamatan</dt><dd>${p.kecamatan}</dd>
        </dl>
        <div class="aksi" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem">
          ${S.aktif && S.aktif.id === p.id ? '' : html`<button class="tombol kecil utama" data-act="pakai" data-id="${p.id}">${ikon('centang')} Pakai posyandu ini</button>`}
          <a class="tombol kecil" href="#/posyandu/${p.id}/ubah">${ikon('pensil')} Ubah data</a>
          <button class="tombol kecil bahaya" data-act="hapus-posyandu" data-id="${p.id}" data-nama="${p.nama}">${ikon('sampah')} Hapus</button>
        </div>
      </section>`)}`);
}

function viewPosyanduForm(id) {
  const p = id ? S.posyandu.find((x) => x.id === Number(id)) : null;
  if (id && !p) return (location.hash = '#/posyandu');
  const pertama = !S.posyandu.length;
  mount(html`
    ${pertama ? '' : html`<a class="kembali" href="#/posyandu">${ikon('kiri')} Kembali</a>`}
    <h1>${p ? 'Ubah Data Posyandu' : pertama ? 'Langkah pertama: data posyandu Anda' : 'Tambah Posyandu'}</h1>
    <p class="sub">Data ini akan tercetak di bagian atas setiap laporan PDF.</p>
    <div id="galat"></div>
    <form class="kartu" data-form="posyandu" data-id="${p ? p.id : ''}" novalidate>
      <label class="field"><span>Nama Posyandu</span><small>Contoh: Anggrek Merah (tulis tanpa kata “Posyandu”)</small>
        <input type="text" name="nama" required maxlength="80" value="${p ? p.nama : ''}"></label>
      <div class="baris-3">
        <label class="field"><span>Dusun</span><input type="text" name="dusun" maxlength="40" value="${p ? p.dusun : ''}" placeholder="Contoh: V"></label>
        <label class="field"><span>RT</span><input type="text" name="rt" inputmode="numeric" maxlength="10" value="${p ? p.rt : ''}" placeholder="007"></label>
        <label class="field"><span>RW</span><input type="text" name="rw" inputmode="numeric" maxlength="10" value="${p ? p.rw : ''}" placeholder="015"></label>
      </div>
      <label class="field"><span>Desa/Kelurahan</span><small>Contoh: Jatisari/Jatimulyo</small>
        <input type="text" name="desa_kel" required maxlength="80" value="${p ? p.desa_kel : ''}"></label>
      <label class="field"><span>Kecamatan</span>
        <input type="text" name="kecamatan" required maxlength="60" value="${p ? p.kecamatan : ''}"></label>
      <button class="tombol utama" style="width:100%" type="submit">${ikon('simpan')} Simpan Data Posyandu</button>
    </form>`);
}

async function submitPosyandu(form) {
  const f = Object.fromEntries(new FormData(form));
  const g = $('#galat');
  g.innerHTML = '';
  const id = form.dataset.id;
  try {
    for (const [k, nm] of [['nama', 'Nama posyandu'], ['desa_kel', 'Desa/Kelurahan'], ['kecamatan', 'Kecamatan']]) {
      if (!String(f[k] || '').trim()) throw new Error(`${nm} wajib diisi.`);
    }
    const r = id ? await api(`/posyandu/${id}`, { method: 'PUT', body: f }) : await api('/posyandu', { method: 'POST', body: f });
    await muatPosyandu();
    setAktif(r.posyandu.id);
    renderAtas();
    toast('Data posyandu tersimpan.', 'sukses');
    location.hash = '#/';
  } catch (e) {
    g.innerHTML = html`<div class="kotak galat" role="alert">${e.message}</div>`.s;
    g.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/* ============================== halaman: akun ============================== */
function viewAkun() {
  mount(html`
    <a class="kembali" href="#/">${ikon('kiri')} Kembali ke Beranda</a>
    <h1>Akun Saya</h1>
    <section class="kartu"><dl class="identitas"><dt>Nama</dt><dd>${S.user.nama}</dd><dt>Nama pengguna</dt><dd>${S.user.username}</dd></dl></section>
    <h2>Ganti Kata Sandi</h2>
    <div id="galat"></div>
    <form class="kartu" data-form="sandi" novalidate>
      <label class="field"><span>Kata sandi lama</span><input type="password" name="lama" autocomplete="current-password"></label>
      <label class="field"><span>Kata sandi baru</span><small>Minimal 6 karakter.</small><input type="password" name="baru" autocomplete="new-password"></label>
      <button class="tombol utama" type="submit">Simpan Kata Sandi Baru</button>
    </form>`);
}

/* ============================== router ============================== */
async function route() {
  const hash = location.hash || '#/';
  const seg = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  renderAtas();
  if (!S.user) {
    if (seg[0] !== 'masuk') { location.hash = '#/masuk'; return; }
    return viewMasuk();
  }
  if (seg[0] === 'masuk') { location.hash = '#/'; return; }
  if (!S.posyandu.length && !(seg[0] === 'posyandu' && seg[1] === 'baru')) { location.hash = '#/posyandu/baru'; return; }
  try {
    switch (seg[0]) {
      case undefined: return await viewBeranda();
      case 'daftar': return await viewDaftar(seg[1], seg[2]);
      case 'baru': return await viewForm('baru', seg.slice(1));
      case 'lihat': return await viewForm('lihat', seg.slice(1));
      case 'ubah': return await viewForm('ubah', seg.slice(1));
      case 'posyandu':
        if (!seg[1]) return viewPosyanduDaftar();
        if (seg[1] === 'baru') return viewPosyanduForm(null);
        return viewPosyanduForm(seg[1]);
      case 'akun': return viewAkun();
      default: location.hash = '#/';
    }
  } catch (e) {
    if (e.status === 401) return;
    mount(html`<section class="kartu"><h2>Maaf, ada kendala</h2><p>${e.message}</p>
      <a class="tombol utama" href="#/">Kembali ke Beranda</a></section>`);
  }
}

/* ============================== event ============================== */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act } = el.dataset;
  switch (act) {
    case 'tab-auth': viewMasuk(el.dataset.mode); break;
    case 'lihat-sandi': {
      const i = $('#sandi');
      i.type = i.type === 'password' ? 'text' : 'password';
      el.textContent = i.type === 'password' ? 'Lihat' : 'Sembunyikan';
      break;
    }
    case 'keluar':
      if (await tanya({ judul: 'Keluar dari aplikasi?', isi: 'Anda perlu memasukkan nama pengguna dan kata sandi lagi untuk masuk.', ya: 'Ya, Keluar' })) keluar();
      break;
    case 'tahun': location.hash = `#/daftar/${location.hash.split('/')[2]}/${el.dataset.t}`; break;
    case 'pdf': {
      const p = { posyandu_id: S.aktif.id, jenis: el.dataset.jenis, tahun: el.dataset.tahun };
      if (el.dataset.bulan) p.bulan = el.dataset.bulan;
      if (el.dataset.tanggal) p.tanggal = el.dataset.tanggal;
      unduhPdf(p);
      break;
    }
    case 'hapus-rekap': {
      const ok = await tanya({
        judul: `Hapus rekap ${el.dataset.nama}?`,
        isi: 'Baris pada tanggal ini akan dihapus dan tidak bisa dikembalikan. Baris tanggal lain tidak terpengaruh.',
        ya: 'Ya, Hapus', bahaya: true,
      });
      if (!ok) break;
      try {
        await api(`/rekap/${el.dataset.id}`, { method: 'DELETE' });
        toast('Rekap dihapus.', 'sukses');
        viewDaftar(el.dataset.jenis, el.dataset.tahun);
      } catch (err) { toast(err.message, 'galat'); }
      break;
    }
    case 'pakai': setAktif(el.dataset.id); renderAtas(); toast('Posyandu aktif diganti.', 'sukses'); location.hash = '#/'; break;
    case 'hapus-posyandu': {
      const ok = await tanya({
        judul: `Hapus Posyandu ${el.dataset.nama}?`,
        isi: 'SEMUA rekap milik posyandu ini ikut terhapus dan tidak bisa dikembalikan.',
        ya: 'Ya, Hapus Semuanya', bahaya: true,
      });
      if (!ok) break;
      try {
        await api(`/posyandu/${el.dataset.id}`, { method: 'DELETE' });
        await muatPosyandu();
        renderAtas();
        toast('Posyandu dihapus.', 'sukses');
        S.posyandu.length ? viewPosyanduDaftar() : (location.hash = '#/posyandu/baru');
      } catch (err) { toast(err.message, 'galat'); }
      break;
    }
    case 'simpan-rekap': simpanRekap(el); break;
    case 'batal-form':
      if (kotor) {
        e.preventDefault();
        const href = el.getAttribute('href');
        if (await tanya({ judul: 'Keluar tanpa menyimpan?', isi: 'Angka yang sudah Anda isi belum disimpan dan akan hilang.', ya: 'Ya, Keluar', batal: 'Kembali mengisi', bahaya: true })) { kotor = false; location.hash = href; }
      }
      break;
    default:
  }
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const k = f.dataset.form;
  if (k === 'masuk' || k === 'daftar') submitAuth(f, k);
  else if (k === 'posyandu') submitPosyandu(f);
  else if (k === 'sandi') {
    const d = Object.fromEntries(new FormData(f));
    api('/me/password', { method: 'POST', body: d })
      .then(() => { toast('Kata sandi diganti.', 'sukses'); f.reset(); })
      .catch((err) => { $('#galat').innerHTML = html`<div class="kotak galat" role="alert">${err.message}</div>`.s; });
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('input[data-key]')) {
    const bersih = t.value.replace(/\D/g, '').slice(0, 8);
    if (bersih !== t.value) t.value = bersih;
    kotor = true;
  }
});
document.addEventListener('focusin', (e) => { if (e.target.matches('input[data-key]')) e.target.select(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input[data-key]')) {
    e.preventDefault();
    const semua = $$('input[data-key]:not([disabled])');
    const i = semua.indexOf(e.target);
    (semua[i + 1] || $('[data-act=simpan-rekap]'))?.focus();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'pilih-posyandu') {
    setAktif(e.target.value); renderAtas();
    if (location.hash === '#/' || location.hash === '') route(); else location.hash = '#/';
  }
  if ((e.target.id === 'f-bulan' || e.target.id === 'f-tahun' || e.target.id === 'f-tanggal') && $('#peringatan-ada')) { const j = location.hash.split('/')[2]; cekAda(j); }
});
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (kotor) { e.preventDefault(); e.returnValue = ''; } });

/* ============================== mulai ============================== */
(async function start() {
  try {
    const [cfg, jn] = await Promise.all([api('/config'), api('/jenis')]);
    S.kodeDaftar = cfg.kodeDaftar; S.jenis = jn.jenis; S.bulan = jn.bulan;
    if (token) {
      try { S.user = (await api('/me')).user; await muatPosyandu(); } catch { token = null; store.del('rp_token'); }
    }
    route();
  } catch (e) {
    mount(html`<section class="kartu"><h2>Tidak dapat memuat aplikasi</h2><p>${e.message}</p>
      <button class="tombol utama" onclick="location.reload()">Coba lagi</button></section>`);
  }
})();
