import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, classifyBody, makeFilename, publicParams, requestSchema } from '../src/alphavantage.js';

test('stock request is validated and normalised', () => {
  const r = requestSchema.parse({ function: 'TIME_SERIES_DAILY', symbol: ' aapl ' });
  assert.deepEqual(r, { function: 'TIME_SERIES_DAILY', symbol: 'AAPL', outputsize: 'compact' });
});
test('crypto request needs a market', () => {
  assert.throws(() => requestSchema.parse({ function: 'DIGITAL_CURRENCY_DAILY', symbol: 'BTC' }));
  const r = requestSchema.parse({ function: 'DIGITAL_CURRENCY_DAILY', symbol: 'btc', market: 'usd' });
  assert.equal(r.function === 'DIGITAL_CURRENCY_DAILY' && r.market, 'USD');
});
test('unknown functions and odd symbols are rejected', () => {
  assert.throws(() => requestSchema.parse({ function: 'SYMBOL_SEARCH', symbol: 'A' }));
  assert.throws(() => requestSchema.parse({ function: 'TIME_SERIES_DAILY', symbol: 'A&apikey=x' }));
});
test('api key is only in the upstream url, never in public params or filename', () => {
  const r = requestSchema.parse({ function: 'DIGITAL_CURRENCY_DAILY', symbol: 'BTC', market: 'USD' });
  const url = buildUrl(r, 'SECRET');
  assert.match(url, /function=DIGITAL_CURRENCY_DAILY/);
  assert.match(url, /apikey=SECRET/);
  assert.deepEqual(publicParams(r), {});
  assert.ok(!makeFilename(r, new Date()).includes('SECRET'));
});
test('filename carries function, symbol, market and UTC timestamp', () => {
  const r = requestSchema.parse({ function: 'DIGITAL_CURRENCY_DAILY', symbol: 'BTC', market: 'USD' });
  assert.equal(makeFilename(r, new Date('2026-11-11T15:30:05.123Z')), 'DIGITAL_CURRENCY_DAILY_BTC_USD_20261111T153005Z.json');
});
test('classifyBody spots errors, rate limits and good data', () => {
  assert.equal(classifyBody({ 'Error Message': 'bad' }).ok, false);
  assert.equal(classifyBody({ Information: 'Our standard API rate limit is 25 requests per day' }).ok, false);
  const ok = classifyBody({ 'Meta Data': {}, 'Time Series (Daily)': { '2026-11-10': {}, '2026-11-09': {} } });
  assert.deepEqual(ok, { ok: true, rows: 2 });
});
