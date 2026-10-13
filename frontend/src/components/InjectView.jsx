import { INJECT_TYPES, PRIORITY, fmtSim, fmtOffset } from '../format';
import { Avatar, Icon } from '../ui';

function Attachments({ items }) {
  if (!items || !items.length) return null;
  return (
    <div className="col tight mt">
      {items.map((a, i) =>
        a.mime && a.mime.startsWith('image/') ? (
          <a key={i} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt={a.name} className="attach-img" /></a>
        ) : a.mime && a.mime.startsWith('audio/') ? (
          <audio key={i} controls src={a.url} style={{ width: '100%' }} />
        ) : a.mime && a.mime.startsWith('video/') ? (
          <video key={i} controls src={a.url} style={{ maxWidth: '100%', borderRadius: 8 }} />
        ) : (
          <a key={i} className="attach" href={a.url} target="_blank" rel="noreferrer"><Icon name="download" /> {a.name}</a>
        )
      )}
    </div>
  );
}

/** Tampilan isi inject sesuai jenisnya (email, berita, medsos, log, dst.). */
export function InjectBody({ inj }) {
  const type = inj.type || 'text';
  if (type === 'email')
    return (
      <div className="inject-box inject-email">
        <div className="email-head">
          <div><span className="muted">Dari:</span> <strong>{inj.sender || 'tidak diketahui'}</strong></div>
          <div><span className="muted">Perihal:</span> {inj.title}</div>
        </div>
        {inj.content}
        <Attachments items={inj.attachments} />
      </div>
    );
  if (type === 'news')
    return (
      <div className="inject-box inject-news">
        <div className="news-source">{inj.sender || 'Berita'}</div>
        <div className="news-title">{inj.title}</div>
        {inj.content}
        <Attachments items={inj.attachments} />
      </div>
    );
  if (type === 'social')
    return (
      <div className="inject-box inject-social">
        <div className="social-head">
          <Avatar name={(inj.sender || 'A').replace('@', '')} />
          <div><strong>{inj.sender || 'Akun anonim'}</strong><div className="tiny muted">Media sosial</div></div>
        </div>
        {inj.content}
        <Attachments items={inj.attachments} />
      </div>
    );
  if (type === 'log')
    return (
      <div className="inject-box inject-log">
        {`# sumber: ${inj.sender || 'sistem'}\n`}
        {inj.content}
        <Attachments items={inj.attachments} />
      </div>
    );
  return (
    <div className={`inject-box ${type === 'phone' ? 'inject-phone' : type === 'memo' ? 'inject-memo' : ''}`}>
      {inj.sender && <div className="small muted" style={{ whiteSpace: 'normal', marginBottom: 6 }}>{type === 'phone' ? 'Panggilan dari' : 'Dari'}: <strong>{inj.sender}</strong></div>}
      {inj.content}
      <Attachments items={inj.attachments} />
    </div>
  );
}

export function InjectMeta({ inj, roles = [], teams = [] }) {
  const role = roles.find((r) => r.id === inj.exercise_role_id);
  const team = teams.find((t) => t.id === inj.team_id);
  const pr = PRIORITY[inj.priority] || PRIORITY.normal;
  return (
    <div className="row small">
      {inj.priority !== 'normal' && <span className={`badge ${pr.cls}`}>{pr.label.toUpperCase()}</span>}
      <span className="badge">{INJECT_TYPES[inj.type] || inj.type}</span>
      <span className="mono muted">{inj.sim_sent_sec !== null && inj.sim_sent_sec !== undefined ? fmtSim(inj.sim_sent_sec, true) : fmtOffset(inj.offset_min)}</span>
      <span className="muted">→ {role ? role.name : team ? team.name : 'Semua peserta'}</span>
      {inj.adhoc && <span className="badge info">ad-hoc</span>}
    </div>
  );
}
