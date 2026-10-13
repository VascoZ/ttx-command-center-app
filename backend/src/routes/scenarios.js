const router = require('express').Router();
const { one, many, query, tx } = require('../db');
const { canDesign, audit } = require('../auth');
const { ah, id, optId, str, oneOf, bool, notFound, bad } = require('../util');
const { saveScenario } = require('../services');
const { generate, options } = require('../generator');

const INJECT_TYPES = ['text', 'email', 'news', 'social', 'log', 'phone', 'memo'];
const PRIORITIES = ['normal', 'tinggi', 'kritis'];
const DIFFICULTIES = ['mudah', 'menengah', 'sulit'];

async function loadScenario(sid) {
  const s = await one(
    `SELECT s.*, p.name AS preset_name, u.name AS created_by_name
       FROM scenarios s LEFT JOIN role_presets p ON p.id=s.preset_id LEFT JOIN users u ON u.id=s.created_by
      WHERE s.id=$1`,
    [sid]
  );
  if (!s) notFound('Skenario tidak ditemukan');
  s.objectives = await many('SELECT * FROM scenario_objectives WHERE scenario_id=$1 ORDER BY sort, id', [sid]);
  s.injects = await many('SELECT * FROM scenario_injects WHERE scenario_id=$1 ORDER BY offset_min, sort, id', [sid]);
  return s;
}

function scenarioFields(b) {
  return {
    title: str(b.title, { required: true, name: 'Judul', max: 300 }),
    category: oneOf(b.category, ['siber', 'bencana', 'operasional', 'reputasi', 'lainnya'], 'siber'),
    threat_type: str(b.threat_type, { max: 60 }),
    industry: str(b.industry, { max: 60 }),
    difficulty: oneOf(b.difficulty, DIFFICULTIES, 'menengah'),
    duration_min: Math.max(10, Math.min(1440, parseInt(b.duration_min, 10) || 120)),
    summary: str(b.summary, { max: 5000 }) || '',
    narrative: str(b.narrative, { max: 20000 }) || '',
    teams: Array.isArray(b.teams) ? b.teams.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [],
    preset_id: optId(b.preset_id),
  };
}

