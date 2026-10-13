import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useSocketEvent, useResync } from '../socket';
import { useToast, useAction, beep, Empty, Field, Icon, RoleTag, Stars, Countdown } from '../ui';
import { INJECT_TYPES, PRIORITY, fmtSim } from '../format';
import { InjectBody } from '../components/InjectView';
import Chat from '../components/Chat';
import { DecisionList, StatementList, EscalationList, DecisionForm } from '../components/Collab';

function seenKey(exId, userId) {
  return `ttx_seen_${exId}_${userId}`;
}
function loadSeen(exId, userId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(seenKey(exId, userId)) || '[]'));
  } catch {
    return new Set();
  }
}

function ResponseForm({ ex, inj, onSaved }) {
  const [choice, setChoice] = useState(inj.my_response ? inj.my_response.choice || '' : '');
  const [content, setContent] = useState(inj.my_response ? inj.my_response.content || '' : '');
  const [run, busy] = useAction();
  const [decide, setDecide] = useState(false);
  useEffect(() => {
    setChoice(inj.my_response ? inj.my_response.choice || '' : '');
    setContent(inj.my_response ? inj.my_response.content || '' : '');
  }, [inj.id, inj.my_response]);
  const live = ['running', 'paused'].includes(ex.state.status);
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(() => api.post(`/exercise-injects/${inj.id}/respond`, { choice: choice || null, content }), inj.my_response ? 'Respons diperbarui' : 'Respons terkirim');
    if (r) onSaved();
  };
  return (
    <form className="col" onSubmit={submit}>
      {inj.question && <div className="strong">Pertanyaan: {inj.question}</div>}
      {inj.options && inj.options.length > 0 && (
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }} className="grid g2">
          <legend className="sr-only">Pilihan keputusan</legend>
          {inj.options.map((o) => (
            <label key={o} className={`option-pill ${choice === o ? 'selected' : ''}`}>
              <input type="radio" name={`opt-${inj.id}`} checked={choice === o} onChange={() => setChoice(o)} disabled={!live} /> {o}
            </label>
          ))}
        </fieldset>
      )}
      <Field label={ex.me.team_id ? 'Respons tim Anda (satu respons per tim, bisa diperbarui)' : 'Respons Anda'}>
        <textarea className="textarea" value={content} onChange={(e) => setContent(e.target.value)} disabled={!live} placeholder="Jelaskan tindakan yang diambil, siapa yang melakukan, dan pertimbangannya…" />
      </Field>
      {inj.my_response && (
        <div className="small muted">Terakhir dikirim oleh {inj.my_response.user_name || 'anggota tim'} pada {fmtSim(inj.my_response.sim_time_sec, true)}.</div>
      )}
      {live ? (
        <div className="row">
          <button className="btn btn-primary" disabled={busy || (!content.trim() && !choice)}><Icon name="send" /> {inj.my_response ? 'Perbarui respons' : 'Kirim respons'}</button>
          <button type="button" className="btn" onClick={() => setDecide(true)}>Ajukan keputusan</button>
        </div>
      ) : (
        <div className="alert small">{ex.state.status === 'ended' ? 'Latihan sudah berakhir.' : 'Latihan belum dimulai.'}</div>
      )}
      {decide && <DecisionForm ex={ex} injectId={inj.id} onClose={() => setDecide(false)} />}
    </form>
  );
}

const CHECKLIST = [
  ['read', 'Saya sudah membaca briefing dan narasi pembuka'],
  ['role', 'Saya memahami tanggung jawab dan kewenangan peran saya'],
  ['sound', 'Notifikasi suara sudah dites dan terdengar'],
];

