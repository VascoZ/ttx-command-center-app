// Jam simulasi: sim_elapsed_sec terakumulasi + (sekarang - resumed_at) * speed
function simSeconds(ex, now = Date.now()) {
  if (!ex) return 0;
  let s = Number(ex.sim_elapsed_sec) || 0;
  if (ex.status === 'running' && ex.resumed_at) {
    s += ((now - new Date(ex.resumed_at).getTime()) / 1000) * (Number(ex.speed) || 1);
  }
  return Math.max(0, s);
}

function fmtSim(sec) {
  const s = Math.floor(sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `T+${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function publicState(ex) {
  return {
    id: ex.id,
    status: ex.status,
    speed: Number(ex.speed),
    sim_elapsed_sec: Number(ex.sim_elapsed_sec),
    resumed_at: ex.resumed_at,
    started_at: ex.started_at,
    ended_at: ex.ended_at,
    sim_now_sec: simSeconds(ex),
    server_time: new Date().toISOString(),
  };
}

module.exports = { simSeconds, fmtSim, publicState };
