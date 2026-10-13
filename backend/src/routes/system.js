const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { one, many } = require('../db');
const { requireAuth, requireRole, canDesign, audit, userForMedia } = require('../auth');
const { ah, str, oneOf, bad } = require('../util');
const { getSetting, setSetting, registrationEnabled } = require('../settings');
const { simSeconds } = require('../simclock');
const { aiConfig } = require('../generator');

const router = express.Router();

// ---------- Dashboard ----------
router.get(
  '/dashboard',
  requireAuth,
  ah(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const exercises = await many(
      `SELECT e.id, e.title, e.status, e.speed, e.sim_elapsed_sec, e.resumed_at, e.started_at, e.ended_at, e.created_at, e.scheduled_for,
              m.role AS my_role,
              (SELECT COUNT(*) FROM exercise_members x WHERE x.exercise_id=e.id AND x.role='player')::int AS players,
              (SELECT AVG(score)::numeric(4,2) FROM scores s WHERE s.exercise_id=e.id) AS avg_score,
              (SELECT COUNT(*) FROM exercise_injects i WHERE i.exercise_id=e.id AND i.status='sent' AND i.requires_response)::int AS req_sent,
              (SELECT COUNT(DISTINCT r.inject_id) FROM responses r JOIN exercise_injects i ON i.id=r.inject_id
                WHERE r.exercise_id=e.id AND i.requires_response)::int AS answered
         FROM exercises e
         LEFT JOIN exercise_members m ON m.exercise_id=e.id AND m.user_id=$1
        WHERE $2::boolean OR m.id IS NOT NULL OR e.created_by=$1
        ORDER BY e.created_at DESC`,
      [req.user.id, isAdmin]
    );
    const counts = { draft: 0, running: 0, paused: 0, ended: 0 };
    exercises.forEach((e) => (counts[e.status] += 1));
    const totals = await one(
      `SELECT (SELECT COUNT(*) FROM scenarios)::int AS scenarios, (SELECT COUNT(*) FROM users WHERE is_active)::int AS users,
              (SELECT COUNT(*) FROM role_presets)::int AS presets`
    );
    const trend = exercises
      .filter((e) => e.status === 'ended')
      .slice(0, 12)
      .reverse()
      .map((e) => ({
        id: e.id,
        title: e.title,
        ended_at: e.ended_at,
        avg_score: e.avg_score,
        response_rate: e.req_sent ? Math.round((e.answered / e.req_sent) * 100) : null,
      }));
    res.json({
      counts,
      totals,
      active: exercises.filter((e) => ['running', 'paused'].includes(e.status)).map((e) => ({ ...e, sim_now_sec: simSeconds(e) })),
      upcoming: exercises.filter((e) => e.status === 'draft').slice(0, 8),
      recent: exercises.filter((e) => e.status === 'ended').slice(0, 8),
      trend,
    });
  })
);

// ---------- Audit log ----------
router.get(
  '/audit',
  requireAuth,
  requireRole(),
  ah(async (req, res) => {
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 200);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const q = req.query.q ? `%${String(req.query.q).toLowerCase()}%` : null;
    res.json(
      await many(
        `SELECT a.*, u.name AS user_name, u.email AS user_email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
          WHERE ($1::text IS NULL OR lower(a.action) LIKE $1 OR lower(COALESCE(a.entity,'')) LIKE $1 OR lower(COALESCE(u.name,'')) LIKE $1)
          ORDER BY a.id DESC LIMIT $2 OFFSET $3`,
        [q, limit, offset]
      )
    );
  })
);

// ---------- Pengaturan AI ----------
function mask(k) {
  return k ? `${k.slice(0, 7)}…${k.slice(-4)}` : '';
}
router.get(
  '/settings',
  requireAuth,
  requireRole(),
  ah(async (req, res) => {
    const cfg = await aiConfig();
    const s = (await getSetting('ai')) || {};
    res.json({
      ai: {
        provider: cfg.provider,
        anthropic_model: cfg.anthropic_model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        anthropic_key_set: !!(s.anthropic_api_key || process.env.ANTHROPIC_API_KEY),
        anthropic_key_hint: mask(s.anthropic_api_key || process.env.ANTHROPIC_API_KEY || ''),
        ollama_url: cfg.ollama_url || process.env.OLLAMA_URL || 'http://ollama:11434',
        ollama_model: cfg.ollama_model || process.env.OLLAMA_MODEL || 'llama3.1',
      },
      app: (await getSetting('app')) || { org_name: process.env.ORG_NAME || '' },
      registration: { enabled: await registrationEnabled() },
    });
  })
);
router.put(
  '/settings',
  requireAuth,
  requireRole(),
  ah(async (req, res) => {
    const cur = (await getSetting('ai')) || {};
    const b = (req.body && req.body.ai) || {};
    const next = {
      provider: oneOf(b.provider, ['builtin', 'anthropic', 'ollama'], cur.provider || 'builtin'),
      anthropic_model: str(b.anthropic_model, { max: 100 }) || cur.anthropic_model || '',
      anthropic_api_key: b.anthropic_api_key === '' ? '' : str(b.anthropic_api_key, { max: 300 }) || cur.anthropic_api_key || '',
      ollama_url: str(b.ollama_url, { max: 300 }) || cur.ollama_url || '',
      ollama_model: str(b.ollama_model, { max: 100 }) || cur.ollama_model || '',
    };
    if (b.clear_key) next.anthropic_api_key = '';
    await setSetting('ai', next);
    if (req.body.app) await setSetting('app', { org_name: str(req.body.app.org_name, { max: 200 }) || '' });
    if (req.body.registration) await setSetting('registration', { enabled: req.body.registration.enabled === true });
    await audit(req, 'update_settings', 'settings', null, { provider: next.provider });
    res.json({ ok: true });
  })
);