function ReadyPanel({ ex }) {
  const [run, busy] = useAction();
  const [checks, setChecks] = useState({});
  const players = ex.members.filter((m) => m.role === 'player');
  const ready = players.filter((m) => m.ready_at).length;
  const allChecked = CHECKLIST.every(([k]) => checks[k]);
  const set = (v) => run(() => api.post(`/exercises/${ex.id}/ready`, { ready: v, acknowledged: v && allChecked }), v ? 'Anda dinyatakan siap' : 'Status siap dibatalkan');
  return (
    <div className="col" style={{ padding: 14, borderRadius: 10, background: ex.me.ready ? 'var(--good-soft)' : 'var(--accent-soft)' }}>
      <div className="row">
        <Icon name={ex.me.ready ? 'check' : 'alert'} />
        <div className="grow">
          <div className="strong">{ex.me.ready ? 'Anda sudah menyatakan siap' : 'Konfirmasi kesiapan Anda'}</div>
          <div className="small muted">
            {ready}/{players.length} peserta siap. Latihan baru bisa dimulai setelah semua peserta siap.
            {ex.scheduled_for && <> · <Countdown to={ex.scheduled_for} prefix="Dijadwalkan" className="" /></>}
          </div>
        </div>
        {ex.me.ready && <button className="btn btn-ghost" disabled={busy} onClick={() => set(false)}>Batalkan</button>}
      </div>
      {!ex.me.ready && (
        <>
          {ex.briefing && (
            <div>
              <div className="field-label">Briefing</div>
              <div className="pre small">{ex.briefing}</div>
            </div>
          )}
          <div className="col tight">
            {CHECKLIST.map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={!!checks[k]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} /> {label}
                {k === 'sound' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => beep()}>Tes suara</button>}
              </label>
            ))}
          </div>
          <div><button className="btn btn-good btn-lg" disabled={busy || !allChecked} onClick={() => set(true)}><Icon name="check" /> Saya siap</button></div>
        </>
      )}
    </div>
  );
}

function FeedbackForm({ ex }) {
  const [rating, setRating] = useState(0);
  const [realism, setRealism] = useState(0);
  const [comments, setComments] = useState('');
  const [done, setDone] = useState(false);
  const [run, busy] = useAction();
  useEffect(() => {
    api.get(`/exercises/${ex.id}/feedback`).then((r) => {
      if (r && r[0]) {
        setRating(r[0].rating);
        setRealism(r[0].realism || 0);
        setComments(r[0].comments || '');
        setDone(true);
      }
    }).catch(() => {});
  }, [ex.id]);
  const submit = async () => {
    if (await run(() => api.post(`/exercises/${ex.id}/feedback`, { rating, realism: realism || null, comments }), 'Terima kasih atas umpan balik Anda')) setDone(true);
  };
  return (
    <div className="card card-pad col">
      <h2>Latihan telah berakhir — bagaimana pengalaman Anda?</h2>
      {done && <div className="alert good small">Umpan balik Anda sudah tersimpan. Anda masih dapat memperbaruinya.</div>}
      <Field label="Kepuasan keseluruhan"><Stars value={rating} onChange={setRating} label="Kepuasan keseluruhan" /></Field>
      <Field label="Seberapa realistis skenario ini?"><Stars value={realism} onChange={setRealism} label="Realisme" /></Field>
      <Field label="Masukan (apa yang berjalan baik, apa yang perlu diperbaiki)"><textarea className="textarea" value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
      <div><button className="btn btn-primary" disabled={!rating || busy} onClick={submit}>Kirim umpan balik</button></div>
    </div>
  );
}

