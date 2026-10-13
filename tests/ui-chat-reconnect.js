// Uji putus-sambung sungguhan (butuh Docker Compose di mesin yang sama): matikan container web (nginx) → kirim pesan langsung ke API → nyalakan lagi.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const BASE = 'http://localhost:8080';
const CWD = process.env.PROJECT_DIR || require('path').join(__dirname, '..');

(async () => {
  const login = async (email) => (await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'demo12345' }) })).json()).token;
  const humas = await login('humas@ttx.local');
  const csirt = await login('csirt@ttx.local');
  const ex = (await (await fetch(`${BASE}/api/exercises`, { headers: { authorization: `Bearer ${csirt}` } })).json()).find((e) => /DEMO/.test(e.title));

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript((t) => localStorage.setItem('ttx_token', t), csirt);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/exercises/${ex.id}`);
  await page.locator('.chat').waitFor();
  await page.waitForTimeout(1500);

  const msg = `Pesan saat koneksi putus ${Date.now()}`;
  execSync('docker compose stop web', { cwd: CWD, stdio: 'ignore' });
  await page.waitForTimeout(1500);
  // kirim langsung ke API di dalam container (nginx sedang mati)
  const js = `fetch('http://localhost:4000/api/exercises/${ex.id}/messages',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer ${humas}'},body:JSON.stringify({channel:'team',body:'${msg}'})}).then(r=>console.log(r.status))`;
  console.log('kirim saat putus:', execSync(`docker compose exec -T api node -e "${js}"`, { cwd: CWD }).toString().trim());
  execSync('docker compose start web', { cwd: CWD, stdio: 'ignore' });

  let ok = false;
  try {
    await page.locator('.chat').getByText(msg, { exact: true }).waitFor({ timeout: 20000 });
    ok = true;
  } catch {}
  const connected = await page.getByText('Real-time aktif').count();
  console.log(ok ? '  ✓ pesan yang terlewat muncul setelah tersambung lagi' : '  ✗ pesan yang terlewat TIDAK muncul setelah tersambung lagi', `(status real-time aktif: ${connected > 0})`);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
