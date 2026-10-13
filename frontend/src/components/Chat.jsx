import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useSocketEvent, useResync } from '../socket';
import { useAction, Empty } from '../ui';

const PAGE = 100;
import { fmtSim } from '../format';

export default function Chat({ ex, me, compact }) {
  const isStaff = me.is_staff;
  const myTeam = me.team_id;
  const [channel, setChannel] = useState(myTeam || isStaff ? 'team' : 'general');
  const [teamId, setTeamId] = useState(myTeam || (ex.teams[0] && ex.teams[0].id) || null);
  const [msgs, setMsgs] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // saat memuat pesan lama, jaga posisi gulir (jangan lompat ke bawah)
  const keepScroll = useRef(null);
  const [text, setText] = useState('');
  const [run, busy] = useAction();
  const listRef = useRef(null);
  const canSend = !me.is_viewer || me.is_facilitator;
  const ended = ex.state && ex.state.status === 'ended';
  const resync = useResync();
  const staffNoTeam = isStaff && channel === 'team' && !teamId;

  // Tim bisa muncul/terhapus selama latihan (lamaran diterima, tim dihapus admin):
  // pastikan tim yang dipilih staf selalu tim yang masih ada.
  useEffect(() => {
    if (!isStaff) return;
    if (!teamId || !ex.teams.some((t) => t.id === teamId)) setTeamId(ex.teams[0] ? ex.teams[0].id : null);
  }, [isStaff, teamId, ex.teams]);

  useEffect(() => {
    let alive = true;
    if (channel === 'team' && isStaff && !teamId) {
      setMsgs([]);
      setHasMore(false);
      return undefined;
    }
    api
      .get(`/exercises/${ex.id}/messages?${query()}&limit=${PAGE}`)
      .then((r) => {
        if (!alive) return;
        setMsgs(r);
        setHasMore(r.length >= PAGE);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.id, channel, teamId, isStaff, myTeam, resync]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (keepScroll.current !== null) {
      el.scrollTop = el.scrollHeight - keepScroll.current;
      keepScroll.current = null;
    } else el.scrollTop = el.scrollHeight;
  }, [msgs]);

  function query() {
    return channel === 'general' ? 'channel=general' : `channel=team${isStaff && teamId ? `&team_id=${teamId}` : ''}`;
  }

  const loadOlder = async () => {
    if (!msgs.length) return;
    setLoadingOlder(true);
    try {
      const older = await api.get(`/exercises/${ex.id}/messages?${query()}&limit=${PAGE}&before=${msgs[0].id}`);
      if (listRef.current) keepScroll.current = listRef.current.scrollHeight - listRef.current.scrollTop;
      setMsgs((x) => [...older.filter((o) => !x.some((y) => y.id === o.id)), ...x]);
      setHasMore(older.length >= PAGE);
    } catch {
      /* abaikan */
    } finally {
      setLoadingOlder(false);
    }
  };

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
        {hasMore && (
          <div style={{ textAlign: 'center', padding: '4px 0 8px' }}>
            <button type="button" className="btn btn-sm btn-ghost" disabled={loadingOlder} onClick={loadOlder}>
              {loadingOlder ? 'Memuat…' : 'Muat pesan sebelumnya'}
            </button>
          </div>
        )}
        {msgs.length === 0 && <Empty>{staffNoTeam ? 'Belum ada tim di latihan ini. Tim muncul setelah lamaran peserta diterima.' : 'Belum ada pesan.'}</Empty>}
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
      {canSend && !ended && !staffNoTeam && (
        <form className="chat-form" onSubmit={send}>
          <label className="sr-only" htmlFor={`chat-${ex.id}`}>Pesan</label>
          <input id={`chat-${ex.id}`} className="input" placeholder={channel === 'team' ? 'Pesan ke tim…' : 'Pesan ke semua peserta…'} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>Kirim</button>
        </form>
      )}
    </div>
  );
}
