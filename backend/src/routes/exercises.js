const express = require('express');
const { one, many, query, tx } = require('../db');
const { canDesign, exerciseContext, audit } = require('../auth');
const { ah, id, optId, str, oneOf, bool, forbid, notFound, bad } = require('../util');
const { createExercise, copyPresetRoles } = require('../services');
const { simSeconds, publicState } = require('../simclock');
const { emit, logEvent, presenceList } = require('../realtime');
const { dispatchInject, wake } = require('../scheduler');
const { roleFields } = require('./roles');

const router = express.Router(); // /api/exercises
const misc = express.Router(); // /api (teams, exercise-roles, exercise-injects, ...)

const INJECT_TYPES = ['text', 'email', 'news', 'social', 'log', 'phone', 'memo'];
const PRIORITIES = ['normal', 'tinggi', 'kritis'];
const MEMBER_ROLES = ['facilitator', 'player', 'evaluator', 'viewer'];

async function ctxFor(req, exerciseId) {
  return exerciseContext(exerciseId, req.user);
}
function requireFacilitator(ctx) {
  if (!ctx.isFacilitator) forbid('Hanya fasilitator yang dapat melakukan tindakan ini');
}
function requireAdmin(req) {
  if (req.user.role !== 'admin') forbid('Hanya admin yang dapat mengelola tim');
}
function targets(inj, ctx) {
  return (!inj.team_id || inj.team_id === ctx.teamId) && (!inj.exercise_role_id || inj.exercise_role_id === ctx.roleId);
}
function broadcastState(ex) {
  emit.ex(ex.id, 'exercise:state', publicState(ex));
}

// ---------- Daftar & pembuatan ----------
router.get(
  '/',
  ah(async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const rows = await many(
      `SELECT e.*, s.title AS scenario_title, p.name AS preset_name, u.name AS created_by_name,
              m.role AS my_role,
              (SELECT COUNT(*) FROM exercise_members x WHERE x.exercise_id=e.id)::int AS member_count,
              (SELECT COUNT(*) FROM exercise_injects i WHERE i.exercise_id=e.id)::int AS inject_count,
              (SELECT COUNT(*) FROM exercise_injects i WHERE i.exercise_id=e.id AND i.status='sent')::int AS sent_count
         FROM exercises e
         LEFT JOIN scenarios s ON s.id=e.scenario_id
         LEFT JOIN role_presets p ON p.id=e.preset_id
         LEFT JOIN users u ON u.id=e.created_by
         LEFT JOIN exercise_members m ON m.exercise_id=e.id AND m.user_id=$1
        WHERE $2::boolean OR m.id IS NOT NULL OR e.created_by=$1
        ORDER BY CASE e.status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, e.created_at DESC`,
      [req.user.id, isAdmin]
    );
    // tautan layar penonton hanya untuk fasilitator (diambil lewat endpoint display)
    res.json(rows.map(({ display_key, ...r }) => ({ ...r, sim_now_sec: simSeconds(r) })));
  })
);

router.post(
  '/',
  canDesign,
  ah(async (req, res) => {
    const ex = await tx((c) =>
      createExercise(
        c,
        {
          scenario_id: optId(req.body.scenario_id),
          title: str(req.body.title, { max: 300 }),
          description: str(req.body.description, { max: 5000 }),
          preset_id: optId(req.body.preset_id),
          scheduled_for: req.body.scheduled_for || null,
          speed: Math.max(0.25, Math.min(60, Number(req.body.speed) || 1)),
        },
        req.user.id
      )
    );
    await audit(req, 'create', 'exercise', ex.id, { title: ex.title });
    res.status(201).json(ex);
  })
);

