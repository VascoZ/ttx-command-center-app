const { query, one, tx } = require('./db');

const MIGRATIONS = [
  {
    name: '001_init',
    sql: `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player'
    CHECK (role IN ('admin','designer','facilitator','player','evaluator','viewer')),
  organization TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_presets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT,
  description TEXT,
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_roles (
  id SERIAL PRIMARY KEY,
  preset_id INT NOT NULL REFERENCES role_presets(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#4C9AFF',
  can_approve BOOLEAN NOT NULL DEFAULT FALSE,
  can_statement BOOLEAN NOT NULL DEFAULT FALSE,
  can_escalate BOOLEAN NOT NULL DEFAULT FALSE,
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scenarios (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'siber',
  threat_type TEXT,
  industry TEXT,
  difficulty TEXT NOT NULL DEFAULT 'menengah',
  duration_min INT NOT NULL DEFAULT 120,
  summary TEXT,
  narrative TEXT,
  teams TEXT[] NOT NULL DEFAULT '{}',
  preset_id INT REFERENCES role_presets(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenario_objectives (
  id SERIAL PRIMARY KEY,
  scenario_id INT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scenario_injects (
  id SERIAL PRIMARY KEY,
  scenario_id INT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  offset_min INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  target_team TEXT,
  target_role TEXT,
  sender TEXT,
  content TEXT,
  question TEXT,
  options JSONB NOT NULL DEFAULT '[]',
  attachments JSONB NOT NULL DEFAULT '[]',
  requires_response BOOLEAN NOT NULL DEFAULT TRUE,
  priority TEXT NOT NULL DEFAULT 'normal',
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exercises (
  id SERIAL PRIMARY KEY,
  scenario_id INT REFERENCES scenarios(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  narrative TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','ended')),
  speed NUMERIC NOT NULL DEFAULT 1,
  sim_elapsed_sec NUMERIC NOT NULL DEFAULT 0,
  resumed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_min INT NOT NULL DEFAULT 120,
  preset_id INT REFERENCES role_presets(id) ON DELETE SET NULL,
  scheduled_for TIMESTAMPTZ,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4C9AFF'
);

CREATE TABLE IF NOT EXISTS exercise_roles (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  code TEXT,
  name TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#4C9AFF',
  can_approve BOOLEAN NOT NULL DEFAULT FALSE,
  can_statement BOOLEAN NOT NULL DEFAULT FALSE,
  can_escalate BOOLEAN NOT NULL DEFAULT FALSE,
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exercise_members (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('facilitator','player','evaluator','viewer')),
  team_id INT REFERENCES teams(id) ON DELETE SET NULL,
  exercise_role_id INT REFERENCES exercise_roles(id) ON DELETE SET NULL,
  UNIQUE (exercise_id, user_id)
);

CREATE TABLE IF NOT EXISTS exercise_objectives (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exercise_injects (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  team_id INT REFERENCES teams(id) ON DELETE SET NULL,
  exercise_role_id INT REFERENCES exercise_roles(id) ON DELETE SET NULL,
  offset_min INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  sender TEXT,
  content TEXT,
  question TEXT,
  options JSONB NOT NULL DEFAULT '[]',
  attachments JSONB NOT NULL DEFAULT '[]',
  requires_response BOOLEAN NOT NULL DEFAULT TRUE,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','skipped')),
  sent_at TIMESTAMPTZ,
  sim_sent_sec NUMERIC,
  adhoc BOOLEAN NOT NULL DEFAULT FALSE,
  sort INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_exinj_ex ON exercise_injects(exercise_id, status);

CREATE TABLE IF NOT EXISTS responses (
  id SERIAL PRIMARY KEY,
  inject_id INT NOT NULL REFERENCES exercise_injects(id) ON DELETE CASCADE,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  team_id INT REFERENCES teams(id) ON DELETE SET NULL,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  exercise_role_id INT REFERENCES exercise_roles(id) ON DELETE SET NULL,
  content TEXT,
  choice TEXT,
  sim_time_sec NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resp_ex ON responses(exercise_id);

CREATE TABLE IF NOT EXISTS decisions (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  team_id INT REFERENCES teams(id) ON DELETE SET NULL,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  exercise_role_id INT REFERENCES exercise_roles(id) ON DELETE SET NULL,
  inject_id INT REFERENCES exercise_injects(id) ON DELETE SET NULL,
  decision TEXT NOT NULL,
  owner TEXT,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected')),
  approved_by INT REFERENCES users(id) ON DELETE SET NULL,
  approval_note TEXT,
  approved_at TIMESTAMPTZ,
  sim_time_sec NUMERIC,
  sim_approved_sec NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  team_id INT REFERENCES teams(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'chat',
  body TEXT NOT NULL,
  sim_time_sec NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msg_ex ON messages(exercise_id, team_id);

CREATE TABLE IF NOT EXISTS statements (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  exercise_role_id INT REFERENCES exercise_roles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'siaran_pers',
  sim_time_sec NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS escalations (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  from_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  from_role_id INT REFERENCES exercise_roles(id) ON DELETE SET NULL,
  to_role_id INT REFERENCES exercise_roles(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by INT REFERENCES users(id) ON DELETE SET NULL,
  sim_time_sec NUMERIC,
  sim_ack_sec NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS observations (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  team_id INT REFERENCES teams(id) ON DELETE SET NULL,
  inject_id INT REFERENCES exercise_injects(id) ON DELETE SET NULL,
  objective_id INT REFERENCES exercise_objectives(id) ON DELETE SET NULL,
  exercise_role_id INT REFERENCES exercise_roles(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'netral' CHECK (category IN ('kekuatan','perbaikan','netral')),
  body TEXT NOT NULL,
  sim_time_sec NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  objective_id INT NOT NULL REFERENCES exercise_objectives(id) ON DELETE CASCADE,
  team_id INT REFERENCES teams(id) ON DELETE CASCADE,
  evaluator_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scores ON scores(objective_id, COALESCE(team_id, 0), evaluator_id);

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  realism INT CHECK (realism BETWEEN 1 AND 5),
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exercise_id, user_id)
);

CREATE TABLE IF NOT EXISTS action_items (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  owner TEXT,
  due_date DATE,
  priority TEXT NOT NULL DEFAULT 'sedang',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  sim_time_sec NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_ex ON events(exercise_id, id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INT,
  detail JSONB NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
`,
  },
  {
    // Tim = instansi. Peserta bergabung ke tim memakai token yang dibagikan admin.
    name: '002_team_tokens',
    sql: `
ALTER TABLE teams ADD COLUMN IF NOT EXISTS join_token TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS join_enabled BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE teams SET join_token = upper(substr(md5(random()::text || id::text), 1, 8)) WHERE join_token IS NULL;
ALTER TABLE teams ALTER COLUMN join_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_join_token ON teams(join_token);

ALTER TABLE escalations ADD COLUMN IF NOT EXISTS team_id INT REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE statements ADD COLUMN IF NOT EXISTS team_id INT REFERENCES teams(id) ON DELETE SET NULL;
`,
  },
  {
    // Tim instansi berdiri sendiri (lintas latihan). Peserta bergabung sekali via token,
    // lalu melamar ke latihan yang dipublikasikan; fasilitator menerima, peserta menyatakan siap.
    name: '003_org_teams_applications',
    sql: `
CREATE TABLE IF NOT EXISTS org_teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4C9AFF',
  preset_id INT REFERENCES role_presets(id) ON DELETE SET NULL,
  join_token TEXT NOT NULL UNIQUE,
  join_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_team_members (
  id SERIAL PRIMARY KEY,
  org_team_id INT NOT NULL REFERENCES org_teams(id) ON DELETE CASCADE,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  player_role_id INT REFERENCES player_roles(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tim per latihan kini dibuat otomatis dari tim instansi saat lamaran diterima
ALTER TABLE teams ADD COLUMN IF NOT EXISTS org_team_id INT REFERENCES org_teams(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_org ON teams(exercise_id, org_team_id) WHERE org_team_id IS NOT NULL;
DROP INDEX IF EXISTS uq_teams_join_token;
ALTER TABLE teams DROP COLUMN IF EXISTS join_token;
ALTER TABLE teams DROP COLUMN IF EXISTS join_enabled;

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE exercise_members ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS exercise_applications (
  id SERIAL PRIMARY KEY,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_team_id INT REFERENCES org_teams(id) ON DELETE SET NULL,
  player_role_id INT REFERENCES player_roles(id) ON DELETE SET NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  review_note TEXT,
  reviewed_by INT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exercise_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_app_ex ON exercise_applications(exercise_id, status);
`,
  },
  {
    // Undangan per instansi, peran wajib, koordinator tim, briefing, pengingat jadwal.
    name: '004_invites_required_coordinator',
    sql: `
-- latihan tanpa undangan = terbuka untuk semua tim instansi
CREATE TABLE IF NOT EXISTS exercise_invites (
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  org_team_id INT NOT NULL REFERENCES org_teams(id) ON DELETE CASCADE,
  PRIMARY KEY (exercise_id, org_team_id)
);
ALTER TABLE exercise_roles ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE org_team_members ADD COLUMN IF NOT EXISTS is_coordinator BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS briefing TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
`,
  },
];

async function migrate() {
  await query(
    `CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, run_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  );
  for (const m of MIGRATIONS) {
    const done = await one('SELECT name FROM migrations WHERE name=$1', [m.name]);
    if (done) continue;
    console.log(`[migrate] menjalankan ${m.name}`);
    await tx(async (c) => {
      await c.query(m.sql);
      await c.query('INSERT INTO migrations(name) VALUES ($1)', [m.name]);
    });
  }
}

module.exports = { migrate };
