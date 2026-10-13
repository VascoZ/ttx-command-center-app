import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useAsync, useAction, useConfirm, Modal, Field, Icon, Empty } from '../../ui';
import { MEMBER_ROLE, fmtDateTime } from '../../format';
import { useAuth } from '../../auth';
import { useSocketEvent, useResync } from '../../socket';

export function RoleFormFields({ f, set }) {
  return (
    <>
      <div className="grid g2">
        <Field label="Nama peran"><input className="input" value={f.name || ''} onChange={set('name')} /></Field>
        <Field label="Keterangan singkat"><input className="input" value={f.subtitle || ''} onChange={set('subtitle')} placeholder="mis. Kepala Daerah / Sekda" /></Field>
      </div>
      <Field label="Tanggung jawab (tampil di workspace peserta)"><textarea className="textarea" value={f.description || ''} onChange={set('description')} /></Field>
      <div className="grid g2">
        <Field label="Warna"><input className="input" type="color" value={f.color || '#4C9AFF'} onChange={set('color')} style={{ padding: 4 }} /></Field>
        <Field label="Kode (untuk generator)" hint="mis. leader, tech, comms, legal, ops"><input className="input" value={f.code || ''} onChange={set('code')} /></Field>
      </div>
      <div className="col tight">
        <span className="field-label">Kewenangan khusus</span>
        <label className="check"><input type="checkbox" checked={!!f.can_approve} onChange={set('can_approve')} /> Menyetujui keputusan</label>
        <label className="check"><input type="checkbox" checked={!!f.can_statement} onChange={set('can_statement')} /> Menerbitkan pernyataan publik</label>
        <label className="check"><input type="checkbox" checked={!!f.can_escalate} onChange={set('can_escalate')} /> Mengirim eskalasi</label>
      </div>
    </>
  );
}

function useForm(init) {
  const [f, setF] = useState(init);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return [f, set, setF];
}

function InfoCard({ ex }) {
  const [f, set] = useForm({
    title: ex.title,
    description: ex.description || '',
    narrative: ex.narrative || '',
    duration_min: ex.duration_min,
    scheduled_for: ex.scheduled_for ? new Date(ex.scheduled_for).toISOString().slice(0, 16) : '',
    briefing: ex.briefing || '',
  });
  const [run, busy] = useAction();
  const save = () => run(() => api.put(`/exercises/${ex.id}`, { ...f, scheduled_for: f.scheduled_for ? new Date(f.scheduled_for).toISOString() : null }), 'Info latihan disimpan');
  return (
    <div className="card">
      <div className="card-head"><h2 className="grow">Info latihan</h2><button className="btn btn-sm btn-primary" disabled={busy} onClick={save}>Simpan</button></div>
      <div className="card-body col">
        <Field label="Judul"><input className="input" value={f.title} onChange={set('title')} /></Field>
        <div className="grid g2">
          <Field label="Durasi rencana (menit simulasi)"><input className="input" type="number" value={f.duration_min} onChange={set('duration_min')} /></Field>
          <Field label="Jadwal"><input className="input" type="datetime-local" value={f.scheduled_for} onChange={set('scheduled_for')} /></Field>
        </div>
        <Field label="Deskripsi"><textarea className="textarea" value={f.description} onChange={set('description')} /></Field>
        <Field label="Narasi pembuka (ditampilkan ke peserta)"><textarea className="textarea" style={{ minHeight: 140 }} value={f.narrative} onChange={set('narrative')} /></Field>
        <Field label="Briefing peserta" hint="Aturan main dan hal yang perlu disiapkan. Peserta wajib membaca dan mencentang checklist briefing sebelum menyatakan Siap.">
          <textarea className="textarea" value={f.briefing} onChange={set('briefing')} placeholder="mis. Durasi, cara merespons inject, siapa yang mengambil keputusan, kanal komunikasi." />
        </Field>
      </div>
    </div>
  );
}

