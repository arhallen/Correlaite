import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type MarketFile, type MarketList } from '../api';
import FileViewer from './FileViewer';

export const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
export const fmtDate = (s: string) => new Date(s).toLocaleString();
/** Non-secret request parameters as shown to users, e.g. "BTC / USD". */
export const kindLabel = (f: MarketFile) => (f.function === 'DIGITAL_CURRENCY_DAILY' ? 'CRYPTO' : 'STOCK');
/** Symbol first, then market and other parameters, e.g. "BTC / USD". */
export const describe = (f: MarketFile) =>
  [f.symbol, f.market, ...Object.entries(f.params).map(([k, v]) => `${k}=${v}`)].filter(Boolean).join(' / ');
/** Full display name: symbol / market · downloaded date and time · STOCK or CRYPTO. */
export const fullName = (f: MarketFile) => `${describe(f)} · ${fmtDate(f.created_at)} · ${kindLabel(f)}`;

const FUNCTIONS = [
  { value: 'TIME_SERIES_DAILY', label: 'Stock daily (TIME_SERIES_DAILY)', market: false },
  { value: 'DIGITAL_CURRENCY_DAILY', label: 'Crypto daily (DIGITAL_CURRENCY_DAILY)', market: true },
];

export default function MarketData() {
  const [data, setData] = useState<MarketList>({ configured: true, items: [] });
  const [fn, setFn] = useState(FUNCTIONS[0].value);
  const [symbol, setSymbol] = useState('');
  const [market, setMarket] = useState('USD');
  const [outputsize, setOutputsize] = useState('compact');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<MarketFile | null>(null);

  const load = useCallback(async () => setData(await api<MarketList>('/market-data')), []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  const crypto = FUNCTIONS.find((f) => f.value === fn)!.market;

  async function download() {
    setBusy(true);
    setError('');
    try {
      const body = crypto ? { function: fn, symbol, market } : { function: fn, symbol, outputsize };
      const f = await api<MarketFile>('/market-data', { method: 'POST', json: body });
      setData((d) => ({ ...d, items: [f, ...d.items] }));
      setSymbol('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove(f: MarketFile) {
    if (!confirm(`Delete ${f.filename}?`)) return;
    await api(`/market-data/${f.id}`, { method: 'DELETE' }).catch((e) => setError(e.message));
    load().catch(() => {});
  }

  return (
    <>
      <h1>Market data (Alpha Vantage)</h1>
      <p className="muted">
        Downloaded files are shared with all signed-in users. Pick them in the <Link to="/">workbench</Link> next to your own datasets.
      </p>

      <div className="card">
        <h2>Download new data</h2>
        {!data.configured && <p className="error">Alpha Vantage is not configured on the server.</p>}
        <div className="row">
          <label>Type
            <select value={fn} onChange={(e) => setFn(e.target.value)}>
              {FUNCTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <label>{crypto ? 'Cryptocurrency symbol' : 'Stock symbol'}
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder={crypto ? 'BTC' : 'AAPL'} maxLength={20} />
          </label>
          {crypto ? (
            <label>Market (currency)
              <input value={market} onChange={(e) => setMarket(e.target.value)} placeholder="USD" maxLength={10} />
            </label>
          ) : (
            <label>History
              <select value={outputsize} onChange={(e) => setOutputsize(e.target.value)}>
                <option value="compact">Last 100 days</option>
                <option value="full">Full history (may need premium)</option>
              </select>
            </label>
          )}
          <button disabled={busy || !data.configured || !symbol.trim() || (crypto && !market.trim())} onClick={download}>
            {busy ? 'Downloading…' : 'Download'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h2>Downloaded files</h2>
        <table>
          <thead>
            <tr><th>Symbol</th><th>Market</th><th>Options</th><th>Downloaded</th><th>Type</th><th>Rows</th><th>Size</th><th /></tr>
          </thead>
          <tbody>
            {data.items.map((f) => (
              <tr key={f.id}>
                <td><button className="link" onClick={() => setViewing(f)}>{f.symbol}</button></td>
                <td>{f.market ?? '–'}</td>
                <td>{Object.entries(f.params).map(([k, v]) => `${k}=${v}`).join(', ') || '–'}</td>
                <td>{fmtDate(f.created_at)}</td>
                <td>{kindLabel(f)}</td>
                <td>{f.row_count ?? '–'}</td>
                <td>{fmtSize(f.size_bytes)}</td>
                <td className="actions">{f.mine && <button className="link danger" onClick={() => remove(f)}>Delete</button>}</td>
              </tr>
            ))}
            {data.items.length === 0 && <tr><td colSpan={8} className="muted">Nothing downloaded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {viewing && <FileViewer base={`/market-data/${viewing.id}`} title={fullName(viewing)} onClose={() => setViewing(null)} />}
    </>
  );
}
