const bcrypt = require('bcryptjs');
const { one, many, tx } = require('./db');
const { PRESETS } = require('./presets');
const { THREATS, INDUSTRIES } = require('./generator/library');
const { generateBuiltin } = require('./generator');
const { saveScenario, createExercise, createOrgTeam, ensureExerciseTeam } = require('./services');
const { getSetting, setSetting } = require('./settings');

// Ancaman → sektor contoh untuk template bawaan
const TEMPLATE_PLAN = [
  ['ransomware', 'pemerintah'],
  ['data_breach', 'keuangan'],
  ['bec', 'swasta'],
  ['ddos', 'pemerintah'],
  ['insider', 'keuangan'],
  ['defacement', 'pemerintah'],
  ['hoax', 'pemerintah'],
  ['earthquake', 'kesehatan'],
  ['flood', 'pemerintah'],
  ['cloud_outage', 'swasta'],
];

async function seedAdmin() {
  const count = await one('SELECT COUNT(*)::int AS n FROM users');
  if (count.n > 0) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@ttx.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin12345';
  const hash = await bcrypt.hash(password, 10);
  await one(
    `INSERT INTO users(email, name, password_hash, role, organization) VALUES ($1,$2,$3,'admin',$4) RETURNING id`,
    [email, 'Administrator', hash, process.env.ORG_NAME || null]
  );
  console.log(`[seed] admin dibuat: ${email}`);
}

