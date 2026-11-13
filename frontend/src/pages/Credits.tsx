import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useCredits, type Pricing } from '../credits';
import { fmtDate, fmtMoney } from '../format';

interface Pack { id: string; credits: number; priceCents: number }
interface Tx { id: string; amount: number; balance_after: number; kind: string; description: string; created_at: string }
interface Overview { balance: number; pricing: Pricing; packs: Pack[]; transactions: Tx[] }

export default function Credits() {
  const { refresh } = useCredits();
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => setData(await api<Overview>('/credits')), []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  async function buy(p: Pack) {
    setBusy(p.id);
    setError('');
    setMsg('');
    try {
      await api('/credits/purchase', { method: 'POST', json: { packId: p.id } });
      setMsg(`${p.credits} credits added to your balance.`);
      await Promise.all([load(), refresh()]);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }

  const pr = data?.pricing;
  return (
    <>
      <h1>Credit management</h1>

      <div className="tiles">
        <div className="tile"><span className="muted">Your balance</span><strong>{data ? data.balance : '–'}</strong><span className="muted small">credits</span></div>
      </div>

      <div className="card">
        <h2>Buy credits</h2>
        <p className="notice">Demo mode: payments are not live yet. Credits you "buy" here are added for free.</p>
        <div className="packs">
          {data?.packs.map((p) => (
            <div className="pack" key={p.id}>
              <strong>{p.credits} credits</strong>
              <span className="muted">{fmtMoney(p.priceCents)}</span>
              <button disabled={busy !== ''} onClick={() => buy(p)}>{busy === p.id ? 'Adding…' : 'Buy'}</button>
            </div>
          ))}
        </div>
        {msg && <p className="ok">{msg}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {pr && (
        <div className="card">
          <h2>How credits work</h2>
          <ul className="plain">
            <li>New accounts start with <strong>{pr.initialCredits}</strong> credits.</li>
            <li>Your own uploads, and files you already own, are <strong>free</strong> to use and view.</li>
            <li>Retrieving new data from the market costs <strong>{pr.downloadCost}</strong> credits.</li>
            <li>A file someone else already retrieved costs <strong>{pr.accessCost}</strong> credit, once. After that it is yours to use and view as often as you like.</li>
            <li>Every code run costs <strong>{pr.runBase}</strong> credits plus <strong>{pr.runPerSecond}</strong> credits per second it runs, rounded up to whole seconds, and never more than <strong>{pr.runMax}</strong>.</li>
            <li>Code can only be run with at least <strong>{pr.minToRun}</strong> credits.</li>
          </ul>
        </div>
      )}

      <div className="card">
        <h2>History</h2>
        <table>
          <thead><tr><th>Date</th><th>Description</th><th className="num">Credits</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {data?.transactions.map((t) => (
              <tr key={t.id}>
                <td>{fmtDate(t.created_at)}</td>
                <td>{t.description}</td>
                <td className={`num ${t.amount < 0 ? 'neg' : 'pos'}`}>{t.amount > 0 ? `+${t.amount}` : t.amount}</td>
                <td className="num">{t.balance_after}</td>
              </tr>
            ))}
            {data && data.transactions.length === 0 && <tr><td colSpan={4} className="muted">No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
