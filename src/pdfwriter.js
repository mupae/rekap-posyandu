'use strict';
/**
 * Penulis PDF mini tanpa dependensi.
 * Memakai font bawaan PDF (Helvetica, Helvetica-Bold, Symbol untuk ≥ ≤) sehingga tidak perlu menyertakan font.
 * Koordinat memakai titik (pt) dengan asal di KIRI-ATAS halaman (y bertambah ke bawah).
 */
const zlib = require('zlib');
const METRICS = require('./fontmetrics.json');

const FONT_NAMES = { F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Symbol' };
const WIDTHS = { F1: METRICS.Helvetica, F2: METRICS['Helvetica-Bold'], F3: METRICS.Symbol };

// Karakter di luar WinAnsi yang bisa digantikan glyph Symbol
const SYMBOL_MAP = { '≥': 0xb3, '≤': 0xa3 };
// Beberapa karakter umum di luar ASCII yang ada di WinAnsi
const WIN_ANSI_EXTRA = {
  '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80,
};

/** Pecah string menjadi potongan [{f, s}] dengan s berupa string latin1 siap tulis. */
function runs(str, bold) {
  const base = bold ? 'F2' : 'F1';
  const out = [];
  const push = (f, ch) => {
    const last = out[out.length - 1];
    if (last && last.f === f) last.s += ch; else out.push({ f, s: ch });
  };
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (SYMBOL_MAP[ch] !== undefined) push('F3', String.fromCharCode(SYMBOL_MAP[ch]));
    else if (WIN_ANSI_EXTRA[ch] !== undefined) push(base, String.fromCharCode(WIN_ANSI_EXTRA[ch]));
    else if (cp >= 32 && cp <= 126) push(base, ch);
    else if (cp >= 160 && cp <= 255) push(base, ch);
    else push(base, '?');
  }
  return out;
}

function textWidth(str, size, bold) {
  let w = 0;
  for (const r of runs(str, bold)) {
    const t = WIDTHS[r.f];
    for (let i = 0; i < r.s.length; i++) w += t[r.s.charCodeAt(i)] || 0;
  }
  return (w * size) / 1000;
}

const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);
const num = (n) => (Math.round(n * 100) / 100).toString();

function jpegInfo(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), comps: buf[i + 9] };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('JPEG tidak valid');
}

class Page {
  constructor(doc, w, h) { this.doc = doc; this.w = w; this.h = h; this.ops = []; this.usesImages = new Set(); }
  _y(y) { return this.h - y; }

  line(x1, y1, x2, y2, lw = 0.5) {
    this.ops.push(`${num(lw)} w ${num(x1)} ${num(this._y(y1))} m ${num(x2)} ${num(this._y(y2))} l S`);
  }
  rect(x, y, w, h, lw = 0.5) {
    this.ops.push(`${num(lw)} w ${num(x)} ${num(this._y(y + h))} ${num(w)} ${num(h)} re S`);
  }
  /** Teks satu baris; (x, y) = posisi garis dasar. align: left | center | right */
  text(str, x, y, size, { bold = false, align = 'left' } = {}) {
    const w = textWidth(str, size, bold);
    if (align === 'center') x -= w / 2; else if (align === 'right') x -= w;
    let cx = x;
    for (const r of runs(str, bold)) {
      this.ops.push(`BT /${r.f} ${num(size)} Tf ${num(cx)} ${num(this._y(y))} Td (${esc(r.s)}) Tj ET`);
      const t = WIDTHS[r.f];
      let rw = 0;
      for (let i = 0; i < r.s.length; i++) rw += t[r.s.charCodeAt(i)] || 0;
      cx += (rw * size) / 1000;
    }
  }
  image(name, x, y, w, h) {
    this.usesImages.add(name);
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this._y(y + h))} cm /${name} Do Q`);
  }
}

class PdfDoc {
  constructor(info = {}) { this.pages = []; this.images = {}; this.info = info; }
  addPage(w, h) { const p = new Page(this, w, h); this.pages.push(p); return p; }
  addJpeg(name, buf) { this.images[name] = { buf, ...jpegInfo(buf) }; }

  /** Bungkus teks menjadi baris-baris yang muat di maxW. Boleh patah setelah spasi atau "/". */
  wrap(str, size, maxW, bold = false) {
    const tokens = [];
    String(str).split(/\s+/).filter(Boolean).forEach((word, wi, arr) => {
      const pieces = word.split(/(?<=[\/])/);
      pieces.forEach((pc, pi) => tokens.push({ t: pc, space: pi === pieces.length - 1 && wi < arr.length - 1 }));
    });
    const lines = [];
    let cur = '';
    let curSpace = false;
    const fits = (s) => textWidth(s, size, bold) <= maxW;
    for (const tk of tokens) {
      const joiner = curSpace ? ' ' : '';
      if (!cur) cur = tk.t;
      else if (fits(cur + joiner + tk.t)) cur += joiner + tk.t;
      else { lines.push(cur); cur = tk.t; }
      // kata yang terlalu panjang: patahkan per huruf
      while (!fits(cur) && cur.length > 1) {
        let k = cur.length - 1;
        while (k > 1 && !fits(cur.slice(0, k))) k--;
        lines.push(cur.slice(0, k));
        cur = cur.slice(k);
      }
      curSpace = tk.space;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  build() {
    const objs = []; // index = nomor objek - 1, nilai Buffer
    const add = (b) => { objs.push(Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1')); return objs.length; };
    const reserve = () => { objs.push(null); return objs.length; };
    const set = (n, b) => { objs[n - 1] = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); };

    const catalog = reserve();
    const pagesRoot = reserve();
    const fontRefs = {};
    for (const [k, name] of Object.entries(FONT_NAMES)) {
      const enc = name === 'Symbol' ? '' : ' /Encoding /WinAnsiEncoding';
      fontRefs[k] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name}${enc} >>`);
    }
    const imgRefs = {};
    for (const [name, im] of Object.entries(this.images)) {
      const head = `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace ${im.comps === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.buf.length} >>\nstream\n`;
      imgRefs[name] = add(Buffer.concat([Buffer.from(head, 'latin1'), im.buf, Buffer.from('\nendstream', 'latin1')]));
    }
    const pageRefs = [];
    for (const p of this.pages) {
      const content = zlib.deflateSync(Buffer.from(p.ops.join('\n'), 'latin1'));
      const cref = add(Buffer.concat([
        Buffer.from(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
        content, Buffer.from('\nendstream', 'latin1')]));
      const fonts = Object.entries(fontRefs).map(([k, r]) => `/${k} ${r} 0 R`).join(' ');
      const xo = [...p.usesImages].map((n) => `/${n} ${imgRefs[n]} 0 R`).join(' ');
      pageRefs.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${num(p.w)} ${num(p.h)}] /Resources << /Font << ${fonts} >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${cref} 0 R >>`));
    }
    set(pagesRoot, `<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] >>`);
    const title = String(this.info.title || 'Dokumen').replace(/[^\x20-\x7e]/g, '');
    const infoRef = add(`<< /Title (${esc(title)}) /Producer (Rekap Posyandu) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
    set(catalog, `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`);

    const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offsets = [];
    let pos = parts[0].length;
    objs.forEach((b, i) => {
      offsets.push(pos);
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), b, Buffer.from('\nendobj\n', 'latin1')]);
      parts.push(chunk);
      pos += chunk.length;
    });
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoRef} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
  }
}

module.exports = { PdfDoc, textWidth };
