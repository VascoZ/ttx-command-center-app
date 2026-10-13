const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:4000';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'admin12345';
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } }
async function api(token, method, path, body) {
  const r = await fetch(BASE + '/api' + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
async function login(email, password = 'demo12345') {
  const r = await api(null, 'POST', '/auth/login', { email, password });
  if (r.status !== 200) throw new Error('login gagal ' + email + JSON.stringify(r.data));
  return r.data.token;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('Auth');
  const admin = await login('admin@ttx.local', ADMIN_PW);
  ok(!!admin, 'admin login');
  const bad = await api(null, 'POST', '/auth/login', { email: 'admin@ttx.local', password: 'x' });
  ok(bad.status === 401, 'password salah ditolak');

  console.log('Keamanan');
  // rate limit hanya menghitung percobaan gagal, per akun
  let lastFail;
  for (let i = 0; i < 11; i++) lastFail = await api(null, 'POST', '/auth/login', { email: 'penyerang@ttx.local', password: 'salah' });
  ok(lastFail.status === 429, 'login gagal berulang ke satu akun diblokir');
  const otherOk = await api(null, 'POST', '/auth/login', { email: 'fasilitator@ttx.local', password: 'demo12345' });
  ok(otherOk.status === 200, 'akun lain dari IP yang sama tetap bisa login');
  let manyOk = true;
  for (let i = 0; i < 25; i++) manyOk = manyOk && (await api(null, 'POST', '/auth/login', { email: 'humas@ttx.local', password: 'demo12345' })).status === 200;
  ok(manyOk, '25 login berhasil berturut-turut tidak diblokir');
  const qtok = await fetch(`${BASE}/api/auth/me?token=${admin}`);
  ok(qtok.status === 401, 'token lewat query string ditolak');
  const fd = new FormData();
  fd.append('file', new Blob(['halo lampiran'], { type: 'text/plain' }), 'catatan.txt');
  const up = await (await fetch(`${BASE}/api/uploads`, { method: 'POST', headers: { authorization: 'Bearer ' + admin }, body: fd })).json();
  ok(!!up.url, 'unggah lampiran');
  ok((await fetch(BASE + up.url)).status === 401, 'lampiran tidak bisa dibuka tanpa login');
  ok((await fetch(BASE + up.url, { headers: { authorization: 'Bearer ' + admin } })).status === 200, 'lampiran bisa dibuka dengan token');
  const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'humas@ttx.local', password: 'demo12345' }) });
  const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];
  ok(/^ttx_media=/.test(cookie) && /HttpOnly/i.test(lr.headers.get('set-cookie')), 'cookie media HttpOnly diberikan saat login');
  ok((await fetch(BASE + up.url, { headers: { cookie } })).status === 200, 'lampiran bisa dibuka dengan cookie media (untuk <img>)');
  ok((await fetch(`${BASE}/api/auth/me`, { headers: { authorization: 'Bearer ' + cookie.split('=')[1] } })).status === 401, 'cookie media tidak berlaku sebagai token API');
  const sec = await api(admin, 'GET', '/security-check');
  ok(sec.status === 200 && sec.data.checks.find((c) => c.key === 'demo_accounts').ok === false && sec.data.checks.find((c) => c.key === 'admin_password').ok === true, 'pemeriksaan keamanan mendeteksi akun demo');
  ok((await api(await login('fasilitator@ttx.local'), 'GET', '/security-check')).status === 403, 'pemeriksaan keamanan hanya untuk admin');
  const fac = await login('fasilitator@ttx.local');
  const sekda = await login('sekda@ttx.local');
  const humas = await login('humas@ttx.local');
  const csirt = await login('csirt@ttx.local');
  const evalr = await login('evaluator@ttx.local');
  const hukum = await login('hukum@ttx.local');

  console.log('Presets & scenarios');
  const presets = await api(fac, 'GET', '/role-presets');
  ok(presets.data.length === 4 && presets.data[0].roles.length >= 6, 'preset bawaan tersedia');
  const scen = await api(fac, 'GET', '/scenarios');
  ok(scen.data.length === 10, '10 template skenario');
  const opts = await api(fac, 'GET', '/generator/options');
  ok(opts.data.threats.length === 10, 'opsi generator');
  const gen = await api(fac, 'POST', '/generator/generate', { threat: 'data_breach', industry: 'pemerintah', organization: 'Pemkot Uji', difficulty: 'sulit', duration_min: 240 });
  ok(gen.data.injects.length >= 10 && gen.data.title.includes('Pemkot Uji'), 'generate sulit menghasilkan inject + nama org: ' + gen.data.injects.length);
  const saved = await api(fac, 'POST', '/generator/save', gen.data);
  ok(saved.status === 201 && saved.data.injects.length === gen.data.injects.length, 'simpan hasil generator');
  const pForbidden = await api(humas, 'POST', '/generator/generate', { threat: 'ddos' });
  ok(pForbidden.status === 403, 'player tidak bisa generate');
  const dup = await api(fac, 'POST', `/scenarios/${saved.data.id}/duplicate`);
  ok(dup.status === 201, 'duplikasi skenario');
  const exp = await api(fac, 'GET', `/scenarios/${saved.data.id}/export`);
  const imp = await api(fac, 'POST', '/scenarios/import', exp.data);
  ok(imp.status === 201 && imp.data.injects.length === saved.data.injects.length, 'ekspor-impor skenario');
  const newInj = await api(fac, 'POST', `/scenarios/${imp.data.id}/injects`, { title: 'Inject manual', offset_min: 5, target_role: 'comms', options: ['A', 'B'] });
  ok(newInj.status === 201, 'tambah inject ke skenario');
  const upd = await api(fac, 'PUT', `/scenario-injects/${newInj.data.id}`, { title: 'Inject manual diubah', offset_min: 6 });
  ok(upd.data.title === 'Inject manual diubah', 'edit inject skenario');

  console.log('Exercise lifecycle');
  const list = await api(fac, 'GET', '/exercises');
  const demo = list.data.find((e) => e.title.startsWith('DEMO'));
  ok(!!demo, 'latihan demo ada');
  const exId = demo.id;
  let det = await api(fac, 'GET', `/exercises/${exId}`);
  ok(det.data.roles.length === 8 && det.data.teams.length === 1, 'peran tersalin & tim Pemkab');
  ok(det.data.members.length === 8, 'anggota: ' + det.data.members.length);
  ok(!!det.data.published_at, 'latihan demo sudah dipublikasikan');

  console.log('Tim instansi, lamaran & kesiapan');
  ok((await api(fac, 'GET', '/org-teams')).status === 403, 'fasilitator tidak bisa melihat tim instansi & token');
  ok((await api(humas, 'GET', '/org-teams')).status === 403, 'peserta tidak bisa melihat token');
  const orgs = await api(admin, 'GET', '/org-teams');
  const pemkab = orgs.data.find((t) => t.name === 'Pemkab Sukamaju');
  let pemkot = orgs.data.find((t) => t.name === 'Pemkot Mekarsari');
  ok(pemkab && pemkot && /^[A-Z0-9]{8}$/.test(pemkot.join_token) && pemkab.members.length === 6, 'admin melihat tim instansi, token & anggota');
  ok((await api(fac, 'POST', '/org-teams', { name: 'X' })).status === 403, 'fasilitator tidak bisa membuat tim');
  const tNew = await api(admin, 'POST', '/org-teams', { name: 'Pemprov Uji', preset_id: pemkot.preset_id });
  ok(tNew.status === 201 && tNew.data.join_token, 'admin membuat tim + token');
  ok((await api(admin, 'DELETE', `/org-teams/${tNew.data.id}`)).status === 200, 'admin menghapus tim');
  const oldToken = pemkot.join_token;
  const regen = await api(admin, 'POST', `/org-teams/${pemkot.id}/token`);
  ok(regen.status === 200 && regen.data.join_token !== oldToken, 'admin membuat token baru');
  pemkot = regen.data;

  const cfg = await api(null, 'GET', '/auth/config');
  ok(cfg.data.registration === true, 'pendaftaran mandiri aktif');
  const stamp = Date.now();
  const reg1 = await api(null, 'POST', '/auth/register', { name: 'Walikota Uji', email: `wali${stamp}@pemkot.test`, password: 'password123', organization: 'Pemkot Mekarsari' });
  ok(reg1.status === 201 && reg1.data.user.role === 'player' && reg1.data.token, 'peserta mendaftar sendiri (role player)');
  const regDup = await api(null, 'POST', '/auth/register', { name: 'x', email: `wali${stamp}@pemkot.test`, password: 'password123' });
  ok(regDup.status === 400, 'email ganda ditolak');
  const regShort = await api(null, 'POST', '/auth/register', { name: 'x', email: `pendek${stamp}@pemkot.test`, password: '123' });
  ok(regShort.status === 400, 'password pendek ditolak');
  const reg2 = await api(null, 'POST', '/auth/register', { name: 'Humas Pemkot', email: `humas${stamp}@pemkot.test`, password: 'password123' });
  const reg3 = await api(null, 'POST', '/auth/register', { name: 'Tanpa Tim', email: `solo${stamp}@pemkot.test`, password: 'password123' });
  const pkLead = reg1.data.token, pkComms = reg2.data.token, noTeam = reg3.data.token;

  ok((await api(pkLead, 'POST', '/join/preview', { token: oldToken })).status === 404, 'token lama tidak berlaku');
  ok((await api(pkLead, 'POST', '/join/preview', { token: 'ZZZZ-ZZZZ' })).status === 404, 'token salah ditolak');
  const dashed = pemkot.join_token.toLowerCase().replace(/(.{4})/, '$1-');
  const prev = await api(pkLead, 'POST', '/join/preview', { token: dashed });
  ok(prev.status === 200 && prev.data.team.name === 'Pemkot Mekarsari' && prev.data.roles.length === 8, 'pratinjau token (huruf kecil + tanda hubung)');
  ok((await api(pkLead, 'POST', '/join', { token: pemkot.join_token })).status === 400, 'gabung tanpa memilih peran ditolak');
  const leaderPR = prev.data.roles.find((r) => r.code === 'leader');
  const commsPR = prev.data.roles.find((r) => r.code === 'comms');
  const j1 = await api(pkLead, 'POST', '/join', { token: pemkot.join_token, player_role_id: leaderPR.id });
  const j2 = await api(pkComms, 'POST', '/join', { token: pemkot.join_token, player_role_id: commsPR.id });
  ok(j1.status === 201 && j2.status === 201, 'peserta bergabung ke tim instansi & mengambil peran');
  const myT = await api(pkLead, 'GET', '/join/me');
  ok(myT.data.team.name === 'Pemkot Mekarsari' && myT.data.player_role_id === leaderPR.id && myT.data.members.length === 2, 'halaman tim saya');
  ok((await api(pkComms, 'POST', '/join', { token: pemkab.join_token, player_role_id: commsPR.id })).status === 403, 'tidak bisa pindah ke tim lain sendiri');
  ok((await api(humas, 'POST', '/join/preview', { token: pemkot.join_token })).status === 403, 'anggota Pemkab tidak bisa masuk Pemkot');
  await api(admin, 'PUT', `/org-teams/${pemkot.id}`, { join_enabled: false });
  ok((await api(noTeam, 'POST', '/join/preview', { token: pemkot.join_token })).status === 404, 'token nonaktif ditolak');
  await api(admin, 'PUT', `/org-teams/${pemkot.id}`, { join_enabled: true });

  // lamaran ke latihan
  const open = await api(pkLead, 'GET', '/exercises/open');
  ok(open.data.some((e) => e.id === exId && !e.application_status), 'latihan terpublikasi terlihat peserta');
  ok((await api(noTeam, 'POST', `/exercises/${exId}/apply`)).status === 400, 'belum punya tim tidak bisa melamar');
  await api(fac, 'POST', `/exercises/${exId}/publish`, { published: false });
  ok((await api(pkLead, 'POST', `/exercises/${exId}/apply`)).status === 404, 'latihan belum dipublikasikan tidak bisa dilamar');
  await api(fac, 'POST', `/exercises/${exId}/publish`, { published: true });

  // undangan per instansi
  const inv = await api(fac, 'GET', `/exercises/${exId}/invites`);
  ok(inv.status === 200 && inv.data.length === 2 && inv.data.every((t) => !t.invited && t.join_token === undefined), 'fasilitator melihat daftar instansi (tanpa token)');
  await api(fac, 'PUT', `/exercises/${exId}/invites`, { org_team_ids: [pemkab.id] });
  const openInv = await api(pkLead, 'GET', '/exercises/open');
  ok(!openInv.data.some((e) => e.id === exId), 'latihan tidak terlihat oleh instansi yang tidak diundang');
  ok((await api(pkLead, 'POST', `/exercises/${exId}/apply`)).status === 403, 'instansi tidak diundang tidak bisa melamar');
  await api(fac, 'PUT', `/exercises/${exId}/invites`, { org_team_ids: [pemkab.id, pemkot.id] });
  ok((await api(pkLead, 'GET', '/exercises/open')).data.some((e) => e.id === exId), 'instansi yang diundang melihat latihan');

  const a1 = await api(pkLead, 'POST', `/exercises/${exId}/apply`, { message: 'Siap ikut' });
  ok(a1.status === 201 && a1.data.status === 'pending', 'peserta melamar');
  ok((await api(pkLead, 'POST', `/exercises/${exId}/apply`)).status === 400, 'lamaran ganda ditolak');
  // koordinator melamarkan seluruh tim
  const opsPR = prev.data.roles.find((r) => r.code === 'ops');
  await api(noTeam, 'POST', '/join', { token: pemkot.join_token, player_role_id: opsPR.id });
  ok((await api(pkLead, 'POST', `/exercises/${exId}/apply-team`)).status === 403, 'bukan koordinator tidak bisa melamarkan tim');
  const pkLeadUser = (await api(pkLead, 'GET', '/auth/me')).data.user;
  await api(admin, 'PUT', `/org-teams/${pemkot.id}/members/${pkLeadUser.id}`, { is_coordinator: true });
  const at = await api(pkLead, 'POST', `/exercises/${exId}/apply-team`);
  ok(at.status === 201 && at.data.applied === 2, 'koordinator melamarkan anggota tim: ' + at.data.applied);
  const coordView = (await api(pkLead, 'GET', '/exercises/open')).data.find((e) => e.id === exId);
  ok(coordView.team_members && coordView.team_members.length === 3 && coordView.team_members.every((m) => m.application_status === 'pending'), 'koordinator melihat status lamaran tim');
  const pkCommsUser = (await api(pkComms, 'GET', '/auth/me')).data.user;
  const a2 = { data: (await api(fac, 'GET', `/exercises/${exId}/applications`)).data.find((x) => x.user_id === pkCommsUser.id) };
  ok((await api(humas, 'GET', `/exercises/${exId}/applications`)).status === 403, 'peserta tidak bisa melihat lamaran');
  ok((await api(humas, 'POST', `/applications/${a1.data.id}/accept`)).status === 403, 'peserta tidak bisa menerima lamaran');
  const leaderRole = det.data.roles.find((r) => r.code === 'leader');
  const apps = await api(fac, 'GET', `/exercises/${exId}/applications`);
  const app1 = apps.data.find((x) => x.id === a1.data.id);
  ok(apps.data.filter((x) => x.status === 'pending').length === 3 && app1.suggested_role_id === leaderRole.id, 'fasilitator melihat lamaran + usulan peran');
  const rej = await api(fac, 'POST', `/applications/${a2.data.id}/reject`, { note: 'Lengkapi data' });
  ok(rej.data.status === 'rejected', 'fasilitator menolak lamaran');
  const open2 = await api(pkComms, 'GET', '/exercises/open');
  ok(open2.data.find((e) => e.id === exId).application_status === 'rejected', 'peserta melihat lamaran ditolak');
  ok((await api(pkComms, 'POST', `/exercises/${exId}/apply`)).status === 201, 'peserta melamar ulang');
  const accAll = await api(fac, 'POST', `/exercises/${exId}/applications/accept-all`);
  ok(accAll.data.accepted === 3, 'terima semua lamaran');
  det = await api(fac, 'GET', `/exercises/${exId}`);
  const pkTeamEx = det.data.teams.find((t) => t.name === 'Pemkot Mekarsari');
  ok(det.data.teams.length === 2 && pkTeamEx && det.data.members.length === 11, 'tim latihan Pemkot dibuat otomatis');
  const meLead = await api(pkLead, 'GET', `/exercises/${exId}`);
  ok(meLead.data.me.team_id === pkTeamEx.id && meLead.data.me.exercise_role_id === leaderRole.id && meLead.data.me.can_approve && !meLead.data.me.ready, 'peran latihan dipetakan dari peran tim');

  // kesiapan
  const stNR = await api(fac, 'POST', `/exercises/${exId}/start`);
  ok(stNR.status === 400 && /Walikota Uji/.test(stNR.data.error), 'latihan tidak bisa dimulai sebelum semua siap');
  ok((await api(fac, 'POST', `/exercises/${exId}/ready`)).status === 403, 'fasilitator tidak menyatakan siap');
  await api(fac, 'PUT', `/exercises/${exId}`, { briefing: 'Briefing uji: fokus koordinasi.' });
  ok((await api(pkLead, 'GET', `/exercises/${exId}`)).data.briefing === 'Briefing uji: fokus koordinasi.', 'peserta melihat briefing');
  ok((await api(pkLead, 'POST', `/exercises/${exId}/ready`, { ready: true })).status === 400, 'siap tanpa checklist briefing ditolak');
  const rd1 = await api(pkLead, 'POST', `/exercises/${exId}/ready`, { ready: true, acknowledged: true });
  const rd2 = await api(pkComms, 'POST', `/exercises/${exId}/ready`, { ready: true, acknowledged: true });
  ok(!!rd1.data.ready_at && !!rd2.data.ready_at, 'peserta menyatakan siap');

  // peran wajib (Pimpinan sudah wajib di demo; tambah CSIRT wajib → Pemkot belum punya)
  const techRole = det.data.roles.find((r) => r.code === 'tech');
  ok(det.data.roles.find((r) => r.code === 'leader').required === true, 'peran Pimpinan wajib di latihan demo');
  await api(fac, 'PUT', `/exercise-roles/${techRole.id}`, { ...techRole, required: true });
  const stReq = await api(fac, 'POST', `/exercises/${exId}/start`, { drop_not_ready: true });
  ok(stReq.status === 400 && /Peran wajib.*Pemkot Mekarsari \(Tim Teknis/.test(stReq.data.error), 'start ditolak: peran wajib kosong');
  ok((await api(fac, 'GET', `/exercises/${exId}`)).data.members.length === 11, 'penolakan start tidak mengeluarkan peserta (rollback)');
  await api(fac, 'PUT', `/exercise-roles/${techRole.id}`, { ...techRole, required: false });
  const humasDet = await api(humas, 'GET', `/exercises/${exId}`);
  ok(humasDet.data.me.can_statement && !humasDet.data.me.can_approve, 'humas: can_statement');
  const startP = await api(humas, 'POST', `/exercises/${exId}/start`);
  ok(startP.status === 403, 'player tidak bisa start');

  // sockets
  const mkSock = (token) => new Promise((res) => { const s = io(BASE, { path: '/socket.io', auth: { token }, transports: ['websocket'] }); s.on('connect', () => s.emit('join', { exerciseId: exId }, () => res(s))); });
  const sFac = await mkSock(fac), sHumas = await mkSock(humas), sSekda = await mkSock(sekda), sCsirt = await mkSock(csirt);
  const got = { facInject: 0, humasChanged: 0, sekdaDecision: 0, humasLeak: 0, statement: 0, escalation: 0, presence: 0, reminder: 0, started: 0 };
  sHumas.on('exercise:reminder', () => got.reminder++);
  sHumas.on('exercise:started', () => got.started++);
  sFac.on('inject:sent', () => got.facInject++);
  sHumas.on('injects:changed', () => got.humasChanged++);
  sHumas.on('inject:sent', () => got.humasLeak++);
  sSekda.on('decision:new', () => got.sekdaDecision++);
  sCsirt.on('statement:new', () => got.statement++);
  sSekda.on('escalation:new', () => got.escalation++);

  // pengingat jadwal (dicek scheduler tiap ±5 detik)
  await api(fac, 'PUT', `/exercises/${exId}`, { scheduled_for: new Date(Date.now() + 5 * 60000).toISOString() });
  await sleep(6500);
  ok(got.reminder === 1, 'pengingat jadwal terkirim ke peserta');

  const st = await api(fac, 'POST', `/exercises/${exId}/start`, { drop_not_ready: true });
  ok(st.data.status === 'running', 'start latihan (peserta belum siap dikeluarkan)');
  const afterStart = await api(fac, 'GET', `/exercises/${exId}`);
  const noTeamUser = (await api(noTeam, 'GET', '/auth/me')).data.user;
  ok(afterStart.data.members.length === 10 && !afterStart.data.members.some((m) => m.user_id === noTeamUser.id), 'peserta yang tidak siap dikeluarkan');
  await sleep(1500);
  const jump = await api(fac, 'POST', `/exercises/${exId}/jump`, { sim_min: 100 });
  ok(jump.status === 200, 'lompat jam simulasi ke T+100');
  await sleep(2000);
  ok(got.facInject >= 5, 'fasilitator menerima inject:sent: ' + got.facInject);
  ok(got.started === 1, 'peserta diberi tahu latihan dimulai');
  ok(got.humasChanged >= 1, 'humas menerima injects:changed');
  ok(got.humasLeak === 0, 'isi inject tidak bocor ke player via socket');
  const myH = await api(humas, 'GET', `/exercises/${exId}/my-injects`);
  const myC = await api(csirt, 'GET', `/exercises/${exId}/my-injects`);
  ok(myH.data.length > 0 && myC.data.length > 0, `inject terfilter per peran (humas ${myH.data.length}, csirt ${myC.data.length})`);
  const allInj = await api(fac, 'GET', `/exercises/${exId}/injects`);
  const csirtOnly = allInj.data.find((i) => i.status === 'sent' && i.exercise_role_id && i.exercise_role_id === myC.data[0].exercise_role_id);
  ok(!myH.data.some((i) => csirtOnly && i.id === csirtOnly.id), 'inject khusus CSIRT tidak terlihat humas');
  const injH = myH.data[0];
  const resp = await api(humas, 'POST', `/exercise-injects/${injH.id}/respond`, { content: 'Holding statement disiapkan', choice: (injH.options || [])[0] });
  ok(resp.status === 200, 'humas merespons inject');
  const respWrong = await api(humas, 'POST', `/exercise-injects/${csirtOnly ? csirtOnly.id : 0}/respond`, { content: 'x' });
  ok(respWrong.status === 403 || respWrong.status === 404, 'tidak bisa merespons inject peran lain');
  const playerInj = await api(humas, 'GET', `/exercises/${exId}/injects`);
  ok(playerInj.status === 403, 'player tidak bisa lihat semua inject');

  // decision approval
  const dec = await api(humas, 'POST', `/exercises/${exId}/decisions`, { decision: 'Terbitkan siaran pers', rationale: 'Meredam spekulasi' });
  ok(dec.data.status === 'pending', 'keputusan humas menunggu persetujuan');
  await sleep(300);
  ok(got.sekdaDecision >= 1, 'sekda (approver) menerima notifikasi keputusan');
  const rejByHukum = await api(hukum, 'POST', `/decisions/${dec.data.id}/approve`, {});
  ok(rejByHukum.status === 403, 'hukum tidak berwenang menyetujui');
  const appr = await api(sekda, 'POST', `/decisions/${dec.data.id}/approve`, { note: 'Setuju' });
  ok(appr.data.status === 'approved' && appr.data.approver_name, 'sekda menyetujui keputusan');
  const decS = await api(sekda, 'POST', `/exercises/${exId}/decisions`, { decision: 'Aktifkan tim tanggap insiden' });
  ok(decS.data.status === 'approved', 'keputusan approver langsung disetujui');

  // isolasi antarinstansi
  const pkList = await api(pkLead, 'GET', `/exercises/${exId}/decisions`);
  ok(!pkList.data.some((d) => d.id === dec.data.id), 'approver Pemkot tidak melihat keputusan Pemkab');
  const decPk = await api(pkComms, 'POST', `/exercises/${exId}/decisions`, { decision: 'Tutup layanan publik Pemkot' });
  ok(decPk.data.status === 'pending' && decPk.data.team_name === 'Pemkot Mekarsari', 'keputusan Pemkot menunggu approver Pemkot');
  ok((await api(sekda, 'POST', `/decisions/${decPk.data.id}/approve`, {})).status === 403, 'Sekda Pemkab tidak bisa menyetujui keputusan Pemkot');
  const apprPk = await api(pkLead, 'POST', `/decisions/${decPk.data.id}/approve`, {});
  ok(apprPk.data.status === 'approved', 'approver Pemkot menyetujui keputusan timnya');

  // statement & escalation
  const stmtBad = await api(csirt, 'POST', `/exercises/${exId}/statements`, { title: 'x', body: 'y' });
  ok(stmtBad.status === 403, 'CSIRT tidak bisa menerbitkan pernyataan');
  const stmt = await api(humas, 'POST', `/exercises/${exId}/statements`, { title: 'Siaran Pers #1', body: 'Pemkab sedang menangani gangguan.' });
  ok(stmt.status === 201, 'humas menerbitkan pernyataan publik');
  const leader = det.data.roles.find((r) => r.code === 'leader');
  const esc = await api(csirt, 'POST', `/exercises/${exId}/escalations`, { to_role_id: leader.id, subject: 'Backup terenkripsi', body: 'Butuh keputusan' });
  ok(esc.status === 201, 'CSIRT eskalasi ke pimpinan');
  const escBad = await api(humas, 'POST', `/exercises/${exId}/escalations`, { to_role_id: leader.id, subject: 'x' });
  ok(escBad.status === 403, 'humas tidak bisa eskalasi');
  await sleep(300);
  ok(got.statement >= 1 && got.escalation >= 1, 'event statement & escalation diterima via socket');
  const pkEsc = await api(pkLead, 'GET', `/exercises/${exId}/escalations`);
  ok(!pkEsc.data.some((e) => e.id === esc.data.id), 'eskalasi Pemkab tidak sampai ke pimpinan Pemkot');
  ok((await api(pkLead, 'POST', `/escalations/${esc.data.id}/ack`)).status === 403, 'pimpinan Pemkot tidak bisa menerima eskalasi Pemkab');
  const ack = await api(sekda, 'POST', `/escalations/${esc.data.id}/ack`);
  ok(!!ack.data.acknowledged_at, 'sekda menerima eskalasi');

  // chat
  const m1 = await api(humas, 'POST', `/exercises/${exId}/messages`, { channel: 'team', body: 'Halo tim' });
  ok(m1.status === 201, 'chat tim');
  const csirtTeam = await api(csirt, 'GET', `/exercises/${exId}/messages?channel=team`);
  ok(csirtTeam.data.some((m) => m.body === 'Halo tim'), 'chat tim terlihat sesama anggota instansi');
  const pkTeam = await api(pkComms, 'GET', `/exercises/${exId}/messages?channel=team`);
  ok(!pkTeam.data.some((m) => m.body === 'Halo tim'), 'chat tim tidak bocor ke instansi lain');
  const bc = await api(fac, 'POST', `/exercises/${exId}/broadcast`, { body: 'Semua tim: rapat di posko' });
  ok(bc.status === 201, 'broadcast fasilitator');

  // chat berhalaman & batas spam
  for (let i = 1; i <= 3; i++) await api(csirt, 'POST', `/exercises/${exId}/messages`, { channel: 'team', body: `Halaman ${i}` });
  const pg1 = await api(csirt, 'GET', `/exercises/${exId}/messages?channel=team&limit=2`);
  ok(pg1.data.length === 2 && pg1.data[1].body === 'Halaman 3', 'chat: halaman terbaru berisi pesan paling baru');
  const pg2 = await api(csirt, 'GET', `/exercises/${exId}/messages?channel=team&limit=2&before=${pg1.data[0].id}`);
  ok(pg2.data.length === 2 && pg2.data[pg2.data.length - 1].id < pg1.data[0].id, 'chat: muat pesan sebelumnya');
  let spam = 0;
  for (let i = 0; i < 25; i++) if ((await api(evalr, 'POST', `/exercises/${exId}/messages`, { channel: 'general', body: `spam ${i}` })).status === 429) spam++;
  ok(spam >= 5, `chat: pesan beruntun dibatasi (${spam} dari 25 ditolak)`);
  ok((await api(csirt, 'POST', `/exercises/${exId}/messages`, { channel: 'team', body: 'Pengguna lain tetap bisa chat' })).status === 201, 'chat: batas spam per orang, tidak memblokir orang lain');

  // evaluation
  const objs = det.data.objectives;
  const obs = await api(evalr, 'POST', `/exercises/${exId}/observations`, { category: 'perbaikan', body: 'Eskalasi lambat', team_id: det.data.teams[0].id });
  ok(obs.status === 201, 'evaluator mencatat observasi');
  const obsP = await api(humas, 'POST', `/exercises/${exId}/observations`, { body: 'x' });
  ok(obsP.status === 403, 'player tidak bisa observasi');
  const sc = await api(evalr, 'POST', `/exercises/${exId}/scores`, { objective_id: objs[0].id, team_id: det.data.teams[1].id, score: 4, comment: 'Baik' });
  const sc2 = await api(evalr, 'POST', `/exercises/${exId}/scores`, { objective_id: objs[1].id, score: 2 });
  ok(sc.status === 200 && sc2.status === 200, 'evaluator memberi skor');

  // pause/speed/send manual/adhoc
  const pz = await api(fac, 'POST', `/exercises/${exId}/pause`);
  ok(pz.data.status === 'paused', 'jeda');
  const sp = await api(fac, 'POST', `/exercises/${exId}/speed`, { speed: 5 });
  ok(sp.data.speed === 5, 'ubah kecepatan');
  const rs = await api(fac, 'POST', `/exercises/${exId}/resume`);
  ok(rs.data.status === 'running', 'lanjutkan');
  const ad = await api(fac, 'POST', `/exercises/${exId}/injects`, { title: 'Inject ad-hoc', exercise_role_id: leader.id, send_now: true, content: 'Menteri menelepon' });
  ok(ad.data.status === 'sent' && ad.data.adhoc, 'inject ad-hoc langsung terkirim');
  const sched = allInj.data.find((i) => i.status === 'scheduled');
  if (sched) {
    const sn = await api(fac, 'POST', `/exercise-injects/${sched.id}/send`);
    ok(sn.data.status === 'sent', 'kirim inject terjadwal lebih awal');
  }
  const end = await api(fac, 'POST', `/exercises/${exId}/end`);
  ok(end.data.status === 'ended', 'akhiri latihan');
  const fb = await api(humas, 'POST', `/exercises/${exId}/feedback`, { rating: 5, realism: 4, comments: 'Sangat realistis' });
  ok(fb.status === 200, 'umpan balik peserta');

  console.log('Report');
  const rep = await api(fac, 'GET', `/exercises/${exId}/report`);
  ok(rep.status === 200 && rep.data.summary.decisions === 3 && rep.data.summary.statements === 1, 'laporan AAR');
  ok(rep.data.roles.find((r) => r.code === undefined || true) && rep.data.roles.length === 8, 'rekap per peran');
  ok(rep.data.improvements.length > 0 && rep.data.recommendations.length > 0, 'temuan & rekomendasi otomatis');
  const repP = await api(humas, 'GET', `/exercises/${exId}/report`);
  ok(repP.status === 403, 'player tidak bisa lihat laporan');
  const nar = await api(fac, 'POST', `/exercises/${exId}/report/narrative`, {});
  ok(nar.data.text && nar.data.text.length > 100, 'narasi AAR (mesin bawaan)');
  const act = await api(fac, 'POST', `/exercises/${exId}/actions`, { title: 'Jalur eskalasi darurat', owner: 'Kominfo', due_date: '2026-11-30' });
  const actU = await api(fac, 'PUT', `/actions/${act.data.id}`, { status: 'in_progress' });
  ok(actU.data.status === 'in_progress' && actU.data.due_date === '2026-11-30', 'rencana perbaikan CRUD');
  const tl = await api(fac, 'GET', `/exercises/${exId}/timeline`);
  ok(tl.data.length > 10, 'timeline replay: ' + tl.data.length + ' event');
  const csv = await fetch(`${BASE}/api/exercises/${exId}/export.csv?type=decisions`, { headers: { authorization: 'Bearer ' + fac } });
  ok(csv.status === 200 && (await csv.text()).includes('Terbitkan siaran pers'), 'ekspor CSV');

  console.log('Admin');
  const nu = await api(admin, 'POST', '/users', { email: 'baru@ttx.local', name: 'Baru', role: 'player', password: 'password123' });
  ok(nu.status === 201, 'admin membuat pengguna');
  const bulk = await api(admin, 'POST', '/users/bulk', { users: [{ email: 'b1@ttx.local', name: 'B1', password: 'password123' }, { email: 'bad', name: 'x', password: 'password123' }] });
  ok(bulk.data.created.length === 1 && bulk.data.errors.length === 1, 'impor massal pengguna');
  const audit = await api(admin, 'GET', '/audit');
  ok(audit.data.length > 5, 'audit log');
  const dash = await api(fac, 'GET', '/dashboard');
  ok(dash.data.counts.ended >= 1, 'dashboard');
  const np = await api(fac, 'POST', '/role-presets', { name: 'Pemprov Custom', copy_from: presets.data.find((p) => p.name === 'Pemerintah Daerah').id });
  const npRole = await api(fac, 'POST', `/role-presets/${np.data.id}/roles`, { name: 'Satpol PP', code: 'ops', can_escalate: true });
  ok(npRole.status === 201, 'preset & peran kustom');
  const ex2 = await api(fac, 'POST', '/exercises', { scenario_id: saved.data.id, preset_id: np.data.id, title: 'Latihan baru' });
  const ex2d = await api(fac, 'GET', `/exercises/${ex2.data.id}`);
  ok(ex2d.data.roles.length === 9, 'latihan baru memakai preset kustom (9 peran)');
  const rst = await api(fac, 'POST', `/exercises/${exId}/reset`);
  ok(rst.data.status === 'draft', 'reset latihan ke draft');
  const settings = await api(admin, 'PUT', '/settings', { ai: { provider: 'builtin' } });
  ok(settings.status === 200, 'pengaturan AI');

  [sFac, sHumas, sSekda, sCsirt].forEach((s) => s.close());
  console.log(`\n${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
