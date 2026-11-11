import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

export default function Login() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/request', { method: 'POST', json: { email } });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card narrow">
      <h1>Sign in</h1>
      {sent ? (
        <p>If that address can sign in, a link is on its way. It works once and expires in 15 minutes.</p>
      ) : (
        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </label>
          <button disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </div>
  );
}
