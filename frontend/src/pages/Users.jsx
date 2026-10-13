import { useState } from 'react';
import { api } from '../api';
import { useAuth, ROLE_LABEL } from '../auth';
import { useAsync, useAction, useConfirm, Loading, ErrorBox, Empty, Icon, Modal, Field } from '../ui';
import { fmtDateTime } from '../format';

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const hasHeader = head.includes('email');
  const cols = hasHeader ? head : ['email', 'name', 'role', 'password', 'organization'];
  return (hasHeader ? lines.slice(1) : lines).map((l) => {
    const v = l.split(sep).map((x) => x.trim());
    const o = {};
    cols.forEach((c, i) => (o[c] = v[i]));
    return o;
  });
}

export default function Users() {
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.get('/users'), []);
  const [edit, setEdit] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [q, setQ] = useState('');
  const [run, busy] = useAction();
  const confirm = useConfirm();

  const save = async () => {
    const body = { ...edit };
    if (!body.password) delete body.password;
    const r = await run(() => (edit.id ? api.put(`/users/${edit.id}`, body) : api.post('/users', body)), 'Pengguna disimpan');
    if (r) {
      setEdit(null);
      reload();
    }
  };
  const doBulk = async () => {
    const users = parseCsv(bulk.text);
    const r = await run(() => api.post('/users/bulk', { users }));
    if (r) {
      setBulk({ ...bulk, result: r });
      reload();
    }
  };
  const list = (data || []).filter((u) => !q || `${u.name} ${u.email} ${u.organization || ''}`.toLowerCase().includes(q.toLowerCase()));

  if (loading && !data) return <Loading />;
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow"><h1>Pengguna</h1><p>{(data || []).length} akun terdaftar.</p></div>
        <button className="btn" onClick={() => setBulk({ text: 'email,name,role,password,organization\n' })}><Icon name="upload" /> Impor massal (CSV)</button>
        <button className="btn btn-primary" onClick={() => setEdit({ email: '', name: '', role: 'player', password: '', organization: '', is_active: true })}><Icon name="plus" /> Pengguna baru</button>
      </div>
      <input className="input" style={{ maxWidth: 360 }} placeholder="Cari nama, email, organisasi…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari pengguna" />
      <ErrorBox error={error} />
      <div className="card">
        {list.length === 0 ? <Empty>Tidak ada pengguna.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nama</th><th>Peran global</th><th>Organisasi</th><th>Status</th><th>Login terakhir</th><th /></tr></thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id}>
                    <td><div className="strong">{u.name}</div><div className="small muted">{u.email}</div></td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td className="small">{u.organization || '–'}</td>
                    <td>{u.is_active ? <span className="badge good">aktif</span> : <span className="badge">nonaktif</span>}</td>
                    <td className="small muted">{u.last_login_at ? fmtDateTime(u.last_login_at) : 'belum pernah'}</td>
                    <td className="right nowrap">
                      <button className="btn btn-sm btn-ghost" aria-label={`Edit ${u.name}`} onClick={() => setEdit({ ...u, password: '' })}><Icon name="edit" /></button>
                      {u.id !== me.id && (
                        <button className="btn btn-sm btn-ghost" aria-label={`Hapus ${u.name}`} onClick={async () => (await confirm(`Hapus akun ${u.name}? Riwayat aktivitasnya tetap tersimpan tanpa nama.`, { danger: true, confirmLabel: 'Hapus' })) && run(() => api.del(`/users/${u.id}`)).then((r) => r && reload())}><Icon name="trash" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit pengguna' : 'Pengguna baru'} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>Batal</button><button className="btn btn-primary" disabled={busy || !edit.email || !edit.name} onClick={save}>Simpan</button></>}>
          <div className="grid g2">
            <Field label="Nama"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Email"><input className="input" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          </div>
          <div className="grid g2">
            <Field label="Peran global">
              <select className="select" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Organisasi / unit"><input className="input" value={edit.organization || ''} onChange={(e) => setEdit({ ...edit, organization: e.target.value })} /></Field>
          </div>
          <Field label={edit.id ? 'Password baru (kosongkan bila tidak diubah)' : 'Password (min. 8 karakter)'}><input className="input" type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
          {edit.id && <label className="check"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Akun aktif</label>}
          <div className="small muted">Peran global menentukan menu yang tersedia. Peran player (mis. Humas, CSIRT) diatur per latihan.</div>
        </Modal>
      )}
      {bulk && (
        <Modal title="Impor pengguna massal" wide onClose={() => setBulk(null)}
          footer={<><button className="btn" onClick={() => setBulk(null)}>Tutup</button><button className="btn btn-primary" disabled={busy} onClick={doBulk}>Impor</button></>}>
          <p className="small muted">Format CSV: <span className="mono">email,name,role,password,organization</span>. Role: admin, designer, facilitator, player, evaluator, viewer. Pemisah koma atau titik koma.</p>
          <label className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
            <Icon name="upload" /> Pilih file CSV
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files[0]; if (f) setBulk({ text: await f.text() }); }} />
          </label>
          <textarea className="textarea mono" style={{ minHeight: 200 }} value={bulk.text} onChange={(e) => setBulk({ text: e.target.value })} aria-label="Data CSV" />
          {bulk.result && (
            <div className="col tight">
              <div className="alert good small">{bulk.result.created.length} pengguna dibuat.</div>
              {bulk.result.errors.length > 0 && <div className="alert bad small">{bulk.result.errors.map((e) => <div key={e.row}>Baris {e.row} ({e.email || '–'}): {e.error}</div>)}</div>}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
