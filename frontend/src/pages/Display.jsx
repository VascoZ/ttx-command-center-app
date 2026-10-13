import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { Icon, Logo } from '../ui';
import { computeSim } from '../components/useExercise';
import { fmtSim, fmtDuration, INJECT_TYPES, STATUS, CATEGORY, STATEMENT_CHANNEL } from '../format';

const POLL_MS = 4000;
const KIND_COLOR = {
  inject: 'var(--accent)',
  response: 'var(--good)',
  decision: 'var(--info)',
  statement: '#f472b6',
  escalation: 'var(--bad)',
  broadcast: 'var(--purple)',
  ready: 'var(--good)',
  status: 'var(--muted)',
};

/** Data layar: lewat tautan berkunci (tanpa login) atau sebagai staf yang login. */
function useDisplayData(source) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const load = useCallback(async () => {
    try {
      const d =
        source.key
          ? await fetch(`/api/display/${encodeURIComponent(source.key)}`).then(async (r) => {
              const j = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error(j.error || `Gagal memuat (${r.status})`);
              return j;
            })
          : await api.get(`/exercises/${source.id}/display`);
      setOffset(new Date(d.exercise.server_time).getTime() - Date.now());
      setData(d);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [source.key, source.id]);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  return { data, error, offset };
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Stat({ label, value, tone }) {
  return (
    <div className="dsp-stat">
      <div className="dsp-stat-label">{label}</div>
      <div className="dsp-stat-value" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

function Bar({ value, max, color = 'var(--good)' }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="dsp-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function TeamCard({ t, status }) {
  const live = status !== 'draft';
  const rate = t.injects_required ? Math.round((t.injects_answered / t.injects_required) * 100) : null;
  return (
    <div className="dsp-team" style={{ borderTopColor: t.color }}>
      <div className="dsp-team-head">
        <span className="dsp-team-name">{t.name}</span>
        <span className="dsp-chip"><span className="dsp-dot" style={{ background: t.online ? 'var(--good)' : 'var(--line-2)' }} />{t.online}/{t.members} online</span>
      </div>
      {!live ? (
        <>
          <div className="dsp-row"><span>Siap</span><strong>{t.ready}/{t.members}</strong></div>
          <Bar value={t.ready} max={t.members} />
          <div className="dsp-row"><span>Peran terisi</span><strong>{t.roles_filled}/{t.roles_total}</strong></div>
          {t.required_missing.length > 0 && <div className="dsp-warn">Peran wajib kosong: {t.required_missing.join(', ')}</div>}
        </>
      ) : (
        <>
          <div className="dsp-row"><span>Inject dijawab</span><strong>{t.injects_answered}/{t.injects_required}{rate !== null ? ` · ${rate}%` : ''}</strong></div>
          <Bar value={t.injects_answered} max={t.injects_required} color={rate !== null && rate < 50 ? 'var(--accent)' : 'var(--good)'} />
          <div className="dsp-mini">
            <div><strong>{t.decisions_approved}</strong><span>keputusan disetujui</span></div>
            <div><strong style={t.decisions_pending ? { color: 'var(--accent)' } : undefined}>{t.decisions_pending}</strong><span>menunggu persetujuan</span></div>
            <div><strong style={t.escalations_open ? { color: 'var(--bad-text)' } : undefined}>{t.escalations_open}/{t.escalations}</strong><span>eskalasi terbuka</span></div>
            <div><strong>{t.statements}</strong><span>pernyataan publik</span></div>
          </div>
        </>
      )}
    </div>
  );
}

export default function Display({ publicKey }) {
  const params = useParams();
  const source = publicKey ? { key: params.key } : { id: params.id };
  const { data, error, offset } = useDisplayData(source);
  const now = useNow();
  const root = useRef(null);

  useEffect(() => {
    if (data) document.title = `Layar — ${data.exercise.title}`;
  }, [data]);

  if (!data) {
    return (
      <div className="dsp dsp-center">
        <Logo size={40} />
        <div className="dsp-muted">{error ? error.message : 'Memuat layar…'}</div>
      </div>
    );
  }

  const ex = data.exercise;
  const status = ex.status;
  const sim = computeSim(ex, offset);
  const realSec = ex.started_at ? (((ex.ended_at ? new Date(ex.ended_at).getTime() : now + offset) - new Date(ex.started_at).getTime()) / 1000) : 0;
  const durationSec = (ex.duration_min || 0) * 60;
  // hitung mundur inject berikutnya: detik simulasi ÷ kecepatan, dikurangi waktu sejak data terakhir
  const nextReal = data.injects.next_in_sim_sec !== null && status === 'running' ? Math.max(0, data.injects.next_in_sim_sec - (sim - ex.sim_now_sec)) / (ex.speed || 1) : null;
  const toSchedule = ex.scheduled_for ? Math.round((new Date(ex.scheduled_for).getTime() - (now + offset)) / 1000) : null;
  const latestBroadcast = data.broadcasts[0];

  const fullscreen = () => {
    const el = root.current;
    if (!document.fullscreenElement && el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
  };

  return (
    <div className="dsp" ref={root}>
      <header className="dsp-header">
        <div className="dsp-title">
          <Logo size={30} />
          <div>
            <div className="dsp-eyebrow">
              <span className={`dsp-status ${status}`}>{(STATUS[status] || {}).label || status}</span>
              {ex.category && <span>{CATEGORY[ex.category] || ex.category}</span>}
              {error && <span className="dsp-offline">koneksi terputus — mencoba lagi</span>}
            </div>
            <h1>{ex.title}</h1>
          </div>
        </div>
        <div className="dsp-clock">
          <div className="dsp-clock-label">JAM SIMULASI</div>
          <div className="dsp-clock-value">{fmtSim(sim)}</div>
        </div>
        <div className="dsp-stats">
          <Stat label="Waktu nyata" value={fmtDuration(realSec)} />
          <Stat label="Kecepatan" value={`${ex.speed}×`} />
          <Stat label="Inject" value={`${data.injects.sent}/${data.injects.total}`} />
          <Stat label="Peserta online" value={`${data.totals.online}/${data.totals.players}`} />
          {nextReal !== null && <Stat label="Inject berikutnya" value={fmtDuration(nextReal)} tone="var(--accent)" />}
          <button className="btn btn-ghost icon-btn dsp-fs" onClick={fullscreen} aria-label="Layar penuh" title="Layar penuh"><Icon name="eye" /></button>
        </div>
      </header>
      {durationSec > 0 && status !== 'draft' && <Bar value={Math.min(sim, durationSec)} max={durationSec} color="var(--accent)" />}

      {latestBroadcast && status !== 'ended' && (
        <div className="dsp-broadcast"><Icon name="mega" size={22} /><span><strong>Pengumuman fasilitator · {fmtSim(latestBroadcast.sim_time_sec, true)}</strong>{latestBroadcast.body}</span></div>
      )}

      {status === 'draft' && (
        <div className="dsp-banner">
          <div className="dsp-banner-big">{toSchedule !== null && toSchedule > 0 ? `Dimulai dalam ${fmtDuration(toSchedule)}` : 'Menunggu fasilitator memulai latihan'}</div>
          <div className="dsp-muted">{data.totals.ready}/{data.totals.players} peserta siap · {data.teams.length} instansi</div>
        </div>
      )}
      {status === 'ended' && (
        <div className="dsp-banner">
          <div className="dsp-banner-big">Latihan selesai</div>
          <div className="dsp-muted">
            {data.totals.responses} respons · {data.totals.decisions} keputusan · {data.totals.statements} pernyataan publik · {data.totals.escalations} eskalasi · durasi {fmtDuration(realSec)}
          </div>
        </div>
      )}

      <main className="dsp-grid">
        <section className="dsp-col dsp-teams">
          <h2>Instansi</h2>
          {data.teams.length === 0 ? <div className="dsp-empty">Belum ada instansi yang bergabung.</div> : (
            <div className="dsp-team-grid">{data.teams.map((t) => <TeamCard key={t.id} t={t} status={status} />)}</div>
          )}
        </section>

        <section className="dsp-col">
          <h2>Timeline inject</h2>
          {data.injects.timeline.length === 0 ? <div className="dsp-empty">{status === 'draft' ? 'Inject muncul saat latihan berjalan.' : 'Belum ada inject terkirim.'}</div> : (
            <ol className="dsp-list">
              {data.injects.timeline.map((i, idx) => (
                <li key={idx} className={idx === 0 && status === 'running' ? 'dsp-new' : ''}>
                  <span className="dsp-time">{fmtSim(i.sim_sent_sec, true)}</span>
                  <div>
                    <div className="dsp-item-title">
                      {i.priority !== 'normal' && <span className={`dsp-prio ${i.priority}`}>{i.priority.toUpperCase()}</span>}
                      {i.title}
                    </div>
                    <div className="dsp-muted">{INJECT_TYPES[i.type] || i.type} → {i.target}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="dsp-col">
          <h2>Kanal publik</h2>
          {data.statements.length === 0 ? <div className="dsp-empty">Belum ada pernyataan publik.</div> : (
            <div className="dsp-statements">
              {data.statements.slice(0, 3).map((s, idx) => (
                <article key={idx} className="dsp-statement">
                  <div className="dsp-muted">{STATEMENT_CHANNEL[s.channel] || s.channel} · {fmtSim(s.sim_time_sec, true)} · {s.by}</div>
                  <div className="dsp-item-title">{s.title}</div>
                  <p>{s.body}</p>
                </article>
              ))}
            </div>
          )}
          <h2 className="dsp-mt">Aktivitas terbaru</h2>
          {data.activity.length === 0 ? <div className="dsp-empty">Belum ada aktivitas.</div> : (
            <ol className="dsp-list dsp-activity">
              {data.activity.map((a, idx) => (
                <li key={idx}>
                  <span className="dsp-time">{fmtSim(a.sim_time_sec, true)}</span>
                  <span className="dsp-dot" style={{ background: KIND_COLOR[a.kind] || 'var(--muted)', marginTop: 7 }} />
                  <span>{a.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}
