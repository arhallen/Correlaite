import type { MarketFile } from './api';

export const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
export const fmtDate = (s: string) => new Date(s).toLocaleString();
export const fmtMoney = (cents: number) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

export const kindLabel = (f: MarketFile) => (f.function === 'DIGITAL_CURRENCY_DAILY' ? 'CRYPTO' : 'STOCK');
/** Symbol first, then market and any other parameters. `outputsize` is an internal detail and never shown. */
export const describe = (f: MarketFile) =>
  [f.symbol, f.market, ...Object.entries(f.params).filter(([k]) => k !== 'outputsize').map(([k, v]) => `${k}=${v}`)].filter(Boolean).join(' / ');
/** Full display name: symbol / market · downloaded date and time · STOCK or CRYPTO. */
export const fullName = (f: MarketFile) => `${describe(f)} · ${fmtDate(f.created_at)} · ${kindLabel(f)}`;
