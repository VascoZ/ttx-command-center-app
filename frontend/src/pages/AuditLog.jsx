import { useState } from 'react';
import { api } from '../api';
import { useAsync, Loading, ErrorBox, Empty } from '../ui';
import { fmtDateTime } from '../format';

export default function AuditLog() {
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [term, setTerm] = useState('');
  const { data, error, loading } = useAsync(() => api.get(`/audit?limit=100&offset=${offset}${term ? `&q=${encodeURIComponent(term)}` : ''}`), [offset, term]);
  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Audit log</h1><p>Jejak semua aksi penting di aplikasi.</p></div></div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setOffset(0); setTerm(q); }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Filter aksi, entitas, atau nama…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter audit" />
        <button className="btn">Filter</button>
      </form>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <div className="card">
          {(data || []).length === 0 ? <Empty>Tidak ada entri.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Entitas</th><th>Detail</th><th>IP</th></tr></thead>
                <tbody>
                  {data.map((a) => (
                    <tr key={a.id}>
                      <td className="small nowrap">{fmtDateTime(a.created_at)}</td>
                      <td className="small">{a.user_name || '–'}<div className="tiny muted">{a.user_email}</div></td>
                      <td><span className="badge">{a.action}</span></td>
                      <td className="small">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
                      <td className="small mono muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>{Object.keys(a.detail || {}).length ? JSON.stringify(a.detail) : ''}</td>
                      <td className="small muted">{a.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="row" style={{ padding: 12 }}>
            <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Sebelumnya</button>
            <button className="btn btn-sm" disabled={(data || []).length < 100} onClick={() => setOffset(offset + 100)}>Berikutnya</button>
          </div>
        </div>
      )}
    </div>
  );
}
