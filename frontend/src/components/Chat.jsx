import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useSocketEvent } from '../socket';
import { useAction, Empty } from '../ui';
import { fmtSim } from '../format';

export default function Chat({ ex, me, compact }) {
  const isStaff = me.is_staff;
  const myTeam = me.team_id;
  const [channel, setChannel] = useState(myTeam || isStaff ? 'team' : 'general');
  const [teamId, setTeamId] = useState(myTeam || (ex.teams[0] && ex.teams[0].id) || null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [run, busy] = useAction();
  const listRef = useRef(null);
  const canSend = !me.is_viewer || me.is_facilitator;
  const ended = ex.state && ex.state.status === 'ended';

  useEffect(() => {
    let alive = true;
    const q = channel === 'general' ? 'channel=general' : `channel=team${isStaff && teamId ? `&team_id=${teamId}` : ''}`;
    api.get(`/exercises/${ex.id}/messages?${q}`).then((r) => alive && setMsgs(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [ex.id, channel, teamId, isStaff]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs]);

  useSocketEvent('message:new', (m) => {
    if (m.exercise_id !== ex.id) return;
    const match = channel === 'general' ? m.team_id === null : m.team_id === (isStaff ? teamId : myTeam);
    if (match) setMsgs((x) => (x.some((y) => y.id === m.id) ? x : [...x, m]));
  });

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const r = await run(() => api.post(`/exercises/${ex.id}/messages`, { channel, body: text, team_id: channel === 'team' ? teamId : null }));
    if (r) {
      setText('');
      setMsgs((x) => (x.some((y) => y.id === r.id) ? x : [...x, r]));
    }
  };

  return (
    <div className="chat">
      <div className="tabs" role="tablist" style={{ padding: '0 8px' }}>
        {(myTeam || isStaff) && (
          <button role="tab" aria-selected={channel === 'team'} className={`tab ${channel === 'team' ? 'active' : ''}`} onClick={() => setChannel('team')}>
            Chat tim
          </button>
        )}
        <button role="tab" aria-selected={channel === 'general'} className={`tab ${channel === 'general' ? 'active' : ''}`} onClick={() => setChannel('general')}>
          Umum
        </button>
        {isStaff && channel === 'team' && (
          <select className="select" style={{ width: 'auto', minHeight: 30, margin: '6px 0 6px auto' }} value={teamId || ''} onChange={(e) => setTeamId(Number(e.target.value))} aria-label="Pilih tim">
            {ex.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>
      <div className="chat-list" ref={listRef} style={compact ? { maxHeight: 320 } : undefined}>
        {msgs.length === 0 && <Empty>Belum ada pesan.</Empty>}
        {msgs.map((m) => (
          <div key={m.id} className={`chat-msg ${m.kind === 'broadcast' ? 'broadcast' : ''}`}>
            <div>
              <span className="who" style={m.role_color && m.kind !== 'broadcast' ? { color: m.role_color } : undefined}>
                {m.kind === 'broadcast' ? `Pengumuman fasilitator` : m.user_name}
              </span>
              {m.role_name && m.kind !== 'broadcast' && <span className="tiny muted"> · {m.role_name}</span>}
              <span className="when">{fmtSim(m.sim_time_sec, true)}</span>
            </div>
            <div className="body">{m.body}</div>
          </div>
        ))}
      </div>
      {canSend && !ended && (
        <form className="chat-form" onSubmit={send}>
          <label className="sr-only" htmlFor={`chat-${ex.id}`}>Pesan</label>
          <input id={`chat-${ex.id}`} className="input" placeholder={channel === 'team' ? 'Pesan ke tim…' : 'Pesan ke semua peserta…'} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>Kirim</button>
        </form>
      )}
    </div>
  );
}
