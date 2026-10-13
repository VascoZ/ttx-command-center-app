// Uji browser fitur chat: real-time, isolasi antar tim, kanal umum, pantauan fasilitator,
// dan latihan yang timnya baru muncul belakangan. Putus-sambung koneksi: ui-chat-reconnect.js.
//   BASE=http://localhost:8080 ADMIN_PASSWORD=... node ui-chat.js   (butuh SEED_DEMO=true)
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080';
const ADMIN_PW = process.env.ADMIN_PASSWORD;
const results = [];
const problems = [];
const check = (ok, msg) => {
  results.push([ok, msg]);
  console.log(ok ? '  ✓' : '  ✗', msg);
};

async function api(token, method, path, body) {
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json().catch(() => ({}));
}
const login = async (email, pw = 'demo12345') => (await api(null, 'POST', '/auth/login', { email, password: pw })).token;

async function openAs(browser, token, url, who) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript((t) => localStorage.setItem('ttx_token', t), token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${who}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`[${who}] console: ${m.text()}`));
  await page.goto(BASE + url);
  await page.locator('.chat').first().waitFor({ timeout: 15000 });
  return { ctx, page };
}
const chat = (page) => page.locator('.chat').first();
async function send(page, text) {
  await chat(page).locator('input.input').fill(text);
  await chat(page).getByRole('button', { name: 'Kirim' }).click();
}
async function sees(page, text, ms = 4000) {
  try {
    await chat(page).getByText(text, { exact: true }).waitFor({ timeout: ms });
    return true;
  } catch {
    return false;
  }
}
async function tab(page, name) {
  await chat(page).getByRole('tab', { name }).click();
}

(async () => {
  const stamp = Date.now();
  const admin = await login('admin@ttx.local', ADMIN_PW);
  const fac = await login('fasilitator@ttx.local');
  const humas = await login('humas@ttx.local');
  const csirt = await login('csirt@ttx.local');
  const ex = (await api(fac, 'GET', '/exercises')).find((e) => /DEMO/.test(e.title));

  // peserta Pemkot: daftar → gabung tim → lamar → diterima
  const reg = await api(null, 'POST', '/auth/register', { name: 'Peserta Pemkot', email: `chat${stamp}@pemkot.test`, password: 'password-chat-1' });
  const pk = reg.token;
  const pemkot = (await api(admin, 'GET', '/org-teams')).find((t) => t.name === 'Pemkot Mekarsari');
  const prev = await api(pk, 'POST', '/join/preview', { token: pemkot.join_token });
  await api(pk, 'POST', '/join', { token: pemkot.join_token, player_role_id: prev.roles.find((r) => r.code === 'comms').id });
  const app = await api(pk, 'POST', `/exercises/${ex.id}/apply`);
  await api(fac, 'POST', `/applications/${app.id}/accept`);

  const browser = await chromium.launch();
  const H = await openAs(browser, humas, `/exercises/${ex.id}`, 'humas');
  const C = await openAs(browser, csirt, `/exercises/${ex.id}`, 'csirt');
  const P = await openAs(browser, pk, `/exercises/${ex.id}`, 'pemkot');
  const F = await openAs(browser, fac, `/exercises/${ex.id}?tab=comms`, 'fasilitator');
  await new Promise((r) => setTimeout(r, 1500));

  console.log('Chat tim');
  const m1 = `Halo tim Pemkab ${stamp}`;
  await send(H.page, m1);
  check(await sees(H.page, m1), 'pengirim melihat pesannya sendiri');
  check(await sees(C.page, m1), 'rekan satu tim menerima pesan real-time (tanpa reload)');
  check(!(await sees(P.page, m1, 2000)), 'pesan tim Pemkab tidak terlihat oleh tim Pemkot');
  check(await sees(F.page, m1), 'fasilitator melihat chat tim Pemkab');

  const m2 = `Halo dari Pemkot ${stamp}`;
  await send(P.page, m2);
  check(await sees(P.page, m2), 'peserta Pemkot bisa chat di timnya');
  check(!(await sees(H.page, m2, 2000)), 'pesan Pemkot tidak terlihat oleh Pemkab');
  await chat(F.page).locator('select').selectOption({ label: 'Pemkot Mekarsari' });
  check(await sees(F.page, m2), 'fasilitator memilih tim Pemkot dan melihat chatnya');
  const m3 = `Arahan fasilitator untuk Pemkot ${stamp}`;
  await send(F.page, m3);
  check(await sees(P.page, m3), 'fasilitator mengirim pesan ke tim Pemkot, diterima peserta');
  check(!(await sees(H.page, m3, 2000)), 'pesan fasilitator ke Pemkot tidak bocor ke Pemkab');

  console.log('Kanal umum');
  for (const x of [H, C, P, F]) await tab(x.page, 'Umum');
  const m4 = `Pengumuman umum ${stamp}`;
  await send(H.page, m4);
  check((await sees(C.page, m4)) && (await sees(P.page, m4)) && (await sees(F.page, m4)), 'pesan umum diterima semua peserta & fasilitator');

  // Uji putus-sambung sungguhan ada di ui-chat-reconnect.js (mode offline browser tidak memutus WebSocket).

  console.log('Latihan yang timnya muncul belakangan');
  const ex2 = await api(fac, 'POST', '/exercises', { title: `Latihan chat ${stamp}`, preset_id: (await api(fac, 'GET', '/role-presets'))[0].id });
  await api(fac, 'POST', `/exercises/${ex2.id}/publish`, { published: true });
  const F2 = await openAs(browser, fac, `/exercises/${ex2.id}?tab=comms`, 'fasilitator-ex2');
  const app2 = await api(pk, 'POST', `/exercises/${ex2.id}/apply`);
  await api(fac, 'POST', `/applications/${app2.id}/accept`);
  await F2.page.waitForTimeout(2000);
  const m6 = `Selamat datang tim baru ${stamp}`;
  await send(F2.page, m6);
  const toastErr = await F2.page.locator('.toast.bad').count();
  check(toastErr === 0 && (await sees(F2.page, m6)), 'fasilitator bisa chat ke tim yang baru diterima (tanpa reload halaman)');

  console.log('Batas panjang pesan');
  const long = 'x'.repeat(4100);
  await chat(H.page).locator('input.input').fill(long);
  const val = await chat(H.page).locator('input.input').inputValue();
  check(val.length <= 4000, `input dibatasi 4000 karakter (terisi ${val.length})`);

  await browser.close();
  await api(fac, 'DELETE', `/exercises/${ex2.id}`);
  const failed = results.filter(([ok]) => !ok).length;
  console.log(`\n${results.length - failed} lulus, ${failed} gagal${problems.length ? `\nError halaman:\n- ${problems.join('\n- ')}` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('GAGAL:', e.message.split('\n')[0]);
  process.exit(1);
});
