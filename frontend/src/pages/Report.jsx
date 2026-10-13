import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, download } from '../api';
import { useAsync, useAction, useConfirm, Loading, ErrorBox, Empty, Icon, Field, Modal, RoleTag } from '../ui';
import { fmtDateTime, fmtDate, fmtSim, eventText, eventKind, DECISION_STATUS, STATEMENT_CHANNEL, OBS_CAT, ACTION_STATUS } from '../format';

function Kpi({ label, value, unit }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value ?? '–'} {unit && value !== null && value !== undefined && <small>{unit}</small>}</div>
    </div>
  );
}

function scoreColor(v) {
  if (v === null) return 'var(--line-2)';
  if (v >= 4) return 'var(--good)';
  if (v >= 3) return 'var(--accent)';
  return 'var(--bad)';
}

function Narrative({ exId, narrative, canEdit, onChange }) {
  const [run, busy] = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(narrative ? narrative.text : '');
  useEffect(() => setText(narrative ? narrative.text : ''), [narrative]);
  const gen = async () => {
    const r = await run(() => api.post(`/exercises/${exId}/report/narrative`, {}), 'Ringkasan eksekutif disusun');
    if (r) onChange(r);
  };
  const save = async () => {
    const r = await run(() => api.put(`/exercises/${exId}/report/narrative`, { text }), 'Ringkasan disimpan');
    if (r) {
      onChange(r);
      setEditing(false);
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="grow">Ringkasan eksekutif</h2>
        {canEdit && !editing && (
          <div className="row no-print">
            <button className="btn btn-sm" disabled={busy} onClick={gen}><Icon name="spark" /> {narrative ? 'Susun ulang' : 'Susun otomatis'}</button>
            {narrative && <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}><Icon name="edit" /> Edit</button>}
          </div>
        )}
      </div>
      <div className="card-body">
        {editing ? (
          <div className="col">
            <textarea className="textarea" style={{ minHeight: 260 }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Ringkasan eksekutif" />
            <div className="row"><button className="btn btn-primary" disabled={busy} onClick={save}>Simpan</button><button className="btn" onClick={() => setEditing(false)}>Batal</button></div>
          </div>
        ) : narrative ? (
          <>
            <div className="pre" style={{ lineHeight: 1.7 }}>{narrative.text}</div>
            <div className="tiny muted mt">Disusun {narrative.engine === 'manual' ? 'manual' : `oleh mesin ${narrative.engine}`} · {narrative.by} · {fmtDateTime(narrative.generated_at)}</div>
          </>
        ) : (
          <Empty>Belum ada ringkasan. {canEdit ? 'Klik "Susun otomatis" untuk membuat draf dari data latihan.' : ''}</Empty>
        )}
      </div>
    </div>
  );
}

function Actions({ exId, initial, canEdit }) {
  const [list, setList] = useState(initial);
  const [run, busy] = useAction();
  const confirm = useConfirm();
  const [f, setF] = useState({ title: '', owner: '', due_date: '', priority: 'sedang' });
  useEffect(() => setList(initial), [initial]);
  const add = async (e) => {
    e.preventDefault();
    const r = await run(() => api.post(`/exercises/${exId}/actions`, f));
    if (r) {
      setList((l) => [...l, r]);
      setF({ title: '', owner: '', due_date: '', priority: 'sedang' });
    }
  };
  const upd = async (a, patch) => {
    const r = await run(() => api.put(`/actions/${a.id}`, { ...a, ...patch }));
    if (r) setList((l) => l.map((x) => (x.id === r.id ? r : x)));
  };
  return (
    <div className="card">
      <div className="card-head"><h2>Rencana perbaikan (improvement plan)</h2></div>
      {list.length === 0 ? <Empty>Belum ada rencana perbaikan.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Tindakan</th><th>PIC</th><th>Tenggat</th><th>Prioritas</th><th>Status</th>{canEdit && <th className="no-print" />}</tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td>{a.title}</td>
                  <td>{a.owner || '–'}</td>
                  <td className="nowrap">{a.due_date ? fmtDate(a.due_date) : '–'}</td>
                  <td>{a.priority}</td>
                  <td>
                    {canEdit ? (
                      <select className="select" value={a.status} onChange={(e) => upd(a, { status: e.target.value })} aria-label="Status">
                        {Object.entries(ACTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    ) : ACTION_STATUS[a.status]}
                  </td>
                  {canEdit && (
                    <td className="no-print"><button className="btn btn-ghost icon-btn" aria-label="Hapus" onClick={async () => (await confirm('Hapus rencana perbaikan ini?', { danger: true, confirmLabel: 'Hapus' })) && run(() => api.del(`/actions/${a.id}`)).then((r) => r && setList((l) => l.filter((x) => x.id !== a.id)))}><Icon name="trash" /></button></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <form className="card-body grid g4 no-print" onSubmit={add} style={{ borderTop: '1px solid var(--line)', alignItems: 'end' }}>
          <Field label="Tindakan"><input className="input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="PIC"><input className="input" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></Field>
          <Field label="Tenggat"><input className="input" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <div className="row nowrap-row">
            <select className="select" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} aria-label="Prioritas">
              <option value="rendah">Rendah</option><option value="sedang">Sedang</option><option value="tinggi">Tinggi</option>
            </select>
            <button className="btn btn-primary" disabled={busy}>Tambah</button>
          </div>
        </form>
      )}
    </div>
  );
}

function Replay({ exId, open, onClose }) {
  const { data } = useAsync(() => api.get(`/exercises/${exId}/timeline`), [exId]);
  const events = data || [];
  const max = events.length ? Math.max(...events.map((e) => Number(e.sim_time_sec))) : 0;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    if (!playing) return undefined;
    timer.current = setInterval(() => setT((x) => {
      if (x >= max) {
        setPlaying(false);
        return max;
      }
      return Math.min(max, x + Math.max(30, max / 120));
    }), 250);
    return () => clearInterval(timer.current);
  }, [playing, max]);
  if (!open) return null;
  const visible = events.filter((e) => Number(e.sim_time_sec) <= t);
  return (
    <Modal title="Replay latihan" wide onClose={onClose}>
      <div className="row">
        <button className="btn btn-primary" onClick={() => { if (t >= max) setT(0); setPlaying((p) => !p); }}><Icon name={playing ? 'pause' : 'play'} /> {playing ? 'Jeda' : 'Putar'}</button>
        <span className="mono" style={{ color: 'var(--accent)', fontSize: 18 }}>{fmtSim(t)}</span>
        <span className="grow" />
        <span className="small muted">{visible.length}/{events.length} peristiwa</span>
      </div>
      <input type="range" min="0" max={Math.ceil(max)} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} aria-label="Posisi replay" style={{ width: '100%', accentColor: 'var(--accent)' }} />
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        <div className="tl">
          {events.map((e) => (
            <div key={e.id} className={`tl-item k-${eventKind(e.type)} ${Number(e.sim_time_sec) <= t ? '' : 'dim'}`}>
              <div className="small mono muted">{fmtSim(e.sim_time_sec)}</div>
              <div>{eventText(e)}</div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export default function Report() {
  const { id } = useParams();
  const { data: rep, error, loading, setData } = useAsync(() => api.get(`/exercises/${id}/report`), [id]);
  const detail = useAsync(() => api.get(`/exercises/${id}`), [id]);
  const [replay, setReplay] = useState(false);
  const [run] = useAction();
  const canEdit = detail.data && (detail.data.me.is_facilitator || detail.data.me.is_evaluator);
  const s = rep && rep.summary;
  const objectivesAvg = useMemo(() => (rep ? rep.objectives.filter((o) => o.avg_score !== null) : []), [rep]);

  if (loading && !rep) return <Loading />;
  if (error) return <div className="page"><ErrorBox error={error} /><Link to={`/exercises/${id}`}>Kembali ke latihan</Link></div>;
  const ex = rep.exercise;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="small muted" style={{ letterSpacing: '0.08em' }}>AFTER-ACTION REPORT</div>
          <h1>{ex.title}</h1>
          <p>
            {ex.status === 'ended' ? 'Selesai' : 'Sedang berlangsung (laporan sementara)'} · durasi simulasi {ex.sim_duration} · waktu nyata {ex.real_duration_min ?? 0} menit
            {ex.started_at ? ` · ${fmtDateTime(ex.started_at)}` : ''}
          </p>
          <p className="small">Skenario: {ex.scenario_title || '–'} · Preset peran: {ex.preset_name || '–'}</p>
        </div>
        <div className="row no-print">
          <Link className="btn" to={`/exercises/${id}`}><Icon name="play" /> Buka latihan</Link>
          <button className="btn" onClick={() => setReplay(true)}><Icon name="clock" /> Replay</button>
          <select className="select" style={{ width: 'auto' }} aria-label="Ekspor CSV" value="" onChange={(e) => e.target.value && run(() => download(`/exercises/${id}/export.csv?type=${e.target.value}`, `latihan-${id}-${e.target.value}.csv`))}>
            <option value="">Ekspor CSV…</option>
            <option value="events">Timeline peristiwa</option>
            <option value="responses">Respons inject</option>
            <option value="decisions">Keputusan</option>
            <option value="observations">Observasi</option>
          </select>
          <button className="btn" onClick={() => run(() => download(`/exercises/${id}/export.json`, `latihan-${id}.json`))}><Icon name="download" /> JSON</button>
          <button className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" /> Cetak / PDF</button>
        </div>
      </div>

      <div className="grid g4">
        <Kpi label="Inject dijawab" value={`${s.injects_answered}/${s.injects_requiring_response}`} />
        <Kpi label="Tingkat respons" value={s.response_rate} unit="%" />
        <Kpi label="Rata-rata waktu respons" value={s.avg_response_min} unit="menit" />
        <Kpi label="Skor rata-rata objective" value={s.avg_objective_score} unit="/ 5" />
        <Kpi label="Keputusan (disetujui)" value={`${s.decisions} (${s.decisions_approved})`} />
        <Kpi label="Pernyataan publik" value={s.statements} />
        <Kpi label="Eskalasi" value={s.escalations} />
        <Kpi label="Kepuasan peserta" value={s.feedback_avg} unit={`/ 5 · ${s.feedback_count} resp.`} />
      </div>

      <Narrative exId={id} narrative={rep.narrative} canEdit={canEdit} onChange={(n) => setData((r) => ({ ...r, narrative: n }))} />

      <div className="grid g3">
        <div className="card">
          <div className="card-head"><h2 style={{ color: 'var(--good-text)' }}>Kekuatan</h2></div>
          <div className="card-body">
            {rep.strengths.length === 0 ? <span className="muted small">Belum ada catatan kekuatan.</span> : (
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>{rep.strengths.map((x, i) => <li key={i}>{x.text}{x.source === 'otomatis' && <span className="tiny muted"> (otomatis)</span>}</li>)}</ul>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2 style={{ color: 'var(--bad-text)' }}>Area perbaikan</h2></div>
          <div className="card-body">
            {rep.improvements.length === 0 ? <span className="muted small">Tidak ada temuan.</span> : (
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>{rep.improvements.map((x, i) => <li key={i}>{x.text}{x.source === 'otomatis' && <span className="tiny muted"> (otomatis)</span>}</li>)}</ul>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Rekomendasi</h2></div>
          <div className="card-body">
            <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>{rep.recommendations.map((x, i) => <li key={i}>{x}</li>)}</ol>
          </div>
        </div>
      </div>

      <div className="split">
        <div className="main-col">
          <div className="card">
            <div className="card-head"><h2>Skor objective</h2></div>
            <div className="card-body col">
              {rep.objectives.length === 0 && <span className="muted small">Tidak ada objective.</span>}
              {rep.objectives.map((o) => (
                <div key={o.id}>
                  <div className="row"><span className="grow">{o.title}</span><strong>{o.avg_score ?? '–'}</strong></div>
                  <div className="bar mt-s"><span style={{ width: `${((o.avg_score || 0) / 5) * 100}%`, background: scoreColor(o.avg_score) }} /></div>
                  {o.by_team.length > 0 && <div className="tiny muted mt-s">{o.by_team.map((t) => `${t.team}: ${t.avg}`).join(' · ')}</div>}
                  {o.comments.length > 0 && <div className="small mt-s">{o.comments.map((c, i) => <div key={i} className="muted">“{c.comment}” — {c.by}{c.team ? ` (${c.team})` : ''}</div>)}</div>}
                </div>
              ))}
              {objectivesAvg.length === 0 && rep.objectives.length > 0 && <span className="muted small">Evaluator belum memberi skor.</span>}
            </div>
          </div>
        </div>
        <div className="side-col">
          <div className="card">
            <div className="card-head"><h2>Rekap per tim</h2></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Tim</th><th>Respons</th><th>Rata-rata</th><th>Keputusan</th></tr></thead>
                <tbody>
                  {rep.teams.map((t) => (
                    <tr key={t.id}><td><span className="dot" style={{ background: t.color, borderRadius: '50%', marginRight: 6 }} />{t.name}</td><td>{t.responses}</td><td>{t.avg_response_min !== null ? `${t.avg_response_min} mnt` : '–'}</td><td>{t.decisions}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Rekap per peran player</h2></div>
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 860 }}>
            <thead><tr><th>Peran</th><th>Peserta</th><th>Inject diterima</th><th>Respons</th><th>Rata-rata respons</th><th>Keputusan</th><th>Persetujuan</th><th>Rata-rata persetujuan</th><th>Pernyataan</th><th>Eskalasi (kirim/terima)</th></tr></thead>
            <tbody>
              {rep.roles.map((r) => (
                <tr key={r.id}>
                  <td><RoleTag name={r.name} color={r.color} /></td>
                  <td>{r.members}</td>
                  <td>{r.injects_targeted}</td>
                  <td>{r.responses}</td>
                  <td>{r.avg_response_min !== null ? `${r.avg_response_min} mnt` : '–'}</td>
                  <td>{r.decisions}</td>
                  <td>{r.can_approve ? r.approvals : '–'}</td>
                  <td>{r.avg_approval_min !== null ? `${r.avg_approval_min} mnt` : '–'}</td>
                  <td>{r.can_statement ? r.statements : '–'}</td>
                  <td>{r.escalations_sent}/{r.escalations_received}{r.avg_ack_min !== null ? ` · ${r.avg_ack_min} mnt` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Inject</h2></div>
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 760 }}>
            <thead><tr><th>Waktu</th><th>Inject</th><th>Target</th><th>Status</th><th>Respons</th><th>Respons pertama</th><th>Pilihan yang diambil</th></tr></thead>
            <tbody>
              {rep.injects.map((i) => (
                <tr key={i.id}>
                  <td className="mono nowrap">{i.sim_sent || `T+${String(Math.floor(i.offset_min / 60)).padStart(2, '0')}:${String(i.offset_min % 60).padStart(2, '0')}`}</td>
                  <td>{i.title}{i.adhoc && <span className="badge info" style={{ marginLeft: 6 }}>ad-hoc</span>}</td>
                  <td className="small">{i.target}</td>
                  <td>{i.status === 'sent' ? (i.requires_response && i.responses === 0 ? <span className="badge bad">tidak dijawab</span> : <span className="badge good">terkirim</span>) : <span className="badge">{i.status === 'skipped' ? 'dilewati' : 'tidak terkirim'}</span>}</td>
                  <td>{i.responses}</td>
                  <td>{i.first_response_min !== null ? `${i.first_response_min} mnt` : '–'}</td>
                  <td className="small">{i.choices.join('; ') || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head"><h2>Log keputusan</h2></div>
          <div className="card-scroll">
            {rep.decisions.length === 0 ? <Empty>Tidak ada keputusan.</Empty> : (
              <div className="feed">
                {rep.decisions.map((d) => (
                  <div className="feed-item" key={d.id}>
                    <span className="feed-time">{fmtSim(d.sim_time_sec, true)}</span>
                    <div className="grow">
                      <div className="strong">{d.decision}</div>
                      <div className="small muted">{d.user_name}{d.role_name ? ` · ${d.role_name}` : ''}{d.approver_name && d.approved_by !== d.user_id ? ` · disetujui ${d.approver_name}` : ''}</div>
                      <span className={`badge ${DECISION_STATUS[d.status].cls}`}>{DECISION_STATUS[d.status].label}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Pernyataan publik & eskalasi</h2></div>
          <div className="card-scroll">
            {rep.statements.length + rep.escalations.length === 0 ? <Empty>Tidak ada.</Empty> : (
              <div className="feed">
                {rep.statements.map((st) => (
                  <div className="feed-item" key={`s${st.id}`}>
                    <span className="feed-time">{fmtSim(st.sim_time_sec, true)}</span>
                    <div className="grow"><span className="badge warn">{STATEMENT_CHANNEL[st.channel]}</span> <strong>{st.title}</strong><div className="small pre mt-s">{st.body}</div></div>
                  </div>
                ))}
                {rep.escalations.map((e) => (
                  <div className="feed-item" key={`e${e.id}`}>
                    <span className="feed-time">{fmtSim(e.sim_time_sec, true)}</span>
                    <div className="grow"><span className="badge bad">Eskalasi</span> <strong>{e.subject}</strong><div className="small muted">{e.from_name} → {e.to_role_name} · {e.acknowledged_at ? 'diterima' : 'tidak diterima'}</div></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Observasi evaluator</h2></div>
        <div className="card-scroll">
          {rep.observations.length === 0 ? <Empty>Tidak ada observasi.</Empty> : (
            <div className="feed">
              {rep.observations.map((o) => (
                <div className="feed-item" key={o.id}>
                  <span className="feed-time">{fmtSim(o.sim_time_sec, true)}</span>
                  <div className="grow"><span className={`badge ${OBS_CAT[o.category].cls}`}>{OBS_CAT[o.category].label}</span> {o.body}<div className="tiny muted">{o.user_name}{o.team_name ? ` · ${o.team_name}` : ''}{o.inject_title ? ` · ${o.inject_title}` : ''}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Actions exId={id} initial={rep.actions} canEdit={canEdit} />

      {rep.feedback.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Umpan balik peserta</h2></div>
          <div className="feed">
            {rep.feedback.map((f) => (
              <div className="feed-item" key={f.id}><div className="grow"><strong>{f.user_name}</strong> · kepuasan {f.rating}/5{f.realism ? ` · realisme ${f.realism}/5` : ''}{f.comments && <div className="small pre">{f.comments}</div>}</div></div>
            ))}
          </div>
        </div>
      )}
      <div className="tiny muted">Laporan dibuat {fmtDateTime(rep.generated_at)} oleh TTX Command Center.</div>
      <Replay exId={id} open={replay} onClose={() => setReplay(false)} />
    </div>
  );
}
