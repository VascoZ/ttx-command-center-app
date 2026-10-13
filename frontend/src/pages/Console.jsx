import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useSocketEvent } from '../socket';
import { useToast, Empty, Icon, RoleTag } from '../ui';
import { fmtSim, eventText, eventKind, MEMBER_ROLE } from '../format';
import { InjectTable } from '../components/Injects';
import Chat from '../components/Chat';
import { DecisionList, StatementList, EscalationList } from '../components/Collab';
import Setup from './console/Setup';
import Evaluation from './console/Evaluation';

function ActivityFeed({ events, limit = 40 }) {
  const list = events.slice(-limit).reverse();
  if (!list.length) return <Empty>Belum ada aktivitas.</Empty>;
  return (
    <div className="feed">
      {list.map((e) => (
        <div className="feed-item" key={e.id}>
          <span className="feed-time">{fmtSim(e.sim_time_sec, true)}</span>
          <span className={`dot`} style={{ marginTop: 6, background: { inject: 'var(--accent)', response: 'var(--good)', decision: 'var(--info)', statement: '#f472b6', escalation: 'var(--bad)', observation: 'var(--purple)' }[eventKind(e.type)] || 'var(--line-2)' }} />
          <span className="grow">{eventText(e)}</span>
        </div>
      ))}
    </div>
  );
}

