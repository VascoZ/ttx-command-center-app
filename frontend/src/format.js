export function fmtSim(sec, short = false) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return short ? `T+${p(h)}:${p(m)}` : `T+${p(h)}:${p(m)}:${p(ss)}`;
}

export function fmtOffset(min) {
  const m = Math.max(0, parseInt(min, 10) || 0);
  return `T+${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

const DTF = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const DF = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' });
export const fmtDateTime = (d) => (d ? DTF.format(new Date(d)) : '–');
export const fmtDate = (d) => (d ? DF.format(new Date(d.length === 10 ? `${d}T00:00:00` : d)) : '–');

export function initials(name = '') {
  return name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export const INJECT_TYPES = {
  text: 'Informasi',
  email: 'Email',
  news: 'Berita',
  social: 'Media sosial',
  log: 'Log teknis',
  phone: 'Telepon',
  memo: 'Memo / surat',
};
export const PRIORITY = {
  normal: { label: 'Normal', cls: '' },
  tinggi: { label: 'Prioritas tinggi', cls: 'warn' },
  kritis: { label: 'Kritis', cls: 'bad' },
};
export const STATUS = {
  draft: { label: 'DRAFT', cls: 'status-draft' },
  running: { label: 'BERJALAN', cls: 'status-running' },
  paused: { label: 'DIJEDA', cls: 'status-paused' },
  ended: { label: 'SELESAI', cls: 'status-ended' },
};
export const DIFFICULTY = { mudah: 'Mudah', menengah: 'Menengah', sulit: 'Sulit' };
export const CATEGORY = { siber: 'Siber', bencana: 'Bencana', operasional: 'Operasional', reputasi: 'Reputasi', lainnya: 'Lainnya' };
export const MEMBER_ROLE = { facilitator: 'Fasilitator', player: 'Peserta', evaluator: 'Evaluator', viewer: 'Viewer' };
export const OBS_CAT = {
  kekuatan: { label: 'Kekuatan', cls: 'good' },
  perbaikan: { label: 'Area perbaikan', cls: 'bad' },
  netral: { label: 'Catatan', cls: '' },
};
export const DECISION_STATUS = {
  pending: { label: 'Menunggu persetujuan', cls: 'warn' },
  approved: { label: 'Disetujui', cls: 'good' },
  rejected: { label: 'Ditolak', cls: 'bad' },
};
export const STATEMENT_CHANNEL = {
  siaran_pers: 'Siaran pers',
  media_sosial: 'Media sosial resmi',
  website: 'Website resmi',
  konferensi_pers: 'Konferensi pers',
};
export const ACTION_STATUS = { open: 'Belum mulai', in_progress: 'Berjalan', done: 'Selesai' };

export const EVENT_LABEL = {
  exercise_start: 'Latihan dimulai',
  exercise_pause: 'Latihan dijeda',
  exercise_resume: 'Latihan dilanjutkan',
  exercise_end: 'Latihan diakhiri',
  speed_changed: 'Kecepatan diubah',
  clock_jump: 'Jam simulasi dimajukan',
  inject_sent: 'Inject terkirim',
  inject_skipped: 'Inject dilewati',
  response_submitted: 'Respons dikirim',
  response_updated: 'Respons diperbarui',
  decision_created: 'Keputusan diajukan',
  decision_approved: 'Keputusan disetujui',
  decision_rejected: 'Keputusan ditolak',
  statement_published: 'Pernyataan publik',
  escalation_sent: 'Eskalasi dikirim',
  escalation_acknowledged: 'Eskalasi diterima',
  observation: 'Observasi evaluator',
  broadcast: 'Broadcast fasilitator',
};

export function eventKind(type) {
  if (type.startsWith('inject')) return 'inject';
  if (type.startsWith('response')) return 'response';
  if (type.startsWith('decision')) return 'decision';
  if (type.startsWith('statement')) return 'statement';
  if (type.startsWith('escalation')) return 'escalation';
  if (type === 'observation') return 'observation';
  return 'system';
}

export function eventText(e) {
  const p = e.payload || {};
  switch (e.type) {
    case 'inject_sent':
      return `${p.adhoc ? 'Inject ad-hoc' : 'Inject'} terkirim: "${p.title}"`;
    case 'inject_skipped':
      return `Inject dilewati: "${p.title}"`;
    case 'response_submitted':
    case 'response_updated':
      return `${p.by}${p.role ? ` (${p.role})` : ''} ${e.type === 'response_updated' ? 'memperbarui' : 'menjawab'} "${p.title}"${p.choice ? ` → ${p.choice}` : ''}`;
    case 'decision_created':
      return `${p.by}${p.role ? ` (${p.role})` : ''} mengajukan keputusan "${p.decision}"${p.status === 'pending' ? ' — menunggu persetujuan' : ''}`;
    case 'decision_approved':
      return `${p.by} menyetujui "${p.decision}"`;
    case 'decision_rejected':
      return `${p.by} menolak "${p.decision}"`;
    case 'statement_published':
      return `${p.by}${p.role ? ` (${p.role})` : ''} menerbitkan pernyataan publik "${p.title}"`;
    case 'escalation_sent':
      return `${p.from} mengeskalasi ke ${p.to_role}: "${p.subject}"`;
    case 'escalation_acknowledged':
      return `${p.by} menerima eskalasi "${p.subject}"`;
    case 'observation':
      return `${p.by} mencatat: "${p.body}"`;
    case 'broadcast':
      return `Broadcast: "${p.body}"`;
    case 'speed_changed':
      return `Kecepatan simulasi menjadi ${p.speed}×`;
    case 'clock_jump':
      return `Jam simulasi dimajukan ke ${fmtSim(p.to_sec)}`;
    case 'application_accepted':
      return p.count ? `${p.by} menerima ${p.count} lamaran` : `${p.by} menerima lamaran ${p.user}${p.team ? ` (${p.team})` : ''}`;
    case 'participant_ready':
      return `${p.by}${p.team ? ` (${p.team})` : ''} menyatakan siap`;
    case 'participant_not_ready':
      return `${p.by}${p.team ? ` (${p.team})` : ''} membatalkan status siap`;
    default:
      return EVENT_LABEL[e.type] || e.type;
  }
}
