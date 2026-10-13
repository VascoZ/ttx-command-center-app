const { INDUSTRIES, THREATS, COMPLICATIONS, CAST_DEFAULT } = require('./library');
const { getSetting } = require('../settings');

const DIFFICULTY_LEVEL = { mudah: 1, menengah: 2, sulit: 3 };

function fill(text, ctx) {
  if (typeof text !== 'string') return text;
  return text.replace(/\{([a-z_]+)\}/g, (m, k) => (ctx[k] !== undefined ? ctx[k] : m));
}

const TLD = { pemerintah: 'go.id', kesehatan: 'go.id', pendidikan: 'ac.id' };
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30) || 'organisasi';
}

/**
 * Konteks placeholder: data sektor + pemeran fiktif. Bila fasilitator memakai nama organisasi sendiri,
 * nama singkat, domain, dan email palsu diturunkan dari nama tersebut.
 */
function buildContext(p, ind, industryKey) {
  const custom = p.organization && p.organization.trim() && p.organization.trim() !== ind.org;
  const org = custom ? p.organization.trim() : ind.org;
  const cast = { ...CAST_DEFAULT, ...(ind.cast || {}) };
  if (custom) {
    const domain = `${slug(org)}.${TLD[industryKey] || 'co.id'}`;
    cast.short = org;
    cast.domain = domain;
    cast.fake_email = `pimpinan@${domain.replace(/\./g, '-')}.com`;
    cast.social = `@${slug(org).slice(0, 20)}_info`;
  }
  // nama unit/jabatan yang memuat {short} mengikuti nama organisasi yang dipakai
  for (const k of Object.keys(cast)) cast[k] = fill(cast[k], { short: cast.short, org });
  return { ...cast, org, service: ind.service, system: ind.system, data: ind.data, regulator: ind.regulator, people: ind.people };
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function options() {
  return {
    threats: Object.entries(THREATS).map(([key, t]) => ({ key, label: t.label, category: t.category })),
    industries: Object.entries(INDUSTRIES).map(([key, i]) => ({ key, label: i.label, preset: i.preset, org: i.org })),
    difficulties: Object.keys(DIFFICULTY_LEVEL),
  };
}

/** Generator bawaan berbasis aturan (tanpa internet). */
function generateBuiltin(p) {
  const threat = THREATS[p.threat] || THREATS.ransomware;
  const ind = INDUSTRIES[p.industry] || INDUSTRIES.pemerintah;
  const level = DIFFICULTY_LEVEL[p.difficulty] || 2;
  const duration = Math.max(30, Math.min(600, parseInt(p.duration_min, 10) || 120));
  const ctx = buildContext(p, ind, p.industry in INDUSTRIES ? p.industry : 'pemerintah');

  let injects = threat.injects
    .filter((i) => (i.minLevel || 1) <= level)
    .map((i) => ({ ...i }));

  const extraCount = level === 3 ? 3 : level === 2 ? 1 : 0;
  const pool = shuffle(COMPLICATIONS.filter((c) => c.categories.includes(threat.category)));
  const extras = pool.slice(0, extraCount);
  extras.forEach((c, idx) => {
    // sisipkan di antara 30%-85% durasi
    const at = 0.3 + ((idx + 1) / (extraCount + 1)) * 0.55;
    injects.push({ ...c, at, team: 0, complication: true });
  });

  injects.sort((a, b) => a.at - b.at);

  const teams = threat.teams.slice();
  const out = {
    title: fill(threat.title, ctx),
    category: threat.category,
    threat_type: p.threat in THREATS ? p.threat : 'ransomware',
    industry: p.industry in INDUSTRIES ? p.industry : 'pemerintah',
    difficulty: Object.keys(DIFFICULTY_LEVEL).find((k) => DIFFICULTY_LEVEL[k] === level),
    duration_min: duration,
    summary: fill(threat.summary, ctx),
    narrative: fill(threat.narrative, ctx),
    teams,
    preset_name: p.preset_name || ind.preset,
    objectives: threat.objectives.map(([title, description]) => ({
      title: fill(title, ctx),
      description: fill(description, ctx),
    })),
    injects: injects.map((i, idx) => ({
      offset_min: Math.round(i.at * duration * (i.at >= 0.95 ? 0.97 : 1)),
      title: capitalize(fill(i.title, ctx)),
      type: i.type || 'text',
      target_team: teams[i.team ?? 0] || null,
      target_role: i.role || null,
      sender: fill(i.sender, ctx),
      content: fill(i.content, ctx),
      question: fill(i.question, ctx),
      options: (i.options || []).map((o) => fill(o, ctx)),
      requires_response: true,
      priority: i.priority || 'normal',
      sort: idx,
    })),
    engine: 'builtin',
  };
  return out;
}

const ROLE_CODES = 'leader, it_head, tech, comms, legal, audit, ops, disaster, risk, customer, medical, hr';

function buildPrompt(p, base) {
  return `Anda adalah perancang tabletop exercise (TTX) profesional di Indonesia.
Buat skenario TTX dalam Bahasa Indonesia dengan parameter:
- Jenis ancaman: ${THREATS[p.threat]?.label || p.threat}
- Sektor: ${INDUSTRIES[p.industry]?.label || p.industry}
- Nama organisasi: ${p.organization || INDUSTRIES[p.industry]?.org}
- Tingkat kesulitan: ${p.difficulty}
- Durasi simulasi: ${p.duration_min} menit
- Tim: ${base.teams.join(', ')}
- Kode peran yang tersedia: ${ROLE_CODES}
${p.notes ? `- Catatan tambahan dari fasilitator: ${p.notes}` : ''}

Kembalikan HANYA JSON valid (tanpa markdown) dengan bentuk:
{"title":string,"summary":string,"narrative":string,
 "objectives":[{"title":string,"description":string}],
 "injects":[{"offset_min":int,"title":string,"type":"text|email|news|social|log|phone|memo","target_team":string (salah satu nama tim),"target_role":string (salah satu kode peran),"sender":string,"content":string,"question":string,"options":[string],"priority":"normal|tinggi|kritis"}]}
Buat 5 objective dan ${p.difficulty === 'sulit' ? '12-14' : p.difficulty === 'mudah' ? '6-8' : '9-11'} inject berurutan dari menit 0 sampai mendekati ${p.duration_min}. Inject harus realistis, merujuk regulasi Indonesia bila relevan (UU PDP, BSSN, OJK, dsb.), melibatkan peran yang berbeda-beda, dan semakin kompleks seiring waktu.
Gunakan HANYA nama fiktif untuk orang, perusahaan, vendor, media, akun media sosial, domain, dan kelompok peretas (contoh gaya: ${base.injects.slice(0, 3).map((i) => i.sender).filter(Boolean).join('; ')}). Jangan memakai nama orang, perusahaan, atau media yang nyata. Nama regulator/lembaga negara boleh nama aslinya.`;
}

function extractJson(text) {
  if (!text) throw new Error('Respons kosong');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('JSON tidak ditemukan');
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeAi(json, base) {
  const teams = base.teams;
  const injects = (json.injects || [])
    .filter((i) => i && i.title)
    .map((i, idx) => ({
      offset_min: Math.max(0, parseInt(i.offset_min, 10) || 0),
      title: String(i.title).slice(0, 200),
      type: ['text', 'email', 'news', 'social', 'log', 'phone', 'memo'].includes(i.type) ? i.type : 'text',
      target_team: teams.includes(i.target_team) ? i.target_team : null,
      target_role: i.target_role || null,
      sender: i.sender || null,
      content: i.content || '',
      question: i.question || '',
      options: Array.isArray(i.options) ? i.options.map(String).slice(0, 6) : [],
      requires_response: true,
      priority: ['normal', 'tinggi', 'kritis'].includes(i.priority) ? i.priority : 'normal',
      sort: idx,
    }))
    .sort((a, b) => a.offset_min - b.offset_min);
  if (injects.length < 3) throw new Error('Inject dari AI terlalu sedikit');
  return {
    ...base,
    title: json.title || base.title,
    summary: json.summary || base.summary,
    narrative: json.narrative || base.narrative,
    objectives:
      Array.isArray(json.objectives) && json.objectives.length
        ? json.objectives.map((o) => ({ title: String(o.title || ''), description: String(o.description || '') }))
        : base.objectives,
    injects,
  };
}

async function callAnthropic(prompt, cfg) {
  const key = cfg.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY belum diatur');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.anthropic_model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content || []).map((c) => c.text || '').join('');
}

async function callOllama(prompt, cfg) {
  const url = (cfg.ollama_url || process.env.OLLAMA_URL || 'http://ollama:11434').replace(/\/$/, '');
  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.ollama_model || process.env.OLLAMA_MODEL || 'llama3.1',
      prompt,
      stream: false,
      format: 'json',
    }),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.response;
}

