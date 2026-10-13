const express = require('express');
const { one, many, tx } = require('../db');
const { exerciseContext, audit } = require('../auth');
const { ah, id, optId, str, bool, forbid, notFound, bad } = require('../util');
const { ensureExerciseTeam, mapExerciseRole } = require('../services');
const { emit, logEvent } = require('../realtime');

const router = express.Router(); // /api/exercises
const misc = express.Router(); // /api

function requireFacilitator(ctx) {
  if (!ctx.isFacilitator) forbid('Hanya admin/fasilitator yang dapat melakukan tindakan ini');
}

const APP_SQL = `
  SELECT a.*, u.name AS user_name, u.email AS user_email, u.organization,
         ot.name AS org_team_name, ot.color AS org_team_color, pr.name AS player_role_name, pr.code AS player_role_code,
         rv.name AS reviewer_name
    FROM exercise_applications a
    JOIN users u ON u.id=a.user_id
    LEFT JOIN org_teams ot ON ot.id=a.org_team_id
    LEFT JOIN player_roles pr ON pr.id=a.player_role_id
    LEFT JOIN users rv ON rv.id=a.reviewed_by`;

/** Latihan tanpa daftar undangan terbuka untuk semua tim instansi. */
async function isInvited(exerciseId, orgTeamId) {
  const r = await one(
    `SELECT NOT EXISTS (SELECT 1 FROM exercise_invites WHERE exercise_id=$1)
            OR EXISTS (SELECT 1 FROM exercise_invites WHERE exercise_id=$1 AND org_team_id=$2) AS ok`,
    [exerciseId, orgTeamId || 0]
  );
  return r.ok;
}

async function openExercise(exId) {
  const ex = await one('SELECT id, title, status, published_at FROM exercises WHERE id=$1', [exId]);
  if (!ex || !ex.published_at) notFound('Latihan tidak ditemukan atau belum dipublikasikan');
  if (ex.status === 'ended') bad('Latihan sudah berakhir');
  return ex;
}

/** Buat/perbarui lamaran pending untuk satu pengguna. Mengembalikan id lamaran atau null bila dilewati. */
async function upsertApplication(exId, userId, orgTeamId, playerRoleId, message) {
  const r = await one(
    `INSERT INTO exercise_applications(exercise_id, user_id, org_team_id, player_role_id, message) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (exercise_id, user_id) DO UPDATE SET org_team_id=EXCLUDED.org_team_id, player_role_id=EXCLUDED.player_role_id,
            message=EXCLUDED.message, status='pending', review_note=NULL, reviewed_by=NULL, reviewed_at=NULL, created_at=now()
     RETURNING id`,
    [exId, userId, orgTeamId, playerRoleId, message]
  );
  return r.id;
}

// ---------- Peserta: latihan yang dibuka untuk lamaran ----------
router.get(
  '/open',
  ah(async (req, res) => {
    const rows = await many(
      `SELECT e.id, e.title, e.description, e.status, e.scheduled_for, e.duration_min, e.published_at,
              s.title AS scenario_title,
              a.id AS application_id, a.status AS application_status, a.review_note,
              m.role AS member_role, m.ready_at,
              (SELECT COUNT(*) FROM exercise_members x WHERE x.exercise_id=e.id AND x.role='player')::int AS players
         FROM exercises e
         LEFT JOIN scenarios s ON s.id=e.scenario_id
         LEFT JOIN exercise_applications a ON a.exercise_id=e.id AND a.user_id=$1
         LEFT JOIN exercise_members m ON m.exercise_id=e.id AND m.user_id=$1
        WHERE e.published_at IS NOT NULL AND e.status<>'ended'
          AND (m.id IS NOT NULL
               OR NOT EXISTS (SELECT 1 FROM exercise_invites i WHERE i.exercise_id=e.id)
               OR EXISTS (SELECT 1 FROM exercise_invites i JOIN org_team_members o ON o.org_team_id=i.org_team_id
                           WHERE i.exercise_id=e.id AND o.user_id=$1))
        ORDER BY e.scheduled_for NULLS LAST, e.published_at DESC`,
      [req.user.id]
    );
    // Koordinator tim melihat status lamaran & kesiapan seluruh anggota timnya per latihan
    const coord = await one('SELECT org_team_id FROM org_team_members WHERE user_id=$1 AND is_coordinator', [req.user.id]);
    if (coord && rows.length) {
      const status = await many(
        `SELECT e.id AS exercise_id, u.id AS user_id, u.name, pr.name AS role_name, a.status AS application_status, m.role AS member_role, m.ready_at
           FROM org_team_members o
           JOIN users u ON u.id=o.user_id
           LEFT JOIN player_roles pr ON pr.id=o.player_role_id
           CROSS JOIN (SELECT unnest($2::int[]) AS id) e
           LEFT JOIN exercise_applications a ON a.exercise_id=e.id AND a.user_id=u.id
           LEFT JOIN exercise_members m ON m.exercise_id=e.id AND m.user_id=u.id
          WHERE o.org_team_id=$1
          ORDER BY pr.sort NULLS LAST, u.name`,
        [coord.org_team_id, rows.map((r) => r.id)]
      );
      rows.forEach((r) => {
        r.team_members = status.filter((x) => x.exercise_id === r.id);
      });
    }
    res.json(rows);
  })
);

