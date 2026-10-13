const express = require('express');
const { one, many, query } = require('../db');
const { exerciseContext, audit } = require('../auth');
const { ah, id, str, oneOf, forbid, notFound } = require('../util');
const { simSeconds, fmtSim } = require('../simclock');
const { getSetting, setSetting } = require('../settings');
const { completeText } = require('../generator');

const router = express.Router(); // /api/exercises
const misc = express.Router(); // /api

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const round1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);
const mins = (sec) => (sec === null || sec === undefined ? null : round1(sec / 60));

async function requireReportAccess(req, exId) {
  const ctx = await exerciseContext(exId, req.user);
  if (!ctx.isStaff) forbid('Laporan hanya untuk fasilitator, evaluator, dan viewer');
  return ctx;
}

async function buildReport(exId) {
  const ex = await one(
    `SELECT e.*, s.title AS scenario_title, p.name AS preset_name FROM exercises e
       LEFT JOIN scenarios s ON s.id=e.scenario_id LEFT JOIN role_presets p ON p.id=e.preset_id WHERE e.id=$1`,
    [exId]
  );
  if (!ex) notFound();
  const [teams, roles, members, objectives, injects, responses, decisions, statements, escalations, observations, scores, feedback, actions, messages] =
    await Promise.all([
      many('SELECT id, exercise_id, name, color FROM teams WHERE exercise_id=$1 ORDER BY id', [exId]),
      many('SELECT * FROM exercise_roles WHERE exercise_id=$1 ORDER BY sort, id', [exId]),
      many(`SELECT m.*, u.name FROM exercise_members m JOIN users u ON u.id=m.user_id WHERE m.exercise_id=$1`, [exId]),
      many('SELECT * FROM exercise_objectives WHERE exercise_id=$1 ORDER BY sort, id', [exId]),
      many('SELECT * FROM exercise_injects WHERE exercise_id=$1 ORDER BY offset_min, sort, id', [exId]),
      many(`SELECT r.*, u.name AS user_name FROM responses r LEFT JOIN users u ON u.id=r.user_id WHERE r.exercise_id=$1`, [exId]),
      many(`SELECT d.*, u.name AS user_name, a.name AS approver_name FROM decisions d LEFT JOIN users u ON u.id=d.user_id LEFT JOIN users a ON a.id=d.approved_by WHERE d.exercise_id=$1 ORDER BY d.id`, [exId]),
      many(`SELECT s.*, u.name AS user_name FROM statements s LEFT JOIN users u ON u.id=s.user_id WHERE s.exercise_id=$1 ORDER BY s.id`, [exId]),
      many(`SELECT e.*, u.name AS from_name FROM escalations e LEFT JOIN users u ON u.id=e.from_user_id WHERE e.exercise_id=$1 ORDER BY e.id`, [exId]),
      many(
        `SELECT o.*, u.name AS user_name, t.name AS team_name, i.title AS inject_title FROM observations o
           LEFT JOIN users u ON u.id=o.user_id LEFT JOIN teams t ON t.id=o.team_id LEFT JOIN exercise_injects i ON i.id=o.inject_id
          WHERE o.exercise_id=$1 ORDER BY o.sim_time_sec`,
        [exId]
      ),
      many(`SELECT s.*, u.name AS evaluator_name FROM scores s LEFT JOIN users u ON u.id=s.evaluator_id WHERE s.exercise_id=$1`, [exId]),
      many(`SELECT f.*, u.name AS user_name FROM feedback f LEFT JOIN users u ON u.id=f.user_id WHERE f.exercise_id=$1`, [exId]),
      many('SELECT * FROM action_items WHERE exercise_id=$1 ORDER BY due_date NULLS LAST, id', [exId]),
      many('SELECT team_id FROM messages WHERE exercise_id=$1', [exId]),
    ]);

  const teamName = (tid) => (teams.find((t) => t.id === tid) || {}).name || 'Tanpa tim';
  const roleName = (rid) => (roles.find((r) => r.id === rid) || {}).name || 'Semua peran';
  const memberRole = (uid) => (members.find((m) => m.user_id === uid) || {}).exercise_role_id || null;

  const sent = injects.filter((i) => i.status === 'sent');
  const injectRows = injects.map((i) => {
    const rs = responses.filter((r) => r.inject_id === i.id);
    const delays = rs.map((r) => Number(r.sim_time_sec) - Number(i.sim_sent_sec)).filter((x) => x >= 0);
    return {
      id: i.id,
      title: i.title,
      offset_min: i.offset_min,
      status: i.status,
      priority: i.priority,
      requires_response: i.requires_response,
      target: i.exercise_role_id ? roleName(i.exercise_role_id) : i.team_id ? teamName(i.team_id) : 'Semua peserta',
      sim_sent: i.sim_sent_sec !== null ? fmtSim(i.sim_sent_sec) : null,
      responses: rs.length,
      first_response_min: delays.length ? mins(Math.min(...delays)) : null,
      choices: rs.map((r) => r.choice).filter(Boolean),
      adhoc: i.adhoc,
    };
  });
  const requiringResponse = sent.filter((i) => i.requires_response);
  const answered = requiringResponse.filter((i) => responses.some((r) => r.inject_id === i.id));
  const allDelays = responses
    .map((r) => {
      const inj = injects.find((i) => i.id === r.inject_id);
      return inj && inj.sim_sent_sec !== null ? Number(r.sim_time_sec) - Number(inj.sim_sent_sec) : null;
    })
    .filter((x) => x !== null && x >= 0);

  const responseDelay = (r) => {
    const inj = injects.find((i) => i.id === r.inject_id);
    return inj && inj.sim_sent_sec !== null ? Number(r.sim_time_sec) - Number(inj.sim_sent_sec) : null;
  };

  const perTeam = teams.map((t) => {
    const rs = responses.filter((r) => r.team_id === t.id);
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      members: members.filter((m) => m.team_id === t.id).length,
      responses: rs.length,
      avg_response_min: mins(avg(rs.map(responseDelay).filter((x) => x !== null && x >= 0))),
      decisions: decisions.filter((d) => d.team_id === t.id).length,
      messages: messages.filter((m) => m.team_id === t.id).length,
    };
  });

  const perRole = roles.map((r) => {
    const rs = responses.filter((x) => x.exercise_role_id === r.id);
    const approvals = decisions.filter((d) => d.approved_by && d.status !== 'pending' && memberRole(d.approved_by) === r.id && d.user_id !== d.approved_by);
    const escIn = escalations.filter((e) => e.to_role_id === r.id);
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      can_approve: r.can_approve,
      can_statement: r.can_statement,
      can_escalate: r.can_escalate,
      members: members.filter((m) => m.exercise_role_id === r.id).length,
      injects_targeted: sent.filter((i) => i.exercise_role_id === r.id).length,
      responses: rs.length,
      avg_response_min: mins(avg(rs.map(responseDelay).filter((x) => x !== null && x >= 0))),
      decisions: decisions.filter((d) => d.exercise_role_id === r.id).length,
      approvals: approvals.length,
      avg_approval_min: mins(avg(approvals.map((d) => Number(d.sim_approved_sec) - Number(d.sim_time_sec)).filter((x) => x >= 0))),
      statements: statements.filter((s) => s.exercise_role_id === r.id).length,
      escalations_sent: escalations.filter((e) => e.from_role_id === r.id).length,
      escalations_received: escIn.length,
      avg_ack_min: mins(avg(escIn.filter((e) => e.sim_ack_sec !== null).map((e) => Number(e.sim_ack_sec) - Number(e.sim_time_sec)))),
    };
  });

  const objectiveRows = objectives.map((o) => {
    const ss = scores.filter((s) => s.objective_id === o.id);
    return {
      id: o.id,
      title: o.title,
      description: o.description,
      avg_score: round1(avg(ss.map((s) => s.score))),
      by_team: teams
        .map((t) => ({ team: t.name, avg: round1(avg(ss.filter((s) => s.team_id === t.id).map((s) => s.score))) }))
        .filter((x) => x.avg !== null),
      comments: ss.filter((s) => s.comment).map((s) => ({ by: s.evaluator_name, team: s.team_id ? teamName(s.team_id) : null, score: s.score, comment: s.comment })),
    };
  });

  // ---- Temuan otomatis ----
  const strengths = observations.filter((o) => o.category === 'kekuatan').map((o) => ({ text: o.body, source: 'observasi', by: o.user_name, team: o.team_name }));
  const improvements = observations.filter((o) => o.category === 'perbaikan').map((o) => ({ text: o.body, source: 'observasi', by: o.user_name, team: o.team_name }));
  const recommendations = [];

  const unanswered = requiringResponse.filter((i) => !responses.some((r) => r.inject_id === i.id));
  if (unanswered.length) {
    improvements.push({ text: `${unanswered.length} inject tidak dijawab: ${unanswered.map((i) => `"${i.title}"`).slice(0, 5).join(', ')}`, source: 'otomatis' });
    recommendations.push('Tetapkan penanggung jawab (PIC) yang jelas untuk setiap jenis informasi masuk agar tidak ada informasi yang terlewat.');
  }
  for (const r of perRole) {
    if (r.avg_response_min !== null && r.avg_response_min > 15)
      improvements.push({ text: `Rata-rata waktu respons peran ${r.name} ${r.avg_response_min} menit (di atas 15 menit).`, source: 'otomatis' });
    if (r.avg_approval_min !== null && r.avg_approval_min > 15) {
      improvements.push({ text: `Persetujuan keputusan oleh ${r.name} rata-rata ${r.avg_approval_min} menit.`, source: 'otomatis' });
      recommendations.push(`Buat jalur persetujuan darurat dan pendelegasian kewenangan tertulis untuk ${r.name}.`);
    }
    if (r.avg_ack_min !== null && r.avg_ack_min > 10)
      improvements.push({ text: `Eskalasi ke ${r.name} baru diterima rata-rata ${r.avg_ack_min} menit kemudian.`, source: 'otomatis' });
    if (r.injects_targeted > 0 && r.members === 0)
      improvements.push({ text: `Peran ${r.name} menerima ${r.injects_targeted} inject tetapi tidak memiliki peserta.`, source: 'otomatis' });
    if (r.avg_response_min !== null && r.avg_response_min <= 5 && r.responses >= 2)
      strengths.push({ text: `Peran ${r.name} merespons cepat (rata-rata ${r.avg_response_min} menit).`, source: 'otomatis' });
  }
  const pending = decisions.filter((d) => d.status === 'pending');
  if (pending.length) improvements.push({ text: `${pending.length} keputusan masih menunggu persetujuan saat latihan berakhir.`, source: 'otomatis' });
  const unacked = escalations.filter((e) => !e.acknowledged_at);
  if (unacked.length) improvements.push({ text: `${unacked.length} eskalasi tidak pernah ditindaklanjuti.`, source: 'otomatis' });
  const commsRole = roles.find((r) => r.can_statement);
  if (commsRole && statements.length === 0 && sent.length > 0) {
    improvements.push({ text: 'Tidak ada pernyataan publik yang diterbitkan selama latihan.', source: 'otomatis' });
    recommendations.push('Siapkan template holding statement dan siaran pers untuk skenario krisis utama.');
  }
  if (statements.length) {
    const first = Math.min(...statements.map((s) => Number(s.sim_time_sec)));
    strengths.push({ text: `Pernyataan publik pertama terbit pada ${fmtSim(first)}.`, source: 'otomatis' });
  }
  for (const o of objectiveRows) {
    if (o.avg_score !== null && o.avg_score < 3) {
      improvements.push({ text: `Objective "${o.title}" mendapat skor rata-rata ${o.avg_score}/5.`, source: 'otomatis' });
      recommendations.push(`Susun rencana peningkatan kapabilitas untuk objective "${o.title}", lalu uji ulang pada latihan berikutnya.`);
    }
    if (o.avg_score !== null && o.avg_score >= 4) strengths.push({ text: `Objective "${o.title}" tercapai baik (skor ${o.avg_score}/5).`, source: 'otomatis' });
  }
  if (answered.length && answered.length === requiringResponse.length && requiringResponse.length > 0)
    strengths.push({ text: 'Seluruh inject yang memerlukan respons telah dijawab.', source: 'otomatis' });
  if (!recommendations.length) recommendations.push('Pertahankan praktik yang berjalan baik dan jadwalkan latihan berikutnya dengan skenario yang lebih kompleks.');
  recommendations.push('Perbarui rencana tanggap insiden/BCP berdasarkan temuan latihan ini dan sosialisasikan ke seluruh peran.');

  const realDur = ex.started_at ? ((ex.ended_at ? new Date(ex.ended_at) : new Date()) - new Date(ex.started_at)) / 1000 : 0;

  return {
    exercise: {
      id: ex.id,
      title: ex.title,
      description: ex.description,
      status: ex.status,
      scenario_title: ex.scenario_title,
      preset_name: ex.preset_name,
      started_at: ex.started_at,
      ended_at: ex.ended_at,
      sim_duration: fmtSim(simSeconds(ex)),
      sim_duration_min: mins(simSeconds(ex)),
      real_duration_min: mins(realDur),
    },
    summary: {
      participants: members.filter((m) => m.role === 'player').length,
      facilitators: members.filter((m) => m.role === 'facilitator').length,
      evaluators: members.filter((m) => m.role === 'evaluator').length,
      teams: teams.length,
      roles: roles.length,
      injects_total: injects.length,
      injects_sent: sent.length,
      injects_skipped: injects.filter((i) => i.status === 'skipped').length,
      injects_adhoc: injects.filter((i) => i.adhoc).length,
      injects_requiring_response: requiringResponse.length,
      injects_answered: answered.length,
      response_rate: requiringResponse.length ? Math.round((answered.length / requiringResponse.length) * 100) : null,
      avg_response_min: mins(avg(allDelays)),
      responses: responses.length,
      decisions: decisions.length,
      decisions_approved: decisions.filter((d) => d.status === 'approved').length,
      decisions_rejected: decisions.filter((d) => d.status === 'rejected').length,
      decisions_pending: pending.length,
      statements: statements.length,
      escalations: escalations.length,
      messages: messages.length,
      observations: observations.length,
      avg_objective_score: round1(avg(scores.map((s) => s.score))),
      feedback_count: feedback.length,
      feedback_avg: round1(avg(feedback.map((f) => f.rating))),
      realism_avg: round1(avg(feedback.filter((f) => f.realism).map((f) => f.realism))),
    },
    injects: injectRows,
    teams: perTeam,
    roles: perRole,
    objectives: objectiveRows,
    strengths,
    improvements,
    recommendations: Array.from(new Set(recommendations)),
    observations: observations.map((o) => ({ ...o, sim: fmtSim(o.sim_time_sec) })),
    decisions: decisions.map((d) => ({
      ...d,
      sim: fmtSim(d.sim_time_sec),
      role_name: d.exercise_role_id ? roleName(d.exercise_role_id) : null,
      team_name: d.team_id ? teamName(d.team_id) : null,
    })),
    statements: statements.map((s) => ({ ...s, sim: fmtSim(s.sim_time_sec), role_name: s.exercise_role_id ? roleName(s.exercise_role_id) : null })),
    escalations: escalations.map((e) => ({
      ...e,
      sim: fmtSim(e.sim_time_sec),
      to_role_name: roleName(e.to_role_id),
      from_role_name: e.from_role_id ? roleName(e.from_role_id) : null,
    })),
    feedback,
    actions,
    narrative: (await getSetting(`aar:${exId}`)) || null,
    generated_at: new Date().toISOString(),
  };
}

