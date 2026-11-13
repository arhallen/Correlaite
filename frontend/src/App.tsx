import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuth } from './auth';
import { useCredits } from './credits';
import Credits from './pages/Credits';
import Login from './pages/Login';
import Verify from './pages/Verify';
import Workbench from './pages/Workbench';
import Admin from './pages/Admin';
import DataManagement from './pages/DataManagement';
import Landing from './pages/Landing';

function Protected({ children, admin }: { children: ReactElement; admin?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted center">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

// Remember that this browser had a session, so signed-in users see a spinner (not the landing page) while /me loads.
const hadSession = () => { try { return localStorage.getItem('hadSession') === '1'; } catch { return false; } };

function Home() {
  const { user, loading } = useAuth();
  if (user) return <Workbench />;
  if (loading && hadSession()) return <p className="muted center">Loading…</p>;
  return <Landing />;
}

export default function App() {
  const { user, logout } = useAuth();
  const { balance } = useCredits();
  return (
    <>
      <header className="bar">
        <Link to="/" className="brand"><img src="/logo.svg" alt="" width="26" height="26" />Correlaite</Link>
        <nav>
          {!user && <Link to="/login">Sign in</Link>}
          {user && (
            <>
              <NavLink to="/data-management">Data management</NavLink>
              <NavLink to="/benchmark">Benchmark</NavLink>
              <NavLink to="/credits">Credit management</NavLink>
            </>
          )}
          {user?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          {user && (
            <>
              {balance !== null && <Link to="/credits" className="chip" title="Your credit balance">{balance} credits</Link>}
              <span className="muted">{user.email}</span>
              <button className="link" onClick={logout}>Sign out</button>
            </>
          )}
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/verify" element={<Verify />} />
          <Route path="/" element={<Home />} />
          <Route path="/benchmark" element={<Protected><Workbench /></Protected>} />
          <Route path="/credits" element={<Protected><Credits /></Protected>} />
          <Route path="/data-management" element={<Protected><DataManagement /></Protected>} />
          <Route path="/market-data" element={<Navigate to="/data-management" replace />} />
          <Route path="/admin" element={<Protected admin><Admin /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
