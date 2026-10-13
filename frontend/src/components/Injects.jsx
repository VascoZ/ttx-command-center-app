import { useState } from 'react';
import { api } from '../api';
import { useAction, useConfirm, Modal, Field, Icon, Empty, RoleTag } from '../ui';
import { INJECT_TYPES, PRIORITY, fmtOffset, fmtSim } from '../format';
import { InjectBody, InjectMeta } from './InjectView';

/** Unggah lampiran ke server. */
export function AttachmentEditor({ value = [], onChange }) {
  const [run, busy] = useAction();
  const add = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const r = await run(() => api.upload(f));
    if (r) onChange([...value, r]);
  };
  return (
    <div className="col tight">
      <div className="row">
        {value.map((a, i) => (
          <span key={i} className="chip">
            {a.name}
            <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 20, padding: 0 }} aria-label={`Hapus ${a.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
          </span>
        ))}
      </div>
      <label className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
        <Icon name="upload" /> {busy ? 'Mengunggah…' : 'Tambah lampiran'}
        <input type="file" className="sr-only" onChange={add} accept="image/*,application/pdf,audio/*,video/mp4,.txt,.csv,.docx,.xlsx" />
      </label>
    </div>
  );
}

const blank = { offset_min: 0, title: '', type: 'text', priority: 'normal', sender: '', content: '', question: '', options: [], requires_response: true, attachments: [], team_id: '', exercise_role_id: '' };

/** Editor inject latihan (juga dipakai untuk inject ad-hoc). */
export function InjectEditor({ ex, inject, onClose, onSaved, simNow = 0 }) {
  const isNew = !inject || !inject.id;
  const live = ['running', 'paused'].includes(ex.state.status);
  const [f, setF] = useState(() => ({
    ...blank,
    ...(inject || {}),
    offset_min: inject && inject.id ? inject.offset_min : live ? Math.ceil(simNow / 60) + 5 : 0,
    team_id: (inject && inject.team_id) || '',
    exercise_role_id: (inject && inject.exercise_role_id) || '',
  }));
  const [optText, setOptText] = useState(((inject && inject.options) || []).join('\n'));
  const [run, busy] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async (sendNow) => {
    const body = {
      ...f,
      options: optText.split('\n').map((s) => s.trim()).filter(Boolean),
      team_id: f.team_id || null,
      exercise_role_id: f.exercise_role_id || null,
      send_now: !!sendNow,
    };
    const r = await run(
      () => (isNew ? api.post(`/exercises/${ex.id}/injects`, body) : api.put(`/exercise-injects/${inject.id}`, body)),
      sendNow ? 'Inject terkirim' : 'Inject disimpan'
    );
    if (r) {
      onSaved && onSaved(r);
      onClose();
    }
  };

  return (
    <Modal title={isNew ? (live ? 'Inject ad-hoc' : 'Tambah inject') : 'Edit inject'} onClose={onClose} wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Batal</button>
          {isNew && live && <button className="btn btn-primary" disabled={busy || !f.title} onClick={() => save(true)}><Icon name="send" /> Kirim sekarang</button>}
          <button className={`btn ${isNew && live ? '' : 'btn-primary'}`} disabled={busy || !f.title} onClick={() => save(false)}>{isNew && live ? 'Jadwalkan' : 'Simpan'}</button>
        </>
      }>
      {inject && inject.status === 'sent' && <div className="alert warn small">Inject ini sudah terkirim. Perubahan langsung terlihat oleh peserta.</div>}
      <div className="grid g4">
        <Field label="Waktu (menit simulasi)"><input className="input" type="number" min="0" value={f.offset_min} onChange={set('offset_min')} /></Field>
        <Field label="Jenis">
          <select className="select" value={f.type} onChange={set('type')}>{Object.entries(INJECT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Prioritas">
          <select className="select" value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </Field>
        <Field label="Pengirim / sumber"><input className="input" value={f.sender || ''} onChange={set('sender')} /></Field>
      </div>
      <div className="grid g2">
        <Field label="Target peran" hint="Kosongkan agar tidak dibatasi peran.">
          <select className="select" value={f.exercise_role_id} onChange={set('exercise_role_id')}>
            <option value="">— Semua peran —</option>
            {ex.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Target tim" hint="Bila diisi bersama peran, hanya peserta yang cocok keduanya.">
          <select className="select" value={f.team_id} onChange={set('team_id')}>
            <option value="">— Semua tim —</option>
            {ex.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Judul"><input className="input" value={f.title} onChange={set('title')} /></Field>
      <Field label="Isi inject"><textarea className="textarea" style={{ minHeight: 120 }} value={f.content || ''} onChange={set('content')} /></Field>
      <div className="grid g2">
        <Field label="Pertanyaan untuk peserta"><textarea className="textarea" value={f.question || ''} onChange={set('question')} /></Field>
        <Field label="Opsi keputusan (satu per baris, opsional)"><textarea className="textarea" value={optText} onChange={(e) => setOptText(e.target.value)} /></Field>
      </div>
      <div className="row between">
        <label className="check"><input type="checkbox" checked={!!f.requires_response} onChange={set('requires_response')} /> Wajib dijawab</label>
      </div>
      <Field label="Lampiran"><AttachmentEditor value={f.attachments || []} onChange={(a) => setF((x) => ({ ...x, attachments: a }))} /></Field>
    </Modal>
  );
}

/** Detail inject + respons masuk (untuk staf). */
export function InjectDetail({ ex, inject, onClose }) {
  return (
    <Modal title={inject.title} onClose={onClose} wide>
      <InjectMeta inj={inject} roles={ex.roles} teams={ex.teams} />
      <InjectBody inj={inject} />
      {inject.question && <div className="alert info"><strong>Pertanyaan:</strong> {inject.question}</div>}
      {inject.options && inject.options.length > 0 && <div className="row">{inject.options.map((o) => <span key={o} className="chip">{o}</span>)}</div>}
      <h3>Respons ({(inject.responses || []).length})</h3>
      {(inject.responses || []).length === 0 ? <Empty>Belum ada respons.</Empty> : (
        <div className="col">
          {inject.responses.map((r) => (
            <div key={r.id} className="card card-pad col tight">
              <div className="row small">
                <strong>{r.team_name || r.user_name}</strong>
                {r.role_name && <RoleTag name={r.role_name} />}
                <span className="muted">oleh {r.user_name}</span>
                <span className="mono muted">{fmtSim(r.sim_time_sec, true)}</span>
                {inject.sim_sent_sec !== null && <span className="badge">{Math.round((r.sim_time_sec - inject.sim_sent_sec) / 6) / 10} mnt</span>}
              </div>
              {r.choice && <div><span className="badge warn">Pilihan: {r.choice}</span></div>}
              {r.content && <div className="pre">{r.content}</div>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Tabel timeline inject untuk fasilitator/evaluator. */
export function InjectTable({ ex, injects, setInjects, simNow, readOnly }) {
  const [edit, setEdit] = useState(null);
  const [detail, setDetail] = useState(null);
  const [run] = useAction();
  const confirm = useConfirm();
  const live = ['running', 'paused'].includes(ex.state.status);
  const fac = ex.me.is_facilitator && !readOnly;
  const upd = (r) => setInjects((l) => (l.some((x) => x.id === r.id) ? l.map((x) => (x.id === r.id ? { ...x, ...r } : x)) : [...l, { ...r, responses: [] }]).sort((a, b) => a.offset_min - b.offset_min || a.id - b.id));

  const roleOf = (i) => ex.roles.find((r) => r.id === i.exercise_role_id);
  const teamOf = (i) => ex.teams.find((t) => t.id === i.team_id);

  const statusBadge = (i) => {
    if (i.status === 'skipped') return <span className="badge">Dilewati</span>;
    if (i.status === 'scheduled') {
      const left = i.offset_min * 60 - simNow;
      return <span className="badge">{live && left > 0 ? `Dalam ${Math.ceil(left / 60)} mnt` : 'Terjadwal'}</span>;
    }
    const n = (i.responses || []).length;
    if (!i.requires_response) return <span className="badge info">Terkirim</span>;
    if (n === 0) {
      const wait = Math.floor((simNow - Number(i.sim_sent_sec || 0)) / 60);
      return <span className="badge warn">Menunggu · {wait} mnt</span>;
    }
    return <span className="badge good">{n} respons</span>;
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="grow">Timeline inject</h2>
        <span className="small muted">{injects.filter((i) => i.status === 'sent').length}/{injects.length} terkirim</span>
        {fac && ex.state.status !== 'ended' && (
          <button className="btn btn-sm btn-primary" onClick={() => setEdit({})}><Icon name="plus" /> {live ? 'Inject ad-hoc' : 'Tambah inject'}</button>
        )}
      </div>
      {injects.length === 0 ? <Empty>Belum ada inject.</Empty> : (
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 760 }}>
            <thead><tr><th>Waktu</th><th>Inject</th><th>Target</th><th>Status</th><th className="right">Aksi</th></tr></thead>
            <tbody>
              {injects.map((i) => {
                const role = roleOf(i);
                const team = teamOf(i);
                const next = i.status === 'scheduled' && live && i.offset_min * 60 - simNow <= 300 && i.offset_min * 60 - simNow > 0;
                return (
                  <tr key={i.id} className={next ? 'highlight' : ''}>
                    <td className="mono nowrap">{i.status === 'sent' && i.sim_sent_sec !== null ? fmtSim(i.sim_sent_sec, true) : fmtOffset(i.offset_min)}</td>
                    <td>
                      <button className="btn-ghost" style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--text)' }} onClick={() => setDetail(i)}>
                        <div className="strong">{i.title}</div>
                      </button>
                      <div className="small muted">
                        {INJECT_TYPES[i.type]}
                        {i.priority !== 'normal' && <> · <span style={{ color: i.priority === 'kritis' ? 'var(--bad-text)' : 'var(--accent)' }}>{PRIORITY[i.priority].label.toLowerCase()}</span></>}
                        {i.adhoc && ' · ad-hoc'}
                      </div>
                    </td>
                    <td className="small">{role ? <RoleTag name={role.name} color={role.color} /> : team ? team.name : 'Semua peserta'}{role && team ? <div className="muted">{team.name}</div> : null}</td>
                    <td>{statusBadge(i)}</td>
                    <td className="right nowrap">
                      <button className="btn btn-sm btn-ghost" onClick={() => setDetail(i)} aria-label="Lihat"><Icon name="eye" /></button>
                      {fac && i.status === 'scheduled' && live && (
                        <button className="btn btn-sm btn-outline-accent" onClick={() => run(() => api.post(`/exercise-injects/${i.id}/send`), 'Inject terkirim').then((r) => r && upd(r))}>Kirim</button>
                      )}
                      {fac && i.status === 'scheduled' && live && (
                        <button className="btn btn-sm btn-ghost" onClick={() => run(() => api.post(`/exercise-injects/${i.id}/skip`)).then((r) => r && upd(r))}>Lewati</button>
                      )}
                      {fac && i.status === 'skipped' && (
                        <button className="btn btn-sm btn-ghost" onClick={() => run(() => api.post(`/exercise-injects/${i.id}/unskip`)).then((r) => r && upd(r))}>Pulihkan</button>
                      )}
                      {fac && ex.state.status !== 'ended' && (
                        <button className="btn btn-sm btn-ghost" onClick={() => setEdit(i)} aria-label="Edit"><Icon name="edit" /></button>
                      )}
                      {fac && i.status !== 'sent' && (
                        <button className="btn btn-sm btn-ghost" aria-label="Hapus" onClick={async () => {
                          if (await confirm(`Hapus inject "${i.title}"?`, { danger: true, confirmLabel: 'Hapus' })) {
                            const r = await run(() => api.del(`/exercise-injects/${i.id}`));
                            if (r) setInjects((l) => l.filter((x) => x.id !== i.id));
                          }
                        }}><Icon name="trash" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && <InjectEditor ex={ex} inject={edit.id ? edit : null} simNow={simNow} onClose={() => setEdit(null)} onSaved={upd} />}
      {detail && <InjectDetail ex={ex} inject={injects.find((x) => x.id === detail.id) || detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