router.get(
  '/:id/report',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    await requireReportAccess(req, exId);
    res.json(await buildReport(exId));
  })
);

// Narasi AAR (AI bila dikonfigurasi, selain itu disusun otomatis)
router.post(
  '/:id/report/narrative',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await requireReportAccess(req, exId);
    if (!(ctx.isFacilitator || ctx.isEvaluator)) forbid();
    const rep = await buildReport(exId);
    const s = rep.summary;
    let text = null;
    let engine = 'builtin';
    try {
      const prompt = `Anda adalah evaluator tabletop exercise. Tulis ringkasan eksekutif After-Action Report (4-6 paragraf, Bahasa Indonesia formal, tanpa markdown) berdasarkan data berikut:\n${JSON.stringify(
        {
          latihan: rep.exercise,
          ringkasan: s,
          peran: rep.roles,
          objective: rep.objectives.map((o) => ({ title: o.title, avg: o.avg_score })),
          kekuatan: rep.strengths.map((x) => x.text),
          perbaikan: rep.improvements.map((x) => x.text),
          rekomendasi: rep.recommendations,
        }
      )}`;
      const out = await completeText(prompt, req.body && req.body.engine);
      if (out.text) {
        text = out.text.trim();
        engine = out.engine;
      }
    } catch (e) {
      console.warn('[aar] AI gagal:', e.message);
    }
    if (!text) {
      text = [
        `Latihan "${rep.exercise.title}" berlangsung selama ${rep.exercise.sim_duration_min ?? 0} menit waktu simulasi dengan ${s.participants} peserta dalam ${s.teams} tim dan ${s.roles} peran.`,
        `Sebanyak ${s.injects_sent} dari ${s.injects_total} inject dikirim. ${s.response_rate !== null ? `Tingkat respons mencapai ${s.response_rate}%` : 'Belum ada inject yang memerlukan respons'}${s.avg_response_min !== null ? ` dengan rata-rata waktu respons ${s.avg_response_min} menit` : ''}. Peserta mencatat ${s.decisions} keputusan (${s.decisions_approved} disetujui, ${s.decisions_pending} menunggu), menerbitkan ${s.statements} pernyataan publik, dan mengirim ${s.escalations} eskalasi.`,
        s.avg_objective_score !== null ? `Skor rata-rata pencapaian objective adalah ${s.avg_objective_score} dari 5.` : 'Objective latihan belum dinilai oleh evaluator.',
        rep.strengths.length ? `Kekuatan utama: ${rep.strengths.slice(0, 4).map((x) => x.text).join(' ')}` : '',
        rep.improvements.length ? `Area yang perlu diperbaiki: ${rep.improvements.slice(0, 5).map((x) => x.text).join(' ')}` : '',
        `Rekomendasi: ${rep.recommendations.slice(0, 4).join(' ')}`,
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    const narrative = { text, engine, generated_at: new Date().toISOString(), by: req.user.name };
    await setSetting(`aar:${exId}`, narrative);
    await audit(req, 'generate_narrative', 'exercise', exId, { engine });
    res.json(narrative);
  })
);