// ---------- Fasilitator: publikasikan / tarik ----------
router.post(
  '/:id/publish',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    requireFacilitator(ctx);
    const publish = req.body.published === undefined ? true : bool(req.body.published);
    if (publish && ctx.ex.status === 'ended') bad('Latihan yang sudah berakhir tidak dapat dipublikasikan');
    const ex = await one(`UPDATE exercises SET published_at=${publish ? 'COALESCE(published_at, now())' : 'NULL'} WHERE id=$1 RETURNING id, published_at`, [exId]);
    await audit(req, publish ? 'publish' : 'unpublish', 'exercise', exId);
    emit.ex(exId, 'exercise:updated', { id: exId });
    res.json(ex);
  })
);

// ---------- Peserta: melamar / menarik lamaran ----------
router.post(
  '/:id/apply',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    await openExercise(exId);
    if (req.user.role === 'admin') bad('Admin tidak perlu melamar');
    const mine = await one('SELECT org_team_id, player_role_id FROM org_team_members WHERE user_id=$1', [req.user.id]);
    if (!mine) bad('Bergabunglah ke tim instansi terlebih dahulu (menu Tim saya)');
    if (!(await isInvited(exId, mine.org_team_id))) forbid('Instansi Anda tidak diundang ke latihan ini');
    if (await one('SELECT 1 FROM exercise_members WHERE exercise_id=$1 AND user_id=$2', [exId, req.user.id])) bad('Anda sudah menjadi peserta latihan ini');
    const prev = await one('SELECT status FROM exercise_applications WHERE exercise_id=$1 AND user_id=$2', [exId, req.user.id]);
    if (prev && prev.status === 'pending') bad('Lamaran Anda sedang menunggu persetujuan');
    const appId = await upsertApplication(exId, req.user.id, mine.org_team_id, mine.player_role_id, str(req.body.message, { max: 1000 }));
    const a = await one(`${APP_SQL} WHERE a.id=$1`, [appId]);
    await audit(req, 'apply', 'exercise', exId);
    emit.staff(exId, 'application:new', a);
    res.status(201).json(a);
  })
);

// Koordinator melamarkan seluruh anggota timnya sekaligus
router.post(
  '/:id/apply-team',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    await openExercise(exId);
    const coord = await one('SELECT org_team_id FROM org_team_members WHERE user_id=$1 AND is_coordinator', [req.user.id]);
    if (!coord) forbid('Hanya koordinator tim yang dapat melamarkan seluruh tim');
    if (!(await isInvited(exId, coord.org_team_id))) forbid('Instansi Anda tidak diundang ke latihan ini');
    const members = await many(
      `SELECT o.user_id, o.player_role_id FROM org_team_members o
        WHERE o.org_team_id=$1
          AND NOT EXISTS (SELECT 1 FROM exercise_members m WHERE m.exercise_id=$2 AND m.user_id=o.user_id)
          AND NOT EXISTS (SELECT 1 FROM exercise_applications a WHERE a.exercise_id=$2 AND a.user_id=o.user_id AND a.status='pending')`,
      [coord.org_team_id, exId]
    );
    const note = `Dilamarkan oleh koordinator ${req.user.name}`;
    for (const m of members) await upsertApplication(exId, m.user_id, coord.org_team_id, m.player_role_id, note);
    await audit(req, 'apply_team', 'exercise', exId, { count: members.length });
    if (members.length) emit.staff(exId, 'application:new', { team: true });
    members.forEach((m) => emit.user(m.user_id, 'application:updated', { exercise_id: exId, status: 'pending' }));
    res.status(201).json({ applied: members.length });
  })
);

