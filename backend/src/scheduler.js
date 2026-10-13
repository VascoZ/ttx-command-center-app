const { many } = require('./db');
const { simSeconds } = require('./simclock');
const { emit, logEvent } = require('./realtime');

async function dispatchInject(inject, userId = null) {
  emit.staff(inject.exercise_id, 'inject:sent', inject);
  emit.ex(inject.exercise_id, 'injects:changed', {
    inject_id: inject.id,
    team_id: inject.team_id,
    exercise_role_id: inject.exercise_role_id,
    priority: inject.priority,
    title: null,
  });
  await logEvent(
    inject.exercise_id,
    'inject_sent',
    { inject_id: inject.id, title: inject.title, team_id: inject.team_id, exercise_role_id: inject.exercise_role_id, adhoc: inject.adhoc },
    userId,
    inject.sim_sent_sec
  );
}

/** Pengingat 15 menit sebelum jadwal latihan (sekali per jadwal) ke semua anggota. */
const REMIND_BEFORE_MIN = parseInt(process.env.REMIND_BEFORE_MIN || '15', 10);
async function remind() {
  const due = await many(
    `UPDATE exercises SET reminded_at=now()
      WHERE status='draft' AND reminded_at IS NULL AND scheduled_for IS NOT NULL
        AND scheduled_for <= now() + make_interval(mins => $1) AND scheduled_for > now() - interval '1 hour'
      RETURNING id, title, scheduled_for`,
    [REMIND_BEFORE_MIN]
  );
  for (const ex of due) {
    const members = await many('SELECT user_id FROM exercise_members WHERE exercise_id=$1', [ex.id]);
    members.forEach((m) => emit.user(m.user_id, 'exercise:reminder', { exercise_id: ex.id, title: ex.title, scheduled_for: ex.scheduled_for }));
  }
}

/** Hapus audit log yang lebih tua dari AUDIT_RETENTION_DAYS (default 180; 0 = simpan selamanya). */
const AUDIT_RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS || '180', 10);
async function cleanup() {
  if (AUDIT_RETENTION_DAYS > 0) {
    const r = await many(
      `DELETE FROM audit_logs WHERE created_at < now() - make_interval(days => $1) RETURNING id`,
      [AUDIT_RETENTION_DAYS]
    );
    if (r.length) console.log(`[cleanup] ${r.length} audit log lebih dari ${AUDIT_RETENTION_DAYS} hari dihapus`);
  }
}

// Scheduler adaptif: cek inject tiap detik hanya saat ada latihan berjalan; saat semua diam, cek tiap 5 detik.
// wake() dipanggil saat latihan dimulai/dilanjutkan/dimajukan agar tidak menunggu.
const IDLE_MS = 5000;
let idleUntil = 0;
let nextRemind = 0;
let nextCleanup = Date.now() + 60 * 1000;
function wake() {
  idleUntil = 0;
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    if (now >= nextRemind) {
      nextRemind = now + 5000;
      await remind();
    }
    if (now >= nextCleanup) {
      nextCleanup = now + 24 * 3600 * 1000;
      await cleanup();
    }
    if (now < idleUntil) return;
    const exercises = await many(`SELECT * FROM exercises WHERE status='running'`);
    if (!exercises.length) idleUntil = now + IDLE_MS;
    for (const ex of exercises) {
      const sim = simSeconds(ex);
      const due = await many(
        `UPDATE exercise_injects
            SET status='sent', sent_at=now(), sim_sent_sec=$2::numeric
          WHERE exercise_id=$1 AND status='scheduled' AND offset_min*60 <= $2::numeric
          RETURNING *`,
        [ex.id, sim]
      );
      for (const inj of due.sort((a, b) => a.offset_min - b.offset_min)) {
        await dispatchInject(inj);
      }
    }
  } catch (e) {
    console.error('[scheduler]', e.message);
  } finally {
    running = false;
  }
}

function start() {
  setInterval(tick, 1000);
  console.log('[scheduler] aktif (1 detik saat latihan berjalan, 5 detik saat diam)');
}

module.exports = { start, tick, wake, dispatchInject };
