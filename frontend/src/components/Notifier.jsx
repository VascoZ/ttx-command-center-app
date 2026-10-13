import { useSocketEvent } from '../socket';
import { useToast, beep, browserNotify } from '../ui';

/** Notifikasi global peserta: lamaran ditinjau, pengingat jadwal, latihan dimulai. */
export default function Notifier() {
  const toast = useToast();
  useSocketEvent('application:updated', (d) => {
    if (d.status === 'pending') return;
    const ok = d.status === 'accepted';
    const title = ok ? 'Lamaran Anda diterima' : 'Lamaran Anda ditolak';
    const body = ok ? 'Buka latihan dan nyatakan Siap.' : 'Lihat alasannya di menu Tim saya.';
    toast({ title, body, kind: ok ? 'good' : 'bad', duration: 8000 });
    browserNotify(title, body, ok ? `/exercises/${d.exercise_id}` : '/my-team');
  });
  useSocketEvent('exercise:reminder', (d) => {
    const body = `${d.title} dijadwalkan pukul ${new Date(d.scheduled_for).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}. Pastikan Anda sudah menyatakan Siap.`;
    toast({ title: 'Latihan segera dimulai', body, duration: 12000 });
    beep();
    browserNotify('Latihan segera dimulai', body, `/exercises/${d.exercise_id}`);
  });
  useSocketEvent('exercise:started', (d) => {
    if (window.location.pathname === `/exercises/${d.exercise_id}`) return;
    toast({ title: 'Latihan dimulai', body: d.title, kind: 'good', duration: 12000 });
    beep('kritis');
    browserNotify('Latihan dimulai', d.title, `/exercises/${d.exercise_id}`);
  });
  return null;
}
