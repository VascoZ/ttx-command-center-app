const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { one, many, query } = require('../db');
const { audit } = require('../auth');
const { ah, optId, forbid, notFound, bad } = require('../util');
const { normalizeToken } = require('../services');

// Batasi percobaan token agar tidak bisa ditebak secara brute force.
// Hanya token yang SALAH yang dihitung, per akun; plus batas per IP untuk penebakan dari banyak akun.
const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parseInt(process.env.JOIN_RATE_LIMIT || '20', 10),
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `u:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan token. Coba lagi dalam 15 menit.' },
});

const joinIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parseInt(process.env.JOIN_IP_RATE_LIMIT || '200', 10),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan token dari jaringan ini. Coba lagi nanti.' },
});

async function teamByToken(raw) {
  const token = normalizeToken(raw);
  if (!token) bad('Token wajib diisi');
  const team = await one(
    `SELECT t.id, t.name, t.color, t.preset_id, t.join_enabled, p.name AS preset_name
       FROM org_teams t LEFT JOIN role_presets p ON p.id=t.preset_id WHERE t.join_token=$1`,
    [token]
  );
  if (!team || !team.join_enabled) notFound('Token tidak valid atau sudah dinonaktifkan');
  return team;
}

async function myTeam(userId) {
  return one(
    `SELECT m.org_team_id, m.player_role_id, m.is_coordinator, t.name AS team_name FROM org_team_members m JOIN org_teams t ON t.id=m.org_team_id WHERE m.user_id=$1`,
    [userId]
  );
}

/** Peran preset tim beserta anggota yang sudah mengisinya. */
async function teamRoles(team) {
  return many(
    `SELECT r.id, r.code, r.name, r.subtitle, r.description, r.color, r.can_approve, r.can_statement, r.can_escalate,
            COALESCE(array_agg(u.name ORDER BY u.name) FILTER (WHERE u.id IS NOT NULL), '{}') AS holders
       FROM player_roles r
       LEFT JOIN org_team_members m ON m.player_role_id=r.id AND m.org_team_id=$2
       LEFT JOIN users u ON u.id=m.user_id
      WHERE r.preset_id=$1
      GROUP BY r.id ORDER BY r.sort, r.id`,
    [team.preset_id || 0, team.id]
  );
}

function checkCanJoin(user, team, mine) {
  if (user.role === 'admin') bad('Admin mengelola tim dan tidak perlu bergabung sebagai peserta');
  if (mine && mine.org_team_id !== team.id) forbid(`Anda sudah tergabung di tim "${mine.team_name}". Hubungi admin untuk pindah tim.`);
}

// Tim saya: data tim, peran, rekan satu tim
router.get(
  '/me',
  ah(async (req, res) => {
    const mine = await myTeam(req.user.id);
    if (!mine) return res.json({ team: null });
    const team = await one(
      `SELECT t.id, t.name, t.color, t.preset_id, p.name AS preset_name FROM org_teams t LEFT JOIN role_presets p ON p.id=t.preset_id WHERE t.id=$1`,
      [mine.org_team_id]
    );
    const [roles, members] = await Promise.all([
      teamRoles(team),
      many(
        `SELECT u.id AS user_id, u.name, m.is_coordinator, r.name AS role_name, r.color AS role_color
           FROM org_team_members m JOIN users u ON u.id=m.user_id LEFT JOIN player_roles r ON r.id=m.player_role_id
          WHERE m.org_team_id=$1 ORDER BY r.sort NULLS LAST, u.name`,
        [team.id]
      ),
    ]);
    res.json({ team, player_role_id: mine.player_role_id, is_coordinator: mine.is_coordinator, roles, members });
  })
);

// Lihat tim & peran yang tersedia sebelum bergabung
router.post(
  '/preview',
  joinIpLimiter,
  joinLimiter,
  ah(async (req, res) => {
    const team = await teamByToken(req.body.token);
    const mine = await myTeam(req.user.id);
    checkCanJoin(req.user, team, mine);
    res.json({
      team: { id: team.id, name: team.name, color: team.color, preset_name: team.preset_name },
      roles: await teamRoles(team),
      membership: mine,
    });
  })
);

// Bergabung ke tim dan mengambil peran
router.post(
  '/',
  joinIpLimiter,
  joinLimiter,
  ah(async (req, res) => {
    const team = await teamByToken(req.body.token);
    const mine = await myTeam(req.user.id);
    checkCanJoin(req.user, team, mine);
    const roleId = optId(req.body.player_role_id);
    const hasRoles = team.preset_id && (await one('SELECT 1 FROM player_roles WHERE preset_id=$1 LIMIT 1', [team.preset_id]));
    if (hasRoles && !roleId) bad('Pilih peran yang akan Anda ambil');
    const role = roleId ? await one('SELECT id, name FROM player_roles WHERE id=$1 AND preset_id=$2', [roleId, team.preset_id]) : null;
    if (roleId && !role) bad('Peran tidak valid');
    await query(
      `INSERT INTO org_team_members(org_team_id, user_id, player_role_id) VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET player_role_id=EXCLUDED.player_role_id`,
      [team.id, req.user.id, role ? role.id : null]
    );
    await audit(req, mine ? 'change_role' : 'join_team', 'org_team', team.id, { role: role && role.name });
    res.status(mine ? 200 : 201).json({ team: { id: team.id, name: team.name }, role: role ? { id: role.id, name: role.name } : null });
  })
);

module.exports = router;
