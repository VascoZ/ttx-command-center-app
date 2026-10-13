import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAsync, useAction, Field, Empty, Icon, Loading } from '../ui';
import { DIFFICULTY, INJECT_TYPES, PRIORITY, fmtOffset } from '../format';

const ROLE_NAMES = { leader: 'Pimpinan', it_head: 'Kepala TI', tech: 'Tim teknis', comms: 'Humas', legal: 'Hukum', audit: 'Pengawas', risk: 'Risiko', ops: 'Operasional', customer: 'Layanan pelanggan', medical: 'Medis', disaster: 'BPBD', hr: 'SDM' };

export default function Generator() {
  const opts = useAsync(() => api.get('/generator/options'), []);
  const presets = useAsync(() => api.get('/role-presets'), []);
  const [p, setP] = useState({ threat: 'ransomware', industry: 'pemerintah', organization: '', difficulty: 'menengah', duration_min: 180, engine: 'default', preset_id: '', notes: '' });
  const [out, setOut] = useState(null);
  const [run, busy] = useAction();
  const nav = useNavigate();
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    if (!opts.data) return;
    const ind = opts.data.industries.find((i) => i.key === p.industry);
    if (ind && !p.organization) setP((x) => ({ ...x, organization: ind.org }));
  }, [opts.data, p.industry, p.organization]);

  const generate = async (e) => {
    e && e.preventDefault();
    const r = await run(() => api.post('/generator/generate', p));
    if (r) setOut(r);
  };
  const save = async (thenExercise) => {
    const preset = (presets.data || []).find((x) => String(x.id) === String(p.preset_id));
    const s = await run(() => api.post('/generator/save', { ...out, preset_id: preset ? preset.id : undefined }), 'Skenario disimpan ke pustaka');
    if (s) nav(thenExercise ? `/exercises?new=1&scenario=${s.id}` : `/scenarios/${s.id}`);
  };
  const removeInject = (idx) => setOut((o) => ({ ...o, injects: o.injects.filter((_, i) => i !== idx) }));

  if (!opts.data) return <Loading />;
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow"><h1>Generator skenario</h1><p>Isi parameter, pratinjau hasilnya, lalu simpan ke pustaka atau langsung buat latihan.</p></div>
      </div>
      <div className="split">
        <form className="card card-pad col side-col" onSubmit={generate} style={{ flex: '1 1 340px' }}>
          <Field label="Jenis ancaman / insiden">
            <select className="select" value={p.threat} onChange={set('threat')}>
              {['siber', 'reputasi', 'bencana', 'operasional'].map((c) => (
                <optgroup key={c} label={c[0].toUpperCase() + c.slice(1)}>
                  {opts.data.threats.filter((t) => t.category === c).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Sektor">
            <select className="select" value={p.industry} onChange={(e) => { const ind = opts.data.industries.find((i) => i.key === e.target.value); setP((x) => ({ ...x, industry: e.target.value, organization: ind ? ind.org : x.organization })); }}>
              {opts.data.industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
            </select>
          </Field>
          <Field label="Nama organisasi"><input className="input" value={p.organization} onChange={set('organization')} /></Field>
          <Field label="Preset peran player" hint="Kosong = sesuai sektor.">
            <select className="select" value={p.preset_id} onChange={set('preset_id')}>
              <option value="">Otomatis sesuai sektor</option>
              {(presets.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <div className="grid g2">
            <Field label="Kesulitan"><select className="select" value={p.difficulty} onChange={set('difficulty')}>{Object.entries(DIFFICULTY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Durasi (menit)"><input className="input" type="number" min="30" max="600" value={p.duration_min} onChange={set('duration_min')} /></Field>
          </div>
          <div className="field">
            <span>Mesin generator</span>
            <div className="col tight">
              {[['default', 'Sesuai pengaturan admin'], ['builtin', 'Bawaan (offline, berbasis aturan)'], ['anthropic', 'Claude API'], ['ollama', 'Ollama lokal']].map(([k, l]) => (
                <label key={k} className={`option-pill ${p.engine === k ? 'selected' : ''}`}>
                  <input type="radio" name="engine" checked={p.engine === k} onChange={() => setP((x) => ({ ...x, engine: k }))} /> {l}
                </label>
              ))}
            </div>
          </div>
          {p.engine !== 'builtin' && (
            <Field label="Catatan tambahan untuk AI (opsional)"><textarea className="textarea" value={p.notes} onChange={set('notes')} placeholder="mis. libatkan isu pemilu daerah, fokus pada layanan Dukcapil" /></Field>
          )}
          <button className="btn btn-primary btn-lg" disabled={busy}><Icon name="spark" /> {busy ? 'Membuat skenario…' : 'Generate skenario'}</button>
        </form>

        <section className="card main-col" style={{ flex: '2 1 520px', gap: 0 }}>
          {!out ? <Empty>Hasil generate akan tampil di sini.</Empty> : (
            <>
              <div className="card-head">
                <h2 className="grow">{out.title}</h2>
                <button className="btn btn-sm" disabled={busy} onClick={generate}><Icon name="undo" /> Generate ulang</button>
                <button className="btn btn-sm" disabled={busy} onClick={() => save(false)}>Simpan ke pustaka</button>
                <button className="btn btn-sm btn-good" disabled={busy} onClick={() => save(true)}>Simpan & buat latihan</button>
              </div>
              <div className="card-body col">
                {out.fallback_reason && <div className="alert warn small">Mesin AI tidak tersedia ({out.fallback_reason}). Hasil dibuat dengan mesin bawaan.</div>}
                <div className="row">
                  <span className="chip">{out.objectives.length} objective</span>
                  <span className="chip">{out.injects.length} inject</span>
                  <span className="chip">{out.duration_min} menit</span>
                  <span className="chip">{DIFFICULTY[out.difficulty]}</span>
                  <span className="chip">Preset: {out.preset_name}</span>
                  <span className="chip">Mesin: {out.engine}</span>
                </div>
                <Field label="Judul"><input className="input" value={out.title} onChange={(e) => setOut({ ...out, title: e.target.value })} /></Field>
                <Field label="Narasi"><textarea className="textarea" style={{ minHeight: 120 }} value={out.narrative} onChange={(e) => setOut({ ...out, narrative: e.target.value })} /></Field>
                <div>
                  <div className="field-label">Objective</div>
                  <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>{out.objectives.map((o, i) => <li key={i}><strong>{o.title}</strong> <span className="muted small">— {o.description}</span></li>)}</ol>
                </div>
                <div className="field-label">Timeline inject</div>
                <div className="table-wrap">
                  <table className="table" style={{ minWidth: 640 }}>
                    <thead><tr><th>Waktu</th><th>Inject</th><th>Peran tujuan</th><th /></tr></thead>
                    <tbody>
                      {out.injects.map((i, idx) => (
                        <tr key={idx}>
                          <td className="mono">{fmtOffset(i.offset_min)}</td>
                          <td><div className="strong">{i.title}</div><div className="small muted">{INJECT_TYPES[i.type]} · {PRIORITY[i.priority].label}</div><div className="small" style={{ color: 'var(--text-2)' }}>{i.content}</div>{i.question && <div className="small mt-s"><strong>?</strong> {i.question}</div>}</td>
                          <td className="small">{ROLE_NAMES[i.target_role] || i.target_role || i.target_team || 'Semua'}</td>
                          <td><button className="btn btn-ghost icon-btn" aria-label="Hapus inject" onClick={() => removeInject(idx)}><Icon name="trash" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
