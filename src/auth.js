'use strict';
/** JWT (HS256) buatan sendiri + hash kata sandi scrypt. Hanya memakai modul bawaan Node. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function loadSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) return process.env.JWT_SECRET;
  // Di Vercel disk bersifat sementara & hanya-baca, jadi rahasia WAJIB lewat environment variable.
  if (process.env.VERCEL) throw new Error('JWT_SECRET belum diisi (minimal 16 karakter) di Environment Variables Vercel.');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const f = path.join(DATA_DIR, 'jwt.secret');
  try {
    const s = fs.readFileSync(f, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch { /* belum ada */ }
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

/** Buat token. expiresInSec default 12 jam. */
function signJwt(payload, expiresInSec = 12 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSec }));
  return `${head}.${body}.${sign(`${head}.${body}`)}`;
}

/** Mengembalikan payload bila token sah dan belum kedaluwarsa, selain itu null. */
function verifyJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const expected = Buffer.from(sign(`${h}.${b}`));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    if (header.alg !== 'HS256') return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function checkPassword(pw, stored) {
  const [alg, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { signJwt, verifyJwt, hashPassword, checkPassword, DATA_DIR };
