const jwt = require('jsonwebtoken');
const { one, query } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || '';
// Tolak start dengan secret lemah: token login bisa dipalsukan bila secret ditebak.
if (JWT_SECRET.length < 32 || /^ganti/i.test(JWT_SECRET)) {
  console.error('[auth] JWT_SECRET wajib diisi string acak minimal 32 karakter (mis. hasil: openssl rand -hex 32).');
  process.exit(1);
}
const MEDIA_COOKIE = 'ttx_media';

const GLOBAL_ROLES = ['admin', 'designer', 'facilitator', 'player', 'evaluator', 'viewer'];

function sign(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
}

/**
 * Cookie HttpOnly khusus untuk membuka lampiran (<img>/<audio>/<video> tidak bisa mengirim header Authorization).
 * Hanya dikirim browser ke /api/uploads dan tidak berlaku sebagai token API.
 */
function setMediaCookie(req, res, user) {
  const token = jwt.sign({ sub: user.id, scope: 'media' }, JWT_SECRET, { expiresIn: '12h' });
  res.cookie(MEDIA_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    path: '/api/uploads',
    maxAge: 12 * 3600 * 1000,
  });
}
function clearMediaCookie(res) {
  res.clearCookie(MEDIA_COOKIE, { path: '/api/uploads' });
}
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
/** Pengguna dari header Bearer atau cookie media (khusus lampiran). */
async function userForMedia(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return userFromToken(h.slice(7));
  const c = readCookie(req, MEDIA_COOKIE);
  if (!c) return null;
  try {
    const p = jwt.verify(c, JWT_SECRET);
    if (p.scope !== 'media') return null;
    const user = await one('SELECT id, is_active FROM users WHERE id=$1', [p.sub]);
    return user && user.is_active ? user : null;
  } catch {
    return null;
  }
}

async function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.scope) return null; // token media tidak berlaku untuk API
    const user = await one(
      'SELECT id, email, name, role, organization, is_active FROM users WHERE id=$1',
      [payload.sub]
    );
    if (!user || !user.is_active) return null;
    return user;
  } catch {
    return null;
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  // Token hanya lewat header (bukan query string) agar tidak tercatat di log server/proxy.
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  userFromToken(token)
    .then((user) => {
      if (!user) return res.status(401).json({ error: 'Sesi tidak valid, silakan login ulang' });
      req.user = user;
      next();
    })
    .catch(next);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Belum login' });
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Anda tidak memiliki akses untuk tindakan ini' });
  };
}

const canDesign = requireRole('designer', 'facilitator');

/**
 * Konteks pengguna terhadap sebuah latihan.
 * staff = admin / fasilitator latihan; observer = evaluator / viewer.
 */
async function exerciseContext(exerciseId, user) {
  const ex = await one('SELECT * FROM exercises WHERE id=$1', [exerciseId]);
  if (!ex) throw new HttpError(404, 'Latihan tidak ditemukan');
  const m = await one(
    `SELECT m.*, r.name AS role_name, r.can_approve, r.can_statement, r.can_escalate, r.color AS role_color,
            t.name AS team_name
       FROM exercise_members m
       LEFT JOIN exercise_roles r ON r.id = m.exercise_role_id
       LEFT JOIN teams t ON t.id = m.team_id
      WHERE m.exercise_id=$1 AND m.user_id=$2`,
    [exerciseId, user.id]
  );
  const isAdmin = user.role === 'admin';
  const isOwner = ex.created_by === user.id;
  const memberRole = m ? m.role : null;
  const isFacilitator = isAdmin || memberRole === 'facilitator' || (isOwner && user.role !== 'player');
  const isEvaluator = memberRole === 'evaluator';
  const isViewer = memberRole === 'viewer';
  const isPlayer = memberRole === 'player';
  if (!isFacilitator && !m && !isViewer) throw new HttpError(403, 'Anda bukan peserta latihan ini');
  return {
    ex,
    member: m,
    isAdmin,
    isFacilitator,
    isEvaluator,
    isViewer,
    isPlayer,
    isStaff: isFacilitator || isEvaluator || isViewer,
    teamId: m ? m.team_id : null,
    roleId: m ? m.exercise_role_id : null,
    canApprove: isFacilitator || !!(m && m.can_approve),
    canStatement: isFacilitator || !!(m && m.can_statement),
    canEscalate: isFacilitator || !!(m && m.can_escalate),
  };
}

async function audit(req, action, entity, entityId, detail = {}) {
  try {
    await query(
      'INSERT INTO audit_logs(user_id, action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user ? req.user.id : null, action, entity, entityId || null, JSON.stringify(detail), req.ip]
    );
  } catch (e) {
    console.error('[audit]', e.message);
  }
}

module.exports = {
  sign,
  setMediaCookie,
  clearMediaCookie,
  userForMedia,
  userFromToken,
  requireAuth,
  requireRole,
  canDesign,
  exerciseContext,
  audit,
  HttpError,
  GLOBAL_ROLES,
};
