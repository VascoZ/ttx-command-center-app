// UAT browser: admin, peserta baru, fasilitator, koordinator — alur token → lamaran → siap → mulai → jawab inject.
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8080';
const ADMIN_PW = process.env.ADMIN_PASSWORD;
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const problems = [];
let step = 0;

function watch(page, who) {
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${who}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${who}] pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`[${who}] HTTP ${r.status()} ${r.url()}`);
  });
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `${String(++step).padStart(2, '0')}-${name}.png`), fullPage: true });
}
async function login(page, email, pw) {
  await page.goto(BASE);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(pw);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.getByRole('navigation', { name: 'Navigasi utama' }).waitFor();
}
const ok = (msg) => console.log('  ✓', msg);

(async () => {
  const browser = await chromium.launch();
  const mk = async (who, viewport = { width: 1366, height: 860 }) => {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    watch(page, who);
    return page;
  };
  const admin = await mk('admin');
  const fac = await mk('fasilitator');
  const peserta = await mk('peserta');
  const stamp = Date.now();

  // --- Admin: ambil token Pemkot
  await login(admin, 'admin@ttx.local', ADMIN_PW);
  await admin.goto(`${BASE}/teams`);
  const card = admin.locator('.card').filter({ has: admin.locator('input[value="Pemkot Mekarsari"]') });
  const token = (await card.locator('.mono').first().innerText()).trim();
  ok(`admin melihat token Pemkot: ${token}`);
  await shot(admin, 'admin-tim-instansi');
  await admin.goto(`${BASE}/settings`);
  await admin.getByText('Pemeriksaan keamanan').waitFor();
  await admin.locator('.badge', { hasText: /perlu perhatian|Siap produksi/ }).waitFor();
  await shot(admin, 'admin-pengaturan-keamanan');
  ok('halaman pengaturan + pemeriksaan keamanan tampil');

  // --- Peserta baru: daftar → gabung tim → lamar
  await peserta.goto(BASE);
  await peserta.getByRole('button', { name: 'Peserta baru? Daftar akun' }).click();
  await peserta.getByLabel('Nama lengkap').fill('Walikota UAT');
  await peserta.getByLabel('Email').fill(`uat${stamp}@pemkot.test`);
  await peserta.getByLabel('Instansi / unit kerja').fill('Pemkot Mekarsari');
  await peserta.getByLabel('Password (min. 8 karakter)').fill('password-uat-1');
  await peserta.getByLabel('Ulangi password').fill('password-uat-1');
  await peserta.getByRole('button', { name: 'Daftar', exact: true }).click();
  await peserta.getByRole('navigation', { name: 'Navigasi utama' }).waitFor();
  ok('peserta mendaftar & langsung masuk');
  await peserta.getByRole('link', { name: 'Tim saya', exact: true }).click();
  await peserta.getByLabel('Token tim').fill(token.toLowerCase());
  await peserta.getByRole('button', { name: 'Periksa' }).click();
  await peserta.getByText('Pilih peran Anda').waitFor();
  await shot(peserta, 'peserta-pilih-peran');
  await peserta.locator('label.option-pill').filter({ has: peserta.locator('strong', { hasText: /^Pimpinan Daerah$/ }) }).click();
  await peserta.getByRole('button', { name: 'Gabung ke tim' }).click();
  await peserta.getByText('Tim instansi Anda').waitFor();
  ok('peserta bergabung ke Pemkot sebagai Pimpinan Daerah');
  const row = peserta.locator('.feed-item', { hasText: 'DEMO' });
  await row.getByRole('button', { name: 'Lamar' }).click();
  await row.getByText('Menunggu persetujuan').waitFor();
  await shot(peserta, 'peserta-lamaran-menunggu');
  ok('peserta melamar ke latihan DEMO');

  // --- Fasilitator: terima lamaran, cek keterisian & tombol mulai
  await login(fac, 'fasilitator@ttx.local', 'demo12345');
  await fac.goto(`${BASE}/exercises`);
  await fac.getByRole('link', { name: /DEMO/ }).first().click();
  await fac.waitForURL(/\/exercises\/\d+/);
  const exUrl = fac.url().split('?')[0];
  const appsCard = fac.locator('.card', { hasText: 'Lamaran peserta' });
  await appsCard.getByText('Walikota UAT').waitFor();
  await appsCard.getByRole('button', { name: 'Terima' }).click();
  await fac.locator('.card', { hasText: 'Keterisian peran per tim' }).getByText('Pemkot Mekarsari').waitFor();
  ok('fasilitator menerima lamaran; tim Pemkot muncul di keterisian peran');
  const startBtn = fac.getByRole('button', { name: 'Mulai latihan' });
  if (!(await startBtn.isDisabled())) problems.push('Tombol Mulai aktif padahal peserta baru belum siap');
  else ok('tombol Mulai terkunci sebelum semua siap');
  await shot(fac, 'fasilitator-persiapan');

  // --- Peserta: notifikasi diterima → buka latihan → checklist → siap
  await peserta.getByText('Lamaran Anda diterima').waitFor({ timeout: 10000 });
  ok('peserta mendapat notifikasi lamaran diterima');
  await peserta.goto(exUrl);
  await peserta.getByText('Konfirmasi kesiapan Anda').waitFor();
  const siap = peserta.getByRole('button', { name: 'Saya siap' });
  if (!(await siap.isDisabled())) problems.push('Tombol Saya siap aktif sebelum checklist dicentang');
  for (const t of ['membaca briefing', 'memahami tanggung jawab', 'Notifikasi suara']) {
    await peserta.locator('label.check', { hasText: t }).locator('input').check();
  }
  await shot(peserta, 'peserta-checklist-siap');
  await siap.click();
  await peserta.getByText('Anda sudah menyatakan siap').waitFor();
  ok('peserta menyelesaikan checklist briefing & menyatakan siap');

  // --- Fasilitator: mulai & majukan jam
  await startBtn.waitFor();
  await fac.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Mulai latihan'));
    return b && !b.disabled;
  }, null, { timeout: 10000 });
  await startBtn.click();
  await fac.locator('.modal').getByRole('button', { name: 'Mulai' }).click();
  await fac.getByRole('button', { name: 'Jeda' }).waitFor();
  ok('fasilitator memulai latihan');
  await fac.getByRole('button', { name: 'Majukan' }).click();
  await fac.getByLabel('Waktu tujuan (menit simulasi)').fill('100');
  await fac.locator('.modal').getByRole('button', { name: 'Majukan' }).click();

  // --- Peserta: inbox & jawab inject
  const first = peserta.locator('.inbox-item').first();
  await first.waitFor({ timeout: 15000 });
  await first.click();
  const resp = peserta.getByPlaceholder(/Jelaskan tindakan/);
  if (await resp.count()) {
    await resp.fill('Respons UAT: aktifkan tim tanggap insiden.');
    await peserta.getByRole('button', { name: /Kirim respons/ }).click();
    await peserta.getByText(/Terakhir dikirim oleh/).waitFor();
    ok('peserta menerima inject dan mengirim respons');
  } else ok('peserta menerima inject (tanpa pertanyaan)');
  await shot(peserta, 'peserta-workspace');
  await fac.goto(`${exUrl}?tab=live`);
  await shot(fac, 'fasilitator-live');

  // --- Koordinator (Sekda) & tampilan ponsel
  const sekda = await mk('koordinator', { width: 390, height: 844 });
  await login(sekda, 'sekda@ttx.local', 'demo12345');
  await sekda.goto(`${BASE}/my-team`);
  await sekda.getByText('Anda koordinator tim').waitFor();
  await shot(sekda, 'koordinator-ponsel');
  const overflow = await sekda.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) problems.push('Halaman Tim saya melebar (scroll horizontal) di layar ponsel 390px');
  else ok('halaman Tim saya rapi di layar ponsel');

  // --- Admin: halaman lain tidak error
  for (const p of ['/', '/exercises', '/users', '/audit', '/scenarios', '/generator', '/roles']) {
    await admin.goto(BASE + p);
    await admin.waitForLoadState('networkidle');
  }
  ok('halaman admin lain dimuat');

  await browser.close();
  console.log(problems.length ? `\nMASALAH (${problems.length}):\n- ${problems.join('\n- ')}` : '\nTidak ada error konsol / halaman / server.');
  process.exit(problems.length ? 1 : 0);
})().catch(async (e) => {
  console.error('\nUAT GAGAL di langkah setelah screenshot', step, ':', e.message.split('\n')[0]);
  if (problems.length) console.error('Masalah terkumpul:\n- ' + problems.join('\n- '));
  process.exit(1);
});
