// Layar penonton: ringkasan latihan yang aman ditampilkan di proyektor/TV.
// Isi inject, isi keputusan, perihal eskalasi, catatan evaluator, dan nama peserta TIDAK pernah dikirim.
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { one, many } = require('../db');
const { exerciseContext, audit } = require('../auth');
const { ah, id, forbid, notFound } = require('../util');
const { simSeconds, publicState } = require('../simclock');
const { presenceList } = require('../realtime');

const router = express.Router(); // /api/exercises (terautentikasi)
const publicRouter = express.Router(); // /api/display (tanpa login, pakai kunci)

const fmtDur = (sec) => {
  const m = Math.round(Number(sec || 0) / 60);
  return m < 60 ? `${m} menit` : `${Math.floor(m / 60)} jam ${m % 60} menit`;
};
const who = (p) => [p.team, p.role].filter(Boolean).join(' · ') || 'Peserta';

/** Teks aktivitas yang aman untuk publik (daftar putih). null = tidak ditampilkan. */
function activityText(e) {
  const p = e.payload || {};
  switch (e.type) {
    case 'exercise_start':
      return ['status', 'Latihan dimulai'];
    case 'exercise_pause':
      return ['status', 'Latihan dijeda'];
    case 'exercise_resume':
      return ['status', 'Latihan dilanjutkan'];
    case 'exercise_end':
      return ['status', 'Latihan berakhir'];
    case 'clock_jump':
      return ['status', 'Jam simulasi dimajukan'];
    case 'inject_sent':
      return ['inject', `Inject baru: ${p.title}`];
    case 'response_submitted':
      return ['response', `${who(p)} menjawab inject "${p.title}"`];
    case 'decision_created':
      return ['decision', `${who(p)} ${p.status === 'pending' ? 'mengajukan keputusan' : 'mengambil keputusan'}`];
    case 'decision_approved':
      return ['decision', `Keputusan disetujui${p.wait_sec ? ` (menunggu ${fmtDur(p.wait_sec)})` : ''}`];
    case 'decision_rejected':
      return ['decision', 'Keputusan ditolak'];
    case 'statement_published':
      return ['statement', `${who(p)} menerbitkan pernyataan publik "${p.title}"`];
    case 'escalation_sent':
      return ['escalation', `${p.team || 'Peserta'} mengeskalasi ke ${p.to_role || 'pimpinan'}`];
    case 'escalation_acknowledged':
      return ['escalation', `Eskalasi diterima${p.wait_sec ? ` (respons ${fmtDur(p.wait_sec)})` : ''}`];
    case 'broadcast':
      return ['broadcast', `Pengumuman: ${p.body}`];
    case 'participant_ready':
      return ['ready', `${who(p)} siap`];
    default:
      return null;
  }
}

