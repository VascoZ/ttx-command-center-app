const express = require('express');
const rateLimit = require('express-rate-limit');
const { one, many } = require('../db');
const { exerciseContext, audit } = require('../auth');
const { ah, id, optId, str, oneOf, forbid, notFound, bad } = require('../util');
const { simSeconds } = require('../simclock');
const { emit, logEvent } = require('../realtime');

const router = express.Router(); // /api/exercises
const misc = express.Router(); // /api

function requireLive(ctx) {
  if (ctx.ex.status === 'draft') bad('Latihan belum dimulai');
  if (ctx.ex.status === 'ended') bad('Latihan sudah berakhir');
}
function requireParticipant(ctx) {
  if (!ctx.isPlayer && !ctx.isFacilitator) forbid('Hanya peserta yang dapat melakukan tindakan ini');
}

// ================= KEPUTUSAN =================
const DECISION_SQL = `
  SELECT d.*, u.name AS user_name, t.name AS team_name, r.name AS role_name, r.color AS role_color,
         a.name AS approver_name, i.title AS inject_title
    FROM decisions d
    LEFT JOIN users u ON u.id=d.user_id
    LEFT JOIN teams t ON t.id=d.team_id
    LEFT JOIN exercise_roles r ON r.id=d.exercise_role_id
    LEFT JOIN users a ON a.id=d.approved_by
    LEFT JOIN exercise_injects i ON i.id=d.inject_id`;

async function decisionById(did) {
  return one(`${DECISION_SQL} WHERE d.id=$1`, [did]);
}

function emitDecision(d, ev) {
  emit.staff(d.exercise_id, ev, d);
  emit.team(d.exercise_id, d.team_id, ev, d);
  emit.approvers(d.exercise_id, d.team_id, ev, d);
  if (d.user_id) emit.user(d.user_id, ev, d);
}

router.get(
  '/:id/decisions',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    let rows;
    // Staf melihat semua; peserta (termasuk approver) hanya melihat keputusan timnya sendiri.
    if (ctx.isStaff || (ctx.canApprove && !ctx.teamId)) rows = await many(`${DECISION_SQL} WHERE d.exercise_id=$1 ORDER BY d.created_at DESC`, [exId]);
    else
      rows = await many(
        `${DECISION_SQL} WHERE d.exercise_id=$1 AND (d.user_id=$2 OR ($3::int IS NOT NULL AND d.team_id=$3)) ORDER BY d.created_at DESC`,
        [exId, req.user.id, ctx.teamId]
      );
    res.json(rows);
  })
);

