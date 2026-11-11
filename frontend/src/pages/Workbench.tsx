import { useCallback, useEffect, useState } from 'react';
import { api, type Dataset, type Run } from '../api';

const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export default function Workbench() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [d, r] = await Promise.all([api<Dataset[]>('/datasets'), api<Run[]>('/runs')]);
    setDatasets(d);
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
      setSelected(d.id);
    } catch (e) { setError((e as Error).message); }
  }

  async function remove(id: string) {
    await api(`/datasets/${id}`, { method: 'DELETE' }).catch((e) => setError(e.message));
    if (selected === id) setSelected('');
    load().catch(() => {});
  }

  async function run() {
    setBusy(true);
    setError('');
    try {
      const r = await api<Run>('/runs', { method: 'POST', json: { prompt, datasetId: selected || undefined } });
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
            <li key={d.id} className={d.id === selected ? 'sel' : ''}>
              <button className="link" onClick={() => setSelected(d.id === selected ? '' : d.id)}>
                {d.filename} <span className="muted">{fmtSize(d.size_bytes)}</span>
              </button>
              <button className="link danger" onClick={() => remove(d.id)} aria-label={`Delete ${d.filename}`}>✕</button>
            </li>
          ))}
          {datasets.length === 0 && <li className="muted">No datasets yet.</li>}
        </ul>
      </aside>

      <section>
        <div className="card">
          <h2>Ask</h2>
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={selected ? 'e.g. Summarise this dataset and plot the distribution of each numeric column' : 'Select a dataset, or just ask for some analysis…'}
          />
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
            {r.stderr && <pre className="out err">{r.stderr}</pre>}
          </article>
        ))}
      </section>
    </div>
  );
}