// ---------- Detail ----------
router.get(
  '/:id',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await ctxFor(req, exId);
    const { display_key, ...ex } = ctx.ex;
    const [teams, roles, members, objectives] = await Promise.all([
      many('SELECT id, exercise_id, name, color, org_team_id FROM teams WHERE exercise_id=$1 ORDER BY id', [exId]),
      many('SELECT * FROM exercise_roles WHERE exercise_id=$1 ORDER BY sort, id', [exId]),
      many(
        `SELECT m.*, u.name, u.email, u.organization FROM exercise_members m JOIN users u ON u.id=m.user_id
          WHERE m.exercise_id=$1 ORDER BY m.role, u.name`,
        [exId]
      ),
      many('SELECT * FROM exercise_objectives WHERE exercise_id=$1 ORDER BY sort, id', [exId]),
    ]);
    const scenario = ex.scenario_id ? await one('SELECT id, title FROM scenarios WHERE id=$1', [ex.scenario_id]) : null;
    res.json({
      ...ex,
      scenario,
      state: publicState(ex),
      teams,
      roles,
      members: ctx.isStaff ? members : members.map((m) => ({ id: m.id, user_id: m.user_id, name: m.name, role: m.role, team_id: m.team_id, exercise_role_id: m.exercise_role_id, ready_at: m.ready_at })),
      objectives,
      online: presenceList(exId),
      display_key: ctx.isFacilitator ? display_key : undefined,
      me: {
        user_id: req.user.id,
        member_role: ctx.member ? ctx.member.role : ctx.isFacilitator ? 'facilitator' : null,
        team_id: ctx.teamId,
        exercise_role_id: ctx.roleId,
        is_facilitator: ctx.isFacilitator,
        is_evaluator: ctx.isEvaluator,
        is_viewer: ctx.isViewer,
        is_player: ctx.isPlayer,
        is_staff: ctx.isStaff,
        ready: !!(ctx.member && ctx.member.ready_at),
        can_approve: ctx.canApprove,
        can_statement: ctx.canStatement,
        can_escalate: ctx.canEscalate,
      },
    });
  })
);

router.put(
  '/:id',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await ctxFor(req, exId);
    requireFacilitator(ctx);
    const b = req.body;
    const ex = await one(
      `UPDATE exercises SET title=COALESCE($1,title), description=COALESCE($2,description), narrative=COALESCE($3,narrative),
              duration_min=COALESCE($4,duration_min), scheduled_for=$5, briefing=COALESCE($7,briefing),
              reminded_at=CASE WHEN scheduled_for IS DISTINCT FROM $5 THEN NULL ELSE reminded_at END
        WHERE id=$6 RETURNING *`,
      [
        str(b.title, { max: 300 }),
        b.description !== undefined ? str(b.description, { max: 5000 }) || '' : null,
        b.narrative !== undefined ? str(b.narrative, { max: 20000 }) || '' : null,
        b.duration_min ? parseInt(b.duration_min, 10) : null,
        b.scheduled_for !== undefined ? b.scheduled_for || null : ctx.ex.scheduled_for,
        exId,
        b.briefing !== undefined ? str(b.briefing, { max: 20000 }) || '' : null,
      ]
    );
    await audit(req, 'update', 'exercise', exId);
    emit.ex(exId, 'exercise:updated', { id: exId });
    res.json(ex);
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await ctxFor(req, exId);
    if (!(ctx.isAdmin || ctx.ex.created_by === req.user.id)) forbid('Hanya admin atau pembuat latihan yang dapat menghapus');
    await query('DELETE FROM exercises WHERE id=$1', [exId]);
    await audit(req, 'delete', 'exercise', exId, { title: ctx.ex.title });
    emit.ex(exId, 'exercise:deleted', { id: exId });
    res.json({ ok: true });
  })
);

// ---------- Siklus latihan ----------
/**
 * Syarat mulai: semua peserta siap (atau yang belum siap dikeluarkan bila drop_not_ready),
 * dan setiap tim yang berisi peserta sudah mengisi semua peran wajib.
 */