function RoleStatus({ ex, injects, online }) {
  const onlineIds = new Set(online.map((o) => o.user_id));
  const rows = ex.roles.map((r) => {
    const members = ex.members.filter((m) => m.exercise_role_id === r.id);
    const waiting = injects.filter((i) => i.status === 'sent' && i.requires_response && i.exercise_role_id === r.id && !(i.responses || []).length).length;
    return { r, members, on: members.filter((m) => onlineIds.has(m.user_id)).length, waiting };
  });
  const teams = ex.teams.map((t) => {
    const members = ex.members.filter((m) => m.team_id === t.id && m.role === 'player');
    return { t, members, on: members.filter((m) => onlineIds.has(m.user_id)).length };
  });
  return (
    <div className="card">
      <div className="card-head"><h2>Status per peran</h2></div>
      <div className="card-body col tight">
        {rows.length === 0 && <span className="muted small">Latihan ini belum memiliki peran player.</span>}
        {rows.map(({ r, members, on, waiting }) => (
          <div key={r.id} className="row nowrap-row">
            <span className="dot" style={{ background: r.color }} />
            <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            <span className="small muted nowrap">{on}/{members.length} online</span>
            {waiting > 0 ? <span className="badge warn">{waiting} menunggu</span> : <span className="badge good">siap</span>}
          </div>
        ))}
        {teams.length > 0 && <div className="nav-label" style={{ padding: '10px 0 2px' }}>Tim</div>}
        {teams.map(({ t, members, on }) => (
          <div key={t.id} className="row nowrap-row">
            <span className="dot" style={{ background: t.color, borderRadius: '50%' }} />
            <span className="grow">{t.name}</span>
            <span className="small muted">{on}/{members.length} online</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Console({ ex, simNow, online }) {
  const [params, setParams] = useSearchParams();
  const fac = ex.me.is_facilitator;
  const defaultTab = fac && ex.state.status === 'draft' ? 'setup' : ex.me.is_evaluator ? 'eval' : 'live';
  const tab = params.get('tab') || defaultTab;
  const setTab = (t) => setParams({ tab: t }, { replace: true });
  const [injects, setInjects] = useState([]);
  const [events, setEvents] = useState([]);
  const toast = useToast();

  useEffect(() => {
    api.get(`/exercises/${ex.id}/injects`).then(setInjects).catch(() => {});
    api.get(`/exercises/${ex.id}/timeline`).then(setEvents).catch(() => {});
  }, [ex.id, ex.state.status]);

  const upsertInject = (i) =>
    setInjects((l) => {
      const exists = l.find((x) => x.id === i.id);
      const merged = exists ? l.map((x) => (x.id === i.id ? { ...x, ...i, responses: x.responses } : x)) : [...l, { ...i, responses: [] }];
      return merged.sort((a, b) => a.offset_min - b.offset_min || a.id - b.id);
    });
  useSocketEvent('inject:sent', (i) => i.exercise_id === ex.id && upsertInject(i));
  useSocketEvent('inject:updated', (i) => i.exercise_id === ex.id && upsertInject(i));
  useSocketEvent('inject:deleted', (d) => setInjects((l) => l.filter((x) => x.id !== d.id)));
  useSocketEvent('response:new', (r) => {
    if (r.exercise_id !== ex.id) return;
    setInjects((l) => l.map((i) => (i.id === r.inject_id ? { ...i, responses: [...(i.responses || []).filter((x) => x.id !== r.id), r] } : i)));
  });
  useSocketEvent('event:new', (e) => {
    if (e.exercise_id !== ex.id) return;
    setEvents((l) => (l.some((x) => x.id === e.id) ? l : [...l, e]));
    if (e.type === 'escalation_sent') toast({ title: 'Eskalasi baru', body: eventText(e), kind: 'bad' });
  });

  const kpi = useMemo(() => {
    const sent = injects.filter((i) => i.status === 'sent');
    const req = sent.filter((i) => i.requires_response);
    const waiting = req.filter((i) => !(i.responses || []).length);
    const delays = [];
    sent.forEach((i) => (i.responses || []).forEach((r) => delays.push(Number(r.sim_time_sec) - Number(i.sim_sent_sec))));
    const avg = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length / 60 : null;
    const players = ex.members.filter((m) => m.role === 'player');
    const onlinePlayers = players.filter((m) => online.some((o) => o.user_id === m.user_id)).length;
    return { sent: sent.length, total: injects.length, waiting: waiting.length, avg, players: players.length, onlinePlayers };
  }, [injects, ex.members, online]);

  const tabs = [
    ['live', 'Live', 'play'],
    ['comms', 'Keputusan & komunikasi', 'chat'],
    ['eval', 'Evaluasi', 'target'],
    ['timeline', 'Timeline', 'clock'],
    ...(fac ? [['setup', 'Persiapan', 'settings']] : []),
  ];

  return (
    <div className="page" style={{ paddingTop: 12 }}>
      {ex.me.is_viewer && <div className="alert info small">Mode viewer: Anda dapat memantau latihan tanpa mengubah apa pun.</div>}
      <div className="tabs" role="tablist">
        {tabs.map(([k, l, ic]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            <Icon name={ic} size={14} /> {l}
          </button>
        ))}
      </div>

      {tab === 'live' && (
        <>
          {ex.state.status === 'draft' && (
            <div className="alert warn">Latihan belum dimulai. {fac ? 'Periksa tab Persiapan, lalu tekan "Mulai latihan".' : 'Menunggu fasilitator memulai latihan.'}</div>
          )}
          <div className="grid g4">
            <div className="kpi"><div className="label">Inject terkirim</div><div className="value">{kpi.sent} <small>/ {kpi.total}</small></div></div>
            <div className="kpi"><div className="label">Menunggu respons</div><div className="value" style={{ color: kpi.waiting ? 'var(--accent)' : undefined }}>{kpi.waiting}</div></div>
            <div className="kpi"><div className="label">Rata-rata waktu respons</div><div className="value">{kpi.avg === null ? '–' : kpi.avg.toFixed(1)} <small>menit</small></div></div>
            <div className="kpi"><div className="label">Peserta online</div><div className="value">{kpi.onlinePlayers} <small>/ {kpi.players}</small></div></div>
          </div>
          <div className="split">
            <div className="main-col">
              <InjectTable ex={ex} injects={injects} setInjects={setInjects} simNow={simNow} />
            </div>
            <div className="side-col">
              <RoleStatus ex={ex} injects={injects} online={online} />
              <div className="card">
                <div className="card-head"><h2>Aktivitas live</h2></div>
                <div className="card-scroll" style={{ maxHeight: 420 }}><ActivityFeed events={events} /></div>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'comms' && (
        <div className="split">
          <div className="main-col">
            <DecisionList ex={ex} compact />
            <StatementList ex={ex} compact />
          </div>
          <div className="side-col">
            <EscalationList ex={ex} compact />
            <div className="card"><Chat ex={ex} me={ex.me} /></div>
          </div>
        </div>
      )}

      {tab === 'eval' && <Evaluation ex={ex} injects={injects} simNow={simNow} />}

      {tab === 'timeline' && (
        <div className="card">
          <div className="card-head"><h2 className="grow">Timeline lengkap</h2><span className="small muted">{events.length} peristiwa</span></div>
          <div className="card-body">
            {events.length === 0 ? <Empty>Belum ada peristiwa.</Empty> : (
              <div className="tl">
                {events.map((e) => (
                  <div key={e.id} className={`tl-item k-${eventKind(e.type)}`}>
                    <div className="row small"><span className="mono muted">{fmtSim(e.sim_time_sec)}</span>{e.user_name && <span className="muted">· {e.user_name}</span>}</div>
                    <div>{eventText(e)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'setup' && fac && <Setup ex={ex} />}

      {tab === 'live' && ex.members.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Peserta</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nama</th><th>Peran latihan</th><th>Peran player</th><th>Tim</th><th>Status</th></tr></thead>
              <tbody>
                {ex.members.map((m) => {
                  const r = ex.roles.find((x) => x.id === m.exercise_role_id);
                  const t = ex.teams.find((x) => x.id === m.team_id);
                  const on = online.some((o) => o.user_id === m.user_id);
                  return (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{MEMBER_ROLE[m.role]}</td>
                      <td>{r ? <RoleTag name={r.name} color={r.color} /> : <span className="muted">–</span>}</td>
                      <td>{t ? t.name : <span className="muted">–</span>}</td>
                      <td>{on ? <span className="badge good">online</span> : <span className="badge">offline</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
