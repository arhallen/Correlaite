import { useEffect, useState } from 'react';
import { api, type Preview } from '../api';

/** Modal that shows a file's content. `base` is e.g. `/market-data/<id>` or `/datasets/<id>`. */
export default function FileViewer({ base, title, onClose }: { base: string; title: string; onClose: () => void }) {
  const [p, setP] = useState<Preview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Preview>(`${base}/preview`).then(setP).catch((e) => setError(e.message));
  }, [base]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <strong>{title}</strong>
          <span className="row">
            <a href={`/api${base}/download`} download>Download</a>
            <button className="link" onClick={onClose}>Close</button>
          </span>
        </div>
        {error && <p className="error">{error}</p>}
        {!p && !error && <p className="muted">Loading…</p>}
        {p?.kind === 'table' && (
          <>
            <p className="muted small">
              {Object.entries(p.meta).map(([k, v]) => `${k}: ${v}`).join(' · ')}
              {p.total > p.rows.length ? ` · showing newest ${p.rows.length} of ${p.total} rows` : ` · ${p.total} rows`}
            </p>
            <div className="scroll">
              <table>
                <thead><tr>{p.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{p.rows.map((r) => <tr key={r[0]}>{r.map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </>
        )}
        {p?.kind === 'text' && (
          <>
            {p.truncated && <p className="muted small">Showing the first 100 KB. Download for the full file.</p>}
            <pre className="scroll">{p.text}</pre>
          </>
        )}
        {p?.kind === 'binary' && <p className="muted">This file type can't be shown here. Use Download to open it.</p>}
      </div>
    </div>
  );
}
