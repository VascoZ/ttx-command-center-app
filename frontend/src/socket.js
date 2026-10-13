import { io } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';

let socket = null;
const listeners = new Set();

export function connectSocket(token) {
  if (socket) socket.disconnect();
  socket = io({ path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'] });
  socket.on('connect', () => listeners.forEach((fn) => fn(true)));
  socket.on('disconnect', () => listeners.forEach((fn) => fn(false)));
  return socket;
}

export function disconnectSocket() {
  if (socket) socket.disconnect();
  socket = null;
}

export function getSocket() {
  return socket;
}

/** Status koneksi socket. */
export function useConnected() {
  const [c, setC] = useState(!!(socket && socket.connected));
  useEffect(() => {
    listeners.add(setC);
    setC(!!(socket && socket.connected));
    return () => listeners.delete(setC);
  }, []);
  return c;
}

/** Dengarkan event socket; handler selalu versi terbaru. */
export function useSocketEvent(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = socket;
    if (!s) return undefined;
    const fn = (data) => ref.current(data);
    s.on(event, fn);
    return () => s.off(event, fn);
  }, [event]);
}

/** Gabung ke room latihan; bergabung ulang saat reconnect atau keanggotaan berubah. */
export function useExerciseRoom(exerciseId, onJoined) {
  const ref = useRef(onJoined);
  ref.current = onJoined;
  useEffect(() => {
    const s = socket;
    if (!s || !exerciseId) return undefined;
    const join = () => s.emit('join', { exerciseId }, (r) => r && r.ok && ref.current && ref.current());
    if (s.connected) join();
    s.on('connect', join);
    const onMembership = () => join();
    s.on('membership:changed', onMembership);
    return () => {
      s.off('connect', join);
      s.off('membership:changed', onMembership);
      s.emit('leave');
    };
  }, [exerciseId]);
}
