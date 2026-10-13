import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, canDesign } from '../auth';
import { useAsync, useAction, Loading, ErrorBox, StatusPill, Empty, Icon, Modal, Field } from '../ui';
import { fmtDateTime, MEMBER_ROLE, DIFFICULTY, CATEGORY } from '../format';

export function CreateExerciseModal({ onClose, defaultScenarioId }) {
  const nav = useNavigate();
  const scenarios = useAsync(() => api.get('/scenarios'), []);
  const presets = useAsync(() => api.get('/role-presets'), []);
  const [form, setForm] = useState({ scenario_id: defaultScenarioId || '', title: '', preset_id: '', scheduled_for: '', speed: 1, description: '' });
  const [run, busy] = useAction();
  const sc = useMemo(() => (scenarios.data || []).find((s) => String(s.id) === String(form.scenario_id)), [scenarios.data, form.scenario_id]);

  useEffect(() => {
    if (sc) setForm((f) => ({ ...f, title: f.title || sc.title, preset_id: f.preset_id || sc.preset_id || '' }));
  }, [sc]);

  const submit = async () => {
    const ex = await run(() =>
      api.post('/exercises', {
        ...form,
        scenario_id: form.scenario_id || null,
        preset_id: form.preset_id || null,
        scheduled_for: form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null,
      }), 'Latihan dibuat');
    if (ex) nav(`/exercises/${ex.id}?tab=setup`);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal title="Buat latihan baru" onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn btn-primary" disabled={busy || !form.title} onClick={submit}>Buat latihan</button></>}>
      <Field label="Skenario">
        <select className="select" value={form.scenario_id} onChange={set('scenario_id')}>
          <option value="">— Tanpa skenario (kosong) —</option>
          {(scenarios.data || []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.source === 'template' ? '[Template] ' : ''}{s.title} · {s.inject_count} inject
            </option>
          ))}
        </select>
      </Field>
      {sc && (
        <div className="alert info small">
          {CATEGORY[sc.category]} · {DIFFICULTY[sc.difficulty]} · {sc.duration_min} menit · tim: {sc.teams.join(', ') || '–'}
          <div className="mt-s">{sc.summary}</div>
        </div>
      )}
      <Field label="Judul latihan">
        <input className="input" value={form.title} onChange={set('title')} placeholder="mis. Simulasi Ransomware Pemkab 2026" />
      </Field>
      <div className="grid g3">
        <Field label="Preset peran player" hint="Peran tersalin ke latihan dan bisa diubah.">
          <select className="select" value={form.preset_id} onChange={set('preset_id')}>
            <option value="">— Tanpa peran —</option>
            {(presets.data || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.roles.length} peran)</option>)}
          </select>
        </Field>
        <Field label="Jadwal (opsional)">
          <input className="input" type="datetime-local" value={form.scheduled_for} onChange={set('scheduled_for')} />
        </Field>
        <Field label="Kecepatan simulasi awal">
          <select className="select" value={form.speed} onChange={set('speed')}>
            {[1, 2, 5, 10].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </Field>
      </div>
      <Field label="Deskripsi / catatan (opsional)">
        <textarea className="textarea" value={form.description} onChange={set('description')} />
      </Field>
    </Modal>
  );
}

export default function Exercises() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data, error, loading } = useAsync(() => api.get('/exercises'), []);
  const [filter, setFilter] = useState('all');
  const showCreate = params.get('new') === '1';
  const close = () => setParams({});

  const list = (data || []).filter((e) => filter === 'all' || e.status === filter || (filter === 'active' && ['running', 'paused'].includes(e.status)));

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Latihan</h1>
          <p>Semua tabletop exercise yang Anda kelola atau ikuti.</p>
        </div>
        {user.role !== 'admin' && <Link className="btn" to="/my-team"><Icon name="key" /> Pelatihan tersedia</Link>}
        {canDesign(user) && (
          <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Icon name="plus" /> Latihan baru</button>
        )}
      </div>
      <div className="pills" role="tablist">
        {[['all', 'Semua'], ['active', 'Aktif'], ['draft', 'Draft'], ['ended', 'Selesai']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={filter === k} className={`pill ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <div className="card">
          {list.length === 0 ? <Empty>{user.role === 'player' ? <>Belum ada latihan. Buka <Link to="/my-team">Tim saya</Link> untuk bergabung ke tim dan melamar pelatihan.</> : 'Belum ada latihan.'}</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Latihan</th><th>Status</th><th>Peran Anda</th><th>Inject</th><th>Peserta</th><th>Dibuat</th><th /></tr></thead>
                <tbody>
                  {list.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link className="strong" to={`/exercises/${e.id}`}>{e.title}</Link>
                        <div className="small muted">{e.scenario_title || 'Tanpa skenario'}{e.preset_name ? ` · ${e.preset_name}` : ''}</div>
                      </td>
                      <td><StatusPill status={e.status} /></td>
                      <td>{MEMBER_ROLE[e.my_role] || (user.role === 'admin' ? 'Admin' : 'Pembuat')}</td>
                      <td className="mono">{e.sent_count}/{e.inject_count}</td>
                      <td>{e.member_count}</td>
                      <td className="small muted nowrap">{fmtDateTime(e.created_at)}</td>
                      <td className="right nowrap">
                        <Link className="btn btn-sm" to={`/exercises/${e.id}`}>Buka</Link>
                        {e.status === 'ended' && e.my_role !== 'player' && <Link className="btn btn-sm btn-ghost" to={`/exercises/${e.id}/report`}>Laporan</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {showCreate && <CreateExerciseModal onClose={close} defaultScenarioId={params.get('scenario')} />}
    </div>
  );
}