export default function PlayerWorkspace({ ex }) {
  const toast = useToast();
  const [injects, setInjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [seen, setSeen] = useState(() => loadSeen(ex.id, ex.me.user_id));
  const [flash, setFlash] = useState(null);
  const [tab, setTab] = useState('inbox');
  const known = useRef(null);
  const myRole = ex.roles.find((r) => r.id === ex.me.exercise_role_id);
  const myTeam = ex.teams.find((t) => t.id === ex.me.team_id);

  const resync = useResync();
  const load = useCallback(async () => {
    try {
      const list = await api.get(`/exercises/${ex.id}/my-injects`);
      if (known.current) {
        const fresh = list.filter((i) => !known.current.has(i.id));
        fresh.forEach((i) => {
          toast({ title: `Inject baru: ${i.title}`, body: INJECT_TYPES[i.type], kind: i.priority === 'kritis' ? 'bad' : 'warn' });
          beep(i.priority);
        });
        if (fresh.length && !selected) setSelected(fresh[0].id);
      }
      known.current = new Set(list.map((i) => i.id));
      setInjects(list);
    } catch {
      /* abaikan */
    }
  }, [ex.id, toast, selected]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.id, ex.state.status, ex.me.exercise_role_id, ex.me.team_id, resync]);

  useSocketEvent('injects:changed', () => load());
  useSocketEvent('response:new', (r) => r.exercise_id === ex.id && load());
  useSocketEvent('broadcast', (m) => {
    if (m.exercise_id !== ex.id) return;
    setFlash(m.body);
    toast({ title: 'Pengumuman fasilitator', body: m.body, kind: 'warn', duration: 9000 });
    beep();
  });
  useSocketEvent('escalation:new', (e) => {
    if (e.exercise_id === ex.id && e.to_role_id === ex.me.exercise_role_id) {
      toast({ title: `Eskalasi dari ${e.from_name}`, body: e.subject, kind: 'bad', duration: 9000 });
      beep('kritis');
    }
  });
  useSocketEvent('decision:new', (d) => {
    if (d.exercise_id === ex.id && d.status === 'pending' && ex.me.can_approve && d.user_id !== ex.me.user_id) {
      toast({ title: 'Keputusan menunggu persetujuan Anda', body: d.decision, kind: 'warn' });
      beep();
    }
  });
  useSocketEvent('decision:updated', (d) => {
    if (d.exercise_id === ex.id && d.user_id === ex.me.user_id) toast({ title: d.status === 'approved' ? 'Keputusan Anda disetujui' : 'Keputusan Anda ditolak', body: d.decision, kind: d.status === 'approved' ? 'good' : 'bad' });
  });
  useSocketEvent('statement:new', (s) => {
    if (s.exercise_id === ex.id && s.user_id !== ex.me.user_id) toast({ title: 'Pernyataan publik baru', body: s.title });
  });

  const current = injects.find((i) => i.id === selected) || null;
  useEffect(() => {
    if (current && !seen.has(current.id)) {
      const next = new Set(seen);
      next.add(current.id);
      setSeen(next);
      try {
        localStorage.setItem(seenKey(ex.id, ex.me.user_id), JSON.stringify([...next]));
      } catch {
        /* abaikan */
      }
    }
  }, [current, seen, ex.id, ex.me.user_id]);

  const unread = useMemo(() => injects.filter((i) => !seen.has(i.id)).length, [injects, seen]);
  const waiting = injects.filter((i) => i.requires_response && !i.my_response).length;
  const status = ex.state.status;

  return (
    <>
      {flash && (
        <div className="flash-banner" role="alert">
          <Icon name="mega" /> <span className="grow"><strong>Pengumuman:</strong> {flash}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setFlash(null)} aria-label="Tutup pengumuman"><Icon name="x" /></button>
        </div>
      )}
      <div className="page" style={{ paddingTop: 16 }}>
        <div className="row">
          {myRole ? <RoleTag name={`Peran: ${myRole.name}`} color={myRole.color} /> : <span className="badge warn">Belum ada peran player</span>}
          {myTeam ? <span className="chip"><span className="dot" style={{ background: myTeam.color, borderRadius: '50%' }} />Tim: {myTeam.name}</span> : <span className="badge">Tanpa tim</span>}
          {waiting > 0 && <span className="badge warn">{waiting} inject menunggu respons</span>}
        </div>

        {status === 'draft' && (
          <div className="card card-pad col">
            <ReadyPanel ex={ex} />
            <div className="row"><span className="spinner" /><h2>Menunggu fasilitator memulai latihan…</h2></div>
            {ex.narrative && <><div className="field-label mt">Narasi pembuka</div><div className="pre">{ex.narrative}</div></>}
          </div>
        )}
        {status === 'ended' && <FeedbackForm ex={ex} />}

        <div className="tabs" role="tablist">
          {[
            ['inbox', `Inbox${unread ? ` (${unread})` : ''}`, 'inbox'],
            ['decisions', 'Keputusan', 'check'],
            ['public', 'Kanal publik', 'mega'],
            ['escalations', 'Eskalasi', 'alert'],
          ].map(([k, l, ic]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}><Icon name={ic} size={14} /> {l}</button>
          ))}
        </div>

        <div className="split">
          <div className="main-col">
            {tab === 'inbox' && (
              <div className="split">
                <nav className="card" style={{ flex: '1 1 260px', minWidth: 0, overflow: 'hidden', alignSelf: 'stretch' }} aria-label="Inbox inject">
                  <div className="card-head"><h2 className="grow">Inbox inject</h2>{unread > 0 && <span className="badge warn round">{unread} baru</span>}</div>
                  <div style={{ maxHeight: 640, overflowY: 'auto' }}>
                    {injects.length === 0 ? <Empty>{status === 'draft' ? 'Inject akan muncul saat latihan berjalan.' : 'Belum ada inject untuk Anda.'}</Empty> : injects.map((i) => (
                      <button key={i.id} className={`inbox-item ${selected === i.id ? 'active' : ''} ${seen.has(i.id) ? '' : 'unread'}`} onClick={() => setSelected(i.id)}>
                        <div className="inbox-meta">
                          <span style={{ color: i.priority === 'kritis' ? 'var(--bad-text)' : i.priority === 'tinggi' ? 'var(--accent)' : undefined }}>{INJECT_TYPES[i.type]}</span>
                          <span className="grow" />
                          <span className="mono">{fmtSim(i.sim_sent_sec, true)}</span>
                        </div>
                        <div className="inbox-title">{i.title}</div>
                        <div className="tiny" style={{ marginTop: 2, color: i.my_response ? 'var(--good-text)' : i.requires_response ? 'var(--accent)' : 'var(--muted)' }}>
                          {i.my_response ? 'Sudah dijawab' : i.requires_response ? 'Belum dijawab' : 'Informasi'}
                        </div>
                      </button>
                    ))}
                  </div>
                </nav>
                <article className="card card-pad col" style={{ flex: '999 1 420px', minWidth: 0 }}>
                  {!current ? <Empty>Pilih inject di inbox untuk melihat detailnya.</Empty> : (
                    <>
                      <div className="row">
                        {current.priority !== 'normal' && <span className={`badge ${PRIORITY[current.priority].cls}`}>{PRIORITY[current.priority].label.toUpperCase()}</span>}
                        <span className="badge">{INJECT_TYPES[current.type]}</span>
                        <span className="small muted">{current.sender ? `Dari: ${current.sender}` : ''}</span>
                        <span className="grow" />
                        <span className="mono small muted">{fmtSim(current.sim_sent_sec)}</span>
                      </div>
                      <h1>{current.title}</h1>
                      <InjectBody inj={current} />
                      {current.requires_response || current.question || (current.options || []).length ? (
                        <ResponseForm ex={ex} inj={current} onSaved={load} />
                      ) : null}
                    </>
                  )}
                </article>
              </div>
            )}
            {tab === 'decisions' && <DecisionList ex={ex} />}
            {tab === 'public' && <StatementList ex={ex} />}
            {tab === 'escalations' && <EscalationList ex={ex} />}
          </div>
          <aside className="side-col">
            {myRole && (
              <div className="card card-pad col tight" style={{ borderTop: `3px solid ${myRole.color}` }}>
                <h2>{myRole.name}</h2>
                {myRole.subtitle && <div className="small muted">{myRole.subtitle}</div>}
                {myRole.description && <p className="small" style={{ color: 'var(--text-2)' }}>{myRole.description}</p>}
                <div className="row mt-s">
                  {myRole.can_approve && <span className="badge info">Menyetujui keputusan</span>}
                  {myRole.can_statement && <span className="badge warn">Pernyataan publik</span>}
                  {myRole.can_escalate && <span className="badge bad">Eskalasi</span>}
                </div>
              </div>
            )}
            {ex.narrative && status !== 'draft' && (
              <details className="card card-pad">
                <summary className="strong" style={{ cursor: 'pointer' }}>Narasi skenario</summary>
                <div className="pre small mt">{ex.narrative}</div>
              </details>
            )}
            <div className="card"><Chat ex={ex} me={ex.me} compact /></div>
            {myTeam && (
              <div className="card card-pad col tight">
                <h3>Anggota {myTeam.name}</h3>
                {ex.members.filter((m) => m.team_id === myTeam.id).map((m) => {
                  const r = ex.roles.find((x) => x.id === m.exercise_role_id);
                  return <div key={m.id} className="row small"><span className="grow">{m.name}</span>{r && <span className="muted">{r.name}</span>}</div>;
                })}
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
