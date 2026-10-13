import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth, canDesign } from '../auth';
import { useAsync, Loading, ErrorBox, StatusPill, Empty, Icon } from '../ui';
import { fmtDateTime, fmtSim, MEMBER_ROLE } from '../format';
import { useEffect, useState } from 'react';

function TrendChart({ data }) {
  if (!data.length) return <Empty>Belum ada latihan yang selesai untuk dibandingkan.</Empty>;
  const W = 640;
  const H = 200;
  const pad = { l: 36, r: 12, t: 16, b: 36 };
  const n = data.length;
  const x = (i) => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (n - 1));
  const yRate = (v) => pad.t + (1 - v / 100) * (H - pad.t - pad.b);
  const yScore = (v) => pad.t + (1 - v / 5) * (H - pad.t - pad.b);
  const rate = data.map((d, i) => (d.response_rate === null ? null : [x(i), yRate(d.response_rate)])).filter(Boolean);
  const score = data.map((d, i) => (d.avg_score === null ? null : [x(i), yScore(Number(d.avg_score))])).filter(Boolean);
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Tren tingkat respons dan skor latihan">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={yRate(v)} y2={yRate(v)} stroke="var(--line)" />
            <text x={pad.l - 6} y={yRate(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{v}%</text>
          </g>
        ))}
        {rate.length > 0 && <path d={path(rate)} fill="none" stroke="var(--accent)" strokeWidth="2" />}
        {score.length > 0 && <path d={path(score)} fill="none" stroke="var(--info)" strokeWidth="2" strokeDasharray="5 4" />}
        {rate.map((p, i) => <circle key={`r${i}`} cx={p[0]} cy={p[1]} r="4" fill="var(--accent)" />)}
        {score.map((p, i) => <circle key={`s${i}`} cx={p[0]} cy={p[1]} r="4" fill="var(--info)" />)}
        {data.map((d, i) => (
          <text key={d.id} x={x(i)} y={H - 14} textAnchor="middle" fontSize="10" fill="var(--muted)">
            #{d.id}
          </text>
        ))}
      </svg>
      <div className="row small muted">
        <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: 'var(--accent)' }} /> Tingkat respons inject (%)</span>
        <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: 'var(--info)' }} /> Skor rata-rata objective (skala 1–5, garis putus)</span>
      </div>
    </div>
  );
}

function LiveClock({ e }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  let s = Number(e.sim_elapsed_sec) || 0;
  if (e.status === 'running' && e.resumed_at) s += ((Date.now() - new Date(e.resumed_at).getTime()) / 1000) * Number(e.speed || 1);
  return <span className="mono" style={{ color: 'var(--accent)' }}>{fmtSim(s)}</span>;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error, loading } = useAsync(() => api.get('/dashboard'), []);
  if (loading && !data) return <Loading />;
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Selamat datang, {user.name.split(' (')[0]}</h1>
          <p>Ringkasan latihan dan kesiapan organisasi Anda.</p>
        </div>
        {user.role !== 'admin' && <Link className={`btn ${canDesign(user) ? '' : 'btn-primary'}`} to="/my-team"><Icon name="key" /> Tim saya & pelatihan</Link>}
        {canDesign(user) && (
          <>
            <Link className="btn" to="/generator"><Icon name="spark" /> Generate skenario</Link>
            <Link className="btn btn-primary" to="/exercises?new=1"><Icon name="plus" /> Latihan baru</Link>
          </>
        )}
      </div>
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="grid g4">
            <div className="kpi"><div className="label">Latihan berjalan</div><div className="value" style={{ color: 'var(--good-text)' }}>{data.counts.running + data.counts.paused}</div></div>
            <div className="kpi"><div className="label">Draft / terjadwal</div><div className="value">{data.counts.draft}</div></div>
            <div className="kpi"><div className="label">Latihan selesai</div><div className="value">{data.counts.ended}</div></div>
            <div className="kpi"><div className="label">Skenario di pustaka</div><div className="value">{data.totals.scenarios}</div></div>
          </div>

          <div className="split">
            <div className="main-col">
              <div className="card">
                <div className="card-head"><h2>Latihan aktif</h2></div>
                {data.active.length === 0 ? (
                  <Empty>Tidak ada latihan yang sedang berjalan.</Empty>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <tbody>
                        {data.active.map((e) => (
                          <tr key={e.id}>
                            <td><Link to={`/exercises/${e.id}`} className="strong">{e.title}</Link><div className="small muted">{e.players} peserta · peran Anda: {MEMBER_ROLE[e.my_role] || 'Admin'}</div></td>
                            <td><StatusPill status={e.status} /></td>
                            <td className="right"><LiveClock e={e} /></td>
                            <td className="right"><Link className="btn btn-primary btn-sm" to={`/exercises/${e.id}`}>Masuk</Link></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="card">
                <div className="card-head"><h2>Tren kesiapan antarlatihan</h2></div>
                <div className="card-body"><TrendChart data={data.trend} /></div>
              </div>
            </div>
            <div className="side-col">
              <div className="card">
                <div className="card-head"><h2>Akan datang</h2></div>
                {data.upcoming.length === 0 ? <Empty>Belum ada latihan draft.</Empty> : (
                  <div className="feed">
                    {data.upcoming.map((e) => (
                      <div className="feed-item" key={e.id}>
                        <div className="grow">
                          <Link to={`/exercises/${e.id}`} className="strong">{e.title}</Link>
                          <div className="small muted">{e.scheduled_for ? `Jadwal: ${fmtDateTime(e.scheduled_for)}` : 'Belum dijadwalkan'} · {e.players} peserta</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="card">
                <div className="card-head"><h2>Selesai terbaru</h2></div>
                {data.recent.length === 0 ? <Empty>Belum ada.</Empty> : (
                  <div className="feed">
                    {data.recent.map((e) => (
                      <div className="feed-item" key={e.id}>
                        <div className="grow">
                          <Link to={['player'].includes(e.my_role) ? `/exercises/${e.id}` : `/exercises/${e.id}/report`} className="strong">{e.title}</Link>
                          <div className="small muted">
                            {fmtDateTime(e.ended_at)}
                            {e.avg_score ? ` · skor ${Number(e.avg_score).toFixed(1)}/5` : ''}
                            {e.req_sent ? ` · respons ${Math.round((e.answered / e.req_sent) * 100)}%` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
