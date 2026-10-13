/**
 * Uji beban: N peserta menjalankan alur lengkap secara bersamaan
 * (login → gabung tim via token → lamaran tim → siap → latihan berjalan → baca & jawab inject → chat).
 *
 *   cd tests && npm i socket.io-client
 *   BASE=http://localhost:8080 ADMIN_PASSWORD=... USERS=100 node load-test.js
 *
 * Membuat data uji (tim "Uji Beban …", pengguna loadtest-*@ttx.test, latihan) lalu menghapusnya kembali.
 */
const { io } = require('socket.io-client');

const BASE = process.env.BASE || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@ttx.local';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'admin12345';
const N = parseInt(process.env.USERS || '100', 10);
const PW = 'loadtest-pass-123';

const stats = {};
let errors = 0;
const errorSamples = [];

async function api(token, method, path, body, label) {
  const t0 = performance.now();
  const r = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = performance.now() - t0;
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (label) (stats[label] = stats[label] || []).push(ms);
  if (r.status >= 400) {
    errors++;
    if (errorSamples.length < 8) errorSamples.push(`${method} ${path} → ${r.status} ${JSON.stringify(data).slice(0, 120)}`);
  }
  return { status: r.status, data };
}

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
function report() {
  console.log('\nOperasi                     n     p50     p95     maks (ms)');
  for (const [k, v] of Object.entries(stats)) {
    const s = [...v].sort((a, b) => a - b);
    console.log(`${k.padEnd(24)} ${String(s.length).padStart(4)} ${pct(s, 50).toFixed(0).padStart(7)} ${pct(s, 95).toFixed(0).padStart(7)} ${s[s.length - 1].toFixed(0).padStart(8)}`);
  }
}
const all = (arr, fn) => Promise.all(arr.map(fn));

(async () => {
  console.log(`Uji beban: ${N} peserta → ${BASE}`);
  const admin = (await api(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PW })).data.token;
  if (!admin) throw new Error('Login admin gagal — set ADMIN_PASSWORD');
  const stamp = Date.now();

  // persiapan: tim, pengguna, latihan
  const presets = (await api(admin, 'GET', '/role-presets')).data;
  const preset = presets.find((p) => p.name === 'Pemerintah Daerah') || presets[0];
  const team = (await api(admin, 'POST', '/org-teams', { name: `Uji Beban ${stamp}`, preset_id: preset.id })).data;
  const bulk = await api(admin, 'POST', '/users/bulk', {
    users: Array.from({ length: N }, (_, i) => ({ email: `loadtest-${stamp}-${i}@ttx.test`, name: `Peserta Uji ${i + 1}`, password: PW, role: 'player' })),
  });
  const users = bulk.data.created;
  const scenarios = (await api(admin, 'GET', '/scenarios')).data;
  const scen = scenarios.find((s) => s.source === 'template' && s.threat_type === 'ransomware') || scenarios[0];
  const ex = (await api(admin, 'POST', '/exercises', { scenario_id: scen.id, preset_id: preset.id, title: `Uji beban ${stamp}`, speed: 10 })).data;
  await api(admin, 'POST', `/exercises/${ex.id}/publish`, { published: true });
  console.log(`Disiapkan: ${users.length} pengguna, tim #${team.id}, latihan #${ex.id}`);

  const t0 = performance.now();
  // 1. login serentak
  const tokens = await all(users, async (u) => (await api(null, 'POST', '/auth/login', { email: u.email, password: PW }, 'login')).data.token);
  // 2. gabung tim via token, peran bergiliran
  const prev = (await api(tokens[0], 'POST', '/join/preview', { token: team.join_token })).data;
  await all(tokens, (t, i) => api(t, 'POST', '/join', { token: team.join_token, player_role_id: prev.roles[i % prev.roles.length].id }, 'gabung tim'));
  // 3. koordinator melamarkan tim, admin menerima semua
  await api(admin, 'PUT', `/org-teams/${team.id}/members/${users[0].id}`, { is_coordinator: true });
  await api(tokens[0], 'POST', `/exercises/${ex.id}/apply-team`, null, 'lamaran tim');
  const acc = await api(admin, 'POST', `/exercises/${ex.id}/applications/accept-all`, null, 'terima semua');
  console.log(`Diterima: ${acc.data.accepted}`);
  // 4. socket untuk semua peserta
  let delivered = 0;
  const sockets = await all(tokens, (token) => new Promise((resolve) => {
    const s = io(BASE, { path: '/socket.io', auth: { token }, transports: ['websocket'] });
    s.on('connect', () => s.emit('join', { exerciseId: ex.id }, () => resolve(s)));
    s.on('injects:changed', () => delivered++);
    s.on('connect_error', () => resolve(s));
  }));
  // 5. semua menyatakan siap
  await all(tokens, (t) => api(t, 'POST', `/exercises/${ex.id}/ready`, { ready: true, acknowledged: true }, 'siap'));
  // 6. mulai & majukan jam agar inject terkirim
  const st = await api(admin, 'POST', `/exercises/${ex.id}/start`, {}, 'mulai latihan');
  console.log(`Mulai: ${st.status === 200 ? 'OK' : JSON.stringify(st.data)}`);
  await api(admin, 'POST', `/exercises/${ex.id}/jump`, { sim_min: 120 });
  await new Promise((r) => setTimeout(r, 3000));
  // 7. baca inject, jawab, chat — serentak
  await all(tokens, async (t, i) => {
    const inj = (await api(t, 'GET', `/exercises/${ex.id}/my-injects`, null, 'baca inject')).data;
    const target = Array.isArray(inj) ? inj.find((x) => x.requires_response) : null;
    if (target) await api(t, 'POST', `/exercise-injects/${target.id}/respond`, { content: `Respons uji ${i}` }, 'jawab inject');
    await api(t, 'POST', `/exercises/${ex.id}/messages`, { channel: 'team', body: `Pesan uji ${i}` }, 'chat tim');
  });
  const total = ((performance.now() - t0) / 1000).toFixed(1);
  sockets.forEach((s) => s.close());

  report();
  console.log(`\nSocket: ${sockets.filter((s) => s.connected !== undefined).length}/${N} terhubung, event inject diterima ${delivered} (≥ ${N} diharapkan)`);
  console.log(`Galat HTTP: ${errors}${errorSamples.length ? '\n  ' + errorSamples.join('\n  ') : ''}`);
  console.log(`Durasi alur peserta: ${total} detik`);

  // bersih-bersih
  await api(admin, 'POST', `/exercises/${ex.id}/end`);
  await api(admin, 'DELETE', `/exercises/${ex.id}`);
  await api(admin, 'DELETE', `/org-teams/${team.id}`);
  for (const u of users) await api(admin, 'DELETE', `/users/${u.id}`);
  console.log('Data uji dihapus.');
  process.exit(errors ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
