import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useExerciseRoom, useSocketEvent } from '../socket';

/** Hitung jam simulasi dari state server + offset jam klien. */
export function computeSim(state, offsetMs) {
  if (!state) return 0;
  let s = Number(state.sim_elapsed_sec) || 0;
  if (state.status === 'running' && state.resumed_at) {
    s += ((Date.now() + offsetMs - new Date(state.resumed_at).getTime()) / 1000) * (Number(state.speed) || 1);
  }
  return Math.max(0, s);
}

export function useSimClock(state, offsetMs) {
  const [now, setNow] = useState(() => computeSim(state, offsetMs));
  useEffect(() => {
    setNow(computeSim(state, offsetMs));
    if (!state || state.status !== 'running') return undefined;
    const t = setInterval(() => setNow(computeSim(state, offsetMs)), 500);
    return () => clearInterval(t);
  }, [state, offsetMs]);
  return now;
}

/** Data latihan + state live + presence, tersinkron via socket. */
export function useExercise(id) {
  const [ex, setEx] = useState(null);
  const [error, setError] = useState(null);
  const [state, setState] = useState(null);
  const [online, setOnline] = useState([]);
  const [deleted, setDeleted] = useState(false);
  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);

  const applyState = useCallback((st) => {
    if (st.server_time) {
      offsetRef.current = new Date(st.server_time).getTime() - Date.now();
      setOffset(offsetRef.current);
    }
    setState(st);
  }, []);

  const reload = useCallback(async () => {
    try {
      const d = await api.get(`/exercises/${id}`);
      setEx(d);
      applyState(d.state);
      setOnline(d.online || []);
      setError(null);
      return d;
    } catch (e) {
      setError(e);
      return null;
    }
  }, [id, applyState]);

  useEffect(() => {
    setEx(null);
    reload();
  }, [reload]);

  useExerciseRoom(Number(id), () => reload());

  useSocketEvent('exercise:state', (st) => {
    if (String(st.id) === String(id)) applyState(st);
  });
  useSocketEvent('exercise:updated', (d) => {
    if (String(d.id) === String(id)) reload();
  });
  useSocketEvent('presence', (p) => {
    if (String(p.exercise_id) === String(id)) setOnline(p.online);
  });
  useSocketEvent('exercise:deleted', (d) => {
    if (String(d.id) === String(id)) setDeleted(true);
  });

  const simNow = useSimClock(state, offset);
  const startedAt = state && state.started_at ? new Date(state.started_at).getTime() : null;
  const endedAt = state && state.ended_at ? new Date(state.ended_at).getTime() : null;
  const realSec = startedAt ? ((endedAt || Date.now() + offset) - startedAt) / 1000 : 0;

  return { ex, setEx, error, state, online, simNow, realSec, reload, deleted };
}