async function startChecks(c, exId, dropNotReady) {
  const players = (
    await c.query(
      `SELECT m.user_id, u.name, m.ready_at, m.team_id FROM exercise_members m JOIN users u ON u.id=m.user_id
        WHERE m.exercise_id=$1 AND m.role='player' ORDER BY u.name`,
      [exId]
    )
  ).rows;
  if (!players.length) bad('Belum ada peserta di latihan ini');
  const notReady = players.filter((p) => !p.ready_at);
  const list = (arr) => `${arr.slice(0, 5).join(', ')}${arr.length > 5 ? ', …' : ''}`;
  if (notReady.length && !dropNotReady) {
    bad(`Belum semua peserta siap (${notReady.length}/${players.length}): ${list(notReady.map((p) => p.name))}`);
  }
  if (notReady.length === players.length) bad('Belum ada peserta yang menyatakan siap');
  for (const p of notReady) {
    await c.query('DELETE FROM exercise_members WHERE exercise_id=$1 AND user_id=$2', [exId, p.user_id]);
    await c.query(
      `UPDATE exercise_applications SET status='rejected', review_note='Tidak siap saat latihan dimulai', reviewed_at=now()
        WHERE exercise_id=$1 AND user_id=$2`,
      [exId, p.user_id]
    );
  }
  const missing = (
    await c.query(
      `SELECT t.name AS team, r.name AS role
         FROM teams t CROSS JOIN exercise_roles r
        WHERE t.exercise_id=$1 AND r.exercise_id=$1 AND r.required
          AND EXISTS (SELECT 1 FROM exercise_members m WHERE m.exercise_id=$1 AND m.team_id=t.id AND m.role='player')
          AND NOT EXISTS (SELECT 1 FROM exercise_members m WHERE m.exercise_id=$1 AND m.team_id=t.id AND m.role='player' AND m.exercise_role_id=r.id)
        ORDER BY t.name, r.sort`,
      [exId]
    )
  ).rows;
  if (missing.length) bad(`Peran wajib belum terisi: ${list(missing.map((x) => `${x.team} (${x.role})`))}`);
  const updated = (
    await c.query(`UPDATE exercises SET status='running', started_at=now(), resumed_at=now(), sim_elapsed_sec=0 WHERE id=$1 RETURNING *`, [exId])
  ).rows[0];
  return { updated, dropped: notReady };
}

async function transition(req, res, action) {
  const exId = id(req.params.id);
  const ctx = await ctxFor(req, exId);
  requireFacilitator(ctx);
  const ex = ctx.ex;
  const sim = simSeconds(ex);
  let updated;
  let dropped = [];
  switch (action) {
    case 'start': {
      if (ex.status !== 'draft') bad('Latihan sudah pernah dimulai');
      const r = await tx((c) => startChecks(c, exId, bool(req.body.drop_not_ready)));
      updated = r.updated;
      dropped = r.dropped;
      break;
    }
    case 'pause':
      if (ex.status !== 'running') bad('Latihan tidak sedang berjalan');
      updated = await one(`UPDATE exercises SET status='paused', sim_elapsed_sec=$2, resumed_at=NULL WHERE id=$1 RETURNING *`, [exId, sim]);
      break;
    case 'resume':
      if (ex.status !== 'paused') bad('Latihan tidak sedang dijeda');
      updated = await one(`UPDATE exercises SET status='running', resumed_at=now() WHERE id=$1 RETURNING *`, [exId]);
      break;
    case 'end':
      if (!['running', 'paused'].includes(ex.status)) bad('Latihan belum berjalan');
      updated = await one(
        `UPDATE exercises SET status='ended', sim_elapsed_sec=$2, resumed_at=NULL, ended_at=now() WHERE id=$1 RETURNING *`,
        [exId, sim]
      );
      break;
    default:
      bad('Aksi tidak dikenal');
  }
  if (action === 'start' || action === 'resume') wake();
  await logEvent(exId, `exercise_${action}`, { by: req.user.name, dropped: dropped.map((p) => p.name) }, req.user.id, simSeconds(updated));
  await audit(req, action, 'exercise', exId, dropped.length ? { dropped: dropped.map((p) => p.user_id) } : {});
  broadcastState(updated);
  if (action === 'start') {
    // beri tahu peserta di mana pun mereka berada di aplikasi
    const members = await many(`SELECT user_id FROM exercise_members WHERE exercise_id=$1 AND role='player'`, [exId]);
    members.forEach((m) => emit.user(m.user_id, 'exercise:started', { exercise_id: exId, title: updated.title }));
    dropped.forEach((p) => {
      emit.user(p.user_id, 'membership:changed', { exercise_id: exId, removed: true });
      emit.user(p.user_id, 'application:updated', { exercise_id: exId, status: 'rejected' });
    });
    if (dropped.length) emit.ex(exId, 'exercise:updated', { id: exId });
  }
  res.json(publicState(updated));
}
['start', 'pause', 'resume', 'end'].forEach((a) => router.post(`/:id/${a}`, ah((req, res) => transition(req, res, a))));

