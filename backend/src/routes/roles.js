const router = require('express').Router();
const { one, many, query, tx } = require('../db');
const { requireRole, audit } = require('../auth');
const { ah, id, str, bool, notFound, bad } = require('../util');

const canManage = requireRole('designer', 'facilitator');

function roleFields(b) {
  return {
    code: str(b.code, { max: 40 }) || null,
    name: str(b.name, { required: true, name: 'Nama peran', max: 120 }),
    subtitle: str(b.subtitle, { max: 160 }),
    description: str(b.description, { max: 2000 }),
    color: /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '#4C9AFF',
    can_approve: bool(b.can_approve),
    can_statement: bool(b.can_statement),
    can_escalate: bool(b.can_escalate),
    sort: parseInt(b.sort, 10) || 0,
  };
}

router.get(
  '/',
  ah(async (req, res) => {
    const presets = await many('SELECT * FROM role_presets ORDER BY is_builtin DESC, id');
    const roles = await many('SELECT * FROM player_roles ORDER BY sort, id');
    res.json(presets.map((p) => ({ ...p, roles: roles.filter((r) => r.preset_id === p.id) })));
  })
);

router.post(
  '/',
  canManage,
  ah(async (req, res) => {
    const name = str(req.body.name, { required: true, name: 'Nama preset', max: 120 });
    const out = await tx(async (c) => {
      const p = (
        await c.query('INSERT INTO role_presets(name, sector, description) VALUES ($1,$2,$3) RETURNING *', [
          name,
          str(req.body.sector, { max: 60 }),
          str(req.body.description, { max: 2000 }),
        ])
      ).rows[0];
      // salin peran dari preset lain bila diminta
      if (req.body.copy_from) {
        await c.query(
          `INSERT INTO player_roles(preset_id, code, name, subtitle, description, color, can_approve, can_statement, can_escalate, sort)
           SELECT $1, code, name, subtitle, description, color, can_approve, can_statement, can_escalate, sort
             FROM player_roles WHERE preset_id=$2`,
          [p.id, id(req.body.copy_from)]
        );
      }
      return p;
    });
    await audit(req, 'create', 'role_preset', out.id, { name });
    res.status(201).json(out);
  })
);

router.put(
  '/:id',
  canManage,
  ah(async (req, res) => {
    const pid = id(req.params.id);
    const p = await one(
      'UPDATE role_presets SET name=COALESCE($1,name), sector=$2, description=$3 WHERE id=$4 RETURNING *',
      [str(req.body.name, { max: 120 }), str(req.body.sector, { max: 60 }), str(req.body.description, { max: 2000 }), pid]
    );
    if (!p) notFound('Preset tidak ditemukan');
    await audit(req, 'update', 'role_preset', pid);
    res.json(p);
  })
);

router.delete(
  '/:id',
  canManage,
  ah(async (req, res) => {
    const pid = id(req.params.id);
    const p = await one('SELECT * FROM role_presets WHERE id=$1', [pid]);
    if (!p) notFound('Preset tidak ditemukan');
    if (p.is_builtin && req.user.role !== 'admin') bad('Preset bawaan hanya dapat dihapus admin');
    await query('DELETE FROM role_presets WHERE id=$1', [pid]);
    await audit(req, 'delete', 'role_preset', pid);
    res.json({ ok: true });
  })
);

router.post(
  '/:id/roles',
  canManage,
  ah(async (req, res) => {
    const pid = id(req.params.id);
    if (!(await one('SELECT id FROM role_presets WHERE id=$1', [pid]))) notFound('Preset tidak ditemukan');
    const f = roleFields(req.body);
    if (!req.body.sort) {
      const m = await one('SELECT COALESCE(MAX(sort),-1)+1 AS s FROM player_roles WHERE preset_id=$1', [pid]);
      f.sort = m.s;
    }
    const r = await one(
      `INSERT INTO player_roles(preset_id, code, name, subtitle, description, color, can_approve, can_statement, can_escalate, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [pid, f.code, f.name, f.subtitle, f.description, f.color, f.can_approve, f.can_statement, f.can_escalate, f.sort]
    );
    await audit(req, 'create', 'player_role', r.id, { name: r.name });
    res.status(201).json(r);
  })
);

// Peran master (di bawah /api/player-roles)
const roleRouter = require('express').Router();
roleRouter.put(
  '/:id',
  canManage,
  ah(async (req, res) => {
    const rid = id(req.params.id);
    const f = roleFields(req.body);
    const r = await one(
      `UPDATE player_roles SET code=$1, name=$2, subtitle=$3, description=$4, color=$5, can_approve=$6, can_statement=$7, can_escalate=$8, sort=$9
        WHERE id=$10 RETURNING *`,
      [f.code, f.name, f.subtitle, f.description, f.color, f.can_approve, f.can_statement, f.can_escalate, f.sort, rid]
    );
    if (!r) notFound('Peran tidak ditemukan');
    await audit(req, 'update', 'player_role', rid);
    res.json(r);
  })
);
roleRouter.delete(
  '/:id',
  canManage,
  ah(async (req, res) => {
    const rid = id(req.params.id);
    await query('DELETE FROM player_roles WHERE id=$1', [rid]);
    await audit(req, 'delete', 'player_role', rid);
    res.json({ ok: true });
  })
);

module.exports = { presetRouter: router, roleRouter, roleFields };
