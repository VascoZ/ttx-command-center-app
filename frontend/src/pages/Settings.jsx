import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAsync, useAction, Loading, ErrorBox, Field, Icon } from '../ui';

function SecurityCheck() {
  const { data, error, loading, reload } = useAsync(() => api.get('/security-check'), []);
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="card-head">
        <h2 className="grow">Pemeriksaan keamanan</h2>
        {data && <span className={`badge ${data.ok ? 'good' : 'warn'}`}>{data.ok ? 'Siap produksi' : `${data.checks.filter((c) => !c.ok).length} perlu perhatian`}</span>}
        <button className="btn btn-sm btn-ghost" onClick={reload} disabled={loading}>Periksa ulang</button>
      </div>
      <div className="card-body col tight">
        <ErrorBox error={error} />
        {!data && loading && <Loading />}
        {data && data.checks.map((c) => (
          <div key={c.key} className="row nowrap-row" style={{ alignItems: 'flex-start', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <span style={{ color: c.ok ? 'var(--good-text)' : 'var(--bad-text)', marginTop: 2 }}><Icon name={c.ok ? 'check' : 'alert'} /></span>
            <div className="grow">
              <div className="strong">{c.title}</div>
              <div className="small muted">{c.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const { data, error, loading, reload } = useAsync(() => api.get('/settings'), []);
  const [ai, setAi] = useState(null);
  const [registration, setRegistration] = useState(true);
  const [key, setKey] = useState('');
  const [run, busy] = useAction();
  useEffect(() => {
    if (data) {
      setAi(data.ai);
      setRegistration(!!(data.registration && data.registration.enabled));
    }
  }, [data]);
  if (loading && !data) return <Loading />;
  if (!ai) return <div className="page"><ErrorBox error={error} /></div>;
  const set = (k) => (e) => setAi((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    const r = await run(() => api.put('/settings', { ai: { ...ai, anthropic_api_key: key || undefined }, registration: { enabled: registration } }), 'Pengaturan disimpan');
    if (r) {
      setKey('');
      reload();
    }
  };
  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Pengaturan</h1><p>Pendaftaran peserta dan konfigurasi mesin AI untuk generator skenario dan ringkasan AAR.</p></div></div>
      <SecurityCheck />
      <div className="card card-pad col mt" style={{ maxWidth: 760 }}>
        <h2>Pendaftaran peserta</h2>
        <label className="check">
          <input type="checkbox" checked={registration} onChange={(e) => setRegistration(e.target.checked)} /> Izinkan peserta membuat akun sendiri dari halaman masuk
        </label>
        <div className="small muted">Akun hasil pendaftaran selalu berperan Peserta (Player). Peserta bergabung ke tim instansi memakai token yang dibagikan admin dari menu Tim instansi.</div>
        <h2 className="mt">Mesin AI default</h2>
        <div className="col tight">
          {[
            ['builtin', 'Bawaan (offline)', 'Berbasis aturan dan pustaka skenario. Tidak ada data yang keluar dari server. Cocok untuk jaringan air-gapped.'],
            ['anthropic', 'Claude API', 'Skenario lebih bervariasi. Membutuhkan koneksi internet dan API key.'],
            ['ollama', 'Ollama lokal', 'Model bahasa yang berjalan di server Anda sendiri (jalankan profil compose "ai").'],
          ].map(([k, l, d]) => (
            <label key={k} className={`option-pill ${ai.provider === k ? 'selected' : ''}`} style={{ alignItems: 'flex-start', padding: 12 }}>
              <input type="radio" name="provider" checked={ai.provider === k} onChange={() => setAi((x) => ({ ...x, provider: k }))} style={{ marginTop: 4 }} />
              <span><strong>{l}</strong><div className="small muted">{d}</div></span>
            </label>
          ))}
        </div>
        <h2 className="mt">Claude API</h2>
        <div className="grid g2">
          <Field label="Model"><input className="input" value={ai.anthropic_model} onChange={set('anthropic_model')} /></Field>
          <Field label={`API key ${ai.anthropic_key_set ? `(tersimpan: ${ai.anthropic_key_hint})` : '(belum diatur)'}`}>
            <input className="input" type="password" autoComplete="off" placeholder={ai.anthropic_key_set ? 'Kosongkan bila tidak diubah' : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
        </div>
        <h2 className="mt">Ollama</h2>
        <div className="grid g2">
          <Field label="URL"><input className="input" value={ai.ollama_url} onChange={set('ollama_url')} /></Field>
          <Field label="Model"><input className="input" value={ai.ollama_model} onChange={set('ollama_model')} /></Field>
        </div>
        <div className="small muted">Jika mesin AI gagal dihubungi, generator otomatis memakai mesin bawaan.</div>
        <div><button className="btn btn-primary" disabled={busy} onClick={save}>Simpan pengaturan</button></div>
      </div>
    </div>
  );
}
