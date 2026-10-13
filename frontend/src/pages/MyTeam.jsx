import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSocketEvent } from '../socket';
import { useAsync, useAction, useConfirm, Loading, Field, Icon, StatusPill, Empty, RoleTag, Countdown } from '../ui';
import { fmtDateTime } from '../format';

function RoleOptions({ roles, value, onChange }) {
  return (
    <div className="col tight" role="radiogroup" aria-label="Peran">
      {roles.map((r) => (
        <label key={r.id} className={`option-pill ${value === String(r.id) ? 'selected' : ''}`} style={{ alignItems: 'flex-start', padding: 12 }}>
          <input type="radio" name="role" checked={value === String(r.id)} onChange={() => onChange(String(r.id))} style={{ marginTop: 4 }} />
          <span className="grow">
            <span className="row">
              <span className="dot" style={{ background: r.color }} />
              <strong>{r.name}</strong>
              {r.subtitle && <span className="small muted">{r.subtitle}</span>}
            </span>
            {r.description && <div className="small muted mt-s">{r.description}</div>}
            <div className="row tiny mt-s">
              {r.can_approve && <span className="badge info">menyetujui keputusan</span>}
              {r.can_statement && <span className="badge warn">pernyataan publik</span>}
              {r.can_escalate && <span className="badge bad">eskalasi</span>}
              <span className="muted">{r.holders.length ? `Diisi: ${r.holders.join(', ')}` : 'Belum diisi'}</span>
            </div>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Masukkan token → pilih peran → bergabung ke tim instansi. */
function JoinForm({ onJoined }) {
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState(null);
  const [roleId, setRoleId] = useState('');
  const [run, busy] = useAction();

  const check = async (e) => {
    e.preventDefault();
    if (!token.trim()) return;
    const p = await run(() => api.post('/join/preview', { token }));
    if (p) {
      setPreview(p);
      setRoleId('');
    }
  };
  const join = async () => {
    const r = await run(() => api.post('/join', { token, player_role_id: roleId || null }), 'Berhasil bergabung ke tim');
    if (r) onJoined();
  };

  return (
    <>
      <form className="card card-pad col" onSubmit={check}>
        <h2>Gabung ke tim instansi</h2>
        <Field label="Token tim dari admin" hint="Tidak membedakan huruf besar/kecil; tanda hubung boleh diabaikan.">
          <div className="row nowrap-row">
            <input className="input grow mono" value={token} onChange={(e) => { setToken(e.target.value); setPreview(null); }} placeholder="XXXX-XXXX" autoComplete="off" spellCheck={false} style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }} aria-label="Token tim" />
            <button className="btn btn-primary" disabled={busy || !token.trim()}><Icon name="key" /> Periksa</button>
          </div>
        </Field>
      </form>
      {preview && (
        <div className="card">
          <div className="card-head">
            <span className="dot" style={{ background: preview.team.color }} />
            <div className="grow"><h2>{preview.team.name}</h2>{preview.team.preset_name && <div className="small muted">Set peran: {preview.team.preset_name}</div>}</div>
          </div>
          <div className="card-body col">
            <span className="field-label">Pilih peran Anda</span>
            {preview.roles.length === 0 ? <Empty>Tim ini belum punya set peran. Anda tetap bisa bergabung.</Empty> : <RoleOptions roles={preview.roles} value={roleId} onChange={setRoleId} />}
            <div className="row">
              <button className="btn btn-primary" disabled={busy || (preview.roles.length > 0 && !roleId)} onClick={join}><Icon name="check" /> Gabung ke tim</button>
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TeamCard({ me }) {
  const role = me.roles.find((r) => r.id === me.player_role_id);
  const filled = me.roles.filter((r) => r.holders.length).length;
  return (
    <div className="card">
      <div className="card-head">
        <span className="dot" style={{ background: me.team.color }} />
        <div className="grow"><h2>{me.team.name}</h2><div className="small muted">Tim instansi Anda{me.is_coordinator ? ' · Anda koordinator tim' : ''}</div></div>
        {role ? <RoleTag name={`Peran: ${role.name}`} color={role.color} /> : <span className="badge warn">Belum ada peran</span>}
      </div>
      <div className="card-body col">
        {role && role.description && <div className="small" style={{ color: 'var(--text-2)' }}>{role.description}</div>}
        {me.roles.length > 0 && (
          <div className="small">
            <span className="muted">Peran tim terisi {filled}/{me.roles.length}: </span>
            {me.roles.map((r) => <span key={r.id} className={`badge ${r.holders.length ? 'good' : ''}`} style={{ margin: '2px 4px 2px 0' }}>{r.name}</span>)}
          </div>
        )}
        <div>
          <div className="field-label">Anggota ({me.members.length})</div>
          {me.members.map((m) => (
            <div key={m.user_id} className="row small"><span className="grow">{m.name}{m.is_coordinator && <span className="badge info" style={{ marginLeft: 6 }}>koordinator</span>}</span><span className="muted">{m.role_name || '—'}</span></div>
          ))}
        </div>
        <div className="tiny muted">Untuk pindah tim atau mengganti peran, hubungi admin.</div>
      </div>
    </div>
  );
}

const APP_STATUS = {
  pending: ['info', 'menunggu'],
  rejected: ['bad', 'ditolak'],
};

/** Ringkasan status anggota tim (khusus koordinator). */
function TeamProgress({ members }) {
  return (
    <div className="col tight mt-s" style={{ borderTop: '1px dashed var(--line)', paddingTop: 6 }}>
      <span className="tiny muted">Status tim Anda</span>
      {members.map((m) => {
        let badge;
        if (m.member_role) badge = m.ready_at ? ['good', 'siap'] : ['warn', 'diterima · belum siap'];
        else badge = APP_STATUS[m.application_status] || ['', 'belum melamar'];
        return (
          <div key={m.user_id} className="row small nowrap-row">
            <span className="grow">{m.name} <span className="muted">· {m.role_name || '—'}</span></span>
            <span className={`badge ${badge[0]}`}>{badge[1]}</span>
          </div>
        );
      })}
    </div>
  );
}

function OpenExercises({ canApply, coordinator }) {
  const { data, loading, reload } = useAsync(() => api.get('/exercises/open'), []);
  const [run, busy] = useAction();
  const confirm = useConfirm();
  useSocketEvent('application:updated', () => reload());
  const applyTeam = async (e) => {
    if (await run(() => api.post(`/exercises/${e.id}/apply-team`), 'Anggota tim dilamarkan')) reload();
  };

  const apply = async (e) => {
    if (await run(() => api.post(`/exercises/${e.id}/apply`), 'Lamaran terkirim')) reload();
  };
  const withdraw = async (e) => {
    if (!(await confirm(`Tarik lamaran untuk "${e.title}"?`, { confirmLabel: 'Tarik lamaran' }))) return;
    if (await run(() => api.del(`/exercises/${e.id}/apply`), 'Lamaran ditarik')) reload();
  };

  const action = (e) => {
    if (e.member_role) {
      return (
        <>
          {e.member_role === 'player' && e.status === 'draft' && (e.ready_at ? <span className="badge good">Siap</span> : <span className="badge warn">Belum siap</span>)}
          <Link className="btn btn-sm btn-primary" to={`/exercises/${e.id}`}>Buka</Link>
        </>
      );
    }
    if (e.application_status === 'pending') {
      return <><span className="badge info">Menunggu persetujuan</span><button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => withdraw(e)}>Tarik</button></>;
    }
    return (
      <>
        {e.application_status === 'rejected' && <span className="badge bad" title={e.review_note || ''}>Ditolak{e.review_note ? `: ${e.review_note}` : ''}</span>}
        <button className="btn btn-sm btn-primary" disabled={busy || !canApply} onClick={() => apply(e)}>{e.application_status === 'rejected' ? 'Lamar ulang' : 'Lamar'}</button>
      </>
    );
  };

  return (
    <div className="card">
      <div className="card-head"><h2 className="grow">Pelatihan tersedia</h2></div>
      {loading && !data ? <Loading /> : !data || data.length === 0 ? <Empty>Belum ada pelatihan yang dipublikasikan.</Empty> : (
        <div className="feed">
          {data.map((e) => (
            <div key={e.id} className="feed-item" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="grow" style={{ minWidth: 220 }}>
                <div className="row"><strong>{e.title}</strong><StatusPill status={e.status} /></div>
                <div className="small muted">
                  {e.scenario_title || 'Tanpa skenario'} · {e.duration_min} menit · {e.players} peserta
                  {e.scheduled_for ? ` · ${fmtDateTime(e.scheduled_for)}` : ''}
                </div>
                {e.scheduled_for && e.status === 'draft' && <Countdown to={e.scheduled_for} prefix="Dimulai" className="tiny" />}
                {e.description && <div className="small mt-s" style={{ color: 'var(--text-2)' }}>{e.description}</div>}
                {coordinator && e.team_members && <TeamProgress members={e.team_members} />}
              </div>
              <div className="col tight" style={{ alignItems: 'flex-end' }}>
                <div className="row nowrap-row">{action(e)}</div>
                {coordinator && e.team_members && e.team_members.some((m) => !m.member_role && m.application_status !== 'pending') && (
                  <button className="btn btn-sm" disabled={busy} onClick={() => applyTeam(e)}><Icon name="users" /> Lamarkan seluruh tim</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {!canApply && <div className="small muted" style={{ padding: '0 16px 14px' }}>Gabung ke tim instansi terlebih dahulu untuk bisa melamar.</div>}
    </div>
  );
}

function NotifyToggle() {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [perm, setPerm] = useState(supported ? Notification.permission : 'unsupported');
  if (!supported || perm === 'granted') return null;
  return (
    <div className="card card-pad row">
      <Icon name="alert" />
      <span className="grow small">Aktifkan notifikasi browser agar Anda diberi tahu saat lamaran diterima, jadwal latihan mendekat, dan latihan dimulai.</span>
      <button className="btn btn-sm" disabled={perm === 'denied'} onClick={() => Notification.requestPermission().then(setPerm)}>
        {perm === 'denied' ? 'Diblokir di browser' : 'Aktifkan'}
      </button>
    </div>
  );
}

export default function MyTeam() {
  const { data, loading, reload } = useAsync(() => api.get('/join/me'), []);
  useSocketEvent('orgteam:changed', () => reload());
  if (loading && !data) return <Loading />;
  const hasTeam = !!(data && data.team);
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Tim saya</h1>
          <p>Alur peserta: gabung ke tim instansi dengan token → lamar pelatihan → tunggu diterima fasilitator → nyatakan <strong>Siap</strong>.</p>
        </div>
      </div>
      <div className="split">
        <div className="main-col">
          <NotifyToggle />
          <OpenExercises canApply={hasTeam} coordinator={hasTeam && data.is_coordinator} />
        </div>
        <div className="side-col">
          {hasTeam ? <TeamCard me={data} /> : <JoinForm onJoined={reload} />}
        </div>
      </div>
    </div>
  );
}
