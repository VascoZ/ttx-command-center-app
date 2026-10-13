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

let ticks = 0;
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const exercises = await many(`SELECT * FROM exercises WHERE status='running'`);
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
    if (ticks++ % 5 === 0) await remind();
  } catch (e) {
    console.error('[scheduler]', e.message);
  } finally {
    running = false;
  }
}

function start() {
  setInterval(tick, 1000);
  console.log('[scheduler] aktif (interval 1 detik)');
}

module.exports = { start, tick, dispatchInject };
