import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type MarketFile, type MarketList } from '../api';
import FileViewer from './FileViewer';
import { CreditWarning, useCredits } from '../credits';
import { fmtDate, fmtSize, fullName, kindLabel } from '../format';
import { useMarketFilter } from '../marketFilter';

const FUNCTIONS = [
  { value: 'TIME_SERIES_DAILY', label: 'Stock (daily)', market: false },
  { value: 'DIGITAL_CURRENCY_DAILY', label: 'Crypto (daily)', market: true },
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
  const { balance, pricing, refresh } = useCredits();
  const { shown, controls, filtered } = useMarketFilter(data.items);
  const cost = pricing?.downloadCost ?? 5;

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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      refresh(); // the balance changed (or a refund was issued)
    }
  }

  async function remove(f: MarketFile) {
    if (!confirm(`Delete ${fullName(f)}?`)) return;
    await api(`/market-data/${f.id}`, { method: 'DELETE' }).catch((e) => setError(e.message));
    load().catch(() => {});
  }

  const noCredits = balance !== null && balance < cost;
  return (
    <>
      <h1>Market data</h1>
      <p className="muted">
        Downloaded files are shared with all signed-in users, and using them is free. Pick them in the <Link to="/benchmark">benchmark</Link> next to your own datasets.
      </p>

      <CreditWarning need={cost} action="downloading a new file" />

      <div className="card">
        <h2>Download new data</h2>
        {!data.configured && <p className="error">Market data downloads are not configured on the server.</p>}
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
                <option value="full">Full history (may need a premium plan)</option>
              </select>
            </label>
          )}
          <button disabled={busy || noCredits || !data.configured || !symbol.trim() || (crypto && !market.trim())} onClick={download}>
            {busy ? 'Downloading…' : `Download (${cost} credits)`}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <div className="row between">
          <h2>Downloaded files</h2>
          {controls}
        </div>
        <table>
          <thead>
            <tr><th>Symbol</th><th>Market</th><th>Downloaded</th><th>Type</th><th>Rows</th><th>Size</th><th /></tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.id}>
                <td><button className="link" onClick={() => setViewing(f)}>{f.symbol}</button></td>
                <td>{f.market ?? '–'}</td>
                <td>{fmtDate(f.created_at)}</td>
                <td>{kindLabel(f)}</td>
                <td>{f.row_count ?? '–'}</td>
                <td>{fmtSize(f.size_bytes)}</td>
                <td className="actions">{f.mine && <button className="link danger" onClick={() => remove(f)}>Delete</button>}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={7} className="muted">{filtered ? 'No files match the filter.' : 'Nothing downloaded yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {viewing && <FileViewer base={`/market-data/${viewing.id}`} title={fullName(viewing)} onClose={() => setViewing(null)} />}
    </>
  );
}