// ---------- Fasilitator: undangan per instansi ----------
router.get(
  '/:id/invites',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    requireFacilitator(await exerciseContext(exId, req.user));
    res.json(
      await many(
        `SELECT t.id, t.name, t.color, (i.org_team_id IS NOT NULL) AS invited,
                (SELECT COUNT(*) FROM org_team_members o WHERE o.org_team_id=t.id)::int AS members
           FROM org_teams t LEFT JOIN exercise_invites i ON i.org_team_id=t.id AND i.exercise_id=$1
          ORDER BY t.name`,
        [exId]
      )
    );
  })
);
router.put(
  '/:id/invites',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    requireFacilitator(await exerciseContext(exId, req.user));
    const ids = (Array.isArray(req.body.org_team_ids) ? req.body.org_team_ids : []).map(optId).filter(Boolean);
    await tx(async (c) => {
      await c.query('DELETE FROM exercise_invites WHERE exercise_id=$1', [exId]);
      for (const t of [...new Set(ids)]) {
        await c.query('INSERT INTO exercise_invites(exercise_id, org_team_id) SELECT $1, id FROM org_teams WHERE id=$2', [exId, t]);
      }
    });
    await audit(req, 'set_invites', 'exercise', exId, { org_team_ids: ids });
    emit.ex(exId, 'exercise:updated', { id: exId });
    res.json({ ok: true, invited: ids.length });
  })
);

router.delete(
  '/:id/apply',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const a = await one(`DELETE FROM exercise_applications WHERE exercise_id=$1 AND user_id=$2 AND status='pending' RETURNING id`, [exId, req.user.id]);
    if (!a) bad('Tidak ada lamaran yang menunggu');
    emit.staff(exId, 'application:new', { id: a.id, withdrawn: true });
    res.json({ ok: true });
  })
);

// ---------- Fasilitator: daftar & tinjau lamaran ----------
router.get(
  '/:id/applications',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!ctx.isStaff) forbid();
    const rows = await many(`${APP_SQL} WHERE a.exercise_id=$1 ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at`, [exId]);
    // peran latihan hasil pemetaan, sebagai usulan saat menerima
    const roles = await many('SELECT id, code, name FROM exercise_roles WHERE exercise_id=$1', [exId]);
    res.json(
      rows.map((a) => {
        const r = roles.find((x) => x.code && x.code === a.player_role_code) || roles.find((x) => x.name.toLowerCase() === (a.player_role_name || '').toLowerCase());
        return { ...a, suggested_role_id: r ? r.id : null };
      })
    );
  })
);

async function accept(c, app, roleOverride, reviewer) {
  if (!app.org_team_id) bad(`${app.user_name} tidak lagi tergabung di tim instansi`);
  const team = await ensureExerciseTeam(c, app.exercise_id, app.org_team_id);
  let roleId = roleOverride || (await mapExerciseRole(c, app.exercise_id, app.player_role_id));
  if (roleId) {
    const ok = (await c.query('SELECT 1 FROM exercise_roles WHERE id=$1 AND exercise_id=$2', [roleId, app.exercise_id])).rows[0];
    if (!ok) bad('Peran latihan tidak valid');
  } else roleId = null;
  await c.query(
    `INSERT INTO exercise_members(exercise_id, user_id, role, team_id, exercise_role_id) VALUES ($1,$2,'player',$3,$4)
     ON CONFLICT (exercise_id, user_id) DO UPDATE SET role='player', team_id=EXCLUDED.team_id, exercise_role_id=EXCLUDED.exercise_role_id, ready_at=NULL`,
    [app.exercise_id, app.user_id, team.id, roleId]
  );
  await c.query(`UPDATE exercise_applications SET status='accepted', reviewed_by=$1, reviewed_at=now() WHERE id=$2`, [reviewer.id, app.id]);
}