async function seedPresets() {
  const n = await one('SELECT COUNT(*)::int AS n FROM role_presets WHERE is_builtin');
  if (n.n > 0) return;
  await tx(async (c) => {
    for (const p of PRESETS) {
      const preset = (
        await c.query(
          'INSERT INTO role_presets(name, sector, description, is_builtin) VALUES ($1,$2,$3,TRUE) RETURNING id',
          [p.name, p.sector, p.description]
        )
      ).rows[0];
      let sort = 0;
      for (const r of p.roles) {
        await c.query(
          `INSERT INTO player_roles(preset_id, code, name, subtitle, description, color, can_approve, can_statement, can_escalate, sort)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [preset.id, r.code, r.name, r.subtitle, r.description, r.color, !!r.can_approve, !!r.can_statement, !!r.can_escalate, sort++]
        );
      }
    }
  });
  console.log(`[seed] ${PRESETS.length} preset peran dibuat`);
}

// Naikkan setiap kali isi pustaka skenario berubah: template bawaan diperbarui otomatis saat start.
// Latihan yang sudah dibuat dari template tidak terpengaruh (isinya sudah disalin ke latihan).
const TEMPLATE_VERSION = 2;

async function seedTemplates() {
  const n = await one(`SELECT COUNT(*)::int AS n FROM scenarios WHERE source='template'`);
  const version = await getSetting('template_version');
  if (n.n > 0 && version === TEMPLATE_VERSION) return;
  await tx(async (c) => {
    if (n.n > 0) await c.query(`DELETE FROM scenarios WHERE source='template'`);
    for (const [threat, industry] of TEMPLATE_PLAN) {
      if (!THREATS[threat]) continue;
      const data = generateBuiltin({
        threat,
        industry,
        difficulty: 'menengah',
        duration_min: 180,
        organization: INDUSTRIES[industry].org,
      });
      await saveScenario(c, data, null, 'template');
    }
  });
  await setSetting('template_version', TEMPLATE_VERSION);
  console.log(`[seed] ${TEMPLATE_PLAN.length} template skenario ${n.n > 0 ? 'diperbarui' : 'dibuat'} (versi ${TEMPLATE_VERSION})`);
}

const DEMO_USERS = [
  ['fasilitator@ttx.local', 'Fasilitator Demo', 'facilitator', null, null],
  ['evaluator@ttx.local', 'Evaluator Demo', 'evaluator', null, null],
  ['sekda@ttx.local', 'Budi Santoso (Sekda)', 'player', 'leader', 'Pemkab Sukamaju'],
  ['kominfo@ttx.local', 'Sari Wulandari (Kadis Kominfo)', 'player', 'it_head', 'Pemkab Sukamaju'],
  ['csirt@ttx.local', 'Andi Pratama (CSIRT)', 'player', 'tech', 'Pemkab Sukamaju'],
  ['humas@ttx.local', 'Rina Anggraini (Humas)', 'player', 'comms', 'Pemkab Sukamaju'],
  ['hukum@ttx.local', 'Dodi Hermawan (Hukum)', 'player', 'legal', 'Pemkab Sukamaju'],
  ['dukcapil@ttx.local', 'Maya Lestari (Dukcapil)', 'player', 'ops', 'Pemkab Sukamaju'],
];

async function seedDemo() {
  if (String(process.env.SEED_DEMO || 'true').toLowerCase() !== 'true') return;
  const exists = await one(`SELECT id FROM users WHERE email='fasilitator@ttx.local'`);
  if (exists) return;
  const hash = await bcrypt.hash(process.env.DEMO_PASSWORD || 'demo12345', 10);
  await tx(async (c) => {
    const ids = {};
    for (const [email, name, role] of DEMO_USERS) {
      ids[email] = (
        await c.query(
          'INSERT INTO users(email, name, password_hash, role, organization) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [email, name, hash, role, 'Pemkab Sukamaju']
        )
      ).rows[0].id;
    }
    const scenario = (
      await c.query(`SELECT id FROM scenarios WHERE source='template' AND threat_type='ransomware' ORDER BY id LIMIT 1`)
    ).rows[0];
    if (!scenario) return;
    const ex = await createExercise(
      c,
      { scenario_id: scenario.id, title: 'DEMO — Simulasi Ransomware Pemkab Sukamaju', speed: 2 },
      ids['fasilitator@ttx.local']
    );
    // Tim instansi (lintas latihan). Pemkot Mekarsari sengaja kosong untuk mencoba alur token → lamaran → siap.
    const presetId = (await c.query(`SELECT id FROM role_presets WHERE name='Pemerintah Daerah' AND is_builtin LIMIT 1`)).rows[0].id;
    const pemkab = await createOrgTeam(c, { name: 'Pemkab Sukamaju', preset_id: presetId }, null);
    await createOrgTeam(c, { name: 'Pemkot Mekarsari', preset_id: presetId }, null);
    const presetRoles = (await c.query('SELECT id, code FROM player_roles WHERE preset_id=$1', [presetId])).rows;
    const exRoles = (await c.query('SELECT id, code FROM exercise_roles WHERE exercise_id=$1', [ex.id])).rows;
    // Latihan demo sudah dipublikasikan; peserta Pemkab sudah diterima dan siap agar alur demo bisa langsung dimulai.
    await c.query('UPDATE exercises SET published_at=now(), briefing=$2 WHERE id=$1', [
      ex.id,
      'Latihan berlangsung sekitar 3 jam waktu simulasi. Jawab setiap inject sesuai kewenangan peran Anda, ajukan keputusan penting ke pimpinan, dan gunakan chat tim untuk koordinasi. Tidak ada jawaban benar/salah — fokus pada proses dan koordinasi.',
    ]);
    // Pimpinan wajib ada di setiap tim yang ikut
    await c.query(`UPDATE exercise_roles SET required=TRUE WHERE exercise_id=$1 AND code='leader'`, [ex.id]);
    const exTeam = await ensureExerciseTeam(c, ex.id, pemkab.id);
    for (const [email, , role, code] of DEMO_USERS) {
      if (email === 'fasilitator@ttx.local') continue;
      if (role === 'evaluator') {
        await c.query(`INSERT INTO exercise_members(exercise_id, user_id, role) VALUES ($1,$2,'evaluator')`, [ex.id, ids[email]]);
        continue;
      }
      const pr = presetRoles.find((x) => x.code === code);
      const er = exRoles.find((x) => x.code === code);
      await c.query('INSERT INTO org_team_members(org_team_id, user_id, player_role_id, is_coordinator) VALUES ($1,$2,$3,$4)', [
        pemkab.id,
        ids[email],
        pr ? pr.id : null,
        code === 'leader',
      ]);
      await c.query(
        `INSERT INTO exercise_applications(exercise_id, user_id, org_team_id, player_role_id, status, reviewed_by, reviewed_at)
         VALUES ($1,$2,$3,$4,'accepted',$5,now())`,
        [ex.id, ids[email], pemkab.id, pr ? pr.id : null, ids['fasilitator@ttx.local']]
      );
      await c.query(
        `INSERT INTO exercise_members(exercise_id, user_id, role, team_id, exercise_role_id, ready_at) VALUES ($1,$2,'player',$3,$4,now())`,
        [ex.id, ids[email], exTeam.id, er ? er.id : null]
      );
    }
  });
  console.log('[seed] pengguna & latihan demo dibuat (password: demo12345)');
}

async function seed() {
  await seedAdmin();
  await seedPresets();
  await seedTemplates();
  await seedDemo();
  const s = await many('SELECT key FROM settings');
  if (!s.find((x) => x.key === 'ai')) {
    // tidak menyimpan apa pun; konfigurasi AI default dari env
  }
}

module.exports = { seed };
