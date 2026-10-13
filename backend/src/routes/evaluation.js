const express = require('express');
const { one, many, query } = require('../db');
const { exerciseContext } = require('../auth');
const { ah, id, optId, str, oneOf, forbid, notFound, bad } = require('../util');
const { simSeconds } = require('../simclock');
const { emit, logEvent } = require('../realtime');

const router = express.Router(); // /api/exercises
const misc = express.Router(); // /api

function canEvaluate(ctx) {
  return ctx.isFacilitator || ctx.isEvaluator;
}

const OBS_SQL = `
  SELECT o.*, u.name AS user_name, t.name AS team_name, i.title AS inject_title, ob.title AS objective_title, r.name AS role_name
    FROM observations o
    LEFT JOIN users u ON u.id=o.user_id
    LEFT JOIN teams t ON t.id=o.team_id
    LEFT JOIN exercise_injects i ON i.id=o.inject_id
    LEFT JOIN exercise_objectives ob ON ob.id=o.objective_id
    LEFT JOIN exercise_roles r ON r.id=o.exercise_role_id`;

router.get(
  '/:id/observations',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!ctx.isStaff) forbid();
    res.json(await many(`${OBS_SQL} WHERE o.exercise_id=$1 ORDER BY o.id DESC`, [exId]));
  })
);

router.post(
  '/:id/observations',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!canEvaluate(ctx)) forbid('Hanya evaluator atau fasilitator yang dapat mencatat observasi');
    const sim = simSeconds(ctx.ex);
    const o0 = await one(
      `INSERT INTO observations(exercise_id, user_id, team_id, inject_id, objective_id, exercise_role_id, category, body, sim_time_sec)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        exId, req.user.id, optId(req.body.team_id), optId(req.body.inject_id), optId(req.body.objective_id), optId(req.body.exercise_role_id),
        oneOf(req.body.category, ['kekuatan', 'perbaikan', 'netral'], 'netral'),
        str(req.body.body, { required: true, name: 'Catatan', max: 5000 }),
        sim,
      ]
    );
    const o = await one(`${OBS_SQL} WHERE o.id=$1`, [o0.id]);
    emit.staff(exId, 'observation:new', o);
    await logEvent(exId, 'observation', { observation_id: o.id, category: o.category, body: o.body, by: req.user.name }, req.user.id, sim);
    res.status(201).json(o);
  })
);

misc.delete(
  '/observations/:id',
  ah(async (req, res) => {
    const o = await one('SELECT * FROM observations WHERE id=$1', [id(req.params.id)]);
    if (!o) notFound();
    const ctx = await exerciseContext(o.exercise_id, req.user);
    if (!(ctx.isFacilitator || o.user_id === req.user.id)) forbid();
    await query('DELETE FROM observations WHERE id=$1', [o.id]);
    emit.staff(o.exercise_id, 'observation:deleted', { id: o.id });
    res.json({ ok: true });
  })
);

// ---------- Skor ----------
router.get(
  '/:id/scores',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!ctx.isStaff) forbid();
    res.json(
      await many(
        `SELECT s.*, u.name AS evaluator_name FROM scores s LEFT JOIN users u ON u.id=s.evaluator_id WHERE s.exercise_id=$1 ORDER BY s.objective_id, s.team_id`,
        [exId]
      )
    );
  })
);

router.post(
  '/:id/scores',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!canEvaluate(ctx)) forbid('Hanya evaluator atau fasilitator yang dapat memberi skor');
    const objectiveId = id(req.body.objective_id, 'Objective');
    if (!(await one('SELECT id FROM exercise_objectives WHERE id=$1 AND exercise_id=$2', [objectiveId, exId]))) bad('Objective tidak valid');
    const teamId = optId(req.body.team_id);
    const score = parseInt(req.body.score, 10);
    if (!(score >= 1 && score <= 5)) bad('Skor harus 1 sampai 5');
    const comment = str(req.body.comment, { max: 3000 });
    const existing = await one(
      'SELECT id FROM scores WHERE objective_id=$1 AND COALESCE(team_id,0)=COALESCE($2::int,0) AND evaluator_id=$3',
      [objectiveId, teamId, req.user.id]
    );
    const s = existing
      ? await one('UPDATE scores SET score=$1, comment=$2, updated_at=now() WHERE id=$3 RETURNING *', [score, comment, existing.id])
      : await one(
          'INSERT INTO scores(exercise_id, objective_id, team_id, evaluator_id, score, comment) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
          [exId, objectiveId, teamId, req.user.id, score, comment]
        );
    emit.staff(exId, 'score:updated', { ...s, evaluator_name: req.user.name });
    res.json(s);
  })
);

// ---------- Umpan balik peserta ----------
router.get(
  '/:id/feedback',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (ctx.isStaff) {
      return res.json(
        await many(
          `SELECT f.*, u.name AS user_name FROM feedback f LEFT JOIN users u ON u.id=f.user_id WHERE f.exercise_id=$1 ORDER BY f.created_at DESC`,
          [exId]
        )
      );
    }
    res.json(await many('SELECT * FROM feedback WHERE exercise_id=$1 AND user_id=$2', [exId, req.user.id]));
  })
);

router.post(
  '/:id/feedback',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await exerciseContext(exId, req.user);
    if (!ctx.member) forbid('Hanya peserta latihan yang dapat memberi umpan balik');
    const rating = parseInt(req.body.rating, 10);
    if (!(rating >= 1 && rating <= 5)) bad('Rating harus 1 sampai 5');
    const realism = parseInt(req.body.realism, 10);
    const f = await one(
      `INSERT INTO feedback(exercise_id, user_id, rating, realism, comments) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (exercise_id, user_id) DO UPDATE SET rating=EXCLUDED.rating, realism=EXCLUDED.realism, comments=EXCLUDED.comments
       RETURNING *`,
      [exId, req.user.id, rating, realism >= 1 && realism <= 5 ? realism : null, str(req.body.comments, { max: 5000 })]
    );
    emit.staff(exId, 'feedback:new', { ...f, user_name: req.user.name });
    res.json(f);
  })
);

module.exports = { evaluationRouter: router, evaluationMisc: misc };