function notifyReviewed(app, status) {
  emit.user(app.user_id, 'application:updated', { exercise_id: app.exercise_id, status });
  if (status === 'accepted') emit.user(app.user_id, 'membership:changed', { exercise_id: app.exercise_id });
  emit.ex(app.exercise_id, 'exercise:updated', { id: app.exercise_id });
}

async function loadApp(req) {
  const app = await one(`${APP_SQL} WHERE a.id=$1`, [id(req.params.id)]);
  if (!app) notFound('Lamaran tidak ditemukan');
  const ctx = await exerciseContext(app.exercise_id, req.user);
  requireFacilitator(ctx);
  if (ctx.ex.status === 'ended') bad('Latihan sudah berakhir');
  return app;
}

misc.post(
  '/applications/:id/accept',
  ah(async (req, res) => {
    const app = await loadApp(req);
    if (app.status === 'accepted') bad('Lamaran sudah diterima');
    await tx((c) => accept(c, app, optId(req.body.exercise_role_id), req.user));
    await logEvent(app.exercise_id, 'application_accepted', { by: req.user.name, user: app.user_name, team: app.org_team_name }, req.user.id);
    await audit(req, 'accept_application', 'exercise', app.exercise_id, { user_id: app.user_id });
    notifyReviewed(app, 'accepted');
    res.json(await one(`${APP_SQL} WHERE a.id=$1`, [app.id]));
  })
);

misc.post(
  '/applications/:id/reject',
  ah(async (req, res) => {
    const app = await loadApp(req);
    if (app.status !== 'pending') bad('Hanya lamaran yang menunggu yang dapat ditolak');
    await one(`UPDATE exercise_applications SET status='rejected', review_note=$1, reviewed_by=$2, reviewed_at=now() WHERE id=$3 RETURNING id`, [
      str(req.body.note, { max: 1000 }),
      req.user.id,
      app.id,
    ]);
    await audit(req, 'reject_application', 'exercise', app.exercise_id, { user_id: app.user_id });
    notifyReviewed(app, 'rejected');
    res.json(await one(`${APP_SQL} WHERE a.id=$1`, [app.id]));
  })
);

// Terima semua lamaran yang menunggu sekaligus
router.post(
  '/:id/applications/accept-all',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    requireFacilitator(ctx);
    if (ctx.ex.status === 'ended') bad('Latihan sudah berakhir');
    const apps = await many(`${APP_SQL} WHERE a.exercise_id=$1 AND a.status='pending' AND a.org_team_id IS NOT NULL`, [exId]);
    await tx(async (c) => {
      for (const app of apps) await accept(c, app, null, req.user);
    });
    for (const app of apps) notifyReviewed(app, 'accepted');
    if (apps.length) await logEvent(exId, 'application_accepted', { by: req.user.name, count: apps.length }, req.user.id);
    await audit(req, 'accept_all_applications', 'exercise', exId, { count: apps.length });
    res.json({ accepted: apps.length });
  })
);

// ---------- Peserta: konfirmasi kesiapan ----------
router.post(
  '/:id/ready',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!ctx.isPlayer) forbid('Hanya peserta yang dapat menyatakan siap');
    if (ctx.ex.status !== 'draft') bad('Latihan sudah dimulai');
    const ready = req.body.ready === undefined ? true : bool(req.body.ready);
    if (ready && !bool(req.body.acknowledged)) bad('Selesaikan checklist briefing sebelum menyatakan siap');
    const m = await one(
      `UPDATE exercise_members SET ready_at=${ready ? 'now()' : 'NULL'} WHERE exercise_id=$1 AND user_id=$2 RETURNING ready_at`,
      [exId, req.user.id]
    );
    await logEvent(exId, ready ? 'participant_ready' : 'participant_not_ready', { by: req.user.name, team: ctx.member.team_name, role: ctx.member.role_name }, req.user.id);
    emit.ex(exId, 'exercise:updated', { id: exId });
    res.json(m);
  })
);

module.exports = { applicationRouter: router, applicationMisc: misc };
