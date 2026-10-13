import { useState } from 'react';
import { api } from '../api';
import { useAsync, useAction, useConfirm, useToast, Loading, ErrorBox, Empty, Icon, Modal, Field } from '../ui';

export const fmtToken = (t) => (t || '').replace(/(.{4})(?=.)/g, '$1-');

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API tidak tersedia di http non-localhost
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function TeamCard({ t, presets, reload }) {
  const [run] = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const preset = presets.find((p) => p.id === t.preset_id);
  const act = async (fn, msg) => {
    if (await run(fn, msg)) reload();
  };
  const copy = async () => {
    const ok = await copyText(fmtToken(t.join_token));
    toast(ok ? { title: `Token ${t.name} disalin`, kind: 'good' } : { title: 'Gagal menyalin', body: 'Salin token secara manual.', kind: 'bad' });
  };
  const regenerate = async () => {
    if (await confirm(`Buat token baru untuk "${t.name}"? Token lama langsung tidak berlaku. Anggota yang sudah bergabung tidak terpengaruh.`, { confirmLabel: 'Buat token baru' }))
      act(() => api.post(`/org-teams/${t.id}/token`), 'Token baru dibuat');
  };
  const remove = async () => {
    if (await confirm(`Hapus tim "${t.name}"? Anggota keluar dari tim. Riwayat latihan yang sudah berjalan tetap tersimpan.`, { danger: true, confirmLabel: 'Hapus' }))
      act(() => api.del(`/org-teams/${t.id}`), 'Tim dihapus');
  };
  const filled = new Set(t.members.map((m) => m.player_role_id).filter(Boolean));

  return (
    <div className="card">
      <div className="card-head">
        <input type="color" aria-label={`Warna ${t.name}`} value={t.color} onChange={(e) => act(() => api.put(`/org-teams/${t.id}`, { color: e.target.value }))} style={{ width: 28, height: 28, border: 'none', background: 'none', padding: 0 }} />
        <input className="input grow strong" defaultValue={t.name} aria-label="Nama tim" onBlur={(e) => e.target.value !== t.name && act(() => api.put(`/org-teams/${t.id}`, { name: e.target.value }), 'Tim diperbarui')} />
        <button className="btn btn-ghost icon-btn" aria-label={`Hapus ${t.name}`} onClick={remove}><Icon name="trash" /></button>
      </div>
      <div className="card-body col">
        <div className="row nowrap-row">
          <Icon name="key" />
          <span className="mono strong grow" style={{ fontSize: 18, letterSpacing: '0.14em', opacity: t.join_enabled ? 1 : 0.4 }}>{fmtToken(t.join_token)}</span>
          <button className="btn btn-sm" onClick={copy}><Icon name="copy" /> Salin</button>
          <button className="btn btn-ghost icon-btn" aria-label="Buat token baru" title="Buat token baru" onClick={regenerate}><Icon name="undo" /></button>
          <label className="check small nowrap">
            <input type="checkbox" checked={t.join_enabled} onChange={(e) => act(() => api.put(`/org-teams/${t.id}`, { join_enabled: e.target.checked }), e.target.checked ? 'Token diaktifkan' : 'Token dinonaktifkan')} /> Aktif
          </label>
        </div>
        <Field label="Set peran (preset)">
          <select className="select" value={t.preset_id || ''} onChange={async (e) => {
            if (t.members.length && !(await confirm('Ganti set peran? Peran anggota yang tidak ada di preset baru akan dilepas.', { confirmLabel: 'Ganti' }))) return;
            act(() => api.put(`/org-teams/${t.id}`, { preset_id: e.target.value || null }), 'Set peran diganti');
          }}>
            <option value="">— Tanpa peran —</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        {preset && (
          <div className="small">
            <span className="muted">Peran terisi {filled.size}/{preset.roles.length}: </span>
            {preset.roles.map((r) => (
              <span key={r.id} className={`badge ${filled.has(r.id) ? 'good' : ''}`} style={{ margin: '2px 4px 2px 0' }}>{r.name}</span>
            ))}
          </div>
        )}
        <div>
          <div className="field-label">Anggota ({t.members.length})</div>
          {t.members.length === 0 ? <div className="small muted">Belum ada anggota. Bagikan token ke perwakilan instansi.</div> : (
            <div className="col tight mt-s">
              {t.members.map((m) => (
                <div key={m.user_id} className="row nowrap-row" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                    <div className="tiny muted">{m.email}</div>
                  </div>
                  <label className="check tiny nowrap" title="Koordinator dapat melamarkan seluruh tim dan melihat kesiapan anggota">
                    <input type="checkbox" checked={m.is_coordinator} onChange={(e) => act(() => api.put(`/org-teams/${t.id}/members/${m.user_id}`, { is_coordinator: e.target.checked }), e.target.checked ? `${m.name} menjadi koordinator` : 'Koordinator dilepas')} /> Koordinator
                  </label>
                  <select className="select" style={{ width: 'auto', maxWidth: 200 }} aria-label={`Peran ${m.name}`} value={m.player_role_id || ''} onChange={(e) => act(() => api.put(`/org-teams/${t.id}/members/${m.user_id}`, { player_role_id: e.target.value || null }), 'Peran diubah')}>
                    <option value="">—</option>
                    {(preset ? preset.roles : []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <button className="btn btn-ghost icon-btn" aria-label={`Keluarkan ${m.name}`} onClick={async () => (await confirm(`Keluarkan ${m.name} dari tim ${t.name}?`, { danger: true, confirmLabel: 'Keluarkan' })) && act(() => api.del(`/org-teams/${t.id}/members/${m.user_id}`), 'Anggota dikeluarkan')}><Icon name="x" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OrgTeams() {
  const { data, error, loading, reload } = useAsync(() => api.get('/org-teams'), []);
  const presets = useAsync(() => api.get('/role-presets'), []);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', preset_id: '' });
  const [run, busy] = useAction();

  const create = async () => {
    const r = await run(() => api.post('/org-teams', { ...form, preset_id: form.preset_id || null }), 'Tim dibuat');
    if (r) {
      setCreating(false);
      setForm({ name: '', preset_id: '' });
      reload();
    }
  };

  if (loading && !data) return <Loading />;
  const presetList = presets.data || [];
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Tim instansi</h1>
          <p>Satu tim per instansi. Bagikan token ke instansi terkait; peserta bergabung lewat menu <strong>Tim saya</strong>, mengambil peran, lalu melamar ke latihan yang dipublikasikan. Token hanya terlihat oleh admin.</p>
        </div>
        <button className="btn btn-primary" onClick={() => {
          setForm({ name: '', preset_id: (presetList.find((p) => p.name === 'Pemerintah Daerah') || presetList[0] || {}).id || '' });
          setCreating(true);
        }}><Icon name="plus" /> Tim baru</button>
      </div>
      <ErrorBox error={error} />
      {data && data.length === 0 && <div className="card"><Empty>Belum ada tim instansi.</Empty></div>}
      <div className="grid g2">
        {(data || []).map((t) => <TeamCard key={t.id} t={t} presets={presetList} reload={reload} />)}
      </div>
      {creating && (
        <Modal title="Tim instansi baru" onClose={() => setCreating(false)}
          footer={<><button className="btn" onClick={() => setCreating(false)}>Batal</button><button className="btn btn-primary" disabled={busy || !form.name.trim()} onClick={create}>Buat tim</button></>}>
          <Field label="Nama instansi"><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Pemkab Sukamaju" /></Field>
          <Field label="Set peran (preset)" hint="Menentukan peran yang dapat dipilih anggota. Sebaiknya sama dengan preset latihan agar peran terpetakan otomatis.">
            <select className="select" value={form.preset_id} onChange={(e) => setForm({ ...form, preset_id: e.target.value })}>
              <option value="">— Tanpa peran —</option>
              {presetList.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.roles.length} peran)</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  );
}