router.post(
  '/:id/decisions',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    requireParticipant(ctx);
    requireLive(ctx);
    const decision = str(req.body.decision, { required: true, name: 'Keputusan', max: 2000 });
    // Keputusan menunggu persetujuan bila tim (instansi) pengaju punya anggota berwenang menyetujui.
    const approverExists = ctx.teamId
      ? await one(
          `SELECT 1 FROM exercise_members m JOIN exercise_roles r ON r.id=m.exercise_role_id
            WHERE m.exercise_id=$1 AND m.team_id=$2 AND m.role='player' AND r.can_approve LIMIT 1`,
          [exId, ctx.teamId]
        )
      : await one('SELECT 1 FROM exercise_roles WHERE exercise_id=$1 AND can_approve LIMIT 1', [exId]);
    const autoApprove = ctx.canApprove || !approverExists;
    const sim = simSeconds(ctx.ex);
    const injectId = optId(req.body.inject_id);
    const d0 = await one(
      `INSERT INTO decisions(exercise_id, team_id, user_id, exercise_role_id, inject_id, decision, owner, rationale, status, approved_by, approved_at, sim_time_sec, sim_approved_sec)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        exId, ctx.teamId, req.user.id, ctx.roleId, injectId, decision,
        str(req.body.owner, { max: 200 }), str(req.body.rationale, { max: 4000 }),
        autoApprove ? 'approved' : 'pending', autoApprove ? req.user.id : null, autoApprove ? new Date() : null,
        sim, autoApprove ? sim : null,
      ]
    );
    const d = await decisionById(d0.id);
    emitDecision(d, 'decision:new');
    await logEvent(exId, 'decision_created', { decision_id: d.id, decision, status: d.status, by: req.user.name, role: d.role_name, team: d.team_name }, req.user.id, sim);
    res.status(201).json(d);
  })
);

async function review(req, res, approve) {
  const d0 = await one('SELECT * FROM decisions WHERE id=$1', [id(req.params.id)]);
  if (!d0) notFound('Keputusan tidak ditemukan');
  const ctx = await exerciseContext(d0.exercise_id, req.user);
  if (!ctx.canApprove) forbid('Peran Anda tidak memiliki kewenangan menyetujui keputusan');
  if (!ctx.isFacilitator && d0.team_id && d0.team_id !== ctx.teamId) forbid('Keputusan ini berasal dari tim (instansi) lain');
  if (d0.status !== 'pending') bad('Keputusan ini sudah diproses');
  if (ctx.ex.status === 'ended') bad('Latihan sudah berakhir');
  const sim = simSeconds(ctx.ex);
  await one(
    `UPDATE decisions SET status=$1, approved_by=$2, approval_note=$3, approved_at=now(), sim_approved_sec=$4 WHERE id=$5 RETURNING id`,
    [approve ? 'approved' : 'rejected', req.user.id, str(req.body.note, { max: 2000 }), sim, d0.id]
  );
  const d = await decisionById(d0.id);
  emitDecision(d, 'decision:updated');
  await logEvent(
    d.exercise_id,
    approve ? 'decision_approved' : 'decision_rejected',
    { decision_id: d.id, decision: d.decision, by: req.user.name, note: d.approval_note, wait_sec: sim - Number(d0.sim_time_sec || 0) },
    req.user.id,
    sim
  );
  res.json(d);
}
misc.post('/decisions/:id/approve', ah((req, res) => review(req, res, true)));
misc.post('/decisions/:id/reject', ah((req, res) => review(req, res, false)));

// ================= PESAN / CHAT =================
const MSG_SQL = `
  SELECT m.*, u.name AS user_name, r.name AS role_name, r.color AS role_color, t.name AS team_name
    FROM messages m
    LEFT JOIN users u ON u.id=m.user_id
    LEFT JOIN exercise_members em ON em.exercise_id=m.exercise_id AND em.user_id=m.user_id
    LEFT JOIN exercise_roles r ON r.id=em.exercise_role_id
    LEFT JOIN teams t ON t.id=m.team_id`;

// Riwayat chat berhalaman: ?limit=100 (maks 200) & ?before=<id pesan tertua yang sudah dimuat>.
// Header X-Has-More: 1 bila masih ada pesan yang lebih lama.
router.get(
  '/:id/messages',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    const channel = oneOf(req.query.channel, ['general', 'team'], 'general');
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const before = optId(req.query.before);
    let rows;
    if (channel === 'general') {
      rows = await many(
        `${MSG_SQL} WHERE m.exercise_id=$1 AND m.team_id IS NULL AND ($2::int IS NULL OR m.id < $2) ORDER BY m.id DESC LIMIT $3`,
        [exId, before, limit + 1]
      );
    } else {
      const teamId = ctx.isStaff ? optId(req.query.team_id) || ctx.teamId : ctx.teamId;
      if (!teamId) return res.json([]);
      rows = await many(
        `${MSG_SQL} WHERE m.exercise_id=$1 AND m.team_id=$2 AND ($3::int IS NULL OR m.id < $3) ORDER BY m.id DESC LIMIT $4`,
        [exId, teamId, before, limit + 1]
      );
    }
    res.set('X-Has-More', rows.length > limit ? '1' : '0');
    res.json(rows.slice(0, limit).reverse());
  })
);

// Batas kirim pesan per pengguna (mencegah spam membebani database & peserta lain).
const messageLimiter = rateLimit({
  windowMs: 10 * 1000,
  limit: parseInt(process.env.CHAT_RATE_LIMIT || '20', 10),
  keyGenerator: (req) => `u:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak pesan dalam waktu singkat. Tunggu beberapa detik.' },
});

