#!/usr/bin/env node
/**
 * Membuat file .env yang aman dari .env.example: JWT_SECRET, DB_PASSWORD, dan ADMIN_PASSWORD acak.
 *
 *   node scripts/init-env.js                       # produksi: tanpa data demo, HTTP
 *   node scripts/init-env.js --demo                # dengan akun & latihan demo (gladi/pelatihan)
 *   node scripts/init-env.js --https --domain ttx.pemkab.go.id [--tls admin@pemkab.go.id]
 *   node scripts/init-env.js --force               # timpa .env yang sudah ada
 *
 * Catatan: DB_PASSWORD hanya berlaku saat database pertama kali dibuat. Untuk database yang sudah ada,
 * ganti password di PostgreSQL terlebih dahulu atau mulai dari volume baru.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const root = path.join(__dirname, '..');
const target = path.join(root, '.env');
if (fs.existsSync(target) && !flag('force')) {
  console.error('.env sudah ada. Tambahkan --force untuk menimpanya (secret lama hilang; token login lama tidak berlaku).');
  process.exit(1);
}

const hex = (n) => crypto.randomBytes(n).toString('hex');
// password mudah diketik: huruf/angka tanpa karakter ambigu
const pass = (len) => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(len), (b) => A[b % A.length]).join('');
};

const https = flag('https');
const values = {
  JWT_SECRET: hex(32),
  DB_PASSWORD: pass(24),
  ADMIN_PASSWORD: pass(16),
  SEED_DEMO: flag('demo') ? 'true' : 'false',
  TRUST_PROXY: https ? '2' : '1',
  WEB_BIND: https ? '127.0.0.1' : '0.0.0.0',
  DOMAIN: opt('domain') || 'localhost',
  TLS: opt('tls') || 'internal',
};

let text = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
for (const [k, v] of Object.entries(values)) {
  const re = new RegExp(`^${k}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
}
fs.writeFileSync(target, text, { mode: 0o600 });

console.log('.env dibuat.');
console.log(`  Admin     : ${(text.match(/^ADMIN_EMAIL=(.*)$/m) || [])[1] || 'admin@ttx.local'}`);
console.log(`  Password  : ${values.ADMIN_PASSWORD}   <- simpan di tempat aman, lalu ganti setelah login pertama`);
console.log(`  Data demo : ${values.SEED_DEMO}`);
console.log(`  HTTPS     : ${https ? `ya (DOMAIN=${values.DOMAIN}, TLS=${values.TLS})` : 'tidak'}`);
console.log(`\nJalankan: docker compose ${https ? '--profile https ' : ''}up -d --build`);