async function buildDisplay(exId) {
  const ex = await one(
    `SELECT e.id, e.title, e.description, e.status, e.speed, e.sim_elapsed_sec, e.resumed_at, e.started_at, e.ended_at,
            e.duration_min, e.scheduled_for, s.category, s.threat_type
       FROM exercises e LEFT JOIN scenarios s ON s.id=e.scenario_id WHERE e.id=$1`,
    [exId]
  );
  if (!ex) notFound('Latihan tidak ditemukan');
  const sim = simSeconds(ex);

  const [teams, roles, members, injects, responses, decisions, escalations, statements, broadcasts, events] = await Promise.all([
    many('SELECT id, name, color FROM teams WHERE exercise_id=$1 ORDER BY id', [exId]),
    many('SELECT id, name, color, required FROM exercise_roles WHERE exercise_id=$1 ORDER BY sort, id', [exId]),
    many(`SELECT user_id, team_id, exercise_role_id, ready_at FROM exercise_members WHERE exercise_id=$1 AND role='player'`, [exId]),
    many(
      `SELECT id, team_id, exercise_role_id, offset_min, title, type, priority, status, sim_sent_sec, requires_response
         FROM exercise_injects WHERE exercise_id=$1 ORDER BY offset_min, sort, id`,
      [exId]
    ),
    many('SELECT inject_id, team_id FROM responses WHERE exercise_id=$1', [exId]),
    many('SELECT team_id, status FROM decisions WHERE exercise_id=$1', [exId]),
    many('SELECT team_id, acknowledged_at FROM escalations WHERE exercise_id=$1', [exId]),
    many(
      `SELECT s.title, s.body, s.channel, s.sim_time_sec, r.name AS role_name, t.name AS team_name
         FROM statements s LEFT JOIN exercise_roles r ON r.id=s.exercise_role_id LEFT JOIN teams t ON t.id=s.team_id
        WHERE s.exercise_id=$1 ORDER BY s.id DESC LIMIT 6`,
      [exId]
    ),
    many(`SELECT body, sim_time_sec FROM messages WHERE exercise_id=$1 AND kind='broadcast' ORDER BY id DESC LIMIT 3`, [exId]),
    many('SELECT type, payload, sim_time_sec FROM events WHERE exercise_id=$1 ORDER BY id DESC LIMIT 60', [exId]),
  ]);

  const online = new Set(presenceList(exId).map((o) => o.user_id));
  const roleName = (rid) => (roles.find((r) => r.id === rid) || {}).name;
  const teamName = (tid) => (teams.find((t) => t.id === tid) || {}).name;
  const sent = injects.filter((i) => i.status === 'sent');

  const teamStats = teams.map((t) => {
    const mem = members.filter((m) => m.team_id === t.id);
    const roleIds = new Set(mem.map((m) => m.exercise_role_id).filter(Boolean));
    // inject yang wajib dijawab tim ini: untuk semua tim / tim ini, dan (bila berbasis peran) tim punya peran tsb.
    const required = sent.filter(
      (i) => i.requires_response && (!i.team_id || i.team_id === t.id) && (!i.exercise_role_id || roleIds.has(i.exercise_role_id))
    );
    const answered = required.filter((i) => responses.some((r) => r.inject_id === i.id && r.team_id === t.id)).length;
    const dec = decisions.filter((d) => d.team_id === t.id);
    const esc = escalations.filter((e) => e.team_id === t.id);
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      members: mem.length,
      online: mem.filter((m) => online.has(m.user_id)).length,
      ready: mem.filter((m) => m.ready_at).length,
      roles_filled: roles.filter((r) => mem.some((m) => m.exercise_role_id === r.id)).length,
      roles_total: roles.length,
      required_missing: mem.length ? roles.filter((r) => r.required && !roleIds.has(r.id)).map((r) => r.name) : [],
      injects_required: required.length,
      injects_answered: answered,
      decisions: dec.length,
      decisions_approved: dec.filter((d) => d.status === 'approved').length,
      decisions_pending: dec.filter((d) => d.status === 'pending').length,
      escalations: esc.length,
      escalations_open: esc.filter((e) => !e.acknowledged_at).length,
      statements: statements.filter((s) => s.team_name === t.name).length,
    };
  });

  const next = injects.find((i) => i.status === 'scheduled');
  return {
    exercise: {
      ...publicState(ex),
      title: ex.title,
      description: ex.description,
      duration_min: ex.duration_min,
      scheduled_for: ex.scheduled_for,
      category: ex.category,
    },
    teams: teamStats,
    injects: {
      total: injects.filter((i) => i.status !== 'skipped').length,
      sent: sent.length,
      // isi inject tidak dikirim — hanya waktu, jenis, judul, prioritas, dan tujuan
      timeline: sent
        .sort((a, b) => Number(b.sim_sent_sec) - Number(a.sim_sent_sec) || b.offset_min - a.offset_min || b.id - a.id)
        .slice(0, 12)
        .map((i) => ({
          sim_sent_sec: Number(i.sim_sent_sec),
          title: i.title,
          type: i.type,
          priority: i.priority,
          target: [teamName(i.team_id), roleName(i.exercise_role_id)].filter(Boolean).join(' · ') || 'Semua peserta',
        })),
      next_in_sim_sec: next ? Math.max(0, next.offset_min * 60 - sim) : null,
    },
    statements: statements.map((s) => ({
      title: s.title,
      body: s.body.length > 320 ? `${s.body.slice(0, 317)}…` : s.body,
      channel: s.channel,
      sim_time_sec: Number(s.sim_time_sec),
      by: [s.team_name, s.role_name].filter(Boolean).join(' · '),
    })),
    broadcasts: broadcasts.map((b) => ({ body: b.body, sim_time_sec: Number(b.sim_time_sec) })),
    activity: events
      .map((e) => {
        const a = activityText(e);
        return a ? { kind: a[0], text: a[1], sim_time_sec: Number(e.sim_time_sec) } : null;
      })
      .filter(Boolean)
      .slice(0, 14),
    totals: {
      players: members.length,
      online: members.filter((m) => online.has(m.user_id)).length,
      ready: members.filter((m) => m.ready_at).length,
      responses: responses.length,
      decisions: decisions.length,
      statements: statements.length,
      escalations: escalations.length,
    },
  };
}

// ---------- Staf yang login ----------
router.get(
  '/:id/display',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!ctx.isStaff) forbid('Layar penonton hanya untuk staf latihan');
    res.json({ ...(await buildDisplay(exId)), display_key: ctx.isFacilitator ? ctx.ex.display_key : undefined });
  })
);

// Fasilitator membuat / mencabut tautan layar tanpa login
router.post(
  '/:id/display-key',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!ctx.isFacilitator) forbid('Hanya fasilitator yang dapat membuat tautan layar');
    const key = crypto.randomBytes(18).toString('base64url');
    await one('UPDATE exercises SET display_key=$1 WHERE id=$2 RETURNING id', [key, exId]);
    await audit(req, 'create_display_link', 'exercise', exId);
    res.json({ display_key: key });
  })
);
router.delete(
  '/:id/display-key',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!ctx.isFacilitator) forbid('Hanya fasilitator yang dapat mencabut tautan layar');
    await one('UPDATE exercises SET display_key=NULL WHERE id=$1 RETURNING id', [exId]);
    await audit(req, 'revoke_display_link', 'exercise', exId);
    res.json({ ok: true });
  })
);

// ---------- Publik (tanpa login) ----------
publicRouter.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: parseInt(process.env.DISPLAY_RATE_LIMIT || '120', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Terlalu banyak permintaan layar' },
  })
);
publicRouter.get(
  '/:key',
  ah(async (req, res) => {
    const key = String(req.params.key || '');
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(key)) notFound('Tautan layar tidak valid');
    const ex = await one('SELECT id FROM exercises WHERE display_key=$1', [key]);
    if (!ex) notFound('Tautan layar tidak valid atau sudah dicabut');
    res.set('Cache-Control', 'no-store');
    res.json(await buildDisplay(ex.id));
  })
);

module.exports = { displayRouter: router, displayPublic: publicRouter };