router.post(
  '/:id/messages',
  messageLimiter,
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (ctx.isViewer && !ctx.isFacilitator) forbid('Viewer tidak dapat mengirim pesan');
    if (ctx.ex.status === 'ended') bad('Latihan sudah berakhir');
    const body = str(req.body.body, { required: true, name: 'Pesan', max: 4000 });
    const channel = oneOf(req.body.channel, ['general', 'team'], 'general');
    let teamId = null;
    if (channel === 'team') {
      teamId = ctx.isStaff ? optId(req.body.team_id) || ctx.teamId : ctx.teamId;
      if (!teamId) bad(ctx.isStaff ? 'Pilih tim tujuan pesan' : 'Anda belum tergabung dalam tim');
      if (!(await one('SELECT 1 FROM teams WHERE id=$1 AND exercise_id=$2', [teamId, exId]))) bad('Tim tidak ditemukan di latihan ini');
    }
    const m0 = await one(
      `INSERT INTO messages(exercise_id, team_id, user_id, kind, body, sim_time_sec) VALUES ($1,$2,$3,'chat',$4,$5) RETURNING id`,
      [exId, teamId, req.user.id, body, simSeconds(ctx.ex)]
    );
    const m = await one(`${MSG_SQL} WHERE m.id=$1`, [m0.id]);
    if (teamId) {
      emit.team(exId, teamId, 'message:new', m);
      emit.staff(exId, 'message:new', m);
    } else emit.ex(exId, 'message:new', m);
    res.status(201).json(m);
  })
);

router.post(
  '/:id/broadcast',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!ctx.isFacilitator) forbid('Hanya fasilitator yang dapat mengirim broadcast');
    const body = str(req.body.body, { required: true, name: 'Pengumuman', max: 4000 });
    const sim = simSeconds(ctx.ex);
    const m0 = await one(
      `INSERT INTO messages(exercise_id, team_id, user_id, kind, body, sim_time_sec) VALUES ($1,NULL,$2,'broadcast',$3,$4) RETURNING id`,
      [exId, req.user.id, body, sim]
    );
    const m = await one(`${MSG_SQL} WHERE m.id=$1`, [m0.id]);
    emit.ex(exId, 'message:new', m);
    emit.ex(exId, 'broadcast', m);
    await logEvent(exId, 'broadcast', { body }, req.user.id, sim);
    res.status(201).json(m);
  })
);

// ================= PERNYATAAN PUBLIK =================
const STMT_SQL = `
  SELECT s.*, u.name AS user_name, r.name AS role_name, r.color AS role_color, t.name AS team_name
    FROM statements s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN exercise_roles r ON r.id=s.exercise_role_id
    LEFT JOIN teams t ON t.id=s.team_id`;

router.get(
  '/:id/statements',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    await exerciseContext(exId, req.user);
    res.json(await many(`${STMT_SQL} WHERE s.exercise_id=$1 ORDER BY s.id DESC`, [exId]));
  })
);