function injectFields(b) {
  return {
    offset_min: Math.max(0, parseInt(b.offset_min, 10) || 0),
    title: str(b.title, { required: true, name: 'Judul inject', max: 300 }),
    type: oneOf(b.type, INJECT_TYPES, 'text'),
    target_team: str(b.target_team, { max: 120 }) || null,
    target_role: str(b.target_role, { max: 40 }) || null,
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
  '/',
  ah(async (req, res) => {
    const rows = await many(
      `SELECT s.id, s.title, s.category, s.threat_type, s.industry, s.difficulty, s.duration_min, s.summary, s.source, s.teams,
              s.preset_id, p.name AS preset_name, s.created_at, s.updated_at,
              (SELECT COUNT(*) FROM scenario_injects i WHERE i.scenario_id=s.id)::int AS inject_count,
              (SELECT COUNT(*) FROM scenario_objectives o WHERE o.scenario_id=s.id)::int AS objective_count,
              (SELECT COUNT(*) FROM exercises e WHERE e.scenario_id=s.id)::int AS exercise_count
         FROM scenarios s LEFT JOIN role_presets p ON p.id=s.preset_id
        ORDER BY s.source='template', s.updated_at DESC`
    );
    res.json(rows);
  })
);

router.post(
  '/',
  canDesign,
  ah(async (req, res) => {
    const f = scenarioFields(req.body);
    const s = await tx((c) => saveScenario(c, { ...f, objectives: req.body.objectives, injects: req.body.injects }, req.user.id, 'manual'));
    await audit(req, 'create', 'scenario', s.id, { title: s.title });
    res.status(201).json(await loadScenario(s.id));
  })
);

router.post(
  '/import',
  canDesign,
  ah(async (req, res) => {
    const data = req.body && req.body.scenario ? req.body.scenario : req.body;
    if (!data || !data.title) bad('Format impor tidak valid: field "title" wajib ada');
    const s = await tx((c) => saveScenario(c, data, req.user.id, 'import'));
    await audit(req, 'import', 'scenario', s.id, { title: s.title });
    res.status(201).json(await loadScenario(s.id));
  })
);

router.get('/:id', ah(async (req, res) => res.json(await loadScenario(id(req.params.id)))));

router.put(
  '/:id',
  canDesign,
  ah(async (req, res) => {
    const sid = id(req.params.id);
    const f = scenarioFields(req.body);
    const s = await one(
      `UPDATE scenarios SET title=$1, category=$2, threat_type=$3, industry=$4, difficulty=$5, duration_min=$6, summary=$7,
              narrative=$8, teams=$9, preset_id=$10, updated_at=now() WHERE id=$11 RETURNING id`,
      [f.title, f.category, f.threat_type, f.industry, f.difficulty, f.duration_min, f.summary, f.narrative, f.teams, f.preset_id, sid]
    );
    if (!s) notFound('Skenario tidak ditemukan');
    await audit(req, 'update', 'scenario', sid);
    res.json(await loadScenario(sid));
  })
);

router.delete(
  '/:id',
  canDesign,
  ah(async (req, res) => {
    const sid = id(req.params.id);
    await query('DELETE FROM scenarios WHERE id=$1', [sid]);
    await audit(req, 'delete', 'scenario', sid);
    res.json({ ok: true });
  })
);

function exportShape(s) {
  return {
    format: 'ttx-command-center/scenario@1',
    title: s.title,
    category: s.category,
    threat_type: s.threat_type,
    industry: s.industry,
    difficulty: s.difficulty,
    duration_min: s.duration_min,
    summary: s.summary,
    narrative: s.narrative,
    teams: s.teams,
    preset_name: s.preset_name,
    objectives: s.objectives.map((o) => ({ title: o.title, description: o.description })),
    injects: s.injects.map((i) => ({
      offset_min: i.offset_min,
      title: i.title,
      type: i.type,
      target_team: i.target_team,
      target_role: i.target_role,
      sender: i.sender,
      content: i.content,
      question: i.question,
      options: i.options,
      attachments: i.attachments,
      requires_response: i.requires_response,
      priority: i.priority,
    })),
  };
}

router.get(
  '/:id/export',
  ah(async (req, res) => {
    const s = await loadScenario(id(req.params.id));
    res.setHeader('Content-Disposition', `attachment; filename="skenario-${s.id}.json"`);
    res.json(exportShape(s));
  })
);

router.post(
  '/:id/duplicate',
  canDesign,
  ah(async (req, res) => {
    const s = await loadScenario(id(req.params.id));
    const data = exportShape(s);
    data.title = `${s.title} (salinan)`;
    data.preset_id = s.preset_id;
    const copy = await tx((c) => saveScenario(c, data, req.user.id, 'manual'));
    await audit(req, 'duplicate', 'scenario', copy.id, { from: s.id });
    res.status(201).json(await loadScenario(copy.id));
  })
);

// Objective
router.post(
  '/:id/objectives',
  canDesign,
  ah(async (req, res) => {
    const sid = id(req.params.id);
    const m = await one('SELECT COALESCE(MAX(sort),-1)+1 AS s FROM scenario_objectives WHERE scenario_id=$1', [sid]);
    const o = await one(
      'INSERT INTO scenario_objectives(scenario_id, title, description, sort) VALUES ($1,$2,$3,$4) RETURNING *',
      [sid, str(req.body.title, { required: true, name: 'Judul objective', max: 300 }), str(req.body.description, { max: 3000 }), m.s]
    );
    await query('UPDATE scenarios SET updated_at=now() WHERE id=$1', [sid]);
    res.status(201).json(o);
  })
);

// Inject
router.post(
  '/:id/injects',
  canDesign,
  ah(async (req, res) => {
    const sid = id(req.params.id);
    const f = injectFields(req.body);
    const inj = await one(
      `INSERT INTO scenario_injects(scenario_id, offset_min, title, type, target_team, target_role, sender, content, question, options, attachments, requires_response, priority, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [sid, f.offset_min, f.title, f.type, f.target_team, f.target_role, f.sender, f.content, f.question, f.options, f.attachments, f.requires_response, f.priority, 0]
    );
    await query('UPDATE scenarios SET updated_at=now() WHERE id=$1', [sid]);
    res.status(201).json(inj);
  })
);

const objRouter = require('express').Router();
objRouter.put(
  '/:id',
  canDesign,
  ah(async (req, res) => {
    const o = await one('UPDATE scenario_objectives SET title=$1, description=$2 WHERE id=$3 RETURNING *', [
      str(req.body.title, { required: true, name: 'Judul objective', max: 300 }),
      str(req.body.description, { max: 3000 }),
      id(req.params.id),
    ]);
    if (!o) notFound();
    res.json(o);
  })
);
objRouter.delete(
  '/:id',
  canDesign,
  ah(async (req, res) => {
    await query('DELETE FROM scenario_objectives WHERE id=$1', [id(req.params.id)]);
    res.json({ ok: true });
  })
);

const injRouter = require('express').Router();
injRouter.put(
  '/:id',
  canDesign,
  ah(async (req, res) => {
    const f = injectFields(req.body);
    const inj = await one(
      `UPDATE scenario_injects SET offset_min=$1, title=$2, type=$3, target_team=$4, target_role=$5, sender=$6, content=$7,
              question=$8, options=$9, attachments=$10, requires_response=$11, priority=$12 WHERE id=$13 RETURNING *`,
      [f.offset_min, f.title, f.type, f.target_team, f.target_role, f.sender, f.content, f.question, f.options, f.attachments, f.requires_response, f.priority, id(req.params.id)]
    );
    if (!inj) notFound();
    await query('UPDATE scenarios SET updated_at=now() WHERE id=$1', [inj.scenario_id]);
    res.json(inj);
  })
);
injRouter.delete(
  '/:id',
  canDesign,
  ah(async (req, res) => {
    await query('DELETE FROM scenario_injects WHERE id=$1', [id(req.params.id)]);
    res.json({ ok: true });
  })
);

// Generator
const genRouter = require('express').Router();
genRouter.get('/options', (req, res) => res.json(options()));
genRouter.post(
  '/generate',
  canDesign,
  ah(async (req, res) => {
    const p = {
      threat: str(req.body.threat, { max: 40 }) || 'ransomware',
      industry: str(req.body.industry, { max: 40 }) || 'pemerintah',
      organization: str(req.body.organization, { max: 200 }),
      difficulty: oneOf(req.body.difficulty, DIFFICULTIES, 'menengah'),
      duration_min: parseInt(req.body.duration_min, 10) || 120,
      engine: oneOf(req.body.engine, ['default', 'builtin', 'anthropic', 'ollama'], 'default'),
      notes: str(req.body.notes, { max: 2000 }),
    };
    const preset = optId(req.body.preset_id) ? await one('SELECT name FROM role_presets WHERE id=$1', [optId(req.body.preset_id)]) : null;
    if (preset) p.preset_name = preset.name;
    const out = await generate(p);
    await audit(req, 'generate', 'scenario', null, { threat: p.threat, engine: out.engine });
    res.json(out);
  })
);
genRouter.post(
  '/save',
  canDesign,
  ah(async (req, res) => {
    const data = req.body;
    if (!data || !data.title) bad('Data skenario tidak valid');
    const s = await tx((c) => saveScenario(c, data, req.user.id, 'generator'));
    await audit(req, 'create', 'scenario', s.id, { title: s.title, source: 'generator' });
    res.status(201).json(await loadScenario(s.id));
  })
);

module.exports = { scenarioRouter: router, objRouter, injRouter, genRouter };