function InvitesModal({ ex, invites, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [open, setOpen] = useState(!invites.some((t) => t.invited));
  const [sel, setSel] = useState(invites.filter((t) => t.invited).map((t) => t.id));
  const save = async () => {
    if (!open && !sel.length) return run(() => Promise.reject(new Error('Pilih minimal satu instansi, atau buka untuk semua instansi')));
    const r = await run(() => api.put(`/exercises/${ex.id}/invites`, { org_team_ids: open ? [] : sel }), 'Undangan disimpan');
    if (r) onSaved();
    return r;
  };
  return (
    <Modal title="Instansi yang dapat melamar" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn btn-primary" disabled={busy} onClick={save}>Simpan</button></>}>
      <label className={`option-pill ${open ? 'selected' : ''}`}><input type="radio" checked={open} onChange={() => setOpen(true)} /> Terbuka untuk semua instansi</label>
      <label className={`option-pill ${!open ? 'selected' : ''}`}><input type="radio" checked={!open} onChange={() => setOpen(false)} /> Hanya instansi yang diundang</label>
      {!open && (
        <div className="card" style={{ maxHeight: 300, overflowY: 'auto' }}>
          {invites.length === 0 ? <Empty>Belum ada tim instansi. Admin membuatnya di menu Tim instansi.</Empty> : invites.map((t) => (
            <label key={t.id} className="row nowrap-row" style={{ padding: '8px 14px', borderTop: '1px solid var(--line)', cursor: 'pointer' }}>
              <input type="checkbox" checked={sel.includes(t.id)} onChange={(e) => setSel((x) => (e.target.checked ? [...x, t.id] : x.filter((i) => i !== t.id)))} />
              <span className="dot" style={{ background: t.color }} />
              <span className="grow">{t.name}</span>
              <span className="small muted">{t.members} anggota</span>
            </label>
          ))}
        </div>
      )}
      <div className="small muted">Instansi yang tidak diundang tidak melihat latihan ini. Peserta yang sudah diterima tetap terdaftar.</div>
    </Modal>
  );
}

function PublishCard({ ex }) {
  const [run, busy] = useAction();
  const confirm = useConfirm();
  const invites = useAsync(() => api.get(`/exercises/${ex.id}/invites`), [ex.id]);
  const [editing, setEditing] = useState(false);
  const published = !!ex.published_at;
  const invited = (invites.data || []).filter((t) => t.invited);
  const toggle = async () => {
    if (published && !(await confirm('Tarik publikasi? Peserta tidak bisa melamar lagi. Peserta yang sudah diterima tetap terdaftar.', { confirmLabel: 'Tarik publikasi' }))) return;
    run(() => api.post(`/exercises/${ex.id}/publish`, { published: !published }), published ? 'Publikasi ditarik' : 'Latihan dipublikasikan');
  };
  return (
    <div className="card card-pad row">
      <Icon name={published ? 'check' : 'eye'} />
      <div className="grow">
        <div className="strong">{published ? 'Dipublikasikan — peserta dapat melamar' : 'Belum dipublikasikan'}</div>
        <div className="small muted">
          {published
            ? `Sejak ${fmtDateTime(ex.published_at)}. Peserta melihat latihan ini di menu Tim saya.`
            : 'Publikasikan (deploy) agar peserta dari tim instansi dapat melamar ke latihan ini.'}
        </div>
        <div className="small mt-s">
          <span className="muted">Instansi: </span>
          {invited.length === 0 ? <span className="badge">semua instansi</span> : invited.map((t) => (
            <span key={t.id} className="badge" style={{ marginRight: 4 }}><span className="dot" style={{ background: t.color }} />{t.name}</span>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} disabled={!invites.data}><Icon name="edit" /> Atur undangan</button>
        </div>
      </div>
      {ex.state.status !== 'ended' && (
        <button className={`btn ${published ? 'btn-ghost' : 'btn-primary'}`} disabled={busy} onClick={toggle}>
          {published ? 'Tarik publikasi' : 'Publikasikan'}
        </button>
      )}
      {editing && <InvitesModal ex={ex} invites={invites.data} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); invites.reload(); }} />}
    </div>
  );
}