router.put(
  '/:id/report/narrative',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await requireReportAccess(req, exId);
    if (!(ctx.isFacilitator || ctx.isEvaluator)) forbid();
    const narrative = { text: str(req.body.text, { max: 50000 }) || '', engine: 'manual', generated_at: new Date().toISOString(), by: req.user.name };
    await setSetting(`aar:${exId}`, narrative);
    res.json(narrative);
  })
);

// ---------- Timeline / replay ----------
router.get(
  '/:id/timeline',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    await requireReportAccess(req, exId);
    res.json(
      await many(
        `SELECT e.*, u.name AS user_name FROM events e LEFT JOIN users u ON u.id=e.user_id WHERE e.exercise_id=$1 ORDER BY e.sim_time_sec, e.id`,
        [exId]
      )
    );
  })
);

// ---------- Ekspor ----------
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows, cols) {
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))].join('\n');
}

router.get(
  '/:id/export.json',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    await requireReportAccess(req, exId);
    const rep = await buildReport(exId);
    const timeline = await many('SELECT * FROM events WHERE exercise_id=$1 ORDER BY id', [exId]);
    const responses = await many('SELECT * FROM responses WHERE exercise_id=$1 ORDER BY id', [exId]);
    const msgs = await many('SELECT * FROM messages WHERE exercise_id=$1 ORDER BY id', [exId]);
    await audit(req, 'export', 'exercise', exId, { format: 'json' });
    res.setHeader('Content-Disposition', `attachment; filename="latihan-${exId}.json"`);
    res.json({ format: 'ttx-command-center/exercise-export@1', report: rep, timeline, responses, messages: msgs });
  })
);

