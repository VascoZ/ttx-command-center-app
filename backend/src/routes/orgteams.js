const router = require('express').Router();
const { one, many, query, tx } = require('../db');
const { requireRole, audit } = require('../auth');
const { ah, id, optId, str, bool, notFound, bad } = require('../util');
const { createOrgTeam, newTeamToken } = require('../services');
const { emit } = require('../realtime');

// Tim instansi & token hanya dikelola (dan terlihat) oleh admin.
router.use(requireRole());

const validColor = (v) => /^#[0-9a-fA-F]{6}$/.test(v || '');

async function loadTeam(req) {
  const t = await one('SELECT * FROM org_teams WHERE id=$1', [id(req.params.id)]);
  if (!t) notFound('Tim tidak ditemukan');
  return t;
}

router.get(
  '/',
  ah(async (req, res) => {
    const [teams, members] = await Promise.all([
      many(
        `SELECT t.*, p.name AS preset_name FROM org_teams t LEFT JOIN role_presets p ON p.id=t.preset_id ORDER BY t.name`
      ),
      many(
        `SELECT m.org_team_id, m.user_id, m.player_role_id, m.is_coordinator, m.joined_at, u.name, u.email, u.organization, r.name AS role_name, r.color AS role_color
           FROM org_team_members m JOIN users u ON u.id=m.user_id LEFT JOIN player_roles r ON r.id=m.player_role_id
          ORDER BY r.sort NULLS LAST, u.name`
      ),
    ]);
    res.json(teams.map((t) => ({ ...t, members: members.filter((m) => m.org_team_id === t.id) })));
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const name = str(req.body.name, { required: true, name: 'Nama tim', max: 120 });
    const presetId = optId(req.body.preset_id);
    if (presetId && !(await one('SELECT 1 FROM role_presets WHERE id=$1', [presetId]))) bad('Preset peran tidak valid');
    const t = await tx((c) => createOrgTeam(c, { name, preset_id: presetId, color: validColor(req.body.color) ? req.body.color : null }, req.user.id));
    await audit(req, 'create', 'org_team', t.id, { name });
    res.status(201).json(t);
  })
);

router.put(
  '/:id',
  ah(async (req, res) => {
    const t0 = await loadTeam(req);
    const b = req.body;
    const presetId = b.preset_id !== undefined ? optId(b.preset_id) : t0.preset_id;
    if (presetId && !(await one('SELECT 1 FROM role_presets WHERE id=$1', [presetId]))) bad('Preset peran tidak valid');
    const t = await tx(async (c) => {
      const out = (
        await c.query('UPDATE org_teams SET name=$1, color=$2, preset_id=$3, join_enabled=$4 WHERE id=$5 RETURNING *', [
          b.name !== undefined ? str(b.name, { required: true, name: 'Nama tim', max: 120 }) : t0.name,
          validColor(b.color) ? b.color : t0.color,
          presetId,
          b.join_enabled !== undefined ? bool(b.join_enabled) : t0.join_enabled,
          t0.id,
        ])
      ).rows[0];
      // ganti preset: lepaskan peran anggota yang tidak ada di preset baru
      if (presetId !== t0.preset_id) {
        await c.query(
          `UPDATE org_team_members SET player_role_id=NULL WHERE org_team_id=$1
             AND player_role_id NOT IN (SELECT id FROM player_roles WHERE preset_id=$2)`,
          [t0.id, presetId || 0]
        );
      }
      // nama/warna ikut diperbarui di tim latihan yang belum selesai
      await c.query(
        `UPDATE teams t SET name=$1, color=$2 FROM exercises e WHERE t.exercise_id=e.id AND t.org_team_id=$3 AND e.status<>'ended'`,
        [out.name, out.color, t0.id]
      );
      return out;
    });
    res.json(t);
  })
);

router.post(
  '/:id/token',
  ah(async (req, res) => {
    const t0 = await loadTeam(req);
    const t = await tx(async (c) => (await c.query('UPDATE org_teams SET join_token=$1 WHERE id=$2 RETURNING *', [await newTeamToken(c), t0.id])).rows[0]);
    await audit(req, 'regenerate_token', 'org_team', t0.id);
    res.json(t);
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const t0 = await loadTeam(req);
    await query('DELETE FROM org_teams WHERE id=$1', [t0.id]);
    await audit(req, 'delete', 'org_team', t0.id, { name: t0.name });
    res.json({ ok: true });
  })
);

// Ubah peran / status koordinator anggota di tim instansi
router.put(
  '/:id/members/:userId',
  ah(async (req, res) => {
    const t0 = await loadTeam(req);
    const m0 = await one('SELECT * FROM org_team_members WHERE org_team_id=$1 AND user_id=$2', [t0.id, id(req.params.userId)]);
    if (!m0) notFound('Anggota tidak ditemukan');
    let roleId = m0.player_role_id;
    if (req.body.player_role_id !== undefined) {
      roleId = optId(req.body.player_role_id);
      if (roleId && !(await one('SELECT 1 FROM player_roles WHERE id=$1 AND preset_id=$2', [roleId, t0.preset_id]))) bad('Peran tidak valid untuk tim ini');
    }
    const coordinator = req.body.is_coordinator !== undefined ? bool(req.body.is_coordinator) : m0.is_coordinator;
    const m = await one('UPDATE org_team_members SET player_role_id=$1, is_coordinator=$2 WHERE id=$3 RETURNING *', [roleId, coordinator, m0.id]);
    emit.user(m.user_id, 'orgteam:changed', {});
    res.json(m);
  })
);

router.delete(
  '/:id/members/:userId',
  ah(async (req, res) => {
    const t0 = await loadTeam(req);
    const uid = id(req.params.userId);
    await query('DELETE FROM org_team_members WHERE org_team_id=$1 AND user_id=$2', [t0.id, uid]);
    await audit(req, 'remove_member', 'org_team', t0.id, { user_id: uid });
    emit.user(uid, 'orgteam:changed', {});
    res.json({ ok: true });
  })
);

module.exports = router;
