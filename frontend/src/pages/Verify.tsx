import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type User } from '../api';
import { useAuth } from '../auth';

export default function Verify() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { setUser } = useAuth();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; the token is single-use
    started.current = true;
    const token = params.get('token');
    if (!token) return setError('This link is incomplete.');
    api<User>('/auth/verify', { method: 'POST', json: { token } })
      .then((u) => { setUser(u); nav('/', { replace: true }); })
      .catch((e) => setError(e.message));
  }, [params, nav, setUser]);

  return (
    <div className="card narrow">
      {error ? (
        <>
          <h1>Link problem</h1>
          <p className="error">{error}</p>
          <Link to="/login">Request a new link</Link>
        </>
      ) : (
        <p className="muted">Signing you in…</p>
      )}
    </div>
  );
}