router.post(
  '/:id/statements',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!ctx.canStatement) forbid('Peran Anda tidak memiliki kewenangan menerbitkan pernyataan publik');
    requireLive(ctx);
    const sim = simSeconds(ctx.ex);
    const s0 = await one(
      `INSERT INTO statements(exercise_id, user_id, exercise_role_id, title, body, channel, sim_time_sec, team_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        exId, req.user.id, ctx.roleId,
        str(req.body.title, { required: true, name: 'Judul', max: 300 }),
        str(req.body.body, { required: true, name: 'Isi pernyataan', max: 10000 }),
        oneOf(req.body.channel, ['siaran_pers', 'media_sosial', 'website', 'konferensi_pers'], 'siaran_pers'),
        sim,
        ctx.teamId,
      ]
    );
    const s = await one(`${STMT_SQL} WHERE s.id=$1`, [s0.id]);
    emit.ex(exId, 'statement:new', s);
    await logEvent(exId, 'statement_published', { statement_id: s.id, title: s.title, channel: s.channel, by: req.user.name, role: s.role_name, team: s.team_name }, req.user.id, sim);
    await audit(req, 'publish_statement', 'statement', s.id);
    res.status(201).json(s);
  })
);

// ================= ESKALASI =================
const ESC_SQL = `
  SELECT e.*, u.name AS from_name, fr.name AS from_role_name, tr.name AS to_role_name, tr.color AS to_role_color, a.name AS ack_name,
         t.name AS team_name
    FROM escalations e
    LEFT JOIN teams t ON t.id=e.team_id
    LEFT JOIN users u ON u.id=e.from_user_id
    LEFT JOIN exercise_roles fr ON fr.id=e.from_role_id
    LEFT JOIN exercise_roles tr ON tr.id=e.to_role_id
    LEFT JOIN users a ON a.id=e.acknowledged_by`;

function emitEscalation(e, ev) {
  emit.staff(e.exercise_id, ev, e);
  // eskalasi dari anggota tim hanya sampai ke pemegang peran tujuan di tim (instansi) yang sama
  if (e.team_id) emit.teamRole(e.exercise_id, e.team_id, e.to_role_id, ev, e);
  else emit.role(e.exercise_id, e.to_role_id, ev, e);
  if (e.from_user_id) emit.user(e.from_user_id, ev, e);
}

router.get(
  '/:id/escalations',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    const rows = ctx.isStaff
      ? await many(`${ESC_SQL} WHERE e.exercise_id=$1 ORDER BY e.id DESC`, [exId])
      : await many(
          `${ESC_SQL} WHERE e.exercise_id=$1 AND (e.from_user_id=$2
             OR ($3::int IS NOT NULL AND e.to_role_id=$3 AND (e.team_id IS NULL OR e.team_id=$4))) ORDER BY e.id DESC`,
          [exId, req.user.id, ctx.roleId, ctx.teamId]
        );
    res.json(rows);
  })
);

router.post(
  '/:id/escalations',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!ctx.canEscalate) forbid('Peran Anda tidak memiliki kewenangan eskalasi');
    requireLive(ctx);
    const toRole = await one('SELECT * FROM exercise_roles WHERE id=$1 AND exercise_id=$2', [id(req.body.to_role_id, 'Peran tujuan'), exId]);
    if (!toRole) bad('Peran tujuan tidak valid');
    const sim = simSeconds(ctx.ex);
    const e0 = await one(
      `INSERT INTO escalations(exercise_id, from_user_id, from_role_id, to_role_id, subject, body, sim_time_sec, team_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [exId, req.user.id, ctx.roleId, toRole.id, str(req.body.subject, { required: true, name: 'Perihal', max: 300 }), str(req.body.body, { max: 5000 }), sim, ctx.teamId]
    );
    const e = await one(`${ESC_SQL} WHERE e.id=$1`, [e0.id]);
    emitEscalation(e, 'escalation:new');
    await logEvent(exId, 'escalation_sent', { escalation_id: e.id, subject: e.subject, from: req.user.name, to_role: toRole.name, team: e.team_name }, req.user.id, sim);
    res.status(201).json(e);
  })
);

misc.post(
  '/escalations/:id/ack',
  ah(async (req, res) => {
    const e0 = await one('SELECT * FROM escalations WHERE id=$1', [id(req.params.id)]);
    if (!e0) notFound('Eskalasi tidak ditemukan');
    const ctx = await exerciseContext(e0.exercise_id, req.user);
    const forMe = ctx.roleId && ctx.roleId === e0.to_role_id && (!e0.team_id || e0.team_id === ctx.teamId);
    if (!(ctx.isFacilitator || forMe)) forbid('Eskalasi ini bukan untuk peran Anda');
    if (e0.acknowledged_at) bad('Eskalasi sudah diterima');
    const sim = simSeconds(ctx.ex);
    await one(`UPDATE escalations SET acknowledged_at=now(), acknowledged_by=$1, sim_ack_sec=$2 WHERE id=$3 RETURNING id`, [req.user.id, sim, e0.id]);
    const e = await one(`${ESC_SQL} WHERE e.id=$1`, [e0.id]);
    emitEscalation(e, 'escalation:updated');
    await logEvent(e.exercise_id, 'escalation_acknowledged', { escalation_id: e.id, subject: e.subject, by: req.user.name, wait_sec: sim - Number(e0.sim_time_sec || 0) }, req.user.id, sim);
    res.json(e);
  })
);

module.exports = { collabRouter: router, collabMisc: misc };
