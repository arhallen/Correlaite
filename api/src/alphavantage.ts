import { z } from 'zod';
import { config } from './config.js';
import { HttpError } from './errors.js';

const BASE = 'https://www.alphavantage.co/query';
const SYMBOL = /^[A-Za-z0-9.\-]{1,20}$/;
const MARKET = /^[A-Za-z]{2,10}$/;

/** What users may ask for. Anything else is rejected, so the API key is only ever sent for these calls. */
export const requestSchema = z.discriminatedUnion('function', [
  z.object({
    function: z.literal('TIME_SERIES_DAILY'),
    symbol: z.string().trim().regex(SYMBOL).transform((s) => s.toUpperCase()),
    outputsize: z.enum(['compact', 'full']).default('compact'),
  }),
  z.object({
    function: z.literal('DIGITAL_CURRENCY_DAILY'),
    symbol: z.string().trim().regex(SYMBOL).transform((s) => s.toUpperCase()),
    market: z.string().trim().regex(MARKET).transform((s) => s.toUpperCase()),
  }),
]);
export type AvRequest = z.infer<typeof requestSchema>;

/** Non-secret parameters, exactly as shown to users and stored in the catalog. */
export function publicParams(r: AvRequest): Record<string, string> {
  const { function: _f, symbol: _s, market: _m, ...rest } = r as Record<string, string>;
  return rest;
}

/** Builds the upstream URL. The only place the API key is added. */
export function buildUrl(r: AvRequest, apiKey: string): string {
  const u = new URL(BASE);
  u.searchParams.set('function', r.function);
  u.searchParams.set('symbol', r.symbol);
  if ('market' in r) u.searchParams.set('market', r.market);
  for (const [k, v] of Object.entries(publicParams(r))) u.searchParams.set(k, v);
  u.searchParams.set('apikey', apiKey);
  return u.toString();
}

export function makeFilename(r: AvRequest, at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const parts = [r.function, r.symbol, 'market' in r ? r.market : null, stamp].filter(Boolean);
  return `${parts.join('_')}.json`;
}

/** Alpha Vantage reports errors, rate limits and premium-only calls with HTTP 200 and a small JSON body. */
export function classifyBody(body: any): { ok: true; rows: number } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Unexpected response from Alpha Vantage' };
  if (typeof body['Error Message'] === 'string') return { ok: false, message: 'Alpha Vantage did not recognise this symbol or request' };
  const note = body.Note ?? body.Information;
  if (typeof note === 'string') {
    return { ok: false, message: /premium/i.test(note) ? 'This request needs a premium Alpha Vantage plan' : 'Alpha Vantage rate limit reached, try again later' };
  }
  const series = Object.entries(body).find(([k, v]) => k.startsWith('Time Series') && v && typeof v === 'object');
  if (!series) return { ok: false, message: 'Alpha Vantage returned no time series' };
  return { ok: true, rows: Object.keys(series[1] as object).length };
}

export const alphaVantageConfigured = () => Boolean(config.ALPHAVANTAGE_API_KEY);

export async function fetchSeries(r: AvRequest): Promise<{ data: Buffer; rows: number }> {
  const key = config.ALPHAVANTAGE_API_KEY;
  if (!key) throw new HttpError(503, 'Alpha Vantage is not configured');
  let res: Response;
  try {
    res = await fetch(buildUrl(r, key), { signal: AbortSignal.timeout(30_000) });
  } catch {
    // Deliberately no error details: fetch errors can include the request URL, which contains the key.
    throw new HttpError(502, 'Could not reach Alpha Vantage');
  }
  if (!res.ok) throw new HttpError(502, `Alpha Vantage request failed (${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());
  let body: unknown;
  try {
    body = JSON.parse(data.toString('utf8'));
  } catch {
    throw new HttpError(502, 'Alpha Vantage returned invalid JSON');
  }
  const c = classifyBody(body);
  if (!c.ok) throw new HttpError(502, c.message);
  return { data, rows: c.rows };
}

export interface Table {
  meta: Record<string, string>;
  columns: string[];
  rows: string[][];
  total: number;
}

const cleanKey = (k: string) => k.replace(/^\d+[a-z]?\.\s*/i, '');

/** Turns a stored Alpha Vantage response into a table (newest first) for the viewer. */
export function toTable(body: any, limit = 500): Table | null {
  const entry = Object.entries(body ?? {}).find(([k, v]) => k.startsWith('Time Series') && v && typeof v === 'object');
  if (!entry) return null;
  const series = entry[1] as Record<string, Record<string, unknown>>;
  const dates = Object.keys(series).sort().reverse();
  const columns: string[] = [];
  for (const d of dates.slice(0, limit)) {
    for (const k of Object.keys(series[d] ?? {})) if (!columns.includes(k)) columns.push(k);
  }
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(body['Meta Data'] ?? {})) meta[cleanKey(k)] = String(v);
  return {
    meta,
    columns: ['date', ...columns.map(cleanKey)],
    rows: dates.slice(0, limit).map((d) => [d, ...columns.map((c) => String(series[d]?.[c] ?? ''))]),
    total: dates.length,
  };
}