router.post(
  '/:id/speed',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await ctxFor(req, exId);
    requireFacilitator(ctx);
    const speed = Math.max(0.25, Math.min(60, Number(req.body.speed) || 1));
    const sim = simSeconds(ctx.ex);
    const updated = await one(
      `UPDATE exercises SET speed=$2, sim_elapsed_sec=$3, resumed_at=CASE WHEN status='running' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,
      [exId, speed, sim]
    );
    await logEvent(exId, 'speed_changed', { speed }, req.user.id, sim);
    broadcastState(updated);
    res.json(publicState(updated));
  })
);

// Lompat maju jam simulasi (fast-forward)
router.post(
  '/:id/jump',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await ctxFor(req, exId);
    requireFacilitator(ctx);
    if (!['running', 'paused'].includes(ctx.ex.status)) bad('Latihan belum berjalan');
    const target = Math.max(0, Number(req.body.sim_min) || 0) * 60;
    const sim = simSeconds(ctx.ex);
    if (target <= sim) bad('Waktu tujuan harus lebih besar dari jam simulasi saat ini');
    const updated = await one(
      `UPDATE exercises SET sim_elapsed_sec=$2, resumed_at=CASE WHEN status='running' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,
      [exId, target]
    );
    wake();
    await logEvent(exId, 'clock_jump', { from_sec: sim, to_sec: target }, req.user.id, target);
    broadcastState(updated);
    res.json(publicState(updated));
  })
);

// Reset latihan ke draft (gladi ulang): hapus semua aktivitas
router.post(
  '/:id/reset',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await ctxFor(req, exId);
    requireFacilitator(ctx);
    await tx(async (c) => {
      for (const t of ['responses', 'decisions', 'messages', 'statements', 'escalations', 'observations', 'scores', 'feedback', 'events']) {
        await c.query(`DELETE FROM ${t} WHERE exercise_id=$1`, [exId]);
      }
      await c.query(`DELETE FROM exercise_injects WHERE exercise_id=$1 AND adhoc`, [exId]);
      await c.query(`UPDATE exercise_injects SET status='scheduled', sent_at=NULL, sim_sent_sec=NULL WHERE exercise_id=$1`, [exId]);
      await c.query(
        `UPDATE exercises SET status='draft', sim_elapsed_sec=0, resumed_at=NULL, started_at=NULL, ended_at=NULL WHERE id=$1`,
        [exId]
      );
      // gladi ulang: peserta perlu menyatakan siap lagi
      await c.query('UPDATE exercise_members SET ready_at=NULL WHERE exercise_id=$1', [exId]);
    });
    await audit(req, 'reset', 'exercise', exId);
    const ex = await one('SELECT * FROM exercises WHERE id=$1', [exId]);
    broadcastState(ex);
    emit.ex(exId, 'exercise:updated', { id: exId });
    res.json(publicState(ex));
  })
);

// ---------- Tim latihan — dibuat otomatis dari tim instansi saat lamaran diterima; admin dapat mengubah/menghapus ----------
const validColor = (v) => /^#[0-9a-fA-F]{6}$/.test(v || '');

async function loadTeam(req) {
  requireAdmin(req);
  const t = await one('SELECT * FROM teams WHERE id=$1', [id(req.params.id)]);
  if (!t) notFound('Tim tidak ditemukan');
  return t;
}
misc.put(
  '/teams/:id',
  ah(async (req, res) => {
    const t0 = await loadTeam(req);
    const t = await one('UPDATE teams SET name=$1, color=$2 WHERE id=$3 RETURNING *', [
      req.body.name !== undefined ? str(req.body.name, { required: true, name: 'Nama tim', max: 120 }) : t0.name,
      validColor(req.body.color) ? req.body.color : t0.color,
      t0.id,
    ]);
    emit.ex(t0.exercise_id, 'exercise:updated', { id: t0.exercise_id });
    res.json(t);
  })
);
misc.delete(
  '/teams/:id',
  ah(async (req, res) => {
    const t0 = await loadTeam(req);
    await query('DELETE FROM teams WHERE id=$1', [t0.id]);
    await audit(req, 'delete', 'team', t0.id, { name: t0.name });
    emit.ex(t0.exercise_id, 'exercise:updated', { id: t0.exercise_id });
    emit.ex(t0.exercise_id, 'membership:changed', {});
    res.json({ ok: true });
  })
);

