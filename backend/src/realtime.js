const { Server } = require('socket.io');
const { userFromToken, exerciseContext } = require('./auth');
const { one } = require('./db');
const { simSeconds } = require('./simclock');

let io = null;
// exerciseId -> Map(socketId -> info)
const presence = new Map();

function init(httpServer) {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: process.env.CORS_ORIGIN || true, credentials: true },
  });

  io.use(async (socket, next) => {
    const user = await userFromToken(socket.handshake.auth && socket.handshake.auth.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);

    socket.on('join', async (payload, ack) => {
      try {
        const exerciseId = parseInt(payload && payload.exerciseId, 10);
        leaveAll(socket);
        const ctx = await exerciseContext(exerciseId, user);
        socket.data.exerciseId = exerciseId;
        const rooms = [`ex:${exerciseId}`];
        if (ctx.isStaff) rooms.push(`ex:${exerciseId}:staff`);
        if (ctx.teamId) rooms.push(`ex:${exerciseId}:team:${ctx.teamId}`);
        if (ctx.roleId) rooms.push(`ex:${exerciseId}:role:${ctx.roleId}`);
        if (ctx.teamId && ctx.roleId) rooms.push(`ex:${exerciseId}:team:${ctx.teamId}:role:${ctx.roleId}`);
        // approver hanya menerima keputusan dari timnya sendiri (staf sudah menerima lewat room staff)
        if (ctx.canApprove && !ctx.isStaff) rooms.push(`ex:${exerciseId}:approvers:${ctx.teamId || 'none'}`);
        rooms.forEach((r) => socket.join(r));
        socket.data.rooms = rooms;
        if (!presence.has(exerciseId)) presence.set(exerciseId, new Map());
        presence.get(exerciseId).set(socket.id, {
          user_id: user.id,
          name: user.name,
          member_role: ctx.member ? ctx.member.role : ctx.isFacilitator ? 'facilitator' : null,
          team_id: ctx.teamId,
          exercise_role_id: ctx.roleId,
        });
        broadcastPresence(exerciseId);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (e) {
        if (typeof ack === 'function') ack({ ok: false, error: e.message });
      }
    });

    socket.on('leave', () => leaveAll(socket));
    socket.on('disconnect', () => leaveAll(socket));
  });
  return io;
}

function leaveAll(socket) {
  const exId = socket.data.exerciseId;
  if (socket.data.rooms) socket.data.rooms.forEach((r) => socket.leave(r));
  socket.data.rooms = null;
  socket.data.exerciseId = null;
  if (exId && presence.has(exId)) {
    presence.get(exId).delete(socket.id);
    broadcastPresence(exId);
  }
}

function presenceList(exerciseId) {
  const map = presence.get(exerciseId);
  if (!map) return [];
  const byUser = new Map();
  for (const info of map.values()) byUser.set(info.user_id, info);
  return Array.from(byUser.values());
}

function broadcastPresence(exerciseId) {
  if (!io) return;
  io.to(`ex:${exerciseId}`).emit('presence', { exercise_id: exerciseId, online: presenceList(exerciseId) });
}

const emit = {
  ex: (id, ev, data) => io && io.to(`ex:${id}`).emit(ev, data),
  staff: (id, ev, data) => io && io.to(`ex:${id}:staff`).emit(ev, data),
  team: (id, teamId, ev, data) => io && teamId && io.to(`ex:${id}:team:${teamId}`).emit(ev, data),
  role: (id, roleId, ev, data) => io && roleId && io.to(`ex:${id}:role:${roleId}`).emit(ev, data),
  teamRole: (id, teamId, roleId, ev, data) => io && teamId && roleId && io.to(`ex:${id}:team:${teamId}:role:${roleId}`).emit(ev, data),
  approvers: (id, teamId, ev, data) => io && io.to(`ex:${id}:approvers:${teamId || 'none'}`).emit(ev, data),
  user: (uid, ev, data) => io && io.to(`user:${uid}`).emit(ev, data),
};

/** Catat event timeline + kirim ke staf. */
async function logEvent(exerciseId, type, payload = {}, userId = null, simSec = null) {
  let sim = simSec;
  if (sim === null || sim === undefined) {
    const ex = await one('SELECT status, sim_elapsed_sec, resumed_at, speed FROM exercises WHERE id=$1', [exerciseId]);
    sim = simSeconds(ex);
  }
  const ev = await one(
    `INSERT INTO events(exercise_id, type, payload, user_id, sim_time_sec)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [exerciseId, type, JSON.stringify(payload), userId, sim]
  );
  emit.staff(exerciseId, 'event:new', ev);
  return ev;
}

module.exports = { init, emit, logEvent, presenceList };
