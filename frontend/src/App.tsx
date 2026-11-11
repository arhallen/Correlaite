import { Link, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuth } from './auth';
import Login from './pages/Login';
import Verify from './pages/Verify';
import Workbench from './pages/Workbench';
import Admin from './pages/Admin';

function Protected({ children, admin }: { children: ReactElement; admin?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted center">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, logout } = useAuth();
  return (
    <>
      <header className="bar">
        <Link to="/" className="brand">Correlaite</Link>
        <nav>
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
          <Route path="/" element={<Protected><Workbench /></Protected>} />
          <Route path="/admin" element={<Protected admin><Admin /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