// ---------- Peran per latihan ----------
router.post(
  '/:id/roles',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    requireFacilitator(await ctxFor(req, exId));
    if (req.body.preset_id) {
      // terapkan preset: tambahkan peran yang belum ada (berdasarkan nama)
      const pid = id(req.body.preset_id);
      const out = await tx(async (c) => {
        if (bool(req.body.replace)) await c.query('DELETE FROM exercise_roles WHERE exercise_id=$1', [exId]);
        const existing = (await c.query('SELECT name FROM exercise_roles WHERE exercise_id=$1', [exId])).rows.map((r) => r.name);
        const added = await copyPresetRoles(c, exId, pid);
        // hapus duplikat nama yang baru ditambahkan
        for (const r of added) if (existing.includes(r.name)) await c.query('DELETE FROM exercise_roles WHERE id=$1', [r.id]);
        await c.query('UPDATE exercises SET preset_id=$1 WHERE id=$2', [pid, exId]);
        return added.filter((r) => !existing.includes(r.name));
      });
      emit.ex(exId, 'exercise:updated', { id: exId });
      emit.ex(exId, 'membership:changed', {});
      return res.status(201).json(out);
    }
    const f = roleFields(req.body);
    const r = await one(
      `INSERT INTO exercise_roles(exercise_id, code, name, subtitle, description, color, can_approve, can_statement, can_escalate, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [exId, f.code, f.name, f.subtitle, f.description, f.color, f.can_approve, f.can_statement, f.can_escalate, f.sort]
    );
    emit.ex(exId, 'exercise:updated', { id: exId });
    res.status(201).json(r);
  })
);
misc.put(
  '/exercise-roles/:id',
  ah(async (req, res) => {
    const r0 = await one('SELECT * FROM exercise_roles WHERE id=$1', [id(req.params.id)]);
    if (!r0) notFound('Peran tidak ditemukan');
    requireFacilitator(await ctxFor(req, r0.exercise_id));
    const f = roleFields(req.body);
    const r = await one(
      `UPDATE exercise_roles SET code=$1, name=$2, subtitle=$3, description=$4, color=$5, can_approve=$6, can_statement=$7, can_escalate=$8, sort=$9,
              required=$11
        WHERE id=$10 RETURNING *`,
      [
        f.code || r0.code, f.name, f.subtitle, f.description, f.color, f.can_approve, f.can_statement, f.can_escalate, f.sort || r0.sort, r0.id,
        req.body.required !== undefined ? bool(req.body.required) : r0.required,
      ]
    );
    emit.ex(r0.exercise_id, 'exercise:updated', { id: r0.exercise_id });
    emit.ex(r0.exercise_id, 'membership:changed', {});
    res.json(r);
  })
);
misc.delete(
  '/exercise-roles/:id',
  ah(async (req, res) => {
    const r0 = await one('SELECT * FROM exercise_roles WHERE id=$1', [id(req.params.id)]);
    if (!r0) notFound('Peran tidak ditemukan');
    requireFacilitator(await ctxFor(req, r0.exercise_id));
    await query('DELETE FROM exercise_roles WHERE id=$1', [r0.id]);
    emit.ex(r0.exercise_id, 'exercise:updated', { id: r0.exercise_id });
    emit.ex(r0.exercise_id, 'membership:changed', {});
    res.json({ ok: true });
  })
);

// ---------- Peserta ----------
router.post(
  '/:id/members',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    requireFacilitator(await ctxFor(req, exId));
    const list = Array.isArray(req.body.members) ? req.body.members : [req.body];
    const out = [];
    for (const b of list) {
      const userId = id(b.user_id, 'user_id');
      const teamId = optId(b.team_id);
      const roleId = optId(b.exercise_role_id);
      if (teamId && !(await one('SELECT id FROM teams WHERE id=$1 AND exercise_id=$2', [teamId, exId]))) bad('Tim tidak valid');
      if (roleId && !(await one('SELECT id FROM exercise_roles WHERE id=$1 AND exercise_id=$2', [roleId, exId]))) bad('Peran tidak valid');
      const m = await one(
        `INSERT INTO exercise_members(exercise_id, user_id, role, team_id, exercise_role_id) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (exercise_id, user_id) DO UPDATE SET role=EXCLUDED.role, team_id=EXCLUDED.team_id, exercise_role_id=EXCLUDED.exercise_role_id,
           ready_at = CASE WHEN exercise_members.role=EXCLUDED.role AND exercise_members.team_id IS NOT DISTINCT FROM EXCLUDED.team_id
                            AND exercise_members.exercise_role_id IS NOT DISTINCT FROM EXCLUDED.exercise_role_id
                           THEN exercise_members.ready_at ELSE NULL END
         RETURNING *`,
        [exId, userId, oneOf(b.role, MEMBER_ROLES, 'player'), teamId, roleId]
      );
      out.push(m);
      emit.user(userId, 'membership:changed', { exercise_id: exId });
    }
    await audit(req, 'assign_members', 'exercise', exId, { count: out.length });
    emit.ex(exId, 'exercise:updated', { id: exId });
    res.status(201).json(out);
  })
);
router.delete(
  '/:id/members/:userId',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    requireFacilitator(await ctxFor(req, exId));
    const uid = id(req.params.userId);
    await query('DELETE FROM exercise_members WHERE exercise_id=$1 AND user_id=$2', [exId, uid]);
    emit.user(uid, 'membership:changed', { exercise_id: exId, removed: true });
    emit.ex(exId, 'exercise:updated', { id: exId });
    res.json({ ok: true });
  })
);

// ---------- Objective latihan ----------
router.post(
  '/:id/objectives',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    requireFacilitator(await ctxFor(req, exId));
    const m = await one('SELECT COALESCE(MAX(sort),-1)+1 AS s FROM exercise_objectives WHERE exercise_id=$1', [exId]);
    const o = await one('INSERT INTO exercise_objectives(exercise_id, title, description, sort) VALUES ($1,$2,$3,$4) RETURNING *', [
      exId,
      str(req.body.title, { required: true, name: 'Judul objective', max: 300 }),
      str(req.body.description, { max: 3000 }),
      m.s,
    ]);
    emit.ex(exId, 'exercise:updated', { id: exId });
    res.status(201).json(o);
  })
);
misc.put(
  '/exercise-objectives/:id',
  ah(async (req, res) => {
    const o0 = await one('SELECT * FROM exercise_objectives WHERE id=$1', [id(req.params.id)]);
    if (!o0) notFound();
    requireFacilitator(await ctxFor(req, o0.exercise_id));
    const o = await one('UPDATE exercise_objectives SET title=$1, description=$2 WHERE id=$3 RETURNING *', [
      str(req.body.title, { required: true, name: 'Judul objective', max: 300 }),
      str(req.body.description, { max: 3000 }),
      o0.id,
    ]);
    emit.ex(o0.exercise_id, 'exercise:updated', { id: o0.exercise_id });
    res.json(o);
  })
);
misc.delete(
  '/exercise-objectives/:id',
  ah(async (req, res) => {
    const o0 = await one('SELECT * FROM exercise_objectives WHERE id=$1', [id(req.params.id)]);
    if (!o0) notFound();
    requireFacilitator(await ctxFor(req, o0.exercise_id));
    await query('DELETE FROM exercise_objectives WHERE id=$1', [o0.id]);
    emit.ex(o0.exercise_id, 'exercise:updated', { id: o0.exercise_id });
    res.json({ ok: true });
  })
);

// ---------- Inject (staf) ----------
function injectFields(b) {
  return {
    team_id: optId(b.team_id),
    exercise_role_id: optId(b.exercise_role_id),
    offset_min: Math.max(0, parseInt(b.offset_min, 10) || 0),
    title: str(b.title, { required: true, name: 'Judul inject', max: 300 }),
    type: oneOf(b.type, INJECT_TYPES, 'text'),
    sender: str(b.sender, { max: 200 }),
    content: str(b.content, { max: 20000 }) || '',
    question: str(b.question, { max: 2000 }) || '',
    options: JSON.stringify(Array.isArray(b.options) ? b.options.map(String).filter((s) => s.trim()).slice(0, 8) : []),
    attachments: JSON.stringify(Array.isArray(b.attachments) ? b.attachments.slice(0, 10) : []),
    requires_response: b.requires_response === undefined ? true : bool(b.requires_response),
    priority: oneOf(b.priority, PRIORITIES, 'normal'),
  };
}

router.get(
  '/:id/injects',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await ctxFor(req, exId);
    if (!ctx.isStaff) forbid();
    const injects = await many('SELECT * FROM exercise_injects WHERE exercise_id=$1 ORDER BY offset_min, sort, id', [exId]);
    const responses = await many(
      `SELECT r.*, u.name AS user_name, t.name AS team_name, er.name AS role_name
         FROM responses r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN teams t ON t.id=r.team_id
         LEFT JOIN exercise_roles er ON er.id=r.exercise_role_id
        WHERE r.exercise_id=$1 ORDER BY r.created_at`,
      [exId]
    );
    res.json(injects.map((i) => ({ ...i, responses: responses.filter((r) => r.inject_id === i.id) })));
  })
);

router.post(
  '/:id/injects',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await ctxFor(req, exId);
    requireFacilitator(ctx);
    const f = injectFields(req.body);
    const sendNow = bool(req.body.send_now);
    const live = ['running', 'paused'].includes(ctx.ex.status);
    const sim = simSeconds(ctx.ex);
    if (sendNow && !live) bad('Inject hanya bisa dikirim langsung saat latihan berjalan');
    let inj = await one(
      `INSERT INTO exercise_injects(exercise_id, team_id, exercise_role_id, offset_min, title, type, sender, content, question, options, attachments, requires_response, priority, adhoc, status, sent_at, sim_sent_sec)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        exId, f.team_id, f.exercise_role_id, sendNow ? Math.floor(sim / 60) : f.offset_min, f.title, f.type, f.sender, f.content,
        f.question, f.options, f.attachments, f.requires_response, f.priority, live, sendNow ? 'sent' : 'scheduled',
        sendNow ? new Date() : null, sendNow ? sim : null,
      ]
    );
    if (sendNow) await dispatchInject(inj, req.user.id);
    else emit.staff(exId, 'inject:updated', inj);
    await audit(req, 'create', 'exercise_inject', inj.id, { adhoc: live, send_now: sendNow });
    res.status(201).json(inj);
  })
);

