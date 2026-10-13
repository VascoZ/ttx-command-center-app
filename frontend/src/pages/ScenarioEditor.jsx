import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadJson } from '../api';
import { useAsync, useAction, useConfirm, Loading, ErrorBox, Empty, Icon, Modal, Field } from '../ui';
import { CATEGORY, DIFFICULTY, INJECT_TYPES, PRIORITY, fmtOffset } from '../format';
import { AttachmentEditor } from '../components/Injects';

const ROLE_CODES = [
  ['', '— Semua peran —'],
  ['leader', 'Pimpinan (leader)'],
  ['it_head', 'Kepala TI / CISO (it_head)'],
  ['tech', 'Tim teknis (tech)'],
  ['comms', 'Humas / komunikasi (comms)'],
  ['legal', 'Hukum (legal)'],
  ['audit', 'Pengawas internal (audit)'],
  ['risk', 'Manajemen risiko (risk)'],
  ['ops', 'Operasional / layanan (ops)'],
  ['customer', 'Layanan pelanggan (customer)'],
  ['medical', 'Pelayanan medis (medical)'],
  ['disaster', 'Penanggulangan bencana (disaster)'],
  ['hr', 'SDM (hr)'],
];

function InjectModal({ scenario, inject, onClose, onSaved }) {
  const [f, setF] = useState({ offset_min: 0, type: 'text', priority: 'normal', requires_response: true, target_team: '', target_role: '', attachments: [], ...inject });
  const [opt, setOpt] = useState((inject.options || []).join('\n'));
  const [run, busy] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async () => {
    const body = { ...f, options: opt.split('\n').map((s) => s.trim()).filter(Boolean) };
    const r = await run(() => (f.id ? api.put(`/scenario-injects/${f.id}`, body) : api.post(`/scenarios/${scenario.id}/injects`, body)), 'Inject disimpan');
    if (r) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal title={f.id ? 'Edit inject' : 'Inject baru'} wide onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn btn-primary" disabled={busy || !f.title} onClick={save}>Simpan</button></>}>
      <div className="grid g4">
        <Field label="Menit ke-"><input className="input" type="number" min="0" value={f.offset_min} onChange={set('offset_min')} /></Field>
        <Field label="Jenis"><select className="select" value={f.type} onChange={set('type')}>{Object.entries(INJECT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Prioritas"><select className="select" value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Pengirim / sumber"><input className="input" value={f.sender || ''} onChange={set('sender')} /></Field>
      </div>
      <div className="grid g2">
        <Field label="Target peran (kode)" hint="Dipetakan ke peran preset saat latihan dibuat."><select className="select" value={f.target_role || ''} onChange={set('target_role')}>{ROLE_CODES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Target tim" hint="Dipakai bila target peran kosong."><select className="select" value={f.target_team || ''} onChange={set('target_team')}><option value="">— Semua tim —</option>{scenario.teams.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
      </div>
      <Field label="Judul"><input className="input" value={f.title || ''} onChange={set('title')} /></Field>
      <Field label="Isi"><textarea className="textarea" style={{ minHeight: 120 }} value={f.content || ''} onChange={set('content')} /></Field>
      <div className="grid g2">
        <Field label="Pertanyaan"><textarea className="textarea" value={f.question || ''} onChange={set('question')} /></Field>
        <Field label="Opsi keputusan (satu per baris)"><textarea className="textarea" value={opt} onChange={(e) => setOpt(e.target.value)} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={!!f.requires_response} onChange={set('requires_response')} /> Wajib dijawab</label>
      <Field label="Lampiran"><AttachmentEditor value={f.attachments || []} onChange={(a) => setF((x) => ({ ...x, attachments: a }))} /></Field>
    </Modal>
  );
}

export default function ScenarioEditor() {
  const { id } = useParams();
  const { data: s, error, loading, reload } = useAsync(() => api.get(`/scenarios/${id}`), [id]);
  const presets = useAsync(() => api.get('/role-presets'), []);
  const [form, setForm] = useState(null);
  const [inj, setInj] = useState(null);
  const [objTitle, setObjTitle] = useState('');
  const [run, busy] = useAction();
  const confirm = useConfirm();

  useEffect(() => {
    if (s) setForm({ title: s.title, category: s.category, difficulty: s.difficulty, duration_min: s.duration_min, summary: s.summary || '', narrative: s.narrative || '', teams: s.teams.join('\n'), preset_id: s.preset_id || '', industry: s.industry || '', threat_type: s.threat_type || '' });
  }, [s]);

  if (loading && !s) return <Loading />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!form) return <Loading />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = () => run(() => api.put(`/scenarios/${id}`, { ...form, teams: form.teams.split('\n').map((t) => t.trim()).filter(Boolean), preset_id: form.preset_id || null }), 'Skenario disimpan').then((r) => r && reload());

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <Link to="/scenarios" className="small muted">Pustaka skenario</Link>
          <h1>{s.title}</h1>
          <p>{s.injects.length} inject · {s.objectives.length} objective · sumber: {s.source}</p>
        </div>
        <button className="btn" onClick={() => run(() => api.get(`/scenarios/${id}/export`)).then((r) => r && downloadJson(r, `skenario-${id}.json`))}><Icon name="download" /> Ekspor</button>
        <Link className="btn" to={`/exercises?new=1&scenario=${id}`}><Icon name="play" /> Pakai untuk latihan</Link>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Simpan perubahan</button>
      </div>
      <div className="split">
        <div className="main-col">
          <div className="card card-pad col">
            <Field label="Judul"><input className="input" value={form.title} onChange={set('title')} /></Field>
            <div className="grid g4">
              <Field label="Kategori"><select className="select" value={form.category} onChange={set('category')}>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Kesulitan"><select className="select" value={form.difficulty} onChange={set('difficulty')}>{Object.entries(DIFFICULTY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Durasi (menit)"><input className="input" type="number" value={form.duration_min} onChange={set('duration_min')} /></Field>
              <Field label="Preset peran"><select className="select" value={form.preset_id} onChange={set('preset_id')}><option value="">—</option>{(presets.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            </div>
            <Field label="Ringkasan"><textarea className="textarea" value={form.summary} onChange={set('summary')} /></Field>
            <Field label="Narasi pembuka"><textarea className="textarea" style={{ minHeight: 140 }} value={form.narrative} onChange={set('narrative')} /></Field>
          </div>
          <div className="card">
            <div className="card-head"><h2 className="grow">Inject ({s.injects.length})</h2><button className="btn btn-sm btn-primary" onClick={() => setInj({})}><Icon name="plus" /> Inject</button></div>
            {s.injects.length === 0 ? <Empty>Belum ada inject.</Empty> : (
              <div className="table-wrap">
                <table className="table" style={{ minWidth: 640 }}>
                  <thead><tr><th>Waktu</th><th>Inject</th><th>Target</th><th /></tr></thead>
                  <tbody>
                    {s.injects.map((i) => (
                      <tr key={i.id} className="clickable" onClick={() => setInj(i)}>
                        <td className="mono">{fmtOffset(i.offset_min)}</td>
                        <td><div className="strong">{i.title}</div><div className="small muted">{INJECT_TYPES[i.type]} · {PRIORITY[i.priority].label}{i.options.length ? ` · ${i.options.length} opsi` : ''}</div></td>
                        <td className="small">{i.target_role || i.target_team || 'Semua'}</td>
                        <td className="right"><button className="btn btn-ghost icon-btn" aria-label="Hapus inject" onClick={async (e) => { e.stopPropagation(); if (await confirm(`Hapus inject "${i.title}"?`, { danger: true, confirmLabel: 'Hapus' })) { await run(() => api.del(`/scenario-injects/${i.id}`)); reload(); } }}><Icon name="trash" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="side-col">
          <div className="card card-pad col">
            <Field label="Tim (satu per baris)" hint="Tim dibuat otomatis saat latihan dibuat."><textarea className="textarea" value={form.teams} onChange={set('teams')} /></Field>
          </div>
          <div className="card">
            <div className="card-head"><h2>Objective</h2></div>
            <div className="card-body col tight">
              {s.objectives.map((o, i) => (
                <div key={o.id} className="row nowrap-row start">
                  <span className="mono muted">{i + 1}.</span>
                  <div className="grow"><div className="strong">{o.title}</div><div className="small muted">{o.description}</div></div>
                  <button className="btn btn-ghost icon-btn" aria-label="Hapus objective" onClick={async () => { await run(() => api.del(`/scenario-objectives/${o.id}`)); reload(); }}><Icon name="trash" /></button>
                </div>
              ))}
              <form className="row nowrap-row mt" onSubmit={async (e) => { e.preventDefault(); if (objTitle.trim() && (await run(() => api.post(`/scenarios/${id}/objectives`, { title: objTitle })))) { setObjTitle(''); reload(); } }}>
                <input className="input grow" placeholder="Objective baru" value={objTitle} onChange={(e) => setObjTitle(e.target.value)} aria-label="Objective baru" />
                <button className="btn"><Icon name="plus" /></button>
              </form>
            </div>
          </div>
        </div>
      </div>
      {inj && <InjectModal scenario={s} inject={inj} onClose={() => setInj(null)} onSaved={reload} />}
    </div>
  );
}
