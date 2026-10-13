import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Logo, Field } from '../ui';

// Akun admin tidak dicantumkan: passwordnya diatur di .env (ADMIN_PASSWORD).
const DEMO = [
  ['fasilitator@ttx.local', 'demo12345', 'Fasilitator'],
  ['evaluator@ttx.local', 'demo12345', 'Evaluator'],
  ['sekda@ttx.local', 'demo12345', 'Pimpinan Daerah'],
  ['csirt@ttx.local', 'demo12345', 'Tim Teknis / CSIRT'],
  ['humas@ttx.local', 'demo12345', 'Humas & PPID'],
  ['hukum@ttx.local', 'demo12345', 'Bagian Hukum'],
];

function RegisterForm({ onCancel }) {
  const { register } = useAuth();
  const [f, setF] = useState({ name: '', email: '', organization: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError('Konfirmasi password tidak cocok');
    setBusy(true);
    setError(null);
    try {
      await register({ name: f.name, email: f.email, organization: f.organization, password: f.password });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
    return undefined;
  };

  return (
    <form className="card card-pad col" onSubmit={submit}>
      <h1 style={{ fontSize: 20 }}>Daftar sebagai peserta</h1>
      <p className="small muted">Setelah mendaftar, masukkan token tim dari admin untuk bergabung ke tim instansi Anda dan memilih peran.</p>
      {error && <div className="alert bad" role="alert">{error}</div>}
      <Field label="Nama lengkap">
        <input className="input" autoComplete="name" required value={f.name} onChange={set('name')} />
      </Field>
      <Field label="Email">
        <input className="input" type="email" autoComplete="email" required value={f.email} onChange={set('email')} />
      </Field>
      <Field label="Instansi / unit kerja">
        <input className="input" autoComplete="organization" value={f.organization} onChange={set('organization')} placeholder="mis. Diskominfo Kab. Sukamaju" />
      </Field>
      <div className="grid g2">
        <Field label="Password (min. 8 karakter)">
          <input className="input" type="password" autoComplete="new-password" required minLength={8} value={f.password} onChange={set('password')} />
        </Field>
        <Field label="Ulangi password">
          <input className="input" type="password" autoComplete="new-password" required minLength={8} value={f.confirm} onChange={set('confirm')} />
        </Field>
      </div>
      <button className="btn btn-primary btn-lg" disabled={busy}>
        {busy ? 'Memproses…' : 'Daftar'}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Sudah punya akun? Masuk</button>
    </form>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [mode, setMode] = useState('login');
  const [canRegister, setCanRegister] = useState(false);
  const [hasDemo, setHasDemo] = useState(false);

  useEffect(() => {
    api
      .get('/auth/config', { noRedirect: true })
      .then((c) => {
        setCanRegister(!!c.registration);
        setHasDemo(!!c.demo);
      })
      .catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card col">
        <div className="row" style={{ gap: 12, marginBottom: 8 }}>
          <Logo size={34} />
          <div>
            <div style={{ fontWeight: 700, letterSpacing: '0.03em' }}>TTX COMMAND CENTER</div>
            <div className="small muted">Platform tabletop exercise real-time</div>
          </div>
        </div>
        {mode === 'register' ? <RegisterForm onCancel={() => setMode('login')} /> : (
        <form className="card card-pad col" onSubmit={submit}>
          <h1 style={{ fontSize: 20 }}>Masuk</h1>
          {error && <div className="alert bad" role="alert">{error}</div>}
          <Field label="Email">
            <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? 'Memproses…' : 'Masuk'}
          </button>
          {canRegister && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('register')}>Peserta baru? Daftar akun</button>
          )}
        </form>
        )}
        {mode === 'login' && hasDemo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowDemo((v) => !v)}>
          {showDemo ? 'Sembunyikan akun demo' : 'Tampilkan akun demo'}
        </button>}
        {mode === 'login' && hasDemo && showDemo && (
          <div className="card">
            {DEMO.map(([e, p, label]) => (
              <button
                key={e}
                type="button"
                className="inbox-item"
                onClick={() => {
                  setEmail(e);
                  setPassword(p);
                }}
              >
                <div className="row between">
                  <strong>{label}</strong>
                  <span className="mono small muted">{e}</span>
                </div>
              </button>
            ))}
            <div className="small muted" style={{ padding: '8px 16px 12px' }}>
              Password demo: demo12345. Akun admin memakai ADMIN_PASSWORD di file .env. Nonaktifkan akun demo sebelum dipakai di produksi.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