async function loadInject(req, injId) {
  const inj = await one('SELECT * FROM exercise_injects WHERE id=$1', [injId]);
  if (!inj) notFound('Inject tidak ditemukan');
  const ctx = await ctxFor(req, inj.exercise_id);
  return { inj, ctx };
}

misc.put(
  '/exercise-injects/:id',
  ah(async (req, res) => {
    const { inj, ctx } = await loadInject(req, id(req.params.id));
    requireFacilitator(ctx);
    const f = injectFields(req.body);
    const out = await one(
      `UPDATE exercise_injects SET team_id=$1, exercise_role_id=$2, offset_min=$3, title=$4, type=$5, sender=$6, content=$7, question=$8,
              options=$9, attachments=$10, requires_response=$11, priority=$12 WHERE id=$13 RETURNING *`,
      [f.team_id, f.exercise_role_id, f.offset_min, f.title, f.type, f.sender, f.content, f.question, f.options, f.attachments, f.requires_response, f.priority, inj.id]
    );
    emit.staff(inj.exercise_id, 'inject:updated', out);
    if (out.status === 'sent') emit.ex(inj.exercise_id, 'injects:changed', { inject_id: inj.id });
    res.json(out);
  })
);
misc.delete(
  '/exercise-injects/:id',
  ah(async (req, res) => {
    const { inj, ctx } = await loadInject(req, id(req.params.id));
    requireFacilitator(ctx);
    await query('DELETE FROM exercise_injects WHERE id=$1', [inj.id]);
    emit.staff(inj.exercise_id, 'inject:deleted', { id: inj.id });
    emit.ex(inj.exercise_id, 'injects:changed', { inject_id: inj.id });
    res.json({ ok: true });
  })
);
misc.post(
  '/exercise-injects/:id/send',
  ah(async (req, res) => {
    const { inj, ctx } = await loadInject(req, id(req.params.id));
    requireFacilitator(ctx);
    if (!['running', 'paused'].includes(ctx.ex.status)) bad('Latihan belum berjalan');
    if (inj.status === 'sent') bad('Inject sudah terkirim');
    const sim = simSeconds(ctx.ex);
    const out = await one(
      `UPDATE exercise_injects SET status='sent', sent_at=now(), sim_sent_sec=$2 WHERE id=$1 RETURNING *`,
      [inj.id, sim]
    );
    await dispatchInject(out, req.user.id);
    res.json(out);
  })
);
misc.post(
  '/exercise-injects/:id/skip',
  ah(async (req, res) => {
    const { inj, ctx } = await loadInject(req, id(req.params.id));
    requireFacilitator(ctx);
    if (inj.status !== 'scheduled') bad('Hanya inject terjadwal yang dapat dilewati');
    const out = await one(`UPDATE exercise_injects SET status='skipped' WHERE id=$1 RETURNING *`, [inj.id]);
    emit.staff(inj.exercise_id, 'inject:updated', out);
    await logEvent(inj.exercise_id, 'inject_skipped', { inject_id: inj.id, title: inj.title }, req.user.id);
    res.json(out);
  })
);
misc.post(
  '/exercise-injects/:id/unskip',
  ah(async (req, res) => {
    const { inj, ctx } = await loadInject(req, id(req.params.id));
    requireFacilitator(ctx);
    if (inj.status !== 'skipped') bad('Inject tidak dalam status dilewati');
    const out = await one(`UPDATE exercise_injects SET status='scheduled' WHERE id=$1 RETURNING *`, [inj.id]);
    emit.staff(inj.exercise_id, 'inject:updated', out);
    res.json(out);
  })
);