async function aiConfig() {
  const s = (await getSetting('ai')) || {};
  return {
    provider: s.provider || process.env.AI_PROVIDER || 'builtin',
    anthropic_api_key: s.anthropic_api_key || '',
    anthropic_model: s.anthropic_model || '',
    ollama_url: s.ollama_url || '',
    ollama_model: s.ollama_model || '',
  };
}

async function completeText(prompt, engineOverride) {
  const cfg = await aiConfig();
  const engine = engineOverride && engineOverride !== 'default' ? engineOverride : cfg.provider;
  if (engine === 'anthropic') return { engine, text: await callAnthropic(prompt, cfg) };
  if (engine === 'ollama') return { engine, text: await callOllama(prompt, cfg) };
  return { engine: 'builtin', text: null };
}

/** Generate skenario; mesin AI dengan fallback otomatis ke bawaan. */
async function generate(p) {
  const base = generateBuiltin(p);
  const cfg = await aiConfig();
  const engine = p.engine && p.engine !== 'default' ? p.engine : cfg.provider;
  if (engine === 'builtin') return base;
  try {
    const prompt = buildPrompt(p, base);
    const text = engine === 'anthropic' ? await callAnthropic(prompt, cfg) : await callOllama(prompt, cfg);
    const out = normalizeAi(extractJson(text), base);
    out.engine = engine;
    return out;
  } catch (e) {
    console.warn('[generator] AI gagal, memakai mesin bawaan:', e.message);
    return { ...base, engine: 'builtin', fallback_reason: e.message };
  }
}

module.exports = { generate, generateBuiltin, options, completeText, aiConfig, extractJson };
