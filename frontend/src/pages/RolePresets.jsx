import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useAsync, useAction, useConfirm, Loading, ErrorBox, Empty, Icon, Modal, Field } from '../ui';
import { RoleFormFields } from './console/Setup';

export default function RolePresets() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.get('/role-presets'), []);
  const [active, setActive] = useState(null);
  const [edit, setEdit] = useState(null);
  const [presetModal, setPresetModal] = useState(null);
  const [f, setF] = useState({});
  const [run, busy] = useAction();
  const confirm = useConfirm();
  useEffect(() => {
    if (data && data.length && !data.some((p) => p.id === active)) setActive(data[0].id);
  }, [data, active]);
  useEffect(() => setF(edit || {}), [edit]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  if (loading && !data) return <Loading />;
  const preset = (data || []).find((p) => p.id === active);

  const saveRole = async () => {
    const r = await run(() => (f.id ? api.put(`/player-roles/${f.id}`, f) : api.post(`/role-presets/${preset.id}/roles`, f)), 'Peran disimpan');
    if (r) {
      setEdit(null);
      reload();
    }
  };
  const savePreset = async () => {
    const pm = presetModal;
    const r = await run(() => (pm.id ? api.put(`/role-presets/${pm.id}`, pm) : api.post('/role-presets', pm)), 'Preset disimpan');
    if (r) {
      setPresetModal(null);
      await reload();
      setActive(r.id);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow"><h1>Peran player kustom</h1><p>Preset sektor menentukan peran yang tersedia saat membuat latihan. Inject dapat ditujukan ke peran tertentu.</p></div>
        <button className="btn" onClick={() => setPresetModal({ name: '', sector: '', description: '', copy_from: active || '' })}><Icon name="plus" /> Preset baru</button>
        {preset && <button className="btn btn-primary" onClick={() => setEdit({ color: '#4C9AFF' })}><Icon name="plus" /> Tambah peran</button>}
      </div>
      <ErrorBox error={error} />
      <div className="pills" role="tablist">
        {(data || []).map((p) => (
          <button key={p.id} role="tab" aria-selected={active === p.id} className={`pill ${active === p.id ? 'active' : ''}`} onClick={() => setActive(p.id)}>
            {p.name} · {p.roles.length}
          </button>
        ))}
      </div>
      {preset && (
        <>
          <div className="row">
            <div className="grow small muted">{preset.description} {preset.is_builtin && <span className="badge">bawaan</span>}</div>
            <button className="btn btn-sm btn-ghost" onClick={() => setPresetModal({ id: preset.id, name: preset.name, sector: preset.sector || '', description: preset.description || '' })}><Icon name="edit" /> Edit preset</button>
            {(!preset.is_builtin || user.role === 'admin') && (
              <button className="btn btn-sm btn-ghost" onClick={async () => (await confirm(`Hapus preset "${preset.name}" beserta perannya? Latihan yang sudah dibuat tidak terpengaruh.`, { danger: true, confirmLabel: 'Hapus' })) && run(() => api.del(`/role-presets/${preset.id}`)).then((r) => r && reload())}><Icon name="trash" /> Hapus preset</button>
            )}
          </div>
          {preset.roles.length === 0 ? <div className="card"><Empty>Preset ini belum memiliki peran.</Empty></div> : (
            <div className="grid gauto">
              {preset.roles.map((r) => (
                <div key={r.id} className="role-card" style={{ borderTopColor: r.color }}>
                  <div className="row nowrap-row start">
                    <div className="grow"><div className="strong" style={{ fontSize: 16 }}>{r.name}</div><div className="small muted">{r.subtitle}</div></div>
                    <button className="btn btn-ghost icon-btn" aria-label={`Edit ${r.name}`} onClick={() => setEdit(r)}><Icon name="edit" /></button>
                    <button className="btn btn-ghost icon-btn" aria-label={`Hapus ${r.name}`} onClick={async () => (await confirm(`Hapus peran "${r.name}"?`, { danger: true, confirmLabel: 'Hapus' })) && run(() => api.del(`/player-roles/${r.id}`)).then((x) => x && reload())}><Icon name="trash" /></button>
                  </div>
                  <p className="small" style={{ color: 'var(--text-2)' }}>{r.description}</p>
                  <div className="row">
                    {r.can_approve && <span className="badge info">Menyetujui keputusan</span>}
                    {r.can_statement && <span className="badge warn">Pernyataan publik</span>}
                    {r.can_escalate && <span className="badge bad">Eskalasi</span>}
                    {!r.can_approve && !r.can_statement && !r.can_escalate && <span className="small muted">Tanpa kewenangan khusus</span>}
                    {r.code && <span className="tiny muted mono">kode: {r.code}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit peran' : `Peran baru di ${preset.name}`} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>Batal</button><button className="btn btn-primary" disabled={busy || !f.name} onClick={saveRole}>Simpan</button></>}>
          <RoleFormFields f={f} set={set} />
        </Modal>
      )}
      {presetModal && (
        <Modal title={presetModal.id ? 'Edit preset' : 'Preset baru'} onClose={() => setPresetModal(null)}
          footer={<><button className="btn" onClick={() => setPresetModal(null)}>Batal</button><button className="btn btn-primary" disabled={busy || !presetModal.name} onClick={savePreset}>Simpan</button></>}>
          <Field label="Nama preset"><input className="input" value={presetModal.name} onChange={(e) => setPresetModal({ ...presetModal, name: e.target.value })} placeholder="mis. Pemerintah Provinsi Jawa Barat" /></Field>
          <Field label="Sektor"><input className="input" value={presetModal.sector} onChange={(e) => setPresetModal({ ...presetModal, sector: e.target.value })} /></Field>
          <Field label="Deskripsi"><textarea className="textarea" value={presetModal.description} onChange={(e) => setPresetModal({ ...presetModal, description: e.target.value })} /></Field>
          {!presetModal.id && (
            <Field label="Salin peran dari preset (opsional)">
              <select className="select" value={presetModal.copy_from} onChange={(e) => setPresetModal({ ...presetModal, copy_from: e.target.value })}>
                <option value="">— Mulai kosong —</option>
                {(data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
        </Modal>
      )}
    </div>
  );
}
