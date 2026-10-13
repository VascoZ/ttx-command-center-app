import { useState } from 'react';
import { api } from '../api';
import { useSocketEvent, useResync } from '../socket';
import { useAsync, useAction, Modal, Field, Empty, Icon, RoleTag } from '../ui';
import { DECISION_STATUS, STATEMENT_CHANNEL, fmtSim } from '../format';

function upsert(list, item) {
  if (!list) return [item];
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [item, ...list];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

/* ================= Keputusan ================= */
export function DecisionForm({ ex, injectId, onClose, onDone }) {
  const [form, setForm] = useState({ decision: '', owner: '', rationale: '' });
  const [run, busy] = useAction();
  const submit = async () => {
    const r = await run(() => api.post(`/exercises/${ex.id}/decisions`, { ...form, inject_id: injectId || null }), 'Keputusan dicatat');
    if (r) {
      onDone && onDone(r);
      onClose();
    }
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const needsApproval = !ex.me.can_approve && ex.roles.some((r) => r.can_approve);
  return (
    <Modal title="Ajukan keputusan" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn btn-primary" disabled={busy || !form.decision.trim()} onClick={submit}>{needsApproval ? 'Ajukan untuk persetujuan' : 'Catat keputusan'}</button></>}>
      {needsApproval && <div className="alert info small">Keputusan dari peran Anda membutuhkan persetujuan peran penyetuju (mis. pimpinan).</div>}
      <Field label="Keputusan"><textarea className="textarea" value={form.decision} onChange={set('decision')} placeholder="mis. Isolasi seluruh jaringan OPD dari internet" /></Field>
      <Field label="Penanggung jawab pelaksana"><input className="input" value={form.owner} onChange={set('owner')} /></Field>
      <Field label="Alasan / pertimbangan"><textarea className="textarea" value={form.rationale} onChange={set('rationale')} /></Field>
    </Modal>
  );
}

export function DecisionList({ ex, compact }) {
  const resync = useResync();
  const { data, setData } = useAsync(() => api.get(`/exercises/${ex.id}/decisions`), [ex.id, resync]);
  const [run, busy] = useAction();
  const [review, setReview] = useState(null);
  const [note, setNote] = useState('');
  const [showForm, setShowForm] = useState(false);
  useSocketEvent('decision:new', (d) => d.exercise_id === ex.id && setData((l) => upsert(l, d)));
  useSocketEvent('decision:updated', (d) => d.exercise_id === ex.id && setData((l) => upsert(l, d)));
  const live = ex.state && ['running', 'paused'].includes(ex.state.status);
  const canCreate = live && (ex.me.is_player || ex.me.is_facilitator);

  const act = async (approve) => {
    const r = await run(() => api.post(`/decisions/${review.id}/${approve ? 'approve' : 'reject'}`, { note }), approve ? 'Keputusan disetujui' : 'Keputusan ditolak');
    if (r) {
      setData((l) => upsert(l, r));
      setReview(null);
      setNote('');
    }
  };
  const list = data || [];
  const pending = list.filter((d) => d.status === 'pending');

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="grow">Log keputusan</h2>
        {pending.length > 0 && <span className="badge warn">{pending.length} menunggu</span>}
        {canCreate && <button className="btn btn-sm btn-primary" onClick={() => setShowForm(true)}><Icon name="plus" /> Keputusan</button>}
      </div>
      <div className={compact ? 'card-scroll' : ''}>
        {list.length === 0 ? <Empty>Belum ada keputusan.</Empty> : (
          <div className="feed">
            {list.map((d) => {
              const st = DECISION_STATUS[d.status];
              return (
                <div className="feed-item" key={d.id}>
                  <span className="feed-time">{fmtSim(d.sim_time_sec, true)}</span>
                  <div className="grow col tight">
                    <div className="strong">{d.decision}</div>
                    <div className="row small muted">
                      <span>{d.user_name}</span>
                      {d.role_name && <RoleTag name={d.role_name} color={d.role_color} />}
                      {d.team_name && <span>· {d.team_name}</span>}
                      {d.owner && <span>· PIC: {d.owner}</span>}
                    </div>
                    {d.rationale && <div className="small">{d.rationale}</div>}
                    <div className="row">
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                      {d.approver_name && d.status !== 'pending' && d.approved_by !== d.user_id && (
                        <span className="small muted">oleh {d.approver_name}{d.sim_approved_sec ? ` · ${fmtSim(d.sim_approved_sec, true)}` : ''}{d.approval_note ? ` — "${d.approval_note}"` : ''}</span>
                      )}
                      {d.status === 'pending' && ex.me.can_approve && live && (
                        <button className="btn btn-sm btn-outline-accent" onClick={() => setReview(d)}>Tinjau</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showForm && <DecisionForm ex={ex} onClose={() => setShowForm(false)} onDone={(d) => setData((l) => upsert(l, d))} />}
      {review && (
        <Modal title="Tinjau keputusan" onClose={() => setReview(null)}
          footer={<><button className="btn btn-danger" disabled={busy} onClick={() => act(false)}>Tolak</button><button className="btn btn-good" disabled={busy} onClick={() => act(true)}>Setujui</button></>}>
          <div className="alert">
            <div className="strong">{review.decision}</div>
            <div className="small muted mt-s">Diajukan oleh {review.user_name}{review.role_name ? ` (${review.role_name})` : ''}</div>
            {review.rationale && <div className="small mt-s">Alasan: {review.rationale}</div>}
          </div>
          <Field label="Catatan persetujuan (opsional)"><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  );
}

/* ================= Pernyataan publik ================= */
export function StatementForm({ ex, onClose }) {
  const [form, setForm] = useState({ title: '', body: '', channel: 'siaran_pers' });
  const [run, busy] = useAction();
  const submit = async () => {
    const r = await run(() => api.post(`/exercises/${ex.id}/statements`, form), 'Pernyataan publik diterbitkan');
    if (r) onClose();
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Modal title="Terbitkan pernyataan publik" onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn btn-primary" disabled={busy || !form.title || !form.body} onClick={submit}>Terbitkan</button></>}>
      <div className="alert warn small">Pernyataan ini akan terlihat oleh seluruh peserta di kanal Publik dan tercatat di laporan.</div>
      <div className="grid g2">
        <Field label="Judul"><input className="input" value={form.title} onChange={set('title')} placeholder="mis. Klarifikasi Gangguan Layanan" /></Field>
        <Field label="Kanal">
          <select className="select" value={form.channel} onChange={set('channel')}>
            {Object.entries(STATEMENT_CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Isi pernyataan"><textarea className="textarea" style={{ minHeight: 180 }} value={form.body} onChange={set('body')} /></Field>
    </Modal>
  );
}

export function StatementList({ ex, compact }) {
  const resync = useResync();
  const { data, setData } = useAsync(() => api.get(`/exercises/${ex.id}/statements`), [ex.id, resync]);
  const [show, setShow] = useState(false);
  useSocketEvent('statement:new', (s) => s.exercise_id === ex.id && setData((l) => upsert(l, s)));
  const live = ex.state && ['running', 'paused'].includes(ex.state.status);
  const list = data || [];
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="grow">Kanal publik</h2>
        {ex.me.can_statement && live && <button className="btn btn-sm btn-primary" onClick={() => setShow(true)}><Icon name="mega" /> Pernyataan</button>}
      </div>
      <div className={compact ? 'card-scroll' : ''}>
        {list.length === 0 ? <Empty>Belum ada pernyataan publik.</Empty> : (
          <div className="feed">
            {list.map((s) => (
              <div className="feed-item" key={s.id}>
                <span className="feed-time">{fmtSim(s.sim_time_sec, true)}</span>
                <div className="grow">
                  <div className="row"><span className="badge info">{STATEMENT_CHANNEL[s.channel] || s.channel}</span><strong>{s.title}</strong></div>
                  <div className="pre small mt-s">{s.body}</div>
                  <div className="tiny muted mt-s">{s.user_name}{s.role_name ? ` · ${s.role_name}` : ''}{s.team_name ? ` · ${s.team_name}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {show && <StatementForm ex={ex} onClose={() => setShow(false)} />}
    </div>
  );
}

/* ================= Eskalasi ================= */
export function EscalationForm({ ex, onClose }) {
  const approvers = ex.roles.filter((r) => r.can_approve && r.id !== ex.me.exercise_role_id);
  const others = ex.roles.filter((r) => !r.can_approve && r.id !== ex.me.exercise_role_id);
  const [form, setForm] = useState({ to_role_id: (approvers[0] || others[0] || {}).id || '', subject: '', body: '' });
  const [run, busy] = useAction();
  const submit = async () => {
    const r = await run(() => api.post(`/exercises/${ex.id}/escalations`, form), 'Eskalasi terkirim');
    if (r) onClose();
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Modal title="Kirim eskalasi" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn btn-danger" disabled={busy || !form.subject || !form.to_role_id} onClick={submit}>Kirim eskalasi</button></>}>
      <Field label="Ditujukan ke peran">
        <select className="select" value={form.to_role_id} onChange={set('to_role_id')}>
          {approvers.length > 0 && <optgroup label="Pengambil keputusan">{approvers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>}
          {others.length > 0 && <optgroup label="Peran lain">{others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>}
        </select>
      </Field>
      <Field label="Perihal"><input className="input" value={form.subject} onChange={set('subject')} placeholder="mis. Backup ikut terenkripsi — butuh keputusan" /></Field>
      <Field label="Detail"><textarea className="textarea" value={form.body} onChange={set('body')} /></Field>
    </Modal>
  );
}

export function EscalationList({ ex, compact }) {
  const resync = useResync();
  const { data, setData } = useAsync(() => api.get(`/exercises/${ex.id}/escalations`), [ex.id, resync]);
  const [show, setShow] = useState(false);
  const [run] = useAction();
  useSocketEvent('escalation:new', (e) => e.exercise_id === ex.id && setData((l) => upsert(l, e)));
  useSocketEvent('escalation:updated', (e) => e.exercise_id === ex.id && setData((l) => upsert(l, e)));
  const live = ex.state && ['running', 'paused'].includes(ex.state.status);
  const list = data || [];
  const canAck = (e) => !e.acknowledged_at && live && (ex.me.is_facilitator || (e.to_role_id === ex.me.exercise_role_id && (!e.team_id || e.team_id === ex.me.team_id)));
  const ack = async (e) => {
    const r = await run(() => api.post(`/escalations/${e.id}/ack`), 'Eskalasi diterima');
    if (r) setData((l) => upsert(l, r));
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="grow">Eskalasi</h2>
        {list.filter((e) => !e.acknowledged_at).length > 0 && <span className="badge bad">{list.filter((e) => !e.acknowledged_at).length} terbuka</span>}
        {ex.me.can_escalate && live && <button className="btn btn-sm btn-danger" onClick={() => setShow(true)}><Icon name="alert" /> Eskalasi</button>}
      </div>
      <div className={compact ? 'card-scroll' : ''}>
        {list.length === 0 ? <Empty>Belum ada eskalasi.</Empty> : (
          <div className="feed">
            {list.map((e) => (
              <div className="feed-item" key={e.id}>
                <span className="feed-time">{fmtSim(e.sim_time_sec, true)}</span>
                <div className="grow col tight">
                  <div className="strong">{e.subject}</div>
                  <div className="small muted">{e.from_name}{e.from_role_name ? ` (${e.from_role_name})` : ''} → <span style={{ color: e.to_role_color }}>{e.to_role_name}</span>{e.team_name ? ` · ${e.team_name}` : ''}</div>
                  {e.body && <div className="small pre">{e.body}</div>}
                  <div className="row">
                    {e.acknowledged_at ? <span className="badge good">Diterima {e.ack_name}{e.sim_ack_sec ? ` · ${fmtSim(e.sim_ack_sec, true)}` : ''}</span> : <span className="badge bad">Belum diterima</span>}
                    {canAck(e) && <button className="btn btn-sm btn-outline-accent" onClick={() => ack(e)}><Icon name="check" /> Terima</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {show && <EscalationForm ex={ex} onClose={() => setShow(false)} />}
    </div>
  );
}
