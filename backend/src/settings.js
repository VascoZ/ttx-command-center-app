const { one, query } = require('./db');

async function getSetting(key) {
  const r = await one('SELECT value FROM settings WHERE key=$1', [key]);
  return r ? r.value : null;
}

async function setSetting(key, value) {
  await query(
    `INSERT INTO settings(key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

/** Pendaftaran mandiri peserta: diatur admin di Pengaturan, default dari env ALLOW_REGISTRATION. */
async function registrationEnabled() {
  const s = await getSetting('registration');
  if (s && typeof s.enabled === 'boolean') return s.enabled;
  return String(process.env.ALLOW_REGISTRATION || 'true').toLowerCase() !== 'false';
}

module.exports = { getSetting, setSetting, registrationEnabled };
