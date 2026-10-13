const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { waitForDb, pool } = require('./db');
const { migrate } = require('./migrate');
const { seed } = require('./seed');
const { requireAuth } = require('./auth');
const realtime = require('./realtime');
const scheduler = require('./scheduler');

const app = express();
// Jumlah reverse proxy di depan API: 1 = nginx (default), 2 = Caddy/HTTPS + nginx. Menentukan IP asli untuk rate limit.
app.set('trust proxy', parseInt(process.env.TRUST_PROXY || '1', 10));
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(','), credentials: true }));
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', time: new Date().toISOString(), version: '1.0.0' });
  } catch (e) {
    res.status(503).json({ status: 'db_error', error: e.message });
  }
});

// Rute publik / campuran
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/system'));

// Rute terautentikasi
const { presetRouter, roleRouter } = require('./routes/roles');
const { scenarioRouter, objRouter, injRouter, genRouter } = require('./routes/scenarios');
const { exerciseRouter, exerciseMisc } = require('./routes/exercises');
const { collabRouter, collabMisc } = require('./routes/collab');
const { evaluationRouter, evaluationMisc } = require('./routes/evaluation');
const { reportRouter, reportMisc } = require('./routes/reports');
const { applicationRouter, applicationMisc } = require('./routes/applications');

app.use('/api/users', requireAuth, require('./routes/users'));
app.use('/api/join', requireAuth, require('./routes/join'));
app.use('/api/org-teams', requireAuth, require('./routes/orgteams'));
app.use('/api/role-presets', requireAuth, presetRouter);
app.use('/api/player-roles', requireAuth, roleRouter);
app.use('/api/scenarios', requireAuth, scenarioRouter);
app.use('/api/scenario-objectives', requireAuth, objRouter);
app.use('/api/scenario-injects', requireAuth, injRouter);
app.use('/api/generator', requireAuth, genRouter);
// applicationRouter lebih dulu agar /api/exercises/open tidak tertangkap /:id
app.use('/api/exercises', requireAuth, applicationRouter, exerciseRouter, collabRouter, evaluationRouter, reportRouter);
app.use('/api', requireAuth, applicationMisc, exerciseMisc, collabMisc, evaluationMisc, reportMisc);

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

// Penanganan error
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error('[error]', err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File terlalu besar' });
  if (err.code === '23503') return res.status(400).json({ error: 'Data terkait tidak ditemukan' });
  if (err.code === '22P02') return res.status(400).json({ error: 'Format data tidak valid' });
  res.status(status).json({ error: status >= 500 ? 'Terjadi kesalahan pada server' : err.message });
});

async function main() {
  await waitForDb();
  await migrate();
  await seed();
  const server = http.createServer(app);
  realtime.init(server);
  scheduler.start();
  const port = parseInt(process.env.PORT || '4000', 10);
  server.listen(port, () => console.log(`[api] TTX Command Center API berjalan di port ${port}`));
  const shutdown = () => {
    console.log('[api] mematikan server...');
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('[api] gagal start:', e);
  process.exit(1);
});

module.exports = app;