// ---------- Inject (peserta) ----------
router.get(
  '/:id/my-injects',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await ctxFor(req, exId);
    const injects = await many(
      `SELECT id, exercise_id, team_id, exercise_role_id, offset_min, title, type, sender, content, question, options, attachments,
              requires_response, priority, status, sent_at, sim_sent_sec
         FROM exercise_injects WHERE exercise_id=$1 AND status='sent' ORDER BY sim_sent_sec DESC, id DESC`,
      [exId]
    );
    const visible = ctx.isStaff ? injects : injects.filter((i) => targets(i, ctx));
    const myResponses = ctx.teamId
      ? await many(
          `SELECT r.*, u.name AS user_name FROM responses r LEFT JOIN users u ON u.id=r.user_id WHERE r.exercise_id=$1 AND r.team_id=$2`,
          [exId, ctx.teamId]
        )
      : await many(
          `SELECT r.*, u.name AS user_name FROM responses r LEFT JOIN users u ON u.id=r.user_id WHERE r.exercise_id=$1 AND r.user_id=$2`,
          [exId, req.user.id]
        );
    res.json(visible.map((i) => ({ ...i, my_response: myResponses.find((r) => r.inject_id === i.id) || null })));
  })
);

misc.post(
  '/exercise-injects/:id/respond',
  ah(async (req, res) => {
    const { inj, ctx } = await loadInject(req, id(req.params.id));
    if (!ctx.isPlayer && !ctx.isFacilitator) forbid('Hanya peserta yang dapat merespons inject');
    if (ctx.ex.status === 'ended') bad('Latihan sudah berakhir');
    if (ctx.ex.status === 'draft') bad('Latihan belum dimulai');
    if (inj.status !== 'sent' || (!ctx.isFacilitator && !targets(inj, ctx))) forbid('Inject ini tidak ditujukan kepada Anda');
    const content = str(req.body.content, { max: 10000 }) || '';
    const choice = str(req.body.choice, { max: 500 });
    if (!content && !choice) bad('Isi respons atau pilih salah satu opsi');
    const sim = simSeconds(ctx.ex);
    const existing = ctx.teamId
      ? await one('SELECT * FROM responses WHERE inject_id=$1 AND team_id=$2', [inj.id, ctx.teamId])
      : await one('SELECT * FROM responses WHERE inject_id=$1 AND user_id=$2 AND team_id IS NULL', [inj.id, req.user.id]);
    let r;
    if (existing) {
      r = await one(
        `UPDATE responses SET content=$1, choice=$2, user_id=$3, exercise_role_id=$4, updated_at=now() WHERE id=$5 RETURNING *`,
        [content, choice, req.user.id, ctx.roleId, existing.id]
      );
    } else {
      r = await one(
        `INSERT INTO responses(inject_id, exercise_id, team_id, user_id, exercise_role_id, content, choice, sim_time_sec)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [inj.id, inj.exercise_id, ctx.teamId, req.user.id, ctx.roleId, content, choice, sim]
      );
    }
    const payload = {
      ...r,
      user_name: req.user.name,
      team_name: ctx.member ? ctx.member.team_name : null,
      role_name: ctx.member ? ctx.member.role_name : null,
      inject_title: inj.title,
      updated: !!existing,
    };
    emit.staff(inj.exercise_id, 'response:new', payload);
    emit.team(inj.exercise_id, ctx.teamId, 'response:new', payload);
    await logEvent(
      inj.exercise_id,
      existing ? 'response_updated' : 'response_submitted',
      { inject_id: inj.id, title: inj.title, team: payload.team_name, role: payload.role_name, by: req.user.name, choice },
      req.user.id,
      sim
    );
    res.json(r);
  })
);

module.exports = { exerciseRouter: router, exerciseMisc: misc, targets };
