import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAction, useConfirm, Icon, Modal, Field, StatusPill } from '../ui';
import { fmtSim, fmtDuration } from '../format';

export default function ExerciseHeader({ ex, state, simNow, realSec, online, onChange }) {
  const [run, busy] = useAction();
  const confirm = useConfirm();
  const [modal, setModal] = useState(null);
  const [text, setText] = useState('');
  const [jumpMin, setJumpMin] = useState('');
  const fac = ex.me.is_facilitator;
  const status = state ? state.status : ex.status;
  const players = (ex.members || []).filter((m) => m.role === 'player');
  const readyCount = players.filter((m) => m.ready_at).length;
  const allReady = players.length > 0 && readyCount === players.length;
  const notReady = players.filter((m) => !m.ready_at);
  // peran wajib dihitung dari peserta yang siap (yang belum siap bisa dikeluarkan saat mulai)
  const missingReq = (ex.teams || []).flatMap((t) => {
    const mem = players.filter((m) => m.team_id === t.id);
    const readyMem = mem.filter((m) => m.ready_at);
    return mem.length ? (ex.roles || []).filter((r) => r.required && !readyMem.some((m) => m.exercise_role_id === r.id)).map((r) => `${t.name} (${r.name})`) : [];
  });
  const blockReason = !players.length
    ? 'Belum ada peserta'
    : missingReq.length
      ? `Peran wajib kosong: ${missingReq.join(', ')}`
      : !allReady
        ? 'Semua peserta harus menyatakan siap terlebih dahulu'
        : '';
  const post = (path, body, msg) => run(() => api.post(`/exercises/${ex.id}/${path}`, body), msg).then((r) => r && onChange && onChange(r));

  const end = async () => {
    if (await confirm('Akhiri latihan sekarang? Peserta tidak dapat merespons lagi setelah latihan berakhir.', { danger: true, confirmLabel: 'Akhiri latihan' }))
      post('end', {}, 'Latihan diakhiri');
  };
  const reset = async () => {
    if (await confirm('Reset latihan ke draft? Semua respons, keputusan, chat, observasi, dan skor akan dihapus permanen.', { danger: true, confirmLabel: 'Reset latihan' }))
      post('reset', {}, 'Latihan direset ke draft');
  };
  const start = async () => {
    if (await confirm('Mulai latihan? Jam simulasi akan berjalan dan inject terjadwal terkirim otomatis.', { confirmLabel: 'Mulai' })) post('start', {}, 'Latihan dimulai');
  };
  const startDrop = async () => {
    const names = notReady.map((m) => m.name).join(', ');
    if (await confirm(`Mulai tanpa ${notReady.length} peserta yang belum siap? Mereka dikeluarkan dari latihan dan lamarannya ditandai ditolak: ${names}.`, { danger: true, confirmLabel: 'Keluarkan & mulai' }))
      post('start', { drop_not_ready: true }, 'Latihan dimulai');
  };

  return (
    <header className="ex-header">
      <div className="grow" style={{ minWidth: 220 }}>
        <div className="row">
          <Link to="/exercises" className="small muted">Latihan</Link>
          <span className="muted">/</span>
          <StatusPill status={status} />
        </div>
        <div className="strong" style={{ fontSize: 16, marginTop: 2 }}>{ex.title}</div>
      </div>
      <div className="clock" aria-live="off">
        <div><div className="lbl">JAM SIMULASI</div><div className="val sim">{fmtSim(simNow)}</div></div>
        <div><div className="lbl">WAKTU NYATA</div><div className="val">{fmtDuration(realSec)}</div></div>
        <div><div className="lbl">KECEPATAN</div><div className="val">{state ? Number(state.speed) : 1}×</div></div>
        <div><div className="lbl">ONLINE</div><div className="val">{online.length}</div></div>
      </div>
      {fac && (
        <div className="row no-print">
          {status === 'draft' && (
            <>
              <span className={`badge ${allReady ? 'good' : 'warn'}`} title="Peserta yang menyatakan siap">{readyCount}/{players.length} siap</span>
              <button className="btn btn-good" disabled={busy || !!blockReason} onClick={start} title={blockReason}>
                <Icon name="play" /> Mulai latihan
              </button>
              {!allReady && readyCount > 0 && !missingReq.length && (
                <button className="btn btn-ghost" disabled={busy} onClick={startDrop} title="Keluarkan peserta yang belum siap lalu mulai">
                  Mulai tanpa yang belum siap
                </button>
              )}
            </>
          )}
          {status === 'running' && <button className="btn" disabled={busy} onClick={() => post('pause', {}, 'Latihan dijeda')}><Icon name="pause" /> Jeda</button>}
          {status === 'paused' && <button className="btn btn-good" disabled={busy} onClick={() => post('resume', {}, 'Latihan dilanjutkan')}><Icon name="play" /> Lanjutkan</button>}
          {['running', 'paused'].includes(status) && (
            <>
              <select className="select" style={{ width: 'auto' }} aria-label="Kecepatan simulasi" value={state ? Number(state.speed) : 1} onChange={(e) => post('speed', { speed: Number(e.target.value) })}>
                {[0.5, 1, 2, 5, 10, 20].map((s) => <option key={s} value={s}>{s}×</option>)}
              </select>
              <button className="btn" onClick={() => { setJumpMin(String(Math.ceil(simNow / 60) + 10)); setModal('jump'); }} title="Majukan jam simulasi"><Icon name="ff" /> Majukan</button>
              <button className="btn" onClick={() => { setText(''); setModal('broadcast'); }}><Icon name="mega" /> Broadcast</button>
              <button className="btn btn-danger" disabled={busy} onClick={end}><Icon name="stop" /> Akhiri</button>
            </>
          )}
          {status === 'ended' && (
            <>
              <Link className="btn btn-primary" to={`/exercises/${ex.id}/report`}><Icon name="report" /> Laporan AAR</Link>
              <button className="btn btn-ghost" onClick={reset}><Icon name="undo" /> Reset</button>
            </>
          )}
        </div>
      )}
      {!fac && ex.me.is_staff && status === 'ended' && (
        <Link className="btn btn-primary no-print" to={`/exercises/${ex.id}/report`}><Icon name="report" /> Laporan AAR</Link>
      )}

      {modal === 'broadcast' && (
        <Modal title="Broadcast ke semua peserta" onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Batal</button><button className="btn btn-primary" disabled={!text.trim() || busy} onClick={async () => { const r = await run(() => api.post(`/exercises/${ex.id}/broadcast`, { body: text }), 'Broadcast terkirim'); if (r) setModal(null); }}>Kirim</button></>}>
          <Field label="Pengumuman"><textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="mis. Semua tim: rapat koordinasi di posko dalam 10 menit simulasi." /></Field>
        </Modal>
      )}
      {modal === 'jump' && (
        <Modal title="Majukan jam simulasi" onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Batal</button><button className="btn btn-primary" disabled={busy} onClick={async () => { await post('jump', { sim_min: Number(jumpMin) }, 'Jam simulasi dimajukan'); setModal(null); }}>Majukan</button></>}>
          <p className="muted small">Jam simulasi saat ini {fmtSim(simNow)}. Semua inject terjadwal sebelum waktu tujuan akan langsung terkirim.</p>
          <Field label="Waktu tujuan (menit simulasi)"><input className="input" type="number" min={Math.ceil(simNow / 60) + 1} value={jumpMin} onChange={(e) => setJumpMin(e.target.value)} /></Field>
        </Modal>
      )}
    </header>
  );
}