router.get(
  '/:id/export.csv',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    await requireReportAccess(req, exId);
    const type = oneOf(req.query.type, ['events', 'responses', 'decisions', 'observations'], 'events');
    let rows;
    let cols;
    if (type === 'events') {
      rows = (await many(`SELECT e.*, u.name AS user_name FROM events e LEFT JOIN users u ON u.id=e.user_id WHERE e.exercise_id=$1 ORDER BY e.sim_time_sec, e.id`, [exId])).map(
        (e) => ({ ...e, sim: fmtSim(e.sim_time_sec) })
      );
      cols = ['id', 'sim', 'created_at', 'type', 'user_name', 'payload'];
    } else if (type === 'responses') {
      rows = (
        await many(
          `SELECT r.*, i.title AS inject_title, u.name AS user_name, t.name AS team_name, er.name AS role_name
             FROM responses r JOIN exercise_injects i ON i.id=r.inject_id LEFT JOIN users u ON u.id=r.user_id
             LEFT JOIN teams t ON t.id=r.team_id LEFT JOIN exercise_roles er ON er.id=r.exercise_role_id
            WHERE r.exercise_id=$1 ORDER BY r.sim_time_sec`,
          [exId]
        )
      ).map((r) => ({ ...r, sim: fmtSim(r.sim_time_sec) }));
      cols = ['id', 'sim', 'inject_title', 'team_name', 'role_name', 'user_name', 'choice', 'content'];
    } else if (type === 'decisions') {
      rows = (
        await many(
          `SELECT d.*, u.name AS user_name, a.name AS approver_name, er.name AS role_name, t.name AS team_name FROM decisions d
             LEFT JOIN users u ON u.id=d.user_id LEFT JOIN users a ON a.id=d.approved_by
             LEFT JOIN exercise_roles er ON er.id=d.exercise_role_id LEFT JOIN teams t ON t.id=d.team_id
            WHERE d.exercise_id=$1 ORDER BY d.sim_time_sec`,
          [exId]
        )
      ).map((d) => ({ ...d, sim: fmtSim(d.sim_time_sec) }));
      cols = ['id', 'sim', 'team_name', 'role_name', 'user_name', 'decision', 'owner', 'rationale', 'status', 'approver_name', 'approval_note'];
    } else {
      rows = (
        await many(
          `SELECT o.*, u.name AS user_name, t.name AS team_name FROM observations o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN teams t ON t.id=o.team_id
            WHERE o.exercise_id=$1 ORDER BY o.sim_time_sec`,
          [exId]
        )
      ).map((o) => ({ ...o, sim: fmtSim(o.sim_time_sec) }));
      cols = ['id', 'sim', 'category', 'team_name', 'user_name', 'body'];
    }
    await audit(req, 'export', 'exercise', exId, { format: 'csv', type });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="latihan-${exId}-${type}.csv"`);
    res.send(toCsv(rows, cols));
  })
);

// ---------- Rencana perbaikan ----------
router.get(
  '/:id/actions',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    await requireReportAccess(req, exId);
    res.json(await many('SELECT * FROM action_items WHERE exercise_id=$1 ORDER BY due_date NULLS LAST, id', [exId]));
  })
);

function actionFields(b) {
  return {
    title: str(b.title, { required: true, name: 'Judul', max: 500 }),
    owner: str(b.owner, { max: 200 }),
    due_date: b.due_date && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date) ? b.due_date : null,
    priority: oneOf(b.priority, ['rendah', 'sedang', 'tinggi'], 'sedang'),
    status: oneOf(b.status, ['open', 'in_progress', 'done'], 'open'),
  };
}

router.post(
  '/:id/actions',
  ah(async (req, res) => {
    const exId = id(req.params.id);
    const ctx = await requireReportAccess(req, exId);
    if (!(ctx.isFacilitator || ctx.isEvaluator)) forbid();
    const f = actionFields(req.body);
    const a = await one(
      'INSERT INTO action_items(exercise_id, title, owner, due_date, priority, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [exId, f.title, f.owner, f.due_date, f.priority, f.status]
    );
    res.status(201).json(a);
  })
);
misc.put(
  '/actions/:id',
  ah(async (req, res) => {
    const a0 = await one('SELECT * FROM action_items WHERE id=$1', [id(req.params.id)]);
    if (!a0) notFound();
    const ctx = await requireReportAccess(req, a0.exercise_id);
    if (!(ctx.isFacilitator || ctx.isEvaluator)) forbid();
    const f = actionFields({ ...a0, ...req.body });
    const a = await one('UPDATE action_items SET title=$1, owner=$2, due_date=$3, priority=$4, status=$5 WHERE id=$6 RETURNING *', [
      f.title, f.owner, f.due_date, f.priority, f.status, a0.id,
    ]);
    res.json(a);
  })
);
misc.delete(
  '/actions/:id',
  ah(async (req, res) => {
    const a0 = await one('SELECT * FROM action_items WHERE id=$1', [id(req.params.id)]);
    if (!a0) notFound();
    const ctx = await requireReportAccess(req, a0.exercise_id);
    if (!(ctx.isFacilitator || ctx.isEvaluator)) forbid();
    await query('DELETE FROM action_items WHERE id=$1', [a0.id]);
    res.json({ ok: true });
  })
);

module.exports = { reportRouter: router, reportMisc: misc, buildReport };