// ---------- Pemeriksaan keamanan (admin) ----------
const DEMO_EMAILS = ['fasilitator@ttx.local', 'evaluator@ttx.local', 'sekda@ttx.local', 'kominfo@ttx.local', 'csirt@ttx.local', 'humas@ttx.local', 'hukum@ttx.local', 'dukcapil@ttx.local'];

function latestBackup(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.dump'));
    let best = null;
    for (const f of files) {
      const m = fs.statSync(path.join(dir, f)).mtime;
      if (!best || m > best.at) best = { file: f, at: m };
    }
    return best;
  } catch {
    return undefined; // folder backup tidak terpasang
  }
}

router.get(
  '/security-check',
  requireAuth,
  requireRole(),
  ah(async (req, res) => {
    const checks = [];
    const add = (key, ok, title, detail) => checks.push({ key, ok, title, detail });

    const admins = await many(`SELECT email, password_hash FROM users WHERE role='admin' AND is_active`);
    const weakAdmins = [];
    for (const a of admins) if (await bcrypt.compare('admin12345', a.password_hash)) weakAdmins.push(a.email);
    add('admin_password', !weakAdmins.length, 'Password admin bukan password bawaan',
      weakAdmins.length ? `Ganti password bawaan untuk: ${weakAdmins.join(', ')} (menu Profil).` : 'Tidak ada admin yang memakai password bawaan.');

    const demo = await many(`SELECT email, password_hash FROM users WHERE is_active AND email = ANY($1)`, [DEMO_EMAILS]);
    const demoPw = process.env.DEMO_PASSWORD || 'demo12345';
    const weakDemo = [];
    for (const d of demo) if (await bcrypt.compare(demoPw, d.password_hash)) weakDemo.push(d.email);
    add('demo_accounts', !weakDemo.length, 'Akun demo tidak aktif',
      weakDemo.length
        ? `${weakDemo.length} akun demo aktif dengan password demo. Nonaktifkan di menu Pengguna, dan set SEED_DEMO=false sebelum database produksi dibuat.`
        : 'Tidak ada akun demo aktif dengan password demo.');

    add('https', req.secure, 'Akses lewat HTTPS',
      req.secure ? 'Koneksi terenkripsi.' : 'Aplikasi diakses lewat HTTP biasa. Jalankan profil https (Caddy) — lihat README bagian HTTPS.');

    const dbDefault = /ttx-ganti-password/.test(process.env.DATABASE_URL || '');
    add('db_password', !dbDefault, 'Password database bukan bawaan', dbDefault ? 'Ganti DB_PASSWORD di .env (berlaku untuk database baru).' : 'Password database sudah diganti.');

    const b = latestBackup(process.env.BACKUP_DIR || '/backups');
    const fresh = b && Date.now() - b.at.getTime() < 36 * 3600 * 1000;
    add('backup', !!fresh, 'Backup otomatis berjalan',
      b === undefined ? 'Folder backup tidak terpasang ke API; pastikan layanan backup berjalan.'
        : !b ? 'Belum ada file backup. Pastikan layanan backup berjalan (docker compose ps).'
          : `Backup terakhir ${b.file} (${b.at.toISOString()}).${fresh ? '' : ' Lebih dari 36 jam yang lalu!'}`);

    const reg = await registrationEnabled();
    add('registration', true, 'Pendaftaran mandiri', reg ? 'Aktif — siapa pun di jaringan bisa membuat akun peserta (tanpa token tim mereka tidak bisa melihat latihan).' : 'Nonaktif.');

    res.json({ checks, ok: checks.every((c) => c.ok) });
  })
);

// ---------- Unggah lampiran ----------
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + ALLOWED[file.mimetype]),
  }),
  limits: { fileSize: parseInt(process.env.UPLOAD_MAX_MB || '20', 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!ALLOWED[file.mimetype]),
});

router.post(
  '/uploads',
  requireAuth,
  canDesign,
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) bad('Jenis file tidak didukung atau file kosong');
    await audit(req, 'upload', 'file', null, { name: req.file.originalname, size: req.file.size });
    res.status(201).json({
      name: req.file.originalname,
      url: `/api/uploads/${req.file.filename}`,
      mime: req.file.mimetype,
      size: req.file.size,
    });
  })
);

router.get('/uploads/:file', async (req, res) => {
  // lampiran hanya untuk pengguna yang login (header Bearer atau cookie media HttpOnly)
  const user = await userForMedia(req).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Silakan login untuk membuka lampiran' });
  const f = String(req.params.file);
  if (!/^[a-f0-9]{32}\.[a-z0-9]{2,5}$/.test(f)) return res.status(404).end();
  const ext = path.extname(f);
  const mime = Object.keys(ALLOWED).find((k) => ALLOWED[k] === ext) || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(UPLOAD_DIR, f), (err) => err && !res.headersSent && res.status(404).end());
});

module.exports = router;