function ApplicationsCard({ ex }) {
  const resync = useResync();
  const { data, reload } = useAsync(() => api.get(`/exercises/${ex.id}/applications`), [ex.id, ex.members.length, resync]);
  const [run, busy] = useAction();
  const [roleFor, setRoleFor] = useState({});
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');
  useSocketEvent('application:new', () => reload());
  const list = data || [];
  const pending = list.filter((a) => a.status === 'pending');
  const done = list.filter((a) => a.status !== 'pending');

  const accept = async (a) => {
    const roleId = roleFor[a.id] !== undefined ? roleFor[a.id] : a.suggested_role_id;
    if (await run(() => api.post(`/applications/${a.id}/accept`, { exercise_role_id: roleId || null }), `${a.user_name} diterima`)) reload();
  };
  const acceptAll = async () => {
    if (await run(() => api.post(`/exercises/${ex.id}/applications/accept-all`), 'Semua lamaran diterima')) reload();
  };
  const reject = async () => {
    if (await run(() => api.post(`/applications/${rejecting.id}/reject`, { note }), 'Lamaran ditolak')) {
      setRejecting(null);
      setNote('');
      reload();
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="grow">Lamaran peserta {pending.length > 0 && <span className="badge warn round">{pending.length} menunggu</span>}</h2>
        {pending.length > 1 && <button className="btn btn-sm btn-primary" disabled={busy} onClick={acceptAll}><Icon name="check" /> Terima semua</button>}
      </div>
      {pending.length === 0 ? (
        <Empty>{ex.published_at ? 'Tidak ada lamaran yang menunggu.' : 'Publikasikan latihan agar peserta dapat melamar.'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 680 }}>
            <thead><tr><th>Pelamar</th><th>Tim instansi</th><th>Peran di latihan</th><th /></tr></thead>
            <tbody>
              {pending.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="strong">{a.user_name}</div>
                    <div className="tiny muted">{a.user_email}{a.message ? ` · "${a.message}"` : ''}</div>
                  </td>
                  <td><span className="row nowrap-row"><span className="dot" style={{ background: a.org_team_color }} />{a.org_team_name || '—'}</span></td>
                  <td>
                    <select className="select" aria-label={`Peran untuk ${a.user_name}`} value={(roleFor[a.id] !== undefined ? roleFor[a.id] : a.suggested_role_id) || ''} onChange={(e) => setRoleFor((m) => ({ ...m, [a.id]: e.target.value }))}>
                      <option value="">— Tanpa peran —</option>
                      {ex.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <div className="tiny muted">Peran di tim: {a.player_role_name || '—'}</div>
                  </td>
                  <td className="right nowrap">
                    <button className="btn btn-sm btn-good" disabled={busy} onClick={() => accept(a)}><Icon name="check" /> Terima</button>
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { setRejecting(a); setNote(''); }}>Tolak</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {done.length > 0 && (
        <details className="card-body">
          <summary className="small muted" style={{ cursor: 'pointer' }}>Riwayat lamaran ({done.length})</summary>
          <div className="col tight mt-s">
            {done.map((a) => (
              <div key={a.id} className="row small">
                <span className={`badge ${a.status === 'accepted' ? 'good' : 'bad'}`}>{a.status === 'accepted' ? 'Diterima' : 'Ditolak'}</span>
                <span className="grow">{a.user_name} · {a.org_team_name || '—'}{a.review_note ? ` · "${a.review_note}"` : ''}</span>
                <span className="tiny muted">{a.reviewer_name || ''}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      {rejecting && (
        <Modal title={`Tolak lamaran ${rejecting.user_name}`} onClose={() => setRejecting(null)}
          footer={<><button className="btn" onClick={() => setRejecting(null)}>Batal</button><button className="btn btn-danger" disabled={busy} onClick={reject}>Tolak</button></>}>
          <Field label="Alasan (opsional, ditampilkan ke peserta)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. Kuota peran sudah penuh" /></Field>
        </Modal>
      )}
    </div>
  );
}

/** Keterisian peran per tim + status siap peserta. */
function CoverageCard({ ex }) {
  const { user } = useAuth();
  const [run] = useAction();
  const confirm = useConfirm();
  const players = ex.members.filter((m) => m.role === 'player');
  const groups = [
    ...ex.teams.map((t) => ({ t, members: players.filter((m) => m.team_id === t.id) })),
    ...(players.some((m) => !m.team_id) ? [{ t: { id: 0, name: 'Tanpa tim', color: 'var(--line-2)' }, members: players.filter((m) => !m.team_id) }] : []),
  ];
  return (
    <div className="card">
      <div className="card-head"><h2 className="grow">Keterisian peran per tim</h2></div>
      <div className="card-body col">
        {groups.length === 0 && <Empty>Belum ada tim. Tim instansi muncul otomatis saat lamaran anggotanya diterima.</Empty>}
        {groups.map(({ t, members }) => {
          const filled = ex.roles.filter((r) => members.some((m) => m.exercise_role_id === r.id)).length;
          const missingReq = members.length ? ex.roles.filter((r) => r.required && !members.some((m) => m.exercise_role_id === r.id)).length : 0;
          const ready = members.filter((m) => m.ready_at).length;
          const noRole = members.filter((m) => !m.exercise_role_id);
          return (
            <div key={t.id} className="col tight" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div className="row nowrap-row">
                <span className="dot" style={{ background: t.color, borderRadius: '50%' }} />
                <strong className="grow">{t.name}</strong>
                {ex.roles.length > 0 && <span className={`badge ${filled === ex.roles.length ? 'good' : 'warn'}`}>{filled}/{ex.roles.length} peran</span>}
                <span className={`badge ${members.length && ready === members.length ? 'good' : 'warn'}`}>{ready}/{members.length} siap</span>
                {missingReq > 0 && <span className="badge bad">{missingReq} peran wajib kosong</span>}
                {user.role === 'admin' && t.id !== 0 && (
                  <button className="btn btn-ghost icon-btn" aria-label={`Hapus tim ${t.name} dari latihan`} onClick={async () => (await confirm(`Hapus tim "${t.name}" dari latihan ini? Anggotanya menjadi tanpa tim.`, { danger: true, confirmLabel: 'Hapus' })) && run(() => api.del(`/teams/${t.id}`))}><Icon name="trash" /></button>
                )}
              </div>
              <div className="col tight">
                {ex.roles.map((r) => {
                  const holders = members.filter((m) => m.exercise_role_id === r.id);
                  return (
                    <div key={r.id} className="row nowrap-row small" style={{ alignItems: 'flex-start' }}>
                      <span className="dot" style={{ background: r.color, marginTop: 6 }} />
                      <span style={{ width: 170, flexShrink: 0 }} className={holders.length ? '' : 'muted'}>{r.name}{r.required && <strong title="Peran wajib" style={{ color: 'var(--bad-text)' }}> *</strong>}</span>
                      <span className="grow row" style={{ gap: 4 }}>
                        {holders.length === 0 ? <span className={`badge ${r.required ? 'bad' : ''}`}>{r.required ? 'kosong · wajib' : 'kosong'}</span> : holders.map((m) => (
                          <span key={m.user_id} className={`badge ${m.ready_at ? 'good' : ''}`} title={m.ready_at ? 'Siap' : 'Belum siap'}>{m.ready_at ? '✓ ' : ''}{m.name}</span>
                        ))}
                      </span>
                    </div>
                  );
                })}
                {noRole.length > 0 && (
                  <div className="row small"><span className="muted" style={{ width: 186 }}>Belum punya peran</span>{noRole.map((m) => <span key={m.user_id} className="badge warn">{m.name}</span>)}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RolesCard({ ex }) {
  const presets = useAsync(() => api.get('/role-presets'), []);
  const [run, busy] = useAction();
  const confirm = useConfirm();
  const [edit, setEdit] = useState(null);
  const [presetId, setPresetId] = useState('');
  const [f, set, setF] = useForm({});
  useEffect(() => setF(edit || {}), [edit, setF]);
  const save = async () => {
    const r = await run(() => (f.id ? api.put(`/exercise-roles/${f.id}`, f) : api.post(`/exercises/${ex.id}/roles`, f)), 'Peran disimpan');
    if (r) setEdit(null);
  };
  const apply = async (replace) => {
    if (!presetId) return;
    if (replace && !(await confirm('Ganti semua peran latihan dengan preset ini? Penugasan peran peserta dan target inject berbasis peran akan terlepas.', { danger: true, confirmLabel: 'Ganti peran' }))) return;
    await run(() => api.post(`/exercises/${ex.id}/roles`, { preset_id: presetId, replace }), 'Preset diterapkan');
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="grow">Peran player</h2>
        <button className="btn btn-sm btn-primary" onClick={() => setEdit({ color: '#4C9AFF' })}><Icon name="plus" /> Peran kustom</button>
      </div>
      <div className="card-body col">
        <div className="row">
          <select className="select grow" value={presetId} onChange={(e) => setPresetId(e.target.value)} aria-label="Preset peran">
            <option value="">Terapkan preset…</option>
            {(presets.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn" disabled={!presetId || busy} onClick={() => apply(false)}>Tambahkan</button>
          <button className="btn btn-ghost" disabled={!presetId || busy} onClick={() => apply(true)}>Ganti semua</button>
        </div>
        {ex.roles.length === 0 ? <Empty>Belum ada peran. Terapkan preset atau buat peran kustom.</Empty> : (
          <div className="col tight">
            {ex.roles.map((r) => (
              <div key={r.id} className="row nowrap-row" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <span className="dot" style={{ background: r.color }} />
                <div className="grow">
                  <div className="strong">{r.name}</div>
                  <div className="row tiny">
                    {r.subtitle && <span className="muted">{r.subtitle}</span>}
                    {r.can_approve && <span className="badge info">menyetujui</span>}
                    {r.can_statement && <span className="badge warn">pernyataan publik</span>}
                    {r.can_escalate && <span className="badge bad">eskalasi</span>}
                  </div>
                  <div className="row tiny mt-s">
                    <label className="check nowrap" title="Setiap tim yang ikut wajib mengisi peran ini sebelum latihan dimulai">
                      <input type="checkbox" checked={!!r.required} onChange={(e) => run(() => api.put(`/exercise-roles/${r.id}`, { ...r, required: e.target.checked }), e.target.checked ? `${r.name} menjadi peran wajib` : `${r.name} tidak lagi wajib`)} /> Wajib di setiap tim
                    </label>
                    <span className="muted nowrap">· {ex.members.filter((m) => m.exercise_role_id === r.id).length} orang</span>
                  </div>
                </div>
                <button className="btn btn-ghost icon-btn" aria-label={`Edit ${r.name}`} onClick={() => setEdit(r)}><Icon name="edit" /></button>
                <button className="btn btn-ghost icon-btn" aria-label={`Hapus ${r.name}`} onClick={async () => (await confirm(`Hapus peran "${r.name}"?`, { danger: true, confirmLabel: 'Hapus' })) && run(() => api.del(`/exercise-roles/${r.id}`))}><Icon name="trash" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit peran' : 'Peran kustom baru'} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>Batal</button><button className="btn btn-primary" disabled={busy || !f.name} onClick={save}>Simpan</button></>}>
          <RoleFormFields f={f} set={set} />
        </Modal>
      )}
    </div>
  );
}

function MembersCard({ ex }) {
  const users = useAsync(() => api.get('/users'), []);
  const [run, busy] = useAction();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState([]);
  const [def, setDef] = useState({ role: 'player', team_id: '', exercise_role_id: '' });
  const memberIds = useMemo(() => new Set(ex.members.map((m) => m.user_id)), [ex.members]);
  const candidates = (users.data || []).filter((u) => u.is_active && !memberIds.has(u.id) && (!q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase())));

  const update = (m, patch) => run(() => api.post(`/exercises/${ex.id}/members`, { user_id: m.user_id, role: m.role, team_id: m.team_id, exercise_role_id: m.exercise_role_id, ...patch }));
  const addAll = async () => {
    const r = await run(() => api.post(`/exercises/${ex.id}/members`, { members: sel.map((uid) => ({ user_id: uid, ...def, team_id: def.team_id || null, exercise_role_id: def.exercise_role_id || null })) }), `${sel.length} peserta ditambahkan`);
    if (r) {
      setSel([]);
      setAdding(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="grow">Peserta ({ex.members.length})</h2>
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> Tambah peserta</button>
      </div>
      {ex.members.length === 0 ? <Empty>Belum ada peserta.</Empty> : (
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 720 }}>
            <thead><tr><th>Nama</th><th>Peran latihan</th><th>Peran player</th><th>Tim</th><th /></tr></thead>
            <tbody>
              {ex.members.map((m) => (
                <tr key={m.id}>
                  <td><div className="strong">{m.name}</div><div className="tiny muted">{m.email}</div></td>
                  <td>
                    <select className="select" value={m.role} onChange={(e) => update(m, { role: e.target.value })} aria-label="Peran latihan">
                      {Object.entries(MEMBER_ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="select" value={m.exercise_role_id || ''} onChange={(e) => update(m, { exercise_role_id: e.target.value || null })} disabled={m.role !== 'player'} aria-label="Peran player">
                      <option value="">—</option>
                      {ex.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="select" value={m.team_id || ''} onChange={(e) => update(m, { team_id: e.target.value || null })} aria-label="Tim">
                      <option value="">—</option>
                      {ex.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td className="right">
                    <button className="btn btn-ghost icon-btn" aria-label={`Keluarkan ${m.name}`} onClick={async () => (await confirm(`Keluarkan ${m.name} dari latihan?`, { danger: true, confirmLabel: 'Keluarkan' })) && run(() => api.del(`/exercises/${ex.id}/members/${m.user_id}`))}><Icon name="trash" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <Modal title="Tambah peserta" wide onClose={() => setAdding(false)}
          footer={<><button className="btn" onClick={() => setAdding(false)}>Batal</button><button className="btn btn-primary" disabled={!sel.length || busy} onClick={addAll}>Tambahkan {sel.length || ''}</button></>}>
          <div className="grid g3">
            <Field label="Peran latihan">
              <select className="select" value={def.role} onChange={(e) => setDef((d) => ({ ...d, role: e.target.value }))}>
                {Object.entries(MEMBER_ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Peran player">
              <select className="select" value={def.exercise_role_id} onChange={(e) => setDef((d) => ({ ...d, exercise_role_id: e.target.value }))} disabled={def.role !== 'player'}>
                <option value="">—</option>
                {ex.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Tim">
              <select className="select" value={def.team_id} onChange={(e) => setDef((d) => ({ ...d, team_id: e.target.value }))}>
                <option value="">—</option>
                {ex.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>
          <input className="input" placeholder="Cari nama atau email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari pengguna" />
          <div className="card" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {candidates.length === 0 ? <Empty>Tidak ada pengguna yang cocok. Admin dapat menambah pengguna di menu Pengguna.</Empty> : candidates.map((u) => (
              <label key={u.id} className="row nowrap-row" style={{ padding: '8px 14px', borderTop: '1px solid var(--line)', cursor: 'pointer' }}>
                <input type="checkbox" checked={sel.includes(u.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, u.id] : s.filter((x) => x !== u.id)))} />
                <span className="grow">{u.name} <span className="tiny muted">{u.email}</span></span>
                <span className="small muted">{u.organization || ''}</span>
              </label>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ObjectivesCard({ ex }) {
  const [run] = useAction();
  const confirm = useConfirm();
  const [title, setTitle] = useState('');
  return (
    <div className="card">
      <div className="card-head"><h2>Objective latihan</h2></div>
      <div className="card-body col tight">
        {ex.objectives.map((o, i) => (
          <div key={o.id} className="row nowrap-row start">
            <span className="mono muted" style={{ paddingTop: 8 }}>{i + 1}.</span>
            <div className="grow col tight">
              <input className="input" defaultValue={o.title} aria-label="Judul objective" onBlur={(e) => e.target.value !== o.title && run(() => api.put(`/exercise-objectives/${o.id}`, { title: e.target.value, description: o.description }))} />
              <input className="input small" defaultValue={o.description || ''} placeholder="Deskripsi / kriteria" aria-label="Deskripsi objective" onBlur={(e) => e.target.value !== (o.description || '') && run(() => api.put(`/exercise-objectives/${o.id}`, { title: o.title, description: e.target.value }))} />
            </div>
            <button className="btn btn-ghost icon-btn" aria-label="Hapus objective" onClick={async () => (await confirm(`Hapus objective "${o.title}"?`, { danger: true, confirmLabel: 'Hapus' })) && run(() => api.del(`/exercise-objectives/${o.id}`))}><Icon name="trash" /></button>
          </div>
        ))}
        <form className="row nowrap-row mt" onSubmit={async (e) => { e.preventDefault(); if (title.trim() && (await run(() => api.post(`/exercises/${ex.id}/objectives`, { title })))) setTitle(''); }}>
          <input className="input grow" placeholder="Objective baru" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Objective baru" />
          <button className="btn"><Icon name="plus" /> Tambah</button>
        </form>
      </div>
    </div>
  );
}

export default function Setup({ ex }) {
  const unassigned = ex.members.filter((m) => m.role === 'player' && !m.exercise_role_id && ex.roles.length).length;
  const noTeam = ex.members.filter((m) => m.role === 'player' && !m.team_id).length;
  const players = ex.members.filter((m) => m.role === 'player').length;
  const ready = ex.members.filter((m) => m.role === 'player' && m.ready_at).length;
  const missingReq = ex.teams.flatMap((t) => {
    const mem = ex.members.filter((m) => m.role === 'player' && m.team_id === t.id);
    return mem.length ? ex.roles.filter((r) => r.required && !mem.some((m) => m.exercise_role_id === r.id)).map((r) => `${t.name} (${r.name})`) : [];
  });
  return (
    <div className="stack">
      <div className="card card-pad">
        <h2>Daftar periksa sebelum mulai</h2>
        <div className="col tight mt">
          <span className="row"><Icon name={ex.published_at ? 'check' : 'alert'} /> {ex.published_at ? 'Latihan dipublikasikan' : 'Latihan belum dipublikasikan'}</span>
          <span className="row"><Icon name={players ? 'check' : 'alert'} /> {players} peserta (player) terdaftar</span>
          <span className="row"><Icon name={players && ready === players ? 'check' : 'alert'} /> {ready}/{players} peserta menyatakan siap{players && ready < players ? ' — latihan baru bisa dimulai setelah semua siap' : ''}</span>
          <span className="row"><Icon name={ex.roles.length ? 'check' : 'alert'} /> {ex.roles.length} peran player · {ex.teams.length} tim · {ex.objectives.length} objective</span>
          <span className="row"><Icon name={missingReq.length ? 'alert' : 'check'} /> {missingReq.length ? `Peran wajib kosong: ${missingReq.join(', ')}` : 'Semua peran wajib terisi di setiap tim'}</span>
          <span className="row"><Icon name={ex.briefing ? 'check' : 'alert'} /> {ex.briefing ? 'Briefing peserta sudah diisi' : 'Briefing peserta belum diisi (opsional)'}</span>
          <span className="row"><Icon name={unassigned ? 'alert' : 'check'} /> {unassigned ? `${unassigned} peserta belum punya peran player` : 'Semua peserta punya peran'}</span>
          <span className="row"><Icon name={noTeam ? 'alert' : 'check'} /> {noTeam ? `${noTeam} peserta belum masuk tim` : 'Semua peserta punya tim'}</span>
          <span className="row"><Icon name={ex.members.some((m) => m.role === 'evaluator') ? 'check' : 'alert'} /> {ex.members.filter((m) => m.role === 'evaluator').length} evaluator</span>
          <span className="small muted mt-s">Inject dikelola di tab Live → Timeline inject.</span>
        </div>
      </div>
      <PublishCard ex={ex} />
      <div className="split">
        <div className="main-col">
          <ApplicationsCard ex={ex} />
          <CoverageCard ex={ex} />
          <MembersCard ex={ex} />
          <InfoCard ex={ex} />
        </div>
        <div className="side-col">
          <RolesCard ex={ex} />
          <ObjectivesCard ex={ex} />
        </div>
      </div>
      <div className="small muted">Perubahan tersimpan langsung dan tersinkron ke semua peserta.</div>
    </div>
  );
}
