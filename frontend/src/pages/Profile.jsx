import { useState } from 'react';
import { api } from '../api';
import { useAuth, ROLE_LABEL } from '../auth';
import { useAction, Field } from '../ui';

export default function Profile() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [org, setOrg] = useState(user.organization || '');
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [run, busy] = useAction();
  const saveProfile = async () => {
    const r = await run(() => api.put('/auth/profile', { name, organization: org }), 'Profil disimpan');
    if (r) setUser((u) => ({ ...u, ...r.user }));
  };
  const savePw = async () => {
    if (pw.new_password !== pw.confirm) return run(() => Promise.reject(new Error('Konfirmasi password tidak cocok')));
    const r = await run(() => api.post('/auth/password', pw), 'Password diganti');
    if (r) setPw({ current_password: '', new_password: '', confirm: '' });
    return r;
  };
  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Profil</h1><p>{user.email} · {ROLE_LABEL[user.role]}</p></div></div>
      <div className="grid g2" style={{ maxWidth: 900 }}>
        <div className="card card-pad col">
          <h2>Data diri</h2>
          <Field label="Nama"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Organisasi / unit"><input className="input" value={org} onChange={(e) => setOrg(e.target.value)} /></Field>
          <div><button className="btn btn-primary" disabled={busy} onClick={saveProfile}>Simpan</button></div>
        </div>
        <div className="card card-pad col">
          <h2>Ganti password</h2>
          <Field label="Password saat ini"><input className="input" type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
          <Field label="Password baru (min. 8 karakter)"><input className="input" type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
          <Field label="Ulangi password baru"><input className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          <div><button className="btn btn-primary" disabled={busy || pw.new_password.length < 8} onClick={savePw}>Ganti password</button></div>
        </div>
      </div>
    </div>
  );
}
