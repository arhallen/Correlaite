import { Link, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuth } from './auth';
import Login from './pages/Login';
import Verify from './pages/Verify';
import Workbench from './pages/Workbench';
import Admin from './pages/Admin';
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
  return (
    <>
      <header className="bar">
        <Link to="/" className="brand"><img src="/logo.svg" alt="" width="26" height="26" />Correlaite</Link>
        <nav>
          {!user && <Link to="/login">Sign in</Link>}
          {user?.role === 'admin' && <Link to="/admin">Admin</Link>}
          {user && (
            <>
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
          <Route path="/admin" element={<Protected admin><Admin /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
