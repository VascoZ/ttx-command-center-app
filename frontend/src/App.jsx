import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, ROLE_LABEL, canDesign } from './auth';
import { Icon, Logo, Loading, useTheme } from './ui';
import { useConnected } from './socket';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Exercises from './pages/Exercises';
import ExerciseHub from './pages/ExerciseHub';
import Report from './pages/Report';
import Scenarios from './pages/Scenarios';
import ScenarioEditor from './pages/ScenarioEditor';
import Generator from './pages/Generator';
import RolePresets from './pages/RolePresets';
import Users from './pages/Users';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import MyTeam from './pages/MyTeam';
import OrgTeams from './pages/OrgTeams';
import Notifier from './components/Notifier';
import Display from './pages/Display';

function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useTheme();
  const connected = useConnected();
  const design = canDesign(user);
  const admin = user.role === 'admin';
  const link = (to, icon, label) => (
    <NavLink to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onClose} end={to === '/'}>
      <Icon name={icon} /> {label}
    </NavLink>
  );
  return (
    <nav className={`sidebar ${open ? 'open' : ''}`} aria-label="Navigasi utama">
      <div className="brand">
        <Logo /> TTX COMMAND CENTER
      </div>
      {link('/', 'dashboard', 'Dashboard')}
      {link('/exercises', 'play', 'Latihan')}
      {!admin && link('/my-team', 'key', 'Tim saya')}
      {design && (
        <>
          <div className="nav-label">Perancangan</div>
          {link('/scenarios', 'book', 'Pustaka skenario')}
          {link('/generator', 'spark', 'Generator skenario')}
          {link('/roles', 'shield', 'Peran player')}
        </>
      )}
      {admin && (
        <>
          <div className="nav-label">Administrasi</div>
          {link('/teams', 'shield', 'Tim instansi')}
          {link('/users', 'users', 'Pengguna')}
          {link('/audit', 'log', 'Audit log')}
          {link('/settings', 'settings', 'Pengaturan')}
        </>
      )}
      <div className="sidebar-foot">
        <NavLink to="/profile" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onClose}>
          <Icon name="user" />
          <span className="grow">
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</span>
            <span className="tiny muted">{ROLE_LABEL[user.role]}</span>
          </span>
        </NavLink>
        <div className="row" style={{ padding: '0 6px' }}>
          <span className="tiny muted row" style={{ gap: 6 }}>
            <span className="dot" style={{ background: connected ? 'var(--good)' : 'var(--bad)', borderRadius: '50%' }} />
            {connected ? 'Real-time aktif' : 'Terputus'}
          </span>
          <span className="grow" />
          <button className="btn btn-ghost icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Ganti tema">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button className="btn btn-ghost icon-btn" onClick={logout} aria-label="Keluar">
            <Icon name="logout" />
          </button>
        </div>
      </div>
    </nav>
  );
}

function RequireDesign({ children }) {
  const { user } = useAuth();
  return canDesign(user) ? children : <Navigate to="/" replace />;
}
function RequireAdmin({ children }) {
  const { user } = useAuth();
  return user.role === 'admin' ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  // Layar penonton via tautan berkunci: tanpa login, tanpa sidebar
  if (loc.pathname.startsWith('/display/')) {
    return (
      <Routes>
        <Route path="/display/:key" element={<Display publicKey />} />
      </Routes>
    );
  }
  if (loading) return <Loading label="Menyiapkan aplikasi…" />;
  if (!user) return <Login />;
  // Layar penonton untuk staf yang login: layar penuh tanpa sidebar
  if (/^\/exercises\/\d+\/display\/?$/.test(loc.pathname)) {
    return (
      <Routes>
        <Route path="/exercises/:id/display" element={<Display />} />
      </Routes>
    );
  }

  return (
    <div className="app">
      <Notifier />
      <Sidebar open={open} onClose={() => setOpen(false)} />
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <div className="topbar">
          <button className="btn btn-ghost icon-btn" onClick={() => setOpen(true)} aria-label="Buka menu">
            <Icon name="menu" size={20} />
          </button>
          <Logo size={18} />
          <strong>TTX Command Center</strong>
        </div>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/exercises" element={<Exercises />} />
          <Route path="/exercises/:id" element={<ExerciseHub />} />
          <Route path="/exercises/:id/report" element={<Report />} />
          <Route path="/scenarios" element={<RequireDesign><Scenarios /></RequireDesign>} />
          <Route path="/scenarios/:id" element={<RequireDesign><ScenarioEditor /></RequireDesign>} />
          <Route path="/generator" element={<RequireDesign><Generator /></RequireDesign>} />
          <Route path="/roles" element={<RequireDesign><RolePresets /></RequireDesign>} />
          <Route path="/users" element={<RequireAdmin><Users /></RequireAdmin>} />
          <Route path="/audit" element={<RequireAdmin><AuditLog /></RequireAdmin>} />
          <Route path="/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/my-team" element={user.role === 'admin' ? <Navigate to="/teams" replace /> : <MyTeam />} />
          <Route path="/join" element={<Navigate to="/my-team" replace />} />
          <Route path="/teams" element={<RequireAdmin><OrgTeams /></RequireAdmin>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
