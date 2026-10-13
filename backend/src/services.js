const crypto = require('crypto');
const { resolveRoleCode } = require('./presets');

const TEAM_COLORS = ['#E5534B', '#4C9AFF', '#F2A33A', '#3FB27F', '#A78BFA', '#2DD4BF', '#F472B6', '#FB923C'];

// Tanpa karakter yang mudah tertukar (0/O, 1/I/L) agar mudah didiktekan ke peserta.
const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Normalisasi input token: huruf besar, buang spasi/tanda hubung. */
function normalizeToken(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function newTeamToken(c) {
  for (;;) {
    const bytes = crypto.randomBytes(8);
    const token = Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('');
    const r = await c.query('SELECT 1 FROM org_teams WHERE join_token=$1', [token]);
    if (!r.rows[0]) return token;
  }
}

/** Buat tim instansi (lintas latihan) beserta token bergabung. */
async function createOrgTeam(c, { name, color, preset_id }, userId) {
  const n = (await c.query('SELECT COUNT(*)::int AS n FROM org_teams')).rows[0].n;
  return (
    await c.query(
      'INSERT INTO org_teams(name, color, preset_id, join_token, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, color || TEAM_COLORS[n % TEAM_COLORS.length], preset_id || null, await newTeamToken(c), userId || null]
    )
  ).rows[0];
}

/** Tim latihan untuk sebuah tim instansi; dibuat bila belum ada. */
async function ensureExerciseTeam(c, exerciseId, orgTeamId) {
  const found = (await c.query('SELECT * FROM teams WHERE exercise_id=$1 AND org_team_id=$2', [exerciseId, orgTeamId])).rows[0];
  if (found) return found;
  const org = (await c.query('SELECT name, color FROM org_teams WHERE id=$1', [orgTeamId])).rows[0];
  return (
    await c.query('INSERT INTO teams(exercise_id, name, color, org_team_id) VALUES ($1,$2,$3,$4) RETURNING *', [
      exerciseId,
      org.name,
      org.color,
      orgTeamId,
    ])
  ).rows[0];
}

/** Petakan peran di tim instansi ke peran latihan (berdasarkan kode, lalu nama). */
async function mapExerciseRole(c, exerciseId, playerRoleId) {
  if (!playerRoleId) return null;
  const pr = (await c.query('SELECT code, name FROM player_roles WHERE id=$1', [playerRoleId])).rows[0];
  if (!pr) return null;
  const r = (
    await c.query(
      `SELECT id FROM exercise_roles WHERE exercise_id=$1 AND ((code IS NOT NULL AND code=$2) OR lower(name)=lower($3))
        ORDER BY (code=$2) DESC NULLS LAST, id LIMIT 1`,
      [exerciseId, pr.code, pr.name]
    )
  ).rows[0];
  return r ? r.id : null;
}

async function findPresetId(c, { preset_id, preset_name }) {
  if (preset_id) {
    const r = await c.query('SELECT id FROM role_presets WHERE id=$1', [preset_id]);
    if (r.rows[0]) return r.rows[0].id;
  }
  if (preset_name) {
    const r = await c.query('SELECT id FROM role_presets WHERE name=$1 ORDER BY is_builtin DESC, id LIMIT 1', [preset_name]);
    if (r.rows[0]) return r.rows[0].id;
  }
  return null;
}

/** Simpan skenario lengkap (dipakai generator, impor, seed). */
async function saveScenario(c, data, userId, source = 'manual') {
  const presetId = await findPresetId(c, data);
  const s = (
    await c.query(
      `INSERT INTO scenarios(title, category, threat_type, industry, difficulty, duration_min, summary, narrative, teams, preset_id, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        data.title || 'Skenario tanpa judul',
        data.category || 'siber',
        data.threat_type || null,
        data.industry || null,
        data.difficulty || 'menengah',
        parseInt(data.duration_min, 10) || 120,
        data.summary || '',
        data.narrative || '',
        Array.isArray(data.teams) ? data.teams.filter(Boolean) : [],
        presetId,
        source,
        userId || null,
      ]
    )
  ).rows[0];
  let i = 0;
  for (const o of data.objectives || []) {
    await c.query('INSERT INTO scenario_objectives(scenario_id, title, description, sort) VALUES ($1,$2,$3,$4)', [
      s.id,
      o.title,
      o.description || '',
      i++,
    ]);
  }
  i = 0;
  for (const inj of data.injects || []) {
    await c.query(
      `INSERT INTO scenario_injects(scenario_id, offset_min, title, type, target_team, target_role, sender, content, question, options, attachments, requires_response, priority, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        s.id,
        parseInt(inj.offset_min, 10) || 0,
        inj.title || 'Inject',
        inj.type || 'text',
        inj.target_team || null,
        inj.target_role || null,
        inj.sender || null,
        inj.content || '',
        inj.question || '',
        JSON.stringify(inj.options || []),
        JSON.stringify(inj.attachments || []),
        inj.requires_response !== false,
        inj.priority || 'normal',
        i++,
      ]
    );
  }
  return s;
}

async function copyPresetRoles(c, exerciseId, presetId) {
  if (!presetId) return [];
  const roles = (await c.query('SELECT * FROM player_roles WHERE preset_id=$1 ORDER BY sort, id', [presetId])).rows;
  const out = [];
  for (const r of roles) {
    out.push(
      (
        await c.query(
          `INSERT INTO exercise_roles(exercise_id, code, name, subtitle, description, color, can_approve, can_statement, can_escalate, sort)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [exerciseId, r.code, r.name, r.subtitle, r.description, r.color, r.can_approve, r.can_statement, r.can_escalate, r.sort]
        )
      ).rows[0]
    );
  }
  return out;
}

/**
 * Buat latihan dari skenario: salin peran, objective, inject.
 * Tim (instansi) tidak disalin dari skenario; tim hanya dibuat oleh admin.
 * Inject skenario yang hanya menargetkan tim fungsional menjadi inject untuk semua tim.
 */
async function createExercise(c, { scenario_id, title, description, preset_id, scheduled_for, speed }, userId) {
  let scenario = null;
  if (scenario_id) {
    scenario = (await c.query('SELECT * FROM scenarios WHERE id=$1', [scenario_id])).rows[0];
    if (!scenario) throw Object.assign(new Error('Skenario tidak ditemukan'), { status: 404 });
  }
  const presetId = preset_id || (scenario && scenario.preset_id) || null;
  const ex = (
    await c.query(
      `INSERT INTO exercises(scenario_id, title, description, narrative, duration_min, preset_id, scheduled_for, speed, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        scenario ? scenario.id : null,
        title || (scenario ? scenario.title : 'Latihan baru'),
        description || (scenario ? scenario.summary : ''),
        scenario ? scenario.narrative : '',
        scenario ? scenario.duration_min : 120,
        presetId,
        scheduled_for || null,
        speed || 1,
        userId,
      ]
    )
  ).rows[0];

  const roles = await copyPresetRoles(c, ex.id, presetId);
  const roleByCode = new Map(roles.map((r) => [r.code, r]));

  if (scenario) {
    await c.query(
      `INSERT INTO exercise_objectives(exercise_id, title, description, sort)
       SELECT $1, title, description, sort FROM scenario_objectives WHERE scenario_id=$2 ORDER BY sort`,
      [ex.id, scenario.id]
    );
    const injects = (await c.query('SELECT * FROM scenario_injects WHERE scenario_id=$1 ORDER BY offset_min, sort, id', [scenario.id])).rows;
    const codes = roles.map((r) => r.code);
    let i = 0;
    for (const inj of injects) {
      const code = resolveRoleCode(inj.target_role, codes);
      const role = code ? roleByCode.get(code) : null;
      await c.query(
        `INSERT INTO exercise_injects(exercise_id, team_id, exercise_role_id, offset_min, title, type, sender, content, question, options, attachments, requires_response, priority, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          ex.id,
          // inject berbasis peran berlaku untuk peran tsb. di semua tim (instansi)
          null,
          role ? role.id : null,
          inj.offset_min,
          inj.title,
          inj.type,
          inj.sender,
          inj.content,
          inj.question,
          JSON.stringify(inj.options || []),
          JSON.stringify(inj.attachments || []),
          inj.requires_response,
          inj.priority,
          i++,
        ]
      );
    }
  }
  if (userId) {
    await c.query(
      `INSERT INTO exercise_members(exercise_id, user_id, role) VALUES ($1,$2,'facilitator') ON CONFLICT DO NOTHING`,
      [ex.id, userId]
    );
  }
  return ex;
}

module.exports = {
  saveScenario,
  createExercise,
  copyPresetRoles,
  findPresetId,
  createOrgTeam,
  ensureExerciseTeam,
  mapExerciseRole,
  newTeamToken,
  normalizeToken,
  TEAM_COLORS,
};
