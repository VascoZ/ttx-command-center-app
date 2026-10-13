import { useState } from 'react';
import { api } from '../../api';
import { useSocketEvent } from '../../socket';
import { useAsync, useAction, Field, Empty, Icon } from '../../ui';
import { OBS_CAT, fmtSim } from '../../format';

function ObservationPanel({ ex, injects }) {
  const { data, setData } = useAsync(() => api.get(`/exercises/${ex.id}/observations`), [ex.id]);
  const [f, setF] = useState({ category: 'netral', body: '', team_id: '', exercise_role_id: '', inject_id: '', objective_id: '' });
  const [filter, setFilter] = useState('all');
  const [run, busy] = useAction();
  const canWrite = ex.me.is_facilitator || ex.me.is_evaluator;
  useSocketEvent('observation:new', (o) => o.exercise_id === ex.id && setData((l) => (l && l.some((x) => x.id === o.id) ? l : [o, ...(l || [])])));
  useSocketEvent('observation:deleted', (d) => setData((l) => (l || []).filter((x) => x.id !== d.id)));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(() => api.post(`/exercises/${ex.id}/observations`, { ...f, team_id: f.team_id || null, exercise_role_id: f.exercise_role_id || null, inject_id: f.inject_id || null, objective_id: f.objective_id || null }));
    if (r) {
      setData((l) => (l && l.some((x) => x.id === r.id) ? l : [r, ...(l || [])]));
      setF((x) => ({ ...x, body: '' }));
    }
  };
  const list = (data || []).filter((o) => filter === 'all' || o.category === filter);
  return (
    <div className="card">
      <div className="card-head"><h2>Catatan observasi</h2></div>
      {canWrite && (
        <form className="card-body col" onSubmit={submit} style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="pills" role="radiogroup" aria-label="Kategori">
            {Object.entries(OBS_CAT).map(([k, v]) => (
              <button type="button" key={k} role="radio" aria-checked={f.category === k} className={`pill ${f.category === k ? 'active' : ''}`} onClick={() => setF((x) => ({ ...x, category: k }))}>{v.label}</button>
            ))}
          </div>
          <Field label="Catatan"><textarea className="textarea" required value={f.body} onChange={set('body')} placeholder="mis. Eskalasi ke Sekda membutuhkan 22 menit karena kontak tidak tersedia" /></Field>
          <div className="grid g4">
            <Field label="Tim"><select className="select" value={f.team_id} onChange={set('team_id')}><option value="">—</option>{ex.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
            <Field label="Peran"><select className="select" value={f.exercise_role_id} onChange={set('exercise_role_id')}><option value="">—</option>{ex.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label="Inject"><select className="select" value={f.inject_id} onChange={set('inject_id')}><option value="">—</option>{injects.filter((i) => i.status === 'sent').map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</select></Field>
            <Field label="Objective"><select className="select" value={f.objective_id} onChange={set('objective_id')}><option value="">—</option>{ex.objectives.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select></Field>
          </div>
          <div><button className="btn btn-primary" disabled={busy || !f.body.trim()}>Simpan catatan</button></div>
        </form>
      )}
      <div className="row" style={{ padding: '10px 16px' }}>
        {[['all', 'Semua'], ['kekuatan', 'Kekuatan'], ['perbaikan', 'Perbaikan'], ['netral', 'Catatan']].map(([k, l]) => (
          <button key={k} className={`pill ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <div className="card-scroll">
        {list.length === 0 ? <Empty>Belum ada catatan.</Empty> : (
          <div className="feed">
            {list.map((o) => (
              <div className="feed-item" key={o.id}>
                <span className="feed-time">{fmtSim(o.sim_time_sec, true)}</span>
                <div className="grow col tight">
                  <div className="row"><span className={`badge ${OBS_CAT[o.category].cls}`}>{OBS_CAT[o.category].label}</span><span className="small muted">{o.user_name}</span></div>
                  <div className="pre">{o.body}</div>
                  <div className="row tiny muted">
                    {o.team_name && <span>Tim: {o.team_name}</span>}
                    {o.role_name && <span>Peran: {o.role_name}</span>}
                    {o.inject_title && <span>Inject: {o.inject_title}</span>}
                    {o.objective_title && <span>Objective: {o.objective_title}</span>}
                  </div>
                </div>
                {(ex.me.is_facilitator || o.user_id === ex.me.user_id) && (
                  <button className="btn btn-ghost icon-btn" aria-label="Hapus catatan" onClick={() => run(() => api.del(`/observations/${o.id}`)).then((r) => r && setData((l) => l.filter((x) => x.id !== o.id)))}><Icon name="trash" /></button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreMatrix({ ex }) {
  const { data, setData } = useAsync(() => api.get(`/exercises/${ex.id}/scores`), [ex.id]);
  const [run] = useAction();
  const canWrite = ex.me.is_facilitator || ex.me.is_evaluator;
  useSocketEvent('score:updated', (s) => s.exercise_id === ex.id && setData((l) => [...(l || []).filter((x) => x.id !== s.id), s]));
  const cols = [{ id: null, name: 'Keseluruhan' }, ...ex.teams];
  const mine = (oid, tid) => (data || []).find((s) => s.objective_id === oid && (s.team_id || null) === tid && s.evaluator_id === ex.me.user_id);
  const avg = (oid, tid) => {
    const ss = (data || []).filter((s) => s.objective_id === oid && (s.team_id || null) === tid);
    return ss.length ? (ss.reduce((a, b) => a + b.score, 0) / ss.length).toFixed(1) : null;
  };
  const setScore = async (oid, tid, score) => {
    if (!score) return;
    const cur = mine(oid, tid);
    const r = await run(() => api.post(`/exercises/${ex.id}/scores`, { objective_id: oid, team_id: tid, score: Number(score), comment: cur ? cur.comment : null }));
    if (r) setData((l) => [...(l || []).filter((x) => x.id !== r.id), { ...r, evaluator_name: 'Anda' }]);
  };
  const setComment = async (oid, tid, comment) => {
    const cur = mine(oid, tid);
    if (!cur || comment === (cur.comment || '')) return;
    const r = await run(() => api.post(`/exercises/${ex.id}/scores`, { objective_id: oid, team_id: tid, score: cur.score, comment }));
    if (r) setData((l) => [...(l || []).filter((x) => x.id !== r.id), r]);
  };

  return (
    <div className="card">
      <div className="card-head"><h2 className="grow">Penilaian objective (1–5)</h2><span className="small muted">Skor Anda · rata-rata semua evaluator di bawahnya</span></div>
      {ex.objectives.length === 0 ? <Empty>Latihan ini belum memiliki objective.</Empty> : (
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 640 }}>
            <thead><tr><th>Objective</th>{cols.map((c) => <th key={c.id || 0}>{c.name}</th>)}</tr></thead>
            <tbody>
              {ex.objectives.map((o) => (
                <tr key={o.id}>
                  <td style={{ minWidth: 220 }}><div className="strong">{o.title}</div><div className="tiny muted">{o.description}</div></td>
                  {cols.map((c) => {
                    const m = mine(o.id, c.id);
                    const a = avg(o.id, c.id);
                    return (
                      <td key={c.id || 0} style={{ minWidth: 120 }}>
                        {canWrite ? (
                          <div className="col tight">
                            <select className="select" aria-label={`Skor ${o.title} ${c.name}`} value={m ? m.score : ''} onChange={(e) => setScore(o.id, c.id, e.target.value)}>
                              <option value="">–</option>
                              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                            {m && <input className="input small" placeholder="Komentar" defaultValue={m.comment || ''} onBlur={(e) => setComment(o.id, c.id, e.target.value)} aria-label="Komentar skor" />}
                          </div>
                        ) : null}
                        <div className="tiny muted mt-s">{a ? `rata-rata ${a}` : 'belum dinilai'}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FeedbackPanel({ ex }) {
  const { data, setData } = useAsync(() => api.get(`/exercises/${ex.id}/feedback`), [ex.id]);
  useSocketEvent('feedback:new', (f) => f.exercise_id === ex.id && setData((l) => [f, ...(l || []).filter((x) => x.id !== f.id)]));
  const list = data || [];
  const avg = list.length ? (list.reduce((a, b) => a + b.rating, 0) / list.length).toFixed(1) : null;
  return (
    <div className="card">
      <div className="card-head"><h2 className="grow">Umpan balik peserta</h2>{avg && <span className="badge warn">rata-rata {avg}/5</span>}</div>
      {list.length === 0 ? <Empty>Peserta dapat mengisi survei setelah latihan berakhir.</Empty> : (
        <div className="feed">
          {list.map((f) => (
            <div className="feed-item" key={f.id}>
              <div className="grow">
                <div className="row"><strong>{f.user_name}</strong><span className="badge">kepuasan {f.rating}/5</span>{f.realism && <span className="badge">realisme {f.realism}/5</span>}</div>
                {f.comments && <div className="small pre mt-s">{f.comments}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Evaluation({ ex, injects }) {
  return (
    <div className="split">
      <div className="main-col">
        <ScoreMatrix ex={ex} />
        <ObservationPanel ex={ex} injects={injects} />
      </div>
      <div className="side-col">
        <FeedbackPanel ex={ex} />
      </div>
    </div>
  );
}
