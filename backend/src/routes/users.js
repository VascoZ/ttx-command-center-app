const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { one, many, query } = require('../db');
const { requireRole, audit, GLOBAL_ROLES } = require('../auth');
const { ah, id, str, oneOf, bool, bad } = require('../util');

const PUBLIC_COLS = 'id, email, name, role, organization, is_active, last_login_at, created_at';

// Daftar pengguna: admin melihat semua; designer/fasilitator perlu untuk menugaskan peserta.
router.get(
  '/',
  requireRole('designer', 'facilitator'),
  ah(async (req, res) => {
    const q = req.query.q ? `%${String(req.query.q).toLowerCase()}%` : null;
    const rows = await many(
      `SELECT ${PUBLIC_COLS} FROM users
        WHERE ($1::text IS NULL OR lower(name) LIKE $1 OR lower(email) LIKE $1)
        ORDER BY is_active DESC, name`,
      [q]
    );
    res.json(rows);
  })
);

async function createUser(body) {
  const email = str(body.email, { required: true, name: 'Email', max: 200 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) bad(`Email tidak valid: ${email}`);
  const name = str(body.name, { required: true, name: 'Nama', max: 120 });
  const role = oneOf(body.role, GLOBAL_ROLES, 'player');
  const password = String(body.password || '');
  if (password.length < 8) bad('Password minimal 8 karakter');
  const exists = await one('SELECT id FROM users WHERE email=$1', [email]);
  if (exists) bad(`Email sudah terdaftar: ${email}`);
  return one(
    `INSERT INTO users(email, name, password_hash, role, organization) VALUES ($1,$2,$3,$4,$5) RETURNING ${PUBLIC_COLS}`,
    [email, name, await bcrypt.hash(password, 10), role, str(body.organization, { max: 200 })]
  );
}

router.post(
  '/',
  requireRole(),
  ah(async (req, res) => {
    const u = await createUser(req.body);
    await audit(req, 'create', 'user', u.id, { email: u.email, role: u.role });
    res.status(201).json(u);
  })
);

// Impor massal: [{email,name,role,password,organization}]
router.post(
  '/bulk',
  requireRole(),
  ah(async (req, res) => {
    const list = Array.isArray(req.body.users) ? req.body.users.slice(0, 500) : [];
    const created = [];
    const errors = [];
    for (const [i, u] of list.entries()) {
      try {
        created.push(await createUser(u));
      } catch (e) {
        errors.push({ row: i + 1, email: u.email, error: e.message });
      }
    }
    await audit(req, 'bulk_create', 'user', null, { created: created.length, errors: errors.length });
    res.json({ created, errors });
  })
);

router.put(
  '/:id',
  requireRole(),
  ah(async (req, res) => {
    const uid = id(req.params.id);
    const cur = await one('SELECT * FROM users WHERE id=$1', [uid]);
    if (!cur) bad('Pengguna tidak ditemukan');
    const role = req.body.role !== undefined ? oneOf(req.body.role, GLOBAL_ROLES, cur.role) : cur.role;
    const isActive = req.body.is_active !== undefined ? bool(req.body.is_active) : cur.is_active;
    if (uid === req.user.id && (role !== 'admin' || !isActive)) bad('Anda tidak dapat menurunkan peran atau menonaktifkan akun sendiri');
    const name = req.body.name !== undefined ? str(req.body.name, { required: true, name: 'Nama', max: 120 }) : cur.name;
    const email = req.body.email !== undefined ? str(req.body.email, { required: true, name: 'Email' }).toLowerCase() : cur.email;
    if (email !== cur.email && (await one('SELECT id FROM users WHERE email=$1', [email]))) bad('Email sudah dipakai');
    const organization = req.body.organization !== undefined ? str(req.body.organization, { max: 200 }) : cur.organization;
    let hash = cur.password_hash;
    if (req.body.password) {
      if (String(req.body.password).length < 8) bad('Password minimal 8 karakter');
      hash = await bcrypt.hash(String(req.body.password), 10);
    }
    const u = await one(
      `UPDATE users SET name=$1, email=$2, role=$3, is_active=$4, organization=$5, password_hash=$6 WHERE id=$7 RETURNING ${PUBLIC_COLS}`,
      [name, email, role, isActive, organization, hash, uid]
    );
    await audit(req, 'update', 'user', uid, { role, is_active: isActive, password_reset: !!req.body.password });
    res.json(u);
  })
);

router.delete(
  '/:id',
  requireRole(),
  ah(async (req, res) => {
    const uid = id(req.params.id);
    if (uid === req.user.id) bad('Anda tidak dapat menghapus akun sendiri');
    await query('DELETE FROM users WHERE id=$1', [uid]);
    await audit(req, 'delete', 'user', uid);
    res.json({ ok: true });
  })
);

module.exports = router;
