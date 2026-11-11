import { useEffect, useState } from 'react';
import { api, type AdminRun, type AdminUser, type Stats } from '../api';

const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');

export default function Admin() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [runs, setRuns] = useState<AdminRun[]>([]);
  const [error, setError] = useState('');

  const load = () =>
    Promise.all([api<Stats>('/admin/stats'), api<AdminUser[]>('/admin/users'), api<AdminRun[]>('/admin/runs')])
      .then(([s, u, r]) => { setStats(s); setUsers(u); setRuns(r); })
      .catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function patch(id: string, body: { disabled?: boolean; role?: 'user' | 'admin' }) {
    setError('');
    try { await api(`/admin/users/${id}`, { method: 'PATCH', json: body }); await load(); }
    catch (e) { setError((e as Error).message); }
  }

  const max = Math.max(1, ...(stats?.daily.map((d) => d.runs) ?? [1]));
  const failRate = stats && stats.runs_total ? Math.round((stats.runs_failed / stats.runs_total) * 100) : 0;

  return (
    <>
      <h1>Admin</h1>
      {error && <p className="error">{error}</p>}
      {stats && (
        <>
          <div className="tiles">
            <Tile label="Users" value={stats.users} sub={`${stats.new_7d} new in 7d`} />
            <Tile label="Active (7d)" value={stats.active_7d} />
            <Tile label="Runs (24h)" value={stats.runs_24h} sub={`${stats.runs_total} total`} />
            <Tile label="Failed runs" value={`${failRate}%`} sub={`${stats.runs_failed} of ${stats.runs_total}`} />
            <Tile label="Datasets" value={stats.datasets} sub={fmtBytes(stats.storage_bytes)} />
            <Tile label="Tokens (7d)" value={stats.tokens_7d.toLocaleString()} />
          </div>
          <div className="card">
            <h2>Runs per day (14d)</h2>
            <div className="bars" role="img" aria-label="Runs per day">
              {stats.daily.map((d) => (
                <div key={d.day} className="bar-col" title={`${d.day}: ${d.runs}`}>
                  <div className="bar-fill" style={{ height: `${(d.runs / max) * 100}%` }} />
                  <span>{d.day.slice(8)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="card">
        <h2>Users</h2>
        <table>
          <thead><tr><th>Email</th><th>Role</th><th>Runs</th><th>Last login</th><th>Created</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.disabled ? 'muted' : ''}>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.runs}</td>
                <td>{fmtDate(u.last_login_at)}</td>
                <td>{fmtDate(u.created_at)}</td>
                <td className="actions">
                  <button className="link" onClick={() => patch(u.id, { disabled: !u.disabled })}>{u.disabled ? 'Enable' : 'Disable'}</button>
                  <button className="link" onClick={() => patch(u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}>
                    {u.role === 'admin' ? 'Make user' : 'Make admin'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Recent runs</h2>
        <table>
          <thead><tr><th>When</th><th>User</th><th>Prompt</th><th>Status</th><th>Time</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.created_at)}</td>
                <td>{r.email}</td>
                <td className="clip">{r.prompt}</td>
                <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                <td>{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="tile">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}
