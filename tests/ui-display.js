// Uji browser layar penonton: fasilitator membuat tautan lewat konsol, layar dibuka TANPA login (TV 1920×1080),
// diperbarui otomatis saat latihan berjalan, dan tetap rapi di layar ponsel.
//   BASE=http://localhost:8080 SHOTS=./shots node ui-display.js   (butuh SEED_DEMO=true, database baru)
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8080';
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const problems = [];
const results = [];
const check = (ok, msg) => {
  results.push(ok);
  console.log(ok ? '  ✓' : '  ✗', msg);
};
async function api(token, method, p, body) {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
}
const login = async (email) => (await api(null, 'POST', '/auth/login', { email, password: 'demo12345' })).token;
function watch(page, who) {
  page.on('pageerror', (e) => problems.push(`[${who}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`[${who}] console: ${m.text()}`));
}

(async () => {
  const fac = await login('fasilitator@ttx.local');
  const humas = await login('humas@ttx.local');
  const ex = (await api(fac, 'GET', '/exercises')).find((e) => /DEMO/.test(e.title));
  const browser = await chromium.launch();

  // fasilitator membuat tautan lewat tombol "Layar" di konsol
  const fctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  await fctx.addInitScript((t) => localStorage.setItem('ttx_token', t), fac);
  const fpage = await fctx.newPage();
  watch(fpage, 'fasilitator');
  await fpage.goto(`${BASE}/exercises/${ex.id}`);
  await fpage.getByRole('button', { name: 'Layar' }).click();
  await fpage.getByRole('button', { name: 'Buat tautan' }).click();
  const link = await fpage.getByLabel('Tautan layar').inputValue();
  check(/\/display\/[A-Za-z0-9_-]{20,}$/.test(link), 'fasilitator membuat tautan layar dari konsol');
  await fpage.screenshot({ path: path.join(SHOTS, 'display-0-modal.png') });

  // layar TV tanpa login
  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  watch(tv, 'layar-tv');
  await tv.goto(link);
  await tv.locator('.dsp-clock-value').waitFor();
  check(await tv.getByText('Menunggu fasilitator memulai latihan').isVisible(), 'layar terbuka tanpa login, status draft tampil');
  check((await tv.locator('.dsp-team').count()) >= 1, 'kartu instansi tampil');
  await tv.screenshot({ path: path.join(SHOTS, 'display-1-draft.png') });

  // latihan berjalan + aktivitas
  await api(fac, 'POST', `/exercises/${ex.id}/start`);
  await api(fac, 'POST', `/exercises/${ex.id}/jump`, { sim_min: 95 });
  await new Promise((r) => setTimeout(r, 2500));
  const inj = (await api(humas, 'GET', `/exercises/${ex.id}/my-injects`))[0];
  if (inj) await api(humas, 'POST', `/exercise-injects/${inj.id}/respond`, { content: 'Respons rahasia tidak boleh tampil' });
  await api(humas, 'POST', `/exercises/${ex.id}/decisions`, { decision: 'Keputusan rahasia tidak boleh tampil' });
  await api(humas, 'POST', `/exercises/${ex.id}/statements`, { title: 'Siaran Pers: Gangguan Layanan Pemkab Sukamaju', body: 'Pemerintah Kabupaten Sukamaju sedang menangani gangguan sistem. Layanan tatap muka tetap dibuka dengan prosedur manual.' });
  await api(fac, 'POST', `/exercises/${ex.id}/broadcast`, { body: 'Semua tim: rapat koordinasi di posko dalam 10 menit simulasi.' });
  await tv.getByText('Siaran Pers: Gangguan Layanan Pemkab Sukamaju').first().waitFor({ timeout: 10000 });
  check(true, 'layar diperbarui otomatis (pernyataan publik muncul tanpa reload)');
  check(await tv.locator('.dsp-broadcast', { hasText: 'Semua tim: rapat koordinasi' }).isVisible(), 'pengumuman fasilitator tampil menonjol');
  const c1 = await tv.locator('.dsp-clock-value').innerText();
  await tv.waitForTimeout(2200);
  const c2 = await tv.locator('.dsp-clock-value').innerText();
  check(c1 !== c2, `jam simulasi berjalan (${c1} → ${c2})`);
  const body = await tv.locator('body').innerText();
  check(!body.includes('rahasia'), 'isi respons & keputusan tidak tampil di layar');
  await tv.screenshot({ path: path.join(SHOTS, 'display-2-running.png') });

  // layar ponsel
  const ph = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  watch(ph, 'layar-ponsel');
  await ph.goto(link);
  await ph.locator('.dsp-clock-value').waitFor();
  const overflow = await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, 'layar rapi di ponsel (tanpa geser horizontal)');
  await ph.screenshot({ path: path.join(SHOTS, 'display-3-phone.png'), fullPage: true });

  // cabut tautan → layar menampilkan pesan
  const before = problems.length; // 404 dari tautan yang dicabut memang diharapkan
  await api(fac, 'DELETE', `/exercises/${ex.id}/display-key`);
  await tv.reload();
  check(await tv.getByText(/tidak valid|dicabut/).isVisible({ timeout: 8000 }).catch(() => false), 'tautan yang dicabut menampilkan pesan jelas');
  problems.splice(before);

  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} lulus, ${failed} gagal${problems.length ? `\nError halaman:\n- ${problems.join('\n- ')}` : ''}`);
  process.exit(failed || problems.length ? 1 : 0);
})().catch((e) => {
  console.error('GAGAL:', e.message.split('\n')[0]);
  process.exit(1);
});
