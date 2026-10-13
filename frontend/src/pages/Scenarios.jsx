import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, downloadJson } from '../api';
import { useAsync, useAction, useConfirm, Loading, ErrorBox, Empty, Icon } from '../ui';
import { CATEGORY, DIFFICULTY, fmtDateTime } from '../format';

export default function Scenarios() {
  const { data, error, loading, reload } = useAsync(() => api.get('/scenarios'), []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [run] = useAction();
  const confirm = useConfirm();
  const nav = useNavigate();
  const fileRef = useRef(null);

  const list = (data || []).filter((s) => (cat === 'all' || s.category === cat) && (!q || `${s.title} ${s.summary}`.toLowerCase().includes(q.toLowerCase())));

  const create = async () => {
    const s = await run(() => api.post('/scenarios', { title: 'Skenario baru', teams: ['Tim Manajemen Krisis', 'Tim Teknis', 'Tim Komunikasi'] }));
    if (s) nav(`/scenarios/${s.id}`);
  };
  const importFile = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      const s = await run(() => api.post('/scenarios/import', json), 'Skenario diimpor');
      if (s) nav(`/scenarios/${s.id}`);
    } catch {
      await run(() => Promise.reject(new Error('File bukan JSON yang valid')));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow"><h1>Pustaka skenario</h1><p>Template bawaan, hasil generator, dan skenario buatan sendiri.</p></div>
        <button className="btn" onClick={() => fileRef.current.click()}><Icon name="upload" /> Impor JSON</button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={importFile} aria-label="Impor skenario" />
        <Link className="btn" to="/generator"><Icon name="spark" /> Generator</Link>
        <button className="btn btn-primary" onClick={create}><Icon name="plus" /> Skenario manual</button>
      </div>
      <div className="row">
        <input className="input" style={{ maxWidth: 320 }} placeholder="Cari skenario…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari skenario" />
        <div className="pills">
          {[['all', 'Semua'], ...Object.entries(CATEGORY)].map(([k, l]) => (
            <button key={k} className={`pill ${cat === k ? 'active' : ''}`} onClick={() => setCat(k)}>{l}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : list.length === 0 ? <div className="card"><Empty>Tidak ada skenario.</Empty></div> : (
        <div className="grid gauto">
          {list.map((s) => (
            <div key={s.id} className="card card-pad col tight">
              <div className="row">
                <span className="badge">{CATEGORY[s.category] || s.category}</span>
                <span className="badge">{DIFFICULTY[s.difficulty]}</span>
                {s.source === 'template' && <span className="badge info">Template</span>}
                {s.source === 'generator' && <span className="badge warn">Generator</span>}
              </div>
              <Link to={`/scenarios/${s.id}`} className="strong" style={{ fontSize: 15, color: 'var(--text)' }}>{s.title}</Link>
              <p className="small" style={{ color: 'var(--text-2)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.summary}</p>
              <div className="small muted">{s.inject_count} inject · {s.objective_count} objective · {s.duration_min} menit{s.preset_name ? ` · ${s.preset_name}` : ''}</div>
              <div className="tiny muted">Diperbarui {fmtDateTime(s.updated_at)} · dipakai {s.exercise_count}×</div>
              <div className="row mt-s">
                <Link className="btn btn-sm btn-primary" to={`/exercises?new=1&scenario=${s.id}`}>Pakai untuk latihan</Link>
                <Link className="btn btn-sm" to={`/scenarios/${s.id}`}>Buka</Link>
                <button className="btn btn-sm btn-ghost" aria-label="Duplikat" title="Duplikat" onClick={() => run(() => api.post(`/scenarios/${s.id}/duplicate`), 'Skenario diduplikasi').then((r) => r && reload())}><Icon name="copy" /></button>
                <button className="btn btn-sm btn-ghost" aria-label="Ekspor" title="Ekspor JSON" onClick={() => run(() => api.get(`/scenarios/${s.id}/export`)).then((r) => r && downloadJson(r, `skenario-${s.id}.json`))}><Icon name="download" /></button>
                <button className="btn btn-sm btn-ghost" aria-label="Hapus" title="Hapus" onClick={async () => (await confirm(`Hapus skenario "${s.title}"? Latihan yang sudah dibuat dari skenario ini tidak terpengaruh.`, { danger: true, confirmLabel: 'Hapus' })) && run(() => api.del(`/scenarios/${s.id}`)).then((r) => r && reload())}><Icon name="trash" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
