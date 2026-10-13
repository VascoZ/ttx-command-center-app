import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useExercise } from '../components/useExercise';
import ExerciseHeader from '../components/ExerciseHeader';
import { Loading } from '../ui';
import Console from './Console';
import PlayerWorkspace from './PlayerWorkspace';

export default function ExerciseHub() {
  const { id } = useParams();
  const { ex, error, state, online, simNow, realSec, reload, deleted } = useExercise(id);
  // gabungkan state live ke objek latihan agar komponen anak selalu melihat status terbaru
  const exv = useMemo(() => (ex ? { ...ex, state: state || ex.state, status: (state || ex.state).status } : null), [ex, state]);

  if (deleted) return <div className="page"><div className="alert bad">Latihan ini telah dihapus.</div><Link to="/exercises">Kembali ke daftar latihan</Link></div>;
  if (error) return <div className="page"><div className="alert bad">{error.message}</div><Link to="/exercises">Kembali ke daftar latihan</Link></div>;
  if (!exv) return <Loading />;

  const header = <ExerciseHeader ex={exv} state={state} simNow={simNow} realSec={realSec} online={online} onChange={() => {}} />;
  if (exv.me.is_player && !exv.me.is_facilitator) {
    return (
      <>
        {header}
        <PlayerWorkspace ex={exv} simNow={simNow} online={online} reload={reload} />
      </>
    );
  }
  return (
    <>
      {header}
      <Console ex={exv} simNow={simNow} online={online} reload={reload} />
    </>
  );
}
