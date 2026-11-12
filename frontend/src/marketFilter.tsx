import { useMemo, useState, type ReactNode } from 'react';
import type { MarketFile } from './api';
import { kindLabel } from './format';

type Sort = 'newest' | 'oldest' | 'symbol';

/** Filter by symbol and/or type, and sort (latest first by default). Returns the visible items and the controls. */
export function useMarketFilter(items: MarketFile[]): { shown: MarketFile[]; controls: ReactNode; filtered: boolean } {
  const [symbol, setSymbol] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState<Sort>('newest');

  const shown = useMemo(() => {
    const s = symbol.trim().toLowerCase();
    const list = items.filter((f) => (!s || f.symbol.toLowerCase().includes(s)) && (!type || kindLabel(f) === type));
    const byDate = (a: MarketFile, b: MarketFile) => b.created_at.localeCompare(a.created_at);
    return [...list].sort(
      sort === 'oldest' ? (a, b) => -byDate(a, b) : sort === 'symbol' ? (a, b) => a.symbol.localeCompare(b.symbol) || byDate(a, b) : byDate,
    );
  }, [items, symbol, type, sort]);

  const controls = (
    <div className="filters">
      <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Filter symbol" aria-label="Filter by symbol" />
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
        <option value="">All types</option>
        <option value="STOCK">Stock</option>
        <option value="CRYPTO">Crypto</option>
      </select>
      <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="symbol">Symbol A–Z</option>
      </select>
    </div>
  );
  return { shown, controls, filtered: Boolean(symbol.trim() || type) };
}
