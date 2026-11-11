import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Dataset, type MarketFile, type MarketList, type Run } from '../api';
import { describe, fmtDate, fmtSize } from './MarketData';
import FileViewer from './FileViewer';

export default function Workbench() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [market, setMarket] = useState<MarketFile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string[]>([]);
  const [viewing, setViewing] = useState<{ base: string; title: string } | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [d, r, m] = await Promise.all([api<Dataset[]>('/datasets'), api<Run[]>('/runs'), api<MarketList>('/market-data')]);
    setDatasets(d);
    setMarket(m.items);
    setSelectedMarket((x) => x.filter((id) => m.items.some((f) => f.id === id)));
    setRuns(r);
  }, []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const d = await api<Dataset>('/datasets', { method: 'POST', body: form });
      setDatasets((x) => [d, ...x]);
      setSelected((x) => [...x, d.id]);
    } catch (e) { setError((e as Error).message); }
  }

  async function remove(id: string) {
    await api(`/datasets/${id}`, { method: 'DELETE' }).catch((e) => setError(e.message));
    setSelected((x) => x.filter((i) => i !== id));
    load().catch(() => {});
  }

  const toggle = (set: typeof setSelected, id: string) =>
    set((x) => (x.includes(id) ? x.filter((i) => i !== id) : [...x, id]));
  const count = selected.length + selectedMarket.length;

  async function run() {
    setBusy(true);
    setError('');
    try {
      const r = await api<Run>('/runs', { method: 'POST', json: { prompt, datasetIds: selected, marketDataIds: selectedMarket } });
      setRuns((x) => [r, ...x]);
      setPrompt('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid">
      <aside className="card">
        <h2>Datasets</h2>
        <label className="upload">
          + Upload file
          <input type="file" hidden accept=".csv,.tsv,.json,.xlsx,.parquet,.txt" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <ul className="list">
          {datasets.map((d) => (
            <li key={d.id} className={selected.includes(d.id) ? 'sel' : ''}>
              <label className="check">
                <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggle(setSelected, d.id)} />
                <span>{d.filename} <span className="muted">{fmtSize(d.size_bytes)}</span></span>
              </label>
              <button className="link" onClick={() => setViewing({ base: `/datasets/${d.id}`, title: d.filename })}>View</button>
              <button className="link danger" onClick={() => remove(d.id)} aria-label={`Delete ${d.filename}`}>✕</button>
            </li>
          ))}
          {datasets.length === 0 && <li className="muted">No datasets yet.</li>}
        </ul>

        <h2 className="section">Market data <Link to="/market-data" className="small">manage</Link></h2>
        <ul className="list">
          {market.map((f) => (
            <li key={f.id} className={selectedMarket.includes(f.id) ? 'sel' : ''}>
              <label className="check">
                <input type="checkbox" checked={selectedMarket.includes(f.id)} onChange={() => toggle(setSelectedMarket, f.id)} />
                <span>{f.function}<br /><span className="muted small">{describe(f)} · {fmtDate(f.created_at)}</span></span>
              </label>
              <button className="link" onClick={() => setViewing({ base: `/market-data/${f.id}`, title: `${f.function} ${describe(f)}` })}>View</button>
            </li>
          ))}
          {market.length === 0 && <li className="muted">Nothing downloaded yet.</li>}
        </ul>
      </aside>

      <section>
        <div className="card">
          <h2>Ask</h2>
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={count ? 'e.g. Summarise the selected files and plot the distribution of each numeric column' : 'Select one or more files, or just ask for some analysis…'}
          />
          <p className="muted">
            {count
              ? `Attached: ${[...datasets.filter((d) => selected.includes(d.id)).map((d) => d.filename), ...market.filter((f) => selectedMarket.includes(f.id)).map((f) => `${f.function} ${describe(f)}`)].join(', ')}`
              : datasets.length || market.length ? 'No files selected — tick one or more in the lists to attach them.' : 'No dataset attached.'}
          </p>
          <div className="row">
            <button disabled={busy || !prompt.trim()} onClick={run}>{busy ? 'Running…' : 'Generate & run'}</button>
            <span className="muted">Code runs in an isolated sandbox with no internet access.</span>
          </div>
          {error && <p className="error">{error}</p>}
        </div>

        {runs.map((r) => (
          <article className="card" key={r.id}>
            <div className="row between">
              <strong>{r.prompt}</strong>
              <span className={`pill ${r.status}`}>{r.status}{r.duration_ms ? ` · ${(r.duration_ms / 1000).toFixed(1)}s` : ''}</span>
            </div>
            {r.code && <details><summary>Generated code</summary><pre>{r.code}</pre></details>}
            {r.stdout && <pre className="out">{r.stdout}</pre>}
            {r.result && r.result !== r.stdout && <pre className="out">{r.result}</pre>}
            {(r.files?.length ?? 0) > 0 && (
              <div className="files">
                {r.files.filter((f) => f.content_type.startsWith('image/') && f.content_type !== 'image/svg+xml').map((f) => (
                  <a key={f.id} href={`/api/runs/${r.id}/files/${f.id}`} target="_blank" rel="noreferrer">
                    <img src={`/api/runs/${r.id}/files/${f.id}`} alt={f.filename} className="out-img" />
                  </a>
                ))}
                <ul className="list">
                  {r.files.map((f) => (
                    <li key={f.id}>
                      <a href={`/api/runs/${r.id}/files/${f.id}`} download={f.filename}>{f.filename}</a>{' '}
                      <span className="muted">{fmtSize(f.size_bytes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.stderr && <pre className="out err">{r.stderr}</pre>}
          </article>
        ))}
      </section>
      {viewing && <FileViewer base={viewing.base} title={viewing.title} onClose={() => setViewing(null)} />}
    </div>
  );
}
