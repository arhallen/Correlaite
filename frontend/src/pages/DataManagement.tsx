import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Dataset, type MarketFile, type MarketList } from '../api';
import FileViewer from './FileViewer';
import { CreditWarning, useCredits } from '../credits';
import { fmtDate, fmtSize, fullName, kindLabel } from '../format';
import { useMarketFilter } from '../marketFilter';

const FUNCTIONS = [
  { value: 'TIME_SERIES_DAILY', label: 'Stock (daily)', market: false },
  { value: 'DIGITAL_CURRENCY_DAILY', label: 'Crypto (daily)', market: true },
];

export default function DataManagement() {
  const [data, setData] = useState<MarketList>({ configured: true, items: [] });
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [fn, setFn] = useState(FUNCTIONS[0].value);
  const [symbol, setSymbol] = useState('');
  const [market, setMarket] = useState('USD');
  const [outputsize, setOutputsize] = useState('compact');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<{ base: string; title: string } | null>(null);
  const { balance, pricing, refresh } = useCredits();
  const { shown, controls, filtered } = useMarketFilter(data.items);
  const downloadCost = pricing?.downloadCost ?? 5;
  const accessCost = pricing?.accessCost ?? 1;

  const load = useCallback(async () => {
    const [m, d] = await Promise.all([api<MarketList>('/market-data'), api<Dataset[]>('/datasets')]);
    setData(m);
    setDatasets(d);
  }, []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  const crypto = FUNCTIONS.find((f) => f.value === fn)!.market;
  const owned = shown.filter((f) => f.owned);
  const available = shown.filter((f) => !f.owned);
  const wanted = symbol.trim().toUpperCase();
  const alreadyThere = wanted ? data.items.filter((f) => !f.owned && f.symbol === wanted && (f.function === 'DIGITAL_CURRENCY_DAILY') === crypto) : [];

  async function act(key: string, fnc: () => Promise<unknown>) {
    setBusy(key);
    setError('');
    try { await fnc(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); refresh(); }
  }

  const retrieve = () => act('retrieve', async () => {
    const body = crypto ? { function: fn, symbol, market } : { function: fn, symbol, outputsize };
    const f = await api<MarketFile>('/market-data', { method: 'POST', json: body });
    setData((d) => ({ ...d, items: [f, ...d.items] }));
    setSymbol('');
  });
  const buy = (f: MarketFile) => act(`buy-${f.id}`, async () => {
    await api(`/market-data/${f.id}/access`, { method: 'POST' });
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === f.id ? { ...x, owned: true } : x)) }));
  });
  const removeFile = (f: MarketFile) => act(`del-${f.id}`, async () => {
    if (!confirm(`Delete ${fullName(f)}?`)) return;
    await api(`/market-data/${f.id}`, { method: 'DELETE' });
    await load();
  });
  const upload = (file: File | undefined) => file && act('upload', async () => {
    const form = new FormData();
    form.append('file', file);
    const d = await api<Dataset>('/datasets', { method: 'POST', body: form });
    setDatasets((x) => [d, ...x]);
  });
  const removeDataset = (d: Dataset) => act(`deld-${d.id}`, async () => {
    if (!confirm(`Delete ${d.filename}?`)) return;
    await api(`/datasets/${d.id}`, { method: 'DELETE' });
    await load();
  });

  const canRetrieve = balance === null || balance >= downloadCost;
  const canBuy = balance === null || balance >= accessCost;
  const sortedDatasets = [...datasets].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <>
      <h1>Data management</h1>
      <p className="muted">
        Get market data, upload your own files, and choose what to use in the <Link to="/benchmark">benchmark</Link>. The benchmark only offers files you own.
      </p>

      <CreditWarning need={accessCost} action="getting new data" />
      {error && <p className="error">{error} {error.includes('credit') && <Link to="/credits">Get more credits</Link>}</p>}

      <div className="card">
        <h2>Retrieve new data from the market <span className="muted">({downloadCost} credits)</span></h2>
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
          <button disabled={busy !== '' || !canRetrieve || !data.configured || !symbol.trim() || (crypto && !market.trim())} onClick={retrieve}>
            {busy === 'retrieve' ? 'Retrieving…' : `Retrieve from market data (${downloadCost} credits)`}
          </button>
        </div>
        {alreadyThere.length > 0 && (
          <p className="notice">
            {alreadyThere.length} existing {alreadyThere.length === 1 ? 'file' : 'files'} for {wanted} can be used for just {accessCost} credit each. See "Available files" below.
          </p>
        )}
      </div>

      <div className="card">
        <div className="row between">
          <h2>Your uploads <span className="muted">(free)</span></h2>
          <label className="upload">
            + Upload file
            <input type="file" hidden accept=".csv,.tsv,.json,.xlsx,.parquet,.txt" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <table>
          <thead><tr><th>File</th><th>Uploaded</th><th>Size</th><th /></tr></thead>
          <tbody>
            {sortedDatasets.map((d) => (
              <tr key={d.id}>
                <td><button className="link" onClick={() => setViewing({ base: `/datasets/${d.id}`, title: d.filename })}>{d.filename}</button></td>
                <td>{fmtDate(d.created_at)}</td>
                <td>{fmtSize(d.size_bytes)}</td>
                <td className="actions"><button className="link danger" onClick={() => removeDataset(d)}>Delete</button></td>
              </tr>
            ))}
            {datasets.length === 0 && <tr><td colSpan={4} className="muted">No uploads yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="row between">
          <h2>Market data</h2>
          {controls}
        </div>

        <h3>Your files <span className="muted">(free to use and view)</span></h3>
        <table>
          <thead><tr><th>Symbol</th><th>Market</th><th>Downloaded</th><th>Type</th><th>Rows</th><th>Size</th><th /></tr></thead>
          <tbody>
            {owned.map((f) => (
              <tr key={f.id}>
                <td><button className="link" onClick={() => setViewing({ base: `/market-data/${f.id}`, title: fullName(f) })}>{f.symbol}</button></td>
                <td>{f.market ?? '–'}</td>
                <td>{fmtDate(f.created_at)}</td>
                <td>{kindLabel(f)}</td>
                <td>{f.row_count ?? '–'}</td>
                <td>{fmtSize(f.size_bytes)}</td>
                <td className="actions">{f.mine && <button className="link danger" onClick={() => removeFile(f)}>Delete</button>}</td>
              </tr>
            ))}
            {owned.length === 0 && <tr><td colSpan={7} className="muted">{filtered ? 'No files match the filter.' : 'You do not own any market data files yet.'}</td></tr>}
          </tbody>
        </table>

        <h3>Available files <span className="muted">({accessCost} credit each, once)</span></h3>
        <table>
          <thead><tr><th>Symbol</th><th>Market</th><th>Downloaded</th><th>Type</th><th>Rows</th><th>Size</th><th /></tr></thead>
          <tbody>
            {available.map((f) => (
              <tr key={f.id}>
                <td>{f.symbol}</td>
                <td>{f.market ?? '–'}</td>
                <td>{fmtDate(f.created_at)}</td>
                <td>{kindLabel(f)}</td>
                <td>{f.row_count ?? '–'}</td>
                <td>{fmtSize(f.size_bytes)}</td>
                <td className="actions">
                  <button disabled={busy !== '' || !canBuy} onClick={() => buy(f)}>{busy === `buy-${f.id}` ? 'Buying…' : `Use for ${accessCost} credit`}</button>
                </td>
              </tr>
            ))}
            {available.length === 0 && <tr><td colSpan={7} className="muted">{filtered ? 'No files match the filter.' : 'No other files available.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {viewing && <FileViewer base={viewing.base} title={viewing.title} onClose={() => setViewing(null)} />}
    </>
  );
}
